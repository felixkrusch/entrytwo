import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  role: z.enum(['ADMIN', 'ACCOUNTANT', 'VIEWER']).optional(),
})

export async function GET() {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    return NextResponse.json(users)
  } catch (e) {
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const parsed = createUserSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid data' }, { status: 400 })
    }

    const { email, name, role } = parsed.data

    const user = await prisma.user.create({
      data: {
        email,
        name: name || null,
        role: role || 'ACCOUNTANT',
      },
    })

    // Audit
    await prisma.event.create({
      data: {
        eventType: 'MANUAL_ADJUSTMENT',
        entityType: 'User',
        entityId: user.id,
        payload: {
          action: 'USER_CREATED',
          email: user.email,
          role: user.role,
        },
      },
    })

    return NextResponse.json(user, { status: 201 })
  } catch (e: unknown) {
    const err = e as { code?: string }
    if (err.code === 'P2002') {
      return NextResponse.json({ error: 'Email already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 })
  }
}
