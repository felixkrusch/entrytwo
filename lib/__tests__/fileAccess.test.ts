import { describe, expect, it } from 'vitest'
import { canAccessFileAsset } from '@/lib/fileAccess'

describe('private file authorization', () => {
  it('allows the uploader and claim owner', () => {
    expect(canAccessFileAsset({ userId: 'owner', role: 'VIEWER', createdById: 'owner', hasJournalReference: false })).toBe(true)
    expect(canAccessFileAsset({ userId: 'claimant', role: 'VIEWER', createdById: 'other', hasJournalReference: false, claimOwnerId: 'claimant' })).toBe(true)
  })

  it('allows accounting roles to inspect company documents', () => {
    expect(canAccessFileAsset({ userId: 'accountant', role: 'ACCOUNTANT', createdById: 'other', hasJournalReference: false })).toBe(true)
    expect(canAccessFileAsset({ userId: 'admin', role: 'ADMIN', createdById: 'other', hasJournalReference: false })).toBe(true)
  })

  it('does not expose another user private unstaged upload to viewers', () => {
    expect(canAccessFileAsset({ userId: 'viewer', role: 'VIEWER', createdById: 'other', hasJournalReference: false })).toBe(false)
  })

  it('allows authenticated company users to inspect posted journal evidence', () => {
    expect(canAccessFileAsset({ userId: 'viewer', role: 'VIEWER', createdById: 'other', hasJournalReference: true })).toBe(true)
  })
})
