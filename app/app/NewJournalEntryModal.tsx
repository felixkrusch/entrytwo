'use client'

import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { useNewEntry, NewEntrySuggestion } from './NewEntryContext'
import { useTranslations, useFormatter } from 'next-intl'
import { verifySuggestion } from '@/lib/verifySuggestion'

interface Account {
  id: string
  code: string
  name: string
  type: string
}

interface TaxRate {
  id: string
  jurisdiction: string
  name: string
  rate: number
  taxType: string
  isInputTax: boolean
}

interface NewJournalEntryModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  initialSuggestion?: NewEntrySuggestion | null
}

export default function NewJournalEntryModal({ isOpen, onClose, onSuccess, initialSuggestion }: NewJournalEntryModalProps) {
  const t = useTranslations('app.modal')
  const format = useFormatter()

  const [accounts, setAccounts] = useState<Account[]>([])
  const [taxRates, setTaxRates] = useState<TaxRate[]>([])
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [description, setDescription] = useState('')
  const [lines, setLines] = useState<Array<{
    accountId: string
    debit: number
    credit: number
    description: string
    taxRateId: string
    currency: string
    fxRateToBase?: number
    fxSource?: string
    fxDate?: string
  }>>([
    { accountId: '', debit: 0, credit: 0, description: '', taxRateId: '', currency: 'EUR' },
    { accountId: '', debit: 0, credit: 0, description: '', taxRateId: '', currency: 'EUR' }
  ])

  const CURRENCIES = ['EUR', 'USD', 'GBP']
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [userConfirmed, setUserConfirmed] = useState(false)
  const [verificationWarnings, setVerificationWarnings] = useState<string[]>([])

  const isReversal = !!initialSuggestion?.reversingOriginalId
  const requiresConfirmation = !!initialSuggestion?.needsConfirmation

  // Reset confirmation requirement whenever the suggestion changes
  useEffect(() => {
    setUserConfirmed(!requiresConfirmation)
  }, [initialSuggestion, requiresConfirmation])

  // Phase 2 memory: when chat provides a suggested account code from memory, auto-select it for the first line
  useEffect(() => {
    if (!isOpen || !initialSuggestion?.memory?.suggestedAccountCode || accounts.length === 0) return
    const code = initialSuggestion.memory.suggestedAccountCode
    setLines(prev => {
      if (!prev.length) return prev
      const first = prev[0]
      if (first.accountId) return prev // already filled
      const match = accounts.find(a => a.code === code)
      if (!match) return prev
      const copy = [...prev]
      copy[0] = { ...first, accountId: match.id }
      return copy
    })
  }, [isOpen, initialSuggestion, accounts])

  // Fetch accounts + tax rates when modal opens (i18n + tax foundation from day one)
  useEffect(() => {
    if (isOpen) {
      Promise.all([
        fetch('/api/accounts').then(r => r.json()),
        fetch('/api/tax-rates').then(r => r.json())
      ]).then(([accData, taxData]) => {
        if (Array.isArray(accData)) setAccounts(accData)
        if (Array.isArray(taxData)) setTaxRates(taxData)
      }).catch(() => {})
    }
  }, [isOpen])

  // Prefill from chat suggestion when suggestion changes (robust to async accounts)
  useEffect(() => {
    const applySuggestion = (accList: Account[], taxList: TaxRate[]) => {
      if (!initialSuggestion) return
      if (initialSuggestion.description) {
        setDescription(initialSuggestion.description)
      }
      if (initialSuggestion.lines && initialSuggestion.lines.length > 0) {
          const mapped = initialSuggestion.lines.map(l => {
            const match = accList.find(a => a.code === l.accountCode)
            return {
              accountId: match?.id || '',
              debit: l.debit || 0,
              credit: l.credit || 0,
              description: l.description || '',
              taxRateId: l.taxRateId || '',
              currency: l.currency || 'EUR',
              // carry FX metadata through when PDF+feed provided it
              fxRateToBase: l.fxRateToBase,
              fxSource: l.fxSource,
              fxDate: l.fxDate,
            }
          })

        // If a line has a taxRateId (e.g. from PDF detection), auto-insert a tax line for clarity.
        // Only do this if we don't already see a separate tax line in the suggestion (PDF API may have split gross).
        const looksLikeAlreadySplit = mapped.some((m, i) =>
          i > 0 && m.taxRateId && (m.description || '').toLowerCase().includes('tax')
        )
        const hasTaxOnMain = mapped.some(m => m.taxRateId && m.debit > 0)
        if (hasTaxOnMain && taxList.length > 0 && !looksLikeAlreadySplit) {
          const newLines: typeof mapped = []
          mapped.forEach(line => {
            newLines.push(line)
            if (line.taxRateId && line.debit > 0) {
              const tr = taxList.find(t => t.id === line.taxRateId)
              if (tr) {
                const taxAmt = Math.round(line.debit * Number(tr.rate) * 100) / 100
                if (taxAmt > 0) {
                  newLines.push({
                    accountId: line.accountId,
                    debit: taxAmt,
                    credit: 0,
                    description: `Tax (${(Number(tr.rate) * 100).toFixed(0)}% ${tr.isInputTax ? 'input' : ''})`,
                    taxRateId: tr.id,
                    currency: line.currency || 'EUR',
                    // copy fx metadata from the main line if present
                    fxRateToBase: (line as any).fxRateToBase,
                    fxSource: (line as any).fxSource,
                    fxDate: (line as any).fxDate,
                  })
                }
              }
            }
          })
          // ensure at least 2 lines total for the form
          while (newLines.length < 2) {
            newLines.push({
              accountId: '',
              debit: 0,
              credit: 0,
              description: '',
              taxRateId: '',
              currency: 'EUR',
              fxRateToBase: undefined,
              fxSource: undefined,
              fxDate: undefined,
            })
          }
          setLines(newLines)
          return
        }

        while (mapped.length < 2) {
          mapped.push({
            accountId: '',
            debit: 0,
            credit: 0,
            description: '',
            taxRateId: '',
            currency: 'EUR',
            fxRateToBase: undefined,
            fxSource: undefined,
            fxDate: undefined,
          })
        }
        setLines(mapped)
      }
    }

    if (isOpen && initialSuggestion) {
      const doApply = (accList: Account[], taxList: TaxRate[]) => {
        applySuggestion(accList, taxList)
      }

      if (accounts.length > 0 && taxRates.length > 0) {
        doApply(accounts, taxRates)
      } else {
        // fetch both if needed
        Promise.all([
          accounts.length ? Promise.resolve(accounts) : fetch('/api/accounts').then(r => r.json()),
          taxRates.length ? Promise.resolve(taxRates) : fetch('/api/tax-rates').then(r => r.json()),
        ]).then(([accs, taxes]) => {
          if (Array.isArray(accs) && Array.isArray(taxes)) {
            doApply(accs, taxes)
          }
        }).catch(() => {})
      }
    }
  }, [isOpen, initialSuggestion, accounts, taxRates])

  // Auto-lookup rate for foreign currency lines that arrived without fx metadata (chat or manual)
  useEffect(() => {
    if (!isOpen) return

    lines.forEach((line, idx) => {
      const cur = (line.currency || 'EUR').toUpperCase()
      if (cur === 'EUR') return
      if (line.fxRateToBase != null) return

      const d = date || new Date().toISOString().slice(0, 10)
      fetch(`/api/fx?currency=${cur}&date=${d}`)
        .then(r => r.json())
        .then((j: any) => {
          if (j && typeof j.fxRateToBase === 'number' && isFinite(j.fxRateToBase)) {
            updateLineFx(idx, {
              fxRateToBase: j.fxRateToBase,
              fxSource: j.source === 'LOOKUP' ? 'ECB' : (j.source || 'MANUAL'),
              fxDate: j.date || d,
            })
          }
        })
        .catch(() => {})
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, date])

  // Reset form when modal closes (and no new suggestion)
  const handleClose = () => {
    setDescription('')
    setLines([
      { accountId: '', debit: 0, credit: 0, description: '', taxRateId: '', currency: 'EUR' },
      { accountId: '', debit: 0, credit: 0, description: '', taxRateId: '', currency: 'EUR' }
    ])
    setError('')
    onClose()
  }

  // Small helper to keep fx fields when adding manual lines
  const addLineWithFx = () => {
    setLines([...lines, { accountId: '', debit: 0, credit: 0, description: '', taxRateId: '', currency: 'EUR' }])
  }

  if (!isOpen) return null

  const addLine = () => {
    setLines([...lines, { accountId: '', debit: 0, credit: 0, description: '', taxRateId: '', currency: 'EUR' }])
  }

  const updateLineFx = (index: number, fx: { fxRateToBase?: number; fxSource?: string; fxDate?: string }) => {
    const newLines = [...lines]
    newLines[index] = { ...newLines[index], ...fx }
    setLines(newLines)
  }

  const updateLine = (index: number, field: string, value: any) => {
    const newLines = [...lines]
    newLines[index] = { ...newLines[index], [field]: value }

    // Live tax line management: if user sets/changes taxRateId on a debit line,
    // ensure a corresponding tax line exists (or update its rate).
    if (field === 'taxRateId' && newLines[index].debit > 0) {
      const tr = taxRates.find(t => t.id === value)
      if (tr) {
        const expectedTax = Math.round(newLines[index].debit * Number(tr.rate) * 100) / 100
        // Look for an immediate next line that is a tax line for this rate/account
        const next = newLines[index + 1]
        if (next && next.taxRateId === value && next.description && /tax/i.test(next.description)) {
          // update the tax amount to match current debit
          next.debit = expectedTax
          next.currency = newLines[index].currency || 'EUR'
        } else {
          // insert a new tax line right after
          newLines.splice(index + 1, 0, {
            accountId: newLines[index].accountId,
            debit: expectedTax,
            credit: 0,
            description: `Tax (${(Number(tr.rate) * 100).toFixed(0)}% ${tr.isInputTax ? 'input' : ''})`,
            taxRateId: value,
            currency: newLines[index].currency || 'EUR',
            fxRateToBase: (newLines[index] as any).fxRateToBase,
            fxSource: (newLines[index] as any).fxSource,
            fxDate: (newLines[index] as any).fxDate,
          })
        }
      }
    }

    setLines(newLines)
  }

  const removeLine = (index: number) => {
    if (lines.length > 2) {
      setLines(lines.filter((_, i) => i !== index))
    }
  }

  const totalDebits = lines.reduce((sum, l) => sum + (l.debit || 0), 0)
  const totalCredits = lines.reduce((sum, l) => sum + (l.credit || 0), 0)
  const isBalanced = totalDebits === totalCredits && totalDebits > 0

  const handleSubmit = async () => {
    setError('')
    setSubmitting(true)

    try {
      // Phase 2 verification layer: double-check the suggestion before POST
      if (initialSuggestion) {
        const toVerify = {
          description: description || initialSuggestion.description,
          merchant: initialSuggestion.merchant,
          lines: lines.map(l => {
            const acc = accounts.find(a => a.id === l.accountId)
            return {
              accountCode: acc?.code,
              accountId: l.accountId || undefined,
              debit: Number(l.debit) || 0,
              credit: Number(l.credit) || 0,
              currency: l.currency || 'EUR',
              fxRateToBase: l.fxRateToBase,
              fxSource: l.fxSource,
              taxRateId: l.taxRateId || undefined,
            }
          }),
        }
        try {
          const vRes = await fetch('/api/verify-suggestion', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(toVerify),
          })
          const v = await vRes.json()
          if (!v?.ok) {
            setError('Verification failed: ' + (v?.warnings?.join('; ') || 'unknown'))
            setSubmitting(false)
            return
          }
          if (Array.isArray(v.warnings) && v.warnings.length > 0) {
            setVerificationWarnings(v.warnings)
          } else {
            setVerificationWarnings([])
          }
        } catch {
          // Non-fatal: if the verify endpoint is unreachable we still let the normal POST happen (user already confirmed)
        }
      }

      // If this is a reversal suggestion, use the dedicated reversal endpoint
      if (isReversal && initialSuggestion?.reversingOriginalId) {
        const revRes = await fetch('/api/journal-entries/reverse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ originalId: initialSuggestion.reversingOriginalId })
        })
        if (!revRes.ok) {
          const d = await revRes.json()
          throw new Error(d.error || 'Failed to reverse entry')
        }
        onSuccess()
        handleClose()
        return
      }

      const payload = {
        date,
        description: description || undefined,
        lines: lines.map(l => ({
          accountId: l.accountId,
          debit: Number(l.debit),
          credit: Number(l.credit),
          description: l.description || undefined,
          taxRateId: l.taxRateId || undefined,
          currency: l.currency || 'EUR',   // respect per-line currency choice (multi-currency)
          fxRateToBase: l.fxRateToBase,
          fxSource: l.fxSource,
          fxDate: l.fxDate,
        }))
      }

      const res = await fetch('/api/journal-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create entry')
      }

      onSuccess()
      handleClose()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-3xl p-6 text-white">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-xl font-semibold">{t('title')}</h2>
              {initialSuggestion && (
              <div className="text-xs text-emerald-400 mt-0.5">
                {isReversal ? t('reversing') : t('suggestedByChat')}
                {initialSuggestion.source === 'pdf' && (
                  <span className="ml-2 text-amber-400">• from PDF</span>
                )}
                {initialSuggestion.feedMatch?.matched && (
                  <span className="ml-2 text-emerald-400">• matched to feed</span>
                )}
                {/* Real authoritative feed rate in use (from previous import or exact merchant lookup) */}
                {Array.isArray(initialSuggestion.lines) &&
                 initialSuggestion.lines.some((l: any) => String(l.fxSource || '').startsWith('BANK_FEED')) && (
                  <span className="ml-2 text-emerald-400">• real feed rate</span>
                )}
                {initialSuggestion.merchant && (
                  <span className="ml-2 text-amber-400">• {initialSuggestion.merchant}</span>
                )}

                {/* Phase 2 memory hint */}
                {initialSuggestion.memory?.suggestedAccountCode && (
                  <span className="ml-2 text-violet-400">
                    • remember: {initialSuggestion.memory.suggestedAccountCode}
                  </span>
                )}
                {initialSuggestion.needsConfirmation && (
                  <span className="ml-2 text-rose-400">• please confirm</span>
                )}
              </div>
            )}
          </div>
          <button onClick={handleClose} className="text-zinc-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-950 text-red-400 text-sm rounded-lg">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-zinc-400 mb-1">{t('date')}</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white"
              />
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-1">{t('description')}</label>
              <input
                type="text"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder={t('descriptionPlaceholder')}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500"
              />
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-sm text-zinc-400">{t('journalLines')}</label>
              <button onClick={addLineWithFx} className="text-xs px-2 py-1 bg-zinc-800 rounded hover:bg-zinc-700">{t('addLine')}</button>
            </div>

            <div className="space-y-2">
              {lines.map((line, index) => (
                <div key={index} className="grid grid-cols-12 gap-2 items-center bg-zinc-950 p-3 rounded-lg">
                  <select
                    value={line.accountId}
                    onChange={e => updateLine(index, 'accountId', e.target.value)}
                    className="col-span-4 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm text-white"
                  >
                    <option value="">{t('account')}</option>
                    {accounts.map(acc => (
                      <option key={acc.id} value={acc.id}>
                        {acc.code} — {acc.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    placeholder={t('debit')}
                    value={line.debit || ''}
                    onChange={e => updateLine(index, 'debit', parseFloat(e.target.value) || 0)}
                    className="col-span-2 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm text-white"
                  />
                  <input
                    type="number"
                    placeholder={t('credit')}
                    value={line.credit || ''}
                    onChange={e => updateLine(index, 'credit', parseFloat(e.target.value) || 0)}
                    className="col-span-2 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm text-white"
                  />
                  <select
                    value={line.taxRateId || ''}
                    onChange={e => updateLine(index, 'taxRateId', e.target.value)}
                    className="col-span-3 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm text-white"
                  >
                    <option value="">{t('noTax')}</option>
                    {taxRates.map(tr => (
                      <option key={tr.id} value={tr.id}>
                        {tr.jurisdiction} {tr.name} ({(tr.rate * 100).toFixed(0)}%)
                      </option>
                    ))}
                  </select>
                   <input
                     placeholder={t('note')}
                     value={line.description}
                     onChange={e => updateLine(index, 'description', e.target.value)}
                     className="col-span-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm text-white"
                   />
                    <select
                      value={line.currency || 'EUR'}
                      onChange={e => updateLine(index, 'currency', e.target.value)}
                      className="col-span-1 bg-zinc-900 border border-zinc-800 rounded px-1 py-1.5 text-xs text-white"
                      title="Currency"
                    >
                      {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>

                    {/* FX badge / read-only indicator for PDF+feed sourced lines */}
                    {line.fxRateToBase != null && (
                      <div className="col-span-12 text-[10px] text-emerald-400 px-1 pt-1 -mt-1">
                        fx {line.fxRateToBase.toFixed(6)} via {line.fxSource || 'feed'} on {line.fxDate || 'n/a'}
                      </div>
                    )}

                    {lines.length > 2 && (
                      <button onClick={() => removeLine(index)} className="col-span-1 text-zinc-500 hover:text-red-400 text-lg">×</button>
                    )}
                </div>
              ))}
            </div>
          </div>

            <div className="flex justify-between items-center pt-2 text-sm">
            <div>
              <span className="text-zinc-400">{t('debits')} </span>
              <span className="font-mono text-emerald-400">{format.number(totalDebits, { style: 'currency', currency: 'EUR' })}</span>
              <span className="mx-3 text-zinc-600">|</span>
              <span className="text-zinc-400">{t('credits')} </span>
              <span className="font-mono text-rose-400">{format.number(totalCredits, { style: 'currency', currency: 'EUR' })}</span>
            </div>
            <div className={`text-xs px-2 py-0.5 rounded ${isBalanced ? 'bg-emerald-950 text-emerald-400' : 'bg-zinc-800 text-zinc-400'}`}>
              {isBalanced ? t('balanced') : t('notBalanced')}
            </div>
          </div>

           {requiresConfirmation && !isReversal && (
             <div className="mt-3 p-3 rounded-lg border border-rose-500/50 bg-rose-950/40 text-sm">
               <label className="flex items-start gap-2 cursor-pointer select-none">
                 <input
                   type="checkbox"
                   checked={userConfirmed}
                   onChange={(e) => setUserConfirmed(e.target.checked)}
                   className="mt-0.5 accent-rose-400"
                 />
                 <span className="text-rose-300">
                   {t('confirmationRequired') || 'I have reviewed the currency, amounts, tax, and any bank/card feed match. The values are correct and I want to post this entry.'}
                 </span>
               </label>
             </div>
           )}

           {/* Phase 2: show verification warnings (non-blocking) */}
           {verificationWarnings.length > 0 && (
             <div className="mt-2 text-[11px] text-amber-400 bg-amber-950/30 p-2 rounded">
               {verificationWarnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
             </div>
           )}
        </div>

        <div className="flex gap-3 mt-8">
          <button
            onClick={handleClose}
            className="flex-1 py-2.5 rounded-xl border border-zinc-700 hover:bg-zinc-800 transition text-white"
          >
            {t('cancel')}
          </button>
            <button
              onClick={handleSubmit}
              disabled={
                !isBalanced ||
                submitting ||
                accounts.length === 0 ||
                (requiresConfirmation && !isReversal && !userConfirmed)
              }
              className="flex-1 py-2.5 rounded-xl bg-white text-black disabled:opacity-50 disabled:cursor-not-allowed hover:bg-zinc-200 transition font-medium"
            >
              {submitting
                ? (isReversal ? t('reversingLoading') : t('creating'))
                : (requiresConfirmation && !isReversal && !userConfirmed)
                  ? (t('confirmAndCreate') || 'Confirm & Create')
                  : (isReversal ? t('postReversal') : t('create'))}
            </button>
          </div>
      </div>
    </div>
  )
}
