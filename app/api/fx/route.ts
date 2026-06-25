import { NextResponse } from 'next/server'
import { getFxRateToBase } from '@/lib/fx'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const currency = searchParams.get('currency') || 'EUR'
  const date = searchParams.get('date') || undefined

  try {
    const rate = await getFxRateToBase(currency, date || undefined)
    return NextResponse.json({
      currency: currency.toUpperCase(),
      date: date || new Date().toISOString().slice(0, 10),
      fxRateToBase: rate,
      source: rate === 1 ? 'BASE' : (rate ? 'LOOKUP' : 'UNAVAILABLE'),
    })
  } catch {
    return NextResponse.json(
      { error: 'Failed to lookup FX rate' },
      { status: 500 }
    )
  }
}
