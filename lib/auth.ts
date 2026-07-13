import NextAuth from 'next-auth'
import EmailProvider from 'next-auth/providers/email'
import CredentialsProvider from 'next-auth/providers/credentials'
import GoogleProvider from 'next-auth/providers/google'
import GitHubProvider from 'next-auth/providers/github'
import MicrosoftEntraIDProvider from 'next-auth/providers/microsoft-entra-id'
import { PrismaAdapter } from '@auth/prisma-adapter'
import type { Adapter, AdapterAccount, AdapterUser } from '@auth/core/adapters'
import { randomUUID } from 'crypto'
import { prisma } from './prisma'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      name?: string | null
      email?: string | null
      image?: string | null
      role?: 'ADMIN' | 'ACCOUNTANT' | 'VIEWER'
      totpEnabled?: boolean
    }
    totpSessionId?: string
    sessionVersion?: number
    revoked?: boolean
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string
    role?: 'ADMIN' | 'ACCOUNTANT' | 'VIEWER'
    totpSessionId?: string
  }
}

const emailProviders = []
const oauthProviders = []

// Only add email provider if SMTP is configured
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  emailProviders.push(
    EmailProvider({
      server: {
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      },
      from: process.env.SMTP_FROM || 'noreply@entrytwo.local',
    })
  )
}

// Google OAuth
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  oauthProviders.push(
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    })
  )
}

// GitHub OAuth
if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  oauthProviders.push(
    GitHubProvider({
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    })
  )
}

if (process.env.MICROSOFT_ENTRA_ID_ID && process.env.MICROSOFT_ENTRA_ID_SECRET) {
  oauthProviders.push(MicrosoftEntraIDProvider({
    clientId: process.env.MICROSOFT_ENTRA_ID_ID,
    clientSecret: process.env.MICROSOFT_ENTRA_ID_SECRET,
    issuer: process.env.MICROSOFT_ENTRA_ID_ISSUER,
  }))
}

// Fallback credentials provider for development when no SMTP configured
const devProvider = CredentialsProvider({
  id: 'credentials',
  name: 'Credentials',
  credentials: {
    email: { label: 'Email', type: 'email', placeholder: 'dev@entrytwo.local' },
  },
  async authorize(credentials) {
    if (!credentials?.email) return null
    const email = credentials.email as string

    try {
      const existing = await prisma.user.findUnique({ where: { email } })
      if (existing) return { id: existing.id, email: existing.email, name: existing.name || '' }

      const user = await prisma.user.create({
        data: { email, role: 'ADMIN' },
      })
      return { id: user.id, email: user.email, name: user.name || '' }
    } catch {
      return null
    }
  },
})

const allowDevCredentials = process.env.NODE_ENV !== 'production' && emailProviders.length === 0 && oauthProviders.length === 0
const allProviders = [...emailProviders, ...oauthProviders, ...(allowDevCredentials ? [devProvider] : [])]

if (process.env.NODE_ENV === 'production' && !process.env.AUTH_SECRET) {
  throw new Error('AUTH_SECRET is required in production')
}

