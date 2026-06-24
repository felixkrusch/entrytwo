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
  value: any
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
    fetchData()
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

  const updateSetting = async (key: string, value: any) => {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    })
    fetchData()
  }

  const baseCurrencySetting = settings.find(s => s.key === 'baseCurrency')?.value?.value || 'EUR'
  const companyNameSetting = settings.find(s => s.key === 'company.name')?.value?.value || ''
  const defaultJurisdiction = settings.find(s => s.key === 'defaultTaxJurisdiction')?.value?.value || 'DE'

  if (loading) {
    return <div className="text-sm text-zinc-500">{t('loading') || 'Loading admin...'}</div>
  }

  // Bootstrap / First Admin mode - prominent card
  if (isBootstrap) {
    return (
      <div className="mt-8 border border-amber-500/40 bg-zinc-950 rounded-lg p-6">
        <div className="text-amber-400 text-sm font-medium mb-1">{t('firstAdminTitle') || 'Create First Admin'}</div>
        <div className="text-xs text-zinc-400 mb-4">{t('firstAdminDesc') || 'No administrator exists yet. Create the initial ADMIN user to unlock the application.'}</div>

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
            {t('createUser') || 'Create First Admin'}
          </button>
        </div>
        <div className="text-[10px] text-zinc-500 mt-3">This user will be created with ADMIN role. After creation, the full application will be available.</div>
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
                  onChange={e => changeRole(u.id, e.target.value as any)}
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
            onChange={e => setNewRole(e.target.value as any)}
            className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm"
          >
            <option value="ADMIN">ADMIN</option>
            <option value="ACCOUNTANT">ACCOUNTANT</option>
            <option value="VIEWER">VIEWER</option>
          </select>
          <button onClick={() => createUser(false)} className="px-3 py-1 rounded bg-white text-black text-sm">Create User</button>
        </div>
      </div>

      {/* Settings */}
      <div>
        <div className="font-medium mb-2">Company Settings</div>
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
    </div>
  )
}
