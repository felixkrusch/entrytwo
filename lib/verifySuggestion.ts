import { prisma } from '@/lib/prisma'

export interface VerificationResult {
  ok: boolean
  warnings: string[]
}

export interface SuggestionToVerify {
  description?: string
  merchant?: string
  lines?: Array<{
    accountCode?: string
    accountId?: string
    debit?: number
    credit?: number
    currency?: string
    fxRateToBase?: number
    fxSource?: string
    taxRateId?: string
  }>
}

export async function verifySuggestion(sugg: SuggestionToVerify): Promise<VerificationResult> {
  const warnings: string[] = []
  let ok = true

  if (!sugg.lines || sugg.lines.length < 2) {
    warnings.push('At least two lines are required')
    ok = false
    return { ok, warnings }
  }

  const lines = sugg.lines

  // 1. Basic numeric balance check (raw amounts)
  const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0)
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0)
  if (Math.abs(totalDebit - totalCredit) > 0.005) {
    warnings.push('Debits and credits are not balanced')
    ok = false
  }

  // 2. FX-aware base currency balance
  try {
    let baseDebit = 0
    let baseCredit = 0

    for (const l of lines) {
      const cur = (l.currency || 'EUR').toUpperCase()
      const d = Number(l.debit) || 0
      const c = Number(l.credit) || 0
      if (cur === 'EUR') {
        baseDebit += d
        baseCredit += c
      } else {
        const rate = l.fxRateToBase != null ? Number(l.fxRateToBase) : null
        if (rate != null && isFinite(rate) && rate > 0) {
          baseDebit += d * rate
          baseCredit += c * rate
        } else {
          // No rate → we cannot confidently convert; treat as warning but still count raw for now
          warnings.push(`Missing fxRateToBase for ${cur} line`)
        }
      }
    }

    if (Math.abs(baseDebit - baseCredit) > 0.01) {
      warnings.push('Entry does not balance in base currency after FX conversion')
      ok = false
    }
  } catch {
    warnings.push('Could not verify FX conversion balance')
    ok = false
  }

  // 3. Validate account codes/ids exist
  try {
    const codes = new Set<string>()
    const ids = new Set<string>()

    for (const l of lines) {
      if (l.accountCode) codes.add(l.accountCode)
      if (l.accountId) ids.add(l.accountId)
    }

    if (codes.size > 0) {
      const found = await prisma.account.findMany({
        where: { code: { in: Array.from(codes) } },
        select: { code: true },
      })
      const foundCodes = new Set(found.map(f => f.code))
      for (const c of codes) {
        if (!foundCodes.has(c)) {
          warnings.push(`Unknown account code: ${c}`)
          ok = false
        }
      }
    }

    if (ids.size > 0) {
      const found = await prisma.account.findMany({
        where: { id: { in: Array.from(ids) } },
        select: { id: true },
      })
      const foundIds = new Set(found.map(f => f.id))
      for (const id of ids) {
        if (!foundIds.has(id)) {
          warnings.push(`Unknown account id`)
          ok = false
        }
      }
    }
  } catch {
    warnings.push('Could not validate accounts')
  }

  // 4. Tax rate validation
  try {
    const taxIds = Array.from(
      new Set(lines.map(l => l.taxRateId).filter((id): id is string => typeof id === 'string' && id.length > 0))
    )
    if (taxIds.length > 0) {
      const found = await prisma.taxRate.findMany({
        where: { id: { in: taxIds } },
        select: { id: true },
      })
      const foundIds = new Set(found.map(f => f.id))
      for (const tid of taxIds) {
        if (!foundIds.has(tid)) {
          warnings.push('Unknown tax rate selected')
          ok = false
        }
      }
    }
  } catch {}

  // 5. FX rate sanity for foreign lines
  for (const l of lines) {
    const cur = (l.currency || 'EUR').toUpperCase()
    if (cur !== 'EUR' && l.fxRateToBase != null) {
      const r = Number(l.fxRateToBase)
      if (!isFinite(r) || r <= 0) {
        warnings.push(`Invalid FX rate for ${cur}`)
        ok = false
      } else if (r < 0.05 || r > 20) {
        warnings.push(`FX rate for ${cur} looks extreme (${r}) — double-check`)
      }
    }
  }

  // 6. If we have a merchant and memory, light consistency check (non-fatal)
  if (sugg.merchant) {
    // Async micro-check: compare account suggestions with past merchant memory
    try {
      const { getMerchantMemory } = await import('@/lib/agentMemory')
      const mem = await getMerchantMemory(sugg.merchant)
      if (mem?.accountCode) {
        const debitLine = lines.find(l => (l.debit || 0) > 0)
        if (debitLine?.accountCode && debitLine.accountCode !== mem.accountCode) {
          warnings.push(`Merchant "${sugg.merchant}" previously used account ${mem.accountCode}`)
        }
      }
    } catch {
      // Non-fatal
    }
  }

  return { ok, warnings }
}
