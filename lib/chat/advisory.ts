import { generateText } from 'ai'
import { getLlmConfig, createLlmModel } from '@/lib/llm'
import type { CompanyProfile } from '@/lib/companyProfile'
import { MemoryVault } from '@/lib/memoryVault'

interface AdvisoryContext {
  companyProfile: CompanyProfile
  accountList: string
  taxContext: string
  balances: string
  feedRatesText?: string
  memoryText?: string
  recentConversation?: Array<{ role: 'user' | 'assistant'; content: string }>
  attachmentsText?: string
  vaultItems?: any[]
}

/**
 * Builds the system prompt for the advisory/expert role.
 * This is deliberately different from the execution "output structured intent" prompt.
 *
 * Goals:
 * - Be a competent tax adviser (uses real configured rates + company location)
 * - Be a bookkeeping advisor (double-entry thinking, Git model awareness at high level)
 * - Know basic app concepts (so it can explain UI, flows, Git model, receipts, feeds, etc.)
 * - Always ground answers in the provided facts; never hallucinate tax rates or company data.
 */
export function buildAdvisorySystemPrompt(ctx: AdvisoryContext): string {
  const { companyProfile, accountList, taxContext, balances, feedRatesText, memoryText } = ctx

  const companyFacts = `
Company facts (authoritative — use these for all tax and currency decisions):
- Base currency: ${companyProfile.baseCurrency}
- Country: ${companyProfile.country || 'unknown'}
- Region (ISO 3166-2 when known): ${companyProfile.region || 'unknown'}
- Default tax jurisdiction: ${companyProfile.defaultTaxJurisdiction || 'unknown'}
`.trim()

  const appKnowledge = `
Entrytwo basics (for explaining the app):
- Double-entry accounting with full audit trail via immutable Events (Git-like model: branches, merges, restores, tags).
- Every change is a commit via Events. Visible state on "main" or a branch is computed from ancestry.
- Chat supports two modes: execution (create journal entries, invoices, contacts, etc. with validation) and advisory (tax, bookkeeping, app questions).
- Receipts panel: upload PDFs/images → stored under /uploads/receipts and linkable to entries.
- Bank/card feeds can be authoritative for FX rates (BANK_FEED source).
- Tax is first-class: TaxRate records + taxRateId on JournalLine and InvoiceLine. Input vs output tax is tracked.
- Multi-currency: JournalLine carries currency + fxRateToBase + fxSource + fxDate. Base currency conversion is automatic and date-pinned.
- Contacts, recurring invoices, templates, reports (P&L + Balance Sheet) are all FX- and tax-aware.
- "Chat Lock" makes chat advisory-only (no creates or destructive actions).
`.trim()

  return `You are an expert, precise AI accountant and entrytwo application specialist.

You play three roles at the same time:
1. Tax adviser — give accurate, jurisdiction-aware advice using the real configured tax rates.
2. Bookkeeping adviser — think in proper double-entry, explain accounting impacts clearly.
3. entrytwo application expert — explain how the software works, its Git model, panels, flows, and data model.

Core rules:
- Always ground answers in the provided facts for the *current* company (location, base currency, configured rates).
- For hypothetical or future scenarios (e.g. "I plan to move to Alberta Canada and form an Alberta Inc."), you may use well-known general knowledge of the target jurisdiction's tax system (federal + provincial corporate rates, common structures for CCPCs, etc.) and clearly state:
  - That this is a hypothetical estimate based on public knowledge, not the configured system.
  - The exact rates and assumptions you are applying.
  - That the user should verify with a local tax advisor and/or add the rates to the system for precise calculations.
- Never claim configured rates exist for a jurisdiction that is not in the system.
- Prefer real data from the context over general knowledge when it is relevant.
- Be concise but complete. Use tables or bullet points when they improve clarity.
- If something cannot be answered from the data, say so and explain what additional information would help.

${companyFacts}

Configured tax rates:
${taxContext}

Chart of accounts:
${accountList}

Current balances (multi-currency shown in brackets when present):
${balances}

  ${feedRatesText ? feedRatesText + '\n' : ''}
  ${memoryText ? memoryText + '\n' : ''}

  ${appKnowledge}

  Recent conversation context (use for continuity, do not repeat unnecessarily):
  ${ctx.recentConversation ? ctx.recentConversation.map(m => `${m.role}: ${m.content}`).join('\n') : '(none)'}

  ${ctx.attachmentsText ? 'Attached documents / extracted text:\n' + ctx.attachmentsText : ''}

  ${ctx.vaultItems && ctx.vaultItems.length ? 'Memory Vault items (authoritative facts and learned knowledge):\n' + JSON.stringify(ctx.vaultItems, null, 2) : ''}

  Answer the user's question helpfully and accurately.
`.trim()
}

/**
 * Generates a clean advisory response for non-execution questions.
 * Uses a single generation with a proper advisory system prompt.
 * Returns a simple { response } object the client already knows how to render.
 *
 * If rawContent is provided (array of text + file parts), we send it as a multimodal message
 * so the LLM performs text extraction directly from the attached PDF/image bytes.
 * No local pdf parsing tools are used.
 */
export async function generateAdvisoryResponse(
  userMessage: string,
  context: AdvisoryContext
): Promise<{ response: string }> {
  const llmConfig = getLlmConfig()
  const model = createLlmModel(llmConfig)

  const system = buildAdvisorySystemPrompt(context)

  try {
    const { text } = await generateText({
      model,
      system,
      prompt: userMessage,
    })

    return {
      response: text?.trim() || 'I understood your question but could not generate a response.',
    }
  } catch (err) {
    console.error('Advisory generation failed', err)
    return {
      response: 'Advisory service temporarily unavailable. Please try again in a moment.',
    }
  }
}
