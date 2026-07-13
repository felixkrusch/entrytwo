import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateInvoicePDF } from '@/lib/pdf/invoice'
import nodemailer from 'nodemailer'
import { requireUser } from '@/lib/authz'

function getTransporter() {
  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT || 587)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS

  if (!host || !user || !pass) {
    throw new Error('Email not configured')
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!await requireUser(['ADMIN', 'ACCOUNTANT'])) return NextResponse.json({ error: 'Accountant access required' }, { status: 403 })
  const { id } = await params
  try {
    const { to, subject, body } = await request.json().catch(() => ({} as { to?: string; subject?: string; body?: string }))

    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: { contact: true },
    })
    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const pdfBuffer = await generateInvoicePDF(id)
    const transporter = getTransporter()

    const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'invoices@company.com'
    const recipient = to || invoice.contact.email

    if (!recipient) {
      return NextResponse.json({ error: 'No recipient email' }, { status: 400 })
    }

    await transporter.sendMail({
      from,
      to: recipient,
      subject: subject || `Invoice ${invoice.invoiceNumber}`,
      text: body || `Please find attached invoice ${invoice.invoiceNumber}.`,
      attachments: [
        {
          filename: `${invoice.invoiceNumber}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      ],
    })

    // Do NOT auto-mark SENT here. Email is delivery only.
    // User must explicitly use "Mark Sent" when the invoice has been delivered.

    return NextResponse.json({ success: true, sentTo: recipient })
  } catch (error: unknown) {
    const err = error as { message?: string }
    if (err?.message === 'Email not configured') {
      return NextResponse.json({ error: 'Email not configured (set SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM)' }, { status: 503 })
    }
    console.error('Email send error:', error)
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 })
  }
}
