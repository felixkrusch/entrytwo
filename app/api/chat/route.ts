import { NextRequest } from 'next/server'
import { generateText, generateObject } from 'ai'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getRecentFeedRatesPromptText } from '@/lib/recentFeedRates'
// Note: getMerchantMemoryPrompt and MemoryVault are intentionally not used here
// to avoid pre-loading everything and to prevent AgentMemory table errors
// until the user runs `npx prisma db push`.
import { getLlmConfig, createLlmModel } from '@/lib/llm'
import { getCompanyProfile } from '@/lib/companyProfile'
import { getVisibleJournalEntryIds, getVisibleJournalEntryIdsAtPoint } from '@/lib/accounting/ancestry'
import { ActionType } from '@/lib/chat/intent'
import {
  validateJournalIntent,
  validateContactIntent,
  validateInvoiceDraftIntent,
  validateRestoreTarget,
} from '@/lib/chat/validation'
import { isSafeAutonomous } from '@/lib/chat/intent'
// MemoryVault (AgentMemory) is intentionally not called from chat.
// Trillion gets the full conversation history + live ledger state every turn.
// She can reason freely and only emits structured actions when she decides to mutate data.
// All safety (lock, validation, proposals) is enforced on the server.
import { createAutonomousJournal } from '@/lib/accounting/autonomous'
import { recordCommitOnBranch } from '@/lib/accounting/commit'
import { EventType } from '@prisma/client'
import { writeFile, mkdir, readFile } from 'fs/promises'
import { join } from 'path'
import { loadOrCreateThread, appendToThread, getContextForModel, ChatTurn } from '@/lib/chatThreadStore'

/**
 * Trillion chat (proper context management).
 * - Client sends only the *new* user message + threadId.
 * - Server owns the authoritative thread (lib/chatThreadStore).
 * - On each call we send a bounded recent window to the model (not the entire history).
 * - Model reasons freely (generateText). Structured actions only when it emits valid JSON per the reference.
 * - All safety (lock, validation, master data, proposals, Git execution) stays on the server.
 */

// Extraction helper: the model now reasons freely (generateText + full history).
// When it wants to act, it emits one clean JSON action (or inside a ```json fence).
// We extract it here. Server validation + policy still apply.
function tryExtractAction(text: string): { action: ActionType; params?: any; confidence?: number; reasoning?: string } | null {
  if (!text) return null

  // 1. Fenced code block (preferred)
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence && fence[1]) {
    try {
      const obj = JSON.parse(fence[1].trim())
      if (obj && typeof obj.action === 'string') {
        const parsed = ActionType.safeParse(obj.action)
        if (parsed.success) return obj
      }
    } catch {}
  }

  // 2. First JSON object that contains an "action" field
  const jsonish = text.match(/\{[\s\S]*?"action"\s*:\s*"[^"]+"[\s\S]*?\}/)
  if (jsonish) {
    try {
      const obj = JSON.parse(jsonish[0])
      if (obj && typeof obj.action === 'string') {
        const parsed = ActionType.safeParse(obj.action)
        if (parsed.success) return obj
      }
    } catch {}
  }

  return null
}

function buildMasterSystemPrompt(ctx: {
  companyProfile: any
  chatLocked: boolean
  branch: string
  asOf?: string
  financialSnapshot?: string
  actionReference: string
}): string {
  const { companyProfile, chatLocked, branch, asOf, financialSnapshot, actionReference } = ctx

  const lockRule = chatLocked
    ? 'CHAT IS CURRENTLY LOCKED. You may discuss and propose changes, but you must NOT execute anything without explicit user confirmation. The server will force proposals when locked.'
    : 'Chat lock is open. You may autonomously execute safe actions after validation.'

  const snapshotSection = `\n\nLive ledger state (branch=${branch}${asOf ? ` asOf=${asOf}` : ''}):\n${financialSnapshot || '(no journal lines yet in this view)'}\n`

  const referenceSection = actionReference
    ? `\n\n=== ACTION REFERENCE (study this for exact shapes when you decide to act) ===\n${actionReference}\n=== END REFERENCE ===\n`
    : ''

  return `You are Trillion, the accounting companion inside entrytwo.

You are direct, practical, and maximally helpful. You have the full conversation history.

This app contains the complete financial records for the company (the "map"):
- Company profile, base currency, country/region, tax jurisdiction
- Live balances, chart of accounts, full journal history, contacts, invoices, tax rates, bank feeds, branches, and point-in-time views

Current view: branch=${branch}${asOf ? ` asOf=${asOf}` : ''}

${lockRule}
${snapshotSection}

Use the live data above for any question about this company's actual numbers, accounts, balances, transactions, or documents.

For general tax rules, laws, rates in a country, or anything that is not specific to this company's own configured records, check current external sources.

When you need to create or change records (journal, contact, invoice, etc.), output **exactly one** clean JSON action object using the shapes from the ACTION REFERENCE below. You can put it in a fenced \`\`\`json block or as plain JSON. The server will parse, validate, and respect the lock.

Otherwise just answer normally in clear text.

${referenceSection}

Bank/credit card feed rates are authoritative for FX when available.
Never mutate master data (accounts, tax rates, settings, users) from chat.
Normal conversation → normal text. Real actions → one JSON action object.
`.trim()
}

