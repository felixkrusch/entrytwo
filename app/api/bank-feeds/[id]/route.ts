import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/authz'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!await requireUser(['ADMIN'])) return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  const { id } = await params
  try {
    const connection = await prisma.bankConnection.findUnique({
      where: { id },
      include: { account: true },
    })

    if (!connection) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
    }

    return NextResponse.json(connection)
  } catch {
    return NextResponse.json({ error: 'Failed to fetch connection' }, { status: 500 })
  }
}
