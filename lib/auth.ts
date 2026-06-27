import NextAuth from 'next-auth'
import EmailProvider from 'next-auth/providers/email'
import CredentialsProvider from 'next-auth/providers/credentials'
import { PrismaAdapter } from '@auth/prisma-adapter'
import { prisma } from './prisma'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      name?: string | null
      email?: string | null
      image?: string | null
      role?: 'ADMIN' | 'ACCOUNTANT' | 'VIEWER'
    }
  }
}

const emailProviders = []

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

const authConfig = NextAuth({
  adapter: process.env.SMTP_HOST ? PrismaAdapter(prisma) : undefined,
  providers: emailProviders.length > 0 ? emailProviders : [devProvider],
  secret: process.env.AUTH_SECRET || 'development-secret',
  pages: {
    signIn: '/auth/signin',
    verifyRequest: '/auth/verify',
  },
  callbacks: {
    async session({ session, user }) {
      if (session.user && user) {
        session.user.id = user.id as string
        const dbUser = await prisma.user.findUnique({
          where: { id: user.id as string },
          select: { role: true },
        })
        session.user.role = dbUser?.role || 'VIEWER'
      }
      return session
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id as string
      }
      return token
    },
  },
  trustHost: true,
})

export const { handlers, signIn, signOut, auth } = authConfig