export async function POST(req: NextRequest) {
  try {
    let userMessage = ''
    let chatLocked = false
    let branch = 'main'
    let asOf: string | undefined
    let incomingThreadId: string | undefined
    let attachedFiles: Array<{ name: string; buffer: Buffer; savedPath: string; mimeType: string }> = []

    const contentType = req.headers.get('content-type') || ''

    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData()
      userMessage = (form.get('message') as string) || ''
      incomingThreadId = (form.get('threadId') as string) || undefined
      chatLocked = form.get('chatLocked') === 'true'
      branch = (form.get('branch') as string) || 'main'
      asOf = (form.get('asOf') as string) || undefined

      const files = form.getAll('file') as File[]
      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        const buf = Buffer.from(await f.arrayBuffer())
        const clientSaved = form.get(`savedPath_${i}`) as string | null
        if (clientSaved) {
          attachedFiles.push({ name: f.name, buffer: buf, savedPath: clientSaved, mimeType: f.type || 'application/pdf' })
        } else {
          const uploadsDir = join(process.cwd(), 'public', 'uploads', 'receipts')
          await mkdir(uploadsDir, { recursive: true })
          const safe = (f.name || 'doc').replace(/[^a-zA-Z0-9_.-]/g, '_')
          const fname = `${Date.now()}-${i}-${safe}`
          const disk = join(uploadsDir, fname)
          await writeFile(disk, buf)
          attachedFiles.push({
            name: f.name,
            buffer: buf,
            savedPath: `/uploads/receipts/${fname}`,
            mimeType: f.type || 'application/pdf',
          })
        }
      }
    } else {
      const jsonBody = await req.json()
      userMessage = jsonBody?.message || ''
      incomingThreadId = jsonBody?.threadId
      chatLocked = !!jsonBody?.chatLocked
      branch = jsonBody?.branch || 'main'
      asOf = jsonBody?.asOf

      // Direct approved proposal (bypass normal chat flow)
      if (jsonBody?.approvedAction && typeof jsonBody.approvedAction === 'object') {
        const approved = jsonBody.approvedAction
        return await handleApprovedAction(approved, { branch, asOf })
      }
    }

    if (!userMessage.trim() && attachedFiles.length === 0) {
      return Response.json({ response: 'No message provided.' })
    }

    const llmConfig = getLlmConfig()
    const hasKey = !!(llmConfig.apiKey || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || process.env.XAI_API_KEY)
    if (!hasKey) {
      return Response.json({ response: 'LLM not configured.' })
    }

    const model = createLlmModel(llmConfig)

    // Trillion gets the full conversation + live data every turn.
    // She reasons freely. Structured actions only when she decides to mutate.
    // Safety (lock, validation, proposals) is enforced here on the server.
    const companyProfile = await getCompanyProfile()

    // Load the single reference the model should study for exact action shapes.
    let actionReference = ''
    try {
      const refPath = join(process.cwd(), 'docs', 'LLM-Action-Reference.md')
      actionReference = await readFile(refPath, 'utf8')
    } catch {}

    // Always build live balances for the current Git view (branch + asOf).
    // This is the "map" — she reads what she needs.
    async function buildLiveBalancesSummary(b: string, point?: string): Promise<string> {
      const visibleEntryIds = point
        ? await getVisibleJournalEntryIdsAtPoint(point)
        : await getVisibleJournalEntryIds((await prisma.accountingBranch.findUnique({ where: { name: b } }))?.headEventId)

      const restrict = visibleEntryIds.length > 0
      const where: any = restrict ? { journalEntryId: { in: visibleEntryIds } } : {}

      const accounts = await prisma.account.findMany({
        orderBy: { code: 'asc' },
        include: { journalLines: { where, select: { debit: true, credit: true } } }
      })

      const lines: string[] = []
      for (const a of accounts) {
        let bal = 0
        for (const l of a.journalLines) {
          const d = Number(l.debit)
          const c = Number(l.credit)
          if (['ASSET', 'EXPENSE'].includes(a.type)) bal += d - c
          else bal += c - d
        }
        const bStr = bal.toFixed(2)
        lines.push(`${a.code} ${a.name} (${a.type}): ${bStr}`)
      }
      return lines.join('\n')
    }

    let financialSnapshot = ''
    try {
      financialSnapshot = await buildLiveBalancesSummary(branch, asOf)
    } catch {}

    const system = buildMasterSystemPrompt({
      companyProfile,
      chatLocked,
      branch,
      asOf,
      financialSnapshot: financialSnapshot || undefined,
      actionReference,
    })

    // Server owns the authoritative thread.
    // Client only ever sends the *new* user turn + threadId.
    const { thread } = loadOrCreateThread(incomingThreadId)

    // Record the new user message on the server thread.
    if (userMessage || attachedFiles.length > 0) {
      appendToThread(thread.id, {
        role: 'user',
        content: userMessage || (attachedFiles.length ? '[attachment(s)]' : '')
      })
    }

    // Build a sane context window for this LLM call.
    // Real systems do NOT send the entire ever-growing history on every request.
    const contextTurns = getContextForModel(thread, 40)

    // Prepare messages for the model.
    const llmMessages: any[] = contextTurns.map((turn, idx) => {
      const isLast = idx === contextTurns.length - 1
      const attachFilesHere = isLast && attachedFiles.length > 0 && turn.role === 'user'

      if (attachFilesHere) {
        const parts: any[] = attachedFiles.map(f =>
          f.mimeType?.startsWith('image/')
            ? { type: 'image', image: f.buffer }
            : { type: 'file', data: f.buffer, mimeType: f.mimeType }
        )
        if (turn.content) parts.push({ type: 'text', text: turn.content })
        return { role: turn.role, content: parts }
      }
      return { role: turn.role, content: turn.content || '' }
    })

    // Call the model with the windowed context.
    let assistantText = ''
    try {
      const { text } = await generateText({ model, system, messages: llmMessages })
      assistantText = text || ''
    } catch {
      assistantText = 'Chat temporarily unavailable.'
    }

    // Does the model want to perform an action?
    const extracted = tryExtractAction(assistantText)

    if (extracted && extracted.action) {
      // Persist a compact record of the decision on the thread.
      appendToThread(thread.id, {
        role: 'assistant',
        content: extracted.reasoning || `Action: ${extracted.action}`
      })

      const action = extracted.action as ActionType
      const params = extracted.params || {}
      const confidence = extracted.confidence ?? 0.8
      const reasoning = extracted.reasoning

      // Server-side policy and validation (unchanged).
      if (isMasterDataAction(action)) {
        return Response.json({
          response: 'Master data changes cannot be performed from chat.',
          proposed: true,
          action,
          params,
          threadId: thread.id,
        })
      }

      const isDestructive = ['PROPOSE_RESTORE','PROPOSE_MERGE','PROPOSE_REVERSE','PROPOSE_SEND_INVOICE','PROPOSE_CHARGE'].includes(action)

      // Validation first (needed for both proposal and execute paths)
      let validationOk = true
      let validationError: string | undefined
      let resolved: any = {}

      if (action === 'CREATE_JOURNAL') {
        const v = await validateJournalIntent(params, branch)
        validationOk = v.ok
        validationError = v.error
        if (v.resolvedLines) resolved.lines = v.resolvedLines
      } else if (action === 'CREATE_CONTACT' || action === 'UPDATE_CONTACT') {
        const v = await validateContactIntent(params)
        validationOk = v.ok
        validationError = v.error
      } else if (action === 'CREATE_INVOICE_DRAFT') {
        const v = await validateInvoiceDraftIntent(params)
        validationOk = v.ok
        validationError = v.error
        if (v.resolvedContactId) {
          resolved.contactId = v.resolvedContactId
          resolved.contactName = v.resolvedContactName
        }
      } else if (action === 'PROPOSE_RESTORE') {
        const v = await validateRestoreTarget(params.target || '', branch)
        validationOk = v.ok
        validationError = v.error
        if (v.eventId) resolved.eventId = v.eventId
      }

      const isSafe = isSafeAutonomous(action)

      // "No more babysitting":
      // Safe autonomous actions execute directly when lock is open + validation passed.
      // Only force proposal for safe actions on lock, destructive, or validation failure.
      let forceProposal = chatLocked || isDestructive || !validationOk || !isSafe

      const finalPayload = { action, params: { ...params, ...resolved }, confidence, reasoning, branch, asOf }

      if (forceProposal) {
        // Clean proposal message for the user.
        let proposalText = `I can do that as a proposal.`
        if (action === 'CREATE_CONTACT' && params?.name) {
          proposalText = `Create contact "${params.name}"?`
        } else if (action === 'CREATE_JOURNAL') {
          proposalText = `Create this journal entry?`
        }

        return Response.json({
          response: validationError
            ? `Understood. Cannot proceed automatically: ${validationError}.`
            : proposalText,
          proposed: true,
          action,
          params: finalPayload.params,
          proposedAction: finalPayload,
          understanding: reasoning,
          threadId: thread.id,
        })
      }

      // Execute directly (no proposal, no confidence gate for safe actions)
      try {
        const execResult = await executeAction(action, finalPayload.params, { branch, asOf })
        return Response.json({ ...execResult, threadId: thread.id })
      } catch (e: any) {
        return Response.json({
          response: `Execution failed: ${e?.message || e}.`,
          proposed: true,
          action,
          params: finalPayload.params,
          proposedAction: finalPayload,
          error: String(e?.message || e),
          threadId: thread.id,
        })
      }
    }

    // Normal text answer. Record it on the server thread.
    appendToThread(thread.id, { role: 'assistant', content: assistantText || 'Understood.' })

    return Response.json({
      response: assistantText || 'Understood.',
      threadId: thread.id,
    })
  } catch (e) {
    console.error('chat error', e)
    return Response.json({ response: 'Chat temporarily unavailable.' })
  }
}

