// lib/accounting/ancestry.ts
// Git Model ancestry for branch heads.
// Provides the set of events that are "visible" at a given head (following parentEventId).
// This is what makes "restore to a previous commit" actually change the current state of the books.

import { prisma } from '@/lib/prisma'

/**
 * Walk from head backwards via parentEventId and return the ordered list of ancestor event ids (head first, root last).
 * Includes the head itself.
 */
export async function getAncestorEventIds(headEventId: string | null | undefined): Promise<string[]> {
  if (!headEventId) return []
  const visited = new Set<string>()
  const chain: string[] = []
  let current: string | null = headEventId
  while (current && !visited.has(current)) {
    visited.add(current)
    chain.push(current)
    const ev: { parentEventId: string | null } | null = await prisma.event.findUnique({
      where: { id: current },
      select: { parentEventId: true }
    })
    current = ev?.parentEventId || null
  }
  return chain
}

/**
 * Given a branch head, return the set of JournalEntry ids that are visible in its ancestry.
 * We consider an entry visible if its introducedByEventId is in the ancestor chain
 * AND there is no later (in the chain) JOURNAL_ENTRY_REVERSED event that targets it.
 *
 * For simplicity we rely on:
 * - Normal entries have introducedByEventId set to their creation event.
 * - Reversals create a new entry (the reversing one) and a REVERSED event with payload.originalEntryId.
 * - If the REVERSED event is in the ancestor chain after the creation, we exclude the original.
 */
export async function getVisibleJournalEntryIds(headEventId: string | null | undefined): Promise<string[]> {
  const ancestorIds = await getAncestorEventIds(headEventId)
  if (ancestorIds.length === 0) return []

  // Load the relevant events in one go (entries are introduced by CREATED / AI events,
  // and a REVERSED event introduces the *new* reversing entry).
  const events = await prisma.event.findMany({
    where: {
      id: { in: ancestorIds },
      eventType: { in: ['JOURNAL_ENTRY_CREATED', 'JOURNAL_ENTRY_REVERSED', 'AI_AUTONOMOUS_ENTRY'] }
    },
    select: { id: true, eventType: true, payload: true, entityId: true }
  })

  const createdEntryIds = new Set<string>()

  for (const ev of events) {
    if (ev.eventType === 'JOURNAL_ENTRY_CREATED' || ev.eventType === 'AI_AUTONOMOUS_ENTRY') {
      const p = ev.payload as { journalEntryId?: string; entityId?: string; journalEntry?: { id?: string } } | null
      const entryId = p?.journalEntryId || p?.entityId || p?.journalEntry?.id || ev.entityId
      if (entryId) createdEntryIds.add(String(entryId))
    } else if (ev.eventType === 'JOURNAL_ENTRY_REVERSED') {
      // The reversal event's own entityId is the NEW reversing entry. It is a
      // visible (posted) entry — accounting keeps BOTH the original and the
      // reversal on the books so they cancel (net zero). We therefore include it.
      if (ev.entityId) createdEntryIds.add(String(ev.entityId))
    }
  }

  // Every entry introduced by a visible event is visible. We do NOT exclude the
  // original of a reversal: the original and its (negated) reversal are both posted,
  // so the balance sheet nets them to zero — that is the correct "undo".
  const visible = new Set<string>(createdEntryIds)

  // Also directly include any JournalEntry whose introducedByEventId is in the
  // ancestor chain (catches legacy/alternate event shapes).
  if (ancestorIds.length > 0) {
    const direct = await prisma.journalEntry.findMany({
      where: { introducedByEventId: { in: ancestorIds } },
      select: { id: true }
    })
    for (const d of direct) visible.add(d.id)
  }

  return Array.from(visible)
}

/**
 * Helper: given head, return the list of visible journal entries (full objects with lines) for current state.
 */
export async function getVisibleJournalEntries(headEventId: string | null | undefined) {
  const ids = await getVisibleJournalEntryIds(headEventId)
  if (ids.length === 0) return []
  return prisma.journalEntry.findMany({
    where: { id: { in: ids } },
    include: {
      lines: {
        include: {
          account: { select: { code: true, name: true, type: true } },
          taxRate: { select: { id: true, jurisdiction: true, name: true, rate: true, taxType: true } },
          contact: { select: { id: true, name: true, type: true } }
        }
      }
    },
    orderBy: { date: 'desc' }
  })
}

/**
 * Resolve a "point" (event id or date string) to an event id for ancestry walking.
 * - If point looks like an event id and exists, use it.
 * - Else if date-like, find the latest event whose createdAt <= that date (for pinned historical view).
 * - Else return null.
 */
export async function resolveViewEventId(point?: string | null): Promise<string | null> {
  if (!point) return null
  // Try as direct event id
  const byId = await prisma.event.findUnique({ where: { id: point }, select: { id: true } })
  if (byId) return byId.id

  // Try as date
  const d = new Date(point)
  if (!isNaN(d.getTime())) {
    const ev = await prisma.event.findFirst({
      where: { createdAt: { lte: d } },
      orderBy: { createdAt: 'desc' },
      select: { id: true }
    })
    return ev?.id || null
  }
  return null
}

/**
 * Get visible journal entry ids at a specific point (event id or date string).
 * This is used for "Load" / pinned asOf views without moving any branch head.
 */
export async function getVisibleJournalEntryIdsAtPoint(point?: string | null): Promise<string[]> {
  const eventId = await resolveViewEventId(point)
  return getVisibleJournalEntryIds(eventId)
}
