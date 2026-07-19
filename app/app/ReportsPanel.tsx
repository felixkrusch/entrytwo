'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useTranslations, useFormatter } from 'next-intl'
import { useRouter, useSearchParams } from 'next/navigation'

// Local interfaces mirroring the JSON returned by /api/reports/*.
// NOTE: we intentionally do NOT import from '@/lib/reports' (server-only, prisma).
interface ReportAccount {
  code: string
  name: string
  type: string
  balance: number
  nativeBalance: number
  currency: string
  baseCurrency: string
  group: string
}

interface ReportItem {
  code: string
  name: string
  amount: number
  nativeAmount: number
  currency: string
  baseCurrency: string
  feedSourced: boolean
  priorAmount?: number
}

interface BalanceSheetSection {
  label: string
  total: number
  items: ReportAccount[]
}

interface BalanceSheetData {
  baseCurrency: string
  from?: string | null
  to?: string | null
  asOf?: string | null
  assets: BalanceSheetSection
  liabilities: BalanceSheetSection
  equity: BalanceSheetSection
  retainedEarnings: number
  totalEquityWithRetained: number
  balanced: boolean
  byCurrency?: Record<string, { native: number; base: number }>
  comparison?: {
    assetsTotalPrior?: number
    liabilitiesTotalPrior?: number
    equityTotalPrior?: number
    items: Record<string, number>
  }
}

interface PLData {
  baseCurrency: string
  revenue: { total: number; items: ReportItem[] }
  expenses: { total: number; items: ReportItem[] }
  netIncome: number
  taxSummary: { inputTax: number; outputTax: number; netTax: number }
  byCurrency?: Record<string, { native: number; base: number }>
  comparison?: { netIncomePrior?: number; revenuePrior?: number; expensePrior?: number }
}

interface CashFlowData {
  baseCurrency: string
  operating: { label: string; total: number; items: Array<{ code: string; name: string; delta: number }> }
  investing: { label: string; total: number; items: Array<{ code: string; name: string; delta: number }> }
  financing: { label: string; total: number; items: Array<{ code: string; name: string; delta: number }> }
  netChange: number
  beginningCash: number
  endingCash: number
}

type Tab = 'balance' | 'pl' | 'cashflow'

type TFn = (key: string) => string

function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1) }
function startOfQuarter(d: Date) { const q = Math.floor(d.getMonth() / 3); return new Date(d.getFullYear(), q * 3, 1) }
function startOfYear(d: Date) { return new Date(d.getFullYear(), 0, 1) }
function iso(d: Date) { return d.toISOString().split('T')[0] }
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x }
function addYears(d: Date, n: number) { const x = new Date(d); x.setFullYear(x.getFullYear() + n); return x }

