import type { FeedTransaction } from '@prisma/client'

// Placeholder for future real-time feed event broadcasting
export function broadcastFeedEvent(tx: FeedTransaction): void {
  console.log('[FEED EVENT] New transaction:', tx.id, tx.merchant, tx.amount)
}