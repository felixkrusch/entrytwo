import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const body = await request.json()
    const { syncEnabled } = body

    const connection = await prisma.bankConnection.update({
      where: { id },
      data: { syncEnabled },
      include: { account: true },
    })

    return NextResponse.json(connection)
  } catch {
    return NextResponse.json({ error: 'Failed to update connection' }, { status: 500 })
  }
}