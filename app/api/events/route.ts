import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const events = await prisma.event.findMany({
      orderBy: { createdAt: 'desc' },
      take: 25,
      include: {
        user: {
          select: { email: true }
        }
      }
    })

    const formatted = events.map(ev => {
      const p = (ev.payload as { description?: string | null; lines?: unknown[] } | null) || null
      return {
        id: ev.id,
        eventType: ev.eventType,
        entityType: ev.entityType,
        entityId: ev.entityId,
        createdAt: ev.createdAt,
        description: p?.description || null,
        summary: Array.isArray(p?.lines) ? `${p.lines.length} line(s)` : null,
        createdBy: ev.user?.email || ev.createdBy || 'system'
      }
    })

    return NextResponse.json(formatted)
  } catch (error) {
    console.error('Error fetching events:', error)
    return NextResponse.json({ error: 'Failed to fetch audit log' }, { status: 500 })
  }
}
