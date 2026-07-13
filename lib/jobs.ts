import { randomUUID } from 'crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export async function enqueueJob(type: string, idempotencyKey: string, payload: Prisma.InputJsonValue, maxAttempts = 5) {
  return prisma.durableJob.upsert({
    where: { idempotencyKey },
    create: { type, idempotencyKey, payload, maxAttempts },
    update: {},
  })
}

export async function runJob(jobId: string, handler: (payload: Prisma.JsonValue) => Promise<void>) {
  const workerId = randomUUID()
  const job = await prisma.$transaction(async tx => {
    const candidates = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "DurableJob" WHERE id = ${jobId}
        AND ((status IN ('PENDING', 'RETRY') AND "availableAt" <= NOW())
          OR (status = 'RUNNING' AND "lockedAt" < NOW() - INTERVAL '5 minutes'))
        AND ("lockedAt" IS NULL OR "lockedAt" < NOW() - INTERVAL '5 minutes')
      FOR UPDATE SKIP LOCKED
    `
    if (!candidates[0]) return null
    return tx.durableJob.update({
      where: { id: jobId },
      data: { status: 'RUNNING', lockedAt: new Date(), lockedBy: workerId, attempts: { increment: 1 } },
    })
  })
  if (!job) return null
  const attempt = await prisma.jobAttempt.create({ data: { jobId, attempt: job.attempts, workerId } })
  try {
    await handler(job.payload)
    await prisma.$transaction([
      prisma.jobAttempt.update({ where: { id: attempt.id }, data: { finishedAt: new Date() } }),
      prisma.durableJob.update({ where: { id: job.id }, data: { status: 'SUCCEEDED', completedAt: new Date(), lockedAt: null, lockedBy: null, lastError: null } }),
    ])
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 2000) : 'Unknown job error'
    const dead = job.attempts >= job.maxAttempts
    const delaySeconds = Math.min(3600, 30 * (2 ** Math.max(0, job.attempts - 1)))
    await prisma.$transaction([
      prisma.jobAttempt.update({ where: { id: attempt.id }, data: { finishedAt: new Date(), error: message } }),
      prisma.durableJob.update({ where: { id: job.id }, data: {
        status: dead ? 'DEAD_LETTER' : 'RETRY', lastError: message, lockedAt: null, lockedBy: null,
        availableAt: new Date(Date.now() + delaySeconds * 1000),
      } }),
    ])
    throw error
  }
}

export async function retryJob(jobId: string) {
  return prisma.durableJob.update({
    where: { id: jobId },
    data: { status: 'PENDING', availableAt: new Date(), lockedAt: null, lockedBy: null, lastError: null },
  })
}

export async function runAvailableJobs(handler: (job: { id: string; type: string; payload: Prisma.JsonValue }) => Promise<unknown>, limit = 20) {
  const jobs = await prisma.durableJob.findMany({
    where: {
      OR: [
        { status: { in: ['PENDING', 'RETRY'] }, availableAt: { lte: new Date() } },
        { status: 'RUNNING', lockedAt: { lt: new Date(Date.now() - 5 * 60_000) } },
      ],
    },
    orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }],
    take: Math.max(1, Math.min(limit, 100)),
    select: { id: true, type: true, payload: true },
  })
  const results = []
  for (const job of jobs) {
    try {
      const ran = await runJob(job.id, async payload => { await handler({ ...job, payload }) })
      results.push({ id: job.id, status: ran ? 'succeeded' : 'skipped' })
    } catch (error) {
      results.push({ id: job.id, status: 'failed', error: error instanceof Error ? error.message : 'Unknown error' })
    }
  }
  return results
}
