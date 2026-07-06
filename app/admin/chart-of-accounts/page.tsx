'use client'

import AccountsPanel from '../../app/AccountsPanel'

export default function ChartOfAccountsAdminPage() {
  return (
    <div className="p-6">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-semibold mb-2">Chart of Accounts</h1>
        <p className="text-sm text-zinc-400 mb-6">Manage all accounts. Changes affect the entire ledger.</p>
        <AccountsPanel />
      </div>
    </div>
  )
}
