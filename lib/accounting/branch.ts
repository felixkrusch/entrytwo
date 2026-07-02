// lib/accounting/branch.ts
// Git Model for Accounting - Branch management (main, proposals, AI experiments)
// See docs/Git-Model-for-Accounting.md and docs/Git-Model-Implementation-Plan.md

import { prisma } from '@/lib/prisma'

export interface BranchInfo {
  id: string
  name: string
  description?: string | null
  headEventId?: string | null
  isMain: boolean
  createdAt: Date
}

/**
 * Ensure the "main" branch exists. Called on bootstrap or first use.
 */
export async function ensureMainBranch(): Promise<BranchInfo> {
  let main = await prisma.accountingBranch.findUnique({ where: { name: 'main' } })

  if (!main) {
    // Point at the latest event if any, otherwise null
    const latestEvent = await prisma.event.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })

    main = await prisma.accountingBranch.create({
      data: {
        name: 'main',
        description: 'Primary line of truth (like git main)',
        headEventId: latestEvent?.id || null,
        isMain: true,
      },
    })
  }

  return {
    id: main.id,
    name: main.name,
    description: main.description,
    headEventId: main.headEventId,
    isMain: main.isMain,
    createdAt: main.createdAt,
  }
}

export async function getBranch(name: string): Promise<BranchInfo | null> {
  const b = await prisma.accountingBranch.findUnique({ where: { name } })
  if (!b) return null
  return {
    id: b.id,
    name: b.name,
    description: b.description,
    headEventId: b.headEventId,
    isMain: b.isMain,
    createdAt: b.createdAt,
  }
}

export async function listBranches(): Promise<BranchInfo[]> {
  const branches = await prisma.accountingBranch.findMany({
    orderBy: { createdAt: 'asc' },
  })
  return branches.map(b => ({
    id: b.id,
    name: b.name,
    description: b.description,
    headEventId: b.headEventId,
    isMain: b.isMain,
    createdAt: b.createdAt,
  }))
}

/**
 * Create a new branch from a point (event id) or from current main head.
 */
export async function createBranch(name: string, fromEventId?: string, description?: string): Promise<BranchInfo> {
  const existing = await prisma.accountingBranch.findUnique({ where: { name } })
  if (existing) {
    throw new Error(`Branch "${name}" already exists`)
  }

  let headEventId = fromEventId || null

  if (!headEventId) {
    // Default to current main head
    const main = await ensureMainBranch()
    headEventId = main.headEventId || null
  }

  const branch = await prisma.accountingBranch.create({
    data: {
      name,
      description: description || `Branch created from ${headEventId || 'current main'}`,
      headEventId,
      isMain: false,
    },
  })

  // Audit event (system action - no user FK)
  // Set parent to the from point so the branch starts its ancestry from there
  await prisma.event.create({
    data: {
      eventType: 'BRANCH_CREATED',
      entityType: 'AccountingBranch',
      entityId: branch.id,
      parentEventId: headEventId || null,
      payload: {
        name,
        fromEventId: headEventId,
        description: branch.description,
      },
      createdBy: null,
    },
  })

  return {
    id: branch.id,
    name: branch.name,
    description: branch.description,
    headEventId: branch.headEventId,
    isMain: branch.isMain,
    createdAt: branch.createdAt,
  }
}

/**
 * Update the head of a branch (used after commits, merges, restores).
 */
export async function setBranchHead(name: string, eventId: string): Promise<void> {
  await prisma.accountingBranch.updateMany({
    where: { name },
    data: { headEventId: eventId },
  })
}

/**
 * Get the current head event id for main (convenience).
 */
export async function getMainHeadEventId(): Promise<string | null> {
  const main = await ensureMainBranch()
  return main.headEventId || null
}
