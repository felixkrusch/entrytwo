import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/authz'

export async function GET() {
  if (!await requireUser()) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const configured = !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_SECRET)
  return NextResponse.json({ configured })
}
