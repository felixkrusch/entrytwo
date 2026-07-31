import NextAuth from 'next-auth'
import EmailProvider from 'next-auth/providers/email'
import CredentialsProvider from 'next-auth/providers/credentials'
import GoogleProvider from 'next-auth/providers/google'
import MicrosoftEntraIDProvider from 'next-auth/providers/microsoft-entra-id'
import type { Adapter, AdapterAccount, AdapterUser, VerificationToken } from '@auth/core/adapters'
import { createHash, randomUUID } from 'crypto'
import { prisma } from './prisma'
import { isSmtpConfigured } from './smtp'
import {
  auditAuthFailure,
  canProvisionNewUser,
  findActiveInvitation,
  normalizeEmail,
  oauthEmailIsAcceptable,
} from './authAccess'
import { sendMagicLinkEmail } from './email'

export { isSmtpConfigured }

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
    sessionVersion?: number
    revoked?: boolean
  }
}

const ALLOWED_OAUTH = new Set(['google', 'microsoft-entra-id'])
const isProd = process.env.NODE_ENV === 'production'

export function isGoogleOAuthConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
}

export function isMicrosoftOAuthConfigured() {
  return !!(process.env.MICROSOFT_ENTRA_ID_ID && process.env.MICROSOFT_ENTRA_ID_SECRET)
}

export function listConfiguredOAuthProviders(): Array<'google' | 'microsoft-entra-id'> {
  const providers: Array<'google' | 'microsoft-entra-id'> = []
  if (isGoogleOAuthConfigured()) providers.push('google')
  if (isMicrosoftOAuthConfigured()) providers.push('microsoft-entra-id')
  return providers
}

function toAdapterUser(user: {
  id: string
  email: string
  name: string | null
  emailVerified: Date | null
  image: string | null
}): AdapterUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: user.emailVerified,
    image: user.image,
  }
}

const emailProviders = []
const oauthProviders = []

  if (isSmtpConfigured()) {
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
        from: process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@entrytwo.local',
        maxAge: 60 * 30,
        async sendVerificationRequest({ identifier, url }) {
          await sendMagicLinkEmail({ email: identifier, url })
        },
      }),
    )
  }

if (isGoogleOAuthConfigured()) {
  oauthProviders.push(
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      // Link only when our adapter already resolved the same verified email to a user.
      allowDangerousEmailAccountLinking: true,
    }),
  )
}

if (isMicrosoftOAuthConfigured()) {
  oauthProviders.push(
    MicrosoftEntraIDProvider({
      clientId: process.env.MICROSOFT_ENTRA_ID_ID!,
      clientSecret: process.env.MICROSOFT_ENTRA_ID_SECRET!,
      issuer: process.env.MICROSOFT_ENTRA_ID_ISSUER || 'https://login.microsoftonline.com/common/v2.0',
      allowDangerousEmailAccountLinking: true,
    }),
  )
}

// Local development only — never registered in production builds
const devProvider = CredentialsProvider({
  id: 'credentials',
  name: 'Development',
  credentials: {
    email: { label: 'Email', type: 'email', placeholder: 'dev@entrytwo.local' },
  },
  async authorize(credentials) {
    if (isProd) return null
    if (!credentials?.email) return null
    const email = normalizeEmail(String(credentials.email))
    if (!email.includes('@')) return null

    try {
      const existing = await prisma.user.findUnique({ where: { email } })
      if (existing) {
        if (existing.disabled) return null
        return { id: existing.id, email: existing.email, name: existing.name || '' }
      }

      const gate = await canProvisionNewUser(email)
      if (!gate.ok) return null

      const invitation = await findActiveInvitation(email)
      if (invitation) {
        return prisma.$transaction(async tx => {
          const created = await tx.user.create({
            data: { email, role: invitation.role, emailVerified: new Date() },
          })
          await tx.userInvitation.update({
            where: { id: invitation.id },
            data: { acceptedAt: new Date() },
          })
          return { id: created.id, email: created.email, name: created.name || '' }
        })
      }

      const user = await prisma.user.create({
        data: { email, role: 'ADMIN', emailVerified: new Date() },
      })
      return { id: user.id, email: user.email, name: user.name || '' }
    } catch {
      return null
    }
  },
})

const allProviders = [
  ...emailProviders,
  ...oauthProviders,
  ...(!isProd ? [devProvider] : []),
]

if (isProd && !process.env.AUTH_SECRET) {
  throw new Error('AUTH_SECRET is required in production')
}

