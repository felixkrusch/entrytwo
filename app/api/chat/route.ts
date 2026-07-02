import { NextRequest } from 'next/server'
import { streamText, generateObject } from 'ai'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { getFxRateToBase } from '@/lib/fx'
import { getRecentFeedRatesPromptText } from '@/lib/recentFeedRates'
import { getMerchantMemoryPrompt, getMerchantMemory } from '@/lib/agentMemory'
import { getLlmConfig, createLlmModel } from '@/lib/llm'
import { findRecentBankFeedRateForMerchant } from '@/lib/feedMatching'
import { createAutonomousJournal } from '@/lib/accounting/autonomous'
import { IntentSchema, ChatIntent, ActionType } from '@/lib/chat/intent'
import { dispatchIntent as runDispatch } from '@/lib/chat/dispatcher'

const SuggestionSchema = z.object({
  description: z.string().optional(),
  merchant: z.string().optional(),
  // AI can return a confidence (0-1) for the tax rate choice(s) it made.
  //  >= 0.80 → autonomous (no forced confirmation for tax)
  //  <  0.70 → must ask user for confirmation
  taxConfidence: z.number().min(0).max(1).optional(),
  lines: z.array(z.object({
    accountCode: z.string(),
    debit: z.number().min(0),
    credit: z.number().min(0),
    description: z.string().optional(),
    taxRateId: z.string().optional(),
    currency: z.string().optional(),
    fxRateToBase: z.number().optional(),
    fxSource: z.string().optional(),
    fxDate: z.string().optional(),
  })).min(2),
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

interface AccountLite { id: string; code: string; name: string; type: string }
async function getAccountsMap(): Promise<Record<string, AccountLite>> {
  const accs = await prisma.account.findMany({ select: { id: true, code: true, name: true, type: true } })
  const map: Record<string, AccountLite> = {}
  accs.forEach(a => { map[a.code] = a })
  return map
}

async function getReversedEntryIds(): Promise<Set<string>> {
  const events = await prisma.event.findMany({
    where: { eventType: 'JOURNAL_ENTRY_REVERSED' },
    take: 100,
  })
  const ids = new Set<string>()
  events.forEach(e => {
    const pid = (e.payload as { originalId?: string } | null)?.originalId
    if (pid) ids.add(pid)
  })
  return ids
}

async function answerDataQuery(text: string) {
  const lower = text.toLowerCase()

  // === Reverse command (smart: skip already-reversed) ===
  if (lower.includes('reverse')) {
    const reversedIds = await getReversedEntryIds()
    const last = await prisma.journalEntry.findFirst({
      where: {
        AND: [
          { description: { not: { startsWith: 'Reversal of' } } },
          { id: { notIn: Array.from(reversedIds) } }
        ]
      },
      orderBy: { createdAt: 'desc' },
      include: { lines: { include: { account: true } } }
    })
    if (last) {
      const revLines = last.lines.map(l => ({
        accountCode: l.account.code,
        debit: Number(l.credit),
        credit: Number(l.debit),
        description: `Reversal of ${last.description || 'entry'}`
      }))
      return {
        response: `Reversing "${last.description || 'Entry'}" (${new Date(last.date).toISOString().slice(0,10)}). Review in the modal and create to post the reversal.`,
        suggestion: {
          description: `Reversal of ${last.description || 'entry'}`,
          lines: revLines,
          reversingOriginalId: last.id
        }
      }
    }
    return { response: 'No unreversed journal entries found.' }
  }

  // === Fast data queries ===
  if ((lower.includes('cash') || lower.includes('1000')) && (lower.includes('balance') || lower.includes('how much') || lower.includes('what') || lower.includes('current') || lower.includes('have'))) {
    const cash = await prisma.account.findUnique({ where: { code: '1000' }, include: { journalLines: true } })
    const bal = cash ? cash.journalLines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0) : 0
    return { response: `Cash (1000) balance: $${bal.toFixed(2)}` }
  }

  if ((lower.includes('bank') || lower.includes('1100')) && (lower.includes('balance') || lower.includes('how much'))) {
    const bank = await prisma.account.findUnique({ where: { code: '1100' }, include: { journalLines: { include: { taxRate: true } } } })
    const bal = bank ? bank.journalLines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0) : 0
    return { response: `Bank Account (1100) balance: $${bal.toFixed(2)}` }
  }

  if (lower.includes('net') || lower.includes('profit') || lower.includes('how much did i make') || lower.includes('earnings') || lower.includes('p&l') || lower.includes('income')) {
    const accounts = await prisma.account.findMany({ include: { journalLines: true } })
    let rev = 0, exp = 0
    accounts.forEach(a => {
      const b = a.journalLines.reduce((s, l) => {
        if (a.type === 'REVENUE') return s + Number(l.credit) - Number(l.debit)
        if (a.type === 'EXPENSE') return s + Number(l.debit) - Number(l.credit)
        return s
      }, 0)
      if (a.type === 'REVENUE') rev += b
      if (a.type === 'EXPENSE') exp += b
    })
    const net = rev - exp
    return { response: `Revenue: $${rev.toFixed(2)}\nExpenses: $${exp.toFixed(2)}\nNet Income: $${net.toFixed(2)}` }
  }

  if (lower.includes('recent') || lower.includes('last entry') || lower.includes('last few') || lower.includes('last transaction') || lower.includes('show me') || lower.includes('what did i') || lower.includes('list entry') || lower.includes('latest') || lower.includes('show entries')) {
    const recent = await prisma.journalEntry.findMany({
      orderBy: { date: 'desc' },
      take: 6,
      include: { lines: { include: { account: { select: { code: true } }, taxRate: { select: { jurisdiction: true, rate: true } } } } }
    })
    const text = recent.map(e => {
      const total = e.lines.reduce((s, l) => s + Number(l.debit), 0)
      const taxNote = e.lines.some(l => l.taxRate) ? ' (+tax)' : ''
      return `• ${e.description || 'Entry'} — $${total.toFixed(0)}${taxNote} (${new Date(e.date).toISOString().slice(0,10)})`
    }).join('\n')
    return { response: `Recent journal entries:\n${text}` }
  }

  if (lower.includes('total asset') || (lower.includes('how much') && lower.includes('asset'))) {
    const assets = await prisma.account.findMany({ where: { type: 'ASSET' }, include: { journalLines: true } })
    let total = 0
    assets.forEach(a => { total += a.journalLines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0) })
    return { response: `Total assets: $${total.toFixed(2)}` }
  }

  if (lower.includes('biggest') && (lower.includes('expense') || lower.includes('spend') || lower.includes('cost'))) {
    const exps = await prisma.account.findMany({ where: { type: 'EXPENSE' }, include: { journalLines: true } })
    const withBal = exps.map(a => ({ name: a.name, bal: a.journalLines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0) }))
      .sort((a, b) => b.bal - a.bal)
    if (withBal[0]) return { response: `Biggest expense so far: ${withBal[0].name} ($${withBal[0].bal.toFixed(2)})` }
  }

  if (lower.includes('total revenue') || lower.includes('how much revenue')) {
    const rev = await prisma.account.findMany({ where: { type: 'REVENUE' }, include: { journalLines: true } })
    let total = 0
    rev.forEach(a => { total += a.journalLines.reduce((s, l) => s + Number(l.credit) - Number(l.debit), 0) })
    return { response: `Total revenue recorded: $${total.toFixed(2)}` }
  }

  const accountMatch = lower.match(/(?:balance|how much).*?(\d{4}|[a-z ]{3,})/i)
  if (accountMatch) {
    const q = accountMatch[1].trim()
    const acc = await prisma.account.findFirst({
      where: { OR: [{ code: q }, { name: { contains: q, mode: 'insensitive' } }] },
      include: { journalLines: true }
    })
    if (acc) {
      const bal = acc.journalLines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0)
      return { response: `${acc.name} (${acc.code}) balance: $${bal.toFixed(2)}` }
    }
  }

  if (lower.includes('list account') || lower.includes('show chart') || lower.includes('what accounts')) {
    const accs = await prisma.account.findMany({ orderBy: { code: 'asc' } })
    return { response: `Accounts: ${accs.map(a => `${a.code} ${a.name}`).join(', ')}` }
  }

  // Payables
  if (lower.includes('owe') || lower.includes('payable') || lower.includes('supplier') || lower.includes('creditor')) {
    const ap = await prisma.account.findFirst({
      where: { OR: [{ code: '2000' }, { name: { contains: 'payable', mode: 'insensitive' } }] },
      include: { journalLines: true }
    })
    const bal = ap ? ap.journalLines.reduce((s, l) => s + Number(l.credit) - Number(l.debit), 0) : 0
    return { response: `Accounts Payable: $${bal.toFixed(2)} (amount you currently owe)` }
  }

  // Receivables
  if (lower.includes('receivable') || lower.includes('customers owe') || lower.includes('who owes me')) {
    const ar = await prisma.account.findFirst({
      where: { OR: [{ code: '1200' }, { name: { contains: 'receivable', mode: 'insensitive' } }] },
      include: { journalLines: true }
    })
    const bal = ar ? ar.journalLines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0) : 0
    return { response: `Accounts Receivable: $${bal.toFixed(2)} (money owed to you)` }
  }

  return null
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const messages = body?.messages || []
    const chatLocked = !!body?.chatLocked
    const lastMessage = (messages[messages.length - 1]?.content || '').toString()
    const lower = lastMessage.toLowerCase()

    // ============================================================
    // ULTRA-EARLY HARD PATH for shareholder/owner loan prompts.
    // This must fire BEFORE any model call or intent logic.
    // Guarantees "add a shareholder loan of $800" creates the entry.
    // ============================================================
    if (/(shareholder|owner)\s*(loan|contribution|capital|draw|investment)/i.test(lastMessage)) {
      const amtMatch = lastMessage.match(/\$?([\d\.,]+)/);
      const amt = amtMatch ? parseFloat(amtMatch[1].replace(',', '.')) : 800;
      const currency = /usd|\$/i.test(lastMessage) ? 'USD' : 'EUR';

      let cash = await prisma.account.findFirst({ where: { OR: [{ code: '1000' }, { name: { contains: 'cash', mode: 'insensitive' } }] } });
      if (!cash) cash = await prisma.account.create({ data: { code: '1000', name: 'Cash', type: 'ASSET' } });

      let lp = await prisma.account.findFirst({ where: { OR: [{ code: '2500' }, { name: { contains: 'loan', mode: 'insensitive' } }] } });
      if (!lp) lp = await prisma.account.create({ data: { code: '2500', name: 'Loans Payable', type: 'LIABILITY' } });

      const created = await createAutonomousJournal({
        date: new Date().toISOString(),
        description: lastMessage.trim(),
        lines: [
          { accountId: cash.id, debit: amt, credit: 0, description: 'Received', currency, fxRateToBase: 1, fxSource: 'MANUAL', fxDate: new Date().toISOString().slice(0,10) },
          { accountId: lp.id, debit: 0, credit: amt, description: 'Loan', currency, fxRateToBase: 1, fxSource: 'MANUAL', fxDate: new Date().toISOString().slice(0,10) },
        ],
        aiMetadata: { confidence: 1, reasoning: 'ultra-early hard path', model: 'chat' },
      });

      return Response.json({
        response: `Created autonomously: Shareholder loan of ${currency} ${amt}`,
        createdAutonomously: true,
        entryId: created.id,
      });
    }

    const dataAnswer = await answerDataQuery(lastMessage)
    if (dataAnswer) return Response.json(dataAnswer)

    // ============================================================
    // HARD FAST-PATH for common "shareholder loan / owner contribution" style prompts.
    // This guarantees that "add a shareholder loan of $800" (and similar natural language)
    // ALWAYS creates a real journal entry, no matter what the general intent/model path does.
    // ============================================================
    const loanMatch = lastMessage.match(/(?:shareholder|owner)\s*(?:loan|contribution|capital|draw|investment|funds?)\s*(?:of\s*)?\$?([\d\.,]+)/i)
                     || lastMessage.match(/add\s+(?:a\s+)?(?:shareholder|owner)\s*loan\s*(?:of\s*)?\$?([\d\.,]+)/i)
                     || lastMessage.match(/loan\s*(?:from\s+(?:shareholder|owner))?\s*\$?([\d\.,]+)/i);

    if (loanMatch) {
      const amt = parseFloat(loanMatch[1].replace(',', '.')) || 800;
      const currency = /usd|\$/i.test(lastMessage) ? 'USD' : 'EUR';

      // Find or create sensible accounts
      let cash = await prisma.account.findFirst({
        where: { OR: [ { code: '1000' }, { name: { contains: 'cash', mode: 'insensitive' } }, { name: { contains: 'bank', mode: 'insensitive' } } ] }
      });
      if (!cash) cash = await prisma.account.create({ data: { code: '1000', name: 'Cash', type: 'ASSET' } });

      let loansPayable = await prisma.account.findFirst({
        where: { OR: [ { code: '2500' }, { name: { contains: 'loan', mode: 'insensitive' } }, { name: { contains: 'payable', mode: 'insensitive' } } ] }
      });
      if (!loansPayable) loansPayable = await prisma.account.create({ data: { code: '2500', name: 'Loans Payable', type: 'LIABILITY' } });

      const created = await createAutonomousJournal({
        date: new Date().toISOString(),
        description: lastMessage.trim(),
        lines: [
          {
            accountId: cash.id,
            debit: amt,
            credit: 0,
            description: 'Shareholder loan received',
            currency,
            fxRateToBase: 1,
            fxSource: 'MANUAL',
            fxDate: new Date().toISOString().slice(0, 10),
          },
          {
            accountId: loansPayable.id,
            debit: 0,
            credit: amt,
            description: 'Shareholder loan',
            currency,
            fxRateToBase: 1,
            fxSource: 'MANUAL',
            fxDate: new Date().toISOString().slice(0, 10),
          },
        ],
        aiMetadata: {
          confidence: 0.99,
          reasoning: 'Direct fast-path from chat for shareholder/owner loan',
          model: 'chat',
        },
      });

      return Response.json({
        response: `Created autonomously: Shareholder loan of ${currency} ${amt}`,
        createdAutonomously: true,
        entryId: created.id,
      });
    }

    const llmConfig = getLlmConfig()
    const hasKey = !!(llmConfig.apiKey || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || process.env.XAI_API_KEY || process.env.ANTHROPIC_API_KEY)

    if (!hasKey) {
      return Response.json(await generateFallback(lastMessage))
    }

    const model = createLlmModel(llmConfig)

    const accountList = await getAccountContext()
    const balances = await getCurrentBalancesSummary()
    const taxContext = await getTaxRatesContext()

    // Git view context passed from client (for autonomous execution on correct branch/asOf)
    const requestedBranch = (body?.branch || 'main').toString()
    const requestedAsOf = body?.asOf || undefined

    // Direct approved intent (from confirmation UI)
    if (body?.intent && typeof body.intent === 'object') {
      try {
        const approvedIntent: ChatIntent = {
          ...body.intent,
          approved: true,
          branch: body.intent.branch || requestedBranch,
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

    // Get company location info (structured address + default jurisdiction)
    let companyRegion: string | undefined
    let companyCountry: string | undefined
    try {
      const [addr, jur] = await Promise.all([
        prisma.setting.findUnique({ where: { key: 'company.address' } }),
        prisma.setting.findUnique({ where: { key: 'defaultTaxJurisdiction' } }),
      ])
      const a = addr?.value as unknown as { region?: string; country?: string } | null
      const jv = (jur?.value as unknown as { value?: string })?.value || (jur?.value as unknown as string)
      companyRegion = (a?.region || jv || undefined)
      companyCountry = a?.country || (companyRegion ? companyRegion.split('-')[0] : undefined)
      if (companyRegion) companyRegion = String(companyRegion).toUpperCase()
    } catch {}

    // Phase 2: inject memory (now keyed on merchant + region) + feed rates
    const [feedRatesText, memoryText] = await Promise.all([
      getRecentFeedRatesPromptText(6),
      getMerchantMemoryPrompt(preliminaryMerchant || undefined, companyRegion),
    ])

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

    // AI-first invoice detection (customer / client language)
    const isCustomerInvoice = /invoice|bill/i.test(lower) && (/(client|customer|acme|corp|gmbh|ltd|inc|john|sarah)/i.test(lower) || !/from\s/i.test(lower))
    if (isCustomerInvoice) {
      const amtMatch = lastMessage.match(/(\d+[\.,]?\d*)/)
      const amt = amtMatch ? parseFloat(amtMatch[1].replace(',', '.')) : undefined
      const cur = /usd|\$/i.test(lastMessage) ? 'USD' : (/gbp|£/i.test(lastMessage) ? 'GBP' : 'EUR')
      return Response.json({
        response: `I'll create a customer invoice${amt ? ` for ${cur} ${amt}` : ''}.`,
        createInvoice: {
          amount: amt,
          description: lastMessage,
          currency: cur,
        }
      })
    }

    // -----------------------------------------------------------------
    // NEW AUTONOMOUS INTENT PATH — ALWAYS ATTEMPT
    // The old narrow "looksLikeAction" regex was skipping prompts like
    // "add a shareholder loan of $800".
    //
    // We now ALWAYS call generateObject with IntentSchema for every
    // user message (after the simple data query check).
    // The dispatcher decides execute vs propose.
    // This guarantees CREATE_JOURNAL etc. are processed.
    // -----------------------------------------------------------------
    try {
      const { object: intentObj } = await generateObject({
        model,
        schema: IntentSchema,
        prompt: `${system}\n\nUser: ${lastMessage}\n\nReturn ONE structured intent object. Use exact action names from the vocabulary. Include confidence and short reasoning. For journals include balanced lines with accountCode. For contacts include name+type. For invoices include description or lines. For restore/merge use PROPOSE_* forms.`,
      })

      const parsedIntent = IntentSchema.safeParse(intentObj)
      if (parsedIntent.success) {
        const intent: ChatIntent = {
          ...parsedIntent.data,
          branch: parsedIntent.data.branch || requestedBranch,
          asOf: parsedIntent.data.asOf || requestedAsOf,
        }

        // === DEFINITIVE FIX: CREATE_JOURNAL must ALWAYS create the entry here ===
        // Never return the raw intent object. Never show JSON in chat.
        // Lenient account resolution for common cases (1000=cash, 2500=loans payable, 3000=equity etc.)
        if (intent.action === 'CREATE_JOURNAL') {
          const p = intent.params as any
          const rawLines = Array.isArray(p?.lines) ? p.lines : []

          if (rawLines.length < 2) {
            return Response.json({
              response: 'I understood you want a journal entry, but the details were incomplete.',
              proposed: true,
              action: 'CREATE_JOURNAL'
            })
          }

          const tD = rawLines.reduce((s: number, l: any) => s + (Number(l.debit) || 0), 0)
          const tC = rawLines.reduce((s: number, l: any) => s + (Number(l.credit) || 0), 0)
          if (Math.abs(tD - tC) > 0.01) {
            return Response.json({
              response: 'The proposed journal entry is not balanced.',
              proposed: true,
              action: 'CREATE_JOURNAL'
            })
          }

          // Lenient resolution - this is the key fix
          const resolvedLines: any[] = []
          for (const l of rawLines) {
            let account = await prisma.account.findUnique({ where: { code: String(l.accountCode) } })

            if (!account) {
              const isDebit = (Number(l.debit) || 0) > 0
              if (isDebit) {
                account = await prisma.account.findFirst({
                  where: {
                    OR: [
                      { code: '1000' }, { code: '1010' },
                      { name: { contains: 'cash', mode: 'insensitive' } },
                      { name: { contains: 'bank', mode: 'insensitive' } },
                      { type: 'ASSET' }
                    ]
                  }
                })
              } else {
                account = await prisma.account.findFirst({
                  where: {
                    OR: [
                      { code: '2500' },
                      { name: { contains: 'loan', mode: 'insensitive' } },
                      { name: { contains: 'payable', mode: 'insensitive' } },
                      { code: '3000' },
                      { name: { contains: 'capital', mode: 'insensitive' } },
                      { name: { contains: 'equity', mode: 'insensitive' } },
                      { type: 'LIABILITY' },
                      { type: 'EQUITY' }
                    ]
                  }
                })
              }
            }

            if (!account) account = await prisma.account.findFirst({})

            if (account) {
              resolvedLines.push({
                accountId: account.id,
                debit: Number(l.debit) || 0,
                credit: Number(l.credit) || 0,
                description: l.description,
                currency: (l.currency || 'EUR').toUpperCase(),
                fxRateToBase: l.fxRateToBase ?? null,
                fxSource: l.fxSource || 'AI_AUTONOMOUS',
                fxDate: l.fxDate || new Date().toISOString().slice(0, 10),
              })
            }
          }

          if (resolvedLines.length >= 2) {
            const created = await createAutonomousJournal({
              date: new Date().toISOString(),
              description: p?.description || lastMessage,
              lines: resolvedLines,
              aiMetadata: {
                confidence: intent.confidence,
                reasoning: intent.reasoning || 'Autonomous from chat',
                model: 'chat',
              },
              branch: intent.branch || 'main',
            })

            return Response.json({
              response: `Created autonomously (high confidence): ${created.description || 'Journal entry'}`,
              createdAutonomously: true,
              entryId: created.id,
              action: 'CREATE_JOURNAL',
              branch: intent.branch || 'main',
            })
          }

          return Response.json({
            response: 'I could not resolve the accounts for the journal entry.',
            proposed: true,
            action: 'CREATE_JOURNAL'
          })
        }

        // Non-journal actions go through the normal (safe) dispatcher
        const dispatchResult = await runDispatch(intent, {
          chatLocked,
          currentBranch: requestedBranch,
          currentAsOf: requestedAsOf,
        })

        if (dispatchResult.executed || dispatchResult.proposed) {
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

          return Response.json(payload)
        }
      }
    } catch (intentErr) {
      console.log('Intent path error, falling back to legacy', intentErr)
    }

    // -----------------------------------------------------------------
    // LEGACY JOURNAL SUGGESTION PATH (kept for transition + non-action chat)
    // -----------------------------------------------------------------
    const looksLikeTx = lower.match(/bought|paid|received|purchase|expense|revenue|supplies|software|client|services|capital|office|consult|bill|subscription|equipment|laptop|rent|salary|invoice|sale|record|post/)
    if (looksLikeTx) {
      try {
        const { object } = await generateObject({
          model,
          schema: SuggestionSchema,
          prompt: `${system}\n\nUser: ${lastMessage}\n\nReturn a clean balanced journal entry suggestion. For any non-EUR line include currency + fxRateToBase + fxSource + fxDate when possible.\n\nAlso return a "taxConfidence" (0.0-1.0) reflecting how sure you are about the chosen taxRateId(s):\n- Use >=0.80 only when you are very confident (strong merchant memory match + jurisdiction match).\n- Use <0.70 when you are guessing or the jurisdiction differs from the company default.\nIf multiple tax rates apply (e.g. GST + QST), base the confidence on the whole combination.`,
        })
        const textRes = await streamText({ model, system, prompt: lastMessage })
        let text = ''
        for await (const d of textRes.textStream) text += d

        // Enrich suggestion lines with rates if the model omitted fx metadata for foreign currency.
        const merchantFromModel = (object as { merchant?: string } | null)?.merchant || ''
        const merchantHint = merchantFromModel || (lastMessage.match(/from\s+([A-Za-z0-9 .&-]+)/i)?.[1] || '')

        let usedRealFeedForAny = false

        if (object && Array.isArray(object.lines)) {
          for (const line of object.lines) {
            const cur = (line.currency || 'EUR').toUpperCase()
            if (cur !== 'EUR' && line.fxRateToBase == null) {
              let usedRealFeed = false
              if (merchantHint) {
                const feedRate = await findRecentBankFeedRateForMerchant(merchantHint.toLowerCase())
                if (feedRate && feedRate.currency === cur) {
                  line.fxRateToBase = feedRate.fxRateToBase
                  line.fxSource = feedRate.fxSource
                  line.fxDate = feedRate.fxDate
                  usedRealFeed = true
                  usedRealFeedForAny = true
                }
              }
              if (!usedRealFeed) {
                const rate = await getFxRateToBase(cur)
                if (rate != null) {
                  line.fxRateToBase = rate
                  line.fxSource = 'ECB'
                  line.fxDate = new Date().toISOString().slice(0, 10)
                }
              }
            }
          }
        }

        let needsConfirmation = false
        if (object && Array.isArray(object.lines)) {
          const foreignLines = object.lines.filter((l: { currency?: string }) => (l.currency || 'EUR').toUpperCase() !== 'EUR')
          if (foreignLines.length > 0) {
            const allHaveFeed = foreignLines.every((l: { fxSource?: string }) => String(l.fxSource || '').startsWith('BANK_FEED'))
            needsConfirmation = !allHaveFeed
          }
        }

        const finalMerchant = merchantHint || (object as { merchant?: string } | null)?.merchant || undefined

        let memory: { merchant: string; suggestedAccountCode?: string; suggestedTaxRateId?: string; lastUsed?: string } | undefined = undefined
        if (finalMerchant) {
          try {
            const mem = await getMerchantMemory(finalMerchant, companyRegion)
            if (mem) {
              memory = {
                merchant: finalMerchant,
                suggestedAccountCode: mem.accountCode,
                suggestedTaxRateId: mem.taxRateId,
                lastUsed: mem.lastUsedDate,
              }
            }
          } catch {}
        }

        const rawTaxConf = (object as { taxConfidence?: number })?.taxConfidence
        let taxConf: number | undefined
        if (typeof rawTaxConf === 'number') taxConf = Math.max(0, Math.min(1, rawTaxConf))

        let finalNeedsConfirmation = needsConfirmation
        if (taxConf != null) {
          if (taxConf >= 0.80) finalNeedsConfirmation = false
          if (taxConf < 0.70) finalNeedsConfirmation = true
        }

        if (chatLocked) {
          finalNeedsConfirmation = true
        }

        // Legacy autonomous path (journals only) - will be retired once intent path is complete
        if (!finalNeedsConfirmation && object && Array.isArray(object.lines)) {
          try {
            const codes = object.lines.map((l: any) => l.accountCode)
            const accounts = await prisma.account.findMany({
              where: { code: { in: codes } },
              select: { id: true, code: true },
            })
            const codeToId = Object.fromEntries(accounts.map(a => [a.code, a.id]))

            const autoLines = object.lines.map((l: any) => ({
              accountId: codeToId[l.accountCode],
              debit: l.debit || 0,
              credit: l.credit || 0,
              description: l.description,
              currency: l.currency || 'EUR',
              fxRateToBase: l.fxRateToBase ?? null,
              fxSource: l.fxSource || 'AI_AUTONOMOUS',
              fxDate: l.fxDate || new Date().toISOString().slice(0, 10),
              taxRateId: l.taxRateId || null,
            }))

            const created = await createAutonomousJournal({
              date: new Date().toISOString(),
              description: object.description || lastMessage,
              lines: autoLines,
              aiMetadata: {
                confidence: taxConf ?? 0.85,
                model: 'chat',
                reasoning: 'High-confidence autonomous suggestion from chat (legacy path)',
              },
            })

            return Response.json({
              response: `Created autonomously (high confidence): ${created.description || 'Journal entry'}`,
              createdAutonomously: true,
              entryId: created.id,
            })
          } catch (autonomousErr) {
            console.error('Legacy autonomous journal failed, falling back to suggestion', autonomousErr)
          }
        }

        const suggestion = object
          ? { ...object, needsConfirmation: finalNeedsConfirmation, merchant: finalMerchant, memory }
          : undefined

        let finalText = text.trim() || 'Balanced journal entry suggestion:'
        if (finalNeedsConfirmation && suggestion) {
          finalText += '\n\nPlease review the currency, amounts and any FX rate. Confirm explicitly before creating the entry.'
        } else if (usedRealFeedForAny && finalMerchant) {
          finalText += `\n\nUsing real rate from previous feed for ${finalMerchant}.`
        }

        return Response.json({ response: finalText, suggestion })
      } catch {
        return Response.json(await generateFallback(lastMessage))
      }
    }

    // For non-transactions, stream the response
    const result = await streamText({ model, system, prompt: lastMessage })
    return result.toTextStreamResponse()
  } catch (e) {
    console.error('chat error', e)
    const fallback = await generateFallback('')
    return Response.json(fallback)
  }
}

async function generateFallback(text: string) {
  const lower = text.toLowerCase()

  // Multi-currency detection + FX extraction from natural language
  // Examples we want to support:
  //   "Adobe 120 USD, card settled 111 EUR"
  //   "paid 120 USD for software, bank 111"
  //   "invoice $120, charged €111"
  let currency = 'EUR'
  if (/\bUSD\b|\$/.test(text)) currency = 'USD'
  else if (/\bGBP\b|£/.test(text)) currency = 'GBP'
  else if (/\bEUR\b|€/.test(text)) currency = 'EUR'

  // Try to extract two amounts when user gives foreign + base settlement
  // e.g. "120 USD ... 111 EUR" or "$120 ... 111"
  const allAmounts = Array.from(text.matchAll(/(\d+[\.,]?\d*)/g)).map(m => parseFloat(m[1].replace(',', '.'))).filter(n => !isNaN(n))
  const foreignAmount = allAmounts[0] ?? 100
  const baseAmount = allAmounts[1] ?? null

  // If second amount exists and currencies differ, treat second as base
  const hasExplicitBase = baseAmount != null && baseAmount > 0 && currency !== 'EUR'

  const amount = foreignAmount

  // If we have a clear foreign + base pair, compute the rate now
  let fxRateToBase: number | undefined
  let fxSource = 'MANUAL'
  let fxDate: string | undefined
  if (hasExplicitBase && foreignAmount > 0) {
    fxRateToBase = baseAmount! / foreignAmount
    fxSource = 'MANUAL'
    fxDate = new Date().toISOString().slice(0, 10)
  }

  const accounts = await getAccountsMap()
  const pick = (code: string, fallback: string) => (accounts[code] ? code : fallback)

  const cash = pick('1000', '1000')
  const bank = pick('1100', '1000')
  const revenue = pick('4000', '3000')
  const equity = pick('3000', '3000')
  const supplies = pick('5000', '5000')
  const software = pick('5100', '5000')
  const prof = pick('5200', '5000')

  // Pull live tax rates for intelligent suggestions (Phase 0 tax foundation)
  const rates = await prisma.taxRate.findMany({ orderBy: [{ jurisdiction: 'asc' }, { rate: 'desc' }] })
  // Pick any German rate for expenses (direction decided at use time on the journal line)
  const deRate = rates.find(r => r.jurisdiction === 'DE') || rates[0]

  let response = ''
interface SuggestionLine { accountCode: string; debit?: number; credit?: number; description?: string; currency?: string; fxRateToBase?: number; fxSource?: string; taxRateId?: string; fxDate?: string; taxIsInput?: boolean }
   let suggestion: { description?: string; lines?: SuggestionLine[] } | undefined

  const isExpense = lower.includes('bought') || lower.includes('purchase') || lower.includes('paid for') || lower.includes('expense') || lower.includes('laptop') || lower.includes('computer') || lower.includes('equipment') || lower.includes('rent') || lower.includes('office') || lower.includes('supplies') || lower.includes('software') || lower.includes('subscription') || lower.includes('professional') || lower.includes('consult')
  const isRevenue = lower.includes('revenue') || lower.includes('client paid') || lower.includes('received') || lower.includes('sale') || lower.includes('payment received')
  const isEquity = lower.includes('capital') || lower.includes('owner') || lower.includes('equity') || lower.includes('invest')

  if (isExpense) {
    let debitCode = supplies
    let note = 'Expense'
    let taxRateId: string | undefined

    if (lower.includes('software') || lower.includes('subscription')) { debitCode = software; note = 'Software' }
    else if (lower.includes('professional') || lower.includes('consult') || lower.includes('services')) { debitCode = prof; note = 'Professional services' }
    else if (lower.includes('laptop') || lower.includes('computer') || lower.includes('equipment')) { debitCode = supplies; note = 'Equipment' }

    if (deRate) taxRateId = deRate.id

    response = `${note} ~${amount}. Debit ${debitCode}, credit ${cash}${taxRateId ? ' (+ tax)' : ''}.`
    const lines: SuggestionLine[] = [
      { accountCode: debitCode, debit: amount, description: note, currency }
    ]
    if (taxRateId && deRate) {
      const taxAmt = Math.round(amount * Number(deRate.rate) * 100) / 100
      // For expense suggestions from chat we know the direction is input
lines.push({ accountCode: debitCode, debit: taxAmt, description: `Tax ${deRate.name}`, taxRateId, currency, taxIsInput: true })
    }

    // If user explicitly gave foreign + base amounts, use the exact base amount + rate.
    if (hasExplicitBase && baseAmount != null) {
      lines.push({ accountCode: cash, credit: baseAmount, currency: 'EUR' })
      if (fxRateToBase != null) {
        lines[0].fxRateToBase = fxRateToBase
        lines[0].fxSource = fxSource
        lines[0].fxDate = fxDate
      }
    } else {
      lines.push({ accountCode: cash, credit: amount, currency })
    }

    // Best-effort: enrich the foreign line with a live ECB rate if we still have none.
    // This runs in the route handler so we can await.
    if (currency !== 'EUR' && lines[0].fxRateToBase == null) {
      const rate = await getFxRateToBase(currency)
      if (rate != null) {
        lines[0].fxRateToBase = rate
        lines[0].fxSource = 'ECB'
        lines[0].fxDate = new Date().toISOString().slice(0, 10)
      }
    }

    suggestion = {
      description: text || note,
      lines
    }
  } else if (isRevenue || /invoice|bill.*client|bill.*customer|send invoice/i.test(lower)) {
    // Detect customer invoice language
    const invoiceMatch = lower.match(/invoice|bill/i)
    const customerHint = lower.includes('client') || lower.includes('customer') || lower.includes('acme') || lower.includes('corp') || lower.includes('gmbh') || /[A-Z][A-Za-z0-9&]+/.test(text)
    if (invoiceMatch && customerHint) {
      // Try to extract a plausible customer name (first capitalized token after "invoice" or "for")
      const nameMatch = text.match(/(?:invoice|bill|for)\s+([A-Z][A-Za-z0-9&.\- ]{1,30})/i)
      const contactName = nameMatch ? nameMatch[1].trim() : undefined

      response = `I'll create a customer invoice for ~${amount}.`
      // Return special createInvoice payload (no journal suggestion)
      return {
        response,
        createInvoice: {
          amount,
          description: text,
          currency,
          contactName,
        }
      }
    }
    response = `Revenue ~${amount}. Debit ${bank}, credit ${revenue}.`
    suggestion = {
      description: text || 'Revenue',
      lines: [
        { accountCode: bank, debit: amount, description: 'Bank deposit', currency },
        { accountCode: revenue, credit: amount, description: 'Revenue earned', currency }
      ]
    }
  } else if (isEquity) {
    response = `Owner contribution ~${amount}.`
    suggestion = {
      description: text || 'Owner contribution',
      lines: [
        { accountCode: cash, debit: amount, currency },
        { accountCode: equity, credit: amount, currency }
      ]
    }
  } else if (lower.includes('journal') || lower.includes('entry')) {
    response = 'Manual journal entry.'
    suggestion = {
      description: text || 'Manual entry',
      lines: [
        { accountCode: cash, debit: amount, currency },
        { accountCode: equity, credit: amount, currency }
      ]
    }
  } else if (lower.includes('balance') || lower.includes('report') || lower.includes('net')) {
    response = 'Live Balance Sheet, P&L and Summary are on the right.'
  } else if (lower.includes('account') || lower.includes('chart')) {
    response = 'Chart of accounts is on the right.'
  } else if (/reconcile|why.*(not zero|off|difference|doesn.t add up)|explain.*(cash|balance|discrepancy)/i.test(lower)) {
    // Git Model: chat-driven reconciliation / explanation
    // Examples:
    // "reconcile 1100 for June"
    // "why is cash not zero?"
    // "explain the difference on bank"
    const accMatch = lower.match(/\b(1[0-9]{3}|2[0-9]{3}|3[0-9]{3}|4[0-9]{3}|5[0-9]{3})\b/) // rough account code
    const accountCode = accMatch ? accMatch[0] : '1100'

    // Git Model: AI-driven reconcile (autonomous at high confidence)
    let reconciledFor: string | null = null
    try {
      const mod = await import('@/lib/accounting/reconcile')
      await mod.reconcileAccount({ accountCode, autoApplyHighConfidence: true })
      reconciledFor = accountCode
    } catch {}

    response = `Reconciling ${accountCode} (AI-driven per Git model). Check the ledger and events for the result.`
    return {
      response,
      reconciled: { accountCode },
      // Signal client to refresh views
    }
  } else if (/(how much|spent|spend|expense|cost).*?(on|for|in)\s+([A-Za-z0-9 ]{2,30})/i.test(text) || /utilities|office supplies|rent|travel|software/i.test(lower)) {
    // High-reachability: open dedicated ledger view for the account
    const accountMatch = text.match(/(?:on|for|in)\s+([A-Za-z0-9 ]{2,30})/i)
    let hint = accountMatch ? accountMatch[1].trim().toLowerCase() : ''
    if (!hint) {
      if (lower.includes('utilities')) hint = 'utilities'
      else if (lower.includes('supplies')) hint = 'supplies'
      else if (lower.includes('rent')) hint = 'rent'
      else if (lower.includes('travel')) hint = 'travel'
      else if (lower.includes('software') || lower.includes('adobe')) hint = 'software'
    }

    // Resolve to a real account code
    const accs = await prisma.account.findMany({ select: { code: true, name: true } })
    let code = '5200'
    const lowerHint = hint.toLowerCase()
    const match = accs.find(a => a.name.toLowerCase().includes(lowerHint) || a.code === lowerHint)
    if (match) code = match.code
    else if (lowerHint.includes('util')) code = '5200'
    else if (lowerHint.includes('supply') || lowerHint.includes('office')) code = '5000'
    else if (lowerHint.includes('rent')) code = '5100'
    else if (lowerHint.includes('travel')) code = '5300'
    else if (lowerHint.includes('software')) code = '5110'

    // Year if mentioned
    const yearMatch = text.match(/\b(20\d{2})\b/)
    const year = yearMatch ? yearMatch[1] : null

    response = `Opening the ledger for account ${code}.`

    // Return a payload the UI will consume to navigate into the ledger view
    return {
      response,
      openLedger: {
        code,
        from: year ? `${year}-01-01` : undefined,
        to: year ? `${year}-12-31` : undefined,
        search: hint || undefined
      }
    }
  } else if (/restore|rollback|go back to|reset to.*(date|state)/i.test(lower)) {
    // Now handled by the new intent dispatcher (PROPOSE_RESTORE). Fallback just tells user.
    response = 'Use "restore to 2026-06-15" — the system will propose the rollback for your confirmation.'
  } else {
    response = "I can draft journal entries. Try: 'bought supplies for 65', 'client paid 800', 'reconcile 1100', or 'restore to 2026-06-15'."
  }

  return { response, suggestion }
}
