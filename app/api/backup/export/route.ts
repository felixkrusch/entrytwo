import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const [accounts, taxRates, journalEntries, events, settings, templates] = await Promise.all([
      prisma.account.findMany({ select: { id: true, code: true, name: true, type: true, description: true, createdAt: true, updatedAt: true } }),
      prisma.taxRate.findMany({ select: { id: true, jurisdiction: true, name: true, rate: true, taxType: true, effectiveFrom: true, effectiveTo: true, createdAt: true } }),
      prisma.journalEntry.findMany({
        include: {
          lines: {
            select: {
              accountId: true,
              debit: true,
              credit: true,
              description: true,
              taxRateId: true,
              taxIsInput: true,
              currency: true,
              fxRateToBase: true,
              fxSource: true,
              account: { select: { code: true } },
              taxRate: { select: { id: true, jurisdiction: true, name: true } },
            },
          },
        },
      }),
      prisma.event.findMany({ select: { id: true, eventType: true, entityType: true, entityId: true, payload: true, createdAt: true, createdBy: true } }),
      prisma.setting.findMany({ select: { id: true, key: true, value: true, createdAt: true, updatedAt: true } }),
      prisma.template.findMany({ select: { id: true, name: true, description: true, lines: true, createdAt: true, updatedAt: true }, orderBy: { createdAt: 'desc' } }),
    ])

    const toPlain = (val: unknown) => {
      if (val && typeof val === 'object' && 'toNumber' in val && typeof (val as { toNumber: () => number }).toNumber === 'function') {
        return (val as { toNumber: () => number }).toNumber()
      }
      return val
    }

    const serialize = (obj: unknown): unknown => {
      if (Array.isArray(obj)) return obj.map(serialize)
      if (obj && typeof obj === 'object') {
        const result: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(obj)) {
          result[k] = serialize(v)
        }
        return result
      }
      return toPlain(obj)
    }

    const exportData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      data: {
        accounts: serialize(accounts),
        taxRates: serialize(taxRates),
        journalEntries: serialize(journalEntries),
        events: serialize(events),
        settings: serialize(settings),
        templates: serialize(templates),
      },
    }

    return NextResponse.json(exportData)
  } catch (error) {
    console.error('Export error:', error)
    return NextResponse.json({ error: 'Failed to export data' }, { status: 500 })
  }
}