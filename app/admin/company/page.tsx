'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import { COUNTRIES, getRegionsForCountry, getSuggestedCurrency } from '@/lib/countries'
import { companyBankRecord, readCompanyBank } from '@/lib/companyBank'

type SettingsValue = { value?: string } | Record<string, unknown>

interface Address {
  country?: string
  region?: string
  street?: string
  addressStreet?: string
  city?: string
  addressCity?: string
  state?: string
  addressState?: string
  zip?: string
  addressZip?: string
  line2?: string
  addressLine2?: string
}

export default function CompanySettingsPage() {
  const tForm = useTranslations('app.companyForm')
  const t = useTranslations('app.adminNav')
  const [loading, setLoading] = useState(true)

  const [companyName, setCompanyName] = useState('')
  const [address, setAddress] = useState<Address>({})
  const [baseCurrency, setBaseCurrency] = useState('EUR')
  const [defaultTaxJurisdiction, setDefaultTaxJurisdiction] = useState('')
  const [bank, setBank] = useState<Record<string, unknown> | null>(null)
  const [bankStatus, setBankStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [taxId, setTaxId] = useState('')
  const [regNumber, setRegNumber] = useState('')
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [defaultLanguage, setDefaultLanguage] = useState<'en' | 'de'>('en')

  const bankFields = readCompanyBank(bank)

  const fetchData = async (loadBank = false) => {
    try {
      const res = await fetch('/api/settings')
      if (!res.ok) return
      const s = await res.json()
      if (!Array.isArray(s)) return

      const getSettingValue = (key: string): string => {
        const setting = s.find((x: { key: string; value: { value?: string } | Record<string, unknown> }) => x.key === key)
        return ((setting?.value as { value?: string })?.value) || ''
      }

      const addrRaw = s.find((x: { key: string; value: SettingsValue }) => x.key === 'company.address')?.value as SettingsValue
      const addr: Address = (addrRaw && typeof addrRaw === 'object' && !Array.isArray(addrRaw)) ? addrRaw as Address : {}

      if (loadBank) {
        const bankRaw = s.find((x: { key: string }) => x.key === 'company.bank')?.value
        setBank(companyBankRecord(bankRaw))
      }

      setCompanyName(getSettingValue('company.name'))
      setAddress(addr)
      setBaseCurrency(getSettingValue('baseCurrency') || 'EUR')
      setDefaultTaxJurisdiction(getSettingValue('defaultTaxJurisdiction'))
      setTaxId(getSettingValue('company.taxId'))
      setRegNumber(getSettingValue('company.registrationNumber'))
      const lang = getSettingValue('company.defaultLanguage') || 'en'
      setDefaultLanguage(lang === 'de' ? 'de' : 'en')
      // logo is stored as data URL in company.logo
      const logoSetting = s.find((x: { key: string; value: SettingsValue }) => x.key === 'company.logo')
      const logoVal = (logoSetting?.value as SettingsValue & { value?: string })?.value
      setLogoPreview(typeof logoVal === 'string' ? logoVal : null)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const id = setTimeout(() => { void fetchData(true) }, 0)
    return () => clearTimeout(id)
  }, [])

  const save = async (key: string, val: string) => {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value: { value: val } }),
    })
    fetchData()
  }

  const saveAddress = async (newAddr: Address) => {
    setAddress(newAddr)
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'company.address', value: newAddr }),
    })
    fetchData()
  }

  const handleCountryChange = (country: string) => {
    const newAddr: Address = { country }
    const suggestedCurrency = getSuggestedCurrency(country)
    const suggestedJur = country

    setAddress(newAddr)
    setBaseCurrency(suggestedCurrency)
    setDefaultTaxJurisdiction(suggestedJur)

    void saveAddress(newAddr)
    void save('baseCurrency', suggestedCurrency)
    void save('defaultTaxJurisdiction', suggestedJur)
  }

  const handleRegionChange = (region: string) => {
    const newAddr: Address = { ...address, region }
    const newJur = region

    setAddress(newAddr)
    setDefaultTaxJurisdiction(newJur)

    void saveAddress(newAddr)
    void save('defaultTaxJurisdiction', newJur)
  }

  const handleCurrencyOverride = (val: string) => {
    setBaseCurrency(val.toUpperCase())
    void save('baseCurrency', val.toUpperCase())
  }

  const handleJurisdictionOverride = (val: string) => {
    setDefaultTaxJurisdiction(val.toUpperCase())
    void save('defaultTaxJurisdiction', val.toUpperCase())
  }

  const saveBank = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!bank || bankStatus === 'saving') return
    setBankStatus('saving')
    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'company.bank', value: bank }),
      })
      setBankStatus(response.ok ? 'saved' : 'error')
    } catch {
      setBankStatus('error')
    }
  }

  const updateAddressField = (field: keyof Address | 'street' | 'city' | 'zip' | 'line2' | 'state', value: string) => {
    const next: Address = { ...address } as Address
    ;(next as Record<string, unknown>)[field] = value || undefined
    // keep aliases in sync for PDF and other consumers
    if (field === 'street' || field === 'addressStreet') {
      next.street = value || undefined
      next.addressStreet = value || undefined
    }
    if (field === 'city' || field === 'addressCity') {
      next.city = value || undefined
      next.addressCity = value || undefined
    }
    if (field === 'state' || field === 'addressState') {
      next.state = value || undefined
      next.addressState = value || undefined
    }
    if (field === 'zip' || field === 'addressZip') {
      next.zip = value || undefined
      next.addressZip = value || undefined
    }
    if (field === 'line2' || field === 'addressLine2') {
      next.line2 = value || undefined
      next.addressLine2 = value || undefined
    }
    setAddress(next)
    void saveAddress(next)
  }

  const saveTaxId = (v: string) => {
    setTaxId(v)
    void save('company.taxId', v)
  }
  const saveReg = (v: string) => {
    setRegNumber(v)
    void save('company.registrationNumber', v)
  }

  const saveDefaultLanguage = async (v: 'en' | 'de') => {
    setDefaultLanguage(v)
    await save('company.defaultLanguage', v)
    // next-intl reads company.defaultLanguage on the server — reload to apply UI language
    window.location.reload()
  }

  const resetStandardAccountNames = async () => {
    const label = defaultLanguage === 'de' ? 'Deutsch' : 'English'
    if (
      !confirm(
        defaultLanguage === 'de'
          ? `Standard-Kontennamen auf ${label} zurücksetzen? Nur Konten mit noch unveränderten Standardnamen werden umbenannt. Fortfahren?`
          : `Reset standard chart-of-accounts names to ${label}? Only accounts that still use a standard name will be renamed. Continue?`,
      )
    ) {
      return
    }
    const res = await fetch('/api/accounts/reset-standard-names', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale: defaultLanguage, onlyUnmodified: true }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      alert(data.error || 'Failed')
      return
    }
    alert(
      defaultLanguage === 'de'
        ? `${data.updated ?? 0} Konten umbenannt, ${data.skipped ?? 0} übersprungen.`
        : `Renamed ${data.updated ?? 0} accounts, skipped ${data.skipped ?? 0}.`,
    )
  }

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/') && !file.name.toLowerCase().endsWith('.svg')) {
      alert('Please upload PNG, JPG, or SVG')
      return
    }
    const reader = new FileReader()
    reader.onload = async () => {
      const dataUrl = reader.result as string
      setLogoPreview(dataUrl)
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'company.logo', value: { value: dataUrl } }),
      })
      fetchData()
    }
    reader.readAsDataURL(file)
  }

  const currentCountry = address.country || ''
  const availableRegions = getRegionsForCountry(currentCountry)
  const suggestedCur = currentCountry ? getSuggestedCurrency(currentCountry) : ''

  if (loading) {
    return <div className="text-sm text-zinc-500">{t('loading')}</div>
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">{t('companyTitle')}</h1>
        <p className="text-xs text-zinc-500">{t('companySubtitle')}</p>
      </div>

      <div className="space-y-4 max-w-xl">
        <div className="flex items-center gap-3">
          <label className="w-48 text-zinc-400">{tForm('companyName')}</label>
          <input
            value={companyName}
            onChange={e => setCompanyName(e.target.value)}
            onBlur={e => save('company.name', e.target.value)}
            className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1"
          />
        </div>

        <div className="flex items-center gap-3">
          <label className="w-48 text-zinc-400">{tForm('country')}</label>
          <select
            value={currentCountry}
            onChange={e => handleCountryChange(e.target.value)}
            className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1"
          >
            <option value="">{tForm('selectCountry')}</option>
            {COUNTRIES.map(c => (
              <option key={c.code} value={c.code}>{c.name}</option>
            ))}
          </select>
        </div>

        {availableRegions.length > 0 && (
          <div className="flex items-center gap-3">
            <label className="w-48 text-zinc-400">{tForm('region')}</label>
            <select
              value={address.region || ''}
              onChange={e => handleRegionChange(e.target.value)}
              className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1"
            >
              <option value="">{tForm('selectRegion')}</option>
              {availableRegions.map(r => (
                <option key={r.code} value={r.code}>{r.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Full ISO address (like Add Contact) */}
        <div className="flex items-center gap-3">
          <label className="w-48 text-zinc-400">{tForm('street')}</label>
          <input
            value={address.street || address.addressStreet || ''}
            onChange={e => updateAddressField('street', e.target.value)}
            onBlur={e => updateAddressField('street', e.target.value)}
            className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1"
            placeholder={tForm("streetPh")}
          />
        </div>
        <div className="flex items-center gap-3">
          <label className="w-48 text-zinc-400">{tForm('line2')}</label>
          <input
            value={address.line2 || address.addressLine2 || ''}
            onChange={e => updateAddressField('line2', e.target.value)}
            onBlur={e => updateAddressField('line2', e.target.value)}
            className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1"
            placeholder={tForm("line2Ph")}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center gap-3">
            <label className="w-24 text-zinc-400">{tForm('city')}</label>
            <input
              value={address.city || address.addressCity || ''}
              onChange={e => updateAddressField('city', e.target.value)}
              onBlur={e => updateAddressField('city', e.target.value)}
              className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1"
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="w-24 text-zinc-400">{tForm('zip')}</label>
            <input
              value={address.zip || address.addressZip || ''}
              onChange={e => updateAddressField('zip', e.target.value)}
              onBlur={e => updateAddressField('zip', e.target.value)}
              className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <label className="w-48 text-zinc-400">{tForm('baseCurrency')}</label>
          <div className="flex-1">
            <select
              value={baseCurrency}
              onChange={e => handleCurrencyOverride(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1"
            >
              <option value="EUR">EUR</option>
              <option value="USD">USD</option>
              <option value="CAD">CAD</option>
              <option value="GBP">GBP</option>
              <option value="CHF">CHF</option>
              <option value="AUD">AUD</option>
              <option value="JPY">JPY</option>
              <option value="CNY">CNY</option>
            </select>
            {suggestedCur && baseCurrency !== suggestedCur && (
              <div className="mt-1 text-[10px] text-emerald-400">
                Suggested: {suggestedCur} (from {currentCountry}). You overrode it.
              </div>
            )}
            {suggestedCur && baseCurrency === suggestedCur && (
              <div className="mt-1 text-[10px] text-zinc-500">Suggested from {currentCountry}</div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <label className="w-48 text-zinc-400">{tForm('defaultTaxJurisdiction')}</label>
          <input
            value={defaultTaxJurisdiction}
            onChange={e => setDefaultTaxJurisdiction(e.target.value.toUpperCase())}
            onBlur={e => handleJurisdictionOverride(e.target.value)}
            placeholder={tForm("taxJurPh")}
            className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 font-mono text-sm"
          />
        </div>
        <div className="text-[10px] text-zinc-500 -mt-2">
          Full ISO 3166-2 when a region is selected (e.g. CA-ON, US-CA). Used for tax suggestions.
        </div>

        {/* Branding & Compliance fields required for professional invoices */}
        <div className="pt-4 border-t border-zinc-800 mt-4 space-y-4">
          <div className="flex items-center gap-3">
            <label className="w-48 text-zinc-400">{tForm('taxId')}</label>
            <input value={taxId} onChange={e => setTaxId(e.target.value)} onBlur={e => saveTaxId(e.target.value)} placeholder="DE123456789" className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 font-mono text-sm" />
          </div>

          <div className="flex items-center gap-3">
            <label className="w-48 text-zinc-400">{tForm('regNumber')}</label>
            <input value={regNumber} onChange={e => setRegNumber(e.target.value)} onBlur={e => saveReg(e.target.value)} placeholder="HRB 12345" className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 font-mono text-sm" />
          </div>

          {/* International bank details: EU (IBAN+BIC) or US/CA (routing+account) */}
          <form className="pt-2" onSubmit={saveBank}>
            <fieldset disabled={!bank || bankStatus === 'saving'} className="space-y-2">
              <legend className="mb-2 text-sm font-medium text-zinc-300">{tForm('bankDetails')}</legend>
              {([
                ['bankName', tForm('bankName'), 'Deutsche Bank / Chase'],
                ['iban', tForm('iban'), 'DE44 3704 0044 ...'],
                ['bic', tForm('bic'), 'DEUTDEFF'],
                ['routing', tForm('routing'), '021000021 (US) / 12345-678 (CA)'],
                ['accountNumber', tForm('accountNumber'), '1234567890'],
              ] as const).map(([field, label, placeholder]) => (
                <label key={field} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                  <span className="w-48 shrink-0 text-zinc-400">{label}</span>
                  <input type="text" value={bankFields[field]} placeholder={placeholder}
                    onChange={event => {
                      const value = event.target.value
                      setBank(current => current && { ...current, [field]: value })
                      setBankStatus('idle')
                    }}
                    className="min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-sm" />
                </label>
              ))}
              <button type="submit" className="rounded bg-zinc-800 px-3 py-1.5 text-sm hover:bg-zinc-700 disabled:opacity-50">
                {tForm('saveBankDetails')}
              </button>
            </fieldset>
            {bankStatus === 'saved' && <p role="status" className="mt-2 text-xs text-emerald-400">{tForm('bankSaved')}</p>}
            {bankStatus === 'error' && <p role="alert" className="mt-2 text-xs text-red-400">{tForm('bankSaveFailed')}</p>}
            {!bank && <p role="alert" className="mt-2 text-xs text-red-400">{tForm('bankLoadFailed')}</p>}
          </form>

           <div className="flex items-start gap-3">
             <label className="w-48 text-zinc-400 pt-1">Company Logo (PNG/JPG/SVG)</label>
             <div>
               <input type="file" accept="image/*,.svg" onChange={handleLogoUpload} className="text-sm" />
               {logoPreview && (
                 <div className="mt-2">
                   <img src={logoPreview} alt="logo preview" className="max-h-12 border border-zinc-700 rounded bg-white p-1" />
                   <div className="text-[10px] text-zinc-500">{tForm('logoHelp')}</div>
                 </div>
               )}
             </div>
           </div>

            <div className="flex items-start gap-3">
              <label className="w-48 text-zinc-400 pt-1">{t('defaultLanguage')}</label>
              <div className="flex flex-col gap-2">
                <select
                  value={defaultLanguage}
                  onChange={e => void saveDefaultLanguage(e.target.value as 'en' | 'de')}
                  className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-sm"
                >
                  <option value="en">{t('englishDefault')}</option>
                  <option value="de">{t('german')}</option>
                </select>
                <p className="text-[10px] text-zinc-500 max-w-md">
                  {t('defaultLanguageHelp')}
                </p>
                <button
                  type="button"
                  onClick={() => void resetStandardAccountNames()}
                  className="self-start text-xs px-3 py-1.5 rounded border border-zinc-700 text-zinc-300 hover:border-zinc-500"
                >
                  {t('applyStandardNames')}
                </button>
                <p className="text-[10px] text-zinc-600 max-w-md">
                  {t('applyStandardNamesHelp')}
                </p>
              </div>
            </div>
          </div>
        </div>

      <div className="text-[10px] text-zinc-500 mt-6">{tForm('footer')}</div>
    </div>
  )
}
