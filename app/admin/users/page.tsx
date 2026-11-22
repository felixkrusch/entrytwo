'use client'

import { useTranslations } from 'next-intl'

import { useEffect, useState } from 'react'

interface User {
  id: string
  email: string
  name: string | null
  role: 'ADMIN' | 'ACCOUNTANT' | 'VIEWER'
  disabled?: boolean
  createdAt: string
}

interface Invitation {
  id: string
  email: string
  role: User['role']
  createdAt: string
  expiresAt: string
  acceptedAt: string | null
  delivery: { status: string; lastError: string | null } | null
}

interface CreatedInvitation {
  inviteLink?: string
  deliveryJobId?: string | null
  error?: string
}

export default function UsersPage() {
  const tForm = useTranslations('app.usersForm')

  const [users, setUsers] = useState<User[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loading, setLoading] = useState(true)
  const [usersLoadError, setUsersLoadError] = useState(false)
  const [invitesLoadError, setInvitesLoadError] = useState(false)
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [mutating, setMutating] = useState(false)

  const [newEmail, setNewEmail] = useState('')
  const [newRole, setNewRole] = useState<'ADMIN' | 'ACCOUNTANT' | 'VIEWER'>('ACCOUNTANT')

  const fetchData = async () => {
    const loadList = async (url: string) => {
      const response = await fetch(url, { cache: 'no-store' })
      if (!response.ok) throw new Error('List request failed')
      const rows = await response.json()
      if (!Array.isArray(rows)) throw new Error('Invalid list response')
      return rows
    }
    await Promise.all([
      loadList('/api/users').then(rows => { setUsers(rows); setUsersLoadError(false) }).catch(() => setUsersLoadError(true)),
      loadList('/api/users/invitations').then(rows => { setInvitations(rows); setInvitesLoadError(false) }).catch(() => setInvitesLoadError(true)),
    ])
    setLoading(false)
  }

  useEffect(() => {
    const id = setTimeout(() => { void fetchData() }, 0)
    return () => clearTimeout(id)
  }, [])

  const mutate = async (url: string, method: 'POST' | 'PATCH' | 'DELETE', body?: object) => {
    if (mutating) return null
    setMutating(true)
    setActionError('')
    setNotice('')
    try {
      const res = await fetch(url, {
        method,
        ...(body && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      })
      const data: CreatedInvitation = await res.json().catch(() => ({}))
      if (!res.ok) {
        setActionError(data.error || tForm('actionFailed'))
        return null
      }
      await fetchData()
      return data
    } catch {
      setActionError(tForm('actionFailed'))
      return null
    } finally {
      setMutating(false)
    }
  }

  const showDelivery = (data: CreatedInvitation) => {
    if (data.deliveryJobId) setNotice(tForm('inviteQueued'))
    else if (data.inviteLink) {
      setNotice(tForm('inviteManual'))
      window.prompt(tForm('copyInviteLink'), data.inviteLink)
    }
  }

  const createUser = async () => {
    const data = await mutate('/api/users', 'POST', { email: newEmail.trim(), role: newRole })
    if (!data) return
    setNewEmail('')
    showDelivery(data)
  }

  const deleteUser = async (id: string) => {
    if (confirm(tForm('confirmDelete'))) await mutate(`/api/users/${id}`, 'DELETE')
  }

  if (loading) {
    return <div className="text-sm text-zinc-500">{tForm('loading')}</div>
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">{tForm('title')}</h1>
        <p className="text-xs text-zinc-500">{tForm('subtitle')}</p>
      </div>
      {actionError && <p role="alert" className="mb-3 text-sm text-rose-400">{actionError}</p>}
      {notice && <p role="status" className="mb-3 text-sm text-emerald-400">{notice}</p>}

      <div className="space-y-2 text-sm max-w-3xl">
        {users.map(u => (
          <div key={u.id} className="flex items-center justify-between border border-zinc-800 rounded px-3 py-2">
            <div className={u.disabled ? 'line-through text-zinc-500' : ''}>
              {u.email} {u.name ? `(${u.name})` : ''} — <span className="text-zinc-400">{u.role}</span>
              {u.disabled && <span className="ml-2 text-[10px] text-red-400">{tForm('disabled')}</span>}
            </div>
            <fieldset disabled={mutating} className="flex items-center gap-2">
              <select
                value={u.role}
                aria-label={tForm('roleFor', { email: u.email })}
                onChange={e => void mutate(`/api/users/${u.id}`, 'PATCH', { role: e.target.value })}
                className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs"
              >
                <option value="ADMIN">ADMIN</option>
                <option value="ACCOUNTANT">ACCOUNTANT</option>
                <option value="VIEWER">VIEWER</option>
              </select>
              <button
                onClick={() => void mutate(`/api/users/${u.id}`, 'PATCH', { disabled: !u.disabled })}
                className="text-xs text-amber-400 hover:text-amber-300"
              >
                {u.disabled ? 'Enable' : 'Disable'}
              </button>
              <button onClick={() => deleteUser(u.id)} className="text-xs text-rose-400 hover:text-rose-300">{tForm('delete')}</button>
            </fieldset>
          </div>
        ))}
        {usersLoadError && <p role="alert" className="text-rose-400">{tForm('usersLoadFailed')} <button onClick={() => void fetchData()} className="underline">{tForm('retry')}</button></p>}
        {!usersLoadError && users.length === 0 && <div className="text-zinc-500">{tForm('empty')}</div>}
      </div>

      <div className="mt-6 max-w-xl">
        <div className="font-medium mb-2">{tForm('inviteUser')}</div>
        <form onSubmit={event => { event.preventDefault(); void createUser() }}>
        <fieldset disabled={mutating} className="flex flex-wrap gap-2">
          <input
            type="email"
            required
            aria-label={tForm('emailPh')}
            placeholder={tForm('emailPh')}
            value={newEmail}
            onChange={e => setNewEmail(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-sm"
          />
          <select
            aria-label={tForm('inviteRole')}
            value={newRole}
            onChange={e => setNewRole(e.target.value as 'ADMIN' | 'ACCOUNTANT' | 'VIEWER')}
            className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm"
          >
            <option value="ADMIN">ADMIN</option>
            <option value="ACCOUNTANT">ACCOUNTANT</option>
            <option value="VIEWER">VIEWER</option>
          </select>
          <button type="submit" className="px-3 py-1 rounded bg-white text-black text-sm">{tForm('invite')}</button>
        </fieldset>
        </form>
      </div>

      <div className="mt-8 max-w-3xl">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="font-medium">{tForm('invitations')}</div>
          <button type="button" onClick={() => void fetchData()} disabled={mutating} className="text-xs text-zinc-400 underline">{tForm('refreshDelivery')}</button>
        </div>
        <div className="space-y-2 text-sm">
          {invitations.map(invitation => {
            const expired = !invitation.acceptedAt && new Date(invitation.expiresAt) < new Date()
            const status = invitation.acceptedAt ? 'Accepted' : expired ? 'Expired' : 'Pending'
            return (
              <div key={invitation.id} className="rounded border border-zinc-800 px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <div><span className="font-medium">{invitation.email}</span> <span className="text-zinc-500">{invitation.role}</span></div>
                  <div className="flex items-center gap-3 text-xs text-zinc-400">
                    <span>{status}</span>
                    <span>{tForm('delivery', { status: invitation.delivery?.status || tForm('notQueued') })}</span>
                    <span>{tForm('expires', { date: new Date(invitation.expiresAt).toLocaleDateString() })}</span>
                  </div>
                </div>
                {invitation.delivery?.lastError && <div className="mt-1 text-xs text-red-400">{invitation.delivery.lastError}</div>}
                {!invitation.acceptedAt && <button
                  disabled={mutating}
                  onClick={async () => {
                    const data = await mutate(`/api/users/invitations/${invitation.id}/link`, 'POST')
                    if (data) showDelivery(data)
                  }}
                  className="mt-2 text-[10px] px-2 py-0.5 border border-zinc-700 rounded hover:bg-zinc-900"
                >
                  {tForm('resendInvite')}
                </button>}
              </div>
            )
          })}
          {invitesLoadError && <p role="alert" className="text-rose-400">{tForm('invitesLoadFailed')} <button onClick={() => void fetchData()} className="underline">{tForm('retry')}</button></p>}
          {!invitesLoadError && !invitations.length && <div className="text-zinc-500">{tForm('noInvitations')}</div>}
        </div>
      </div>
    </div>
  )
}
