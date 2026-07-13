import type { Prisma } from '@prisma/client'
import { sendInvoiceEmail, sendInvitationEmail } from '@/lib/email'
import { deleteExpiredThreads } from '@/lib/chatThreadStore'
import { generateRecurringJournalOccurrence } from '@/lib/accounting/recurringJobs'

type Payload = Record<string, unknown>

export async function dispatchJob(type: string, payloadValue: Prisma.JsonValue) {
  const payload = payloadValue as Payload
  if (type === 'WEBHOOK_STRIPE') {
    const { processStripeWebhook } = await import('@/app/api/webhooks/stripe/route')
    return processStripeWebhook(requiredString(payload, 'webhookEventId'))
  }
  if (type === 'WEBHOOK_PAYPAL') {
    const { processPayPalWebhook } = await import('@/app/api/webhooks/paypal/route')
    return processPayPalWebhook(requiredString(payload, 'webhookEventId'))
  }
  if (type === 'EMAIL_INVOICE') return sendInvoiceEmail({ invoiceId: requiredString(payload, 'invoiceId'), to: optionalString(payload.to), subject: optionalString(payload.subject), body: optionalString(payload.body) })
  if (type === 'EMAIL_INVITATION') return sendInvitationEmail({ email: requiredString(payload, 'email'), token: requiredString(payload, 'token'), expiresAt: requiredString(payload, 'expiresAt') })
  if (type === 'CLEANUP_CHAT_THREADS') return deleteExpiredThreads()
  if (type === 'RECURRING_JOURNAL') return generateRecurringJournalOccurrence(requiredString(payload, 'recurringId'), requiredString(payload, 'dueAt'))
  throw new Error(`Unsupported job type: ${type}`)
}

function requiredString(payload: Payload, key: string) {
  const value = payload[key]
  if (typeof value !== 'string' || !value) throw new Error(`Missing job payload field: ${key}`)
  return value
}

function optionalString(value: unknown) { return typeof value === 'string' && value ? value : undefined }
