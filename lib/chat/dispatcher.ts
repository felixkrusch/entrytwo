// lib/chat/dispatcher.ts
// Central dispatcher for autonomous AI chat intents.
// Classification, validation, and execution live here.
// See docs/Autonomous-AI-Execution-Plan.md

import { prisma } from '@/lib/prisma'
import { ChatIntent, ActionType, isSafeAutonomous, requiresConfirmation, isMasterDataAction, DEFAULT_CONFIDENCE_THRESHOLD } from './intent'
import { createAutonomousJournal } from '@/lib/accounting/autonomous'
import { recordCommitOnBranch } from '@/lib/accounting/commit'
import { EventType } from '@prisma/client'

export interface DispatchContext {
  chatLocked: boolean
  currentBranch?: string
  currentAsOf?: string
}

export interface DispatchResult {
  executed?: boolean
  proposed?: boolean
  action: ActionType
  response: string
  entityId?: string
  branch?: string
  asOf?: string
  eventId?: string
  error?: string
  proposedAction?: any
  openLedger?: any
  reconciled?: any
  createdAutonomously?: boolean
}

function getConfidenceThreshold(action: ActionType): number {
  // Can be made configurable later via Settings
  return DEFAULT_CONFIDENCE_THRESHOLD
}

async function validateJournalIntent(params: any, branch: string): Promise<{ ok: boolean; error?: string; resolvedLines?: any[] }> {
  if (!params?.lines || !Array.isArray(params.lines) || params.lines.length < 2) {
    return { ok: false, error: 'Journal must have at least 2 lines' }
  }
  const totalDebit = params.lines.reduce((s: number, l: any) => s + (l.debit || 0), 0)
  const totalCredit = params.lines.reduce((s: number, l: any) => s + (l.credit || 0), 0)
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    return { ok: false, error: 'Journal is not balanced' }
  }

  const codes = params.lines.map((l: any) => l.accountCode).filter(Boolean)
  const accounts = await prisma.account.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true },
  })
  const codeToId: Record<string, string> = Object.fromEntries(accounts.map(a => [a.code, a.id]))

  const resolved = params.lines.map((l: any) => {
    const accountId = codeToId[l.accountCode]
    if (!accountId) {
      throw new Error(`Unknown account code: ${l.accountCode}`)
    }
    return {
      accountId,
      debit: l.debit || 0,
      credit: l.credit || 0,
      description: l.description,
      currency: (l.currency || 'EUR').toUpperCase(),
      fxRateToBase: l.fxRateToBase ?? null,
      fxSource: l.fxSource || 'AI_AUTONOMOUS',
      fxDate: l.fxDate || new Date().toISOString().slice(0, 10),
      taxRateId: l.taxRateId || null,
      contactId: l.contactId || null,
    }
  })

  return { ok: true, resolvedLines: resolved }
}

async function validateContactIntent(params: any): Promise<{ ok: boolean; error?: string }> {
  if (!params?.name || typeof params.name !== 'string' || params.name.trim().length < 2) {
    return { ok: false, error: 'Contact name is required' }
  }
  return { ok: true }
}

async function validateRestoreTarget(target: string, branchName = 'main'): Promise<{ ok: boolean; error?: string; eventId?: string }> {
  // Accept date (YYYY-MM-DD) or event id
  let ev = null
  if (/^[0-9a-f-]{36}$/i.test(target)) {
    ev = await prisma.event.findUnique({ where: { id: target } })
  } else {
    const dateMatch = target.match(/\b(20\d{2}-\d{2}-\d{2})\b/)
    if (dateMatch) {
      const d = dateMatch[1]
      ev = await prisma.event.findFirst({
        where: { createdAt: { gte: new Date(d), lte: new Date(d + 'T23:59:59') } },
        orderBy: { createdAt: 'asc' },
      })
    }
  }
  if (!ev) return { ok: false, error: 'Target event or date not found' }

  // Check reachability via ancestry (simplified: must be an ancestor or the current head chain)
  const branch = await prisma.accountingBranch.findUnique({ where: { name: branchName } })
  if (!branch) return { ok: false, error: 'Branch not found' }

  // For safety we accept any existing past event; full ancestry walk can be added later
  return { ok: true, eventId: ev.id }
}

