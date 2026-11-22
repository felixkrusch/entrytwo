import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/journal-entries/route'

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(), count: vi.fn(), findBranch: vi.fn(), findUsers: vi.fn(),
  visibleAt: vi.fn(), visibleAtHead: vi.fn(), requireUser: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: {
  accountingBranch: { findUnique: mocks.findBranch },
  journalEntry: { findMany: mocks.findMany, count: mocks.count },
  user: { findMany: mocks.findUsers },
} }))
vi.mock('@/lib/authz', () => ({ requireUser: mocks.requireUser }))
vi.mock('@/lib/companyProfile', () => ({ getCompanyProfile: async () => ({ baseCurrency: 'EUR' }) }))
vi.mock('@/lib/accounting/ancestry', () => ({
  getVisibleJournalEntryIds: mocks.visibleAtHead,
  getVisibleJournalEntryIdsAtPoint: mocks.visibleAt,
}))

const ref = 'JE-2026-0001'
const request = (query: string) => new Request(`http://localhost/api/journal-entries?${query}`)

beforeEach(() => {
  vi.resetAllMocks()
  mocks.requireUser.mockResolvedValue({ user: { id: 'reader' } })
  mocks.findBranch.mockResolvedValue({ headEventId: 'head' })
  mocks.visibleAtHead.mockResolvedValue(['older-entry', 'newer-entry'])
  mocks.visibleAt.mockResolvedValue([])
  mocks.findMany.mockResolvedValue([])
  mocks.count.mockResolvedValue(80)
})

describe('journal reference links', () => {
  it('fetches the exact entry regardless of list filters or page and includes details', async () => {
    mocks.findMany.mockResolvedValue([{
      id: 'older-entry', entryNumber: ref, createdBy: 'creator',
      lines: [{ id: 'line', debit: '50', credit: '0', account: { code: '1000' } }],
      attachments: [{ id: 'attachment', fileAssetId: 'file', fileAsset: { originalName: 'receipt.pdf' } }],
    }])
    mocks.findUsers.mockResolvedValue([{ id: 'creator', name: 'Test Accountant' }])
    const response = await GET(request(`entryRef=${ref}&branch=draft&page=4&search=unrelated&accountCode=2000`))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      branch: 'draft', total: 1, page: 1, totalPages: 1,
      entries: [{ id: 'older-entry', entryNumber: ref, createdByUser: { name: 'Test Accountant' },
        lines: [{ debit: '50', account: { code: '1000' } }],
        attachments: [{ originalName: 'receipt.pdf', path: '/api/files/file' }],
      }],
    })
    expect(mocks.findBranch).toHaveBeenCalledWith({ where: { name: 'draft' } })
    expect(mocks.findMany.mock.calls[0][0]).toMatchObject({
      where: { entryNumber: ref, id: { in: ['older-entry', 'newer-entry'] } }, take: 1,
    })
    expect(mocks.findMany.mock.calls[0][0]).not.toHaveProperty('skip')
    expect(mocks.count).not.toHaveBeenCalled()
  })

  it('does not fall back to the journal list when the snapshot is empty', async () => {
    const response = await GET(request(`entryRef=${ref}&asOf=snapshot`))
    expect(mocks.visibleAt).toHaveBeenCalledWith('snapshot')
    expect(mocks.findMany.mock.calls[0][0].where).toEqual({ id: 'no-visible-entries-match', entryNumber: ref })
    expect(await response.json()).toMatchObject({ entries: [], total: 0 })
  })

  it('keeps list pagination unchanged without a reference', async () => {
    const response = await GET(request('page=2&limit=25'))
    expect(mocks.findMany.mock.calls[0][0]).toMatchObject({ skip: 25, take: 25 })
    expect(mocks.count).toHaveBeenCalledOnce()
    expect(await response.json()).toMatchObject({ page: 2, total: 80, totalPages: 4 })
  })
})
