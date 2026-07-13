import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/authz'
import { logger } from '@/lib/logger'

// Lazy-init PayPal client
function getPayPalClient() {
  const clientId = process.env.PAYPAL_CLIENT_ID
  const secret = process.env.PAYPAL_SECRET
  
  if (!clientId || !secret) {
    throw new Error('PayPal not configured')
  }
  
  // Using fetch-based approach (simpler than SDK)
  const baseUrl = process.env.NODE_ENV === 'production' 
    ? 'https://api.paypal.com' 
    : 'https://api.sandbox.paypal.com'
    
  return { clientId, secret, baseUrl }
}

async function getPayPalAccessToken() {
  const { clientId, secret, baseUrl } = getPayPalClient()
  
  const auth = Buffer.from(`${clientId}:${secret}`).toString('base64')
  const res = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  
  const data = await res.json()
  return data.access_token
}

export async function POST(request: Request) {
  if (!await requireUser(['ADMIN', 'ACCOUNTANT'])) return NextResponse.json({ error: 'Accountant access required' }, { status: 403 })
  try {
    const { invoiceId } = await request.json()

    const { baseUrl } = getPayPalClient()
    const accessToken = await getPayPalAccessToken()

    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { 
        contact: true,
        lines: true,
      },
    })

    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    // Create PayPal invoice
    const paypalInvoice = await fetch(`${baseUrl}/v1/invoicing/invoices`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        merchant_info: {
          email: invoice.contact.email || '',
          business_name: invoice.contact.name || 'Company',
        },
        billing_info: [{
          email: invoice.contact.email,
        }],
        items: invoice.lines.map(line => ({
          name: line.description,
          quantity: Number(line.quantity),
          unit_amount: {
            currency_code: invoice.currency || 'EUR',
            value: String(line.unitPrice),
          },
        })),
        note: invoice.notes || '',
        number: invoice.invoiceNumber,
        total_amount: {
          currency_code: invoice.currency || 'EUR',
          value: String(invoice.total),
        },
      }),
    })

    const resData = await paypalInvoice.json()

    // Send the invoice
    await fetch(`${baseUrl}/v1/invoicing/invoices/${resData.invoice_id}/send`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        send_to_recipient: true,
      }),
    })

    await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        paypalInvoiceId: resData.invoice_id,
        paymentLink: resData.links?.find((l: { rel: string }) => l.rel === 'send')?.href,
      },
    })

    return NextResponse.json({ 
      invoiceId: resData.invoice_id,
      link: resData.links?.[0]?.href,
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'PayPal not configured') {
      return NextResponse.json({ error: 'PayPal not configured' }, { status: 503 })
    }
    logger.error('PayPal payment error', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: 'Failed to create PayPal invoice' }, { status: 500 })
  }
}