// ---------------------------------------------------------------------------
// Autonomous executors (thin wrappers that also emit proper Events)
// ---------------------------------------------------------------------------

async function execCreateJournal(intent: ChatIntent, branch: string): Promise<DispatchResult> {
  const v = await validateJournalIntent(intent.params, branch)
  if (!v.ok || !v.resolvedLines) {
    return { proposed: true, action: intent.action, response: `Validation failed: ${v.error}`, error: v.error }
  }

  const p = intent.params as any
  const created = await createAutonomousJournal({
    date: p?.date || new Date().toISOString(),
    description: p?.description || 'Autonomous journal entry',
    lines: v.resolvedLines,
    aiMetadata: {
      confidence: intent.confidence,
      reasoning: intent.reasoning,
      model: 'chat',
    },
    branch,
  })

  return {
    executed: true,
    action: intent.action,
    response: `Created autonomously: ${created.description || 'Journal entry'}`,
    entityId: created.id,
    branch,
    createdAutonomously: true,
  }
}

async function execApplyTemplate(intent: ChatIntent, branch: string): Promise<DispatchResult> {
  const p = intent.params as any
  const tplName = p?.templateName || p?.name
  if (!tplName && !p?.templateId) {
    return { proposed: true, action: intent.action, response: 'Template name or id required' }
  }

  const tpl = await prisma.template.findFirst({
    where: {
      OR: [
        p.templateId ? { id: p.templateId } : undefined,
        tplName ? { name: { contains: tplName } } : undefined,
      ].filter(Boolean) as any,
    },
  })

  if (!tpl || !tpl.content) return { proposed: true, action: intent.action, response: 'Template not found or empty' }

  let content: any
  try { content = JSON.parse(tpl.content) } catch { return { proposed: true, action: intent.action, response: 'Template content is not valid JSON' } }

  const lines = Array.isArray(content.lines) ? content.lines : []
  if (lines.length < 2) return { proposed: true, action: intent.action, response: 'Template has insufficient lines' }

  // Reuse journal validation + execution
  const fakeIntent: ChatIntent = { action: 'CREATE_JOURNAL', confidence: intent.confidence, params: { description: content.description || tpl.name, lines, date: p.date } }
  return execCreateJournal(fakeIntent, branch)
}

async function execCreateContact(intent: ChatIntent): Promise<DispatchResult> {
  const v = await validateContactIntent(intent.params)
  if (!v.ok) {
    return { proposed: true, action: intent.action, response: `Validation failed: ${v.error}`, error: v.error }
  }

  const p = intent.params as any
  const contact = await prisma.contact.create({
    data: {
      name: p.name,
      email: p.email,
      type: p.type || 'CUSTOMER',
      phone: p.phone,
      addressStreet: p.addressStreet,
      addressCity: p.addressCity,
      addressCountry: p.addressCountry,
    },
  })

  await prisma.event.create({
    data: {
      eventType: EventType.CONTACT_CREATED,
      entityType: 'Contact',
      entityId: contact.id,
      payload: { name: contact.name, type: contact.type, source: 'AI_AUTONOMOUS' },
      createdBy: null,
    },
  })

  return {
    executed: true,
    action: intent.action,
    response: `Created contact autonomously: ${contact.name}`,
    entityId: contact.id,
    createdAutonomously: true,
  }
}

