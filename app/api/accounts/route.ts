import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const createAccountSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(100),
  type: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']),
})

export async function GET() {
  try {
    const accounts = await prisma.account.findMany({
      orderBy: { code: 'asc' },
      include: {
        _count: {
          select: { journalLines: true }
        }
      }
    })
    return NextResponse.json(accounts)
  } catch (error) {
    console.error('Error fetching accounts:', error)
    return NextResponse.json(
      { error: 'Failed to fetch accounts' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const parsed = createAccountSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid account data', details: parsed.error.format() },
        { status: 400 }
      )
    }

    const { code, name, type } = parsed.data

    const existing = await prisma.account.findUnique({ where: { code } })
    if (existing) {
      return NextResponse.json({ error: 'Account code already exists' }, { status: 409 })
    }

    const account = await prisma.account.create({
      data: { code, name, type },
      include: {
        _count: { select: { journalLines: true } }
      }
    })

    await prisma.event.create({
      data: {
        eventType: 'ACCOUNT_CREATED',
        entityType: 'Account',
        entityId: account.id,
        payload: { code, name, type },
      },
    })

    return NextResponse.json(account, { status: 201 })
  } catch (error: any) {
    if (error.code === 'P2002') {
      return NextResponse.json({ error: 'Account code already exists' }, { status: 409 })
    }
    console.error('Error creating account:', error)
    return NextResponse.json({ error: 'Failed to create account' }, { status: 500 })
  }
}
