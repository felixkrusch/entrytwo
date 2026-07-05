import { NextRequest } from 'next/server'
import { streamText, generateObject } from 'ai'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getRecentFeedRatesPromptText } from '@/lib/recentFeedRates'
import { getMerchantMemoryPrompt } from '@/lib/agentMemory'
import { getLlmConfig, createLlmModel } from '@/lib/llm'
import { ChatIntent, ActionType, getSchemaForAction } from '@/lib/chat/intent'
import { dispatchIntent as runDispatch } from '@/lib/chat/dispatcher'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'

// ---------------------------------------------------------------------------
// Two-pass schemas (Pass 1 = broad intelligence, Pass 2 = exact pack)
// ---------------------------------------------------------------------------
const Pass1Action = z.object({
  action: z.string(),
  understanding: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
  reasoning: z.string().optional(),
})

const Pass1Schema = z.object({
  // Support compound / multi-sentence intents: multiple distinct actions in one message.
  // For unclear/no-action cases (e.g. pure chat or unparseable attachments), output actions: [] so we fall through to normal stream.
  actions: z.array(Pass1Action).optional().default([]),
})

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
      // Multi-currency note: include currency if non-EUR present on this account
      const curSet = new Set(a.journalLines.map(l => l.currency || 'EUR'))
      const curNote = Array.from(curSet).filter(c => c !== 'EUR').length ? ` [${Array.from(curSet).join(',')}]` : ''
      summary.push(`${a.code} ${a.name}: $${bal.toFixed(2)}${taxNote}${curNote}`)
    }
  })
  return summary.join('\n') || 'No activity yet.'
}