const adapter: Adapter = {
  async createUser(user: AdapterUser) {
    const email = normalizeEmail(user.email)
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      if (existing.disabled) throw new Error('Account disabled')
      return toAdapterUser(existing)
    }

    const gate = await canProvisionNewUser(email)
    if (!gate.ok) {
      await auditAuthFailure({ email, reason: gate.reason, provider: 'createUser' })
      throw new Error('Access requires an active invitation')
    }

    const invitation = await findActiveInvitation(email)
    if (!invitation) {
      // Bootstrap path: first user becomes ADMIN (onboarding API is preferred; this is a safety net)
      const created = await prisma.user.create({
        data: {
          id: user.id,
          email,
          name: user.name,
          image: user.image,
          emailVerified: user.emailVerified ?? new Date(),
          role: 'ADMIN',
        },
      })
      return toAdapterUser(created)
    }

    if (normalizeEmail(invitation.email) !== email) {
      await auditAuthFailure({ email, reason: 'INVITE_EMAIL_MISMATCH', provider: 'createUser' })
      throw new Error('Invitation email does not match')
    }

    return prisma.$transaction(async tx => {
      const created = await tx.user.create({
        data: {
          id: user.id,
          email,
          name: user.name,
          image: user.image,
          emailVerified: user.emailVerified ?? new Date(),
          role: invitation.role,
        },
      })
      await tx.userInvitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      })
      await tx.event.create({
        data: {
          eventType: 'USER_CREATED',
          entityType: 'User',
          entityId: created.id,
          createdBy: invitation.createdById,
          payload: { action: 'INVITATION_ACCEPTED', email, provider: 'oauth_or_email' },
        },
      })
      return toAdapterUser(created)
    })
  },

  async getUser(id) {
    const user = await prisma.user.findUnique({ where: { id } })
    return user && !user.disabled ? toAdapterUser(user) : null
  },

  async getUserByEmail(email) {
    const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } })
    return user && !user.disabled ? toAdapterUser(user) : null
  },

  async getUserByAccount({ provider, providerAccountId }) {
    if (!ALLOWED_OAUTH.has(provider)) return null
    const account = await prisma.oAuthAccount.findUnique({
      where: { provider_providerAccountId: { provider, providerAccountId } },
      include: { user: true },
    })
    if (!account || account.user.disabled) return null
    return toAdapterUser(account.user)
  },

  async updateUser(user) {
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        name: user.name ?? undefined,
        email: user.email ? normalizeEmail(user.email) : undefined,
        image: user.image ?? undefined,
        emailVerified: user.emailVerified === undefined ? undefined : user.emailVerified,
      },
    })
    return toAdapterUser(updated)
  },

  async linkAccount(account: AdapterAccount) {
    if (!ALLOWED_OAUTH.has(account.provider)) throw new Error('OAuth provider is not allowed')
    await prisma.$transaction(async tx => {
      await tx.oAuthAccount.create({
        data: {
          userId: account.userId,
          type: account.type,
          provider: account.provider,
          providerAccountId: account.providerAccountId,
          refreshToken: account.refresh_token,
          accessToken: account.access_token,
          expiresAt: account.expires_at,
          tokenType: account.token_type,
          scope: account.scope,
          idToken: account.id_token,
          sessionState: account.session_state as string | null | undefined,
        },
      })
      await tx.event.create({
        data: {
          eventType: 'MANUAL_ADJUSTMENT',
          entityType: 'User',
          entityId: account.userId,
          createdBy: account.userId,
          payload: { action: 'OAUTH_ACCOUNT_LINKED', provider: account.provider },
        },
      })
    })
    return account
  },

  async unlinkAccount({ provider, providerAccountId }) {
    const account = await prisma.oAuthAccount.delete({
      where: { provider_providerAccountId: { provider, providerAccountId } },
    })
    return {
      ...account,
      refresh_token: account.refreshToken,
      access_token: account.accessToken,
      expires_at: account.expiresAt,
      token_type: account.tokenType,
      id_token: account.idToken,
      session_state: account.sessionState,
    } as AdapterAccount
  },

  async createVerificationToken(data: VerificationToken) {
    const identifier = normalizeEmail(data.identifier)
    // Invalidate prior unused tokens for this identity (one active magic link)
    await prisma.verificationToken.deleteMany({ where: { identifier } })
    return prisma.verificationToken.create({
      data: {
        identifier,
        token: data.token,
        expires: data.expires,
      },
    })
  },

  async useVerificationToken({ identifier, token }) {
    try {
      const deleted = await prisma.verificationToken.delete({
        where: {
          identifier_token: {
            identifier: normalizeEmail(identifier),
            token,
          },
        },
      })
      if (deleted.expires < new Date()) return null
      return deleted
    } catch {
      return null
    }
  },
}

const sessionMaxAge = 60 * 60 * 24 * 7 // 7 days

