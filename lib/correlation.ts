import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'

export const REQUEST_ID_HEADER = 'x-request-id'

export function getRequestId(reqOrHeaders?: NextRequest | Request | Headers | Record<string, any>): string {
  if (!reqOrHeaders) return randomUUID()

  let h: any = reqOrHeaders
  if ((reqOrHeaders as any).headers) h = (reqOrHeaders as any).headers

  if (h instanceof Headers) {
    const v = h.get(REQUEST_ID_HEADER)
    if (v) return v
  } else if (h && typeof h === 'object') {
    const v = h[REQUEST_ID_HEADER] || h[REQUEST_ID_HEADER.toLowerCase()] || h['X-Request-Id']
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return randomUUID()
}

export function withRequestId<T extends Record<string, unknown>>(data: T, requestId?: string): T & { requestId: string } {
  return { ...data, requestId: requestId || randomUUID() } as any
}

export function logWithRequestId(requestId: string, ...args: any[]) {
  // eslint-disable-next-line no-console
  console.log(`[req:${requestId}]`, ...args)
}

import { logger } from './logger'
export { logger }