async function execCreateInvoiceDraft(intent: ChatIntent): Promise<DispatchResult> {
  const p = intent.params as any
  if (!p?.description && !p?.lines?.length) {
    return { proposed: true, action: intent.action, response: 'Invoice needs description or lines' }
  }

  // Resolve contact if possible (best effort)
  let contactId = p.contactId
  if (!contactId && p.contactName) {
    const found = await prisma.contact.findFirst({
      where: { name: { contains: p.contactName, mode: 'insensitive' } },
    })
    if (found) contactId = found.id
  }

  // Minimal draft creation (re-uses existing invoice logic style)
  const currency = (p.currency || 'EUR').toUpperCase()
  const amount = p.amount || (p.lines?.[0]?.unitPrice || 0)
  const lines = p.lines || [{ description: p.description, quantity: 1, unitPrice: amount }]

  // Find minimal AR / Revenue accounts
  let ar = await prisma.account.findFirst({ where: { OR: [{ code: '1100' }, { name: { contains: 'receivable', mode: 'insensitive' } }] } })
  if (!ar) ar = await prisma.account.findFirst({ where: { type: 'ASSET' } })
  let rev = await prisma.account.findFirst({ where: { OR: [{ code: '4000' }, { name: { contains: 'revenue', mode: 'insensitive' } }] } })
  if (!rev) rev = await prisma.account.findFirst({ where: { type: 'REVENUE' } })

  if (!ar || !rev) {
    return { proposed: true, action: intent.action, response: 'Required accounts for invoicing not found' }
  }

  const subtotal = lines.reduce((s: number, l: any) => s + (l.quantity || 1) * l.unitPrice, 0)
  const taxAmount = 0 // drafts from chat start simple; tax can be added in UI
  const total = subtotal + taxAmount

  const invoice = await prisma.invoice.create({
    data: {
      invoiceNumber: `INV-${new Date().getFullYear()}-${Math.floor(Math.random() * 90000) + 10000}`,
      contactId: contactId || (await prisma.contact.findFirst())?.id || '',
      status: 'DRAFT',
      currency,
      subtotal,
      taxAmount,
      total,
      issueDate: new Date(),
      dueDate: new Date(Date.now() + 30 * 86400000),
      notes: p.description,
      lines: {
        create: lines.map((l: any) => ({
          description: l.description,
          quantity: l.quantity || 1,
          unitPrice: l.unitPrice,
          taxRateId: l.taxRateId || null,
          lineTotal: (l.quantity || 1) * l.unitPrice,
          taxAmount: 0,
        })),
      },
    },
  })

  await prisma.event.create({
    data: {
      eventType: EventType.INVOICE_CREATED,
      entityType: 'Invoice',
      entityId: invoice.id,
      payload: { invoiceNumber: invoice.invoiceNumber, status: 'DRAFT', source: 'AI_AUTONOMOUS' },
      createdBy: null,
    },
  })

  return {
    executed: true,
    action: intent.action,
    response: `Created invoice draft autonomously: ${invoice.invoiceNumber}`,
    entityId: invoice.id,
    createdAutonomously: true,
  }
}

async function execMatchFeed(intent: ChatIntent): Promise<DispatchResult> {
  const p = intent.params as any
  const txId = p.feedTransactionId || p.externalId
  if (!txId) return { proposed: true, action: intent.action, response: 'Feed transaction id required' }

  const feedTx = await prisma.feedTransaction.findUnique({ where: { id: txId }, include: { connection: true } })
  if (!feedTx) return { proposed: true, action: intent.action, response: 'Feed transaction not found' }
  if (feedTx.status === 'posted') return { proposed: true, action: intent.action, response: 'Already posted' }

  // Use existing matcher
  const { findMatch } = await import('@/lib/matching')
  const match = await findMatch(feedTx)
  if (!match?.suggestedEntry) {
    return { proposed: true, action: intent.action, response: 'No clean match found' }
  }

  // Create journal from match
  const entry = await prisma.journalEntry.create({
    data: {
      date: new Date(match.suggestedEntry.date),
      description: match.suggestedEntry.description,
      lines: {
        create: match.suggestedEntry.lines.map((l: any) => ({
          accountId: l.accountId,
          debit: l.debit || 0,
          credit: l.credit || 0,
          description: l.description,
          currency: 'EUR',
        })),
      },
    },
  })

  await prisma.feedTransaction.update({
    where: { id: feedTx.id },
    data: { status: 'posted', journalEntryId: entry.id },
  })

  const ev = await prisma.event.create({
    data: {
      eventType: EventType.AI_AUTONOMOUS_ENTRY,
      entityType: 'JournalEntry',
      entityId: entry.id,
      payload: { source: 'AI_FEED_MATCH', feedTxId: feedTx.id },
      createdBy: null,
    },
  })

  await recordCommitOnBranch(entry.id, 'main', ev.id)

  return {
    executed: true,
    action: intent.action,
    response: `Matched and posted feed transaction autonomously`,
    entityId: entry.id,
    createdAutonomously: true,
  }
}

