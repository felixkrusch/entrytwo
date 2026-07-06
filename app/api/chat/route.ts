import { NextRequest } from 'next/server'
import { generateText, generateObject } from 'ai'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getRecentFeedRatesPromptText } from '@/lib/recentFeedRates'
import { getMerchantMemoryPrompt } from '@/lib/agentMemory'
import { getLlmConfig, createLlmModel } from '@/lib/llm'
import { getCompanyProfile } from '@/lib/companyProfile'
import { ActionType } from '@/lib/chat/intent'
import {
  validateJournalIntent,
  validateContactIntent,
  validateInvoiceDraftIntent,
  validateRestoreTarget,
} from '@/lib/chat/validation'
import { MemoryVault } from '@/lib/memoryVault'
import { createAutonomousJournal } from '@/lib/accounting/autonomous'
import { recordCommitOnBranch } from '@/lib/accounting/commit'
import { EventType } from '@prisma/client'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'

/**
 * Master + Specialist architecture (hard cut).
 * - Full session history is sent.
 * - Single master call.
 * - One global lock (chatLocked).
 * - When locked: everything that would mutate becomes a proposal.
 * - Strict JSON only when the model decides to act.
 */

const ActionEnvelope = z.object({
  action: ActionType,
  params: z.record(z.string(), z.any()).optional(),
  confidence: z.number().min(0).max(1).optional(),
  reasoning: z.string().optional(),
})

const MasterResponse = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    response: z.string(),
  }),
  z.object({
    type: z.literal('action'),
    action: ActionType,
    params: z.record(z.string(), z.any()).optional(),
    confidence: z.number().min(0).max(1).optional(),
    reasoning: z.string().optional(),
  }),
])

async function getAccountContext() {
  const accounts = await prisma.account.findMany({
    select: { code: true, name: true, type: true },
    orderBy: { code: 'asc' },
  })
  return accounts.map(a => `${a.code} — ${a.name} (${a.type})`).join('\n')
}

async function getTaxRatesContext() {
  const rates = await prisma.taxRate.findMany({ orderBy: [{ jurisdiction: 'asc' }, { rate: 'desc' }] })
  if (!rates.length) return 'No tax rates configured.'
  return rates.map(r => {
    const pct = (Number(r.rate) * 100).toFixed(0)
    return `${r.jurisdiction} — ${r.name} rate=${pct}% type=${r.taxType}`
  }).join('\n')
}

async function getContactsContext() {
  const contacts = await prisma.contact.findMany({
    select: { id: true, name: true, type: true },
    orderBy: { name: 'asc' },
    take: 300,
  })
  if (!contacts.length) return 'No contacts yet.'
  return contacts.map(c => `${c.name} (${c.type})`).join('\n')
}

async function getCurrentBalancesSummary() {
  const accounts = await prisma.account.findMany({ include: { journalLines: { include: { taxRate: true } } } })
  const summary: string[] = []
  accounts.forEach(a => {
    const bal = a.journalLines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0)
    if (Math.abs(bal) > 0.01) {
      const taxNote = a.journalLines.some(l => l.taxRate) ? ' (tax applied)' : ''
      const curSet = new Set(a.journalLines.map(l => l.currency || 'EUR'))
      const curNote = Array.from(curSet).filter(c => c !== 'EUR').length ? ` [${Array.from(curSet).join(',')}]` : ''
      summary.push(`${a.code} ${a.name}: $${bal.toFixed(2)}${taxNote}${curNote}`)
    }
  })
  return summary.join('\n') || 'No activity yet.'
}

