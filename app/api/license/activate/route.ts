import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/authz'
import { verifyLicenseKey } from '@/lib/license'

export async function POST(request: Request) {
  if (!await requireUser()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const key = (body?.key || '').toString().trim()

    if (!key) {
      return NextResponse.json({ error: 'License key is required' }, { status: 400 })
    }

    const valid = await verifyLicenseKey(key)
    if (!valid) {
      return NextResponse.json({ error: 'Invalid license key' }, { status: 400 })
    }

    // Persist the accepted key
    await prisma.setting.upsert({
      where: { key: 'license.acceptedKey' },
      update: { value: { value: key } },
      create: { key: 'license.acceptedKey', value: { value: key } },
    })

    return NextResponse.json({ success: true })
  } catch (e) {
    return NextResponse.json({ error: 'Failed to activate license' }, { status: 500 })
  }
}
