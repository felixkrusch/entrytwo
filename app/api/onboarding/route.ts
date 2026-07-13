import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { logger } from '@/lib/logger'

const accountSchema = z.object({
  code: z.string(),
  name: z.string(),
  type: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']),
})

const onboardingSchema = z.object({
  email: z.string().email(),
  name: z.string().max(100).optional(),
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
    const body = await request.json()
    const parsed = onboardingSchema.safeParse(body)
    
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid data' }, { status: 400 })
    }

    const { companyName, baseCurrency, defaultTaxJurisdiction, accounts, email, name } = parsed.data

    const user = await prisma.$transaction(async tx => {
      await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_advisory_xact_lock(hashtext('entrytwo-bootstrap')) IS NULL AS locked`
      const adminCount = await tx.user.count({ where: { role: 'ADMIN' } })
      if (adminCount > 0) throw new Error('BOOTSTRAP_COMPLETE')

      const createdUser = await tx.user.create({ data: { email, name, role: 'ADMIN' } })
      await tx.setting.upsert({ where: { key: 'companyName' }, create: { key: 'companyName', value: companyName }, update: { value: companyName } })
      await tx.setting.upsert({ where: { key: 'baseCurrency' }, create: { key: 'baseCurrency', value: baseCurrency }, update: { value: baseCurrency } })
      if (defaultTaxJurisdiction) {
        await tx.setting.upsert({
          where: { key: 'defaultTaxJurisdiction' },
          create: { key: 'defaultTaxJurisdiction', value: defaultTaxJurisdiction },
          update: { value: defaultTaxJurisdiction },
        })
      }
      for (const account of accounts || []) {
        await tx.account.upsert({
          where: { code: account.code },
          create: { code: account.code, name: account.name, type: account.type },
          update: { name: account.name, type: account.type },
        })
      }
      await tx.event.create({
        data: {
          eventType: 'SYSTEM', entityType: 'Onboarding', entityId: createdUser.id,
          payload: { action: 'ONBOARDING_COMPLETE', companyName, baseCurrency, accountCount: accounts?.length || 0 },
        },
      })
      return createdUser
    })

    return NextResponse.json({ success: true, userId: user.id })
  } catch (error) {
    if (error instanceof Error && error.message === 'BOOTSTRAP_COMPLETE') return NextResponse.json({ error: 'Bootstrap already complete' }, { status: 409 })
    logger.error('Onboarding error', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: 'Onboarding failed' }, { status: 500 })
  }
}
