import { describe, expect, it } from 'vitest'
import { appendToThread, getContextForModel, loadOrCreateThread } from '../chatThreadStore'

describe('chat thread context', () => {
  it('retains document context across follow-up turns', () => {
    const { thread } = loadOrCreateThread()
    appendToThread(thread.id, {
      role: 'user',
      content: 'Process this statement\nAttachments available in this turn:\n- visa.pdf (/uploads/receipts/visa.pdf)',
    })
    appendToThread(thread.id, { role: 'assistant', content: '{"action":"CREATE_JOURNAL_BATCH"}' })
    appendToThread(thread.id, { role: 'user', content: 'What was the second transaction?' })

    const context = getContextForModel(thread)
    expect(context).toHaveLength(3)
    expect(context[0].content).toContain('visa.pdf')
    expect(context[1].content).toContain('CREATE_JOURNAL_BATCH')
  })
})
