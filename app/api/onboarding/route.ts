import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const accountSchema = z.object({
  code: z.string(),
  name: z.string(),
  type: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']),
})

const onboardingSchema = z.object({
  companyName: z.string().min(1),
  baseCurrency: z.string().length(3),
  defaultTaxJurisdiction: z.string().optional(),
  accounts: z.array(accountSchema).optional(),
})

export async function GET() {
  const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } })
  const settings = await prisma.setting.findMany({
    where: { key: { in: ['companyName', 'baseCurrency', 'defaultTaxJurisdiction'] } },
  })
  
  const config = Object.fromEntries(
    settings.map(s => [s.key, s.value])
  )
  
  const defaultAccounts = await prisma.account.findMany({
    orderBy: { code: 'asc' },
    select: { code: true, name: true, type: true },
  })

  return NextResponse.json({
    needsBootstrap: adminCount === 0,
    config: {
      companyName: config.companyName?.toString() || '',
      baseCurrency: config.baseCurrency?.toString() || 'USD',
      defaultTaxJurisdiction: config.defaultTaxJurisdiction?.toString() || '',
    },
    accounts: defaultAccounts,
  })
}

export async function POST(request: Request) {
  try {
    const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } })
    if (adminCount > 0) {
      return NextResponse.json({ error: 'Bootstrap already complete' }, { status: 400 })
    }

    const body = await request.json()
    const parsed = onboardingSchema.safeParse(body)
    
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid data' }, { status: 400 })
    }

    const { companyName, baseCurrency, defaultTaxJurisdiction, accounts } = parsed.data
    const { email, name } = body

    const user = await prisma.user.create({
      data: { email, name, role: 'ADMIN' },
    })

    await prisma.setting.upsert({
      where: { key: 'companyName' },
      create: { key: 'companyName', value: companyName },
      update: { value: companyName },
    })

    await prisma.setting.upsert({
      where: { key: 'baseCurrency' },
      create: { key: 'baseCurrency', value: baseCurrency },
      update: { value: baseCurrency },
    })

    if (defaultTaxJurisdiction) {
      await prisma.setting.upsert({
        where: { key: 'defaultTaxJurisdiction' },
        create: { key: 'defaultTaxJurisdiction', value: defaultTaxJurisdiction },
        update: { value: defaultTaxJurisdiction },
      })
    }

    if (accounts && accounts.length > 0) {
      for (const acc of accounts) {
        await prisma.account.upsert({
          where: { code: acc.code },
          create: {
            code: acc.code,
            name: acc.name,
            type: acc.type,
          },
          update: {
            name: acc.name,
            type: acc.type,
          },
        })
      }
    }

    await prisma.event.create({
      data: {
        eventType: 'SYSTEM',
        entityType: 'Onboarding',
        entityId: user.id,
        payload: {
          action: 'ONBOARDING_COMPLETE',
          companyName,
          baseCurrency,
          accountCount: accounts?.length || 0,
        },
      },
    })

    return NextResponse.json({ success: true, userId: user.id })
  } catch (error) {
    console.error('Onboarding error:', error)
    return NextResponse.json({ error: 'Onboarding failed' }, { status: 500 })
  }
}