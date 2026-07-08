import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import type { CompanyProfile } from '@/lib/companyProfile'

export interface MemoryEntry {
  id: string
  key: string
  value: unknown
  scope: string
  category?: string | null
  source?: string | null
  metadata?: unknown
  createdAt: Date
  updatedAt: Date
}

export interface SetMemoryInput {
  key: string
  value: unknown
  scope: string
  category?: string
  source?: string
  metadata?: unknown
}

/**
 * Memory Vault — persistent structured storage for agent knowledge.
 *
 * The advisory path can query this to ground answers without
 * forcing everything through execution action schemas.
 *
 * Authoritative facts (company profile, tax setup) should be seeded
 * by the system so the LLM always has correct data.
 */
export const MemoryVault = {
  /**
   * Get a single memory item by scope + key.
   */
  async get(scope: string, key: string): Promise<MemoryEntry | null> {
    try {
      const row = await prisma.agentMemory.findUnique({
        where: { scope_key: { scope, key } },
      })
      if (!row) return null
      return {
        id: row.id,
        key: row.key,
        value: row.value,
        scope: row.scope,
        category: row.category,
        source: row.source,
        metadata: row.metadata,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }
    } catch {
      // Table may not exist or other error — never break callers
      return null
    }
  },

  /**
   * Set (upsert) a memory item.
   */
  async set(input: SetMemoryInput): Promise<MemoryEntry> {
    const jsonOrNull = (v: unknown) =>
      v == null ? Prisma.JsonNull : (v as Prisma.InputJsonValue)
    try {
      const row = await prisma.agentMemory.upsert({
        where: { scope_key: { scope: input.scope, key: input.key } },
        update: {
          value: jsonOrNull(input.value),
          category: input.category ?? null,
          source: input.source ?? null,
          metadata: jsonOrNull(input.metadata),
        },
        create: {
          key: input.key,
          value: jsonOrNull(input.value),
          scope: input.scope,
          category: input.category ?? null,
          source: input.source ?? null,
          metadata: jsonOrNull(input.metadata),
        },
      })
      return {
        id: row.id,
        key: row.key,
        value: row.value,
        scope: row.scope,
        category: row.category,
        source: row.source,
        metadata: row.metadata,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }
    } catch {
      // Table missing or other error — never break the caller.
      return {
        id: 'noop',
        key: input.key,
        value: input.value,
        scope: input.scope,
        category: input.category ?? null,
        source: input.source ?? null,
        metadata: input.metadata ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    }
  },

  /**
   * List items by scope (optionally filtered by category).
   */
  async listByScope(scope: string, category?: string): Promise<MemoryEntry[]> {
    const rows = await prisma.agentMemory.findMany({
      where: {
        scope,
        ...(category ? { category } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    })
    return rows.map((r) => ({
      id: r.id,
      key: r.key,
      value: r.value,
      scope: r.scope,
      category: r.category,
      source: r.source,
      metadata: r.metadata,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }))
  },

  /**
   * Ensure the core company profile facts exist in the vault.
   * Called on chat turns or bootstrap so the advisory path always has them.
   */
  async ensureCompanyFacts(profile: CompanyProfile) {
    const facts = [
      { key: 'company.baseCurrency', value: profile.baseCurrency, scope: 'company', category: 'fact', source: 'system' },
      { key: 'company.country', value: profile.country ?? null, scope: 'company', category: 'fact', source: 'system' },
      { key: 'company.region', value: profile.region ?? null, scope: 'company', category: 'fact', source: 'system' },
      { key: 'company.defaultTaxJurisdiction', value: profile.defaultTaxJurisdiction ?? null, scope: 'company', category: 'fact', source: 'system' },
    ]

    for (const f of facts) {
      if (f.value != null) {
        await this.set(f as SetMemoryInput)
      }
    }
  },
}
