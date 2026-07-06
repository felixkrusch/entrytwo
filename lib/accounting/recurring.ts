// Shared date-advance helper for recurring schedules (journal + invoice).
export function advanceDate(date: Date, frequency: string, interval: number): Date {
  const d = new Date(date)
  switch (frequency) {
    case 'WEEKLY': d.setDate(d.getDate() + 7 * interval); break
    case 'MONTHLY': d.setMonth(d.getMonth() + interval); break
    case 'QUARTERLY': d.setMonth(d.getMonth() + 3 * interval); break
    case 'YEARLY': d.setFullYear(d.getFullYear() + interval); break
    default: d.setMonth(d.getMonth() + interval)
  }
  return d
}

export const RECURRING_FREQUENCIES = ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'] as const
export type RecurringFrequency = (typeof RECURRING_FREQUENCIES)[number]
