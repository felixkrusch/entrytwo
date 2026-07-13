import nodemailer from 'nodemailer'
import { prisma } from '@/lib/prisma'
import { generateInvoicePDF } from '@/lib/pdf/invoice'

function transporter() {
  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT || 587)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  if (!host || !user || !pass) throw new Error('Email not configured')
  return nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } })
}

export async function sendInvoiceEmail(input: { invoiceId: string; to?: string; subject?: string; body?: string }) {
  const invoice = await prisma.invoice.findUnique({ where: { id: input.invoiceId }, include: { contact: true } })
  if (!invoice) throw new Error('Invoice not found')
  const recipient = input.to || invoice.contact.email
  if (!recipient) throw new Error('No recipient email')
  const pdfBuffer = await generateInvoicePDF(invoice.id)
  await transporter().sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER || 'invoices@company.com', to: recipient,
    subject: input.subject || `Invoice ${invoice.invoiceNumber}`,
    text: input.body || `Please find attached invoice ${invoice.invoiceNumber}.`,
    attachments: [{ filename: `${invoice.invoiceNumber}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }],
  })
  return { sentTo: recipient }
}

export async function sendInvitationEmail(input: { email: string; token: string; expiresAt: string }) {
  const baseUrl = process.env.AUTH_URL || process.env.NEXT_PUBLIC_BASE_URL || process.env.APP_PUBLIC_URL || 'http://localhost:3000'
  if (!baseUrl) throw new Error('AUTH_URL or APP_PUBLIC_URL is required to send invitations')
  const inviteUrl = new URL('/auth/invite', baseUrl)
  inviteUrl.searchParams.set('token', input.token)
  await transporter().sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@entrytwo.local', to: input.email,
    subject: 'Your entrytwo invitation',
    text: `You have been invited to entrytwo. Accept your invitation for ${input.email} before ${new Date(input.expiresAt).toLocaleString()}:\n\n${inviteUrl}\n\nThen sign in with Google, GitHub or Microsoft using the same email address.`,
  })
}
