import { NextRequest } from 'next/server'
import { generateText, tool, stepCountIs, type ModelMessage, uploadFile } from 'ai'
import { createXai } from '@ai-sdk/xai'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getLlmConfig, createLlmModel, createLlmSearchTools } from '@/lib/llm'
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
import { createAutonomousJournal } from '@/lib/accounting/autonomous'
import { EventType } from '@prisma/client'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { loadOrCreateThread, appendToThread, getContextForModel } from '@/lib/chatThreadStore'
import { loadSkill } from '@/lib/skills'
import { isAuthoritativeBankFeed, normalizeToProvisional } from '@/lib/fxSources'
import { createHash } from 'crypto'
import { MAX_ATTACHMENT_BATCH_BYTES, MAX_ATTACHMENTS_PER_UPLOAD, storeAttachment } from '@/lib/attachments'
import { requireUser } from '@/lib/authz'
import { rateLimit } from '@/lib/rate-limit'

/**
 * Trillion chat (thread context + Grok skills on demand).
 * - Client sends only the *new* user message + threadId.
 * - Server owns the authoritative thread (lib/chatThreadStore).
 * - Bounded recent window sent to model (getContextForModel).
 * - Model reasons freely with generateText + tools.
 * - When it needs to act, it calls the get_skill tool (like searching docs or web).
 * - After receiving the skill, it emits one clean JSON action.
 * - Server handles validation, lock, proposals, execution.
 */

  // Extraction helper: the model now reasons freely (generateText + full history).
  // When it wants to act, it emits one clean JSON action (or inside a ```json fence).
  // We extract it here. Server validation + policy still apply.
type Extracted = { action: ActionType; params?: Record<string, unknown>; confidence?: number; reasoning?: string }

function mimeTypeForPath(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.csv')) return 'text/csv'
  return 'application/octet-stream'
}

