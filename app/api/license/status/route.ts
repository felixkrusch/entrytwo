import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/authz'
import { getLicenseStatus } from '@/lib/license'

export async function GET() {
  if (!await requireUser()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const status = await getLicenseStatus()
    return NextResponse.json(status)
  } catch (e) {
    return NextResponse.json({ error: 'Failed to load license status' }, { status: 500 })
  }
}
