import type { Prisma } from '@prisma/client'
import { sendInvoiceEmail, sendInvitationEmail } from '@/lib/email'
import { deleteExpiredThreads } from '@/lib/chatThreadStore'
import { generateRecurringJournalOccurrence } from '@/lib/accounting/recurringJobs'
import { join } from 'path'
import { mkdir } from 'fs/promises'
import { buildBackupDirectory, BACKUP_EXTENSION } from '@/lib/backup'
import * as tar from 'tar'
import { createHash } from 'crypto'
import { stat, rm } from 'fs/promises'

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
  if (type === 'BACKUP_CREATE') return runBackupJob(payload)
  throw new Error(`Unsupported job type: ${type}`)
}

async function runBackupJob(payload: Payload) {
  const outDir = (payload.outDir as string) || join(process.cwd(), '.data', 'backups')
  await mkdir(outDir, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const contentRoot = join(outDir, `.build-${ts}`)
  const archivePath = join(outDir, `backup-${ts}${BACKUP_EXTENSION}`)
  try {
    const manifest = await buildBackupDirectory(contentRoot)
    await tar.c({ gzip: true, cwd: contentRoot, file: archivePath, portable: true }, ['manifest.json', 'data', 'receipts'])
    const size = (await stat(archivePath)).size
    const hash = createHash('sha256')
    hash.update(JSON.stringify(manifest))
    await rm(contentRoot, { recursive: true, force: true }).catch(() => {})
    return { ok: true, archive: archivePath, size, manifestHash: hash.digest('hex') }
  } catch (e) {
    await rm(contentRoot, { recursive: true, force: true }).catch(() => {})
    throw e
  }
}

function requiredString(payload: Payload, key: string) {
  const value = payload[key]
  if (typeof value !== 'string' || !value) throw new Error(`Missing job payload field: ${key}`)
  return value
}

function optionalString(value: unknown) { return typeof value === 'string' && value ? value : undefined }
