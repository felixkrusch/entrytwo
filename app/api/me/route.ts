import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/authz'

export async function GET() {
  const session = await requireUser()
  if (!session) return NextResponse.json({ authenticated: false, isAdmin: false }, { status: 401 })
  return NextResponse.json({
    authenticated: true,
    isAdmin: session.user.role === 'ADMIN',
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: session.user.role,
    },
  })
}
