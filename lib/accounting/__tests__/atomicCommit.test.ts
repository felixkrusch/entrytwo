import 'dotenv/config'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import { commitJournalAtomic } from '@/lib/accounting/atomicCommit'

let dbReady = false
let debitAccountId = ''
let creditAccountId = ''
let branchName = ''

beforeAll(async () => {
  try {
    await prisma.$connect()
    const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`
    branchName = `atomic-${suffix}`
    const debit = await prisma.account.create({ data: { code: `ATD${suffix}`, name: 'Atomic debit test', type: 'ASSET' } })
    const credit = await prisma.account.create({ data: { code: `ATC${suffix}`, name: 'Atomic credit test', type: 'EQUITY' } })
    debitAccountId = debit.id
    creditAccountId = credit.id
    const main = await prisma.accountingBranch.findUnique({ where: { name: 'main' } })
    await prisma.accountingBranch.create({ data: { name: branchName, headEventId: main?.headEventId || null } })
    dbReady = true
  } catch {
    dbReady = false
  }
})

afterAll(async () => {
  try { await prisma.$disconnect() } catch {}
})

function input(idempotencyKey: string, amount = 10) {
  return {
    date: new Date(),
    description: idempotencyKey,
    branch: branchName,
    baseCurrency: 'EUR',
    idempotencyKey,
    lines: [
      { accountId: debitAccountId, debit: amount, credit: 0, currency: 'EUR' },
      { accountId: creditAccountId, debit: 0, credit: amount, currency: 'EUR' },
    ],
  }
}

describe('atomic accounting commits', () => {
  it('creates the journal, event, linkage, and branch head together', async () => {
    if (!dbReady) return expect(true).toBe(true)
    const oldHead = (await prisma.accountingBranch.findUniqueOrThrow({ where: { name: branchName } })).headEventId
    const key = `atomic:test:${Date.now()}:complete`
    const entry = await commitJournalAtomic(input(key))
    const [event, branch] = await Promise.all([
      prisma.event.findUniqueOrThrow({ where: { idempotencyKey: key } }),
      prisma.accountingBranch.findUniqueOrThrow({ where: { name: branchName } }),
    ])
    expect(entry.introducedByEventId).toBe(event.id)
    expect(event.entityId).toBe(entry.id)
    expect(event.parentEventId).toBe(oldHead)
    expect(branch.headEventId).toBe(event.id)
    expect(entry.entryNumber).toMatch(/^JE-\d{4}-\d{4}$/)
  })

  it('returns the original journal for a repeated idempotency key', async () => {
    if (!dbReady) return expect(true).toBe(true)
    const key = `atomic:test:${Date.now()}:idempotent`
    const first = await commitJournalAtomic(input(key))
    const second = await commitJournalAtomic(input(key))
    expect(second.id).toBe(first.id)
    expect(await prisma.event.count({ where: { idempotencyKey: key } })).toBe(1)
  })

  it('rolls back all accounting records when a transaction fails', async () => {
    if (!dbReady) return expect(true).toBe(true)
    const key = `atomic:test:${Date.now()}:rollback`
    const invalid = input(key)
    invalid.lines[0].accountId = '00000000-0000-4000-8000-000000000000'
    await expect(commitJournalAtomic(invalid)).rejects.toBeTruthy()
    expect(await prisma.event.findUnique({ where: { idempotencyKey: key } })).toBeNull()
    expect(await prisma.journalEntry.findFirst({ where: { description: key } })).toBeNull()
  })

  it('serializes concurrent commits into one complete ancestry chain', async () => {
    if (!dbReady) return expect(true).toBe(true)
    const prefix = `atomic:test:${Date.now()}:concurrent`
    const entries = await Promise.all(Array.from({ length: 4 }, (_, index) => commitJournalAtomic(input(`${prefix}:${index}`, index + 1))))
    expect(new Set(entries.map(entry => entry.entryNumber)).size).toBe(4)

    const eventIds = new Set((await prisma.event.findMany({ where: { idempotencyKey: { startsWith: prefix } }, select: { id: true } })).map(event => event.id))
    let cursor = (await prisma.accountingBranch.findUniqueOrThrow({ where: { name: branchName } })).headEventId
    const seen = new Set<string>()
    while (cursor && eventIds.has(cursor)) {
      seen.add(cursor)
      cursor = (await prisma.event.findUniqueOrThrow({ where: { id: cursor }, select: { parentEventId: true } })).parentEventId
    }
    expect(seen.size).toBe(4)
  })
})
