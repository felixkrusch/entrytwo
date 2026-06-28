import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { findRecentBankFeedRateForMerchant } from '@/lib/feedMatching'
import { EventType } from '@prisma/client'

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function levenshtein(a: string, b: string): number {
  const matrix = Array.from({ length: b.length + 1 }, (_, i) => [i])
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1]
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        )
      }
    }
  }
  return matrix[b.length][a.length]
}

function calculateMatchScore(
  candidate: { name: string; email?: string | null; taxId?: string | null; type?: string },
  queryName: string,
  queryType?: string
): number {
  const candidateName = normalizeName(candidate.name)
  const queryNameNorm = normalizeName(queryName)

  if (candidateName === queryNameNorm) return 1.0
  if (candidate.name.toLowerCase() === queryName.toLowerCase()) return 0.9
  if (candidateName.includes(queryNameNorm) || queryNameNorm.includes(candidateName)) return 0.7
  if (levenshtein(candidateName, queryNameNorm) <= 3) return 0.6

  const typeBonus = candidate.type === queryType ? 0.1 : 0
  return typeBonus
}

function detectCurrency(text: string): { currency: string | null; confidence: 'high' | 'medium' | 'low' } {
  const t = text.toUpperCase()

  const patterns: Array<{ re: RegExp; code: string }> = [
    { re: /\bUSD\b|\$\s*[\d,.]+|US\s*DOLLARS?/gi, code: 'USD' },
    { re: /\bEUR\b|€\s*[\d,.]+|EUROS?/gi, code: 'EUR' },
    { re: /\bGBP\b|£\s*[\d,.]+|POUNDS?/gi, code: 'GBP' },
    { re: /\bCAD\b|CA\s*DOLLARS?/gi, code: 'CAD' },
    { re: /\bCHF\b|SWISS\s*FRANCS?/gi, code: 'CHF' },
    { re: /\bAUD\b|AUSTRALIAN\s*DOLLARS?/gi, code: 'AUD' },
    { re: /\bJPY\b|¥\s*[\d,.]+|YEN/gi, code: 'JPY' },
  ]

  const found = new Set<string>()
  for (const p of patterns) {
    if (p.re.test(t)) found.add(p.code)
  }

  if (found.size === 1) {
    return { currency: Array.from(found)[0], confidence: 'high' }
  }
  if (found.size > 1) {
    for (const code of found) {
      const ctx = new RegExp(`(TOTAL|AMOUNT|DUE|INVOICE).*?${code}|${code}.*?(TOTAL|AMOUNT|DUE|INVOICE)`, 'i')
      if (ctx.test(text)) return { currency: code, confidence: 'medium' }
    }
    return { currency: Array.from(found)[0], confidence: 'low' }
  }

  if (/\$/.test(text) && !/€|£|¥/.test(text)) return { currency: 'USD', confidence: 'low' }
  if (/€/.test(text)) return { currency: 'EUR', confidence: 'low' }
  if (/£/.test(text)) return { currency: 'GBP', confidence: 'low' }

  return { currency: null, confidence: 'low' }
}

function suggestExpenseAccountCode(text: string): string {
  const t = text.toLowerCase()
  if (/software|subscription|saas|adobe|github|aws|google cloud|vercel|stripe/.test(t)) return '5100'
  if (/office|supplies|paper|printer|stapler|ink/.test(t)) return '5000'
  if (/travel|flight|hotel|airbnb|uber|lyft|taxi|train/.test(t)) return '5200'
  if (/consult|professional|legal|accounting|agency|freelance/.test(t)) return '5200'
  if (/marketing|ads|facebook|google ads|linkedin/.test(t)) return '5200'
  return '5200'
}

function guessTotal(text: string): number | null {
  const lines = text.split(/\r?\n/)
  const totalRe = /(total|amount\s*due|invoice\s*total|grand\s*total|balance\s*due)[:\s]*([€$£¥]?\s*[\d,.]+)/i

  for (const line of lines) {
    const m = line.match(totalRe)
    if (m) {
      const num = parseFloat(m[2].replace(/[^\d.]/g, ''))
      if (!isNaN(num) && num > 0) return num
    }
  }

  const allNums = text.match(/[\d,.]{2,}/g) || []
  for (let i = allNums.length - 1; i >= 0; i--) {
    const n = parseFloat(allNums[i].replace(/,/g, ''))
    if (!isNaN(n) && n > 10) return n
  }
  return null
}

