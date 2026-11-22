import { describe, expect, it } from 'vitest'
import { appViewHref, chatRequestBooksContext, readBooksContext } from '@/app/lib/booksContext'

function parse(href: string) {
  const url = new URL(href, 'http://entrytwo.test')
  return {
    path: url.pathname,
    view: url.searchParams.get('view'),
    branch: url.searchParams.get('branch'),
    asOf: url.searchParams.get('asOf'),
    accountCode: url.searchParams.get('accountCode'),
  }
}

describe('books context across panel navigation', () => {
  const books = 'view=dashboard&branch=experiment&asOf=evt-abc'

  it('preserves branch and asOf when switching panels', () => {
    for (const view of ['reports', 'journal', 'ledger', 'invoicing', 'contacts', 'history', 'receipts', 'claims']) {
      const href = appViewHref(view, books)
      expect(parse(href)).toMatchObject({ path: '/app', view, branch: 'experiment', asOf: 'evt-abc' })
    }
  })

  it('chat request still targets the selected books after a panel switch', () => {
    const afterSwitch = appViewHref('reports', books)
    expect(parse(afterSwitch)).toEqual({
      path: '/app',
      view: 'reports',
      branch: 'experiment',
      asOf: 'evt-abc',
      accountCode: null,
    })

    const payload = chatRequestBooksContext(afterSwitch)
    const body = {
      message: 'post rent to 6100',
      threadId: 'thread-1',
      chatLocked: false,
      ...payload,
    }

    expect(body).toMatchObject({
      message: 'post rent to 6100',
      branch: 'experiment',
      asOf: 'evt-abc',
    })
  })

  it('keeps a historical main asOf view after switching and sending chat', () => {
    const afterSwitch = appViewHref('journal', 'view=dashboard&asof=2024-06-30')
    expect(parse(afterSwitch)).toMatchObject({ view: 'journal', branch: null, asOf: '2024-06-30' })
    expect(chatRequestBooksContext(afterSwitch)).toEqual({ branch: 'main', asOf: '2024-06-30' })
  })

  it('omits live main from panel URLs and chat defaults to main', () => {
    const href = appViewHref('contacts', 'view=dashboard')
    expect(href).toBe('/app?view=contacts')
    expect(chatRequestBooksContext(href)).toEqual({ branch: 'main' })
  })

  it('carries books context onto ledger account switches', () => {
    const href = appViewHref('ledger', { branch: 'sandbox', asOf: 'evt-9' }, { accountCode: '1000' })
    expect(parse(href)).toEqual({
      path: '/app',
      view: 'ledger',
      branch: 'sandbox',
      asOf: 'evt-9',
      accountCode: '1000',
    })
    expect(chatRequestBooksContext(href)).toEqual({ branch: 'sandbox', asOf: 'evt-9' })
  })

  it('reads branch/asOf from URLSearchParams the same way chat send does', () => {
    expect(readBooksContext(new URLSearchParams(books))).toEqual({
      branch: 'experiment',
      asOf: 'evt-abc',
    })
  })
})
