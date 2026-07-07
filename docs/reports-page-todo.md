# Accounting App — Reports Page (Balance Sheet / P&L): To-Do List

## Bug — fix first

- [ ] **Fix inconsistent currency symbols**
  Balance Sheet and P&L mix $ and € on different lines (e.g. Cash shows $, Checking shows €, Loans Payable shows $, but totals mix both). Confirm whether this is a display/formatting bug or an actual multi-currency data issue, and fix before building further reports on top of it.

## Must-haves

- [ ] **Equity section**
  Balance Sheet currently shows Assets and Liabilities but no visible Equity section. Add it — a balance sheet isn't complete without it.

- [ ] **Balance validation indicator**
  Show a clear "✓ Balanced" (or warning) check confirming Assets = Liabilities + Equity, similar to the "Balanced" check already added to journal entries.

- [ ] **Retained earnings / Net Income rollup**
  Confirm current-period Net Income from the P&L automatically flows into Equity on the Balance Sheet. Verify this linkage is actually happening.

- [ ] **Cash Flow Statement**
  Add a third report (Operating / Investing / Financing activities) alongside Balance Sheet and P&L — without it, users can't see *why* cash changed, only the ending balance.

- [ ] **Comparison period**
  Allow comparing to a prior period or prior year (side-by-side columns or a delta/% change). One of the most commonly expected features in financial reports.

- [ ] **Drill-down from report line to ledger**
  Clicking an account line (e.g. "1000 - Cash", "5200 - Utilities") should open that account's ledger view. Reuse the "Open ledger" pattern already built for the Journal.

- [ ] **Export (PDF/CSV)**
  Add export options — needed for sharing with accountants, tax filing, or investors outside the app.

## Important, lower priority

- [ ] **Percentage columns on P&L**
  Show each expense/revenue line as a % of total revenue for quick margin analysis.

- [ ] **Account grouping / subtotals**
  Group Assets into Current vs Fixed, Liabilities into Current vs Long-term, etc., instead of one flat list per section.

- [ ] **Hide zero-balance accounts toggle**
  Option to collapse/hide accounts with €0.00, useful as the chart of accounts grows.

## Nice to have

- [ ] **Date range presets**
  Quick-select buttons: This Month, This Quarter, YTD, Last Year — instead of manually typing From/To every time.

- [ ] **Notes/footnotes support**
  Allow adding context notes to explain unusual figures in a given period.

---

## Suggested Priority Order

1. Fix currency symbol bug
2. Add Equity section + balance validation
3. Cash Flow Statement
4. Comparison period (prior period/year)
5. Drill-down to ledger + Export (PDF/CSV)
6. Percentage columns, account grouping/subtotals
7. Zero-balance toggle, date range presets, notes/footnotes
