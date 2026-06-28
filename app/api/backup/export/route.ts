import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const entitiesParam = url.searchParams.get('entities')
    const requestedEntities = entitiesParam 
      ? entitiesParam.split(',') as Array<'accounts' | 'taxRates' | 'journalEntries' | 'contacts' | 'templates' | 'settings'>
      : ['accounts', 'taxRates', 'journalEntries', 'contacts', 'templates', 'settings']

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

    const data: Record<string, unknown> = {}

    if (requestedEntities.includes('accounts')) {
      const accounts = await prisma.account.findMany({
        select: { id: true, code: true, name: true, type: true, description: true, createdAt: true, updatedAt: true }
      })
      data.accounts = serialize(accounts)
    }

    if (requestedEntities.includes('taxRates')) {
      const taxRates = await prisma.taxRate.findMany({
        select: { id: true, jurisdiction: true, name: true, rate: true, taxType: true, effectiveFrom: true, effectiveTo: true, createdAt: true }
      })
      data.taxRates = serialize(taxRates)
    }

    if (requestedEntities.includes('journalEntries')) {
      const journalEntries = await prisma.journalEntry.findMany({
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
              contactId: true,
              account: { select: { code: true } },
              taxRate: { select: { id: true, jurisdiction: true, name: true } },
            },
          },
        },
      })
      data.journalEntries = serialize(journalEntries)
    }

    if (requestedEntities.includes('contacts')) {
      const contacts = await prisma.contact.findMany({
        select: { id: true, name: true, email: true, type: true, phone: true, addressStreet: true, addressCity: true, addressState: true, addressZip: true, addressCountry: true, addressLine2: true, taxId: true, website: true, currency: true, notes: true, vatValidated: true, vatValidatedAt: true, createdAt: true, updatedAt: true }
      })
      data.contacts = serialize(contacts)
    }

if (requestedEntities.includes('templates')) {
       const templates = await prisma.template.findMany({
         select: { id: true, name: true, description: true, content: true, isInvoiceTemplate: true, createdAt: true, updatedAt: true },
         orderBy: { createdAt: 'desc' }
       })
       data.templates = serialize(templates)
     }

    if (requestedEntities.includes('settings')) {
      const settings = await prisma.setting.findMany({
        select: { id: true, key: true, value: true, createdAt: true, updatedAt: true }
      })
      data.settings = serialize(settings)
    }

    const exportData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      data,
    }

    return NextResponse.json(exportData)
  } catch (error) {
    console.error('Export error:', error)
    return NextResponse.json({ error: 'Failed to export data' }, { status: 500 })
  }
}