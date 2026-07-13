import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/authz'
import { enqueueJob } from '@/lib/jobs'

export async function POST() {
  if (!await requireUser(['ADMIN', 'ACCOUNTANT'])) return NextResponse.json({ error: 'Accountant access required' }, { status: 403 })
  const due = await prisma.recurringJournalEntry.findMany({
    where: { status: 'ACTIVE', nextDueDate: { lte: new Date() } },
    select: { id: true, nextDueDate: true },
  })
  const jobs = await Promise.all(due.map(rec => enqueueJob(
    'RECURRING_JOURNAL', `job:recurring-journal:${rec.id}:${rec.nextDueDate.toISOString()}`,
    { recurringId: rec.id, dueAt: rec.nextDueDate.toISOString() },
  )))
  return NextResponse.json({ queued: jobs.length, jobIds: jobs.map(job => job.id) }, { status: 202 })
}
