import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getFxRateToBase } from '@/lib/fx'
import { findRecentBankFeedRateForMerchant } from '@/lib/feedMatching'

// Basic currency detector for PDF text (supports common symbols and codes)
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
    // Prefer the one that appears with "Total" or "Amount" context if possible
    for (const code of found) {
      const ctx = new RegExp(`(TOTAL|AMOUNT|DUE|INVOICE).*?${code}|${code}.*?(TOTAL|AMOUNT|DUE|INVOICE)`, 'i')
      if (ctx.test(text)) return { currency: code, confidence: 'medium' }
    }
    return { currency: Array.from(found)[0], confidence: 'low' }
  }

  // Fallback: look for lone symbols
  if (/\$/.test(text) && !/€|£|¥/.test(text)) return { currency: 'USD', confidence: 'low' }
  if (/€/.test(text)) return { currency: 'EUR', confidence: 'low' }
  if (/£/.test(text)) return { currency: 'GBP', confidence: 'low' }

  return { currency: null, confidence: 'low' }
}

// Simple keyword → account code heuristic for expense suggestions
function suggestExpenseAccountCode(text: string): string {
  const t = text.toLowerCase()
  if (/software|subscription|saas|adobe|github|aws|google cloud|vercel|stripe/.test(t)) return '5100'
  if (/office|supplies|paper|printer|stapler|ink/.test(t)) return '5000'
  if (/travel|flight|hotel|airbnb|uber|lyft|taxi|train/.test(t)) return '5200'
  if (/consult|professional|legal|accounting|agency|freelance/.test(t)) return '5200'
  if (/marketing|ads|facebook|google ads|linkedin/.test(t)) return '5200'
  return '5200' // default generic expense
}

function guessTotal(text: string): number | null {
  // Look for lines containing TOTAL / AMOUNT DUE / INVOICE TOTAL near a number
  const lines = text.split(/\r?\n/)
  const totalRe = /(total|amount\s*due|invoice\s*total|grand\s*total|balance\s*due)[:\s]*([€$£¥]?\s*[\d,.]+)/i

  for (const line of lines) {
    const m = line.match(totalRe)
    if (m) {
      const num = parseFloat(m[2].replace(/[^\d.]/g, ''))
      if (!isNaN(num) && num > 0) return num
    }
  }

  // Fallback: last reasonably large number on the page (crude)
  const allNums = text.match(/[\d,.]{2,}/g) || []
  for (let i = allNums.length - 1; i >= 0; i--) {
    const n = parseFloat(allNums[i].replace(/,/g, ''))
    if (!isNaN(n) && n > 10) return n
  }
  return null
}

function guessVendor(text: string): string | null {
  // Very rough heuristics: first non-empty line that looks like a company name
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  for (let i = 0; i < Math.min(lines.length, 8); i++) {
    const l = lines[i]
    if (l.length > 3 && l.length < 60 && !/invoice|receipt|total|date|page|tax/i.test(l)) {
      return l
    }
  }
  return null
}

