export function companyBankRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const record = value as Record<string, unknown>
  if ('value' in record) {
    const inner = record.value
    return inner && typeof inner === 'object' && !Array.isArray(inner) ? inner as Record<string, unknown> : {}
  }
  return record
}

export function readCompanyBank(value: unknown) {
  const bank = companyBankRecord(value)
  const text = (input: unknown) => typeof input === 'string' ? input : ''
  return {
    bankName: text(bank.bankName),
    iban: text(bank.iban),
    bic: text(bank.bic),
    routing: text(bank.routing ?? bank.transit),
    accountNumber: text(bank.accountNumber ?? bank.account),
  }
}
