import { getRequestId } from './correlation'

type LogLevel = 'info' | 'warn' | 'error'

function format(level: LogLevel, requestId: string, message: string, meta?: Record<string, unknown>) {
  const ts = new Date().toISOString()
  const base = `[${ts}] [${level.toUpperCase()}] [req:${requestId}] ${message}`
  if (meta && Object.keys(meta).length) {
    return `${base} ${JSON.stringify(meta)}`
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
