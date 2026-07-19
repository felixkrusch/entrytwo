import { NextResponse, NextRequest } from 'next/server'
import { requireUser } from '@/lib/authz'
import { getLicenseStatus } from '@/lib/license'
import { rateLimit } from '@/lib/rate-limit'

// "Verify once, trust forever": only reads stored license.acceptedKey
export async function GET(request: NextRequest) {
  const limited = await rateLimit(request, { keyPrefix: 'license-status', limit: 120, windowMs: 60_000 })
  if (limited) return limited

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