const authConfig = NextAuth({
  adapter,
  session: { strategy: 'jwt', maxAge: sessionMaxAge },
  providers: allProviders,
  secret: process.env.AUTH_SECRET || (!isProd ? 'development-secret' : undefined),
  useSecureCookies: isProd,
  cookies: {
    sessionToken: {
      name: isProd ? '__Secure-authjs.session-token' : 'authjs.session-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProd,
        path: '/',
      },
    },
  },
  pages: {
    signIn: '/auth/signin',
    verifyRequest: '/auth/verify',
    error: '/auth/signin',
  },
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider === 'credentials' && isProd) return false

      if (account && ALLOWED_OAUTH.has(account.provider)) {
        const check = oauthEmailIsAcceptable(
          account.provider,
          profile as Record<string, unknown> | undefined,
          user.email,
        )
        if (!check.ok) {
          await auditAuthFailure({
            email: user.email || 'unknown',
            reason: check.reason,
            provider: account.provider,
          })
          return '/auth/signin?error=AccessDenied'
        }
        user.email = check.email
      }

      const email = user.email ? normalizeEmail(user.email) : ''
      if (!email) return false

      const existing = await prisma.user.findUnique({
        where: { email },
        select: { id: true, disabled: true },
      })
      if (existing?.disabled) {
        await auditAuthFailure({ email, reason: 'ACCOUNT_DISABLED', provider: account?.provider })
        return '/auth/signin?error=AccessDenied'
      }
      if (existing) return true

      const gate = await canProvisionNewUser(email)
      if (gate.ok) return true

      await auditAuthFailure({
        email,
        reason: gate.reason,
        provider: account?.provider || 'unknown',
      })
      return '/auth/signin?error=AccessDenied'
    },

    async session({ session, user, token }) {
      let userId = (user?.id as string | undefined) || (token?.id as string | undefined) || token?.sub
      if (!userId && session.user?.email) {
        userId = (
          await prisma.user.findUnique({
            where: { email: normalizeEmail(session.user.email) },
            select: { id: true },
          })
        )?.id
      }
      if (session.user && userId) {
        session.user.id = userId
        const dbUser = await prisma.user.findUnique({
          where: { id: userId },
          select: {
            role: true,
            totpEnabled: true,
            sessionVersion: true,
            disabled: true,
            email: true,
            name: true,
            image: true,
          },
        })
        if (
          !dbUser ||
          dbUser.disabled ||
          token?.revoked ||
          token?.sessionVersion !== dbUser.sessionVersion
        ) {
          return { ...session, user: { ...session.user, id: '' } }
        }
        session.user.role = dbUser.role
        session.user.totpEnabled = dbUser.totpEnabled || false
        session.user.email = dbUser.email
        session.user.name = dbUser.name
        session.user.image = dbUser.image
        session.sessionVersion = dbUser.sessionVersion
      }
      session.totpSessionId = token?.totpSessionId
      return session
    },

    async jwt({ token, user }) {
      if (user) {
        token.id = user.id as string
        const role = 'role' in user ? (user as { role?: string }).role : undefined
        token.role =
          role === 'ADMIN' || role === 'ACCOUNTANT' || role === 'VIEWER' ? role : undefined
        token.sessionVersion = await prisma.user
          .findUnique({ where: { id: user.id as string }, select: { sessionVersion: true } })
          .then(value => value?.sessionVersion ?? 0)
        token.revoked = false
      } else if (token.id || token.sub) {
        const current = await prisma.user.findUnique({
          where: { id: String(token.id || token.sub) },
          select: { sessionVersion: true, disabled: true },
        })
        if (!current || current.disabled || current.sessionVersion !== token.sessionVersion) {
          token.revoked = true
        }
      }
      if (!token.totpSessionId) token.totpSessionId = randomUUID()
      return token
    },
  },
  events: {
    async signIn({ user, account }) {
      if (!user.id) return
      await prisma.event.create({
        data: {
          eventType: 'MANUAL_ADJUSTMENT',
          entityType: 'User',
          entityId: user.id,
          createdBy: user.id,
          payload: { action: 'AUTH_SIGN_IN', provider: account?.provider || 'unknown' },
        },
      })
    },
    async signOut(message) {
      const userId = 'token' in message ? String(message.token?.id || message.token?.sub || '') : ''
      if (userId) {
        await prisma.event.create({
          data: {
            eventType: 'MANUAL_ADJUSTMENT',
            entityType: 'User',
            entityId: userId,
            createdBy: userId,
            payload: { action: 'AUTH_SIGN_OUT' },
          },
        })
      }
    },
  },
  trustHost: !isProd || process.env.AUTH_TRUST_HOST === 'true',
})

export const { handlers, signIn, signOut, auth } = authConfig

/** Hash used only for logging (never store raw magic-link tokens in logs). */
export function fingerprintToken(token: string) {
  return createHash('sha256').update(token).digest('hex').slice(0, 12)
}
