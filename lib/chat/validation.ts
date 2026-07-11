import { prisma } from '@/lib/prisma'
import { isAuthoritativeBankFeed, normalizeToProvisional } from '@/lib/fxSources'
import { calculateFxBalance } from '@/lib/accounting/fxBalance'
import { getCompanyProfile } from '@/lib/companyProfile'

export type JournalLineInput = {
  accountCode?: string
  debit?: number | string
  credit?: number | string
  description?: string
  currency?: string
  fxRateToBase?: number | string | null
  fxSource?: string
  fxDate?: string
  taxRateId?: string | null
  contactId?: string | null
  quantity?: number | string
  unitPrice?: number | string
}

type ResolvedJournalLine = {
  accountId: string
  accountCode: string
  debit: number
  credit: number
  description?: string
  currency: string
  fxRateToBase: number | null
  fxSource: string
  fxDate: string
  taxRateId: string | null
  contactId: string | null
}

export async function validateJournalIntent(params: unknown, _branch: string): Promise<{ ok: boolean; error?: string; resolvedLines?: ResolvedJournalLine[] }> {
  void _branch
  const p = params as { lines?: unknown[] } | null
  if (!p?.lines || !Array.isArray(p.lines) || p.lines.length < 2) {
    return { ok: false, error: 'Journal must have at least 2 lines' }
  }

  const lines = p.lines as JournalLineInput[]
  const entryDate = (params as { date?: string } | null)?.date || new Date().toISOString().slice(0, 10)
  const baseCurrency = (await getCompanyProfile()).baseCurrency.toUpperCase()

  for (const line of lines) {
    const cur = (line.currency || baseCurrency).toUpperCase()
    if (cur === baseCurrency) continue
    const suppliedRate = Number(line.fxRateToBase)
    if (Number.isFinite(suppliedRate) && suppliedRate > 0) {
      const source = line.fxSource || ''
      if (isAuthoritativeBankFeed(source) || /^MANUAL(?:_PROVISIONAL)?$/i.test(source)) continue
      const sourceUrls = source.match(/https?:\/\/[^\s,;]+/g) || []
      if (source.startsWith('LLM_PROVISIONAL:') && new Set(sourceUrls).size >= 2) continue
      return { ok: false, error: `Provisional FX rate for ${cur} must include at least two source URLs, or be marked MANUAL_PROVISIONAL` }
    }

    return { ok: false, error: `The LLM must provide a sourced provisional FX rate for ${cur} on ${line.fxDate || entryDate}, or the user must provide the base-currency amount` }
  }

  const balance = calculateFxBalance(lines, baseCurrency)
  if (!balance.balanced) {
    return { ok: false, error: 'Journal is not balanced (in base currency after FX)' }
  }

  const codes: string[] = Array.from(new Set(
    lines
      .map((l) => l.accountCode)
      .filter((c): c is string => typeof c === 'string' && c.length > 0)
  ))

  const accounts = await prisma.account.findMany({
    where: { code: { in: codes } },
    select: { id: true, code: true },
  })
  const codeToId: Record<string, string> = Object.fromEntries(accounts.map(a => [a.code, a.id]))

  const missing = codes.filter(c => !codeToId[c])
  if (missing.length > 0) {
    return { ok: false, error: `Unknown account code(s): ${missing.join(', ')}` }
  }

  const resolved: ResolvedJournalLine[] = lines.map((l) => {
    const cur = (l.currency || baseCurrency).toUpperCase()
    let src = l.fxSource || 'LLM_PROVISIONAL'
    if (cur !== baseCurrency && !isAuthoritativeBankFeed(src)) {
      src = normalizeToProvisional(src)
    }
    return {
      accountId: codeToId[l.accountCode!],
      accountCode: l.accountCode!,
      debit: Number(l.debit) || 0,
      credit: Number(l.credit) || 0,
      description: l.description,
      currency: cur,
      fxRateToBase: l.fxRateToBase != null ? Number(l.fxRateToBase) : null,
      fxSource: src,
      fxDate: l.fxDate || new Date().toISOString().slice(0, 10),
      taxRateId: l.taxRateId || null,
      contactId: l.contactId || null,
    }
  })

  return { ok: true, resolvedLines: resolved }
}

type ContactIntentParams = { name?: string }

export async function validateContactIntent(params: unknown): Promise<{ ok: boolean; error?: string }> {
  const p = params as ContactIntentParams | null
  if (!p?.name || typeof p.name !== 'string' || p.name.trim().length < 2) {
    return { ok: false, error: 'Contact name is required' }
  }
  return { ok: true }
}

