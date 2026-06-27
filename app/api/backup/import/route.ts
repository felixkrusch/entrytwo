import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

interface BackupData {
  version?: string
  exportedAt?: string
  data: {
    accounts?: Array<{ code: string; name: string; type: string; description?: string }>
    taxRates?: Array<{ jurisdiction: string; name: string; rate: number; taxType: string }>
    journalEntries?: Array<{
      date: string
      description?: string
      lines: Array<{
        accountId: string
        debit: number
        credit: number
        description?: string
        taxRateId?: string
        taxIsInput?: boolean
        currency?: string
        fxRateToBase?: number
        fxSource?: string
        fxDate?: string
      }>
    }>
    settings?: Array<{ key: string; value: unknown }>
    templates?: Array<{ name: string; description?: string; lines: unknown }>
  }
}

const asJson = (v: unknown): Prisma.InputJsonValue => v as Prisma.InputJsonValue

export async function POST(request: Request) {
  try {
    const body = await request.json() as BackupData
    const data = body.data

    // Import in order to respect foreign keys
    for (const account of data.accounts || []) {
      await prisma.account.upsert({
        where: { code: account.code },
        update: { name: account.name, type: account.type as 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE' },
        create: {
          code: account.code,
          name: account.name,
          type: account.type as 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE',
          description: account.description,
        },
      })
    }

    for (const tax of data.taxRates || []) {
      await prisma.taxRate.upsert({
        where: { id: tax.jurisdiction + '-' + tax.name },
        update: { rate: tax.rate, taxType: tax.taxType },
        create: {
          id: crypto.randomUUID(),
          jurisdiction: tax.jurisdiction,
          name: tax.name,
          rate: tax.rate,
          taxType: tax.taxType,
        },
      })
    }

    for (const journal of data.journalEntries || []) {
      await prisma.journalEntry.create({
        data: {
          date: new Date(journal.date),
          description: journal.description,
          lines: {
            create: journal.lines.map((line) => ({
              accountId: line.accountId,
              debit: line.debit,
              credit: line.credit,
              description: line.description,
              taxRateId: line.taxRateId,
              taxIsInput: line.taxIsInput,
              currency: line.currency || 'EUR',
              fxRateToBase: line.fxRateToBase,
              fxSource: line.fxSource,
            })),
          },
        },
      })
    }

    for (const setting of data.settings || []) {
      await prisma.setting.upsert({
        where: { key: setting.key },
        update: { value: asJson(setting.value) },
        create: {
          key: setting.key,
          value: asJson(setting.value),
        },
      })
    }

    for (const template of data.templates || []) {
      await prisma.template.create({
        data: {
          name: template.name,
          description: template.description || '',
          lines: asJson(template.lines),
        },
      })
    }

    return NextResponse.json({ ok: true, imported: {
      accounts: data.accounts?.length || 0,
      taxRates: data.taxRates?.length || 0,
      journalEntries: data.journalEntries?.length || 0,
      settings: data.settings?.length || 0,
      templates: data.templates?.length || 0,
    } })
  } catch (error) {
    console.error('Import error:', error)
    return NextResponse.json({ error: 'Failed to import backup' }, { status: 500 })
  }
}