import { NextRequest } from 'next/server'
import { streamText, generateObject, generateText } from 'ai'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getRecentFeedRatesPromptText } from '@/lib/recentFeedRates'
import { getMerchantMemoryPrompt } from '@/lib/agentMemory'
import { getLlmConfig, createLlmModel } from '@/lib/llm'
import { getCompanyProfile } from '@/lib/companyProfile'
import { ChatIntent, ActionType, getSchemaForAction } from '@/lib/chat/intent'
import { dispatchIntent as runDispatch } from '@/lib/chat/dispatcher'
import { generateAdvisoryResponse, buildAdvisorySystemPrompt } from '@/lib/chat/advisory'
import { decideChatMode } from '@/lib/chat/mode'
import { MemoryVault } from '@/lib/memoryVault'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
// chatMode is sent as 'advisor' | 'execution' (string). We keep a local union for clarity.

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
    let chatMode: 'advisor' | 'execution' | undefined
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
      const modeFromForm = (form.get('chatMode') as string | null)?.toLowerCase()
      if (modeFromForm === 'advisor' || modeFromForm === 'execution') chatMode = modeFromForm
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
      const modeFromJson = (jsonBody?.chatMode as string | undefined)?.toLowerCase()
      if (modeFromJson === 'advisor' || modeFromJson === 'execution') chatMode = modeFromJson
      branch = jsonBody?.branch || 'main'
      asOf = jsonBody?.asOf

      // Capture direct approved intent for confirmation UI (JSON path)
      if (jsonBody?.intent && typeof jsonBody.intent === 'object') {
        ;(globalThis as any).__pendingDirectIntent = jsonBody.intent
      }
    }

    // Effective mode: explicit chatMode wins. Fallback to chatLocked (advisor) or execution.
    const effectiveMode: 'advisor' | 'execution' = chatMode ?? (chatLocked ? 'advisor' : 'execution')

    const lastMessage = (messages[messages.length - 1]?.content || '').toString()

    // Requests go through an early lightweight mode decision first.
    // Pure questions (tax, profit, hypotheticals, advice, explanations) bypass two-pass completely.
    // Only clear executable commands go through the strict two-pass + validation path.
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
      if (effectiveMode === 'advisor') {
        return Response.json({ response: 'Actions are disabled in advisor mode.' })
      }
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

    // No server-side parsing for merchant hints (or anything else).
    // Let the LLM handle extraction and reasoning from the provided context.
    const preliminaryMerchant = ''

    // Authoritative company profile (single source for tax + context)
    const companyProfile = await getCompanyProfile()
    const companyRegion = companyProfile.region
    const companyCountry = companyProfile.country
    const baseCurrency = companyProfile.baseCurrency

    // Seed authoritative facts into Memory Vault so advisory path always has them.
    // This is the "app-provided facts" mechanism.
    try {
      await MemoryVault.ensureCompanyFacts(companyProfile)
    } catch {}

    // Phase 2: inject memory (now keyed on merchant + region) + feed rates
    const [feedRatesText, memoryText] = await Promise.all([
      getRecentFeedRatesPromptText(6),
      getMerchantMemoryPrompt(preliminaryMerchant || undefined, companyRegion),
    ])

    // -----------------------------------------------------------------
    // EXPLICIT MODE FROM CLIENT (primary control)
    // 'advisor'  -> single generation, direct answer, no actions, no two-pass
    // 'execution'-> strict two-pass + validation + dispatcher
    // The icon toggle in the UI is the authoritative switch.
    // -----------------------------------------------------------------
    if (effectiveMode === 'advisor') {
      // Advisory mode: single main call.
      // When files are attached, ALWAYS send the raw PDF/image bytes directly to the LLM
      // in this primary call (no local extraction, no secondary calls with files).
      // Same principle as execution Pass 1.
      if (attachedFiles.length > 0) {
        let vaultItems: any[] = []
        try {
          const companyFacts = await Promise.all([
            MemoryVault.get('company', 'company.region'),
            MemoryVault.get('company', 'company.country'),
            MemoryVault.get('company', 'company.baseCurrency'),
            MemoryVault.get('company', 'company.defaultTaxJurisdiction'),
          ])
          vaultItems = companyFacts.filter(Boolean) as any[]
          const recent = await MemoryVault.listByScope('company')
          vaultItems.push(...recent.slice(0, 5))
        } catch {}

        const advisoryCtx = {
          companyProfile,
          accountList,
          taxContext,
          balances,
          feedRatesText,
          memoryText,
          recentConversation: messages.slice(-8),
          vaultItems: vaultItems.length ? vaultItems : undefined,
        }

        const system = buildAdvisorySystemPrompt(advisoryCtx)

        const textPart = `User question / instruction: ${lastMessage || '(no text, just analyze the document)'}

The attached file(s) are raw PDF or image documents. Read them completely and directly (do not rely on any pre-extracted text).

Extract all key facts from the document(s):
- Merchant / vendor / issuer name
- Document / invoice / reference number
- Dates (issue, due, period)
- Line items, quantities, prices
- Amounts in original currency + any charged/settled amount and currency
- Tax amounts/rates if shown
- Totals
- Payment method or status hints (e.g. "paid via credit card", "charged automatically")

Then answer the user's question using the document content + the company context (tax rates, accounts, base currency, location, memory).

Be precise. Quote numbers and details from the document. If the user asks for advice, bookkeeping impact, or tax implications, use the provided configured rates and accounts.

If nothing actionable is clear, just give a clear analysis of what the document contains.`

        const content: any[] = [{ type: 'text', text: textPart }]
        for (const f of attachedFiles) {
          if (f.mimeType.includes('pdf') || f.mimeType.startsWith('image/')) {
            content.push({
              type: 'file',
              data: new Uint8Array(f.buffer),
              mediaType: f.mimeType,
              filename: f.name,
            })
          }
        }

        // Primary (and only) advisory call with raw file bytes.
        const { text } = await generateText({
          model,
          system,
          messages: [{ role: 'user', content }]
        })

        return Response.json({ response: text?.trim() || 'Document received and analyzed.' })
      }

      // No files: normal advisory text-only path
      let vaultItems: any[] = []
      try {
        const companyFacts = await Promise.all([
          MemoryVault.get('company', 'company.region'),
          MemoryVault.get('company', 'company.country'),
          MemoryVault.get('company', 'company.baseCurrency'),
          MemoryVault.get('company', 'company.defaultTaxJurisdiction'),
        ])
        vaultItems = companyFacts.filter(Boolean) as any[]
        const recent = await MemoryVault.listByScope('company')
        vaultItems.push(...recent.slice(0, 5))
      } catch {}

      const advisory = await generateAdvisoryResponse(lastMessage, {
        companyProfile,
        accountList,
        taxContext,
        balances,
        feedRatesText,
        memoryText,
        recentConversation: messages.slice(-8),
        vaultItems: vaultItems.length ? vaultItems : undefined,
      })
      return Response.json(advisory)
    }

    // Execution mode continues below to the strict two-pass path.
    // (The old system prompt below is only reached for execution intents.)

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
RECONCILE_ACCOUNT, LEARN_MERCHANT, OPEN_LEDGER

