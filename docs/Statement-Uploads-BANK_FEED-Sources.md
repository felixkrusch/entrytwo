# Statement Uploads as Authoritative BANK_FEED Sources (PDF + HTML Paste)

**Project:** entrytwo  
**Status:** Detailed Design (pre-implementation)  
**Date:** 2026-07-09 (updated 2026-07-09)  
**Priority:** #1 for bank and credit card feed completeness (highest coverage, lowest maintenance)  
**Scope:** Bank statements, credit card statements (especially Visa, Mastercard, Amex), and similar periodic documents from almost any bank worldwide.

**Primary inputs (in order of importance):**
1. **PDF uploads** of statements the user already downloads — especially Visa and Mastercard credit card statements (the exact place where feeds are broken most often in Xero and similar tools).
2. **Copy-paste of HTML tables** directly from the bank's or card issuer's website into the chat. Many banks show a clean monthly transactions table in the portal; the user just selects and pastes. The LLM is outstanding at extracting structure from this "chaos".
3. (Future) CSV exports from the bank.

The LLM is the parser. This is now the **main path** for credit cards and general banks worldwide. No per-bank live integrations required.

**Related documents:**
- `Stripe-PayPal-Bank-Feeds.md` — structured/live API processing only for the two big processors
- `Stripe-PayPal-Implementation-Plan.md`

We are **not** building broad live bank feeds (Plaid, Salt Edge, per-bank Open Banking, direct Open Banking for dozens of institutions, etc.).

**Strategy:** Statement uploads (PDF + pasted HTML tables) as the general worldwide solution + high-quality structured processing only for Stripe and PayPal.

This combination directly targets the worst "credit card feeds are broken" experience users have in other systems.

---

## 1. Executive Summary

Most businesses receive their most painful and detailed transaction data as **documents**, not clean APIs:

- Credit card statements (Visa, Mastercard, Amex, etc.)
- Bank current account statements
- Brokerage or PayPal "activity" pages

Traditional accounting tools (Xero, QuickBooks, etc.) have a terrible track record here. They either:
- Pull only the final bank debit (losing per-transaction detail), or
- Require fragile CSV imports that still lose FX context and fees.

**entrytwo approach:**  
The user uploads the PDF they already have, **or** (very often the better option) goes to the bank/credit card website, views the transactions for the month, copies the HTML table, and pastes it straight into chat.

The LLM is *great* at finding structure in chaos (PDFs and especially real HTML tables from bank portals). It turns messy documents and pasted tables into clean, correct double-entry with explicit fees and proper FX.

Every extracted transaction becomes a first-class authoritative `BANK_FEED` source (`BANK_FEED:statement:visa-...`, `mastercard-...`, bank name, etc.), fully under the Git model, with provenance.

This is deliberately **not** live bank integration. It is "the document or table the user already has" turned into trustworthy books by AI + our existing safety rails.

---

## 2. Why Credit Card Statements Are the Hardest Case

Credit card statements (especially Visa/Mastercard issued to the business) are where Xero-style systems break most often:

- **Date mismatch**: Transaction date vs posting date vs statement date vs actual bank debit date.
- **Payout vs per-transaction**: The card issuer shows every swipe, but the actual money movement to the bank is often a single "Payment Received" credit days or weeks later.
- **Fees everywhere**: Foreign transaction fees, currency conversion margins (not always shown as a separate rate), cash advance fees, late fees, annual fees — sometimes on the line, sometimes in a summary block.
- **Multi-currency on one statement**: Merchant currency, billed currency, and books base currency can all be different.
- **Merchant name garbage**: "TST* COFFEE 1234 LONDON", "PAYPAL *ACME", location codes, etc.
- **Refunds and disputes**: Negative amounts or separate credit lines that may appear on a later statement.
- **PDF quality**: Many banks serve image-based or poorly tagged PDFs. Columns split across pages. Headers/footers pollute every line.
- **The big payment**: When the user pays the card balance, that single credit clears dozens of prior charges. The system must not double-book or lose the detail.

The result in other tools is usually a mix of:
- Missing fees
- Wrong FX rates (or none)
- Orphan "card payment" entries that don't reconcile to the individual transactions
- Hours of manual cleanup

We want the opposite: upload the June Visa PDF → clean, explainable, auditable entries with authoritative FX.

---

## 3. Input Methods (User-Friendly First)

