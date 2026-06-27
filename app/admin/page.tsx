'use client'

import Link from 'next/link'

export default function AdminOverview() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Manage your company, users, and AI configuration.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link
          href="/admin/company"
          className="block border border-zinc-800 rounded-lg p-5 hover:border-zinc-700 transition-colors bg-zinc-950"
        >
          <div className="font-medium mb-1">Company Settings</div>
          <div className="text-xs text-zinc-500">Name, base currency, default tax jurisdiction.</div>
        </Link>

        <Link
          href="/admin/users"
          className="block border border-zinc-800 rounded-lg p-5 hover:border-zinc-700 transition-colors bg-zinc-950"
        >
          <div className="font-medium mb-1">Users</div>
          <div className="text-xs text-zinc-500">Invite users, change roles, remove access.</div>
        </Link>

        <Link
          href="/admin/ai"
          className="block border border-zinc-800 rounded-lg p-5 hover:border-zinc-700 transition-colors bg-zinc-950"
        >
          <div className="font-medium mb-1">AI / LLM Provider</div>
          <div className="text-xs text-zinc-500">Choose model provider, API keys, base URLs.</div>
        </Link>

        <Link
          href="/admin/reports"
          className="block border border-zinc-800 rounded-lg p-5 hover:border-zinc-700 transition-colors bg-zinc-950"
        >
          <div className="font-medium mb-1">Reports</div>
          <div className="text-xs text-zinc-500">Balance Sheet and Profit & Loss statements.</div>
        </Link>

        <Link
          href="/admin/bank-feeds"
          className="block border border-zinc-800 rounded-lg p-5 hover:border-zinc-700 transition-colors bg-zinc-950"
        >
          <div className="font-medium mb-1">Bank Feeds</div>
          <div className="text-xs text-zinc-500">Connect Stripe, PayPal, and bank accounts.</div>
        </Link>

        <Link
          href="/admin/backup"
          className="block border border-zinc-800 rounded-lg p-5 hover:border-zinc-700 transition-colors bg-zinc-950"
        >
          <div className="font-medium mb-1">Backup & Export</div>
          <div className="text-xs text-zinc-500">Export/import all data as JSON.</div>
        </Link>
      </div>

      <div className="mt-10 text-xs text-zinc-500">
        Tip: Click the <span className="font-mono">entrytwo</span> logo in the top bar to return to the main dashboard.
      </div>
    </div>
  )
}