export default function ReportsPanel() {
  const t = useTranslations('app.panels')
  const tReports = useTranslations('app.panels.reports')
  const tPL = useTranslations('app.panels.profitLoss')
  const tCF = useTranslations('app.panels.cashFlow')
  const format = useFormatter()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [tab, setTab] = useState<Tab>('balance')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [preset, setPreset] = useState('')
  const [comparison, setComparison] = useState<'none' | 'prior' | 'prioryear'>('none')
  const [hideZero, setHideZero] = useState(false)
  const [grouped, setGrouped] = useState(true)
  const [footnote, setFootnote] = useState('')

  const [bs, setBs] = useState<BalanceSheetData | null>(null)
  const [pl, setPl] = useState<PLData | null>(null)
  const [cf, setCf] = useState<CashFlowData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const branch = searchParams?.get('branch') || 'main'
  const asOf = searchParams?.get('asOf') || searchParams?.get('asof') || undefined
  const baseCurrency = bs?.baseCurrency || pl?.baseCurrency || cf?.baseCurrency || 'EUR'

  // Comparison ranges derived from the current [from, to].
  const compareParams = useMemo(() => {
    if (comparison === 'none') return { compareFrom: '', compareTo: '' }
    const today = new Date()
    let f = from
    let t2 = to
    if (!f && !t2) {
      // default the current window to YTD so a comparison is meaningful
      f = iso(startOfYear(today))
      t2 = iso(today)
    }
    const fromD = new Date(f)
    const toD = new Date(t2)
    const days = Math.max(1, Math.round((toD.getTime() - fromD.getTime()) / 86400000) + 1)
    if (comparison === 'prior') {
      const cTo = addDays(fromD, -1)
      const cFrom = addDays(cTo, -(days - 1))
      return { compareFrom: iso(cFrom), compareTo: iso(cTo) }
    }
    // prior year
    return { compareFrom: iso(addYears(fromD, -1)), compareTo: iso(addYears(toD, -1)) }
  }, [comparison, from, to])

  const buildQuery = useCallback(() => {
    const u = new URLSearchParams()
    if (from) u.set('from', from)
    if (to) u.set('to', to)
    if (branch && branch !== 'main') u.set('branch', branch)
    if (asOf) u.set('asOf', asOf)
    if (comparison !== 'none') {
      if (compareParams.compareFrom) u.set('compareFrom', compareParams.compareFrom)
      if (compareParams.compareTo) u.set('compareTo', compareParams.compareTo)
    }
    return u.toString()
  }, [from, to, branch, asOf, comparison, compareParams])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = buildQuery()
      const [bsRes, plRes, cfRes] = await Promise.all([
        fetch(`/api/reports/balance-sheet${qs ? `?${qs}` : ''}`),
        fetch(`/api/reports/profit-loss${qs ? `?${qs}` : ''}`),
        fetch(`/api/reports/cash-flow${qs ? `?${qs}` : ''}`),
      ])
      if (bsRes.ok) setBs(await bsRes.json())
      else throw new Error('Failed to load balance sheet')
      if (plRes.ok) setPl(await plRes.json())
      else throw new Error('Failed to load P&L')
      if (cfRes.ok) setCf(await cfRes.json())
      else throw new Error('Failed to load cash flow')
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to load reports')
    } finally {
      setLoading(false)
    }
  }, [buildQuery])

  useEffect(() => {
    void load()
  }, [buildQuery])

  useEffect(() => {
    const handler = () => void load()
    window.addEventListener('journal-updated', handler)
    return () => window.removeEventListener('journal-updated', handler)
  }, [load])

  // Footnotes are persisted per report + period in localStorage.
  const footnoteKey = `report-notes:${tab}:${from || 'open'}:${to || 'now'}`
  useEffect(() => {
    try {
      setFootnote(localStorage.getItem(footnoteKey) || '')
    } catch {
      setFootnote('')
    }
  }, [footnoteKey])
  const saveFootnote = (v: string) => {
    setFootnote(v)
    try {
      if (v) localStorage.setItem(footnoteKey, v)
      else localStorage.removeItem(footnoteKey)
    } catch {}
  }

  const applyPreset = (p: string) => {
    setPreset(p)
    const today = new Date()
    if (p === 'month') { setFrom(iso(startOfMonth(today))); setTo(iso(today)) }
    else if (p === 'quarter') { setFrom(iso(startOfQuarter(today))); setTo(iso(today)) }
    else if (p === 'ytd') { setFrom(iso(startOfYear(today))); setTo(iso(today)) }
    else if (p === 'lastyear') { const y = today.getFullYear() - 1; setFrom(`${y}-01-01`); setTo(`${y}-12-31`) }
    else if (p === 'all') { setFrom(''); setTo('') }
  }

  const fmt = (amount: number, cur = baseCurrency) =>
    format.number(amount, { style: 'currency', currency: cur })
  const fmtPct = (fraction: number) => format.number(fraction, { style: 'percent', maximumFractionDigits: 1 })

  const openLedger = (code: string) => {
    const params = new URLSearchParams()
    params.set('view', 'ledger')
    params.set('accountCode', code)
    if (branch && branch !== 'main') params.set('branch', branch)
    if (asOf) params.set('asOf', asOf)
    router.push(`/app?${params.toString()}`)
  }

  const exportCsv = (report: string) => {
    const qs = buildQuery()
    const u = `/api/reports/export?report=${report}${qs ? `&${qs}` : ''}`
    window.open(u, '_blank')
  }

  const periodLabel = from || to ? `${from || 'open'} → ${to || 'now'}` : 'All time'

  // --- grouping helper ---
  const groupItems = <T extends { group: string; balance?: number; amount?: number; delta?: number }>(
    items: T[],
  ): Array<{ group: string; items: T[] }> => {
    if (!grouped) return [{ group: 'All', items }]
    const order = ['Current', 'Fixed', 'Long-term', 'Equity', 'Other']
    const map = new Map<string, T[]>()
    items.forEach((i) => {
      const g = i.group || 'Other'
      if (!map.has(g)) map.set(g, [])
      map.get(g)!.push(i)
    })
    return Array.from(map.keys())
      .sort((a, b) => order.indexOf(a) - order.indexOf(b))
      .map((g) => ({ group: g, items: map.get(g)! }))
  }

  const filterZero = <T extends { balance?: number; amount?: number; delta?: number }>(items: T[]): T[] => {
    if (!hideZero) return items
    return items.filter((i) => {
      const v = i.balance ?? i.amount ?? i.delta ?? 0
      return Math.abs(Number(v)) > 0.001
    })
  }

  return (
    <div>
      <div className="no-print mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{tReports('title')}</h1>
          <p className="text-xs text-zinc-500 mt-1">{tReports('subtitle')}</p>
          {(branch && branch !== 'main') || asOf ? (
            <div className="mt-1 text-[10px] text-emerald-400">
              {branch !== 'main' ? `${branch} branch` : 'main'}
              {asOf ? ` • as of ${asOf}` : ''} (not current main)
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void load()} className="text-xs px-2 py-1 rounded bg-emerald-950 text-emerald-400 hover:bg-emerald-900 transition">
            {t('reports.live')}
          </button>
          <button onClick={() => window.print()} className="text-xs px-2 py-1 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800" title="Print / Save as PDF">
            {tReports('print')}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="no-print flex gap-1 mb-4 border-b border-zinc-800">
        {(['balance', 'pl', 'cashflow'] as Tab[]).map((tb) => (
          <button
            key={tb}
            onClick={() => setTab(tb)}
            className={`px-3 py-1.5 text-sm -mb-px border-b-2 ${tab === tb ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-zinc-400 hover:text-zinc-200'}`}
          >
            {tb === 'balance' ? tReports('title') : tb === 'pl' ? tPL('title') : tCF('title')}
          </button>
        ))}
      </div>

      {/* Controls */}
      <div className="no-print mb-4 flex flex-wrap items-end gap-3 text-xs">
        <div>
          <label className="block text-zinc-400 mb-1">{tReports('from')}</label>
          <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPreset('') }} className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1" />
        </div>
        <div>
          <label className="block text-zinc-400 mb-1">{tReports('to')}</label>
          <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPreset('') }} className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1" />
        </div>
        <div>
          <label className="block text-zinc-400 mb-1">{tReports('presets')}</label>
          <select value={preset} onChange={(e) => applyPreset(e.target.value)} className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1">
            <option value="">{tReports('presets')}</option>
            <option value="month">{tReports('presetMonth')}</option>
            <option value="quarter">{tReports('presetQuarter')}</option>
            <option value="ytd">{tReports('presetYTD')}</option>
            <option value="lastyear">{tReports('presetLastYear')}</option>
            <option value="all">{tReports('presetAll')}</option>
          </select>
        </div>
        <div>
          <label className="block text-zinc-400 mb-1">{tReports('compare')}</label>
            <select value={comparison} onChange={(e) => setComparison(e.target.value as 'none' | 'prior' | 'prioryear')} className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1">
            <option value="none">{tReports('compareNone')}</option>
            <option value="prior">{tReports('comparePrior')}</option>
            <option value="prioryear">{tReports('comparePriorYear')}</option>
          </select>
        </div>
        <label className="flex items-center gap-1 text-zinc-300">
          <input type="checkbox" checked={hideZero} onChange={(e) => setHideZero(e.target.checked)} />
          {tReports('hideZero')}
        </label>
        <label className="flex items-center gap-1 text-zinc-300">
          <input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} />
          {tReports('group')}
        </label>
        {(from || to) && (
          <button onClick={() => { setFrom(''); setTo(''); setPreset('all') }} className="text-[10px] px-2 py-1 rounded bg-zinc-700 text-zinc-300">
            {tReports('clear')}
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-zinc-500 text-sm">{tReports('loading')}</div>
      ) : error ? (
        <div className="text-rose-400 text-sm">{error}</div>
      ) : (
        <div id="report-print-area" className="space-y-6 text-sm">
          <div className="no-print text-[11px] text-zinc-500">
            {tReports('period')}: {periodLabel}
            {comparison !== 'none' && compareParams.compareFrom ? ` • ${tReports('comparedTo')}: ${compareParams.compareFrom} → ${compareParams.compareTo}` : ''}
          </div>

          {tab === 'balance' && bs && (
            <BalanceSheetView
              data={bs}
              t={tReports}
              format={fmt}
              openLedger={openLedger}
              grouped={grouped}
              groupItems={groupItems}
              filterZero={filterZero}
              compareLabel={comparison !== 'none' ? (compareParams.compareFrom || '') : ''}
            />
          )}

          {tab === 'cashflow' && cf && (
            <CashFlowView data={cf} t={tCF} format={fmt} />
          )}

          {/* Footnotes */}
          <div className="no-print mt-6">
            <label className="text-xs text-zinc-400 block mb-1">{tReports('footnoteLabel')}</label>
            <textarea
              value={footnote}
              onChange={(e) => saveFootnote(e.target.value)}
              placeholder={tReports('footnotePlaceholder')}
              rows={2}
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs"
            />
          </div>
          {footnote && <div className="no-print mt-2 text-xs text-zinc-400 italic">📝 {footnote}</div>}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Balance Sheet view
// ---------------------------------------------------------------------------

function BalanceSheetRow({ a, t, format, openLedger, baseCurrency, prior, compareLabel }: {
  a: ReportAccount
  t: TFn
  format: (n: number, c?: string) => string
  openLedger: (code: string) => void
  baseCurrency: string
  prior?: number
  compareLabel: string
}) {
  const delta = prior != null ? a.balance - prior : undefined
  return (
    <div
      onClick={() => openLedger(a.code)}
      className="flex justify-between py-1 border-b border-zinc-800 pl-2 cursor-pointer hover:bg-zinc-800/60"
      title={t('drillDown')}
    >
      <span>{a.code} {a.name}</span>
      <span className="flex items-center gap-3 font-mono">
        {compareLabel && prior != null ? (
          <>
            <span className="text-zinc-500">{format(prior)}</span>
            <span className={delta! >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
              {format(a.balance)} ({delta! >= 0 ? '+' : ''}{format(delta!)})
            </span>
          </>
        ) : (
          <span className="text-zinc-100">{format(a.balance)}</span>
        )}
        {a.currency && a.currency !== baseCurrency && Math.abs(a.nativeBalance) > 0.005 ? (
          <span className="text-[10px] text-zinc-500">{a.currency} ~{a.nativeBalance.toFixed(2)}</span>
        ) : null}
      </span>
    </div>
  )
}

function BalanceSheetSection({ sec, color, t, format, openLedger, baseCurrency, grouped, groupItems, filterZero, comparisonItems, compareLabel }: {
  sec: BalanceSheetSection
  color: string
  t: TFn
  format: (n: number, c?: string) => string
  openLedger: (code: string) => void
  baseCurrency: string
  grouped: boolean
  groupItems: <T extends { group: string }>(items: T[]) => Array<{ group: string; items: T[] }>
  filterZero: <T extends { balance?: number }>(items: T[]) => T[]
  comparisonItems?: Record<string, number>
  compareLabel: string
}) {
  const groups = groupItems(filterZero(sec.items))
  return (
    <div>
      <div className={`font-medium mb-2 flex justify-between ${color}`}>
        <span>{t(sec.label.toLowerCase())}</span>
        <span className="font-mono">{format(sec.total)}</span>
      </div>
      {sec.items.length === 0 ? (
        <div className="text-zinc-500 pl-2">{t(`no${sec.label}`)}</div>
      ) : (
        groups.map((g) => (
          <div key={g.group} className="mb-1">
            {grouped && g.group !== 'All' && (
              <div className="text-[10px] uppercase text-zinc-500 mt-1">{t(`group_${g.group}`)}</div>
            )}
            {g.items.map((a) => (
              <BalanceSheetRow key={a.code} a={a} t={t} format={format} openLedger={openLedger} baseCurrency={baseCurrency} prior={comparisonItems?.[a.code]} compareLabel={compareLabel} />
            ))}
          </div>
        ))
      )}
      <div className={`pt-1 border-t border-zinc-700 font-medium flex justify-between ${color}`}>
        <span>{t('total')} {t(sec.label.toLowerCase())}</span>
        <span className="font-mono">{format(sec.total)}</span>
      </div>
    </div>
  )
}

function BalanceSheetView({
  data, t, format, openLedger, grouped, groupItems, filterZero, compareLabel,
}: {
  data: BalanceSheetData
  t: TFn
  format: (n: number, c?: string) => string
  openLedger: (code: string) => void
  grouped: boolean
  groupItems: <T extends { group: string }>(items: T[]) => Array<{ group: string; items: T[] }>
  filterZero: <T extends { balance?: number }>(items: T[]) => T[]
  compareLabel: string
}) {
  return (
    <div className="space-y-6">
      <BalanceSheetSection sec={data.assets} color="text-emerald-400" t={t} format={format} openLedger={openLedger} baseCurrency={data.baseCurrency} grouped={grouped} groupItems={groupItems} filterZero={filterZero} comparisonItems={data.comparison?.items} compareLabel={compareLabel} />
      <BalanceSheetSection sec={data.liabilities} color="text-amber-400" t={t} format={format} openLedger={openLedger} baseCurrency={data.baseCurrency} grouped={grouped} groupItems={groupItems} filterZero={filterZero} comparisonItems={data.comparison?.items} compareLabel={compareLabel} />

      <div>
        <div className="font-medium text-purple-400 mb-2 flex justify-between">
          <span>{t('equity')}</span>
          <span className="font-mono">{format(data.equity.total)}</span>
        </div>
        {data.equity.items.length > 0 ? (
          filterZero(data.equity.items).map((a) => (
            <BalanceSheetRow key={a.code} a={a} t={t} format={format} openLedger={openLedger} baseCurrency={data.baseCurrency} prior={data.comparison?.items?.[a.code]} compareLabel={compareLabel} />
          ))
        ) : (
          <div className="text-zinc-500 pl-2">{t('noEquity')}</div>
        )}
        {/* Retained Earnings rollup (Net Income) */}
        <div className="flex justify-between py-1 border-b border-zinc-800 pl-2">
          <span className="italic">{t('retainedEarnings')}</span>
          <span className="font-mono text-purple-300">{format(data.retainedEarnings)}</span>
        </div>
        <div className="pt-1 border-t border-zinc-700 font-medium flex justify-between text-purple-400">
          <span>{t('totalEquity')}</span>
          <span className="font-mono">{format(data.totalEquityWithRetained)}</span>
        </div>
      </div>

      {/* Balance validation */}
      <div className="pt-3 border-t border-zinc-700 text-xs flex justify-between font-medium">
        <span>{t('balanceCheck')}</span>
        <span className={data.balanced ? 'text-emerald-400' : 'text-rose-400'}>
          {data.balanced ? `✓ ${t('balanced')}` : `⚠ ${t('checkEntries')}`}
        </span>
      </div>

      {/* By currency (supplementary) */}
      {data.byCurrency && Object.keys(data.byCurrency).length > 0 && (
        <div className="no-print pt-2 text-[10px] text-zinc-400 font-mono">
          <div className="text-[9px] text-zinc-500 mb-0.5">{t('byCurrency')}</div>
          {Object.entries(data.byCurrency).sort().map(([cur, v]) => (
            <div key={cur}>
              {cur}: {format(v.base)} base
              {cur !== data.baseCurrency && v.native != null ? ` • native ~${v.native.toFixed(2)}` : ''}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Profit & Loss view
// ---------------------------------------------------------------------------

function PLView({
  data, t, format, fmtPct, openLedger, hideZero, grouped, filterZero, comparison,
}: {
  data: PLData
  t: TFn
  format: (n: number, c?: string) => string
  fmtPct: (f: number) => string
  openLedger: (code: string) => void
  hideZero: boolean
  grouped: boolean
  filterZero: <T extends { amount?: number }>(items: T[]) => T[]
  comparison: string
}) {
  const revTotal = data.revenue.total || 1
  const pct = (amount: number) => fmtPct(amount / revTotal)

  const renderItems = (items: ReportItem[], color: string, kind: 'revenue' | 'expense') => {
    const filtered = filterZero(items)
    return filtered.length === 0 ? (
      <div className="text-zinc-500 pl-2">{kind === 'revenue' ? t('noRevenue') : t('noExpenses')}</div>
    ) : (
      filtered.map((i) => {
        const prior = i.priorAmount
        const delta = prior != null ? i.amount - prior : undefined
        return (
          <div
            key={i.code}
            onClick={() => openLedger(i.code)}
            className="flex justify-between py-1 border-b border-zinc-800 pl-2 cursor-pointer hover:bg-zinc-800/60"
            title={t('drillDown')}
          >
            <span>{i.code} {i.name}</span>
            <span className="flex items-center gap-3 font-mono">
              <span className="text-[10px] text-zinc-500 w-12 text-right">{pct(i.amount)}</span>
              {comparison !== 'none' && prior != null ? (
                <>
                  <span className="text-zinc-500">{format(prior)}</span>
                  <span className={delta! >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                    {format(i.amount)} ({delta! >= 0 ? '+' : ''}{format(delta!)})
                  </span>
                </>
              ) : (
                <span className={color}>{format(i.amount)}</span>
              )}
              {i.currency && i.currency !== data.baseCurrency && Math.abs(i.nativeAmount) > 0.005 ? (
                <span className="text-[10px] text-zinc-500">{i.currency} ~{i.nativeAmount.toFixed(2)}</span>
              ) : null}
            </span>
          </div>
        )
      })
    )
  }

  const deltaRow = (cur: number, prior?: number) => {
    if (comparison === 'none' || prior == null) return null
    const d = cur - prior
    return <span className={`text-[10px] ${d >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>({d >= 0 ? '+' : ''}{format(d)})</span>
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="font-medium text-blue-400 mb-2 flex justify-between">
          <span>{t('revenue')}</span>
          <span className="font-mono flex items-center gap-2">{format(data.revenue.total)} {deltaRow(data.revenue.total, data.comparison?.revenuePrior)}</span>
        </div>
        {renderItems(data.revenue.items, 'text-blue-400', 'revenue')}
        <div className="pt-1 border-t border-zinc-700 font-medium flex justify-between text-blue-400">
          <span>{t('total')} {t('revenue')}</span>
          <span className="font-mono">{format(data.revenue.total)}</span>
        </div>
      </div>

      <div>
        <div className="font-medium text-rose-400 mb-2 flex justify-between">
          <span>{t('expenses')}</span>
          <span className="font-mono flex items-center gap-2">{format(data.expenses.total)} {deltaRow(data.expenses.total, data.comparison?.expensePrior)}</span>
        </div>
        {renderItems(data.expenses.items, 'text-rose-400', 'expense')}
        <div className="pt-1 border-t border-zinc-700 font-medium flex justify-between text-rose-400">
          <span>{t('total')} {t('expenses')}</span>
          <span className="font-mono">{format(data.expenses.total)}</span>
        </div>
      </div>

      <div className="pt-3 border-t border-zinc-700 flex justify-between text-sm font-medium">
        <span>{t('netIncome')}</span>
        <span className="font-mono flex items-center gap-2">
          <span className={data.netIncome >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{format(data.netIncome)}</span>
          {deltaRow(data.netIncome, data.comparison?.netIncomePrior)}
        </span>
      </div>

      {data.taxSummary && (
        <div className="pt-2 text-[11px] text-zinc-400 font-mono">
          {t('tax')}: {t('inputTax')} {format(data.taxSummary.inputTax)} • {t('outputTax')} {format(data.taxSummary.outputTax)} • {t('netTax')} {format(data.taxSummary.netTax)}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Cash Flow view
// ---------------------------------------------------------------------------

function CashFlowSection({ sec, t, format }: {
  sec: CashFlowData['operating']
  t: TFn
  format: (n: number, c?: string) => string
}) {
  return (
    <div>
      <div className="font-medium text-zinc-200 mb-2 flex justify-between">
        <span>{t(sec.label.replace(/\s/g, ''))}</span>
        <span className="font-mono">{format(sec.total)}</span>
      </div>
      {sec.items.length === 0 ? (
        <div className="text-zinc-500 pl-2">{t('noItems')}</div>
      ) : (
        sec.items.map((i, idx) => (
          <div key={`${i.code}-${idx}`} className="flex justify-between py-1 border-b border-zinc-800 pl-2">
            <span>{i.code === 'NI' ? i.name : `${i.code} ${i.name}`}</span>
            <span className={`font-mono ${i.delta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{format(i.delta)}</span>
          </div>
        ))
      )}
      <div className="pt-1 border-t border-zinc-700 font-medium flex justify-between">
        <span>{t('total')} {t(sec.label.replace(/\s/g, ''))}</span>
        <span className="font-mono">{format(sec.total)}</span>
      </div>
    </div>
  )
}

function CashFlowView({
  data, t, format,
}: {
  data: CashFlowData
  t: TFn
  format: (n: number, c?: string) => string
}) {
  return (
    <div className="space-y-6">
      <CashFlowSection sec={data.operating} t={t} format={format} />
      <CashFlowSection sec={data.investing} t={t} format={format} />
      <CashFlowSection sec={data.financing} t={t} format={format} />

      <div className="pt-3 border-t border-zinc-700 text-sm font-medium flex justify-between">
        <span>{t('netChange')}</span>
        <span className={`font-mono ${data.netChange >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{format(data.netChange)}</span>
      </div>
      <div className="flex justify-between text-xs text-zinc-400">
        <span>{t('beginningCash')}</span>
        <span className="font-mono">{format(data.beginningCash)}</span>
      </div>
      <div className="flex justify-between text-xs text-zinc-400">
        <span>{t('endingCash')}</span>
        <span className="font-mono">{format(data.endingCash)}</span>
      </div>
    </div>
  )
}
