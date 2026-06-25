'use client'

import { useEffect, useState } from 'react'

interface User {
  id: string
  email: string
  name: string | null
  role: 'ADMIN' | 'ACCOUNTANT' | 'VIEWER'
  createdAt: string
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)

  const [newEmail, setNewEmail] = useState('')
  const [newName, setNewName] = useState('')
  const [newRole, setNewRole] = useState<'ADMIN' | 'ACCOUNTANT' | 'VIEWER'>('ACCOUNTANT')

  const fetchData = async () => {
    try {
      const res = await fetch('/api/users')
      const u = await res.json()
      setUsers(Array.isArray(u) ? u : [])
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchData()
  }, [])

  const createUser = async () => {
    if (!newEmail) return
    await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: newEmail, name: newName || undefined, role: newRole }),
    })
    setNewEmail('')
    setNewName('')
    fetchData()
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

  if (loading) {
    return <div className="text-sm text-zinc-500">Loading users...</div>
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Users</h1>
        <p className="text-xs text-zinc-500">Manage access and roles. All changes are audited.</p>
      </div>

      <div className="space-y-2 text-sm max-w-3xl">
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

      <div className="mt-6 max-w-xl">
        <div className="font-medium mb-2">Add User</div>
        <div className="flex flex-wrap gap-2">
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
          <button onClick={createUser} className="px-3 py-1 rounded bg-white text-black text-sm">Create</button>
        </div>
      </div>
    </div>
  )
}
