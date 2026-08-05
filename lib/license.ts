import { prisma } from '@/lib/prisma'

export const MASTER_LICENSE_KEY = 'FCKGW-RHQQ2-YXRKT-8TG6W-2B7Q8'

/** This app only accepts keys issued for this product (or master). */
export const LICENSE_PRODUCT = 'entrytwo' as const

export const TRIAL_DAYS = 30

export interface LicenseStatus {
  isLicensed: boolean
  daysRemaining: number | null
  firstUseAt: string | null
  acceptedKey?: string | null
}

export function getDaysSince(date: Date | string): number {
  const start = typeof date === 'string' ? new Date(date) : date
  const now = new Date()
  const diffMs = now.getTime() - start.getTime()
  return Math.floor(diffMs / (1000 * 60 * 60 * 24))
}

export function isWithinTrial(firstUseAt: string | null | undefined): boolean {
  if (!firstUseAt) return true
  return getDaysSince(firstUseAt) < TRIAL_DAYS
}

export async function verifyLicenseKey(key: string): Promise<boolean> {
  if (!key) return false
  if (key === MASTER_LICENSE_KEY) return true

  // IMPORTANT: "verify once, trust forever" policy
  // This function is called ONLY during activation (see /api/license/activate).
  // After a key is successfully accepted and stored, the app NEVER calls this again.
  // All runtime decisions use the stored license.acceptedKey flag (see getLicenseStatus).
  //
  // The external service (entrytwo_verify at LICENSE_VERIFY_URL) performs:
  // - Ed25519 signature verification of et1.<payload>.<sig> tokens
  // - Product binding (entrytwo vs invoices)
  // - Optional Stripe re-check (if STRIPE_SECRET_KEY is configured on the service)
  const verifyUrl = process.env.LICENSE_VERIFY_URL
  if (verifyUrl) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8000)
      const res = await fetch(verifyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, product: LICENSE_PRODUCT }),
        signal: controller.signal,
      })
      clearTimeout(timeout)
      if (res.ok) {
        const data = await res.json().catch(() => ({})) as {
          valid?: boolean
          product?: string
          master?: boolean
        }
        if (!data.valid) return false
        if (data.master) return true
        return data.product === LICENSE_PRODUCT
      }
    } catch {
      // network error / timeout / abort → fall through to false for non-master keys
    }
  }

  // No verify service configured (or call failed) → only master key works
  return false
}

export interface LicenseStatusResponse {
  firstUseAt: string | null
  daysRemaining: number
  inTrial: boolean
  isLicensed: boolean
  acceptedKey: string | null
}

export async function getLicenseStatus(): Promise<LicenseStatusResponse> {
  // "Verify once, trust forever"
  // This function does NOT contact the license verify service.
  // It only inspects the local Setting table:
  // - license.firstUseAt (for trial calculation)
  // - license.acceptedKey (if present → permanently licensed)
  //
  // The only place that ever calls the external service is verifyLicenseKey(),
  // and that is called exclusively from /api/license/activate at key entry time.

  const firstUseSetting = await prisma.setting.findUnique({ where: { key: 'license.firstUseAt' } })
  let firstUseAt: string | null = null
  if (firstUseSetting?.value && typeof firstUseSetting.value === 'object' && 'value' in firstUseSetting.value) {
    firstUseAt = (firstUseSetting.value as any).value as string
  } else if (firstUseSetting?.value && typeof firstUseSetting.value === 'string') {
    firstUseAt = firstUseSetting.value
  }

  if (!firstUseAt) {
    firstUseAt = new Date().toISOString()
    await prisma.setting.upsert({
      where: { key: 'license.firstUseAt' },
      update: { value: { value: firstUseAt } },
      create: { key: 'license.firstUseAt', value: { value: firstUseAt } },
    })
  }

  let acceptedKey: string | null = null
  const keySetting = await prisma.setting.findUnique({ where: { key: 'license.acceptedKey' } })
  if (keySetting?.value && typeof keySetting.value === 'object' && 'value' in keySetting.value) {
    acceptedKey = (keySetting.value as any).value as string
  } else if (keySetting?.value && typeof keySetting.value === 'string') {
    acceptedKey = keySetting.value
  }

  const isLicensed = !!acceptedKey
  const inTrialWindow = isWithinTrial(firstUseAt)

  const daysUsed = firstUseAt ? getDaysSince(firstUseAt) : 0
  const daysRemaining = Math.max(0, TRIAL_DAYS - daysUsed)

  return {
    firstUseAt,
    daysRemaining,
    inTrial: inTrialWindow && !isLicensed,
    isLicensed,
    acceptedKey: isLicensed ? acceptedKey : null,
  }
}
