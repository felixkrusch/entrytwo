import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/authz'

export async function GET() {
  if (!await requireUser()) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  return NextResponse.json({ configured: !!process.env.STRIPE_SECRET_KEY })
}
