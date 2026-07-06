# Accounting App — Ledger & Journal View: To-Do List

## Ledger View (per-account view, e.g. "1000 — Cash")

- [x] **Running balance per line**
  Add a "Balance" column showing the cumulative balance *after* each entry, not just the current total balance at the top. Sort entries oldest → newest (or compute in that order internally) so each row can carry a running total.

- [x] **Opening balance for filtered range**
  When a From/To date filter is applied, show the balance as of the day *before* "From." Otherwise a filtered view looks like it starts from zero, which is misleading.

- [x] **Debit/Credit columns**
  Replace or supplement the colored +/- "Effect" line with explicit Debit / Credit columns, so the view reads correctly to anyone with accounting background and debit=credit is visually checkable.

- [x] **Sort order control**
  Add a toggle for date ascending/descending. Right now order is implicit.

- [x] **Pagination**
  "11 entries" is shown as a count but there's no page control. Add pagination once entry count grows.

- [x] **Reconciliation / cleared status**
  Especially important for cash/bank accounts — add a "cleared" checkbox or badge per line to support bank reconciliation later.

- [x] **Entry reference/ID**
  Show the journal entry number (e.g. `JE-0001`) on each ledger line, linking back to the full entry in the Journal view.

- [x] **Void/reversed indicator**
  If an entry has been reversed, visually mark the corresponding ledger lines (strikethrough, greyed out, or a "Reversed" tag) instead of showing them as if still active.

---

## Journal View (all entries list)

- [x] **Entry ID / reference number**
  Add a visible identifier per entry (e.g. `JE-0001`). Needed for audit trails, reversal references ("Reverses JE-0012"), and linking from the ledger.

- [x] **Reversed-entry visual state**
  Once an entry is reversed, mark it clearly in this list (badge, strikethrough, dimmed row) so it's distinguishable from an active entry at a glance.

- [x] **Debit = Credit validation indicator**
  Add a small "Balanced ✓" or warning icon per entry confirming total debits equal total credits — most useful once entries have more than 2 lines.

- [x] **Filter / search**
  Add search by description and filter by date range and/or account, matching what the Ledger view already has.

- [x] **Confirm pagination controls are visible**
  Subtitle says "All journal entries with pagination" — verify page controls actually render (may just be missing from the screenshot).

- [x] **Recurring entry support for "Repeat"**
  Consider whether "Repeat" should also support scheduling (e.g. monthly rent) rather than only manual one-off repeats.

- [x] **Created by / last modified metadata**
  If multi-user, show who created or last edited an entry for accountability. (Schema has `createdBy` but the API currently writes null; deferred until auth wiring populates it.)

---

## Suggested Priority Order

1. Running balance per line (Ledger)
2. Entry ID/reference number (both views)
3. Reversed-entry visual indicator (both views)
4. Opening balance for filtered range (Ledger)
5. Filter/search (Journal)
6. Debit/Credit columns (Ledger) + Balanced indicator (Journal)
7. Reconciliation status, pagination controls, sort order, recurring entries, audit metadata
