'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { Check, ChevronRight, FileImage, Loader2, Paperclip, Plus, ReceiptText, Send, ShieldCheck, Trash2, X } from 'lucide-react'
import toast from 'react-hot-toast'

type Option = { id: string; code?: string; name: string | null; email?: string; role?: string; type?: string }
type ClaimReceipt = { id: string; fileAssetId: string; duplicateStatus: string; fileAsset: { originalName: string; mimeType: string; size: number } }
type ClaimLine = {
  id?: string
  expenseDate: string
  merchant: string
  description: string
  accountId: string
  grossAmount: number
  netAmount?: number | null
  taxAmount?: number | null
  currency: string
  fxRateToBase?: number | null
  fxSource?: string | null
  taxRateId?: string | null
  paymentMethod: 'PERSONAL_FUNDS' | 'COMPANY_CARD' | 'CASH_ADVANCE' | 'OTHER'
  receipts?: Array<{ claimReceiptId: string }>
  receiptIds?: string[]
  account?: Option
}
type Claim = {
  id: string
  claimNumber: string
  claimantUserId: string
  claimant: Option
  title: string
  purpose?: string | null
  workflowStatus: 'DRAFT' | 'SUBMITTED' | 'CHANGES_REQUESTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
  postingStatus: 'UNPOSTED' | 'POSTED' | 'REVERSED'
  reimbursementStatus: string
  revision: number
  approvedRevision?: number | null
  baseCurrency: string
  totalBaseAmount: string | number
  reimbursementAccountId?: string | null
  lines: ClaimLine[]
  receipts: ClaimReceipt[]
  activities: Array<{ id: string; action: string; comment?: string | null; createdAt: string; actor: Option }>
  postedJournalEntry?: { id: string; entryNumber?: string | null } | null
  updatedAt: string
}

const statuses = ['ALL', 'DRAFT', 'SUBMITTED', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED'] as const
const statusStyle: Record<string, string> = {
  DRAFT: 'border-zinc-700 bg-zinc-800 text-zinc-300',
  SUBMITTED: 'border-sky-800 bg-sky-950/50 text-sky-300',
  CHANGES_REQUESTED: 'border-amber-800 bg-amber-950/50 text-amber-300',
  APPROVED: 'border-emerald-800 bg-emerald-950/50 text-emerald-300',
  REJECTED: 'border-rose-800 bg-rose-950/50 text-rose-300',
}

function formatMoney(value: number | string, currency: string) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(value) || 0)
}

function toDateInput(value: string) {
  return new Date(value).toISOString().slice(0, 10)
}

