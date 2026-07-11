import { Prisma, type Role } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getCompanyProfile } from '@/lib/companyProfile'
import { ensureMainBranch } from '@/lib/accounting/branch'

export const claimLineInputSchema = z.object({
  id: z.string().uuid().optional(),
  expenseDate: z.string().min(1),
  merchant: z.string().trim().max(200).optional().nullable(),
  description: z.string().trim().min(1).max(500),
  accountId: z.string().uuid(),
  grossAmount: z.coerce.number().positive(),
  netAmount: z.coerce.number().nonnegative().optional().nullable(),
  taxAmount: z.coerce.number().nonnegative().optional().nullable(),
  currency: z.string().trim().length(3).transform(value => value.toUpperCase()),
  fxRateToBase: z.coerce.number().positive().optional().nullable(),
  fxSource: z.string().trim().max(1000).optional().nullable(),
  fxDate: z.string().optional().nullable(),
  taxRateId: z.string().uuid().optional().nullable(),
  taxIsInput: z.boolean().default(true),
  paymentMethod: z.enum(['PERSONAL_FUNDS', 'COMPANY_CARD', 'CASH_ADVANCE', 'OTHER']).default('PERSONAL_FUNDS'),
  notes: z.string().trim().max(1000).optional().nullable(),
  receiptIds: z.array(z.string().uuid()).default([]),
})

export const claimInputSchema = z.object({
  claimantUserId: z.string().uuid(),
  title: z.string().trim().min(2).max(200),
  purpose: z.string().trim().max(2000).optional().nullable(),
  reimbursementAccountId: z.string().uuid().optional().nullable(),
  lines: z.array(claimLineInputSchema).default([]),
})

export type ClaimActor = { id: string; role: Role }

export const claimInclude = {
  claimant: { select: { id: true, name: true, email: true } },
  approvedBy: { select: { id: true, name: true, email: true } },
  postedBy: { select: { id: true, name: true, email: true } },
  reimbursementAccount: { select: { id: true, code: true, name: true, type: true } },
  postedJournalEntry: { select: { id: true, entryNumber: true } },
  lines: {
    orderBy: { position: 'asc' as const },
    include: {
      account: { select: { id: true, code: true, name: true, type: true } },
      taxRate: { select: { id: true, name: true, rate: true, jurisdiction: true } },
      receipts: { select: { claimReceiptId: true } },
    },
  },
  receipts: { orderBy: { createdAt: 'asc' as const } },
  approvals: {
    orderBy: { createdAt: 'desc' as const },
    include: { approver: { select: { id: true, name: true, email: true } } },
  },
  activities: {
    orderBy: { createdAt: 'desc' as const },
    include: { actor: { select: { id: true, name: true, email: true } } },
  },
} satisfies Prisma.ExpenseClaimInclude

export function canViewClaim(actor: ClaimActor, claimantUserId: string) {
  return actor.id === claimantUserId || actor.role === 'ADMIN' || actor.role === 'ACCOUNTANT'
}

export function canEditClaim(actor: ClaimActor, claimantUserId: string) {
  return actor.id === claimantUserId || actor.role === 'ADMIN' || actor.role === 'ACCOUNTANT'
}

export function canApproveClaim(actor: ClaimActor, claimantUserId: string) {
  if (actor.role === 'ADMIN') return true
  return actor.role === 'ACCOUNTANT' && actor.id !== claimantUserId
}

async function nextClaimNumber(tx: Prisma.TransactionClient) {
  const year = new Date().getUTCFullYear()
  const prefix = `CLM-${year}-`
  const latest = await tx.expenseClaim.findFirst({
    where: { claimNumber: { startsWith: prefix } },
    orderBy: { claimNumber: 'desc' },
    select: { claimNumber: true },
  })
  const next = latest ? Number(latest.claimNumber.slice(prefix.length)) + 1 : 1
  return `${prefix}${String(next).padStart(4, '0')}`
}

async function nextJournalNumber(tx: Prisma.TransactionClient, date: Date) {
  const year = date.getUTCFullYear()
  const prefix = `JE-${year}-`
  const latest = await tx.journalEntry.findFirst({ where: { entryNumber: { startsWith: prefix } }, orderBy: { entryNumber: 'desc' }, select: { entryNumber: true } })
  const next = latest?.entryNumber ? Number(latest.entryNumber.slice(prefix.length)) + 1 : 1
  return `${prefix}${String(Number.isFinite(next) ? next : 1).padStart(4, '0')}`
}

function normalizeDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('Invalid expense date')
  date.setUTCHours(0, 0, 0, 0)
  return date
}