function guessVendor(text: string): string | null {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  for (let i = 0; i < Math.min(lines.length, 8); i++) {
    const l = lines[i]
    if (l.length > 3 && l.length < 60 && !/invoice|receipt|total|date|page|tax/i.test(l)) {
      return l
    }
  }
  return null
}

function normalizeMerchant(name: string): string[] {
  const variants = [name.toLowerCase()]
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '')
  const patterns: Record<string, string[]> = {
    vercel: ['vercel', 'vercelcharges'],
    stripe: ['stripe', 'stripecharges'],
    paypal: ['paypal'],
    github: ['github', 'github.com'],
    aws: ['amazon web services', 'aws', 'amzn'],
  }
  for (const [, pats] of Object.entries(patterns)) {
    if (pats.some(p => normalized.includes(p))) variants.push(...pats)
  }
  return [...new Set(variants)]
}

function datesMatchOrNear(d1: string, d2: string): boolean {
  if (!d1 || !d2) return false
  const t1 = new Date(d1).getTime(), t2 = new Date(d2).getTime()
  return !isNaN(t1) && !isNaN(t2) && Math.abs(t1 - t2) <= 24 * 60 * 60 * 1000
}

function guessInvoiceDate(text: string): string | null {
  const lines = text.split(/\r?\n/)
  const datePatterns = [
    /invoice\s*date[:\s]*([A-Za-z]+[\s\d]+[A-Za-z]*[\s\d]+)/i,
    /date[:\s]*([A-Za-z]+[\s\d]+[A-Za-z]*[\s\d]+|\d{4}-\d{2}-\d{2})/,
    /(\d{4}-\d{2}-\d{2})/,
  ]
  for (const line of lines) {
    for (const pat of datePatterns) {
      const m = line.match(pat)
      if (m) {
        const d = new Date(m[1])
        if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10)
      }
    }
  }
  return null
}

