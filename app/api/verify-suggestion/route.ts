import { NextResponse } from 'next/server'
import { verifySuggestion, type SuggestionToVerify } from '@/lib/verifySuggestion'

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json()
    const result = await verifySuggestion(body as SuggestionToVerify)
    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ ok: false, warnings: ['Verification request failed'] }, { status: 400 })
  }
}
