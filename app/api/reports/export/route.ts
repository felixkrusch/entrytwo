import { NextResponse } from 'next/server'
import { getCompanyProfile } from '@/lib/companyProfile'
import { buildBalanceSheet, buildProfitLoss, buildCashFlow } from '@/lib/reports'

function csvCell(value: string | number): string {
  const s = String(value)
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function toCsv(rows: Array<Array<string | number>>): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\n')
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const report = url.searchParams.get('report') || 'profit-loss'
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    const branch = url.searchParams.get('branch') || 'main'
    const asOf = url.searchParams.get('asOf') || url.searchParams.get('asof')

    const profile = await getCompanyProfile()
    const baseCurrency = profile.baseCurrency || 'EUR'

    let csv = ''
    let filename = ''

    if (report === 'balance-sheet') {
      const bs = await buildBalanceSheet({ from, to, branch, asOf, baseCurrency })
      const rows: Array<Array<string | number>> = [['Balance Sheet', baseCurrency]]
      if (from || to) rows.push([`Period`, `${from || 'open'} - ${to || 'now'}`])
      rows.push([])
      const section = (label: string, items: any[], total: number) => {
        rows.push([label])
        items.forEach((i) => rows.push([`${i.code} ${i.name}`, i.balance]))
        rows.push([`Total ${label}`, total])
        rows.push([])
      }
      section('Assets', bs.assets.items, bs.assets.total)
      section('Liabilities', bs.liabilities.items, bs.liabilities.total)
      section('Equity', bs.equity.items, bs.equity.total)
      rows.push(['Retained Earnings (Net Income)', bs.retainedEarnings])
      rows.push(['Total Equity (incl. Retained Earnings)', bs.totalEquityWithRetained])
      rows.push([])
      rows.push(['Balanced', bs.balanced ? 'YES' : 'NO'])
      csv = toCsv(rows)
      filename = 'balance-sheet.csv'
    } else if (report === 'cash-flow') {
      const cf = await buildCashFlow({ from, to, branch, asOf, baseCurrency })
      const rows: Array<Array<string | number>> = [['Cash Flow Statement', baseCurrency]]
      if (from || to) rows.push([`Period`, `${from || 'open'} - ${to || 'now'}`])
      rows.push([])
      const section = (label: string, items: any[], total: number) => {
        rows.push([label])
        items.forEach((i) => rows.push([`${i.code} ${i.name}`, i.delta]))
        rows.push([`Total ${label}`, total])
        rows.push([])
      }
      section('Operating Activities', cf.operating.items, cf.operating.total)
      section('Investing Activities', cf.investing.items, cf.investing.total)
      section('Financing Activities', cf.financing.items, cf.financing.total)
      rows.push(['Net Change in Cash', cf.netChange])
      rows.push(['Beginning Cash', cf.beginningCash])
      rows.push(['Ending Cash', cf.endingCash])
      csv = toCsv(rows)
      filename = 'cash-flow.csv'
    } else {
      const pl = await buildProfitLoss({ from, to, branch, asOf, baseCurrency })
      const rows: Array<Array<string | number>> = [['Profit & Loss', baseCurrency]]
      if (from || to) rows.push([`Period`, `${from || 'open'} - ${to || 'now'}`])
      rows.push([])
      rows.push(['Revenue'])
      pl.revenue.items.forEach((i) => rows.push([`${i.code} ${i.name}`, i.amount]))
      rows.push(['Total Revenue', pl.revenue.total])
      rows.push([])
      rows.push(['Expenses'])
      pl.expenses.items.forEach((i) => rows.push([`${i.code} ${i.name}`, i.amount]))
      rows.push(['Total Expenses', pl.expenses.total])
      rows.push([])
      rows.push(['Net Income', pl.netIncome])
      csv = toCsv(rows)
      filename = 'profit-loss.csv'
    }

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (error) {
    console.error('Export error:', error)
    return NextResponse.json({ error: 'Failed to export report' }, { status: 500 })
  }
}