async function resolveLines(lines: z.infer<typeof claimLineInputSchema>[], baseCurrency: string) {
  const accountIds = [...new Set(lines.map(line => line.accountId))]
  const accounts = await prisma.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, type: true } })
  if (accounts.length !== accountIds.length) throw new Error('One or more expense accounts were not found')
  if (accounts.some(account => account.type !== 'EXPENSE')) throw new Error('Claim lines must use expense accounts')

  return lines.map((line, index) => {
    const currency = line.currency.toUpperCase()
    const rate = currency === baseCurrency ? 1 : line.fxRateToBase
    if (!rate || rate <= 0) throw new Error(`A positive FX rate is required for ${currency}`)
    if (currency !== baseCurrency && !line.fxSource) throw new Error(`An FX source is required for ${currency}`)
    const baseAmount = Math.round(line.grossAmount * rate * 100) / 100
    return {
      position: index + 1,
      expenseDate: normalizeDate(line.expenseDate),
      merchant: line.merchant || null,
      description: line.description,
      accountId: line.accountId,
      grossAmount: line.grossAmount,
      netAmount: line.netAmount ?? null,
      taxAmount: line.taxAmount ?? null,
      currency,
      fxRateToBase: rate,
      fxSource: currency === baseCurrency ? 'BASE_CURRENCY' : line.fxSource,
      fxDate: line.fxDate ? normalizeDate(line.fxDate) : normalizeDate(line.expenseDate),
      baseAmount,
      taxRateId: line.taxRateId || null,
      taxIsInput: line.taxIsInput,
      paymentMethod: line.paymentMethod,
      notes: line.notes || null,
      receiptIds: line.receiptIds,
    }
  })
}