async function readSavedAttachment(savedPath: string): Promise<Buffer> {
  const publicPrefix = '/uploads/receipts/'
  if (!savedPath.startsWith(publicPrefix)) return Buffer.alloc(0)
  const filename = savedPath.slice(publicPrefix.length)
  if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) return Buffer.alloc(0)
  try {
    return await readFile(join(process.cwd(), 'public', 'uploads', 'receipts', filename))
  } catch {
    return Buffer.alloc(0)
  }
}
  function tryExtractAction(text: string): Extracted | null {
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
  companyProfile: unknown
  chatLocked: boolean
  branch: string
  asOf?: string
  financialSnapshot?: string
  taxRatesInfo?: string
}): string {
  const { chatLocked, branch, asOf, financialSnapshot, taxRatesInfo } = ctx

  const lockRule = chatLocked
    ? 'CHAT IS CURRENTLY LOCKED. You may discuss and propose changes, but you must NOT execute anything without explicit user confirmation. The server will force proposals when locked.'
    : 'Chat lock is open. You may autonomously execute safe actions after validation.'

  const snapshotSection = `\n\nLive ledger state (branch=${branch}${asOf ? ` asOf=${asOf}` : ''}):\n${financialSnapshot || '(no journal lines yet in this view)'}\n`

  const taxSection = taxRatesInfo
    ? `\n\nAvailable tax rates (use the exact UUID as taxRateId):\n${taxRatesInfo}\n`
    : '\n\n(No tax rates configured yet.)\n'

  return `You are Trillion, the accounting companion inside entrytwo.

You are direct, practical, and maximally helpful. You have the full conversation history.

This app contains the complete financial records for the company (the "map"):
- Company profile, base currency, country/region, tax jurisdiction
- Live balances, chart of accounts, full journal history, contacts, invoices, tax rates, bank feeds, branches, and point-in-time views

Current view: branch=${branch}${asOf ? ` asOf=${asOf}` : ''}

${lockRule}
${snapshotSection}
${taxSection}

Use the live data above for any question about this company's actual numbers, accounts, balances, transactions, or documents.

For general tax rules, laws, rates in a country, or anything that is not specific to this company's own configured records, check current external sources.

When you need to create or change records (journal, contact, invoice, etc.):
- First call the get_skill tool with the right skill name (e.g. "create-contact", "create-journal", "core").
- After receiving the skill instructions, output **exactly one** clean JSON action object (or a \`\`\`json block).
- The server will parse, validate, and respect the lock.

Special case — bank and credit card **statements** (PDF uploads or pasted HTML tables from the bank website):
- When the user attaches a bank/credit card statement PDF or pastes an HTML/table of transactions, first call get_skill("extract-bank-statement").
- Extract every transaction. Emit one CREATE_JOURNAL_BATCH whose entries array contains exactly one balanced journal entry per statement transaction.
- Keep an FX/conversion fee in the same entry as its transaction. Standalone bank fees and card payments are their own entries.
- Capture any FX/conversion rates shown on the statement itself.
- For resulting journal lines, set fxSource starting with "BANK_FEED:statement:" (e.g. "BANK_FEED:statement:visa-1234-2026-06", "mastercard-...", bank name).
- When a PDF was attached this turn, set sourcePdfPath on the journal entry.
- These statement-derived rates are authoritative and win over every provisional or manual estimate.
- IMPORTANT: Prior foreign purchases were likely recorded with provisional rates (LLM_PROVISIONAL, MANUAL_PROVISIONAL, or legacy provisional sources).
  When you see prior provisional lines for the same merchants, emit small FX adjustment CREATE_JOURNAL entries (difference + fees) using the authoritative BANK_FEED rate from this statement.
  Do NOT mutate or reverse the original provisional entries. Reference the original entry number in the adjustment description.

Otherwise just answer normally in clear text.

Bank/credit card feed rates (including from uploaded or pasted statements) are authoritative for FX when available.
Recent feed rates shown below are historical reference only. New receipt entries use LLM_PROVISIONAL with source URLs, or MANUAL_PROVISIONAL when the user supplies the base amount, unless the rate came directly from the current statement/feed context.
Never emit fxSource starting with BANK_FEED unless the rate truly came from a feed line in this turn.
For every transaction whose currency differs from the configured company base currency and has no current statement/feed rate, use web_search before emitting the action. Compare at least two independent public sources for the transaction date (or nearest prior market day), calculate base-currency units per one transaction-currency unit, and record fxSource as LLM_PROVISIONAL followed by the source URLs. Never omit, invent, or assume 1:1. If web search is unavailable or two sources cannot support a reasonable estimate, ask for the actual base amount instead.
Never mutate master data (accounts, tax rates, settings, users) from chat.
Normal conversation → normal text. Real actions → look up the skill if needed → one JSON action object.
`.trim()
}

