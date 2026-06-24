import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const updateUserSchema = z.object({
  role: z.enum(['ADMIN', 'ACCOUNTANT', 'VIEWER']),
})

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params
    const body = await request.json()
    const parsed = updateUserSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid data' }, { status: 400 })
    }

    const { role } = parsed.data

    const user = await prisma.user.update({
      where: { id },
      data: { role },
    })

    await prisma.event.create({
      data: {
        eventType: 'MANUAL_ADJUSTMENT',
        entityType: 'User',
        entityId: user.id,
        payload: {
          action: 'ROLE_CHANGED',
          email: user.email,
          newRole: role,
        },
      },
    })

    return NextResponse.json(user)
  } catch (e) {
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params
    const user = await prisma.user.delete({ where: { id } })

    await prisma.event.create({
      data: {
        eventType: 'MANUAL_ADJUSTMENT',
        entityType: 'User',
        entityId: id,
        payload: {
          action: 'USER_DELETED',
          email: user.email,
        },
      },
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 })
  }
}
