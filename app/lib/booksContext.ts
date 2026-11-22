export type BooksContext = {
  branch: string
  asOf?: string
}

export type BooksContextInput =
  | { branch?: string | null; asOf?: string | null }
  | { get(name: string): string | null; toString(): string }
  | string
  | null
  | undefined

function queryFromHref(value: string): string {
  if (value.startsWith('?')) return value.slice(1)
  const q = value.indexOf('?')
  return q >= 0 ? value.slice(q + 1) : value
}

function isSearchLike(input: BooksContextInput): input is { get(name: string): string | null; toString(): string } {
  return !!input && typeof input === 'object' && typeof (input as { get?: unknown }).get === 'function'
}

function toParams(input?: BooksContextInput): URLSearchParams {
  if (!input) return new URLSearchParams()
  if (typeof input === 'string') return new URLSearchParams(queryFromHref(input))
  if (isSearchLike(input)) return new URLSearchParams(input.toString())
  const params = new URLSearchParams()
  if (input.branch) params.set('branch', input.branch)
  if (input.asOf) params.set('asOf', input.asOf)
  return params
}

export function readBooksContext(input?: BooksContextInput): BooksContext {
  const params = toParams(input)
  const branch = params.get('branch') || 'main'
  const asOf = params.get('asOf') || params.get('asof') || undefined
  return asOf ? { branch, asOf } : { branch }
}

export function chatRequestBooksContext(input?: BooksContextInput): BooksContext {
  return readBooksContext(input)
}

export function appViewHref(
  view: string,
  books?: BooksContextInput,
  extra?: Record<string, string | undefined | null>,
): string {
  const ctx = readBooksContext(books)
  const params = new URLSearchParams()
  if (view) params.set('view', view)
  if (ctx.branch && ctx.branch !== 'main') params.set('branch', ctx.branch)
  if (ctx.asOf) params.set('asOf', ctx.asOf)
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value) params.set(key, value)
    }
  }
  const qs = params.toString()
  return qs ? `/app?${qs}` : '/app'
}
