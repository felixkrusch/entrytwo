import type { FeedTransaction } from '@prisma/client'
import { logger } from './logger'

// Placeholder for future real-time feed event broadcasting
export function broadcastFeedEvent(tx: FeedTransaction): void {
  logger.info('New feed transaction', { id: tx.id, merchant: tx.merchant, amount: tx.amount })
}