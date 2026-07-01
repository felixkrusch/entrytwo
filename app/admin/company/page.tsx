'use client'

import { useEffect, useState } from 'react'
import { COUNTRIES, getRegionsForCountry, getSuggestedCurrency } from '@/lib/countries'

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
  const [loading, setLoading] = useState(true)

  const [companyName, setCompanyName] = useState('')
  const [address, setAddress] = useState<Address>({})
  const [baseCurrency, setBaseCurrency] = useState('EUR')
  const [defaultTaxJurisdiction, setDefaultTaxJurisdiction] = useState('')
  const [bank, setBank] = useState<Record<string, string>>({})
  const [taxId, setTaxId] = useState('')
  const [regNumber, setRegNumber] = useState('')
  const [logoPreview, setLogoPreview] = useState<string | null>(null)

  // Bank detail fields (internationalized: IBAN+BIC for EU, routing+account for US/CA)
  const [bankName, setBankName] = useState('')
  const [iban, setIban] = useState('')
  const [bic, setBic] = useState('')
  const [routing, setRouting] = useState('')
  const [accountNumber, setAccountNumber] = useState('')

  const fetchData = async () => {
    try {
      const res = await fetch('/api/settings')
      const s = await res.json()
      if (!Array.isArray(s)) return

      const getSettingValue = (key: string): string => {
        const setting = s.find((x: { key: string; value: { value?: string } | Record<string, unknown> }) => x.key === key)
        return ((setting?.value as { value?: string })?.value) || ''
      }

      const addrRaw = s.find((x: { key: string; value: SettingsValue }) => x.key === 'company.address')?.value as SettingsValue
      const addr: Address = (addrRaw && typeof addrRaw === 'object' && !Array.isArray(addrRaw)) ? addrRaw as Address : {}

      const bankRaw = s.find((x: { key: string; value: SettingsValue }) => x.key === 'company.bank')?.value as SettingsValue
      const bankObj: Record<string, string> = (bankRaw && typeof bankRaw === 'object' && !Array.isArray(bankRaw)) ? bankRaw as Record<string, string> : {}

      setCompanyName(getSettingValue('company.name'))
      setAddress(addr)
      setBaseCurrency(getSettingValue('baseCurrency') || 'EUR')
      setDefaultTaxJurisdiction(getSettingValue('defaultTaxJurisdiction'))
      setBank(bankObj)
      setBankName((bankObj.bankName as string) || '')
      setIban((bankObj.iban as string) || '')
      setBic((bankObj.bic as string) || '')
      setRouting((bankObj.routing as string) || (bankObj.transit as string) || '')
      setAccountNumber((bankObj.accountNumber as string) || (bankObj.account as string) || '')
      setTaxId(getSettingValue('company.taxId'))
      setRegNumber(getSettingValue('company.registrationNumber'))
      // logo is stored as data URL in company.logo
      const logoSetting = s.find((x: any) => x.key === 'company.logo')
      const logoVal = (logoSetting?.value as any)?.value
      setLogoPreview(typeof logoVal === 'string' ? logoVal : null)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const id = setTimeout(() => { void fetchData() }, 0)
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

  const saveBank = (partial: Record<string, string>) => {
    const next = { ...bank, ...partial }
    setBank(next)
    void fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'company.bank', value: next }),
    }).then(() => fetchData())
  }

  const updateAddressField = (field: keyof Address | 'street' | 'city' | 'zip' | 'line2' | 'state', value: string) => {
    const next: Address = { ...address } as Address
    ;(next as any)[field] = value || undefined
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
    return <div className="text-sm text-zinc-500">Loading...</div>
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Company Settings</h1>
        <p className="text-xs text-zinc-500">Location drives suggested currency and tax jurisdiction. Both can be overridden.</p>
      </div>

      <div className="space-y-4 max-w-xl">
        <div className="flex items-center gap-3">
          <label className="w-48 text-zinc-400">Company Name</label>
          <input
            value={companyName}
            onChange={e => setCompanyName(e.target.value)}
            onBlur={e => save('company.name', e.target.value)}
            className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1"
          />
        </div>

        <div className="flex items-center gap-3">
          <label className="w-48 text-zinc-400">Country</label>
          <select
            value={currentCountry}
            onChange={e => handleCountryChange(e.target.value)}
            className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1"
          >
            <option value="">Select country…</option>
            {COUNTRIES.map(c => (
              <option key={c.code} value={c.code}>{c.name}</option>
            ))}
          </select>
        </div>

        {availableRegions.length > 0 && (
          <div className="flex items-center gap-3">
            <label className="w-48 text-zinc-400">Province / State / Region</label>
            <select
              value={address.region || ''}
              onChange={e => handleRegionChange(e.target.value)}
              className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1"
            >
              <option value="">Select region…</option>
              {availableRegions.map(r => (
                <option key={r.code} value={r.code}>{r.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Full ISO address (like Add Contact) */}
        <div className="flex items-center gap-3">
          <label className="w-48 text-zinc-400">Street / Address Line 1</label>
          <input
            value={address.street || address.addressStreet || ''}
            onChange={e => updateAddressField('street', e.target.value)}
            onBlur={e => updateAddressField('street', e.target.value)}
            className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1"
            placeholder="Street and number"
          />
        </div>
        <div className="flex items-center gap-3">
          <label className="w-48 text-zinc-400">Address Line 2</label>
          <input
            value={address.line2 || address.addressLine2 || ''}
            onChange={e => updateAddressField('line2', e.target.value)}
            onBlur={e => updateAddressField('line2', e.target.value)}
            className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1"
            placeholder="Suite, building, etc."
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center gap-3">
            <label className="w-24 text-zinc-400">City</label>
            <input
              value={address.city || address.addressCity || ''}
              onChange={e => updateAddressField('city', e.target.value)}
              onBlur={e => updateAddressField('city', e.target.value)}
              className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1"
            />
          </div>
          <div className="flex items-center gap-3">
            <label className="w-24 text-zinc-400">ZIP / Postal</label>
            <input
              value={address.zip || address.addressZip || ''}
              onChange={e => updateAddressField('zip', e.target.value)}
              onBlur={e => updateAddressField('zip', e.target.value)}
              className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <label className="w-48 text-zinc-400">Base Currency</label>
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
          <label className="w-48 text-zinc-400">Default Tax Jurisdiction</label>
          <input
            value={defaultTaxJurisdiction}
            onChange={e => setDefaultTaxJurisdiction(e.target.value.toUpperCase())}
            onBlur={e => handleJurisdictionOverride(e.target.value)}
            placeholder="e.g. CA-ON, US-CA, DE"
            className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 font-mono text-sm"
          />
        </div>
        <div className="text-[10px] text-zinc-500 -mt-2">
          Full ISO 3166-2 when a region is selected (e.g. CA-ON, US-CA). Used for tax suggestions.
        </div>

        {/* Branding & Compliance fields required for professional invoices */}
        <div className="pt-4 border-t border-zinc-800 mt-4 space-y-4">
          <div className="flex items-center gap-3">
            <label className="w-48 text-zinc-400">VAT / Tax ID</label>
            <input value={taxId} onChange={e => setTaxId(e.target.value)} onBlur={e => saveTaxId(e.target.value)} placeholder="DE123456789" className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 font-mono text-sm" />
          </div>

          <div className="flex items-center gap-3">
            <label className="w-48 text-zinc-400">Registration / Company Number</label>
            <input value={regNumber} onChange={e => setRegNumber(e.target.value)} onBlur={e => saveReg(e.target.value)} placeholder="HRB 12345" className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 font-mono text-sm" />
          </div>

          {/* International bank details: EU (IBAN+BIC) or US/CA (routing+account) */}
          <div className="pt-2">
            <div className="text-sm font-medium mb-2 text-zinc-300">Bank Details</div>
            <div className="flex items-center gap-3 mb-2">
              <label className="w-48 text-zinc-400">Bank Name</label>
              <input value={bankName} onChange={e => setBankName(e.target.value)} onBlur={e => { setBankName(e.target.value); saveBank({ bankName: e.target.value }) }} className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1" placeholder="Deutsche Bank / Chase" />
            </div>
            <div className="flex items-center gap-3 mb-2">
              <label className="w-48 text-zinc-400">IBAN</label>
              <input value={iban} onChange={e => setIban(e.target.value)} onBlur={e => { setIban(e.target.value); saveBank({ iban: e.target.value }) }} className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 font-mono text-sm" placeholder="DE44 3704 0044 ..." />
            </div>
            <div className="flex items-center gap-3 mb-2">
              <label className="w-48 text-zinc-400">BIC / SWIFT</label>
              <input value={bic} onChange={e => setBic(e.target.value)} onBlur={e => { setBic(e.target.value); saveBank({ bic: e.target.value }) }} className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 font-mono text-sm" placeholder="DEUTDEFF" />
            </div>
            <div className="flex items-center gap-3 mb-2">
              <label className="w-48 text-zinc-400">Routing / Transit / ABA</label>
              <input value={routing} onChange={e => setRouting(e.target.value)} onBlur={e => { setRouting(e.target.value); saveBank({ routing: e.target.value }) }} className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 font-mono text-sm" placeholder="021000021 (US) / 12345-678 (CA)" />
            </div>
            <div className="flex items-center gap-3">
              <label className="w-48 text-zinc-400">Account Number</label>
              <input value={accountNumber} onChange={e => setAccountNumber(e.target.value)} onBlur={e => { setAccountNumber(e.target.value); saveBank({ accountNumber: e.target.value }) }} className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 font-mono text-sm" placeholder="1234567890" />
            </div>
          </div>

          <div className="flex items-start gap-3">
            <label className="w-48 text-zinc-400 pt-1">Company Logo (PNG/JPG/SVG)</label>
            <div>
              <input type="file" accept="image/*,.svg" onChange={handleLogoUpload} className="text-sm" />
              {logoPreview && (
                <div className="mt-2">
                  <img src={logoPreview} alt="logo preview" className="max-h-12 border border-zinc-700 rounded bg-white p-1" />
                  <div className="text-[10px] text-zinc-500">Will appear on invoices</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="text-[10px] text-zinc-500 mt-6">All changes are saved immediately and audited. Bank details (IBAN+BIC or routing+account), Tax ID, address and Logo are used for branded, jurisdiction-compliant invoices. Due date is shown on invoices; no default terms text.</div>
    </div>
  )
}