type InvoiceLineInput = {
  description?: string
  quantity?: number | string
  unitPrice?: number | string
  taxRateId?: string | null
}

type ResolvedInvoiceLine = {
  description: string
  quantity: number
  unitPrice: number
  taxRateId: string | null
  lineTotal: number
}

type InvoiceDraftParams = {
  description?: string
  lines?: InvoiceLineInput[]
  contactId?: string
  contactName?: string
  amount?: number | string
}

export async function validateInvoiceDraftIntent(params: unknown): Promise<{ ok: boolean; error?: string; resolvedContactId?: string; resolvedContactName?: string; resolvedLines?: ResolvedInvoiceLine[] }> {
  const p = params as InvoiceDraftParams | null
  const desc = p?.description || (Array.isArray(p?.lines) && p.lines[0]?.description)
  if (!desc || typeof desc !== 'string' || desc.trim().length < 2) {
    return { ok: false, error: 'Invoice needs a description (or at least one line with description)' }
  }

  let contactId: string | undefined = p?.contactId
  let contactName: string | undefined = p?.contactName

  if (contactId) {
    const c = await prisma.contact.findUnique({ where: { id: contactId } })
    if (!c) return { ok: false, error: 'Provided contactId not found' }
  } else if (contactName) {
    let found: { id: string; name: string } | null = null
    const exact = await prisma.contact.findFirst({ where: { name: contactName } })
    if (exact) found = { id: exact.id, name: exact.name }
    if (!found) {
      const insensitive = await prisma.contact.findFirst({ where: { name: { equals: contactName, mode: 'insensitive' } } })
      if (insensitive) found = { id: insensitive.id, name: insensitive.name }
    }
    if (!found) {
      const all = await prisma.contact.findMany({ select: { id: true, name: true } })
      const ln = contactName.toLowerCase()
      const m = all.find(c => c.name.toLowerCase() === ln) ||
                all.find(c => c.name.toLowerCase().includes(ln)) ||
                all.find(c => ln.includes(c.name.toLowerCase()))
      if (m) found = { id: m.id, name: m.name }
    }
    if (found) {
      contactId = found.id
      contactName = found.name
    } else {
      return { ok: false, error: `Contact "${contactName}" not found. Create the contact first or use an exact existing name.` }
    }
  } else {
    return { ok: false, error: 'Invoice requires a contactName (or contactId) that matches an existing contact' }
  }

  // Validate taxRateIds if provided in lines (they must be real UUIDs or absent)
  const rawLines: InvoiceLineInput[] = Array.isArray(p?.lines) && p.lines.length > 0
    ? p.lines
    : [{ description: p?.description, quantity: 1, unitPrice: p?.amount || 0, taxRateId: null }]

  const rawTaxIdStrings: string[] = rawLines
    .map((l) => (typeof l?.taxRateId === 'string' ? l.taxRateId.trim() : ''))
    .filter((s): s is string => s.length > 0)
  const candidateTaxIds: string[] = Array.from(new Set(rawTaxIdStrings))

  let validTaxMap = new Map<string, string>()
  if (candidateTaxIds.length > 0) {
    const foundRates = await prisma.taxRate.findMany({
      where: { id: { in: candidateTaxIds } },
      select: { id: true },
    })
    validTaxMap = new Map(foundRates.map(r => [r.id, r.id]))
    const bad = candidateTaxIds.filter(id => !validTaxMap.has(id))
    if (bad.length > 0) {
      return { ok: false, error: `Unknown taxRateId(s): ${bad.join(', ')}. Use exact IDs from the live tax rates list.` }
    }
  }

  const resolvedLines: ResolvedInvoiceLine[] = rawLines.map((l) => {
    const qty = Number(l.quantity) || 1
    const up = Number(l.unitPrice) || 0
    const taxId = (typeof l.taxRateId === 'string' && validTaxMap.has(l.taxRateId)) ? l.taxRateId : null
    return {
      description: l.description || p?.description || '',
      quantity: qty,
      unitPrice: up,
      taxRateId: taxId,
      lineTotal: qty * up,
    }
  })

  return {
    ok: true,
    resolvedContactId: contactId,
    resolvedContactName: contactName,
    resolvedLines,
  }
}

export async function validateRestoreTarget(target: string, branchName = 'main'): Promise<{ ok: boolean; error?: string; eventId?: string }> {
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

  const branch = await prisma.accountingBranch.findUnique({ where: { name: branchName } })
  if (!branch) return { ok: false, error: 'Branch not found' }

  return { ok: true, eventId: ev.id }
}
