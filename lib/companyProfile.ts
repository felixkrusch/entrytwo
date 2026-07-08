import { prisma } from '@/lib/prisma'

export interface CompanyProfile {
  baseCurrency: string
  country?: string
  region?: string // full ISO 3166-2 when known, e.g. "DE-BW"
  defaultTaxJurisdiction?: string
  // Future: fiscalYearStart, vatNumber, etc.
}

/**
 * Returns the authoritative company profile / system facts.
 * This is the single source the AI should use for tax decisions and context.
 *
 * These values come from the app (Settings), not from the user's chat or the model.
 * They are injected into both execution and advisory paths.
 */
export async function getCompanyProfile(): Promise<CompanyProfile> {
  const profile: CompanyProfile = {
    baseCurrency: 'EUR',
  }

  try {
    const [addrSetting, jurSetting, bcSetting] = await Promise.all([
      prisma.setting.findUnique({ where: { key: 'company.address' } }),
      prisma.setting.findUnique({ where: { key: 'defaultTaxJurisdiction' } }),
      prisma.setting.findUnique({ where: { key: 'baseCurrency' } }),
    ])

    const addr = addrSetting?.value as unknown as { region?: string; country?: string } | null
    const jur = (jurSetting?.value as unknown as { value?: string })?.value || (jurSetting?.value as unknown as string)
    const bcVal = bcSetting?.value
    const bc = (bcVal && typeof bcVal === 'object' && 'value' in bcVal ? (bcVal as Record<string, unknown>).value : bcVal) as string | null | undefined

    if (addr?.region) {
      profile.region = String(addr.region).toUpperCase()
    } else if (jur) {
      profile.region = String(jur).toUpperCase()
    }

    if (addr?.country) {
      profile.country = String(addr.country).toUpperCase()
    } else if (profile.region) {
      profile.country = profile.region.split('-')[0]
    }

    if (jur) {
      profile.defaultTaxJurisdiction = String(jur).toUpperCase()
    }

    if (typeof bc === 'string' && bc.trim()) {
      profile.baseCurrency = bc.trim().toUpperCase()
    }
  } catch {
    // Fail soft — return defaults. The advisory path will still work but should note limited company data.
  }

  return profile
}