export async function POST(req: NextRequest) {
  const limited = rateLimit(req)
  if (limited) return limited
  const session = await requireUser(['ADMIN', 'ACCOUNTANT'])
  if (!session) return Response.json({ error: 'Accountant access required' }, { status: 403 })
  try {
    let userMessage = ''
    let chatLocked = false
    let branch = 'main'
    let asOf: string | undefined
    let incomingThreadId: string | undefined
    const attachedFiles: Array<{ name: string; buffer: Buffer; savedPath: string; mimeType: string; size: number; sha256: string }> = []

    const contentType = req.headers.get('content-type') || ''

    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData()
      userMessage = (form.get('message') as string) || ''
      incomingThreadId = (form.get('threadId') as string) || undefined
      chatLocked = form.get('chatLocked') === 'true'
      branch = (form.get('branch') as string) || 'main'
      asOf = (form.get('asOf') as string) || undefined

      const files = form.getAll('file') as File[]
      if (files.length > MAX_ATTACHMENTS_PER_UPLOAD || files.reduce((sum, file) => sum + file.size, 0) > MAX_ATTACHMENT_BATCH_BYTES) {
        return Response.json({ error: 'Attachment batch exceeds the configured limits' }, { status: 413 })
      }
      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        const buf = Buffer.from(await f.arrayBuffer())
        const clientSaved = form.get(`savedPath_${i}`) as string | null
        if (clientSaved) {
          attachedFiles.push({ name: f.name, buffer: buf, savedPath: clientSaved, mimeType: f.type || mimeTypeForPath(clientSaved), size: buf.length, sha256: createHash('sha256').update(buf).digest('hex') })
        } else {
          const stored = await storeAttachment(f)
          attachedFiles.push({
            name: stored.originalName,
            buffer: buf,
            savedPath: stored.path,
            mimeType: stored.mimeType,
            size: stored.size,
            sha256: stored.sha256,
          })
        }
      }

      // Also capture pure savedPath references (e.g. "attach receipt" from the receipts list in this turn,
      // where the client sends only the path without re-uploading the bytes).
      // These must land in attachedFiles so the auto-attach logic below can use them for new journal entries.
      for (const [key, val] of form.entries()) {
        if (typeof key === 'string' && key.startsWith('savedPath_') && typeof val === 'string') {
          if (!attachedFiles.some(a => a.savedPath === val)) {
            const buffer = await readSavedAttachment(val)
            attachedFiles.push({
              name: val.split('/').pop() || 'receipt',
              buffer,
              savedPath: val,
              mimeType: mimeTypeForPath(val),
              size: buffer.length,
              sha256: createHash('sha256').update(buffer).digest('hex'),
            })
          }
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
        return await handleApprovedAction(approved, { branch, asOf, createdBy: session.user.id })
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

    // xAI: upload PDFs via official Files API so we can reference them with providerReference (input_file).
    // This lets xAI's attachment layer handle ingestion. Only PDFs; images stay as raw vision parts.
    // Non-xai providers keep previous (raw) behaviour for their own file support.
    if (attachedFiles.length > 0) {
      const isXai = (llmConfig.provider || '').toLowerCase() === 'xai' || !llmConfig.provider
      const xaiKey = llmConfig.apiKey || process.env.XAI_API_KEY || process.env.LLM_API_KEY || ''
      if (isXai && xaiKey) {
        const xaiProvider = createXai({ apiKey: xaiKey })
        for (const f of attachedFiles) {
          const mt = (f.mimeType || '').toLowerCase()
          if (mt === 'application/pdf' && !(f as any).__providerRef) {
            try {
              const { providerReference } = await uploadFile({
                api: xaiProvider.files(),
                data: f.buffer,
                mediaType: 'application/pdf',
                filename: f.name,
              })
              ;(f as any).__providerRef = providerReference
            } catch (e) {
              console.error('xAI Files API upload failed for PDF attachment:', e)
            }
          }
        }
      }
    }

    // Trillion gets the full conversation + live data every turn.
    // She reasons freely. Structured actions only when she decides to mutate.
    // Safety (lock, validation, proposals) is enforced here on the server.
    const companyProfile = await getCompanyProfile()

    // Always build live balances for the current Git view (branch + asOf).
    // This is the "map" — she reads what she needs.
    async function buildLiveBalancesSummary(b: string, point?: string): Promise<string> {
      const visibleEntryIds = point
        ? await getVisibleJournalEntryIdsAtPoint(point)
        : await getVisibleJournalEntryIds((await prisma.accountingBranch.findUnique({ where: { name: b } }))?.headEventId)

      const restrict = visibleEntryIds.length > 0
      const where: Record<string, unknown> = restrict ? { journalEntryId: { in: visibleEntryIds } } : {}

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

    // Provide current tax rates so the model can use real taxRateId values (UUIDs) when needed.
    let taxRatesInfo = ''
    try {
      const rates = await prisma.taxRate.findMany({
        select: { id: true, jurisdiction: true, name: true, rate: true },
        orderBy: [{ jurisdiction: 'asc' }, { rate: 'desc' }],
      })
      if (rates.length) {
        taxRatesInfo = rates
          .map(r => `${r.id}  ${r.jurisdiction} ${r.name} (${(Number(r.rate) * 100).toFixed(0)}%)`)
          .join('\n')
      }
    } catch {}

    const system = buildMasterSystemPrompt({
      companyProfile,
      chatLocked,
      branch,
      asOf,
      financialSnapshot: financialSnapshot || undefined,
      taxRatesInfo: taxRatesInfo || undefined,
    })

    // Server owns the authoritative thread.
    // Client only ever sends the *new* user turn + threadId.
    const { thread } = loadOrCreateThread(incomingThreadId)

    // Record the new user message on the server thread.
    if (userMessage || attachedFiles.length > 0) {
      const attachmentContext = attachedFiles.length
        ? `\n\nAttachments available in this turn:\n${attachedFiles.map(file => `- ${file.name} (${file.savedPath})`).join('\n')}\nKeep these documents and their extracted facts in context for follow-up questions.`
        : ''
      appendToThread(thread.id, {
        role: 'user',
        content: `${userMessage || 'Please inspect the attached document(s).'}` + attachmentContext,
      })
    }

    // Build a sane context window for this LLM call.
    // Real systems do NOT send the entire ever-growing history on every request.
    const contextTurns = getContextForModel(thread, 80)

    // Prepare messages for the model.
    // - Images: use vision parts (works today).
    // - PDFs on xAI: use proper FilePart with providerReference (from uploadFile + xai.files).
    //   This produces the official input_file reference that xAI's attachment layer expects.
    // - Other files: fall back to raw (provider dependent).
    type LlmPart =
      | { type: 'image'; image: Buffer; mediaType?: string }
      | { type: 'file'; data: any; mediaType: string; filename?: string }
      | { type: 'text'; text: string }
    type LlmMsg = { role: 'user' | 'assistant' | 'system' | 'tool'; content: string | LlmPart[] }
    const llmMessages: LlmMsg[] = contextTurns.map((turn, idx) => {
      const isLast = idx === contextTurns.length - 1
      const attachFilesHere = isLast && attachedFiles.length > 0 && turn.role === 'user'

      if (attachFilesHere) {
        const parts: LlmPart[] = attachedFiles.map(f => {
          const mt = f.mimeType || ''
          if (mt.startsWith('image/')) {
            return { type: 'image', image: f.buffer, mediaType: mt }
          }
          if (mt === 'application/pdf') {
            const ref = (f as any).__providerRef
            if (ref) {
              // Official supported path: reference after Files API upload.
              return {
                type: 'file',
                data: { type: 'reference', reference: ref },
                mediaType: 'application/pdf',
                filename: f.name,
              }
            }
            // No reference (upload failed or non-xai): fall through with raw buffer (will likely 422 on xai).
            return { type: 'file', data: f.buffer, mediaType: mt, filename: f.name }
          }
          return { type: 'file', data: f.buffer, mediaType: mt, filename: f.name }
        })
        if (turn.content) parts.push({ type: 'text', text: turn.content })
        return { role: turn.role, content: parts }
      }
      return { role: turn.role, content: turn.content || '' }
    })

    // Define the on-demand skill retrieval tool (Grok skills style).
    // The model decides when it needs precise action schemas and calls this.
    const getSkillTool = tool({
      description: 'Fetch the exact instructions, rules, and JSON shape for a Trillion action skill. Call this by name (core, create-contact, create-journal, create-invoice-draft, update-contact, extract-bank-statement) right before you need to emit a structured action. Use extract-bank-statement when the user provided a bank/credit card statement (PDF or pasted HTML table).',
      inputSchema: z.object({
        skill: z.string().describe('The skill name to load, e.g. "create-journal", "extract-bank-statement", "core".'),
      }),
      execute: async ({ skill }) => {
        const content = await loadSkill(skill)
        return content || `No instructions found for skill: ${skill}`
      },
    })

    // Call the model with the windowed context + tools.
    // The model decides when to call get_skill (like web search).
    let assistantText = ''
    let webSearchSourceUrls: string[] = []
    try {
      const generation = await generateText({
        model,
        system,
        messages: llmMessages as ModelMessage[],
        tools: {
          get_skill: getSkillTool,
          ...createLlmSearchTools(llmConfig),
        },
        stopWhen: stepCountIs(12),
      })
      assistantText = generation.text || ''
      const searchTrace = JSON.stringify({ steps: generation.steps, sources: generation.sources })
      webSearchSourceUrls = Array.from(new Set(
        (searchTrace.match(/https?:\\?\/\\?\/[^"\\\s,;]+/g) || [])
          .map(url => url.replace(/\\\//g, '/'))
          .filter(url => /^https?:\/\//.test(url))
      )).slice(0, 8)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('generateText error (Trillion chat):', msg, e)
      assistantText = 'Chat temporarily unavailable.'
    }

    // Does the model want to perform an action?
    const extracted = tryExtractAction(assistantText)

    if (extracted && extracted.action) {
      // Persist a compact record of the decision on the thread.
      appendToThread(thread.id, {
        role: 'assistant',
        // Keep the full structured result so later turns retain extracted transactions,
        // FX rates, fees, account choices, and document provenance.
        content: assistantText,
      })

      const action = extracted.action as ActionType
      const params: Record<string, unknown> = extracted.params || {}
      const confidence = extracted.confidence ?? 0.8
      const reasoning = extracted.reasoning

      // Auto-attach the receipt from this chat turn (PDF or image) to journal entries
      // created by the model. This works for both autonomous execution and proposals.
      // We still respect an explicit sourcePdfPath if the model provided one.
      if (action === 'CREATE_JOURNAL') {
        const p = params as { sourcePdfPath?: string | null; attachments?: unknown[]; lines?: any[] }
        p.attachments = attachedFiles.map(file => ({ path: file.savedPath, originalName: file.name, mimeType: file.mimeType, size: file.size, sha256: file.sha256 }))
        if (!p.sourcePdfPath && attachedFiles.length > 0) {
          const receipt = attachedFiles.find(f => {
            const m = (f.mimeType || '').toLowerCase()
            return m.startsWith('image/') || m === 'application/pdf'
          })
          if (receipt?.savedPath) {
            p.sourcePdfPath = receipt.savedPath
          }
        }

        // Statement upload hardening:
        // If this looks like a bank/credit card statement (PDF or pasted HTML),
        // ensure any line carrying FX gets fxSource starting with BANK_FEED:statement:
        // and preserve user-provided sourcePdfPath for provenance.
        const msgLower = (userMessage || '').toLowerCase()
        const hasStatementFile = attachedFiles.some(f =>
          /statement|visa|mastercard|amex|credit.?card|bank.?account/i.test(f.name || '')
        )
        const looksLikeStatement = hasStatementFile ||
          /statement|visa|mastercard|amex.*statement|credit card|bank statement/i.test(msgLower)

        if (Array.isArray(p.lines)) {
          p.lines = p.lines.map((ln: any) => {
            const hasFx = ln.fxRateToBase != null || (ln.fxSource && /feed|statement/i.test(String(ln.fxSource)))
            if (hasFx && looksLikeStatement) {
              const src = String(ln.fxSource || '')
              if (!src.startsWith('BANK_FEED:statement')) {
                // Normalize to proper prefix. Keep any detail the model provided (e.g. visa-2026-06)
                const detail = src.replace(/^.*(statement|feed)[:\-]?/i, '') || 'upload'
                ln.fxSource = `BANK_FEED:statement:${detail}`.replace(/:+$/, '')
              }
            } else if (ln.fxSource && /statement/i.test(String(ln.fxSource)) && !String(ln.fxSource).startsWith('BANK_FEED')) {
              ln.fxSource = 'BANK_FEED:' + String(ln.fxSource).replace(/^BANK_FEED:?/i, '')
            } else if (ln.fxRateToBase != null && !isAuthoritativeBankFeed(String(ln.fxSource || '')) && webSearchSourceUrls.length >= 2) {
              ln.fxSource = `LLM_PROVISIONAL:${webSearchSourceUrls.join(';')}`
            }
            return ln
          })
        }
      }


      if (action === 'CREATE_JOURNAL_BATCH') {
        const p = params as { sourcePdfPath?: string | null; attachments?: unknown[]; entries?: Array<Record<string, unknown>> }
        p.attachments = attachedFiles.map(file => ({ path: file.savedPath, originalName: file.name, mimeType: file.mimeType, size: file.size, sha256: file.sha256 }))
        if (!p.sourcePdfPath && attachedFiles[0]?.savedPath) p.sourcePdfPath = attachedFiles[0].savedPath
        if (Array.isArray(p.entries)) {
          p.entries = p.entries.map((entry) => ({ ...entry, sourcePdfPath: entry.sourcePdfPath || p.sourcePdfPath, attachments: p.attachments }))
        }
      }

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
      const resolved: Record<string, unknown> = {}

      if (action === 'CREATE_JOURNAL') {
        const v = await validateJournalIntent(params, branch)
        validationOk = v.ok
        validationError = v.error
        if (v.resolvedLines) resolved.lines = v.resolvedLines
      } else if (action === 'CREATE_JOURNAL_BATCH') {
        const batch = params as { entries?: Array<Record<string, unknown>>; sourcePdfPath?: string }
        if (!Array.isArray(batch.entries) || batch.entries.length === 0) {
          validationOk = false
          validationError = 'Statement batch must contain at least one transaction entry'
        } else {
          const resolvedEntries: Array<Record<string, unknown>> = []
          for (let i = 0; i < batch.entries.length; i++) {
            const entry = batch.entries[i]
            const v = await validateJournalIntent(entry, branch)
            if (!v.ok || !v.resolvedLines) {
              validationOk = false
              validationError = `Statement transaction ${i + 1}: ${v.error || 'invalid journal'}`
              break
            }
            resolvedEntries.push({ ...entry, sourcePdfPath: entry.sourcePdfPath || batch.sourcePdfPath, lines: v.resolvedLines })
          }
          if (validationOk) resolved.entries = resolvedEntries
        }
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
        if (v.resolvedLines) resolved.lines = v.resolvedLines
      } else if (action === 'PROPOSE_RESTORE') {
        const v = await validateRestoreTarget(String(params.target ?? ''), branch)
        validationOk = v.ok
        validationError = v.error
        if (v.eventId) resolved.eventId = v.eventId
      }

      const isSafe = isSafeAutonomous(action)

      // "No more babysitting":
      // Safe autonomous actions execute directly when lock is open + validation passed.
      // Only force proposal for safe actions on lock, destructive, or validation failure.
      const forceProposal = chatLocked || isDestructive || !validationOk || !isSafe

      const finalPayload = { action, params: { ...params, ...resolved }, confidence, reasoning, branch, asOf }

      if (forceProposal) {
        // Clean proposal message for the user.
        let proposalText = `I can do that as a proposal.`
        if (action === 'CREATE_CONTACT' && params?.name) {
          proposalText = `Create contact "${params.name}"?`
        } else if (action === 'CREATE_JOURNAL') {
          proposalText = `Create this journal entry?`
        } else if (action === 'CREATE_JOURNAL_BATCH') {
          proposalText = `Create ${(params as { entries?: unknown[] }).entries?.length || 0} statement journal entries?`
        }

        const proposalResponse: any = {
          response: validationError
            ? `Understood. Cannot proceed automatically: ${validationError}.`
            : proposalText,
          proposed: true,
          action,
          params: finalPayload.params,
          proposedAction: finalPayload,
          understanding: reasoning,
          threadId: thread.id,
        }
        // Surface sourcePdfPath at top level so the client message and proposal card pick it up.
        if ((finalPayload.params as any)?.sourcePdfPath) {
          proposalResponse.sourcePdfPath = (finalPayload.params as any).sourcePdfPath
        }
        return Response.json(proposalResponse)
      }

      // Execute directly (no proposal, no confidence gate for safe actions)
      try {
        const execResult = await executeAction(action, finalPayload.params, { branch, asOf, createdBy: session.user.id })
        const execResponse: any = { ...execResult, threadId: thread.id }
        if ((finalPayload.params as any)?.sourcePdfPath) {
          execResponse.sourcePdfPath = (finalPayload.params as any).sourcePdfPath
        }
        return Response.json(execResponse)
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        return Response.json({
          response: `Execution failed: ${msg}.`,
          proposed: true,
          action,
          params: finalPayload.params,
          proposedAction: finalPayload,
          error: msg,
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

async function executeAction(action: ActionType, params: Record<string, unknown>, ctx: { branch: string; asOf?: string; createdBy?: string }) {
  const branch = ctx.branch || 'main'

  if (action === 'CREATE_JOURNAL') {
    const p = params as {
      description?: string
      date?: string
      sourcePdfPath?: string | null
      attachments?: Array<{ path: string; originalName: string; mimeType: string; size: number; sha256: string }>
      confidence?: number
      reasoning?: string
      lines: Array<{
        accountId: string
        debit: number
        credit: number
        description?: string
        currency?: string
        fxRateToBase?: number | null
        fxSource?: string
        fxDate?: string
        taxRateId?: string | null
        contactId?: string | null
      }>
    }
    const lines = Array.isArray(p.lines) ? p.lines : []
    if (lines.length < 2) throw new Error('Journal must have at least 2 lines')

    const resolvedLines = lines.map((l) => {
      let fxSource = l.fxSource || 'AI_AUTONOMOUS'

      // Never downgrade an explicit BANK_FEED source (from statements, Stripe, PayPal, etc.)
      if (l.fxSource && l.fxSource.startsWith('BANK_FEED')) {
        fxSource = l.fxSource
      }

      // An attachment alone is not a statement. Only explicit statement metadata may become authoritative.
      const looksLikeStatement = (l.fxSource && /statement/i.test(l.fxSource)) ||
        /statement|visa|mastercard|amex|credit card/i.test((p.description || '').toLowerCase())

      if (looksLikeStatement && (!fxSource || !fxSource.startsWith('BANK_FEED:statement'))) {
        const detail = (l.fxSource || '').replace(/^.*BANK_FEED:?/i, '') || 'upload'
        fxSource = `BANK_FEED:statement:${detail}`.replace(/:+$/, '')
      }

      // FX provisional policy:
      // For any foreign-currency line that does NOT have an authoritative BANK_FEED source,
      // force fxSource to a provisional value. Never let autonomous/chat emit BANK_FEED unless real feed context.
      const cur = (l.currency || 'EUR').toUpperCase()
      if (cur !== 'EUR' && !fxSource.startsWith('BANK_FEED')) {
        fxSource = normalizeToProvisional(fxSource)
      }

      return {
        accountId: l.accountId,
        debit: l.debit || 0,
        credit: l.credit || 0,
        description: l.description,
        currency: (l.currency || 'EUR').toUpperCase(),
        fxRateToBase: l.fxRateToBase ?? null,
        fxSource,
        fxDate: l.fxDate || new Date().toISOString().slice(0, 10),
        taxRateId: l.taxRateId || null,
        contactId: l.contactId || null,
      }
    })

    // Business date: always store as midnight UTC for the given calendar day.
    // The actual creation time is recorded in createdAt (used for stable ordering).
    const businessDate = p.date ? new Date(p.date) : new Date()
    businessDate.setUTCHours(0, 0, 0, 0)

    const created = await createAutonomousJournal({
      date: businessDate.toISOString(),
      description: p.description || 'Autonomous journal entry',
      lines: resolvedLines,
      aiMetadata: { confidence: p.confidence, reasoning: p.reasoning },
      branch,
      sourcePdfPath: p.sourcePdfPath || null,
      attachments: p.attachments,
      createdBy: ctx.createdBy || null,
    })

    return {
      executed: true,
      action,
      response: `Created autonomously: ${created.description || 'Journal entry'}`,
      entityId: created.id,
      branch,
      createdAutonomously: true,
      sourcePdfPath: p.sourcePdfPath || null,
    }
  }


  if (action === 'CREATE_JOURNAL_BATCH') {
    const p = params as { sourcePdfPath?: string | null; entries?: Array<Record<string, unknown>> }
    const entries = Array.isArray(p.entries) ? p.entries : []
    if (entries.length === 0) throw new Error('Statement batch must contain at least one transaction')

    const created: string[] = []
    for (const entry of entries) {
      const result = await executeAction('CREATE_JOURNAL', {
        ...entry,
        sourcePdfPath: entry.sourcePdfPath || p.sourcePdfPath,
      }, ctx)
      if (result.entityId) created.push(result.entityId)
    }
    return {
      executed: true,
      action,
      response: `Created ${created.length} journal entries from the statement`,
      entityIds: created,
      branch,
      createdAutonomously: true,
      sourcePdfPath: p.sourcePdfPath || null,
    }
  }

  if (action === 'CREATE_CONTACT') {
    const p = params as {
      name?: string
      email?: string
      type?: string
      phone?: string
      addressStreet?: string
      addressCity?: string
      addressState?: string
      addressZip?: string
      addressCountry?: string
      addressLine2?: string
      taxId?: string
      website?: string
      currency?: string
      notes?: string
    }
    const contact = await prisma.contact.create({
      data: {
        name: p.name ?? '',
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
    const p = params as {
      contactId?: string
      contactName?: string
      description?: string
      amount?: number | string
      currency?: string
      lines?: Array<{
        description?: string
        quantity?: number | string
        unitPrice?: number | string
        taxRateId?: string | null
      }>
    }
    let contactId = p.contactId
    if (!contactId && p.contactName) {
      const found = await prisma.contact.findFirst({ where: { name: p.contactName } })
      if (found) contactId = found.id
    }
    if (!contactId) throw new Error('Invoice requires a valid contact')

    const currency = (p.currency || 'EUR').toUpperCase()
    const lines = p.lines || [{ description: p.description, quantity: 1, unitPrice: p.amount || 0 }]
    const subtotal = lines.reduce((s: number, l) => s + (Number(l.quantity) || 1) * (Number(l.unitPrice) || 0), 0)

    let ar = await prisma.account.findFirst({ where: { OR: [{ code: '1100' }, { name: { contains: 'receivable', mode: 'insensitive' } }] } })
    if (!ar) ar = await prisma.account.findFirst({ where: { type: 'ASSET' } })
    let rev = await prisma.account.findFirst({ where: { OR: [{ code: '4000' }, { name: { contains: 'revenue', mode: 'insensitive' } }] } })
    if (!rev) rev = await prisma.account.findFirst({ where: { type: 'REVENUE' } })

    if (!ar || !rev) throw new Error('Required accounts for invoicing not found')

    // Resolve taxRateIds: only keep ones that actually exist (FK safety).
    // Model should use exact UUIDs from the "Available tax rates" list we inject.
    const rawInputLines = Array.isArray(lines) ? lines : []
    const rawTaxStrings: string[] = rawInputLines
      .map((l) => (typeof l?.taxRateId === 'string' ? l.taxRateId.trim() : ''))
      .filter((s): s is string => s.length > 0)
    const candidateTaxIds: string[] = Array.from(new Set(rawTaxStrings))
    const idsForQuery: string[] = candidateTaxIds
    const existingTaxRates = idsForQuery.length
      ? await prisma.taxRate.findMany({ where: { id: { in: idsForQuery } }, select: { id: true } })
      : []
    const validTaxIdSet = new Set(existingTaxRates.map(r => r.id))

    const safeLines = lines.map((l) => {
      const taxId = (typeof l.taxRateId === 'string' && validTaxIdSet.has(l.taxRateId)) ? l.taxRateId : null
      const qty = Number(l.quantity) || 1
      const up = Number(l.unitPrice) || 0
      return {
        description: l.description ?? '',
        quantity: qty,
        unitPrice: up,
        taxRateId: taxId,
        lineTotal: qty * up,
      }
    })

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
          create: safeLines,
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

async function handleApprovedAction(approved: { action: ActionType; params?: Record<string, unknown> }, ctx: { branch: string; asOf?: string; createdBy?: string }) {
  try {
    const result = await executeAction(approved.action, approved.params || {}, ctx)
    // Note: for approved actions we don't have the thread here.
    // Client will keep using its stored threadId for subsequent chat turns.
    return Response.json(result)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return Response.json({
      response: `Confirmation failed: ${msg}`,
      proposed: true,
      action: approved.action,
      params: approved.params,
    })
  }
}