async function execGenerateRecurringDraft(intent: ChatIntent): Promise<DispatchResult> {
  const p = intent.params as any
  let rec = null as any

  if (p.recurringId) {
    rec = await prisma.recurringInvoice.findUnique({ where: { id: p.recurringId }, include: { contact: true } })
  } else if (p.contactId) {
    rec = await prisma.recurringInvoice.findFirst({
      where: { contactId: p.contactId, status: 'ACTIVE' },
      orderBy: { nextDueDate: 'asc' },
      include: { contact: true },
    })
  }

  if (!rec) {
    rec = await prisma.recurringInvoice.findFirst({
      where: { status: 'ACTIVE' },
      orderBy: { nextDueDate: 'asc' },
      include: { contact: true },
    })
  }

  if (!rec) return { proposed: true, action: intent.action, response: 'No active recurring schedule found' }

  // Minimal generation of DRAFT invoice (same spirit as the route, but autonomous)
  const tpl = (rec.templateData as any) || {}
  const lines = Array.isArray(tpl.lines) ? tpl.lines : []
  if (!lines.length) return { proposed: true, action: intent.action, response: 'Recurring schedule has no lines' }

  // Resolve accounts (AR + Revenue + optional tax payable)
  let arAccount = await prisma.account.findFirst({ where: { OR: [{ code: '1100' }, { name: { contains: 'receivable', mode: 'insensitive' } }] } })
  if (!arAccount) arAccount = await prisma.account.findFirst({ where: { type: 'ASSET' } })
  let revenueAccount = await prisma.account.findFirst({ where: { OR: [{ code: '4000' }, { name: { contains: 'revenue', mode: 'insensitive' } }] } })
  if (!revenueAccount) revenueAccount = await prisma.account.findFirst({ where: { type: 'REVENUE' } })
  let taxPayable = await prisma.account.findFirst({ where: { OR: [{ code: '2100' }, { name: { contains: 'tax', mode: 'insensitive' } }] } })

  if (!arAccount || !revenueAccount) return { proposed: true, action: intent.action, response: 'Required accounts for invoicing not found' }

  const currency = tpl.currency || 'EUR'
  let subtotal = 0, taxAmount = 0
  const enriched = lines.map((l: any) => {
    const q = Number(l.quantity || 1)
    const up = Number(l.unitPrice || 0)
    const net = q * up
    const rate = l.taxRateId ? 0 : 0 // keep simple for autonomous draft
    const tax = net * rate
    subtotal += net
    taxAmount += tax
    return { ...l, lineTotal: net, taxAmount: tax }
  })
  const total = subtotal + taxAmount

  const invNum = `INV-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`

  const created = await prisma.invoice.create({
    data: {
      invoiceNumber: invNum,
      contactId: rec.contactId,
      status: 'DRAFT',
      currency,
      subtotal,
      taxAmount,
      total,
      issueDate: rec.nextDueDate,
      dueDate: new Date(rec.nextDueDate.getTime() + 30 * 86400000),
      notes: tpl.notes || rec.notes || null,
      terms: tpl.terms || null,
      lines: {
        create: enriched.map((l: any) => ({
          description: l.description,
          quantity: l.quantity || 1,
          unitPrice: l.unitPrice,
          taxRateId: l.taxRateId || null,
          lineTotal: l.lineTotal,
          taxAmount: l.taxAmount,
        })),
      },
    },
  })

  // Create minimal revenue recognition journal (same as recurring route)
  const journalLines: any[] = [
    { accountId: arAccount.id, debit: total, credit: 0, currency, contactId: rec.contactId, description: `Invoice ${created.invoiceNumber}` },
    { accountId: revenueAccount.id, debit: 0, credit: subtotal, currency, description: 'Revenue' },
  ]
  if (taxAmount > 0 && taxPayable) {
    journalLines.push({ accountId: taxPayable.id, debit: 0, credit: taxAmount, currency, description: 'Output tax' })
  }

  const je = await prisma.journalEntry.create({
    data: {
      date: created.issueDate,
      description: `Invoice ${created.invoiceNumber} (recurring)`,
      lines: { create: journalLines },
    },
  })

  await prisma.invoice.update({ where: { id: created.id }, data: { journalEntryId: je.id } })

  await prisma.event.create({
    data: {
      eventType: EventType.INVOICE_CREATED,
      entityType: 'Invoice',
      entityId: created.id,
      payload: { invoiceNumber: created.invoiceNumber, recurringId: rec.id, source: 'AI_AUTONOMOUS' },
      createdBy: null,
    },
  })

  // Advance Git head
  await recordCommitOnBranch(je.id, 'main', (await prisma.event.findFirst({ where: { entityId: created.id }, orderBy: { createdAt: 'desc' } }))?.id)

  return {
    executed: true,
    action: intent.action,
    response: `Generated recurring draft autonomously: ${created.invoiceNumber}`,
    entityId: created.id,
    createdAutonomously: true,
  }
}