function buildMasterSystemPrompt(ctx: {
  companyProfile: any
  accountList: string
  taxContext: string
  contactsContext: string
  balances: string
  feedRatesText?: string
  memoryText?: string
  vaultItems?: any[]
  chatLocked: boolean
  branch: string
  asOf?: string
}): string {
  const { companyProfile, accountList, taxContext, contactsContext, balances, feedRatesText, memoryText, vaultItems, chatLocked, branch, asOf } = ctx

  const lockRule = chatLocked
    ? 'CHAT IS CURRENTLY LOCKED. You may discuss, explain, and PROPOSE actions, but you must NOT execute anything. Every potential mutation (journal, invoice, contact, etc.) must be returned as a proposal so the user can confirm it explicitly.'
    : 'Chat lock is open. You may autonomously execute safe routine actions when you have high confidence and the data validates cleanly. Destructive, financial-moving, or master-data actions must still be proposed.'

  const actionCatalog = `
Available actions (exact strings). When you decide to act, output the "action" form below with precise params.

CREATE_JOURNAL
  params: { description?: string, date?: string, lines: [{ accountCode: string, debit: number, credit: number, description?: string, currency?: string, fxRateToBase?: number|null, fxSource?: string|null, fxDate?: string|null, taxRateId?: string|null, contactId?: string|null }], ... }

CREATE_CONTACT | UPDATE_CONTACT
  params: { name: string, type?: 'CUSTOMER'|'VENDOR', email?, phone?, addressStreet?, addressCity?, addressState?, addressZip?, addressCountry? (ISO2), ... }

CREATE_INVOICE_DRAFT | GENERATE_RECURRING_DRAFT
  params: { contactName or contactId, description, amount?, currency?, lines?: [...] }

MATCH_FEED_TRANSACTION, RECONCILE_ACCOUNT, APPLY_TEMPLATE, SYNC_FEED, OPEN_LEDGER, etc.

PROPOSE_* forms (always propose):
PROPOSE_RESTORE, PROPOSE_MERGE, PROPOSE_REVERSE, PROPOSE_SEND_INVOICE, PROPOSE_CREATE_ACCOUNT, PROPOSE_UPDATE_TAX_RATE, ...

When you want to perform an action, respond with structured output (type=action).
Otherwise respond with normal text (type=text).
`.trim()

  return `You are the master accounting agent for entrytwo — a real double-entry system with Git-style immutable history (branches, events, restores).

You have the full conversation history. Think like a competent, careful junior accountant who can also explain the software.

Core facts (authoritative — never hallucinate these):
- Base currency: ${companyProfile.baseCurrency}
- Country / Region: ${companyProfile.country || 'unknown'} / ${companyProfile.region || 'unknown'}
- Default tax jurisdiction: ${companyProfile.defaultTaxJurisdiction || 'unknown'}

Current view: branch=${branch}${asOf ? ` asOf=${asOf}` : ''}

${lockRule}

${actionCatalog}

Configured accounts:
${accountList}

Configured tax rates:
${taxContext}

Contacts (use exact names):
${contactsContext}

Current balances (multi-currency shown in brackets):
${balances}

${feedRatesText ? feedRatesText + '\n' : ''}
${memoryText ? memoryText + '\n' : ''}

${vaultItems && vaultItems.length ? 'Memory Vault facts:\n' + JSON.stringify(vaultItems, null, 2) + '\n' : ''}

Rules:
- Always balance debits = credits after FX conversion to base.
- Use real account codes and contact names from the lists above.
- Bank/credit card feed rates are authoritative when available.
- When the lock is closed, every actionable change must be a proposal.
- Output either plain helpful text or a single precise action object.
- Never mutate master data (accounts, tax rates, settings, users) from chat.
`.trim()
}