export async function createExpenseClaim(input: unknown, actor: ClaimActor) {
  const parsed = claimInputSchema.parse(input)
  if (parsed.claimantUserId !== actor.id && actor.role !== 'ADMIN' && actor.role !== 'ACCOUNTANT') throw new Error('Not allowed to create a claim for another user')
  const claimant = await prisma.user.findUnique({ where: { id: parsed.claimantUserId }, select: { id: true } })
  if (!claimant) throw new Error('Claimant not found')
  const baseCurrency = (await getCompanyProfile()).baseCurrency.toUpperCase()
  const lines = await resolveLines(parsed.lines, baseCurrency)
  const totalBaseAmount = lines.reduce((sum, line) => sum + line.baseAmount, 0)

  return prisma.$transaction(async tx => {
    await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_advisory_xact_lock(hashtext('expense-claim-number')) IS NULL AS locked`
    const claimNumber = await nextClaimNumber(tx)
    const claim = await tx.expenseClaim.create({
      data: {
        claimNumber,
        claimantUserId: parsed.claimantUserId,
        title: parsed.title,
        purpose: parsed.purpose || null,
        baseCurrency,
        totalBaseAmount,
        reimbursementAccountId: parsed.reimbursementAccountId || null,
        lines: {
          create: lines.map(item => {
            const { receiptIds, ...line } = item
            void receiptIds
            return line
          }),
        },
      },
      include: { lines: true },
    })
    for (const [index, line] of lines.entries()) {
      const createdLine = claim.lines[index]
      if (line.receiptIds.length) {
        const owned = await tx.expenseClaimReceipt.count({ where: { id: { in: line.receiptIds }, claimId: claim.id } })
        if (owned !== line.receiptIds.length) throw new Error('A receipt does not belong to this claim')
        await tx.expenseClaimLineReceipt.createMany({ data: line.receiptIds.map(claimReceiptId => ({ claimLineId: createdLine.id, claimReceiptId })) })
      }
    }
    await tx.expenseClaimActivity.create({ data: { claimId: claim.id, actorUserId: actor.id, revision: claim.revision, action: 'CREATED' } })
    return tx.expenseClaim.findUniqueOrThrow({ where: { id: claim.id }, include: claimInclude })
  })
}

export async function updateExpenseClaim(id: string, input: unknown, expectedRevision: number, actor: ClaimActor) {
  const parsed = claimInputSchema.parse(input)
  const current = await prisma.expenseClaim.findUnique({ where: { id }, select: { claimantUserId: true, workflowStatus: true, revision: true, postingStatus: true, baseCurrency: true } })
  if (!current || !canEditClaim(actor, current.claimantUserId)) throw new Error('Claim not found')
  if (parsed.claimantUserId !== current.claimantUserId && actor.role !== 'ADMIN' && actor.role !== 'ACCOUNTANT') throw new Error('Only an accountant or admin may change the claimant')
  if (current.postingStatus !== 'UNPOSTED' || current.workflowStatus === 'APPROVED') throw new Error('Approved or posted claims cannot be edited')
  if (current.revision !== expectedRevision) throw new Error('REVISION_CONFLICT')
  const lines = await resolveLines(parsed.lines, current.baseCurrency)
  const totalBaseAmount = lines.reduce((sum, line) => sum + line.baseAmount, 0)
  const nextRevision = current.revision + 1

  return prisma.$transaction(async tx => {
    const changed = await tx.expenseClaim.updateMany({
      where: { id, revision: expectedRevision },
      data: {
        claimantUserId: parsed.claimantUserId,
        title: parsed.title,
        purpose: parsed.purpose || null,
        reimbursementAccountId: parsed.reimbursementAccountId || null,
        totalBaseAmount,
        revision: nextRevision,
        workflowStatus: 'DRAFT',
        submittedAt: null,
        approvedAt: null,
        approvedByUserId: null,
        approvedRevision: null,
        reimbursementStatus: 'NOT_READY',
      },
    })
    if (changed.count !== 1) throw new Error('REVISION_CONFLICT')
    await tx.expenseClaimLine.deleteMany({ where: { claimId: id } })
    for (const line of lines) {
      const { receiptIds, ...data } = line
      const created = await tx.expenseClaimLine.create({ data: { claimId: id, ...data } })
      if (receiptIds.length) {
        const owned = await tx.expenseClaimReceipt.count({ where: { id: { in: receiptIds }, claimId: id } })
        if (owned !== receiptIds.length) throw new Error('A receipt does not belong to this claim')
        await tx.expenseClaimLineReceipt.createMany({ data: receiptIds.map(claimReceiptId => ({ claimLineId: created.id, claimReceiptId })) })
      }
    }
    await tx.expenseClaimActivity.create({ data: { claimId: id, actorUserId: actor.id, revision: nextRevision, action: current.workflowStatus === 'SUBMITTED' ? 'REOPENED' : 'UPDATED' } })
    return tx.expenseClaim.findUniqueOrThrow({ where: { id }, include: claimInclude })
  })
}

export async function transitionExpenseClaim(id: string, action: 'submit' | 'approve' | 'request-changes' | 'reject', actor: ClaimActor, comment?: string) {
  return prisma.$transaction(async tx => {
    const claim = await tx.expenseClaim.findUnique({ where: { id }, include: { lines: true, receipts: true } })
    if (!claim || !canViewClaim(actor, claim.claimantUserId)) throw new Error('Claim not found')

    if (action === 'submit') {
      if (!canEditClaim(actor, claim.claimantUserId) || !['DRAFT', 'CHANGES_REQUESTED', 'REJECTED'].includes(claim.workflowStatus)) throw new Error('Claim cannot be submitted')
      if (!claim.lines.length) throw new Error('Add at least one expense line before submitting')
      if (!claim.receipts.length) throw new Error('Attach at least one receipt before submitting')
      if (!claim.reimbursementAccountId && claim.lines.some(line => line.paymentMethod === 'PERSONAL_FUNDS')) throw new Error('Select an employee reimbursement payable account')
      await tx.expenseClaim.update({ where: { id }, data: { workflowStatus: 'SUBMITTED', submittedAt: new Date() } })
      await tx.expenseClaimActivity.create({ data: { claimId: id, actorUserId: actor.id, revision: claim.revision, action: 'SUBMITTED', comment } })
    } else {
      if (claim.workflowStatus !== 'SUBMITTED') throw new Error('Only submitted claims can be reviewed')
      if (!canApproveClaim(actor, claim.claimantUserId)) throw new Error('Only an accountant or admin may review this claim; admins may self-approve')
      const decision = action === 'approve' ? 'APPROVED' : action === 'reject' ? 'REJECTED' : 'CHANGES_REQUESTED'
      if (decision !== 'APPROVED' && !comment?.trim()) throw new Error('A comment is required')
      await tx.expenseClaimApproval.create({ data: { claimId: id, revision: claim.revision, approverUserId: actor.id, decision, comment: comment || null } })
      await tx.expenseClaim.update({
        where: { id },
        data: decision === 'APPROVED'
          ? { workflowStatus: 'APPROVED', approvedRevision: claim.revision, approvedAt: new Date(), approvedByUserId: actor.id, reimbursementStatus: 'READY' }
          : { workflowStatus: decision, approvedRevision: null, approvedAt: null, approvedByUserId: null, reimbursementStatus: 'NOT_READY' },
      })
      await tx.expenseClaimActivity.create({ data: { claimId: id, actorUserId: actor.id, revision: claim.revision, action: decision, comment } })
    }
    return tx.expenseClaim.findUniqueOrThrow({ where: { id }, include: claimInclude })
  })
}

export async function postExpenseClaim(id: string, actor: ClaimActor, branchName = 'main') {
  if (actor.role !== 'ADMIN' && actor.role !== 'ACCOUNTANT') throw new Error('Accountant access required')
  await ensureMainBranch()
  const claim = await prisma.expenseClaim.findUnique({ where: { id }, include: { lines: { include: { account: true } }, receipts: true, reimbursementAccount: true } })
  if (!claim) throw new Error('Claim not found')
  if (claim.workflowStatus !== 'APPROVED' || claim.approvedRevision !== claim.revision) throw new Error('The current claim revision is not approved')
  if (claim.postingStatus === 'POSTED') return prisma.expenseClaim.findUniqueOrThrow({ where: { id }, include: claimInclude })
  if (!claim.reimbursementAccount || claim.reimbursementAccount.type !== 'LIABILITY') throw new Error('A liability reimbursement account is required')
  if (!claim.lines.length || Number(claim.totalBaseAmount) <= 0) throw new Error('Claim has no postable lines')

  return prisma.$transaction(async tx => {
    await tx.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_advisory_xact_lock(hashtext('journal-entry-number')) IS NULL AS locked`
    const entryNumber = await nextJournalNumber(tx, new Date())
    const locked = await tx.expenseClaim.findUniqueOrThrow({ where: { id }, select: { postingStatus: true, revision: true, approvedRevision: true } })
    if (locked.postingStatus === 'POSTED') return tx.expenseClaim.findUniqueOrThrow({ where: { id }, include: claimInclude })
    if (locked.revision !== locked.approvedRevision) throw new Error('Claim changed after approval')
    const branch = await tx.accountingBranch.findUnique({ where: { name: branchName } })
    if (!branch) throw new Error('Accounting branch not found')
    const entry = await tx.journalEntry.create({
      data: {
        date: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())),
        description: `${claim.claimNumber}: ${claim.title}`,
        entryNumber,
        createdBy: actor.id,
        sourcePdfPath: claim.receipts[0] ? `/api/expense-claims/files/${claim.receipts[0].id}` : null,
        attachments: claim.receipts.length ? {
          create: claim.receipts.map(receipt => ({
            path: `/api/expense-claims/files/${receipt.id}`,
            originalName: receipt.originalName,
            mimeType: receipt.mimeType,
            size: receipt.size,
            sha256: receipt.sha256,
            source: 'expense-claim',
            createdBy: actor.id,
          })),
        } : undefined,
        lines: {
          create: [
            ...claim.lines.map(line => ({
              accountId: line.accountId,
              debit: line.baseAmount,
              credit: 0,
              description: [line.merchant, line.description].filter(Boolean).join(' - '),
              taxRateId: line.taxRateId,
              taxIsInput: line.taxIsInput,
              currency: claim.baseCurrency,
              fxRateToBase: 1,
              fxSource: 'CLAIM_APPROVED',
              fxDate: line.expenseDate,
              cleared: false,
            })),
            {
              accountId: claim.reimbursementAccount!.id,
              debit: 0,
              credit: claim.totalBaseAmount,
              description: `Payable to claimant for ${claim.claimNumber}`,
              currency: claim.baseCurrency,
              fxRateToBase: 1,
              fxSource: 'CLAIM_APPROVED',
              fxDate: new Date(),
              cleared: false,
            },
          ],
        },
      },
    })
    const event = await tx.event.create({
      data: {
        eventType: 'JOURNAL_ENTRY_CREATED',
        entityType: 'JournalEntry',
        entityId: entry.id,
        parentEventId: branch.headEventId,
        createdBy: actor.id,
        payload: { claimId: claim.id, claimNumber: claim.claimNumber, revision: claim.revision, totalBaseAmount: Number(claim.totalBaseAmount) },
      },
    })
    await tx.journalEntry.update({ where: { id: entry.id }, data: { introducedByEventId: event.id } })
    await tx.accountingBranch.update({ where: { name: branchName }, data: { headEventId: event.id } })
    await tx.expenseClaim.update({ where: { id }, data: { postingStatus: 'POSTED', postedAt: new Date(), postedByUserId: actor.id, postedJournalEntryId: entry.id } })
    await tx.expenseClaimActivity.create({ data: { claimId: id, actorUserId: actor.id, revision: claim.revision, action: 'POSTED', payload: { journalEntryId: entry.id, eventId: event.id, branch: branchName } } })
    return tx.expenseClaim.findUniqueOrThrow({ where: { id }, include: claimInclude })
  })
}
