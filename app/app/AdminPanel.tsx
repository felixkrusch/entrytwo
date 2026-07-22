'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { COUNTRIES, getRegionsForCountry, getSuggestedCurrency } from '@/lib/countries'
import TOTPSetup from './TOTPSetup'

interface User {
  id: string
  email: string
  name: string | null
  role: 'ADMIN' | 'ACCOUNTANT' | 'VIEWER'
  createdAt: string
}

interface Setting {
  id: string
  key: string
  value: { value?: string } | Record<string, unknown>
}

interface AdminPanelProps {
  onBootstrapComplete?: () => void
}

export default function AdminPanel({ onBootstrapComplete }: AdminPanelProps) {
  const t = useTranslations('app.panels.admin')
  const [users, setUsers] = useState<User[]>([])
  const [settings, setSettings] = useState<Setting[]>([])
  const [loading, setLoading] = useState(true)
  const [isBootstrap, setIsBootstrap] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)

  const [newEmail, setNewEmail] = useState('')
  const [newName, setNewName] = useState('')
  const [newRole, setNewRole] = useState<'ADMIN' | 'ACCOUNTANT' | 'VIEWER'>('ACCOUNTANT')

  const [companyName, setCompanyName] = useState('')
  const [baseCurrency, setBaseCurrency] = useState('USD')
  const [defaultCountry, setDefaultCountry] = useState('')
  const [defaultLanguage, setDefaultLanguage] = useState<'en' | 'de'>('en')

  const fetchData = async () => {
    try {
      const [uRes, sRes, bRes] = await Promise.all([
        fetch('/api/users'),
        fetch('/api/settings'),
        fetch('/api/bootstrap/status'),
      ])
      const u = await uRes.json()
      const s = await sRes.json()
      const b = await bRes.json()

      const userList = Array.isArray(u) ? u : []
      setUsers(userList)
      if (Array.isArray(s)) setSettings(s)

      const bootstrapFromApi = !!b?.needsBootstrap
      const hasAdmin = userList.some((x: User) => x.role === 'ADMIN')
      setIsBootstrap(bootstrapFromApi || !hasAdmin)
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

  const createUser = async (forceAdmin = false) => {
    if (!newEmail) return
    if (forceAdmin) {
      // Prefer full onboarding so language + CoA are applied
      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: newEmail,
          name: newName || undefined,
          companyName: companyName || 'My Company',
          baseCurrency,
          defaultLanguage,
        }),
      })
      if (res.ok) {
        window.location.reload()
        return
      }
    }
    const roleToUse = forceAdmin ? 'ADMIN' : newRole
    await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: newEmail, name: newName || undefined, role: roleToUse }),
    })
    setNewEmail('')
    setNewName('')
    await fetchData()
    if (onBootstrapComplete) onBootstrapComplete()
  }

  const completeOnboarding = async () => {
    const res = await fetch('/api/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: newEmail,
        name: newName,
        companyName: companyName || 'My Company',
        baseCurrency,
        defaultLanguage,
        // Server applies full standard CoA in the chosen language when accounts omitted
      }),
    })
    if (res.ok) {
      window.location.reload()
    }
  }

  const changeRole = async (id: string, role: User['role']) => {
    await fetch(`/api/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    })
    fetchData()
  }

  const deleteUser = async (id: string) => {
    if (!confirm('Delete this user?')) return
    await fetch(`/api/users/${id}`, { method: 'DELETE' })
    fetchData()
  }

  const updateSetting = async (key: string, value: unknown) => {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    })
    fetchData()
  }

  const baseCurrencySetting = ((settings.find(s => s.key === 'baseCurrency')?.value as { value?: string } | undefined)?.value) || 'EUR'
  const companyNameSetting = ((settings.find(s => s.key === 'company.name')?.value as { value?: string } | undefined)?.value) || ''
  const defaultJurisdiction = ((settings.find(s => s.key === 'defaultTaxJurisdiction')?.value as { value?: string } | undefined)?.value) || ''

  const addressSetting = settings.find(s => s.key === 'company.address')?.value as { country?: string; region?: string } | undefined
  const addrObj = addressSetting || {}
  const [addrCountry, setAddrCountry] = useState<string>(addrObj?.country || '')
  const [addrRegion, setAddrRegion] = useState<string>(addrObj?.region || '')

  if (loading) {
    return <div className="text-sm text-zinc-500">{t('loading')}</div>
  }

  // Bootstrap with advanced onboarding option
  if (isBootstrap) {
    return (
      <div className="mt-8 border border-amber-500/40 bg-zinc-950 rounded-lg p-6">
        <div className="text-amber-400 text-sm font-medium mb-1">{t('firstAdminTitle')}</div>
        <div className="text-xs text-zinc-400 mb-4">{t('firstAdminDesc')}</div>

        {!showOnboarding ? (
          <div className="flex flex-wrap gap-2">
            <input
              placeholder="admin@company.com"
              value={newEmail}
              onChange={e => setNewEmail(e.target.value)}
              className="bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm flex-1 min-w-[220px]"
            />
            <input
              placeholder="Name (optional)"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              className="bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm w-48"
            />
            <select
              value={defaultLanguage}
              onChange={e => setDefaultLanguage(e.target.value as 'en' | 'de')}
              className="bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm"
              title={t('defaultLanguage') || 'Default language'}
            >
              <option value="en">English</option>
              <option value="de">Deutsch</option>
            </select>
            <button
              onClick={() => void createUser(true)}
              className="px-4 py-2 rounded bg-amber-500 text-black font-medium text-sm hover:bg-amber-400"
            >
              {t('createFirstAdmin')}
            </button>
            <button
              onClick={() => setShowOnboarding(true)}
              className="px-4 py-2 rounded bg-zinc-700 text-white font-medium text-sm hover:bg-zinc-600"
            >
              {t('advancedOnboarding')}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="text-zinc-400 text-xs block mb-1">Your Email</label>
              <input
                placeholder="admin@company.com"
                value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
                className="bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm w-full"
              />
            </div>
            <div>
              <label className="text-zinc-400 text-xs block mb-1">Your Name</label>
              <input
                placeholder="Admin Name"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                className="bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm w-full"
              />
            </div>
            <div>
              <label className="text-zinc-400 text-xs block mb-1">Company Name</label>
              <input
                placeholder="My Company"
                value={companyName}
                onChange={e => setCompanyName(e.target.value)}
                className="bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm w-full"
              />
            </div>
            <div>
              <label className="text-zinc-400 text-xs block mb-1">Country</label>
              <select
                value={defaultCountry}
                onChange={e => setDefaultCountry(e.target.value)}
                className="bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm w-full"
              >
                <option value="">Select country…</option>
                {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-zinc-400 text-xs block mb-1">Base Currency</label>
              <select
                value={baseCurrency}
                onChange={e => setBaseCurrency(e.target.value)}
                className="bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm w-full"
              >
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="CAD">CAD</option>
                <option value="GBP">GBP</option>
                <option value="CHF">CHF</option>
              </select>
            </div>
            <div>
              <label className="text-zinc-400 text-xs block mb-1">{t('defaultLanguage') || 'Default language'}</label>
              <select
                value={defaultLanguage}
                onChange={e => setDefaultLanguage(e.target.value as 'en' | 'de')}
                className="bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm w-full"
              >
                <option value="en">English (default)</option>
                <option value="de">Deutsch</option>
              </select>
              <p className="text-[10px] text-zinc-500 mt-1">
                {t('defaultLanguageHelp') ||
                  'UI language and standard chart-of-accounts names for this installation.'}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={completeOnboarding}
                className="px-4 py-2 rounded bg-emerald-500 text-black font-medium text-sm hover:bg-emerald-400"
              >
                {t('completeOnboarding')}
              </button>
              <button
                onClick={() => setShowOnboarding(false)}
                className="px-4 py-2 rounded bg-zinc-700 text-white font-medium text-sm hover:bg-zinc-600"
              >
                {t('back')}
              </button>
            </div>
          </div>
        )}
        <div className="text-[10px] text-zinc-500 mt-3">{t('bootstrapNote')}</div>
      </div>
    )
  }

  return (
    <div className="mt-8">
      <div className="text-sm text-zinc-500 mb-4">{t('title') || 'Admin'}</div>

      <div className="mb-8">
        <div className="font-medium mb-2">Users</div>
        <div className="space-y-2 text-sm">
          {users.map(u => (
            <div key={u.id} className="flex items-center justify-between border border-zinc-800 rounded px-3 py-2">
              <div>
                {u.email} {u.name ? `(${u.name})` : ''} — <span className="text-zinc-400">{u.role}</span>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={u.role}
                  onChange={e => changeRole(u.id, e.target.value as User['role'])}
                  className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs"
                >
                  <option value="ADMIN">ADMIN</option>
                  <option value="ACCOUNTANT">ACCOUNTANT</option>
                  <option value="VIEWER">VIEWER</option>
                </select>
                <button onClick={() => deleteUser(u.id)} className="text-xs text-rose-400 hover:text-rose-300">Delete</button>
              </div>
            </div>
          ))}
          {users.length === 0 && <div className="text-zinc-500">No users yet.</div>}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <input
            placeholder="email"
            value={newEmail}
            onChange={e => setNewEmail(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-sm"
          />
          <input
            placeholder="name (optional)"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-sm"
          />
          <select
            value={newRole}
            onChange={e => setNewRole(e.target.value as 'ADMIN' | 'ACCOUNTANT' | 'VIEWER')}
            className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm"
          >
            <option value="ADMIN">ADMIN</option>
            <option value="ACCOUNTANT">ACCOUNTANT</option>
            <option value="VIEWER">VIEWER</option>
          </select>
          <button onClick={() => createUser(false)} className="px-3 py-1 rounded bg-white text-black text-sm">{t('createUser')}</button>
        </div>
      </div>

      <div>
        <div className="font-medium mb-2">{t('companySettingsHeader')}</div>
        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-3">
            <label className="w-48 text-zinc-400">Company Name</label>
            <input
              defaultValue={companyNameSetting}
              onBlur={e => updateSetting('company.name', { value: e.target.value })}
              className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1"
            />
          </div>

          <div className="flex items-center gap-3">
            <label className="w-48 text-zinc-400">Country</label>
            <select
              value={addrCountry}
              onChange={async (e) => {
                const c = e.target.value
                setAddrCountry(c)
                setAddrRegion('')
                const suggested = getSuggestedCurrency(c)
                await updateSetting('company.address', { country: c })
                await updateSetting('baseCurrency', suggested)
                await updateSetting('defaultTaxJurisdiction', c)
              }}
              className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1"
            >
              <option value="">Select country…</option>
              {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          </div>

          {getRegionsForCountry(addrCountry).length > 0 && (
            <div className="flex items-center gap-3">
              <label className="w-48 text-zinc-400">Province / State / Region</label>
              <select
                value={addrRegion}
                onChange={async (e) => {
                  const r = e.target.value
                  setAddrRegion(r)
                  await updateSetting('company.address', { country: addrCountry, region: r })
                  await updateSetting('defaultTaxJurisdiction', r)
                }}
                className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1"
              >
                <option value="">Select region…</option>
                {getRegionsForCountry(addrCountry).map(r => (
                  <option key={r.code} value={r.code}>{r.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-center gap-3">
            <label className="w-48 text-zinc-400">Base Currency</label>
            <select
              defaultValue={baseCurrencySetting}
              onChange={e => updateSetting('baseCurrency', { value: e.target.value })}
              className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1"
            >
              <option value="EUR">EUR</option>
              <option value="USD">USD</option>
              <option value="CAD">CAD</option>
              <option value="GBP">GBP</option>
              <option value="CHF">CHF</option>
              <option value="AUD">AUD</option>
            </select>
          </div>

          <div className="flex items-center gap-3">
            <label className="w-48 text-zinc-400">Default Tax Jurisdiction</label>
            <input
              defaultValue={defaultJurisdiction}
              onBlur={e => updateSetting('defaultTaxJurisdiction', { value: e.target.value })}
              className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1"
            />
          </div>
          <div className="text-[10px] text-zinc-500 -mt-1">Full ISO 3166-2 preferred when region is selected (e.g. CA-ON, US-CA).</div>
        </div>
        <div className="text-[10px] text-zinc-500 mt-2">Changes are saved immediately and audited.</div>
      </div>

      <div className="mt-8 pt-6 border-t border-zinc-800">
        <div className="font-medium mb-3">Two-Factor Authentication (2FA)</div>
        <TOTPSetup />
      </div>

      <div className="mt-10 border-t border-zinc-800 pt-6">
        <div className="font-medium mb-2">AI / LLM Provider</div>
        <div className="text-xs text-zinc-500 mb-4">
          LLM configuration is managed via environment variables in .env file.
          Visit the <a href="/admin/ai" className="text-emerald-400 hover:underline">/admin/ai</a> page for full configuration details.
        </div>
      </div>
    </div>
  )
}