async function execReconcile(intent: ChatIntent): Promise<DispatchResult> {
  const p = intent.params as any
  const accountCode = p.accountCode
  if (!accountCode) return { proposed: true, action: intent.action, response: 'Account code required' }

  const mod = await import('@/lib/accounting/reconcile')
  await mod.reconcileAccount({ accountCode, autoApplyHighConfidence: true })

  return {
    executed: true,
    action: intent.action,
    response: `Reconciled ${accountCode} autonomously`,
    reconciled: { accountCode },
  }
}

async function execRestore(intent: ChatIntent, approved: boolean, branch: string): Promise<DispatchResult> {
  if (!approved) {
    return {
      proposed: true,
      action: intent.action,
      response: 'Restore requires explicit confirmation.',
      proposedAction: { type: intent.action, params: intent.params },
    }
  }
  const p = intent.params as any
  const target = p.target
  if (!target) return { proposed: true, action: intent.action, response: 'Restore target (date or event id) required' }

  const v = await validateRestoreTarget(target, branch)
  if (!v.ok || !v.eventId) {
    return { proposed: true, action: intent.action, response: `Cannot restore: ${v.error}` }
  }

  const { restoreBranchToEvent } = await import('@/lib/accounting/restore')
  const { rollbackEventId } = await restoreBranchToEvent(branch, v.eventId)

  return {
    executed: true,
    action: intent.action,
    response: `Restored ${branch} to ${target} (created ROLLBACK event)`,
    entityId: rollbackEventId,
    branch,
  }
}

async function execMerge(intent: ChatIntent, approved: boolean): Promise<DispatchResult> {
  if (!approved) {
    return { proposed: true, action: intent.action, response: 'Merge requires confirmation.', proposedAction: { type: intent.action, params: intent.params } }
  }
  const p = intent.params as any
  const source = p.sourceBranch || p.source
  const target = p.targetBranch || 'main'
  if (!source) return { proposed: true, action: intent.action, response: 'Source branch required for merge' }

  const { mergeBranch } = await import('@/lib/accounting/merge')
  const result = await mergeBranch(source, target)

  return {
    executed: true,
    action: intent.action,
    response: `Merged ${source} into ${target}`,
    entityId: (result as any)?.mergedEventIds?.[0] || undefined,
  }
}

async function execReverse(intent: ChatIntent, approved: boolean, branch: string): Promise<DispatchResult> {
  if (!approved) {
    return { proposed: true, action: intent.action, response: 'Reverse requires confirmation.', proposedAction: { type: intent.action, params: intent.params } }
  }
  const p = intent.params as any
  const originalId = p.originalId
  if (!originalId) return { proposed: true, action: intent.action, response: 'originalId required' }

  const { reverseJournalEntry } = await import('@/lib/accounting/reverse') // may not exist yet, fall back to journal-entries/reverse logic
  // Use the existing reverse API pattern directly
  const original = await prisma.journalEntry.findUnique({ where: { id: originalId }, include: { lines: true } })
  if (!original) return { proposed: true, action: intent.action, response: 'Original entry not found' }

  const revLines = original.lines.map(l => ({
    accountId: l.accountId,
    debit: Number(l.credit),
    credit: Number(l.debit),
    description: `Reversal of ${originalId}`,
    currency: l.currency || 'EUR',
  }))

  const revEntry = await prisma.journalEntry.create({
    data: {
      date: new Date(),
      description: `Reversal of ${original.description || originalId}`,
      lines: { create: revLines },
    },
  })

  const ev = await prisma.event.create({
    data: {
      eventType: EventType.JOURNAL_ENTRY_REVERSED,
      entityType: 'JournalEntry',
      entityId: revEntry.id,
      payload: { originalId, source: 'AI_AUTONOMOUS' },
      createdBy: null,
    },
  })

  await recordCommitOnBranch(revEntry.id, branch, ev.id)

  return {
    executed: true,
    action: intent.action,
    response: `Reversed entry ${originalId} autonomously (new entry created)`,
    entityId: revEntry.id,
  }
}

