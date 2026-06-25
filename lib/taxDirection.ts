import { AccountType } from '@prisma/client'

export type LineSide = { debit?: unknown; credit?: unknown }

export function getTaxDirection(
  accountType: string | AccountType,
  line: LineSide,
  explicit?: boolean | null
): boolean {
  if (typeof explicit === 'boolean') return explicit

  const type = String(accountType).toUpperCase()
  if (type === 'REVENUE') return false   // output
  if (type === 'EXPENSE') return true    // input

  // fallback to side - Decimal values already handled by Number()
  const d = Number(line.debit) || 0
  const c = Number(line.credit) || 0
  return d > c   // debit tax → input
}