export async function POST(req: NextRequest) {
  try {
    // Support both JSON and multipart (for file attachments)
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
        // Save to disk so we can link to journal entries later
        const uploadsDir = join(process.cwd(), 'public', 'uploads', 'receipts')
        await mkdir(uploadsDir, { recursive: true })
        const safe = (f.name || 'doc').replace(/[^a-zA-Z0-9_.-]/g, '_')
        const fname = `${Date.now()}-${i}-${safe}`
        const disk = join(uploadsDir, fname)
        await writeFile(disk, buf)
        const publicPath = `/uploads/receipts/${fname}`
        attachedFiles.push({
          name: f.name,
          buffer: buf,
          savedPath: publicPath,
          mimeType: f.type || 'application/pdf',
        })
      }
    } else {
      const jsonBody = await req.json()
      messages = jsonBody?.messages || []
      chatLocked = !!jsonBody?.chatLocked
      branch = jsonBody?.branch || 'main'
      asOf = jsonBody?.asOf

      // Capture direct approved intent for confirmation UI (JSON path)
      if (jsonBody?.intent && typeof jsonBody.intent === 'object') {
        ;(globalThis as any).__pendingDirectIntent = jsonBody.intent
      }
    }

    const lastMessage = (messages[messages.length - 1]?.content || '').toString()

    // All requests go through two-pass (or plain conversational stream).
    // No legacy keyword heuristics.

    const llmConfig = getLlmConfig()
    const hasKey = !!(llmConfig.apiKey || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || process.env.XAI_API_KEY || process.env.ANTHROPIC_API_KEY)

    if (!hasKey) {
      return Response.json({ response: 'LLM not configured. Provide an API key to use chat.' })
    }

    const model = createLlmModel(llmConfig)

    const accountList = await getAccountContext()
    const balances = await getCurrentBalancesSummary()
    const taxContext = await getTaxRatesContext()
    const contactsContext = await getContactsContext()

    // Git view context passed from client (for autonomous execution on correct branch/asOf)
    // Use the normalized values we set above for *both* JSON and multipart paths.
    const requestedBranch = branch || 'main'
    const requestedAsOf = asOf

    // Direct approved intent (from confirmation UI)
    // We captured it on globalThis during body parsing (JSON path) or can support via multipart.
    let pendingDirectIntent: any = null
    if ((globalThis as any).__pendingDirectIntent) {
      pendingDirectIntent = (globalThis as any).__pendingDirectIntent
      ;(globalThis as any).__pendingDirectIntent = null
    }
    if (pendingDirectIntent && typeof pendingDirectIntent === 'object') {
      try {
        const approvedIntent: ChatIntent = {
          ...pendingDirectIntent,
          approved: true,
          branch: pendingDirectIntent.branch || requestedBranch,
        }
        const result = await runDispatch(approvedIntent, {
          chatLocked,
          currentBranch: requestedBranch,
          currentAsOf: requestedAsOf,
        })
        return Response.json(result)
      } catch (e) {
        console.error('Direct approved intent failed', e)
      }
    }

    // Phase 2: compute a preliminary merchant hint from the user message
    const preliminaryMerchant = (lastMessage.match(/from\s+([A-Za-z0-9 .&'-]+)/i)?.[1] || '').trim()

    // Get company location info + real base currency from settings
    let companyRegion: string | undefined
    let companyCountry: string | undefined
    let baseCurrency = 'EUR'
    try {
      const [addr, jur, bc] = await Promise.all([
        prisma.setting.findUnique({ where: { key: 'company.address' } }),
        prisma.setting.findUnique({ where: { key: 'defaultTaxJurisdiction' } }),
        prisma.setting.findUnique({ where: { key: 'baseCurrency' } }),
      ])
      const a = addr?.value as unknown as { region?: string; country?: string } | null
      const jv = (jur?.value as unknown as { value?: string })?.value || (jur?.value as unknown as string)
      companyRegion = (a?.region || jv || undefined)
      companyCountry = a?.country || (companyRegion ? companyRegion.split('-')[0] : undefined)
      if (companyRegion) companyRegion = String(companyRegion).toUpperCase()

      const bcVal = (bc?.value as any)?.value
      if (typeof bcVal === 'string' && bcVal.trim()) {
        baseCurrency = bcVal.trim().toUpperCase()
      }
    } catch {}

    // Phase 2: inject memory (now keyed on merchant + region) + feed rates
    const [feedRatesText, memoryText] = await Promise.all([
      getRecentFeedRatesPromptText(6),
      getMerchantMemoryPrompt(preliminaryMerchant || undefined, companyRegion),
    ])

    // Make base currency available to prompts and later logic
    // (already fetched above)

    const system = `You are a precise double-entry AI accountant.
Always balance debits = credits. Use exact codes from the list.
Current balances (multi-currency shown in brackets when present):
${balances}

Tax rates available:
${taxContext}

Accounts:
${accountList}

Company location (use for tax decisions):
- Country: ${companyCountry || 'unknown'}
- Region (full ISO 3166-2 when known): ${companyRegion || 'unknown'}
- When the merchant/place of supply is in a different region than the company, prefer rates matching the place of supply (e.g. Quebec hotel for Ontario company → CA-QC rates).

Multi-currency + FX rules (Phase 0, no exceptions):
- Every JournalLine must have "currency" (EUR, USD, GBP, ...). Default to EUR unless user specifies otherwise.
- When the user mentions a foreign currency (USD, GBP, etc.) or an invoice in that currency:
  - Put the actual foreign amount on the expense/revenue line.
  - Put the exact base-currency (EUR) settlement amount on the cash/bank line.
  - On the *foreign* line include: currency, fxRateToBase (base/foreign), fxSource (prefer "BANK_FEED:<provider>" when known, else "MANUAL"), fxDate (YYYY-MM-DD).
- Bank/credit card feed rates are authoritative. If you have or can infer a feed-derived rate, use fxSource starting with "BANK_FEED:".
- Never silently convert; always surface the original currency + the fx metadata on the foreign line.
- Suggestions must be balanced in base currency after applying fxRateToBase.
- If the user mentions a vendor, merchant, company or "from X", extract it into a top-level "merchant" field on the suggestion (this helps automatic feed matching later).
- Always try to return a "merchant" when the transaction looks like it came from a specific supplier or client.

${feedRatesText ? feedRatesText + '\n' : ''}
${memoryText ? memoryText + '\n' : ''}
Use the above memory and feed rates when they are relevant. Prefer real BANK_FEED rates over published rates.

  You must output ONE structured intent using the following action vocabulary (exact strings only):

SAFE AUTONOMOUS (execute immediately if confidence high and server validation passes):
CREATE_JOURNAL, APPLY_TEMPLATE, CREATE_CONTACT, UPDATE_CONTACT,
CREATE_INVOICE_DRAFT, GENERATE_RECURRING_DRAFT,
MATCH_FEED_TRANSACTION, SYNC_FEED, IMPORT_FEED_CSV,
RECONCILE_ACCOUNT, LEARN_MERCHANT, OPEN_LEDGER, EXPLAIN

ALWAYS USE PROPOSE_* FORM (never auto-execute):
PROPOSE_RESTORE, PROPOSE_MERGE, PROPOSE_REVERSE, PROPOSE_TAG_CLOSE,
PROPOSE_SEND_INVOICE, PROPOSE_CHARGE, PROPOSE_BULK_REVERSE, PROPOSE_IMPORT_BACKUP,
PROPOSE_CREATE_ACCOUNT, PROPOSE_UPDATE_TAX_RATE, PROPOSE_UPDATE_SETTINGS, PROPOSE_USER_CHANGE

Examples:
- "add shareholder loan of 800 USD" → {"action":"CREATE_JOURNAL","confidence":0.95,"params":{"description":"shareholder loan","lines":[{"accountCode":"1000","debit":800,"currency":"USD"},{"accountCode":"2500","credit":800,"currency":"USD"}]}}
- "add ACME Corp as customer" → {"action":"CREATE_CONTACT","confidence":0.9,"params":{"name":"ACME Corp","type":"CUSTOMER"}}
- "draft invoice John for 450 consulting" → {"action":"CREATE_INVOICE_DRAFT","confidence":0.92,"params":{"description":"Consulting","amount":450,"contactName":"John"}}
- "restore to 2026-06-15" → {"action":"PROPOSE_RESTORE","confidence":0.8,"params":{"target":"2026-06-15"}}
- "merge ai-june into main" → {"action":"PROPOSE_MERGE","confidence":0.85,"params":{"sourceBranch":"ai-june"}}

Return exactly one JSON object with: action, confidence (0-1), reasoning (short), params, branch (use "${requestedBranch}").
Current view: branch=${requestedBranch}${requestedAsOf ? ` asOf=${requestedAsOf}` : ''}

You are an autonomous junior bookkeeper. Execute routine safe work directly. Always propose (never execute) anything destructive, money-moving, or that changes master data/config.
 `

    // -----------------------------------------------------------------
    // TWO-PASS FLOW (Intelligence → Exact Structure → Validate → Dispatch)
    // Pass 1: broad understanding + candidate action (natural language cleanup)
    // Pass 2: repack the understanding into the exact schema for the action
    // Then: schema + business validation before any dispatch/execution
    // -----------------------------------------------------------------
    let usedTwoPass = false
    try {
      // Pass 1 – Intelligence / Understanding (now supports compound intents + FX)
      const pass1Prompt = `You are an intelligent accounting assistant.

Context:
- Accounts: ${accountList}
- Tax rates: ${taxContext}
- Company region/country: ${companyRegion || 'unknown'} / ${companyCountry || 'unknown'}
  ${feedRatesText ? feedRatesText + '\n' : ''}${memoryText ? memoryText + '\n' : ''}

CONTACTS (exact names to use for contactName / contactId resolution):
${contactsContext}

User said: "${lastMessage}"

Multi-currency + FX (very important):
- Detect foreign currency mentions ($, USD, GBP, €, etc.) and pairs like "5 USD ... credited with 4.23 EUR".
- In the understanding, clearly state the foreign amount+currency and the exact base settlement amount when both are given.

Compound / multi-sentence handling:
- If the message contains multiple distinct events or transactions ("then", "also", multiple sentences, separate actions), output MULTIPLE separate actions.
- Each action represents one logical operation (one journal, one contact, one invoice, etc.).
- Do NOT merge unrelated events into a single journal.

Your job:
- For every distinct event, pick the single best Action from the list below.
- For each, write a precise "understanding" that preserves amounts, currencies, FX details, account hints, and what happened.

Action list (exact strings):
SAFE AUTONOMOUS: CREATE_JOURNAL, CREATE_CONTACT, UPDATE_CONTACT, CREATE_INVOICE_DRAFT, GENERATE_RECURRING_DRAFT, MATCH_FEED_TRANSACTION, RECONCILE_ACCOUNT, APPLY_TEMPLATE, OPEN_LEDGER, EXPLAIN, SYNC_FEED, IMPORT_FEED_CSV, LEARN_MERCHANT
ALWAYS PROPOSE: PROPOSE_RESTORE, PROPOSE_MERGE, PROPOSE_REVERSE, PROPOSE_SEND_INVOICE, PROPOSE_CHARGE, PROPOSE_BULK_REVERSE, PROPOSE_IMPORT_BACKUP, PROPOSE_CREATE_ACCOUNT, PROPOSE_UPDATE_TAX_RATE, PROPOSE_UPDATE_SETTINGS, PROPOSE_USER_CHANGE, PROPOSE_TAG_CLOSE
Unclear: no action (do not output any action; just stream a normal chat response)

Return EXACTLY this shape (always an array):
{
  "actions": [
    {"action": "CREATE_JOURNAL", "understanding": "string with amounts + currencies + FX if any", "confidence": 0.0-1.0, "reasoning": "short"},
    ...
  ]
}

Even for a single event, put it inside an array under "actions".`

      const { object: p1 } = await generateObject({
        model,
        schema: Pass1Schema,
        prompt: pass1Prompt,
      })

      const actionItems: any[] = Array.isArray((p1 as any)?.actions) ? (p1 as any).actions : []

      if (actionItems.length > 0) {
        let lastResult: any = null

        for (const item of actionItems) {
          const rawAction = String(item?.action || '').trim().toUpperCase().replace(/[-\s]/g, '_')
          const actionParse = ActionType.safeParse(rawAction)
          if (!actionParse.success) continue

          const chosenAction: ActionType = actionParse.data
          const schema = getSchemaForAction(chosenAction)
          if (!schema) continue

          // Rich reference data for resolution (names → codes/IDs)
          const referenceBlock = `
REFERENCE DATA — USE FOR RESOLUTION (exact values only):
ACCOUNTS (code — name (type)):
${accountList}

TAX RATES (id — jurisdiction name rate type):
${taxContext}

COMPANY:
- Region: ${companyRegion || 'unknown'}
- Country: ${companyCountry || 'unknown'}

    ${feedRatesText ? 'BANK FEED RATES (for FX resolution):\n' + feedRatesText + '\n' : ''}
    ${memoryText ? 'MERCHANT MEMORY:\n' + memoryText + '\n' : ''}

CONTACTS (exact names — resolve contactName / contactId from this list only):
${contactsContext}`.trim()

          const pass2Prompt = `You are packing an exact structured object for the action: ${chosenAction}.

SOURCE MATERIAL:
- Your previous understanding: ${item?.understanding || ''}
- Original user request: ${lastMessage}

${referenceBlock}

Company base currency: ${baseCurrency}

Use ONLY names/IDs that appear in the REFERENCE DATA above (ACCOUNTS, TAX RATES, CONTACTS).

For CREATE_INVOICE_DRAFT:
- Choose the exact contactName from the CONTACTS list that best matches the request (e.g. "ToT Company" must match a real name exactly or very closely).
- Prefer exact or very close name match from the provided list. Do not invent a different company.
- If lines are not provided, produce at least one line with description and unitPrice using the amount from the request.
- Set currency to the currency mentioned by the user or default to ${baseCurrency}.
- description should capture the service/item (e.g. "webdesign").

Output ONLY the exact JSON object matching the target schema. No extra text.`

          try {
            let packed = await (async () => {
              const { object } = await generateObject({
                model,
                schema: schema as any,
                prompt: pass2Prompt,
              })
              return object
            })()

            // Post-Pass2 resolution for CREATE_INVOICE_DRAFT: guarantee the correct contact
            // (exact name match from the contacts list provided to the model).
            if (chosenAction === 'CREATE_INVOICE_DRAFT' && packed) {
              const p: any = packed
              if (!p.contactId && p.contactName) {
                const name = String(p.contactName).trim()
                let found = await prisma.contact.findFirst({ where: { name } })
                if (!found) {
                  found = await prisma.contact.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } })
                }
                if (!found) {
                  const candidates = await prisma.contact.findMany({ select: { id: true, name: true } })
                  const lname = name.toLowerCase()
                  const match = candidates.find(c => c.name.toLowerCase() === lname) ||
                                candidates.find(c => c.name.toLowerCase().includes(lname)) ||
                                candidates.find(c => lname.includes(c.name.toLowerCase()))
                  if (match) found = { id: match.id, name: match.name } as any
                }
                if (found) {
                  p.contactId = found.id
                  p.contactName = found.name
                }
              }
            }

            // -----------------------------------------------------------------
            // FX repair for CREATE_JOURNAL (after model packing, before validation)
            // Strong safety net for the exact pattern the user is hitting:
            // "add a 80$ USD expense on the credit card. it show up as 78€ on the creditcard statement"
            //
            // We extract the two amounts + currencies from the source text and force
            // a correct FX journal structure:
            //   - Expense line: foreign amount + foreign currency + fxRateToBase
            //   - Card line: exact base amount + EUR
            // This guarantees the FX-aware balance check in validateJournalIntent will pass.
            // -----------------------------------------------------------------
            if (chosenAction === 'CREATE_JOURNAL' && packed && Array.isArray((packed as any).lines)) {
              const lines: any[] = (packed as any).lines
              const baseCur = 'EUR'
              const srcText = `${item?.understanding || ''} ${lastMessage || ''}`.toLowerCase()

              // Parse explicit foreign + base pair from the user's words
              let foreignAmt = 0
              let baseAmt = 0
              let foreignCur = 'USD'

              // Prefer explicit "$80 USD ... 78€" style
              const usdNum = srcText.match(/\$?\s*([\d.,]+)\s*(usd|dollar)?/i)
              const eurNum = srcText.match(/€?\s*([\d.,]+)\s*(eur|euro)?/i)

              if (usdNum) foreignAmt = parseFloat(usdNum[1].replace(',', '.'))
              if (eurNum) baseAmt = parseFloat(eurNum[1].replace(',', '.'))

              // If we only got one number or they are the same, try a more general "two amounts" extraction
              if (!foreignAmt || !baseAmt || Math.abs(foreignAmt - baseAmt) < 0.01) {
                const nums = Array.from(srcText.matchAll(/([\d.,]+)/g))
                  .map(m => parseFloat(m[1].replace(',', '.')))
                  .filter(n => n > 0)
                  .sort((a, b) => b - a)

                if (nums.length >= 2) {
                  // The larger raw number is usually the foreign one in these prompts
                  foreignAmt = nums[0]
                  baseAmt = nums[1]
                }
              }

              if (foreignAmt > 0 && baseAmt > 0 && foreignAmt !== baseAmt) {
                // Find the two relevant lines (prefer the ones with matching amounts)
                let expLine = lines.find(l => Math.abs((Number(l?.debit) || 0) - foreignAmt) < 0.5)
                let payLine = lines.find(l => Math.abs((Number(l?.credit) || 0) - baseAmt) < 0.5)

                // Fallbacks if amount matching was off
                if (!expLine) expLine = lines.find(l => (Number(l?.debit) || 0) > 0)
                if (!payLine) payLine = lines.find(l => (Number(l?.credit) || 0) > 0)

                if (expLine && payLine) {
                  // Force the foreign side
                  expLine.debit = foreignAmt
                  expLine.credit = 0
                  expLine.currency = foreignCur
                  expLine.fxRateToBase = Number((baseAmt / foreignAmt).toFixed(6))
                  expLine.fxSource = expLine.fxSource || 'MANUAL'
                  expLine.fxDate = (typeof expLine.fxDate === 'string' && expLine.fxDate.length === 10) ? expLine.fxDate : new Date().toISOString().slice(0, 10)

                  // Force the base side
                  payLine.credit = baseAmt
                  payLine.debit = 0
                  payLine.currency = baseCur

                  // Make sure description is reasonable if missing
                  if (!expLine.description) expLine.description = 'Expense'
                  if (!payLine.description) payLine.description = 'Credit card'
                }
              }
            }

            let validationOk = true
            let validationError: string | undefined

            if (chosenAction === 'CREATE_JOURNAL') {
              const v = await (await import('@/lib/chat/dispatcher')).validateJournalIntent(packed, requestedBranch)
              if (!v.ok) {
                validationOk = false
                validationError = v.error
              }
            } else if (chosenAction === 'CREATE_CONTACT' || chosenAction === 'UPDATE_CONTACT') {
              const v = await (await import('@/lib/chat/dispatcher')).validateContactIntent(packed)
              if (!v.ok) {
                validationOk = false
                validationError = v.error
              }
            } else if (chosenAction === 'PROPOSE_RESTORE') {
              const target = (packed as any)?.target
              if (target) {
                const v = await (await import('@/lib/chat/dispatcher')).validateRestoreTarget(target, requestedBranch)
                if (!v.ok) {
                  validationOk = false
                  validationError = v.error
                }
              }
            } else if (chosenAction === 'CREATE_INVOICE_DRAFT') {
              const v = await (await import('@/lib/chat/dispatcher')).validateInvoiceDraftIntent(packed)
              if (!v.ok) {
                validationOk = false
                validationError = v.error
              } else if (v.resolvedContactId) {
                ;(packed as any).contactId = v.resolvedContactId
                if (v.resolvedContactName) (packed as any).contactName = v.resolvedContactName
              }
            }

            if (validationOk) {
              const packedParams = { ...(packed as any || {}) }

              // Ensure a useful description for the journal (and thus the chat response).
              // Prefer explicit description from Pass 2, then the rich understanding from Pass 1.
              if (chosenAction === 'CREATE_JOURNAL' && !packedParams.description) {
                packedParams.description = item?.understanding || lastMessage
              }

              const cleanIntent: ChatIntent = {
                action: chosenAction,
                confidence: item?.confidence ?? 0.75,
                reasoning: item?.reasoning || item?.understanding,
                params: packedParams,
                branch: requestedBranch,
                asOf: requestedAsOf,
              }

              usedTwoPass = true

              const dispatchResult = await runDispatch(cleanIntent, {
                chatLocked,
                currentBranch: requestedBranch,
                currentAsOf: requestedAsOf,
              })

              const payload: any = {
                response: dispatchResult.response,
                executed: dispatchResult.executed,
                proposed: dispatchResult.proposed,
                action: dispatchResult.action,
                entityId: dispatchResult.entityId,
                branch: dispatchResult.branch || requestedBranch,
                asOf: dispatchResult.asOf || requestedAsOf,
                eventId: dispatchResult.eventId,
              }
              if (dispatchResult.createdAutonomously) payload.createdAutonomously = true
              if (dispatchResult.reconciled) payload.reconciled = dispatchResult.reconciled
              if (dispatchResult.openLedger) payload.openLedger = dispatchResult.openLedger
              if (dispatchResult.proposedAction) payload.proposedAction = dispatchResult.proposedAction
              if (dispatchResult.error) payload.error = dispatchResult.error

              if (dispatchResult.proposed && item?.understanding) {
                payload.understanding = item.understanding
              }

              lastResult = payload
            } else {
              lastResult = {
                response: validationError
                  ? `Understood: ${item?.understanding}. Cannot proceed: ${validationError}`
                  : `Understood: ${item?.understanding}. Validation failed.`,
                proposed: true,
                action: chosenAction,
                understanding: item?.understanding,
              }
            }
          } catch (inner) {
            console.log('two-pass per-action error', chosenAction, inner)
          }
        }

        if (lastResult) {
          return Response.json(lastResult)
        }
      }
    } catch (twoPassErr) {
      console.log('Two-pass flow error, falling back', twoPassErr)
    }

    // Legacy suggestion path removed. Two-pass is the only path for structured actions.
    // Non-action messages fall through to plain stream below.

    // If we have attached files, inject their content into the prompt so the LLM can read them.
    let promptForStream = lastMessage
    if (attachedFiles.length > 0) {
      const parts: string[] = []
      for (const f of attachedFiles) {
        // Only text-extractable things we care about right now: PDFs and plain text.
        // For images we just tell the model we attached a file (vision not enabled here).
        if (f.mimeType.includes('pdf') || f.mimeType.startsWith('text/')) {
          try {
            // Use the same robust pdfjs path for PDFs that we use elsewhere.
            if (f.mimeType.includes('pdf')) {
              const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs')
              if (pdfjs.GlobalWorkerOptions) {
                pdfjs.GlobalWorkerOptions.workerSrc = 'data:application/javascript,'
                pdfjs.GlobalWorkerOptions.workerPort = null
              }
              const task = pdfjs.getDocument({ data: new Uint8Array(f.buffer), disableWorker: true, workerPort: null, isEvalSupported: false, verbosity: 0 })
              const doc = await task.promise
              let txt = ''
              for (let p = 1; p <= doc.numPages; p++) {
                const page = await doc.getPage(p)
                const c = await page.getTextContent()
                txt += (c.items || []).map((it: any) => it?.str || '').join(' ') + '\n'
              }
              await doc.destroy?.().catch(() => {})
              parts.push(`[ATTACHMENT: ${f.name}]\n${txt.trim()}`)
            } else {
              parts.push(`[ATTACHMENT: ${f.name}]\n${f.buffer.toString('utf8')}`)
            }
          } catch {
            parts.push(`[ATTACHMENT: ${f.name}] (could not read content)`)
          }
        } else {
          parts.push(`[ATTACHMENT: ${f.name}] (binary file attached)`)
        }
      }
      promptForStream = `${lastMessage}\n\n${parts.join('\n\n')}`
    }

    // For non-transactions, stream the response
    const result = await streamText({ model, system, prompt: promptForStream })
    return result.toTextStreamResponse()
  } catch (e) {
    console.error('chat error', e)
    return Response.json({ response: 'Chat temporarily unavailable.' })
  }
}