// Very small set of master-data checks (kept from old intent.ts for now)
function isMasterDataAction(action: ActionType): boolean {
  return [
    'PROPOSE_CREATE_ACCOUNT',
    'PROPOSE_UPDATE_TAX_RATE',
    'PROPOSE_UPDATE_SETTINGS',
    'PROPOSE_USER_CHANGE',
  ].includes(action)
}

async function executeAction(action: ActionType, params: any, ctx: { branch: string; asOf?: string }) {
  const branch = ctx.branch || 'main'

  if (action === 'CREATE_JOURNAL') {
    const p = params
    const lines = Array.isArray(p.lines) ? p.lines : []
    if (lines.length < 2) throw new Error('Journal must have at least 2 lines')

    const resolvedLines = lines.map((l: any) => ({
      accountId: l.accountId, // already resolved by validation in the main path
      debit: l.debit || 0,
      credit: l.credit || 0,
      description: l.description,
      currency: (l.currency || 'EUR').toUpperCase(),
      fxRateToBase: l.fxRateToBase ?? null,
      fxSource: l.fxSource || 'AI_AUTONOMOUS',
      fxDate: l.fxDate || new Date().toISOString().slice(0, 10),
      taxRateId: l.taxRateId || null,
      contactId: l.contactId || null,
    }))

    const created = await createAutonomousJournal({
      date: p.date || new Date().toISOString(),
      description: p.description || 'Autonomous journal entry',
      lines: resolvedLines,
      aiMetadata: { confidence: p.confidence, reasoning: p.reasoning },
      branch,
      sourcePdfPath: p.sourcePdfPath || null,
    })

    return {
      executed: true,
      action,
      response: `Created autonomously: ${created.description || 'Journal entry'}`,
      entityId: created.id,
      branch,
      createdAutonomously: true,
    }
  }

  if (action === 'CREATE_CONTACT') {
    const p = params
    const contact = await prisma.contact.create({
      data: {
        name: p.name,
        email: p.email,
        type: p.type || 'CUSTOMER',
        phone: p.phone,
        addressStreet: p.addressStreet,
        addressCity: p.addressCity,
        addressState: p.addressState,
        addressZip: p.addressZip,
        addressCountry: p.addressCountry,
        addressLine2: p.addressLine2,
        taxId: p.taxId,
        website: p.website,
        currency: p.currency,
        notes: p.notes,
      },
    })
    await prisma.event.create({
      data: {
        eventType: EventType.CONTACT_CREATED,
        entityType: 'Contact',
        entityId: contact.id,
        payload: { name: contact.name, source: 'AI_MASTER' },
        createdBy: null,
      },
    })
    return {
      executed: true,
      action,
      response: `Created contact: ${contact.name}`,
      entityId: contact.id,
      createdAutonomously: true,
    }
  }

  if (action === 'CREATE_INVOICE_DRAFT') {
    const p = params
    let contactId = p.contactId
    if (!contactId && p.contactName) {
      const found = await prisma.contact.findFirst({ where: { name: p.contactName } })
      if (found) contactId = found.id
    }
    if (!contactId) throw new Error('Invoice requires a valid contact')

    const currency = (p.currency || 'EUR').toUpperCase()
    const lines = p.lines || [{ description: p.description, quantity: 1, unitPrice: p.amount || 0 }]
    const subtotal = lines.reduce((s: number, l: any) => s + (l.quantity || 1) * (l.unitPrice || 0), 0)

    let ar = await prisma.account.findFirst({ where: { OR: [{ code: '1100' }, { name: { contains: 'receivable', mode: 'insensitive' } }] } })
    if (!ar) ar = await prisma.account.findFirst({ where: { type: 'ASSET' } })
    let rev = await prisma.account.findFirst({ where: { OR: [{ code: '4000' }, { name: { contains: 'revenue', mode: 'insensitive' } }] } })
    if (!rev) rev = await prisma.account.findFirst({ where: { type: 'REVENUE' } })

    if (!ar || !rev) throw new Error('Required accounts for invoicing not found')

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `INV-${new Date().getFullYear()}-${Math.floor(Math.random() * 90000) + 10000}`,
        contactId,
        status: 'DRAFT',
        currency,
        subtotal,
        taxAmount: 0,
        total: subtotal,
        issueDate: new Date(),
        dueDate: new Date(Date.now() + 30 * 86400000),
        notes: p.description,
        lines: {
          create: lines.map((l: any) => ({
            description: l.description,
            quantity: l.quantity || 1,
            unitPrice: l.unitPrice,
            taxRateId: l.taxRateId || null,
            lineTotal: (l.quantity || 1) * (l.unitPrice || 0),
          })),
        },
      },
    })

    await prisma.event.create({
      data: {
        eventType: EventType.INVOICE_CREATED,
        entityType: 'Invoice',
        entityId: invoice.id,
        payload: { invoiceNumber: invoice.invoiceNumber, source: 'AI_MASTER' },
        createdBy: null,
      },
    })

    return {
      executed: true,
      action,
      response: `Created invoice draft: ${invoice.invoiceNumber}`,
      entityId: invoice.id,
      createdAutonomously: true,
    }
  }

  // For everything else we currently treat as proposal in the new architecture unless explicitly handled
  return {
    proposed: true,
    action,
    response: `Action ${action} requires confirmation or is not yet wired for direct execution.`,
    proposedAction: { type: action, params },
  }
}

async function handleApprovedAction(approved: any, ctx: { branch: string; asOf?: string }) {
  try {
    const result = await executeAction(approved.action, approved.params || {}, ctx)
    // Note: for approved actions we don't have the thread here.
    // Client will keep using its stored threadId for subsequent chat turns.
    return Response.json(result)
  } catch (e: any) {
    return Response.json({
      response: `Confirmation failed: ${e?.message || e}`,
      proposed: true,
      action: approved.action,
      params: approved.params,
    })
  }
}
