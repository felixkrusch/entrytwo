import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function requireUser(roles: Array<'ADMIN' | 'ACCOUNTANT' | 'VIEWER'> = ['ADMIN', 'ACCOUNTANT', 'VIEWER']) {
  const session = await auth()
  if (!session?.user?.id || !session.user.role || !roles.includes(session.user.role)) return null
  // Explicit disabled check (defense-in-depth; session callback already invalidates, but we re-verify on every privileged call)
  const u = await prisma.user.findUnique({ where: { id: session.user.id }, select: { disabled: true } })
  if (u?.disabled) return null
  return session
}
