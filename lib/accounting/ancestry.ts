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

  // Load the relevant events in one go (we only care about created and reversed)
  const events = await prisma.event.findMany({
    where: {
      id: { in: ancestorIds },
      eventType: { in: ['JOURNAL_ENTRY_CREATED', 'JOURNAL_ENTRY_REVERSED'] }
    },
    select: { id: true, eventType: true, payload: true }
  })

  // Map event id -> its position in chain (lower index = newer, since chain[0] is head)
  const position = new Map<string, number>()
  ancestorIds.forEach((id, idx) => position.set(id, idx))

  const createdEntryIds = new Set<string>()
  const reversedEntryIds = new Set<string>()

  for (const ev of events) {
    if (ev.eventType === 'JOURNAL_ENTRY_CREATED') {
      const entryId = (ev.payload as any)?.journalEntryId || (ev.payload as any)?.entityId
      // Fallback: many older events put it in entityId when entityType=JournalEntry
      if (entryId) createdEntryIds.add(String(entryId))
      // Also support the case where we set introducedBy later and store in payload.journalEntry
      const alt = (ev.payload as any)?.journalEntry?.id
      if (alt) createdEntryIds.add(String(alt))
    } else if (ev.eventType === 'JOURNAL_ENTRY_REVERSED') {
      const orig = (ev.payload as any)?.originalEntryId || (ev.payload as any)?.journalEntryId || (ev.payload as any)?.entityId
      if (orig) reversedEntryIds.add(String(orig))
    }
  }

  // Exclude any that have a reversal in the visible chain.
  const visible = new Set<string>()
  for (const id of createdEntryIds) {
    if (!reversedEntryIds.has(id)) {
      visible.add(id)
    }
  }

  // Also directly include any JournalEntry that has its introducedByEventId in the ancestor chain.
  // This catches cases where the event payload didn't contain the id (legacy or different shapes).
  if (ancestorIds.length > 0) {
    const direct = await prisma.journalEntry.findMany({
      where: { introducedByEventId: { in: ancestorIds } },
      select: { id: true }
    })
    for (const d of direct) {
      if (!reversedEntryIds.has(d.id)) {
        visible.add(d.id)
      }
    }
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