### 3.1 PDF Upload
- Drag & drop the statement PDF the user already downloaded (full file or selected pages).
- Existing upload + staged receipts + chat attachment infrastructure is reused.
- xAI Files API (PDFs) + vision fallback already supported.
- The file path is stored as `sourcePdfPath` for full provenance.

### 3.2 Copy-Paste HTML Table from Bank / Credit Card Website (Often the Best Source)
This is a **first-class input method** and a major reason statement uploads are now the primary strategy.

Many banks and credit card issuers (Visa, Mastercard, etc.) let the user view the exact transactions for a month as a nice HTML table in the web portal.

Workflow:
1. User goes to the bank/card website.
2. Selects the period (e.g. June 2026).
3. Selects the transactions table (or just the rows).
4. Copies → pastes directly into the entrytwo chat.

The LLM is genuinely excellent at this. It receives real HTML and is very good at finding structure in chaos:
- Real column headers, amounts, dates, merchants, "pending" markers, multi-currency info, fee lines.
- Often produces higher quality extraction than the PDF version of the same statement.
- Zero friction — no file upload required.

**Real example users will do:**
User pastes the HTML table from their Visa or Mastercard portal and says:
"Here are the transactions from my business Visa for June"

Trillion parses every line, correctly separates the big payment back to the card issuer, extracts any FX/conversion rates shown on the statement, and proposes proper journal entries with authoritative `fxSource: "BANK_FEED:statement:visa-..."` or `mastercard-...`.

This works for a huge number of banks worldwide with **zero per-bank work** on our side. The model does the parsing. We just give it good instructions, validation, and the Git model safety net.

This is one of the highest-leverage places where "the LLM is great at finding structure in chaos" directly solves a problem that has been painful in accounting software for years.

### 3.3 Other (Future)
- CSV exports from the bank
- Screenshots (vision)

We are deliberately **not** chasing live feeds for general banks.

### 3.3 Future / Nice-to-Have
- CSV exports from the bank
- Screenshot images of statements (vision)
- Direct "export this period" buttons if banks ever expose better structured data

We deliberately do **not** pursue live Open Banking / Plaid / Salt Edge connections for general banks at this stage.

---

## 4. LLM as the Parser — Strengths and Guardrails

The LLM is *excellent* at finding structure in chaos (this is one of its superpowers here):

- It can parse multi-column statements, wrapped text, mixed languages, and ugly PDFs.
- It can spot "1.0872" next to a foreign amount and understand it is the issuer's conversion rate.
- It can distinguish the big "Payment to [Card Issuer]" credit from the individual merchant charges.
- It can associate fee lines with the transactions above them.
- When a user pastes a raw HTML table from the bank's website (which many banks expose cleanly for the current month), the model often extracts it *more accurately* than traditional parsers ever could.

This is why statement uploads (especially PDF + direct HTML paste) are now our #1 strategy for credit cards and general banks. The model turns messy real-world documents into clean, authoritative `BANK_FEED` data.

**Non-negotiable guardrails** (these live in prompts + server validation):

- Every extracted item must have at minimum: date, description/merchant, amount + currency (original if shown), billed amount if different.
- Explicit fee lines when the statement shows them.
- FX rate + date when the statement provides one → must be marked `BANK_FEED:statement:...`.
- Never invent rates. If the statement does not show a usable rate, fall back to asking the user or using a previous authoritative feed rate.
- Always preserve a link back to the source (PDF path or "pasted from [bank] on [date]").

After the model emits a `CREATE_JOURNAL` (or multiple), the normal server validation, lock rules, and Git ancestry still apply exactly as for any other action.

---

## 5. Normalized Shape for Statement Transactions

We want a consistent shape whether the source is a Visa PDF, a Mastercard HTML paste, or (later) a CSV.

Suggested fields (stored in `rawData` or as metadata on the journal lines / FeedTransaction):

- `sourceType`: 'statement-pdf' | 'statement-html-paste' | 'statement-csv'
- `sourceIdentifier`: e.g. 'visa-1234-statement-2026-06', 'mastercard-corp-june2026', or the uploaded filename
- `sourceDateRange`: { from, to }
- `externalRef`: reference number from the statement (if any)
- `merchantRaw`
- `merchantClean` (optional LLM suggestion)
- `originalAmount`, `originalCurrency` (what the merchant charged)
- `billedAmount`, `billedCurrency` (what hit the card)
- `feeAmount`, `feeCurrency`, `feeDescription`
- `fxRateShown`, `fxDateShown` (exactly as printed on the statement)
- `transactionDate`, `postingDate`
- `direction`: 'debit' | 'credit' (from cardholder perspective)
- `type`: 'purchase' | 'refund' | 'fee' | 'payment-to-issuer' | 'cash-advance' | 'interest' | 'adjustment'
- `raw` (full original fragment or row for audit)

