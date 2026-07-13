import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/authz'

export async function GET() {
  if (!await requireUser()) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  const configured = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)
  return NextResponse.json({ configured })
}