function detectTaxHints(text: string): { rate: number | null; jurisdictionGuess?: string; taxAmount?: number } {
  const t = text.toLowerCase()

  let explicitTaxAmount: number | null = null
  const taxAmtRe = /(mwst|ust|vat|sales\s*tax|steuer|vorsteuer|tax)[^\d]{0,10}(\d{1,3}(?:[.,]\d{2})?)/i
  const amtMatch = t.match(taxAmtRe)
  if (amtMatch) {
    explicitTaxAmount = parseFloat(amtMatch[2].replace(',', '.'))
  }

  const pctMatch = t.match(/(\d{1,2}(?:[.,]\d{1,2})?)\s*%?\s*(mwst|ust|vat|sales\s*tax|steuer|vorsteuer)?/i)
  let rate: number | null = null
  if (pctMatch) {
    rate = parseFloat(pctMatch[1].replace(',', '.')) / 100
  }

  let jurisdictionGuess: string | undefined
  if (/deutschland|\bdew\b|\bmwst\b|\bust\b/.test(t)) jurisdictionGuess = 'DE'
  if (/\bAustria\b|\bAT\b|\bUSt\b/.test(t)) jurisdictionGuess = 'AT'
  if (/us-ca|california|sales tax/.test(t)) jurisdictionGuess = 'US-CA'

  return {
    rate: rate && rate > 0 && rate < 1 ? rate : null,
    jurisdictionGuess,
    taxAmount: explicitTaxAmount && explicitTaxAmount > 0 ? explicitTaxAmount : undefined,
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())

    const pdfParseMod = await import('pdf-parse')
    const pdfParse = ((pdfParseMod as { default?: (b: Buffer) => Promise<{ text: string; numpages?: number }> }).default || pdfParseMod) as (b: Buffer) => Promise<{ text: string; numpages?: number }>
    const data = await pdfParse(buffer)

    const fullText = data.text || ''
    const preview = fullText.substring(0, 2800)

    const { currency, confidence } = detectCurrency(fullText)
    const total = guessTotal(fullText)
    const vendor = guessVendor(fullText)
    const invoiceDate = guessInvoiceDate(fullText)
    const taxHints = detectTaxHints(fullText)

    // Auto-contact creation from vendor extraction
    let contactMatch: { contact: { id: string; name: string }; created: boolean } | null = null
    if (vendor) {
      try {
        // First try to find existing match
        const contacts = await prisma.contact.findMany({ where: { type: 'VENDOR' } })
        const matches = contacts
          .map(c => ({ contact: c, score: calculateMatchScore(c, vendor, 'VENDOR') }))
          .filter(m => m.score >= 0.8)
          .sort((a, b) => b.score - a.score)

        if (matches[0]?.score >= 0.9) {
          contactMatch = { contact: { id: matches[0].contact.id, name: matches[0].contact.name }, created: false }
        } else {
          // Create new contact
          const newContact = await prisma.contact.create({
            data: { name: vendor, type: 'VENDOR' },
          })
          await prisma.event.create({
            data: {
              eventType: EventType.CONTACT_CREATED,
              entityType: 'Contact',
              entityId: newContact.id,
              payload: { name: vendor, type: 'VENDOR', source: 'pdf-auto' },
            },
          })
          contactMatch = { contact: { id: newContact.id, name: newContact.name }, created: true }
        }
      } catch {
        // non-fatal
      }
    }

    let matchedTaxRateId: string | undefined
    let matchedTaxRate: { id: string; rate: unknown; name: string; jurisdiction: string } | null = null
    try {
      const rates = await prisma.taxRate.findMany({ orderBy: [{ jurisdiction: 'asc' }, { rate: 'desc' }] })
      if (rates.length && taxHints.rate != null) {
        let best: { id: string; rate: unknown; name: string; jurisdiction: string } | null = null
        let bestScore = -1
        for (const r of rates) {
          let score = 0
          const rateDelta = Math.abs(Number(r.rate) - taxHints.rate)
          if (rateDelta < 0.005) score += 10
          else if (rateDelta < 0.02) score += 5
          else if (rateDelta < 0.05) score += 1

          if (taxHints.jurisdictionGuess && r.jurisdiction === taxHints.jurisdictionGuess) score += 8

          if (score > bestScore) {
            bestScore = score
            best = r
          }
        }
        if (best && bestScore >= 5) {
          matchedTaxRateId = best.id
          matchedTaxRate = {
            id: best.id,
            rate: best.rate,
            name: best.name,
            jurisdiction: best.jurisdiction,
          }
        }
      }
    } catch {
      // non-fatal
    }

    let feedMatch: {
      baseAmount: number
      foreignAmount: number
      currency: string
      date: string
      journalEntryId?: string
      description?: string
      settlementAccountCode?: string
      fxRateToBase?: number
      fxSource?: string
      fxDate?: string
    } | null = null

    const detectedCur = (currency || 'EUR').toUpperCase()

    try {
      if (total && total > 0) {
        const since = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30)
        const candidates = await prisma.journalLine.findMany({
          where: {
            journalEntry: {
              date: { gte: since },
            },
          },
          include: {
            account: { select: { code: true } },
            journalEntry: {
              select: { id: true, date: true, description: true },
            },
          },
          orderBy: { journalEntry: { date: 'desc' } },
          take: 200,
        })

        const vendorLower = (vendor || '').toLowerCase()
        const foreignTotal = total
        const vendorVariants = vendor ? normalizeMerchant(vendor) : []

        type FeedMatchResult = {
          baseAmount: number
          foreignAmount: number
          currency: string
          date: string
          journalEntryId?: string
          description?: string
          settlementAccountCode?: string
          fxRateToBase?: number
          fxSource?: string
          fxDate?: string
        }
        const bestMatch = { score: 0, match: null as FeedMatchResult | null }

        for (const line of candidates) {
          const amt = Math.max(Number(line.debit), Number(line.credit))
          if (!amt || amt <= 0) continue

          const lineCur = (line.currency || 'EUR').toUpperCase()

          const currencyDifferent = lineCur !== detectedCur

          const rateExpected = 0.5
          const rateMax = 2.0
          const amountReasonable = amt > 0 && foreignTotal && foreignTotal > 0 &&
            (amt / foreignTotal >= rateExpected && amt / foreignTotal <= rateMax)

          const entryDesc = (line.journalEntry.description || '').toLowerCase()
          const lineDesc = (line.description || '').toLowerCase()
          const merchantHintMatch = vendorVariants.some(v =>
            entryDesc.includes(v) || lineDesc.includes(v) ||
            entryDesc.includes(vendorLower.slice(0, 4)) || (vendorLower.length > 4 && lineDesc.includes(vendorLower.slice(0, 4)))
          )

          const dateProximityMatch = invoiceDate && datesMatchOrNear(invoiceDate, line.journalEntry.date.toISOString().slice(0, 10))

          let matchScore = 0
          if (merchantHintMatch && currencyDifferent && amountReasonable) matchScore = 10
          else if (merchantHintMatch && currencyDifferent) matchScore = 8
          else if (merchantHintMatch && amountReasonable) matchScore = 6
          else if (merchantHintMatch) matchScore = 4
          else if (currencyDifferent && amountReasonable) matchScore = 5
          else if (currencyDifferent) matchScore = 2
          else if (amountReasonable) matchScore = 1

          if (dateProximityMatch) matchScore += 3

          if (matchScore > 0 && matchScore > bestMatch.score) {
            bestMatch.score = matchScore
            const hasFx = line.fxRateToBase != null
            bestMatch.match = {
              baseAmount: amt,
              foreignAmount: foreignTotal,
              currency: lineCur,
              date: line.journalEntry.date.toISOString().slice(0, 10),
              journalEntryId: line.journalEntry.id,
              description: line.journalEntry.description || undefined,
              settlementAccountCode: line.account?.code || undefined,
              fxRateToBase: hasFx ? Number(line.fxRateToBase) : undefined,
              fxSource: hasFx ? (line.fxSource || undefined) : undefined,
              fxDate: hasFx && line.fxDate ? line.fxDate.toISOString().slice(0, 10) : undefined,
            }
          }
        }

        if (bestMatch.match && bestMatch.score >= 5) {
          feedMatch = bestMatch.match
        }
      }
    } catch {
      // non-fatal
    }

    if (!feedMatch && vendor) {
      try {
        const feedRate = await findRecentBankFeedRateForMerchant(vendor.toLowerCase(), invoiceDate || undefined)
        if (feedRate) {
          feedMatch = {
            baseAmount: 0,
            foreignAmount: total || 0,
            currency: feedRate.currency,
            date: feedRate.fxDate || new Date().toISOString().slice(0, 10),
            fxRateToBase: feedRate.fxRateToBase,
            fxSource: feedRate.fxSource,
            fxDate: feedRate.fxDate,
          }
        }
      } catch {
        // non-fatal
      }
    }

    const suggestionLines: Array<{
      accountCode: string
      debit?: number
      credit?: number
      description?: string
      currency: string
      taxRateId?: string
      contactId?: string
      fxRateToBase?: number
      fxSource?: string
      fxDate?: string
    }> = []

    const useCurrency = currency || 'EUR'
    const useAmount = total || 100
    const expenseCode = suggestExpenseAccountCode(fullText)

    const creditAccountCode: string = feedMatch?.settlementAccountCode || '1100'

    const splitGross = (gross: number, rate: number) => {
      const net = gross / (1 + rate)
      const tax = gross - net
      return { net: Math.round(net * 100) / 100, tax: Math.round(tax * 100) / 100 }
    }

    if (feedMatch) {
      const fx = feedMatch.fxRateToBase
      const hasRealRate = fx != null && isFinite(Number(fx)) && Number(fx) > 0
      const derivedRate = feedMatch.foreignAmount > 0
        ? feedMatch.baseAmount / feedMatch.foreignAmount
        : null

      const rateToUse = hasRealRate ? Number(fx) : (derivedRate ?? null)
      const sourceToUse = hasRealRate
        ? (feedMatch.fxSource || `BANK_FEED:derived:${feedMatch.date}`)
        : (rateToUse ? `BANK_FEED:derived:${feedMatch.date}` : undefined)

      const foreignGross = feedMatch.foreignAmount

      if (matchedTaxRateId && taxHints.rate != null && foreignGross > 0) {
        let tax = 0
        let net = foreignGross
        if (taxHints.taxAmount && taxHints.taxAmount > 0 && taxHints.taxAmount < foreignGross) {
          tax = taxHints.taxAmount
          net = Math.round((foreignGross - tax) * 100) / 100
        } else {
          const split = splitGross(foreignGross, taxHints.rate)
          net = split.net
          tax = split.tax
        }

        suggestionLines.push({
          accountCode: expenseCode,
          debit: net,
          description: vendor ? `Invoice from ${vendor} (net)` : 'Invoice expense (net)',
          currency: useCurrency,
          fxRateToBase: rateToUse ?? undefined,
          fxSource: sourceToUse,
          fxDate: feedMatch.fxDate || feedMatch.date,
          taxRateId: matchedTaxRateId,
          contactId: contactMatch?.contact.id,
        })
        suggestionLines.push({
          accountCode: expenseCode,
          debit: tax,
          description: `Tax (${(taxHints.rate * 100).toFixed(0)}%)`,
          currency: useCurrency,
          fxRateToBase: rateToUse ?? undefined,
          fxSource: sourceToUse,
          fxDate: feedMatch.fxDate || feedMatch.date,
          taxRateId: matchedTaxRateId,
          contactId: contactMatch?.contact.id,
        })
      } else {
        suggestionLines.push({
          accountCode: expenseCode,
          debit: foreignGross,
          description: vendor ? `Invoice from ${vendor}` : 'Invoice expense',
          currency: useCurrency,
          fxRateToBase: rateToUse ?? undefined,
          fxSource: sourceToUse,
          fxDate: feedMatch.fxDate || feedMatch.date,
          taxRateId: matchedTaxRateId,
          contactId: contactMatch?.contact.id,
        })
      }

      const feedDesc = feedMatch.description
        ? `Paid via feed (${feedMatch.date}) — ${feedMatch.description}`
        : `Paid via feed (${feedMatch.date})`

      suggestionLines.push({
        accountCode: creditAccountCode,
        credit: feedMatch.baseAmount,
        description: feedDesc,
        currency: feedMatch.currency,
      })
    } else {
      if (matchedTaxRateId && taxHints.rate != null && useAmount > 0) {
        const { net, tax } = splitGross(useAmount, taxHints.rate)
        suggestionLines.push({
          accountCode: expenseCode,
          debit: net,
          description: vendor ? `Invoice from ${vendor} (net)` : 'Invoice expense (net)',
          currency: useCurrency,
          taxRateId: matchedTaxRateId,
          contactId: contactMatch?.contact.id,
        })
        suggestionLines.push({
          accountCode: expenseCode,
          debit: tax,
          description: `Tax (${(taxHints.rate * 100).toFixed(0)}%)`,
          currency: useCurrency,
          taxRateId: matchedTaxRateId,
          contactId: contactMatch?.contact.id,
        })
        suggestionLines.push({
          accountCode: creditAccountCode,
          credit: useAmount,
          description: 'Accounts payable',
          currency: useCurrency,
        })
      } else {
        suggestionLines.push({
          accountCode: expenseCode,
          debit: useAmount,
          description: vendor ? `Invoice from ${vendor}` : 'Invoice expense',
          currency: useCurrency,
          taxRateId: matchedTaxRateId,
          contactId: contactMatch?.contact.id,
        })
        suggestionLines.push({
          accountCode: creditAccountCode,
          credit: useAmount,
          description: 'Accounts payable',
          currency: useCurrency,
        })
      }
    }

    const feedInfo = feedMatch
      ? {
          matched: true,
          baseAmount: feedMatch.baseAmount,
          foreignAmount: feedMatch.foreignAmount,
          settlementCurrency: feedMatch.currency,
          date: feedMatch.date,
        }
      : { matched: false }

    const taxInfo = matchedTaxRate
      ? {
          rate: Number(matchedTaxRate.rate),
          jurisdiction: matchedTaxRate.jurisdiction,
          name: matchedTaxRate.name,
        }
      : null

    return NextResponse.json({
      success: true,
      filename: file.name,
      pages: (data as { numpages?: number }).numpages ?? 0,
      text: preview,
      detected: {
        currency: currency || null,
        currencyConfidence: confidence,
        total: total,
        vendor: vendor,
        feedMatch: feedInfo,
        tax: taxInfo,
      },
      suggestion: {
        description: `Invoice: ${file.name}${vendor ? ` — ${vendor}` : ''}`,
        merchant: vendor || undefined,
        lines: suggestionLines,
        source: 'pdf',
        needsConfirmation: !(
          (confidence === 'high' || (feedMatch && String(feedMatch.fxSource || '').startsWith('BANK_FEED'))) &&
          !!currency &&
          (feedInfo.matched || (feedMatch && String(feedMatch.fxSource || '').startsWith('BANK_FEED'))) &&
          !taxInfo
        ),
        feedMatch: feedInfo.matched ? feedInfo : undefined,
      },
      contact: contactMatch ? {
        ...contactMatch.contact,
        newlyCreated: contactMatch.created,
      } : null,
      message: [
        currency ? `Detected currency ${currency} (confidence: ${confidence}).` : null,
        taxInfo ? `Detected tax ${taxInfo.jurisdiction} ${taxInfo.name} (${(taxInfo.rate * 100).toFixed(0)}%).` : null,
        feedInfo.matched ? 'Matched to feed.' : null,
        contactMatch?.created ? 'Created vendor contact.' : null,
      ].filter(Boolean).join(' '),
    })
  } catch (error) {
    console.error('PDF processing error:', error)
    return NextResponse.json(
      { error: 'Failed to process PDF' },
      { status: 500 }
    )
  }
}