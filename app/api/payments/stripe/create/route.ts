import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import Stripe from 'stripe'
import { requireUser } from '@/lib/authz'

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('Stripe not configured')
  }
  return new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2026-06-24.dahlia',
  })
}

export async function POST(request: Request) {
  if (!await requireUser(['ADMIN', 'ACCOUNTANT'])) return NextResponse.json({ error: 'Accountant access required' }, { status: 403 })
  try {
    const { invoiceId } = await request.json()

    const stripe = getStripe()

    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { contact: true },
    })

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(Number(invoice.total) * 100),
      currency: (invoice.currency || 'eur').toLowerCase(),
      metadata: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        contactId: invoice.contactId,
      },
    })

    await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        paymentLink: paymentIntent.client_secret || undefined,
      },
    })

    return NextResponse.json({ 
      clientSecret: paymentIntent.client_secret,
      id: paymentIntent.id,
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'Stripe not configured') {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 })
    }
    console.error('Stripe payment error:', error)
    return NextResponse.json({ error: 'Failed to create payment' }, { status: 500 })
  }
}
