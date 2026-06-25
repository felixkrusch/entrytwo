'use client'

import { useEffect, useState } from 'react'
import { COUNTRIES, getRegionsForCountry, getSuggestedCurrency } from '@/lib/countries'

interface Setting {
  id: string
  key: string
  value: { value?: string } | Record<string, unknown>
}

interface Address {
  country?: string
  region?: string // full ISO 3166-2 e.g. "CA-ON"
}

export default function CompanySettingsPage() {
  const [settings, setSettings] = useState<Setting[]>([])
  const [loading, setLoading] = useState(true)

  const [companyName, setCompanyName] = useState('')
  const [address, setAddress] = useState<Address>({})
  const [baseCurrency, setBaseCurrency] = useState('EUR')
  const [defaultTaxJurisdiction, setDefaultTaxJurisdiction] = useState('')

  const fetchData = async () => {
    try {
      const res = await fetch('/api/settings')
      const s = await res.json()
      if (!Array.isArray(s)) return

      setSettings(s)

      const name = ((s.find((x: Setting) => x.key === 'company.name')?.value as any)?.value) || ''
      const addrRaw = s.find((x: Setting) => x.key === 'company.address')?.value as any
      const addr: Address = (addrRaw && typeof addrRaw === 'object' && !Array.isArray(addrRaw)) ? addrRaw : {}
      const bc = ((s.find((x: Setting) => x.key === 'baseCurrency')?.value as any)?.value) || 'EUR'
      const jur = ((s.find((x: Setting) => x.key === 'defaultTaxJurisdiction')?.value as any)?.value) || ''

      setCompanyName(name)
      setAddress(addr)
      setBaseCurrency(bc)
      setDefaultTaxJurisdiction(jur)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchData()
  }, [])

  const save = async (key: string, val: any) => {
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
    const suggestedJur = country // start with country; region will refine it

    setAddress(newAddr)
    setBaseCurrency(suggestedCurrency)
    setDefaultTaxJurisdiction(suggestedJur)

    // persist all three
    void saveAddress(newAddr)
    void save('baseCurrency', suggestedCurrency)
    void save('defaultTaxJurisdiction', suggestedJur)
  }

  const handleRegionChange = (region: string) => {
    const newAddr: Address = { ...address, region }
    // jurisdiction becomes the full region code when a region is chosen
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
      </div>

      <div className="text-[10px] text-zinc-500 mt-6">All changes are saved immediately and audited.</div>
    </div>
  )
}
