// lib/accounting/commit.ts
// Git Model helper: after creating a journal entry (or other commit), update branch heads using ancestry.
// See docs/Git-Model-for-Accounting.md

import { prisma } from '@/lib/prisma'
import { setBranchHead, ensureMainBranch, getBranch } from './branch'

/**
 * Record a commit on a specific branch (default main).
 * - Links the event (via parentEventId) to the *current head* of the branch.
 * - Advances the branch head to the new event.
 * - Optionally sets introducedByEventId on the journal entry.
 */
export async function recordCommitOnBranch(
  journalEntryId?: string,
  branchName: string = 'main',
  eventIdForParenting?: string
) {
  await ensureMainBranch()
  const branch = await getBranch(branchName) || await ensureMainBranch()
  const currentHead = branch.headEventId || null

  // If we have a specific event id to use as the "commit event" (we created it inside tx), use it.
  // Otherwise fall back to latest event (legacy path).
  let commitEventId = eventIdForParenting
  if (!commitEventId) {
    const latest = await prisma.event.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    commitEventId = latest?.id
  }

  if (commitEventId) {
    // Set parent on the commit event to current head (so ancestry is correct)
    await prisma.event.update({
      where: { id: commitEventId },
      data: { parentEventId: currentHead }
    }).catch(() => {}) // best effort if already set or race

    // If we have a journal entry, mark it as introduced by this event
    if (journalEntryId) {
      await prisma.journalEntry.update({
        where: { id: journalEntryId },
        data: { introducedByEventId: commitEventId }
      }).catch(() => {})
    }

    await setBranchHead(branchName, commitEventId)
  }
}

/** Back-compat: default to main */
export async function recordCommitOnMain(journalEntryId?: string) {
  return recordCommitOnBranch(journalEntryId, 'main')
}