All journal lines produced from this must carry:
- `fxSource: "BANK_FEED:statement:visa-...` (or mastercard, amex, bankname-..., etc.)
- `fxRateToBase` and `fxDate` when applicable
- `sourcePdfPath` (for PDFs) or equivalent reference

This makes them first-class authoritative feed rates for the rest of the system (chat, reports, invoice processing).

---

## 6. Journal Entry Patterns for Statements (Especially Credit Cards)

### 6.1 Typical Foreign Purchase with Fee
```
Dr 5200 Office Supplies (or relevant expense)          84.00 EUR   (net)
Dr 5201 Foreign Transaction Fees                       2.50 EUR
Cr 2100 Credit Card Payable (or Clearing)             86.50 EUR
```
With the original USD amount + issuer FX rate captured in the credit line (or via the feed metadata).

### 6.2 Card Payment (User Pays the Issuer)
```
Dr 2100 Credit Card Payable                          2,450.00 EUR
Cr 1010 Bank Account                                 2,450.00 EUR
```
This should be linkable (via description or metadata) to the prior charges it cleared, but it is a separate entry.

### 6.3 Annual Fee
```
Dr 5800 Bank & Card Fees                               99.00 EUR
Cr 2100 Credit Card Payable                            99.00 EUR
```

### 6.4 Refund from Merchant
```
Dr 2100 Credit Card Payable                           -120.00 EUR
Cr 5200 Office Supplies (or relevant)                 -120.00 EUR
```

All of the above must respect multi-currency when the statement is in a different currency from the books.

---

## 7. Provenance and Auditability

- For PDF uploads: `sourcePdfPath` on the JournalEntry (and visible in the journal UI).
- For pasted HTML: store a short reference + timestamp in the Event payload and/or a `FeedTransaction.rawData`.
- The user (and auditor) must be able to answer: "Where did this line come from?" → "June 2026 Visa statement PDF uploaded 2026-07-03" or "Pasted from HSBC business portal on 2026-07-05".
- The Git ancestry already gives full history of when it was committed and by whom (or by AI).

---

## 8. Git Model & Safety Invariants (Unchanged)

Exactly the same rules as for Stripe/PayPal and manual entries:

- Every mutation creates an `Event`.
- `parentEventId` + branch head advancement via `recordCommitOnBranch`.
- `introducedByEventId` on the JournalEntry.
- Respect `chatLocked` (proposals only when locked).
- Server validation always runs (balanced after FX, real accounts, etc.).
- Restore and merge continue to work.

Statement-derived entries are **not** second-class. They are proper `BANK_FEED` sources.

---

## 9. User Experience Goals

- "Drop your June Visa statement here" or "Paste the transactions table from the bank site".
- Chat shows a clear summary: "Extracted 47 transactions + 3 fees + 1 payment from the attached statement."
- High-confidence items can be proposed (or auto-posted if unlocked).
- User can iterate in conversation: "Ignore the annual fee", "Split the FX fee onto its own line", "This merchant is actually Acme GmbH".
- After confirmation, the lines appear in Journal / Ledger with "feed" badge and the source document link.
- Reconciliation reports can reference the statement as the source of truth for that period.

---

## 10. Challenges Specific to Statement Uploads (and How We Handle Them)

| Challenge | Mitigation |
|-----------|----------|
| Bad PDF OCR / layout | LLM + vision is surprisingly robust; user can correct in chat or re-upload better pages |
| Duplicate uploads | ExternalId-like key from (date + amount + merchant + statement identifier) + server dedup |
| "Pending" transactions | Extract them but mark status so they are not auto-posted; user can re-process later |
| The big card payment vs individual charges | Explicit type detection + clear UI language ("This credits the card balance") |
| FX rate hidden in the statement | Instruct model to look for "rate", "conversion", "1.08xx" near foreign amounts |
| Partial uploads (only 2 pages) | Model must declare the date range it believes it processed |
| User wants "simple" vs "detailed" | Future toggle; for now always produce explicit fee lines (safer) |

The proposal flow + "Review & Confirm" button is the main safety net.

---

## 11. Relationship to Stripe and PayPal

- Sometimes a user receives both:
  - Structured data from Stripe (the processor)
  - A credit card statement from the card issuer (Visa/MC) that shows the same charges + the payout to the bank
