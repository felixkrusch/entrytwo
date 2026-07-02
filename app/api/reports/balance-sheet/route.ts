import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getVisibleJournalEntryIds, getVisibleJournalEntryIdsAtPoint } from '@/lib/accounting/ancestry'

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    const branchParam = url.searchParams.get('branch') || 'main'
    const asOf = url.searchParams.get('asOf') || url.searchParams.get('asof')

    // Git ancestry visibility for current state (unless pinned asOf)
    // If ancestry set is empty (legacy data / no parents yet), fall back to showing all for current view.
    let visibleEntryIds: string[] = []
    let restrict = false
    if (asOf) {
      visibleEntryIds = await getVisibleJournalEntryIdsAtPoint(asOf)
      restrict = true
    } else {
      const br = await prisma.accountingBranch.findUnique({ where: { name: branchParam } })
      visibleEntryIds = await getVisibleJournalEntryIds(br?.headEventId)
      restrict = visibleEntryIds.length > 0
    }

    const where: any = {}
    if (restrict && visibleEntryIds.length > 0) {
      where.journalEntryId = { in: visibleEntryIds }
    }

    if (from || to) {
      where.journalEntry = where.journalEntry || {}
      where.journalEntry.date = where.journalEntry.date || {}
      if (from) where.journalEntry.date.gte = new Date(from)
      if (to) where.journalEntry.date.lte = new Date(to)
    }

    const accounts = await prisma.account.findMany({
      include: {
        journalLines: {
          where,
        }
      }
    })

    // FX-aware base conversion helper
    const toBase = (line: { currency?: string | null; fxRateToBase?: unknown }, amount: number): number => {
      const cur = (line.currency || 'EUR').toUpperCase()
      if (cur === 'EUR') return amount
      const rate = line.fxRateToBase != null ? Number(line.fxRateToBase) : null
      return rate != null && isFinite(rate) ? amount * rate : amount
    }

    // Richer per-currency view for the whole balance sheet
    const byCurrency: Record<string, { native: number; base: number }> = {}

    const report = accounts.map(account => {
      let baseBal = 0
      let nativeBal = 0
      const currencies = new Set<string>()

      account.journalLines.forEach((line) => {
        const d = Number(line.debit)
        const c = Number(line.credit)
        const baseD = toBase(line, d)
        const baseC = toBase(line, c)
        const cur = (line.currency || 'EUR').toUpperCase()
        currencies.add(cur)

        const nativeD = cur === 'EUR' ? d : d
        const nativeC = cur === 'EUR' ? c : c

        if (['ASSET', 'EXPENSE'].includes(account.type)) {
          baseBal += baseD - baseC
          nativeBal += nativeD - nativeC
        } else {
          baseBal += baseC - baseD
          nativeBal += nativeC - nativeD
        }

        if (!byCurrency[cur]) byCurrency[cur] = { native: 0, base: 0 }
        const deltaNative = (['ASSET', 'EXPENSE'].includes(account.type) ? nativeD - nativeC : nativeC - nativeD)
        const deltaBase = (['ASSET', 'EXPENSE'].includes(account.type) ? baseD - baseC : baseC - baseD)
        byCurrency[cur].native += deltaNative
        byCurrency[cur].base += deltaBase
      })

      const displayCurrency = Array.from(currencies).find(c => c !== 'EUR') || currencies.values().next().value || 'EUR'

      return {
        code: account.code,
        name: account.name,
        type: account.type,
        balance: parseFloat(baseBal.toFixed(2)),
        nativeBalance: parseFloat(nativeBal.toFixed(2)),
        currency: displayCurrency,
        baseCurrency: 'EUR'
      }
    })

    // Round byCurrency
    Object.keys(byCurrency).forEach(k => {
      byCurrency[k].native = parseFloat(byCurrency[k].native.toFixed(2))
      byCurrency[k].base = parseFloat(byCurrency[k].base.toFixed(2))
    })

    return NextResponse.json({
      accounts: report,
      byCurrency
    })
  } catch {
    return NextResponse.json(
      { error: 'Failed to generate balance sheet' },
      { status: 500 }
    )
  }
}
