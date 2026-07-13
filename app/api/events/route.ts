import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/authz'
import { logger } from '@/lib/logger'

export async function GET() {
  if (!await requireUser()) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  try {
    const events = await prisma.event.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,  // More for a rich GitHub-style commit history view
      include: {
        user: {
          select: { email: true }
        }
      }
    })

    const formatted = events.map(ev => {
      const p = (ev.payload as { description?: string | null; lines?: unknown[]; journalEntry?: unknown } | null) || null
      return {
        id: ev.id,
        eventType: ev.eventType,
        entityType: ev.entityType,
        entityId: ev.entityId,
        createdAt: ev.createdAt,
        description: p?.description || null,
        summary: Array.isArray(p?.lines) ? `${p.lines.length} line(s)` : null,
        createdBy: ev.user?.email || ev.createdBy || 'system',
        payload: p // Include full payload for detail view
      }
    })

    return NextResponse.json(formatted)
  } catch (error) {
    logger.error('Error fetching events', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: 'Failed to fetch audit log' }, { status: 500 })
  }
}