- These are **different sources**. We should allow both and let the user (or reconciliation) decide which is authoritative for FX and timing.
- Prefer the most direct authoritative rate. A card statement FX rate is often what actually hit the books.
- Never double-book the same economic event.

---

## 12. How This Fits the Overall Bank Feeds Strategy (Updated 2026-07-09)

Agreed priority:

1. **Statement uploads (PDF + HTML copy-paste from bank portals)** ← this document  
   This is now the #1 path for bank accounts and especially credit cards (Visa, Mastercard, etc.).  
   Highest worldwide coverage, near-zero per-bank maintenance. The LLM is excellent at turning messy PDFs and pasted HTML tables into correct double-entry with authoritative FX.

2. **Stripe + PayPal structured feeds** (APIs + webhooks) — see `Stripe-PayPal-Bank-Feeds.md`  
   Only for these two high-volume processors. Live/structured sources, not document uploads.

3. Structured file imports (CAMT.053, OFX, clean CSV) — future work that can share normalization logic.

4. One good US aggregator (Plaid) and/or one European — only if specific high-volume users demand always-on live feeds. Not required for general coverage.

**We are not doing** per-bank live connections or broad Open Banking work. The combination of excellent statement uploads + reliable Stripe/PayPal processing solves the classic "credit card feeds are broken" problem far more effectively than chasing live integrations.

---

## 13. Implementation Considerations (High Level, No Code Yet)

- Extend the existing chat attachment + staged receipt flow to treat bank statements as a first-class input type.
- Create a dedicated skill (`.grok/skills/actions/extract-statement` or similar) that gives the model precise instructions for statement extraction.
- Normalize extracted data into the shape described in §5 before emitting `CREATE_JOURNAL`.
- Mark every line with the correct `BANK_FEED:statement:...` fxSource.
- Store provenance (PDF path or paste reference).
- Add UI affordances: "This came from statement PDF" badge, link to source, easy re-extraction.
- Reuse the existing validation, proposal, and Git commit machinery — do not create a parallel path.
- Consider a lightweight "FeedTransaction" record even for statement uploads so the reconciliation engine can see "pending" vs "posted" items from the document.

---

## 14. Success Criteria

Before we consider statement uploads "done":

- User can upload a real Visa/Mastercard PDF statement (messy, multi-page, multi-currency) and get a clean set of proposals.
- Pasted HTML table from a bank portal produces equivalent quality.
- Fees and FX rates shown on the statement are captured and marked authoritative.
- The card payment line is correctly separated from the merchant charges.
- All entries respect the Git model and appear correctly in reports and reconciliation.
- User reports that credit card reconciliation is dramatically less painful than in Xero or similar.

---

## 15. Risks & Mitigations

- LLM hallucinates amounts or dates → Server validation + user confirmation step + raw source link.
- User uploads the wrong period → Model declares date range; user sees it before confirming.
- Duplicate work from re-uploads → Deduplication keys + "already have this" warnings.
- Over-extraction of "pending" items → Status handling + user can ignore.

---

## 16. Open Questions

- Should we create a `FeedTransaction` row even for pure LLM-extracted statement items (recommended for consistency)?
- How do we handle "this statement supersedes a previous upload"?
- Do we want an explicit "Re-extract from this statement" action on existing entries?
- Should pasted HTML be stored as a temporary artifact (like uploaded files) for audit?
- How explicit do we want the model to be about "I read pages 2-5 of the PDF" or "I parsed the HTML table pasted on 2026-07-09"?

---

## 17. Why This Approach Wins for Credit Cards and General Banks

- Works for **almost any bank in the world** the moment the user can download a PDF or view a transactions table.
- No per-bank API keys, consents, token refresh, or aggregator costs.
- The LLM is genuinely strong at "finding structure in chaos" — both ugly PDFs and real HTML tables from bank websites.
- Every extracted rate becomes an authoritative `BANK_FEED:statement:...` source, exactly like we want for FX.
- Full provenance via uploaded file or paste reference + Git model history.
- Fits the "AI does the drudgery, humans review exceptions" philosophy perfectly.

This is the main path. Stripe and PayPal structured processing is the valuable complement for those two processors.

---

**This document is the design authority for statement/PDF/HTML bank and credit card feed work.**

It is now the **primary** track.  
`docs/Stripe-PayPal-Bank-Feeds.md` is the secondary, processor-specific track (structured APIs only).

We will start implementation only after review and agreement.
