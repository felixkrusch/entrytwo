import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const settingSchema = z.object({
  key: z.string(),
  value: z.unknown(),
})

export async function GET() {
  try {
    const settings = await prisma.setting.findMany({ orderBy: { key: 'asc' } })
    return NextResponse.json(settings)
  } catch {
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const parsed = settingSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid data' }, { status: 400 })
    }

    const { key, value } = parsed.data

    const setting = await prisma.setting.upsert({
      where: { key },
      update: { value: value as import('@prisma/client').Prisma.InputJsonValue },
      create: { key, value: value as import('@prisma/client').Prisma.InputJsonValue },
    })

    await prisma.event.create({
      data: {
        eventType: 'MANUAL_ADJUSTMENT',
        entityType: 'Setting',
        entityId: setting.id,
        payload: { action: 'SETTING_UPDATED', key, value: value as import('@prisma/client').Prisma.InputJsonValue },
      },
    })

    return NextResponse.json(setting)
  } catch {
    return NextResponse.json({ error: 'Failed to save setting' }, { status: 500 })
  }
}