ALWAYS USE PROPOSE_* FORM (never auto-execute):
PROPOSE_RESTORE, PROPOSE_MERGE, PROPOSE_REVERSE, PROPOSE_TAG_CLOSE,
PROPOSE_SEND_INVOICE, PROPOSE_CHARGE, PROPOSE_BULK_REVERSE, PROPOSE_IMPORT_BACKUP,
PROPOSE_CREATE_ACCOUNT, PROPOSE_UPDATE_TAX_RATE, PROPOSE_UPDATE_SETTINGS, PROPOSE_USER_CHANGE

DO NOT OUTPUT ANY ACTION for pure questions:
- "tell me the tax on 40k profit", "how much tax would I pay", "estimate corporate tax", "what if I move to Alberta"
- Any tax/profit calculation, hypothetical, or "how does X work" question.
These must produce ZERO actions so they go to the direct advisory answer (never forced through Pass 2).

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
    // TWO-PASS FLOW — only executed when client icon is set to "execution".
    // Pure questions are handled above when effectiveMode === 'advisor'.
    // -----------------------------------------------------------------
    try {
      // Pass 1 – Intelligence / Understanding.
      // The main call. When PDF or image files are attached, we send the raw bytes
      // directly to the LLM (no local pdfjs, no pre-processing).
      // Pass 1's job is to read the document + user text and produce rich understanding.
      // It does NOT have to return structured actions.
      // Structuring (if needed) happens in Pass 2 later.
      // This path is used for both advisor mode and execution mode.

      let actionItems: any[] = []

      if (attachedFiles.length > 0) {
        // RAW FILE PATH (Pass 1): send the PDF/image exactly as received.
        // Grok 4.3 will extract the text accurately.
        const extractionPrompt = `You are an intelligent accounting assistant.

Context:
- Accounts: ${accountList}
- Tax rates: ${taxContext}
- Company region/country: ${companyRegion || 'unknown'} / ${companyCountry || 'unknown'}
  ${feedRatesText ? feedRatesText + '\n' : ''}${memoryText ? memoryText + '\n' : ''}

CONTACTS (exact names to use for contactName / contactId resolution):
${contactsContext}

User said: "${lastMessage}"

The attached file(s) are provided raw (PDF or image). Read them completely and accurately.
Extract every relevant detail:
- Merchant / vendor name, address, tax ID if present
- Invoice / reference / document number
- Dates (issue date, due date, service period)
- Line items with description, quantity, unit price
- Amounts in their original currency
- Any settlement / charged amount and currency (especially for credit card or bank payments)
- Tax amounts and rates
- Totals
- Payment method hints ("paid via credit card", "charged", "automatic payment", etc.)
- Any other notes or identifiers

Write a clear, complete, factual understanding that captures what the document is about.
If the user mentioned "paid via credit card" or similar, include that.

Output ONLY the understanding text. Do not output JSON or action names.`

        const content: any[] = [{ type: 'text', text: extractionPrompt }]
        for (const f of attachedFiles) {
          if (f.mimeType.includes('pdf') || f.mimeType.startsWith('image/')) {
            content.push({
              type: 'file',
              data: new Uint8Array(f.buffer),
              mediaType: f.mimeType,
              filename: f.name,
            })
          }
        }

        // Direct call with raw file bytes. This is the main intelligence call (Pass 1).
        const { text: extracted } = await generateText({
          model,
          messages: [{ role: 'user', content }]
        })

        const understanding = (extracted || '').trim()
        if (understanding) {
          // We got good extraction from the raw file.
          // For execution we will let the normal per-item logic run Pass 2 on it (to pack into schema).
          // We represent it as a candidate CREATE_JOURNAL with the rich understanding.
          // Pass 2 will turn the understanding into the exact structured object.
          actionItems = [{
            action: 'CREATE_JOURNAL',
            understanding,
            confidence: 0.85,
            reasoning: 'Raw document provided in Pass 1'
          }]
        }
      } else {
        // No attachments: original behaviour (structured intelligence pass)
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
SAFE AUTONOMOUS: CREATE_JOURNAL, CREATE_CONTACT, UPDATE_CONTACT, CREATE_INVOICE_DRAFT, GENERATE_RECURRING_DRAFT, MATCH_FEED_TRANSACTION, RECONCILE_ACCOUNT, APPLY_TEMPLATE, OPEN_LEDGER, SYNC_FEED, IMPORT_FEED_CSV, LEARN_MERCHANT
ALWAYS PROPOSE: PROPOSE_RESTORE, PROPOSE_MERGE, PROPOSE_REVERSE, PROPOSE_SEND_INVOICE, PROPOSE_CHARGE, PROPOSE_BULK_REVERSE, PROPOSE_IMPORT_BACKUP, PROPOSE_CREATE_ACCOUNT, PROPOSE_UPDATE_TAX_RATE, PROPOSE_UPDATE_SETTINGS, PROPOSE_USER_CHANGE, PROPOSE_TAG_CLOSE
Unclear / advisory / pure questions: NO ACTION (do not output any action)

CRITICAL RULE — PURE QUESTIONS MUST PRODUCE ZERO ACTIONS:
- Tax calculations, profit estimates, "how much tax on 40k", "what would I pay", "corporate tax in Germany/Alberta"
- Hypotheticals ("if I move to Canada"), general advice, bookkeeping explanations, "how does the app work"
- Any question that is NOT a direct command to CREATE, UPDATE, MATCH, RECONCILE, or PROPOSE a concrete change.

For any of the above, output:
{
  "actions": []
}

Do NOT choose EXPLAIN or any other action for these. They must fall through to the direct advisory answer.

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
        actionItems = Array.isArray((p1 as any)?.actions) ? (p1 as any).actions : []
      }

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
${contactsContext}

COMPANY DEFAULT COUNTRY (use this as the default addressCountry for contacts unless the user explicitly says a different country):
${companyCountry || 'DE'}

When the user says "change ... to Germany DE", "set country to DE", "update address to Germany", etc. for an existing contact name, you must output UPDATE_CONTACT (never CREATE_CONTACT) with the correct name and the new addressCountry.
`.trim()

          let pass2Prompt = `You are packing an exact structured object for the action: ${chosenAction}.

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

For CREATE_CONTACT or UPDATE_CONTACT:
- When the user says "change", "update", "set country to", "edit" + a name → use UPDATE_CONTACT with that exact name.
- Always include addressCountry as a 2-letter ISO code when an address country is mentioned.
- Prefer the company's default country when no other country is mentioned.

Output ONLY the exact JSON object matching the target schema. No extra text.`

          // Pure LLM path for CREATE_JOURNAL when we have a rich understanding
          // (from raw file in Pass 1, or from text-only Pass 1).
          // Pass 2 prompt gives the model the complete understanding text + user note.
          // Model must extract amounts/currencies/FX/merchant and emit the exact balanced journal.
          // Zero server-side parsing, regex, or arithmetic for amounts/FX.
          if (chosenAction === 'CREATE_JOURNAL' && item?.understanding) {
            const fullUnderstanding = item.understanding
            const today = new Date().toISOString().slice(0, 10)
            pass2Prompt = `You are packing an exact CREATE_JOURNAL object.

THE UNDERSTANDING BELOW IS THE COMPLETE, AUTHORITATIVE SOURCE (it came from the model reading the raw PDF/image bytes or the user's text). Treat it as ground truth. Extract every number, currency, merchant, reference, date, and line item from it literally.

UNDERSTANDING (source of truth):
${fullUnderstanding}

User note / additional instruction (this may give the actual charged/paid amount in base currency):
${lastMessage}

Company base currency: ${baseCurrency}
Use this date for fxDate: ${today}

REFERENCE DATA (exact values only):
ACCOUNTS:
${accountList}

TAX RATES:
${taxContext}

CONTACTS:
${contactsContext}

REQUIREMENTS:
- Read the foreign amount + currency directly from the UNDERSTANDING (e.g. $10.00 USD or 30.00 USD).
- Read the base amount the user actually paid/charged from the user note or understanding (e.g. 9€, 28€, "paid by credit card 9€").
- Output a balanced journal:
  - Debit line: expense/subscription/etc. for the foreign amount, with that currency, fxRateToBase = (base_paid / foreign_amount), fxSource="MANUAL", fxDate=${today}
  - Credit line: the payment account (credit cards 2100 when "credit card" / "charged", or bank/cash) for the exact base amount in EUR.
- After fxRateToBase, base-currency debits must equal base-currency credits (within 0.01).
- Include description at top level and on lines. Include merchant if present in the understanding.
- Use ONLY account codes and tax ids from the reference data above.

Example of the required shape (numbers must come from the UNDERSTANDING + note, not this example):
{
  "description": "Kilo Balance Top Up - VWMYPIAT-0038",
  "merchant": "Kilo Code",
  "lines": [
    { "accountCode": "6000", "debit": 10, "credit": 0, "currency": "USD", "fxRateToBase": 0.9, "fxSource": "MANUAL", "fxDate": "${today}", "description": "Kilo Balance Top Up" },
    { "accountCode": "2100", "debit": 0, "credit": 9, "currency": "EUR", "description": "Credit card" }
  ]
}

Return ONLY the JSON object for the schema. No extra text.`
          }

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

            // Pure LLM path only. No server-side amount/FX extraction or mutation.
            // Pass 2 prompt contains the full raw-document understanding + user note.
            // The model must produce the correct balanced journal (or we fall back to proposal).
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
              // On validation failure (e.g. FX balance), still surface as a PROPOSAL
              // so the journal editor opens as a last fallback for the user to correct
              // amounts, currencies, fxRateToBase, accounts, etc. manually.
              const packedParams = { ...(packed as any || {}) }
              if (chosenAction === 'CREATE_JOURNAL' && !packedParams.description) {
                packedParams.description = item?.understanding || lastMessage
              }

              lastResult = {
                response: validationError
                  ? `Understood: ${item?.understanding}. Cannot proceed: ${validationError}`
                  : `Understood: ${item?.understanding}. Validation failed.`,
                proposed: true,
                action: chosenAction,
                understanding: item?.understanding,
                params: packedParams,
                proposedAction: { type: chosenAction, params: packedParams },
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

    // No executable action produced by the main call.
    // The main intelligence call (Pass 1) already received any attached PDF/image raw.
    // No secondary/fallback LLM calls with files. Redundant broken paths removed.
    return Response.json({
      response: 'Understood. No accounting action was required from the provided information.'
    })
  } catch (e) {
    console.error('chat error', e)
    return Response.json({ response: 'Chat temporarily unavailable.' })
  }
}