const baseAdapter = PrismaAdapter(prisma)
const adapter: Adapter = {
  ...baseAdapter,
  async createUser(user: AdapterUser) {
    const email = user.email.toLowerCase()
    const invitation = await prisma.userInvitation.findFirst({ where: { email: { equals: email, mode: 'insensitive' }, acceptedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } })
    if (!invitation) {
      // Audit sign-in failure for unknown/no-invitation OAuth attempt
      await prisma.event.create({
        data: {
          eventType: 'MANUAL_ADJUSTMENT',
          entityType: 'User',
          entityId: '00000000-0000-0000-0000-000000000000', // placeholder; no user yet
          payload: { action: 'AUTH_SIGN_IN_FAILURE', email, reason: 'NO_ACTIVE_INVITATION' },
        },
      })
      throw new Error('Access requires an active invitation')
    }
    return prisma.$transaction(async tx => {
      const created = await tx.user.create({ data: { id: user.id, email, name: user.name, role: invitation.role } })
      await tx.userInvitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } })
      await tx.event.create({ data: { eventType: 'USER_CREATED', entityType: 'User', entityId: created.id, createdBy: invitation.createdById, payload: { action: 'INVITATION_ACCEPTED', email, provider: 'oauth' } } })
      return { ...created, emailVerified: user.emailVerified, image: user.image }
    })
  },
  async getUserByAccount({ provider, providerAccountId }) {
    const account = await prisma.oAuthAccount.findUnique({ where: { provider_providerAccountId: { provider, providerAccountId } }, include: { user: true } })
    return account ? { ...account.user, emailVerified: null, image: null } : null
  },
  async linkAccount(account: AdapterAccount) {
    const allowed = new Set(['google', 'github', 'microsoft-entra-id'])
    if (!allowed.has(account.provider)) throw new Error('OAuth provider is not allowed')
    await prisma.$transaction(async tx => {
      await tx.oAuthAccount.create({ data: {
        userId: account.userId, type: account.type, provider: account.provider, providerAccountId: account.providerAccountId,
        refreshToken: account.refresh_token, accessToken: account.access_token, expiresAt: account.expires_at,
        tokenType: account.token_type, scope: account.scope, idToken: account.id_token, sessionState: account.session_state as string | null | undefined,
      } })
      await tx.event.create({ data: { eventType: 'MANUAL_ADJUSTMENT', entityType: 'User', entityId: account.userId, createdBy: account.userId, payload: { action: 'OAUTH_ACCOUNT_LINKED', provider: account.provider } } })
    })
    return account
  },
  async unlinkAccount({ provider, providerAccountId }) {
    const account = await prisma.oAuthAccount.delete({ where: { provider_providerAccountId: { provider, providerAccountId } } })
    return { ...account, refresh_token: account.refreshToken, access_token: account.accessToken, expires_at: account.expiresAt, token_type: account.tokenType, id_token: account.idToken, session_state: account.sessionState } as AdapterAccount
  },
}

const authConfig = NextAuth({
  adapter,
  session: { strategy: 'jwt' },
  providers: allProviders,
  secret: process.env.AUTH_SECRET || (process.env.NODE_ENV !== 'production' ? 'development-secret' : undefined),
  useSecureCookies: process.env.NODE_ENV === 'production',
  cookies: {
    sessionToken: {
      options: {
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
      },
    },
  },
  pages: {
    signIn: '/auth/signin',
    verifyRequest: '/auth/verify',
  },
  callbacks: {
    async session({ session, user, token }) {
      let userId = (user?.id as string | undefined) || (token?.id as string | undefined) || token?.sub
      if (!userId && session.user?.email) {
        userId = (await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } }))?.id
      }
      if (session.user && userId) {
        session.user.id = userId
        const dbUser = await prisma.user.findUnique({
          where: { id: userId },
          select: { role: true, totpEnabled: true, sessionVersion: true, disabled: true },
        })
        if (!dbUser || dbUser.disabled || token?.revoked || token?.sessionVersion !== dbUser.sessionVersion) return { ...session, user: { ...session.user, id: '' } }
        session.user.role = dbUser.role
        session.user.totpEnabled = dbUser?.totpEnabled || false
      }
      session.totpSessionId = token?.totpSessionId
      return session
    },
     async jwt({ token, user }) {
      if (user) {
        token.id = user.id as string
        const role = 'role' in user ? user.role : undefined
       token.role = role === 'ADMIN' || role === 'ACCOUNTANT' || role === 'VIEWER' ? role : undefined
       token.sessionVersion = await prisma.user.findUnique({ where: { id: user.id as string }, select: { sessionVersion: true } }).then(value => value?.sessionVersion ?? 0)
     } else if (token.id || token.sub) {
       const current = await prisma.user.findUnique({ where: { id: String(token.id || token.sub) }, select: { sessionVersion: true } })
       if (!current || current.sessionVersion !== token.sessionVersion) token.revoked = true
     }
      if (!token.totpSessionId) token.totpSessionId = randomUUID()
      return token
    },
  },
  events: {
    async signIn({ user, account }) {
      if (!user.id) return
      await prisma.event.create({ data: { eventType: 'MANUAL_ADJUSTMENT', entityType: 'User', entityId: user.id, createdBy: user.id, payload: { action: 'AUTH_SIGN_IN', provider: account?.provider || 'unknown' } } })
    },
    async signOut(message) {
      const userId = 'token' in message ? String(message.token?.id || message.token?.sub || '') : ''
      if (userId) await prisma.event.create({ data: { eventType: 'MANUAL_ADJUSTMENT', entityType: 'User', entityId: userId, createdBy: userId, payload: { action: 'AUTH_SIGN_OUT' } } })
    },
  },
  trustHost: process.env.NODE_ENV !== 'production' || process.env.AUTH_TRUST_HOST === 'true',
})

export const { handlers, signIn, signOut, auth } = authConfig
