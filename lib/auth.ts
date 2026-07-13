import NextAuth from 'next-auth'
import EmailProvider from 'next-auth/providers/email'
import CredentialsProvider from 'next-auth/providers/credentials'
import GoogleProvider from 'next-auth/providers/google'
import GitHubProvider from 'next-auth/providers/github'
import { PrismaAdapter } from '@auth/prisma-adapter'
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

const authConfig = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: 'jwt' },
  providers: allProviders,
  secret: process.env.AUTH_SECRET || (process.env.NODE_ENV !== 'production' ? 'development-secret' : undefined),
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
          select: { role: true, totpEnabled: true },
        })
        session.user.role = dbUser?.role || 'VIEWER'
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
      }
      if (!token.totpSessionId) token.totpSessionId = randomUUID()
      return token
    },
  },
  trustHost: process.env.NODE_ENV !== 'production' || process.env.AUTH_TRUST_HOST === 'true',
})

export const { handlers, signIn, signOut, auth } = authConfig
