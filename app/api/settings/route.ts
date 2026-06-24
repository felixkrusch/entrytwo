import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const settingSchema = z.object({
  key: z.string(),
  value: z.any(),
})

export async function GET() {
  try {
    const settings = await prisma.setting.findMany({ orderBy: { key: 'asc' } })
    return NextResponse.json(settings)
  } catch (e) {
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
      update: { value: value as any },
      create: { key, value: value as any },
    })

    await prisma.event.create({
      data: {
        eventType: 'MANUAL_ADJUSTMENT',
        entityType: 'Setting',
        entityId: setting.id,
        payload: { action: 'SETTING_UPDATED', key, value },
      },
    })

    return NextResponse.json(setting)
  } catch (e) {
    return NextResponse.json({ error: 'Failed to save setting' }, { status: 500 })
  }
}
