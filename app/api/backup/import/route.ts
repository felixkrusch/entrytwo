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
        contactId?: string
      }>
    }>
contacts?: Array<{
       name: string
       email?: string
       type: string
       phone?: string
       addressStreet?: string
       addressCity?: string
       addressState?: string
       addressZip?: string
       addressCountry?: string
       addressLine2?: string
       taxId?: string
       website?: string
       currency?: string
       notes?: string
     }>
    settings?: Array<{ key: string; value: unknown }>
templates?: Array<{ name: string; description?: string; content?: string; isInvoiceTemplate?: boolean }>
    invoices?: Array<{
      invoiceNumber: string
      contactId: string
      status: string
      currency: string
      subtotal: number
      taxAmount: number
      total: number
      issueDate: string
      dueDate: string
      paidDate?: string
      notes?: string
      terms?: string
    }>
    }
}

const asJson = (v: unknown): Prisma.InputJsonValue => v as Prisma.InputJsonValue

export async function POST(request: Request) {
  try {
    const body = await request.json() as BackupData
    const data = body.data

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

    for (const contact of data.contacts || []) {
      const existing = await prisma.contact.findFirst({ where: { name: contact.name } })
      if (existing) {
        await prisma.contact.update({
          where: { id: existing.id },
          data: {
            email: contact.email,
            type: contact.type,
            phone: contact.phone,
            addressStreet: contact.addressStreet,
            addressCity: contact.addressCity,
            addressState: contact.addressState,
            addressZip: contact.addressZip,
            addressCountry: contact.addressCountry,
            addressLine2: contact.addressLine2,
            taxId: contact.taxId,
            website: contact.website,
            currency: contact.currency,
            notes: contact.notes,
          },
        })
      } else {
        await prisma.contact.create({
          data: {
            name: contact.name,
            email: contact.email,
            type: contact.type,
            phone: contact.phone,
            addressStreet: contact.addressStreet,
            addressCity: contact.addressCity,
            addressState: contact.addressState,
            addressZip: contact.addressZip,
            addressCountry: contact.addressCountry,
            addressLine2: contact.addressLine2,
            taxId: contact.taxId,
            website: contact.website,
            currency: contact.currency,
            notes: contact.notes,
          },
        })
      }
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
              contactId: line.contactId,
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
           content: typeof template.content === 'string' ? template.content : JSON.stringify(template.content || {}),
           isInvoiceTemplate: template.isInvoiceTemplate || false,
         },
       })
     }

    for (const invoice of data.invoices || []) {
       await prisma.invoice.create({
         data: {
           invoiceNumber: invoice.invoiceNumber,
           contactId: invoice.contactId,
           status: invoice.status as 'DRAFT' | 'SENT' | 'PAID' | 'OVERDUE' | 'CANCELLED',
           currency: invoice.currency,
           subtotal: invoice.subtotal,
           taxAmount: invoice.taxAmount,
           total: invoice.total,
           issueDate: new Date(invoice.issueDate),
           dueDate: new Date(invoice.dueDate),
           paidDate: invoice.paidDate ? new Date(invoice.paidDate) : undefined,
           notes: invoice.notes,
           terms: invoice.terms,
         },
       })
     }

    return NextResponse.json({ ok: true, imported: {
      accounts: data.accounts?.length || 0,
      taxRates: data.taxRates?.length || 0,
      journalEntries: data.journalEntries?.length || 0,
      contacts: data.contacts?.length || 0,
      settings: data.settings?.length || 0,
      templates: data.templates?.length || 0,
      invoices: data.invoices?.length || 0,
    } })
  } catch (error) {
    console.error('Import error:', error)
    return NextResponse.json({ error: 'Failed to import backup' }, { status: 500 })
  }
}