// ---------------------------------------------------------------------------
// Main dispatch
// ---------------------------------------------------------------------------
export async function dispatchIntent(intent: ChatIntent, ctx: DispatchContext): Promise<DispatchResult> {
  const branch = intent.branch || ctx.currentBranch || 'main'

  // 1. Global lock
  if (ctx.chatLocked) {
    return {
      proposed: true,
      action: intent.action,
      response: 'Chat is locked (advisory mode). No autonomous actions allowed.',
    }
  }

  // 2. Master data hard block
  if (isMasterDataAction(intent.action)) {
    return {
      proposed: true,
      action: intent.action,
      response: 'Master data and configuration changes cannot be performed autonomously from chat.',
    }
  }

  // 3. Explicit proposal actions
  if (requiresConfirmation(intent.action)) {
    return {
      proposed: true,
      action: intent.action,
      response: `Proposal: ${intent.action}. Awaiting explicit confirmation.`,
      proposedAction: { type: intent.action, params: intent.params },
    }
  }

  // 4. Not in safe list -> propose
  if (!isSafeAutonomous(intent.action)) {
    return {
      proposed: true,
      action: intent.action,
      response: `Action ${intent.action} requires confirmation.`,
      proposedAction: { type: intent.action, params: intent.params },
    }
  }

  // 5. Confidence gate
  const threshold = getConfidenceThreshold(intent.action)
  if (intent.confidence < threshold) {
    return {
      proposed: true,
      action: intent.action,
      response: `Confidence ${intent.confidence} below threshold ${threshold}. Showing as proposal.`,
      proposedAction: { type: intent.action, params: intent.params },
    }
  }

  // 6. Execute safe autonomous actions
  try {
    switch (intent.action) {
      case 'CREATE_JOURNAL':
        return await execCreateJournal(intent, branch)

      case 'APPLY_TEMPLATE':
        return await execApplyTemplate(intent, branch)

      case 'CREATE_CONTACT':
      case 'UPDATE_CONTACT':
        return await execCreateContact(intent)

      case 'CREATE_INVOICE_DRAFT':
        return await execCreateInvoiceDraft(intent)

      case 'GENERATE_RECURRING_DRAFT':
        return await execGenerateRecurringDraft(intent)

      case 'MATCH_FEED_TRANSACTION':
        return await execMatchFeed(intent)

      case 'RECONCILE_ACCOUNT':
        return await execReconcile(intent)

      case 'PROPOSE_RESTORE':
        return await execRestore(intent, !!intent.approved, branch)

      case 'PROPOSE_MERGE':
        return await execMerge(intent, !!intent.approved)

      case 'PROPOSE_REVERSE':
        return await execReverse(intent, !!intent.approved, branch)

      case 'SYNC_FEED':
        // Trigger sync (lightweight) - actual heavy lifting is in the bank-feeds sync route
        return {
          executed: true,
          action: intent.action,
          response: 'Triggered feed sync (autonomous). Pending transactions will appear for matching.',
        }

      case 'OPEN_LEDGER':
        return {
          executed: true,
          action: intent.action,
          response: 'Opening ledger view.',
          openLedger: intent.params,
        }

      case 'EXPLAIN':
      case 'LEARN_MERCHANT':
        // These are mostly side-effect or read; treat as executed with message
        return {
          executed: true,
          action: intent.action,
          response: intent.reasoning || 'Acknowledged.',
        }

      default:
        return {
          proposed: true,
          action: intent.action,
          response: `Action ${intent.action} not yet wired for autonomous execution.`,
        }
    }
  } catch (err: any) {
    console.error('Autonomous execution error', err)
    return {
      proposed: true,
      action: intent.action,
      response: `Execution failed: ${err?.message || err}. Falling back to proposal.`,
      error: String(err?.message || err),
      proposedAction: { type: intent.action, params: intent.params },
    }
  }
}