export default function ClaimsPanel() {
  const t = useTranslations('app.views.claims')
  const [claims, setClaims] = useState<Claim[]>([])
  const [users, setUsers] = useState<Option[]>([])
  const [accounts, setAccounts] = useState<Option[]>([])
  const [actor, setActor] = useState<{ id: string; role: string } | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<(typeof statuses)[number]>('ALL')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [reviewComment, setReviewComment] = useState('')

  const load = async (keepSelection = true) => {
    setLoading(true)
    try {
      const response = await fetch('/api/expense-claims')
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not load claims')
      setClaims(data.claims || [])
      setUsers(data.users || [])
      setAccounts(data.accounts || [])
      setActor(data.actor)
      if (!keepSelection || !selectedId || !(data.claims || []).some((claim: Claim) => claim.id === selectedId)) setSelectedId(data.claims?.[0]?.id || null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load claims')
    } finally {
      setLoading(false)
    }
  }

  const loadInitial = useEffectEvent(() => { void load(false) })
  useEffect(() => { loadInitial() }, [])

  const selected = claims.find(claim => claim.id === selectedId) || null
  const filtered = claims.filter(claim => filter === 'ALL' || claim.workflowStatus === filter)

  const createClaim = async () => {
    if (!actor) return
    setSaving(true)
    try {
      const response = await fetch('/api/expense-claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claimantUserId: actor.id, title: t('newClaim'), lines: [] }),
      })
      const claim = await response.json()
      if (!response.ok) throw new Error(claim.error || 'Could not create claim')
      await load()
      setSelectedId(claim.id)
      toast.success(`${claim.claimNumber} created`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create claim')
    } finally {
      setSaving(false)
    }
  }

  const replaceClaim = (next: Claim) => setClaims(current => current.map(claim => claim.id === next.id ? next : claim))

  const runAction = async (action: string) => {
    if (!selected) return
    setSaving(true)
    try {
      const response = await fetch(`/api/expense-claims/${selected.id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, comment: reviewComment }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Claim action failed')
      replaceClaim(data)
      setReviewComment('')
      toast.success(action === 'post' ? 'Claim posted to the ledger' : `Claim ${action.replace('-', ' ')}`)
      window.dispatchEvent(new CustomEvent('journal-updated'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Claim action failed')
    } finally {
      setSaving(false)
    }
  }

  if (loading && !claims.length) return <div className="flex min-h-80 items-center justify-center text-zinc-500"><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t('loading')}</div>

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('title')}</h1>
          <p className="mt-1 text-xs text-zinc-500">{t('subtitle')}</p>
        </div>
        <button onClick={createClaim} disabled={saving} className="inline-flex items-center gap-1 text-xs px-3 py-1 rounded bg-emerald-500 text-black font-medium hover:bg-emerald-400 disabled:opacity-50">
          <Plus className="h-3 w-3" />{t('newClaim')}
        </button>
      </div>

      <div className="mb-4 flex items-center gap-2 overflow-x-auto text-xs">
        {statuses.map(status => (
          <button key={status} onClick={() => { setFilter(status); setSelectedId(null) }} className={`whitespace-nowrap rounded px-3 py-1 ${filter === status ? 'bg-zinc-700 text-zinc-100' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'}`}>
            {status === 'ALL' ? t('statusAll') : status === 'DRAFT' ? t('statusDraft') : status === 'SUBMITTED' ? t('statusSubmitted') : status === 'CHANGES_REQUESTED' ? t('statusChangesRequested') : status === 'APPROVED' ? t('statusApproved') : status === 'REJECTED' ? t('statusRejected') : String(status).replaceAll('_', ' ').toLowerCase()}
            {status !== 'ALL' && <span className="ml-1 text-zinc-600">{claims.filter(claim => claim.workflowStatus === status).length}</span>}
          </button>
        ))}
      </div>

      {selected ? (
        <ClaimEditor
          key={`${selected.id}-${selected.revision}-${selected.updatedAt}`}
          claim={selected}
          users={users}
          accounts={accounts}
          actor={actor}
          saving={saving}
          setSaving={setSaving}
          onChange={replaceClaim}
          onBack={() => setSelectedId(null)}
          onAction={runAction}
          reviewComment={reviewComment}
          setReviewComment={setReviewComment}
        />
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 p-8 text-center text-sm text-zinc-500">{t('empty')}</div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-950 text-xs text-zinc-400">
              <tr><th className="px-3 py-2 text-left font-normal">Claim</th><th className="hidden px-3 py-2 text-left font-normal sm:table-cell">{t('claimant')}</th><th className="px-3 py-2 text-left font-normal">{t('status')}</th><th className="hidden px-3 py-2 text-right font-normal md:table-cell">{t('receipts')}</th><th className="px-3 py-2 text-right font-normal">{t('total')}</th><th className="w-8" /></tr>
            </thead>
            <tbody>
              {filtered.map(claim => (
                <tr key={claim.id} onClick={() => setSelectedId(claim.id)} className="cursor-pointer border-t border-zinc-800 hover:bg-zinc-900/50">
                  <td className="px-3 py-2"><div className="font-medium text-zinc-200">{claim.title}</div><div className="font-mono text-[10px] text-zinc-500">{claim.claimNumber}</div></td>
                  <td className="hidden px-3 py-2 text-xs text-zinc-400 sm:table-cell">{claim.claimant.name || claim.claimant.email}</td>
                  <td className="px-3 py-2"><span className={`rounded border px-1.5 py-0.5 text-[10px] ${statusStyle[claim.workflowStatus]}`}>{claim.workflowStatus.replaceAll('_', ' ')}</span></td>
                  <td className="hidden px-3 py-2 text-right text-xs text-zinc-500 md:table-cell">{claim.receipts.length}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-zinc-300">{formatMoney(claim.totalBaseAmount, claim.baseCurrency)}</td>
                  <td className="pr-2 text-zinc-600"><ChevronRight className="h-4 w-4" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ClaimEditor(props: {
  claim: Claim
  users: Option[]
  accounts: Option[]
  actor: { id: string; role: string } | null
  saving: boolean
  setSaving: (value: boolean) => void
  onChange: (claim: Claim) => void
  onBack: () => void
  onAction: (action: string) => void
  reviewComment: string
  setReviewComment: (value: string) => void
}) {
  const t = useTranslations('app.views.claims')
  const { claim, users, accounts, actor } = props
  const expenseAccounts = accounts.filter(account => account.type === 'EXPENSE')
  const liabilityAccounts = accounts.filter(account => account.type === 'LIABILITY')
  const [title, setTitle] = useState(claim.title)
  const [purpose, setPurpose] = useState(claim.purpose || '')
  const [claimantUserId, setClaimantUserId] = useState(claim.claimantUserId)
  const [reimbursementAccountId, setReimbursementAccountId] = useState(claim.reimbursementAccountId || '')
  const [lines, setLines] = useState<ClaimLine[]>(claim.lines.map(line => ({ ...line, expenseDate: toDateInput(line.expenseDate), receiptIds: line.receipts?.map(item => item.claimReceiptId) || [] })))
  const fileRef = useRef<HTMLInputElement>(null)
  const editable = claim.workflowStatus !== 'APPROVED' && claim.postingStatus === 'UNPOSTED'
  const canApprove = actor?.role === 'ADMIN' || (actor?.role === 'ACCOUNTANT' && actor.id !== claim.claimantUserId)

  const addLine = () => {
    if (!expenseAccounts[0]) return toast.error('Create an expense account first')
    setLines(current => [...current, {
      expenseDate: new Date().toISOString().slice(0, 10), merchant: '', description: '', accountId: expenseAccounts[0].id,
      grossAmount: 0, currency: claim.baseCurrency, fxRateToBase: 1, fxSource: 'BASE_CURRENCY', paymentMethod: 'PERSONAL_FUNDS', receiptIds: [],
    }])
  }

  const updateLine = (index: number, patch: Partial<ClaimLine>) => setLines(current => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line))

  const save = async () => {
    props.setSaving(true)
    try {
      const response = await fetch(`/api/expense-claims/${claim.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: claim.revision, claimantUserId, title, purpose, reimbursementAccountId: reimbursementAccountId || null, lines }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not save claim')
      props.onChange(data)
      toast.success('Draft saved')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save claim')
    } finally { props.setSaving(false) }
  }

  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files.length) return
    props.setSaving(true)
    try {
      const form = new FormData()
      files.forEach(file => form.append('file', file))
      const response = await fetch(`/api/expense-claims/${claim.id}/receipts`, { method: 'POST', body: form })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Receipt upload failed')
      const refreshed = await fetch(`/api/expense-claims/${claim.id}`).then(result => result.json())
      props.onChange(refreshed)
      toast.success(`${data.saved.length} receipt${data.saved.length === 1 ? '' : 's'} added`)
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Receipt upload failed') }
    finally { props.setSaving(false) }
  }

  const removeReceipt = async (receiptId: string) => {
    const response = await fetch(`/api/expense-claims/${claim.id}/receipts/${receiptId}`, { method: 'DELETE' })
    const data = await response.json()
    if (!response.ok) return toast.error(data.error || 'Could not remove receipt')
    const refreshed = await fetch(`/api/expense-claims/${claim.id}`).then(result => result.json())
    props.onChange(refreshed)
  }

  return (
    <div>
      <button onClick={props.onBack} className="mb-3 text-xs text-zinc-400 hover:text-zinc-200">{t('backToClaims')}</button>
      <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
        <div>
          <div className="flex items-center gap-2"><span className="font-mono text-xs text-zinc-500">{claim.claimNumber}</span><span className={`rounded border px-2 py-0.5 text-[10px] ${statusStyle[claim.workflowStatus]}`}>{claim.workflowStatus.replaceAll('_', ' ')}</span>{claim.postingStatus === 'POSTED' && <span className="rounded border border-violet-800 bg-violet-950/40 px-2 py-0.5 text-[10px] text-violet-300">{t('posted')}</span>}</div>
          <div className="mt-1 text-[10px] text-zinc-500">Revision {claim.revision}{claim.approvedRevision ? ` · approved revision ${claim.approvedRevision}` : ''}</div>
        </div>
        <div className="text-right"><div className="text-lg font-semibold tabular-nums text-zinc-100">{formatMoney(lines.reduce((sum, line) => sum + Math.round((Number(line.grossAmount) || 0) * (Number(line.fxRateToBase) || 1) * 100) / 100, 0), claim.baseCurrency)}</div><div className="text-[10px] text-zinc-500">{t('claimTotal')}</div></div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
        <div className="min-w-0 space-y-4">
          <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-zinc-400 sm:col-span-2">{t('titleField')}<input value={title} disabled={!editable} onChange={event => setTitle(event.target.value)} className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 disabled:opacity-60" /></label>
              <label className="text-xs text-zinc-400">{t('claimant')}<select value={claimantUserId} disabled={!editable || actor?.role === 'VIEWER'} onChange={event => setClaimantUserId(event.target.value)} className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm"><option value="">{t('selectClaimant')}</option>{users.map(user => <option key={user.id} value={user.id}>{user.name || user.email}</option>)}</select></label>
              <label className="text-xs text-zinc-400">{t('reimbursementPayable')}<select value={reimbursementAccountId} disabled={!editable} onChange={event => setReimbursementAccountId(event.target.value)} className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm"><option value="">{t('selectLiability')}</option>{liabilityAccounts.map(account => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select></label>
              <label className="text-xs text-zinc-400 sm:col-span-2">{t('businessPurpose')}<textarea value={purpose} disabled={!editable} onChange={event => setPurpose(event.target.value)} rows={2} className="mt-1 w-full resize-none rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm disabled:opacity-60" /></label>
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold text-zinc-200">{t('expenseLines')}</h2>{editable && <button onClick={addLine} className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300"><Plus className="h-3.5 w-3.5" />{t('addLine')}</button>}</div>
            <div className="space-y-3">
              {lines.length === 0 && <button onClick={addLine} disabled={!editable} className="w-full rounded-lg border border-dashed border-zinc-700 p-5 text-xs text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300">{t('addFirstLine')}</button>}
              {lines.map((line, index) => (
                <div key={line.id || index} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                  <div className="mb-2 flex items-center justify-between"><span className="text-[10px] font-medium text-zinc-500">LINE {index + 1}</span>{editable && <button onClick={() => setLines(current => current.filter((_, i) => i !== index))} className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-rose-400"><Trash2 className="h-3.5 w-3.5" /></button>}</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input type="date" value={line.expenseDate} disabled={!editable} onChange={event => updateLine(index, { expenseDate: event.target.value })} className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs" />
                    <input placeholder={t('merchant')} value={line.merchant || ''} disabled={!editable} onChange={event => updateLine(index, { merchant: event.target.value })} className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs" />
                    <input placeholder={t('description')} value={line.description} disabled={!editable} onChange={event => updateLine(index, { description: event.target.value })} className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs sm:col-span-2" />
                    <select value={line.accountId} disabled={!editable} onChange={event => updateLine(index, { accountId: event.target.value })} className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs"><option value="">{t('expenseAccount')}</option>{expenseAccounts.map(account => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select>
                    <div className="grid grid-cols-[1fr_58px_1fr] gap-2"><input type="number" min="0" step="0.01" value={line.grossAmount} disabled={!editable} onChange={event => updateLine(index, { grossAmount: Number(event.target.value) })} className="min-w-0 rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs" /><input maxLength={3} value={line.currency} disabled={!editable} onChange={event => updateLine(index, { currency: event.target.value.toUpperCase() })} className="min-w-0 rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs uppercase" /><input type="number" step="0.000001" value={line.fxRateToBase ?? 1} disabled={!editable || line.currency === claim.baseCurrency} onChange={event => updateLine(index, { fxRateToBase: Number(event.target.value) })} className="min-w-0 rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs" title="FX rate to base" /></div>
                  </div>
                  {claim.receipts.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{claim.receipts.map(receipt => { const linked = line.receiptIds?.includes(receipt.id); return <button type="button" key={receipt.id} disabled={!editable} onClick={() => updateLine(index, { receiptIds: linked ? line.receiptIds?.filter(id => id !== receipt.id) : [...(line.receiptIds || []), receipt.id] })} className={`rounded-md border px-2 py-1 text-[10px] ${linked ? 'border-emerald-700 bg-emerald-950/40 text-emerald-300' : 'border-zinc-700 text-zinc-500'}`}>{linked && <Check className="mr-1 inline h-3 w-3" />}{receipt.fileAsset.originalName}</button> })}</div>}
                </div>
              ))}
            </div>
          </section>

          {editable && <button onClick={save} disabled={props.saving} className="inline-flex items-center gap-1.5 rounded bg-white px-3 py-1.5 text-sm font-medium text-black hover:bg-zinc-200 disabled:opacity-50">{props.saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Save draft</button>}
        </div>

        <aside className="space-y-3">
          <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
            <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-medium">{t('receipts')}</h2>{editable && <button onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-800"><Paperclip className="h-3 w-3" />{t('add')}</button>}</div>
            <input ref={fileRef} type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" onChange={upload} className="hidden" />
            <div className="space-y-2">
              {claim.receipts.map(receipt => <div key={receipt.id} className="group flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5"><a href={`/api/files/${receipt.fileAssetId}`} target="_blank" className="flex min-w-0 flex-1 items-center gap-1.5"><FileImage className="h-3.5 w-3.5 shrink-0 text-zinc-500" /><span className="truncate text-[10px] text-zinc-300">{receipt.fileAsset.originalName}</span></a>{receipt.duplicateStatus !== 'CLEAR' && <span title="Possible duplicate" className="h-1.5 w-1.5 rounded-full bg-amber-400" />}{editable && <button onClick={() => removeReceipt(receipt.id)} className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-rose-400"><X className="h-3 w-3" /></button>}</div>)}
              {!claim.receipts.length && <button disabled={!editable} onClick={() => fileRef.current?.click()} className="w-full rounded border border-dashed border-zinc-700 p-4 text-[10px] text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300">{t('selectReceipts')}</button>}
            </div>
          </section>

          <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
            <h2 className="mb-2 text-sm font-medium">{t('workflow')}</h2>
            {claim.workflowStatus === 'DRAFT' || claim.workflowStatus === 'CHANGES_REQUESTED' || claim.workflowStatus === 'REJECTED' ? <button onClick={() => props.onAction('submit')} disabled={props.saving} className="inline-flex w-full items-center justify-center gap-1.5 rounded bg-sky-700 px-3 py-1.5 text-xs font-medium text-sky-100 hover:bg-sky-600"><Send className="h-3.5 w-3.5" />{t('submit')}</button> : null}
            {claim.workflowStatus === 'SUBMITTED' && canApprove && <div className="space-y-2"><textarea value={props.reviewComment} onChange={event => props.setReviewComment(event.target.value)} placeholder={t('reviewNote')} rows={3} className="w-full resize-none rounded border border-zinc-700 bg-zinc-900 p-2 text-xs" /><button onClick={() => props.onAction('approve')} className="inline-flex w-full items-center justify-center gap-1.5 rounded bg-emerald-700 px-3 py-1.5 text-xs font-medium text-emerald-100 hover:bg-emerald-600"><ShieldCheck className="h-3.5 w-3.5" />Approve revision {claim.revision}</button><div className="grid grid-cols-2 gap-2"><button onClick={() => props.onAction('request-changes')} className="rounded border border-amber-800 px-2 py-1 text-[10px] text-amber-300 hover:bg-amber-950">{t('requestChanges')}</button><button onClick={() => props.onAction('reject')} className="rounded border border-rose-900 px-2 py-1 text-[10px] text-rose-300 hover:bg-rose-950">{t('reject')}</button></div>{actor?.role === 'ADMIN' && actor.id === claim.claimantUserId && <p className="text-[10px] text-zinc-600">{t('adminSelfApprove')}</p>}</div>}
            {claim.workflowStatus === 'SUBMITTED' && !canApprove && <p className="text-xs text-zinc-500">{t('waitingApprover')}</p>}
            {claim.workflowStatus === 'APPROVED' && claim.postingStatus === 'UNPOSTED' && (actor?.role === 'ADMIN' || actor?.role === 'ACCOUNTANT') && <button onClick={() => props.onAction('post')} className="inline-flex w-full items-center justify-center gap-1.5 rounded bg-violet-800 px-3 py-1.5 text-xs font-medium text-violet-100 hover:bg-violet-700"><ReceiptText className="h-3.5 w-3.5" />{t('postToLedger')}</button>}
            {claim.postingStatus === 'POSTED' && <div className="rounded-lg border border-emerald-900 bg-emerald-950/20 p-3 text-xs text-emerald-300"><Check className="mr-2 inline h-4 w-4" />Posted as {claim.postedJournalEntry?.entryNumber || 'journal entry'}</div>}
          </section>

          <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-3"><h2 className="mb-2 text-sm font-medium">{t('activity')}</h2><div className="space-y-2">{claim.activities.slice(0, 10).map(activity => <div key={activity.id} className="border-l border-zinc-700 pl-2"><div className="text-[10px] text-zinc-300">{activity.action.replaceAll('_', ' ').toLowerCase()}</div><div className="text-[9px] text-zinc-600">{activity.actor.name || activity.actor.email} · {new Date(activity.createdAt).toLocaleString()}</div>{activity.comment && <div className="mt-0.5 text-[10px] text-zinc-500">{activity.comment}</div>}</div>)}</div></section>
        </aside>
      </div>
    </div>
  )
}
