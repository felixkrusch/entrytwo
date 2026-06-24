'use client'

import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { useNewEntry, NewEntrySuggestion } from './NewEntryContext'
import { useTranslations, useFormatter } from 'next-intl'

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
  const [lines, setLines] = useState([
    { accountId: '', debit: 0, credit: 0, description: '', taxRateId: '', currency: 'EUR' },
    { accountId: '', debit: 0, credit: 0, description: '', taxRateId: '', currency: 'EUR' }
  ])

  const CURRENCIES = ['EUR', 'USD', 'GBP']
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const isReversal = !!initialSuggestion?.reversingOriginalId

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
    const applySuggestion = (accList: Account[]) => {
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
            currency: l.currency || 'EUR'
          }
        })
        while (mapped.length < 2) {
          mapped.push({ accountId: '', debit: 0, credit: 0, description: '', taxRateId: '', currency: 'EUR' })
        }
        setLines(mapped)
      }
    }

    if (isOpen && initialSuggestion) {
      if (accounts.length > 0) {
        applySuggestion(accounts)
      } else {
        // fetch accounts then apply
        fetch('/api/accounts')
          .then(r => r.json())
          .then((data: Account[]) => {
            if (Array.isArray(data) && data.length) {
              applySuggestion(data)
            }
          })
          .catch(() => {})
      }
    }
  }, [isOpen, initialSuggestion, accounts])

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

  if (!isOpen) return null

  const addLine = () => {
    setLines([...lines, { accountId: '', debit: 0, credit: 0, description: '', taxRateId: '', currency: 'EUR' }])
  }

  const updateLine = (index: number, field: string, value: any) => {
    const newLines = [...lines]
    newLines[index] = { ...newLines[index], [field]: value }
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
          currency: l.currency || 'EUR'   // respect per-line currency choice (multi-currency)
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
              <button onClick={addLine} className="text-xs px-2 py-1 bg-zinc-800 rounded hover:bg-zinc-700">{t('addLine')}</button>
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
              disabled={!isBalanced || submitting || accounts.length === 0}
              className="flex-1 py-2.5 rounded-xl bg-white text-black disabled:opacity-50 disabled:cursor-not-allowed hover:bg-zinc-200 transition font-medium"
            >
              {submitting
                ? (isReversal ? t('reversingLoading') : t('creating'))
                : (isReversal ? t('postReversal') : t('create'))}
            </button>
          </div>
      </div>
    </div>
  )
}
