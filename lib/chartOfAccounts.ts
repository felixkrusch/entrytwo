import type { AccountType } from '@prisma/client'

export type LocaleCode = 'en' | 'de'

export type StandardAccount = {
  code: string
  type: AccountType
  name: { en: string; de: string }
}

/** Canonical standard chart — codes are stable; names are localized. */
export const STANDARD_ACCOUNTS: StandardAccount[] = [
  { code: '1000', type: 'ASSET', name: { en: 'Cash', de: 'Kasse' } },
  { code: '1010', type: 'ASSET', name: { en: 'Bank Account - Checking', de: 'Bankkonto - Giro' } },
  { code: '1020', type: 'ASSET', name: { en: 'Bank Account - Savings', de: 'Bankkonto - Spar' } },
  { code: '1100', type: 'ASSET', name: { en: 'Accounts Receivable', de: 'Forderungen aus Lieferungen und Leistungen' } },
  { code: '1200', type: 'ASSET', name: { en: 'Inventory', de: 'Vorräte' } },
  { code: '1300', type: 'ASSET', name: { en: 'Prepaid Expenses', de: 'Aktive Rechnungsabgrenzung' } },
  { code: '1500', type: 'ASSET', name: { en: 'Equipment', de: 'Betriebs- und Geschäftsausstattung' } },
  { code: '1510', type: 'ASSET', name: { en: 'Vehicles', de: 'Fahrzeuge' } },
  { code: '1600', type: 'ASSET', name: { en: 'Accumulated Depreciation', de: 'Kumulierte Abschreibungen' } },
  { code: '2000', type: 'LIABILITY', name: { en: 'Accounts Payable', de: 'Verbindlichkeiten aus Lieferungen und Leistungen' } },
  { code: '2100', type: 'LIABILITY', name: { en: 'Credit Cards', de: 'Kreditkarten' } },
  { code: '2200', type: 'LIABILITY', name: { en: 'Sales Tax Payable', de: 'Umsatzsteuer / MwSt Verbindlichkeiten' } },
  { code: '2300', type: 'LIABILITY', name: { en: 'Payroll Liabilities', de: 'Lohnverbindlichkeiten' } },
  { code: '2500', type: 'LIABILITY', name: { en: 'Loans Payable', de: 'Darlehen' } },
  { code: '2600', type: 'LIABILITY', name: { en: 'Mortgage Payable', de: 'Hypotheken' } },
  { code: '3000', type: 'EQUITY', name: { en: "Owner's Capital", de: 'Eigenkapital' } },
  { code: '3100', type: 'EQUITY', name: { en: "Owner's Drawings", de: 'Privatentnahmen' } },
  { code: '3200', type: 'EQUITY', name: { en: 'Retained Earnings', de: 'Gewinnvortrag / Bilanzgewinn' } },
  { code: '4000', type: 'REVENUE', name: { en: 'Sales / Service Revenue', de: 'Umsatzerlöse / Dienstleistungen' } },
  { code: '4100', type: 'REVENUE', name: { en: 'Consulting Revenue', de: 'Beratungserlöse' } },
  { code: '4200', type: 'REVENUE', name: { en: 'Other Income', de: 'Sonstige Erträge' } },
  { code: '5000', type: 'EXPENSE', name: { en: 'Cost of Goods Sold', de: 'Wareneinsatz' } },
  { code: '5100', type: 'EXPENSE', name: { en: 'Rent Expense', de: 'Miete' } },
  { code: '5200', type: 'EXPENSE', name: { en: 'Utilities', de: 'Energie und Versorgung' } },
  { code: '5300', type: 'EXPENSE', name: { en: 'Salaries & Wages', de: 'Löhne und Gehälter' } },
  { code: '5400', type: 'EXPENSE', name: { en: 'Marketing & Advertising', de: 'Marketing und Werbung' } },
  { code: '5500', type: 'EXPENSE', name: { en: 'Office Supplies', de: 'Büromaterial' } },
  { code: '5600', type: 'EXPENSE', name: { en: 'Travel & Meals', de: 'Reisekosten und Bewirtung' } },
  { code: '5700', type: 'EXPENSE', name: { en: 'Professional Fees', de: 'Fremdleistungen / Beratung' } },
  { code: '5800', type: 'EXPENSE', name: { en: 'Insurance', de: 'Versicherungen' } },
  { code: '5900', type: 'EXPENSE', name: { en: 'Depreciation Expense', de: 'Abschreibungen' } },
  { code: '5950', type: 'EXPENSE', name: { en: 'AI', de: 'KI / AI' } },
  { code: '6000', type: 'EXPENSE', name: { en: 'Miscellaneous Expense', de: 'Sonstige Aufwendungen' } },
]

/** Minimal set used by advanced onboarding when no full seed. */
export const MINIMAL_ACCOUNTS: StandardAccount[] = [
  STANDARD_ACCOUNTS.find((a) => a.code === '1000')!,
  STANDARD_ACCOUNTS.find((a) => a.code === '1010')!,
  STANDARD_ACCOUNTS.find((a) => a.code === '2000')!,
  STANDARD_ACCOUNTS.find((a) => a.code === '3200')!,
  STANDARD_ACCOUNTS.find((a) => a.code === '4000')!,
  STANDARD_ACCOUNTS.find((a) => a.code === '5100')!,
]

export function normalizeLocale(value: unknown): LocaleCode {
  return value === 'de' ? 'de' : 'en'
}

export function accountsForLocale(
  locale: LocaleCode,
  set: StandardAccount[] = STANDARD_ACCOUNTS,
): Array<{ code: string; name: string; type: AccountType }> {
  return set.map((a) => ({
    code: a.code,
    type: a.type,
    name: a.name[locale],
  }))
}

/** True if name matches either EN or DE standard name for that code. */
export function isStandardAccountName(code: string, name: string): boolean {
  const std = STANDARD_ACCOUNTS.find((a) => a.code === code)
  if (!std) return false
  const n = name.trim()
  return n === std.name.en || n === std.name.de
}
