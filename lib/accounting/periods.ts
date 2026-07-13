import type { Prisma } from '@prisma/client'

export class ClosedAccountingPeriodError extends Error {
  constructor(public readonly periodName: string) {
    super(`Accounting period "${periodName}" is closed`)
    this.name = 'ClosedAccountingPeriodError'
  }
}

export async function assertAccountingPeriodOpen(tx: Prisma.TransactionClient, date: Date) {
  const period = await tx.accountingPeriod.findFirst({
    where: { startDate: { lte: date }, endDate: { gte: date }, status: 'CLOSED' },
    select: { name: true },
  })
  if (period) throw new ClosedAccountingPeriodError(period.name)
}
