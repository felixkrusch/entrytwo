'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

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

  const [newEmail, setNewEmail] = useState('')
  const [newName, setNewName] = useState('')
  const [newRole, setNewRole] = useState<'ADMIN' | 'ACCOUNTANT' | 'VIEWER'>('ACCOUNTANT')

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

  const updateSetting = async (key: string, value: { value: string }) => {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    })
    fetchData()
  }

  const baseCurrencySetting = ((settings.find(s => s.key === 'baseCurrency')?.value as { value?: string } | undefined)?.value) || 'EUR'
  const companyNameSetting = ((settings.find(s => s.key === 'company.name')?.value as { value?: string } | undefined)?.value) || ''
  const defaultJurisdiction = ((settings.find(s => s.key === 'defaultTaxJurisdiction')?.value as { value?: string } | undefined)?.value) || 'DE'

  if (loading) {
    return <div className="text-sm text-zinc-500">{t('loading')}</div>
  }

  // Bootstrap / First Admin mode - prominent card
  if (isBootstrap) {
    return (
      <div className="mt-8 border border-amber-500/40 bg-zinc-950 rounded-lg p-6">
        <div className="text-amber-400 text-sm font-medium mb-1">{t('firstAdminTitle')}</div>
        <div className="text-xs text-zinc-400 mb-4">{t('firstAdminDesc')}</div>

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
          <button
            onClick={() => createUser(true)}
            className="px-4 py-2 rounded bg-amber-500 text-black font-medium text-sm hover:bg-amber-400"
          >
            {t('createFirstAdmin')}
          </button>
        </div>
        <div className="text-[10px] text-zinc-500 mt-3">{t('bootstrapNote')}</div>
      </div>
    )
  }

  return (
    <div className="mt-8">
      <div className="text-sm text-zinc-500 mb-4">{t('title') || 'Admin'}</div>

      {/* Users */}
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

      {/* Settings */}
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
            <label className="w-48 text-zinc-400">Base Currency</label>
            <select
              defaultValue={baseCurrencySetting}
              onChange={e => updateSetting('baseCurrency', { value: e.target.value })}
              className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1"
            >
              <option value="EUR">EUR</option>
              <option value="USD">USD</option>
              <option value="GBP">GBP</option>
              <option value="CHF">CHF</option>
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
        </div>
        <div className="text-[10px] text-zinc-500 mt-2">Changes are saved immediately and audited.</div>
      </div>

      {/* LLM / AI Provider Settings */}
      <div className="mt-10 border-t border-zinc-800 pt-6">
        <div className="font-medium mb-2">AI / LLM Provider</div>
        <div className="text-xs text-zinc-500 mb-4">
          Connect OpenAI, xAI (Grok), Anthropic, OpenRouter, Kilo Gateway, or any OpenAI-compatible endpoint.
          Supports API keys and keys obtained via OAuth flows (paste the resulting key).
        </div>

        <LlmSettings settings={settings} onSaved={fetchData} />
      </div>
    </div>
  )
}

/* Separate component for LLM settings so we can manage local state cleanly */
function LlmSettings({ settings, onSaved }: { settings: Setting[]; onSaved: () => void }) {
  const providerKey = settings.find(s => s.key === 'llm.provider')?.value as { value?: string } | undefined
  const modelKey = settings.find(s => s.key === 'llm.model')?.value as { value?: string } | undefined
  const apiKeySetting = settings.find(s => s.key === 'llm.apiKey')?.value as { value?: string } | undefined
  const baseUrlSetting = settings.find(s => s.key === 'llm.baseURL')?.value as { value?: string } | undefined

  const [provider, setProvider] = useState<string>(providerKey?.value || 'openai')
  const [model, setModel] = useState<string>(modelKey?.value || 'gpt-4o-mini')
  const [apiKey, setApiKey] = useState<string>(apiKeySetting?.value || '')
  const [baseURL, setBaseURL] = useState<string>(baseUrlSetting?.value || '')

  const providers = [
    { value: 'openai', label: 'OpenAI (direct)' },
    { value: 'xai', label: 'xAI (Grok)' },
    { value: 'anthropic', label: 'Anthropic (Claude)' },
    { value: 'openrouter', label: 'OpenRouter (gateway)' },
    { value: 'kilo', label: 'Kilo Gateway' },
    { value: 'openai-compatible', label: 'OpenAI Compatible (custom)' },
  ]

  const getHelpLinks = (p: string) => {
    if (p === 'openai') return 'https://platform.openai.com/api-keys'
    if (p === 'xai') return 'https://console.x.ai/'
    if (p === 'anthropic') return 'https://console.anthropic.com/'
    if (p === 'openrouter') return 'https://openrouter.ai/keys'
    if (p === 'kilo') return 'https://app.kilo.ai/'
    return null
  }

  const save = async (key: string, val: string) => {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value: { value: val } }),
    })
    onSaved()
  }

  const handleProviderChange = async (val: string) => {
    setProvider(val)
    await save('llm.provider', val)

    // sensible defaults when switching
    if (val === 'xai' && !model.includes('grok')) setModel('grok-3')
    if (val === 'anthropic' && !model.includes('claude')) setModel('claude-3-5-sonnet-20241022')
    if (val === 'openrouter' && !model.includes('/')) setModel('anthropic/claude-sonnet-4-20250514')
    if (val === 'kilo') setModel('anthropic/claude-sonnet-4.5')
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-3">
        <label className="w-48 text-zinc-400">Provider</label>
        <select
          value={provider}
          onChange={e => handleProviderChange(e.target.value)}
          className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1"
        >
          {providers.map(p => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
        {getHelpLinks(provider) && (
          <a href={getHelpLinks(provider)!} target="_blank" className="text-emerald-400 text-xs hover:underline">
            Get key / Connect →
          </a>
        )}
      </div>

      <div className="flex items-center gap-3">
        <label className="w-48 text-zinc-400">Model</label>
        <input
          value={model}
          onChange={e => setModel(e.target.value)}
          onBlur={() => save('llm.model', model)}
          placeholder="gpt-4o-mini or grok-3 or anthropic/claude-..."
          className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1"
        />
      </div>

      <div className="flex items-center gap-3">
        <label className="w-48 text-zinc-400">API Key</label>
        <input
          type="password"
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          onBlur={() => save('llm.apiKey', apiKey)}
          placeholder="sk-... or your gateway key (OAuth keys go here too)"
          className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 font-mono text-xs"
        />
      </div>

      <div className="flex items-center gap-3">
        <label className="w-48 text-zinc-400">Base URL (optional)</label>
        <input
          value={baseURL}
          onChange={e => setBaseURL(e.target.value)}
          onBlur={() => save('llm.baseURL', baseURL)}
          placeholder="https://api.kilo.ai/api/gateway   or https://openrouter.ai/api/v1"
          className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 font-mono text-xs"
        />
      </div>

      <div className="text-[10px] text-zinc-500">
        API keys are stored in your database (self-hosted). For OAuth flows (xAI SuperGrok, Kilo sign-in, etc.) complete the OAuth in the provider’s site and paste the resulting key/token here.
        Kilo Gateway and OpenRouter let you access hundreds of models (including Grok, Claude, GPT, etc.) with one key.
      </div>
    </div>
  )
}
