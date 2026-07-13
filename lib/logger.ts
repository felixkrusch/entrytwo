import { getRequestId } from './correlation'

type LogLevel = 'info' | 'warn' | 'error'

const REDACT_KEYS = new Set([
  'password', 'secret', 'token', 'auth', 'authorization', 'key', 'apikey', 'api_key',
  'encryption_key', 'auth_secret', 'stripe', 'paypal', 'totp', 'recovery', 'ssn', 'taxid'
])

function redact(value: unknown, key?: string): unknown {
  if (value == null) return value

  const k = (key || '').toLowerCase()
  if (REDACT_KEYS.has(k)) return '[REDACTED]'

  if (typeof value === 'string') {
    // Redact obvious secrets / long tokens / keys
    if (/^(sk_|pk_|whsec_|Bearer |Basic ).{8,}/i.test(value)) return '[REDACTED]'
    if (value.length > 64 && /^[A-Za-z0-9+/=_-]{40,}$/.test(value)) return '[REDACTED]'
    return value
  }

  if (typeof value === 'object') {
    if (Array.isArray(value)) return value.map(v => redact(v))
    const out: Record<string, unknown> = {}
    for (const [kk, vv] of Object.entries(value as Record<string, unknown>)) {
      out[kk] = redact(vv, kk)
    }
    return out
  }

  return value
}

function format(level: LogLevel, requestId: string, message: string, meta?: Record<string, unknown>) {
  const ts = new Date().toISOString()
  const safeMeta = meta ? redact(meta) : undefined
  const base = `[${ts}] [${level.toUpperCase()}] [req:${requestId}] ${message}`
  if (safeMeta && Object.keys(safeMeta).length) {
    return `${base} ${JSON.stringify(safeMeta)}`
  }
  return base
}

export const logger = {
  info(message: string, meta?: Record<string, unknown>, req?: any) {
    const rid = getRequestId(req)
    // eslint-disable-next-line no-console
    console.log(format('info', rid, message, meta))
  },
  warn(message: string, meta?: Record<string, unknown>, req?: any) {
    const rid = getRequestId(req)
    // eslint-disable-next-line no-console
    console.warn(format('warn', rid, message, meta))
  },
  error(message: string, meta?: Record<string, unknown>, req?: any) {
    const rid = getRequestId(req)
    // eslint-disable-next-line no-console
    console.error(format('error', rid, message, meta))
  },
  withRequestId(req?: any) {
    return getRequestId(req)
  },
}