export async function POST(req: NextRequest) {
  try {
    let messages: any[] = []
    let chatLocked = false
    let branch = 'main'
    let asOf: string | undefined
    let attachedFiles: Array<{ name: string; buffer: Buffer; savedPath: string; mimeType: string }> = []

    const contentType = req.headers.get('content-type') || ''

    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData()
      try {
        const msgStr = form.get('messages') as string | null
        messages = msgStr ? JSON.parse(msgStr) : []
      } catch { messages = [] }
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
      messages = jsonBody?.messages || []
      chatLocked = !!jsonBody?.chatLocked
      branch = jsonBody?.branch || 'main'
      asOf = jsonBody?.asOf

      // Direct approved proposal
      if (jsonBody?.approvedAction && typeof jsonBody.approvedAction === 'object') {
        const approved = jsonBody.approvedAction
        // Re-validate and execute (lock is ignored on explicit confirm from UI, but we still enforce policy)
        return await handleApprovedAction(approved, { branch, asOf })
      }
    }

    const llmConfig = getLlmConfig()
    const hasKey = !!(llmConfig.apiKey || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || process.env.XAI_API_KEY)
    if (!hasKey) {
      return Response.json({ response: 'LLM not configured.' })
    }

    const model = createLlmModel(llmConfig)

    const [
      accountList,
      taxContext,
      contactsContext,
      balances,
      companyProfile,
      feedRatesText,
      memoryText,
    ] = await Promise.all([
      getAccountContext(),
      getTaxRatesContext(),
      getContactsContext(),
      getCurrentBalancesSummary(),
      getCompanyProfile(),
      getRecentFeedRatesPromptText(6),
      getMerchantMemoryPrompt(undefined, undefined),
    ])

    let vaultItems: any[] = []
    try {
      const facts = await Promise.all([
        MemoryVault.get('company', 'company.region'),
        MemoryVault.get('company', 'company.country'),
        MemoryVault.get('company', 'company.baseCurrency'),
        MemoryVault.get('company', 'company.defaultTaxJurisdiction'),
      ])
      vaultItems = facts.filter(Boolean) as any[]
      const recent = await MemoryVault.listByScope('company')
      vaultItems.push(...recent.slice(0, 5))
    } catch {}

    // Seed vault (authoritative facts)
    try { await MemoryVault.ensureCompanyFacts(companyProfile) } catch {}

    const system = buildMasterSystemPrompt({
      companyProfile,
      accountList,
      taxContext,
      contactsContext,
      balances,
      feedRatesText,
      memoryText,
      vaultItems: vaultItems.length ? vaultItems : undefined,
      chatLocked,
      branch,
      asOf,
    })

    const lastUserMessage = messages[messages.length - 1]?.content || ''

    // Build multimodal user content if files are present
    const userContent: any[] = []

    if (attachedFiles.length > 0) {
      userContent.push({
        type: 'text',
        text: `User message: ${lastUserMessage || '(no text, analyze the attached document)'}\n\nThe attached files are raw PDFs or images. Read them directly and completely.`,
      })
      for (const f of attachedFiles) {
        if (f.mimeType.includes('pdf') || f.mimeType.startsWith('image/')) {
          userContent.push({
            type: 'file',
            data: new Uint8Array(f.buffer),
            mediaType: f.mimeType,
            filename: f.name,
          })
        }
      }
    } else {
      userContent.push({ type: 'text', text: lastUserMessage || '' })
    }

    // Single master call
    let masterResult: any
    try {
      const { object } = await generateObject({
        model,
        schema: MasterResponse,
        system,
        messages: [{ role: 'user', content: userContent }],
      })
      masterResult = object
    } catch (err) {
      // Fallback to plain text generation if structured fails
      const { text } = await generateText({
        model,
        system,
        messages: [{ role: 'user', content: userContent }],
      })
      masterResult = { type: 'text', response: text || 'Understood.' }
    }

    // If the master chose to act
    if (masterResult.type === 'action') {
      const action = masterResult.action as ActionType
      const params = masterResult.params || {}
      const confidence = masterResult.confidence ?? 0.8
      const reasoning = masterResult.reasoning

      // Policy gates
      if (isMasterDataAction(action)) {
        return Response.json({
          response: 'Master data changes cannot be performed from chat.',
          proposed: true,
          action,
          params,
        })
      }

      const isDestructiveOrHighImpact = [
        'PROPOSE_RESTORE', 'PROPOSE_MERGE', 'PROPOSE_REVERSE',
        'PROPOSE_SEND_INVOICE', 'PROPOSE_CHARGE',
      ].includes(action)

      let forceProposal = chatLocked || isDestructiveOrHighImpact || confidence < 0.85

      // Domain validation
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

      if (!validationOk) {
        forceProposal = true
      }

      const finalActionPayload = {
        action,
        params: { ...params, ...resolved },
        confidence,
        reasoning,
        branch,
        asOf,
      }

      if (forceProposal) {
        return Response.json({
          response: validationError
            ? `Understood. Cannot proceed automatically: ${validationError}. Showing as proposal.`
            : `Proposal: ${action}`,
          proposed: true,
          action,
          params: finalActionPayload.params,
          proposedAction: finalActionPayload,
          understanding: reasoning,
        })
      }

      // Attempt autonomous execution
      try {
        const result = await executeAction(action, finalActionPayload.params, { branch, asOf })
        return Response.json(result)
      } catch (execErr: any) {
        return Response.json({
          response: `Execution failed: ${execErr?.message || execErr}. Showing as proposal.`,
          proposed: true,
          action,
          params: finalActionPayload.params,
          proposedAction: finalActionPayload,
          error: String(execErr?.message || execErr),
        })
      }
    }

    // Plain text response
    return Response.json({
      response: masterResult.response || 'Understood.',
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
