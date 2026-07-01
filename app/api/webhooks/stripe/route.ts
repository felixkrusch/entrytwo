import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyStripeSignature } from '@/lib/webhook'
import type { Prisma } from '@prisma/client'

interface StripeObject {
  id: string
  created?: number
  amount?: number
  amount_total?: number
  currency?: string
  description?: string
  statement_descriptor?: string
  billing_details?: { name?: string | null }
}

export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature')
  const body = await request.text()

  // Production - verify signature
  if (process.env.STRIPE_WEBHOOK_SECRET) {
    if (!verifyStripeSignature(body, signature, process.env.STRIPE_WEBHOOK_SECRET)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }
  }

  try {
    const data = JSON.parse(body) as Record<string, unknown>
    await handleStripeEvent(data)
  } catch (error) {
    console.error('Stripe webhook error:', error)
  }

  return NextResponse.json({ received: true })
}

async function handleStripeEvent(data: Record<string, unknown>) {
  const eventType = (data as { type?: string }).type
  const eventData = (data as { data?: { object?: StripeObject } }).data?.object

  if (!eventType || !eventData) return

  const connection = await prisma.bankConnection.findFirst({
    where: { provider: 'stripe' },
  })

  // Handle invoice payments
  if (eventType === 'payment_intent.succeeded') {
    const invoiceId = (eventData as { metadata?: Record<string, string> }).metadata?.invoiceId
    if (invoiceId) {
      await prisma.invoice.update({
        where: { id: invoiceId },
        data: {
          status: 'PAID',
          paidDate: new Date(),
          stripeInvoiceId: eventData.id,
        },
      })

      // Create journal entry for the payment
      await createPaymentJournalEntry(invoiceId, Number(eventData.amount) / 100, eventData.currency || 'eur')
    }
    return
  }

  if (eventType === 'payment_intent.payment_failed') {
    const invoiceId = (eventData as { metadata?: Record<string, string> }).metadata?.invoiceId
    if (invoiceId) {
      await prisma.invoice.update({
        where: { id: invoiceId },
        data: { status: 'OVERDUE' },
      })
    }
    return
  }

  if (!connection) {
    console.warn('No Stripe connection found')
    return
  }

  // Determine amount and currency from various Stripe event types
  let amount = 0
  let currency = 'usd'

  if ('amount' in eventData && typeof eventData.amount === 'number') {
    amount = eventData.amount
  } else if ('amount_total' in eventData && typeof eventData.amount_total === 'number') {
    amount = eventData.amount_total
  }

  currency = eventData.currency || 'usd'

  await prisma.feedTransaction.create({
    data: {
      connectionId: connection.id,
      externalId: eventData.id || '',
      date: new Date(((eventData.created) || Date.now()) * 1000),
      description: eventData.description || eventData.statement_descriptor || eventType,
      merchant: eventData.billing_details?.name || eventData.description || eventType,
      amount: amount / 100,
      currency,
      rawData: { type: eventType, ...eventData } as Prisma.InputJsonValue,
      status: 'pending',
    },
  })
}

async function createPaymentJournalEntry(invoiceId: string, amount: number, currency: string) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { contact: true },
  })

  if (!invoice) return

  // Prefer standard seeded accounts
  let cashAccount = await prisma.account.findFirst({
    where: {
      OR: [
        { code: '1000' },
        { code: '1010' },
        { code: '1100' },
        { name: { contains: 'cash', mode: 'insensitive' } },
        { name: { contains: 'bank', mode: 'insensitive' } },
      ],
    },
  })
  if (!cashAccount) {
    cashAccount = await prisma.account.create({
      data: { code: '1000', name: 'Cash / Bank', type: 'ASSET' },
    })
  }

  let arAccount = await prisma.account.findFirst({
    where: {
      OR: [
        { code: '1100' },
        { name: { contains: 'receivable', mode: 'insensitive' } },
        { name: { contains: 'AR', mode: 'insensitive' } },
      ],
    },
  })
  if (!arAccount) {
    arAccount = await prisma.account.create({
      data: { code: '1100', name: 'Accounts Receivable', type: 'ASSET' },
    })
  }

  await prisma.journalEntry.create({
    data: {
      date: new Date(),
      description: `Payment for ${invoice.invoiceNumber}`,
      lines: {
        create: [
          {
            accountId: cashAccount.id,
            debit: amount,
            currency: currency.toUpperCase(),
            description: `Payment received for ${invoice.invoiceNumber}`,
          },
          {
            accountId: arAccount.id,
            credit: amount,
            contactId: invoice.contactId,
            currency: currency.toUpperCase(),
            description: `AR cleared for ${invoice.invoiceNumber}`,
          },
        ],
      },
    },
  })
}