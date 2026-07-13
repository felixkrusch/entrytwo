import { NextResponse } from 'next/server'
import { verifySuggestion, type SuggestionToVerify } from '@/lib/verifySuggestion'
import { requireUser } from '@/lib/authz'

export async function POST(request: Request) {
  if (!await requireUser(['ADMIN', 'ACCOUNTANT'])) return NextResponse.json({ error: 'Accountant access required' }, { status: 403 })
  try {
    const body: unknown = await request.json()
    const result = await verifySuggestion(body as SuggestionToVerify)
    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ ok: false, warnings: ['Verification request failed'] }, { status: 400 })
  }
}
