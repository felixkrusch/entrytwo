import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/authz'
import { archiveThread, ChatThreadAccessError, getContextForModel } from '@/lib/chatThreadStore'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireUser(['ADMIN', 'ACCOUNTANT'])
  if (!session) return NextResponse.json({ error: 'Accountant access required' }, { status: 403 })
  const { id } = await params
  try {
    const messages = await getContextForModel(id, session.user.id, 200)
    return NextResponse.json({ id, messages })
  } catch (error) {
    if (error instanceof ChatThreadAccessError) return NextResponse.json({ error: 'Chat thread not found' }, { status: 404 })
    throw error
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireUser(['ADMIN', 'ACCOUNTANT'])
  if (!session) return NextResponse.json({ error: 'Accountant access required' }, { status: 403 })
  const { id } = await params
  try {
    await archiveThread(id, session.user.id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof ChatThreadAccessError) return NextResponse.json({ error: 'Chat thread not found' }, { status: 404 })
    throw error
  }
}
