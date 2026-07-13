import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/authz'
import { enqueueJob } from '@/lib/jobs'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!await requireUser(['ADMIN', 'ACCOUNTANT'])) return NextResponse.json({ error: 'Accountant access required' }, { status: 403 })
  const { id } = await params
  try {
    const { to, subject, body } = await request.json().catch(() => ({} as { to?: string; subject?: string; body?: string }))

    const job = await enqueueJob('EMAIL_INVOICE', `invoice-email:${id}:${crypto.randomUUID()}`, { invoiceId: id, to, subject, body })
    return NextResponse.json({ success: true, queued: true, jobId: job.id }, { status: 202 })
  } catch (error: unknown) {
    const err = error as { message?: string }
    if (err?.message === 'Email not configured') {
      return NextResponse.json({ error: 'Email not configured (set SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM)' }, { status: 503 })
    }
    console.error('Email send error:', error)
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 })
  }
}
