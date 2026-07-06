import { prisma } from '@/lib/prisma'

export async function validateJournalIntent(params: any, branch: string): Promise<{ ok: boolean; error?: string; resolvedLines?: any[] }> {
  if (!params?.lines || !Array.isArray(params.lines) || params.lines.length < 2) {
    return { ok: false, error: 'Journal must have at least 2 lines' }
  }

  const hasFx = params.lines.some((l: any) => l.currency && l.currency.toUpperCase() !== 'EUR' && l.fxRateToBase != null)

  let totalDebitBase = 0
  let totalCreditBase = 0
  let totalDebitRaw = 0
  let totalCreditRaw = 0

  for (const l of params.lines) {
    const d = Number(l.debit) || 0
    const c = Number(l.credit) || 0
    totalDebitRaw += d
    totalCreditRaw += c

    const rate = (l.fxRateToBase != null && !isNaN(Number(l.fxRateToBase))) ? Number(l.fxRateToBase) : 1
    totalDebitBase += d * rate
    totalCreditBase += c * rate
  }

  const balanced = hasFx
    ? Math.abs(totalDebitBase - totalCreditBase) <= 0.01
    : Math.abs(totalDebitRaw - totalCreditRaw) <= 0.01

  if (!balanced) {
    return { ok: false, error: 'Journal is not balanced (in base currency after FX)' }
  }

  const codes: string[] = Array.from(new Set(
    params.lines
      .map((l: any) => l.accountCode)
      .filter((c: any): c is string => typeof c === 'string' && c.length > 0)
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

  const resolved = params.lines.map((l: any) => ({
    accountId: codeToId[l.accountCode],
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

  return { ok: true, resolvedLines: resolved }
}

export async function validateContactIntent(params: any): Promise<{ ok: boolean; error?: string }> {
  if (!params?.name || typeof params.name !== 'string' || params.name.trim().length < 2) {
    return { ok: false, error: 'Contact name is required' }
  }
  return { ok: true }
}

export async function validateInvoiceDraftIntent(params: any): Promise<{ ok: boolean; error?: string; resolvedContactId?: string; resolvedContactName?: string; resolvedLines?: any[] }> {
  const desc = params?.description || (Array.isArray(params?.lines) && params.lines[0]?.description)
  if (!desc || typeof desc !== 'string' || desc.trim().length < 2) {
    return { ok: false, error: 'Invoice needs a description (or at least one line with description)' }
  }

  let contactId = params?.contactId
  let contactName = params?.contactName

  if (contactId) {
    const c = await prisma.contact.findUnique({ where: { id: contactId } })
    if (!c) return { ok: false, error: 'Provided contactId not found' }
  } else if (contactName) {
    let found = await prisma.contact.findFirst({ where: { name: contactName } })
    if (!found) found = await prisma.contact.findFirst({ where: { name: { equals: contactName, mode: 'insensitive' } } })
    if (!found) {
      const all = await prisma.contact.findMany({ select: { id: true, name: true } })
      const ln = contactName.toLowerCase()
      const m = all.find(c => c.name.toLowerCase() === ln) ||
                all.find(c => c.name.toLowerCase().includes(ln)) ||
                all.find(c => ln.includes(c.name.toLowerCase()))
      if (m) found = { id: m.id, name: m.name } as any
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
  const rawLines = Array.isArray(params?.lines) && params.lines.length > 0
    ? params.lines
    : [{ description: params?.description, quantity: 1, unitPrice: params?.amount || 0, taxRateId: null }]

  const rawTaxIdStrings: string[] = rawLines
    .map((l: any) => (typeof l?.taxRateId === 'string' ? l.taxRateId.trim() : ''))
    .filter((s: string): s is string => s.length > 0)
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

  const resolvedLines = rawLines.map((l: any) => {
    const qty = Number(l.quantity) || 1
    const up = Number(l.unitPrice) || 0
    const taxId = (typeof l.taxRateId === 'string' && validTaxMap.has(l.taxRateId)) ? l.taxRateId : null
    return {
      description: l.description || params?.description || '',
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