// Very lightweight tax hint detector from PDF text.
// Returns a best-guess rate (as decimal) and whether it looks like input tax.
function detectTaxHints(text: string): { rate: number | null; isLikelyInput: boolean; jurisdictionGuess?: string; taxAmount?: number } {
  const t = text.toLowerCase()

  // Try to find explicit tax amount near a rate, e.g. "MwSt 19% 22.80", "Tax 19.00", "VAT 19% €22.80"
  let explicitTaxAmount: number | null = null
  const taxAmtRe = /(mwst|ust|vat|sales\s*tax|steuer|vorsteuer|tax)[^\d]{0,10}(\d{1,3}(?:[.,]\d{2})?)/i
  const amtMatch = t.match(taxAmtRe)
  if (amtMatch) {
    explicitTaxAmount = parseFloat(amtMatch[2].replace(',', '.'))
  }

  // Rate patterns
  const pctMatch = t.match(/(\d{1,2}(?:[.,]\d{1,2})?)\s*%?\s*(mwst|ust|vat|sales\s*tax|steuer|vorsteuer)?/i)
  let rate: number | null = null
  if (pctMatch) {
    rate = parseFloat(pctMatch[1].replace(',', '.')) / 100
  }

  const isInput = /vorsteuer|input\s*tax|recoverable/i.test(t)
  const isOutput = /umsatzsteuer|output\s*tax|mwst\s*(?!.*vorsteuer)|sales\s*tax/i.test(t)

  let jurisdictionGuess: string | undefined
  if (/deutschland|\bdew\b|\bmwst\b|\bust\b/.test(t)) jurisdictionGuess = 'DE'
  if (/\bAustria\b|\bAT\b|\bUSt\b/.test(t)) jurisdictionGuess = 'AT'
  if (/us-ca|california|sales tax/.test(t)) jurisdictionGuess = 'US-CA'

  return {
    rate: rate && rate > 0 && rate < 1 ? rate : null,
    isLikelyInput: isInput || (!isOutput && /vorsteuer|input/i.test(t)),
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

    // Dynamic import to avoid Turbopack bundling issues with pdf-parse
    const pdfParseMod = await import('pdf-parse')
    const pdfParse = ((pdfParseMod as { default?: (b: Buffer) => Promise<{ text: string; numpages?: number }> }).default || pdfParseMod) as (b: Buffer) => Promise<{ text: string; numpages?: number }>
    const data = await pdfParse(buffer)

    const fullText = data.text || ''
    const preview = fullText.substring(0, 2800)

    const { currency, confidence } = detectCurrency(fullText)
    const total = guessTotal(fullText)
    const vendor = guessVendor(fullText)
    const taxHints = detectTaxHints(fullText)

    // Load live tax rates so we can attach a taxRateId when we have a good hint
    let matchedTaxRateId: string | undefined
    let matchedTaxRate: { id: string; rate: unknown; isInputTax: boolean; name: string; jurisdiction: string } | null = null
    try {
      const rates = await prisma.taxRate.findMany({ orderBy: [{ jurisdiction: 'asc' }, { rate: 'desc' }] })
      if (rates.length && taxHints.rate != null) {
        // Score: jurisdiction match (if we guessed one) + rate closeness + input/output preference
        let best: { id: string; rate: unknown; isInputTax: boolean; name: string; jurisdiction: string } | null = null
        let bestScore = -1
        for (const r of rates) {
          let score = 0
          const rateDelta = Math.abs(Number(r.rate) - taxHints.rate)
          if (rateDelta < 0.005) score += 10
          else if (rateDelta < 0.02) score += 5
          else if (rateDelta < 0.05) score += 1

          if (taxHints.jurisdictionGuess && r.jurisdiction === taxHints.jurisdictionGuess) score += 8

          if (taxHints.isLikelyInput === r.isInputTax) score += 6
          else score -= 2

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
            isInputTax: best.isInputTax,
            name: best.name,
            jurisdiction: best.jurisdiction,
          }
        }
      }
    } catch {
      // non-fatal
    }

    // Feed matching for PDF + multi-currency (authoritative rate from bank/card feed).
    // Strategy:
    // - PDF total = foreign currency amount on the invoice (e.g. 120 USD)
    // - We look for a recent journal line in a *different* currency (typically EUR/base) that represents the actual settlement amount.
    // - We prefer lines whose currency != detected PDF currency.
    // - We use a loose tolerance + optional merchant hint.
    // - When the matched line already carries fxRateToBase/fxSource/fxDate, we treat those as authoritative.
    // - Result: we use the real rate when available; otherwise derive fxRateToBase = baseAmount / foreignAmount.
    let feedMatch: {
      baseAmount: number          // amount in the settlement (base) currency from the feed line
      foreignAmount: number       // amount from the PDF (foreign currency)
      currency: string            // currency of the base settlement line (e.g. EUR)
      date: string
      journalEntryId?: string
      description?: string
      settlementAccountCode?: string
      fxRateToBase?: number       // authoritative rate from the matched feed line, if present
      fxSource?: string
      fxDate?: string
    } | null = null

    const detectedCur = (currency || 'EUR').toUpperCase()

    try {
      if (total && total > 0) {
        const since = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30) // last 30 days
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
          // fxRateToBase, fxSource, fxDate are scalars on JournalLine and will be returned
          orderBy: { journalEntry: { date: 'desc' } },
          take: 200,
        })

        const vendorLower = (vendor || '').toLowerCase()
        const foreignTotal = total

        for (const line of candidates) {
          const amt = Math.max(Number(line.debit), Number(line.credit))
          if (!amt || amt <= 0) continue

          const lineCur = (line.currency || 'EUR').toUpperCase()

          // Prefer lines in a different currency than what the PDF claims (i.e. the base settlement)
          const currencyDifferent = lineCur !== detectedCur

          // Amount tolerance is intentionally loose because foreign vs base numbers differ by the rate
          // We mainly look for "reasonable size" recent movements.
          const sizeReasonable = Math.abs(amt - foreignTotal) < Math.max(foreignTotal * 0.8, 200) || amt > 10

          // Weak merchant hint
          const entryDesc = (line.journalEntry.description || '').toLowerCase()
          const merchantHintMatch = vendorLower && entryDesc && (
            entryDesc.includes(vendorLower.slice(0, 6)) || vendorLower.includes(entryDesc.slice(0, 6))
          )

            if ((currencyDifferent && sizeReasonable) || merchantHintMatch) {
            const hasFx = line.fxRateToBase != null

            feedMatch = {
              baseAmount: amt,
              foreignAmount: foreignTotal,
              currency: lineCur,
              date: line.journalEntry.date.toISOString().slice(0, 10),
              journalEntryId: line.journalEntry.id,
              description: line.journalEntry.description || undefined,
              settlementAccountCode: line.account?.code || undefined,
              // Carry authoritative rate + source from the actual feed line when present
              fxRateToBase: hasFx ? Number(line.fxRateToBase) : undefined,
              fxSource: hasFx ? (line.fxSource || undefined) : undefined,
              fxDate: hasFx && line.fxDate ? line.fxDate.toISOString().slice(0, 10) : undefined,
            }

            // Strongest preference: lines that already carry real fx metadata from a feed
            if (hasFx && currencyDifferent) break
            if (hasFx) break
            if ((merchantHintMatch || hasFx) && currencyDifferent) break
            if (currencyDifferent) break
          }
        }
      }
    } catch (e) {
      // non-fatal
    }

    // Phase 1 improvement: if we have a vendor but no good feed match yet,
    // try to find a previous authoritative BANK_FEED rate for that exact merchant.
    if (!feedMatch && vendor) {
      try {
        const feedRate = await findRecentBankFeedRateForMerchant(vendor.toLowerCase())
        if (feedRate) {
          // We don't know the exact base amount here, but we can at least carry the real rate.
          // The PDF side will still be the foreign amount; the rate is the important authoritative part.
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

    // Build suggestion lines
    const suggestionLines: Array<{
      accountCode: string
      debit?: number
      credit?: number
      description?: string
      currency: string
      taxRateId?: string
      fxRateToBase?: number
      fxSource?: string
      fxDate?: string
    }> = []

    const useCurrency = currency || 'EUR'
    const useAmount = total || 100
    const expenseCode = suggestExpenseAccountCode(fullText)

    // Always a concrete string for the credit/settlement side account code
    const creditAccountCode: string = feedMatch?.settlementAccountCode || '1100'

    // Helper to split gross into net + tax when we have a rate
    const splitGross = (gross: number, rate: number) => {
      const net = gross / (1 + rate)
      const tax = gross - net
      return { net: Math.round(net * 100) / 100, tax: Math.round(tax * 100) / 100 }
    }

    if (feedMatch) {
      // Prefer the authoritative rate from the matched feed line if it already has fx metadata.
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
        // Prefer an explicit tax amount from the PDF if present and plausible
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

        // Net expense in foreign currency
        suggestionLines.push({
          accountCode: expenseCode,
          debit: net,
          description: vendor ? `Invoice from ${vendor} (net)` : 'Invoice expense (net)',
          currency: useCurrency,
          fxRateToBase: rateToUse ?? undefined,
          fxSource: sourceToUse,
          fxDate: feedMatch.fxDate || feedMatch.date,
          taxRateId: matchedTaxRateId,
        })
        // Explicit tax line (input or output depending on detection)
        suggestionLines.push({
          accountCode: expenseCode,
          debit: tax,
          description: `Tax (${(taxHints.rate * 100).toFixed(0)}%${taxHints.isLikelyInput ? ' input' : ''})`,
          currency: useCurrency,
          fxRateToBase: rateToUse ?? undefined,
          fxSource: sourceToUse,
          fxDate: feedMatch.fxDate || feedMatch.date,
          taxRateId: matchedTaxRateId,
        })
      } else {
        // No confident tax split — post the full foreign amount with taxRateId attached if we have one
        suggestionLines.push({
          accountCode: expenseCode,
          debit: foreignGross,
          description: vendor ? `Invoice from ${vendor}` : 'Invoice expense',
          currency: useCurrency,
          fxRateToBase: rateToUse ?? undefined,
          fxSource: sourceToUse,
          fxDate: feedMatch.fxDate || feedMatch.date,
          taxRateId: matchedTaxRateId,
        })
      }

      // Base-currency settlement (authoritative amount from feed)
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
      // No feed match
      if (matchedTaxRateId && taxHints.rate != null && useAmount > 0) {
        const { net, tax } = splitGross(useAmount, taxHints.rate)
        suggestionLines.push({
          accountCode: expenseCode,
          debit: net,
          description: vendor ? `Invoice from ${vendor} (net)` : 'Invoice expense (net)',
          currency: useCurrency,
          taxRateId: matchedTaxRateId,
        })
        suggestionLines.push({
          accountCode: expenseCode,
          debit: tax,
          description: `Tax (${(taxHints.rate * 100).toFixed(0)}%${taxHints.isLikelyInput ? ' input' : ''})`,
          currency: useCurrency,
          taxRateId: matchedTaxRateId,
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
          isInputTax: matchedTaxRate.isInputTax,
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
          // High confidence currency + we have an authoritative feed-sourced rate (either loose match or merchant lookup)
          (confidence === 'high' || (feedMatch && String(feedMatch.fxSource || '').startsWith('BANK_FEED'))) &&
          !!currency &&
          (feedInfo.matched || (feedMatch && String(feedMatch.fxSource || '').startsWith('BANK_FEED'))) &&
          !taxInfo
        ),
        feedMatch: feedInfo.matched ? feedInfo : undefined,
      },
      message: [
        currency ? `Detected currency ${currency} (confidence: ${confidence}).` : null,
        taxInfo ? `Detected tax ${taxInfo.jurisdiction} ${taxInfo.name} (${(taxInfo.rate * 100).toFixed(0)}%).` : null,
        feedInfo.matched ? 'Matched to feed.' : null,
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
