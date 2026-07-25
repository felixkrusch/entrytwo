import nodemailer from 'nodemailer'
import { prisma } from '@/lib/prisma'
import { generateInvoicePDF } from '@/lib/pdf/invoice'
import { isSmtpConfigured } from '@/lib/smtp'
import { publicAuthBaseUrl } from '@/lib/env'

export { isSmtpConfigured }

function transporter() {
  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT || 587)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  if (!host || !user || !pass) throw new Error('Email not configured')
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  })
}

function fromAddress() {
  return process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@entrytwo.local'
}

function baseUrl() {
  return publicAuthBaseUrl() || 'http://localhost:3000'
}

export async function sendInvoiceEmail(input: {
  invoiceId: string
  to?: string
  subject?: string
  body?: string
}) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: input.invoiceId },
    include: { contact: true },
  })
  if (!invoice) throw new Error('Invoice not found')
  const recipient = input.to || invoice.contact.email
  if (!recipient) throw new Error('No recipient email')
  const pdfBuffer = await generateInvoicePDF(invoice.id)
  await transporter().sendMail({
    from: fromAddress(),
    to: recipient,
    subject: input.subject || `Invoice ${invoice.invoiceNumber}`,
    text: input.body || `Please find attached invoice ${invoice.invoiceNumber}.`,
    attachments: [
      {
        filename: `${invoice.invoiceNumber}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  })
  return { sentTo: recipient }
}

export async function sendInvitationEmail(input: {
  email: string
  token: string
  expiresAt: string
}) {
  const inviteUrl = new URL('/auth/invite', baseUrl())
  inviteUrl.searchParams.set('token', input.token)
  const expires = new Date(input.expiresAt).toLocaleString()
  const text = [
    'You have been invited to entrytwo.',
    '',
    `Accept your invitation for ${input.email} before ${expires}:`,
    '',
    String(inviteUrl),
    '',
    'Sign in with Google, Microsoft, or email magic link using exactly this address.',
  ].join('\n')

  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;color:#18181b">
      <h1 style="font-size:20px;margin:0 0 12px">You’re invited to entrytwo</h1>
      <p style="margin:0 0 16px;color:#52525b;font-size:14px;line-height:1.5">
        Accept your invitation for <strong>${escapeHtml(input.email)}</strong> before ${escapeHtml(expires)}.
      </p>
      <p style="margin:0 0 24px">
        <a href="${escapeAttr(String(inviteUrl))}"
           style="display:inline-block;background:#f59e0b;color:#000;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:14px">
          Accept invitation
        </a>
      </p>
      <p style="margin:0;color:#71717a;font-size:12px;line-height:1.4">
        Then sign in with Google, Microsoft, or email magic link using the same address.
        If the button does not work, paste this URL into your browser:<br/>
        <span style="word-break:break-all">${escapeHtml(String(inviteUrl))}</span>
      </p>
    </div>
  `

  await transporter().sendMail({
    from: fromAddress(),
    to: input.email,
    subject: 'Your entrytwo invitation',
    text,
    html,
  })
}

export async function sendMagicLinkEmail(input: { email: string; url: string }) {
  const text = [
    'Sign in to entrytwo',
    '',
    'Use this one-time link (expires in 30 minutes):',
    '',
    input.url,
    '',
    'If you did not request this, you can ignore this email.',
  ].join('\n')

  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;color:#18181b">
      <h1 style="font-size:20px;margin:0 0 12px">Sign in to entrytwo</h1>
      <p style="margin:0 0 16px;color:#52525b;font-size:14px;line-height:1.5">
        Click the button below to sign in as <strong>${escapeHtml(input.email)}</strong>.
        This link expires in <strong>30 minutes</strong> and can only be used once.
      </p>
      <p style="margin:0 0 24px">
        <a href="${escapeAttr(input.url)}"
           style="display:inline-block;background:#f59e0b;color:#000;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:14px">
          Sign in
        </a>
      </p>
      <p style="margin:0;color:#71717a;font-size:12px;line-height:1.4">
        If you did not request this email, ignore it. If the button does not work, paste this URL:<br/>
        <span style="word-break:break-all">${escapeHtml(input.url)}</span>
      </p>
    </div>
  `

  await transporter().sendMail({
    from: fromAddress(),
    to: input.email,
    subject: 'Your entrytwo sign-in link',
    text,
    html,
  })
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeAttr(value: string) {
  return escapeHtml(value).replace(/'/g, '&#39;')
}
