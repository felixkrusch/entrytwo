import { auth } from '@/lib/auth'

export async function requireUser(roles: Array<'ADMIN' | 'ACCOUNTANT' | 'VIEWER'> = ['ADMIN', 'ACCOUNTANT', 'VIEWER']) {
  const session = await auth()
  if (!session?.user?.id || !session.user.role || !roles.includes(session.user.role)) return null
  return session
}
