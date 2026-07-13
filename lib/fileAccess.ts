export function canAccessFileAsset(input: {
  userId: string
  role: 'ADMIN' | 'ACCOUNTANT' | 'VIEWER'
  createdById: string
  hasJournalReference: boolean
  claimOwnerId?: string
}) {
  return input.createdById === input.userId
    || input.hasJournalReference
    || input.role === 'ADMIN'
    || input.role === 'ACCOUNTANT'
    || input.claimOwnerId === input.userId
}
