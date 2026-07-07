# Dashboard Restructuring Plan

## Bugs — fix first

- [ ] **"Total Assets" KPI shows €0.00 while Chart of Accounts shows €10,077.00 (Cash)**
  These must always agree. Likely the KPI card is reading from a stale/cached aggregate while the Chart of Accounts queries live data. Trace both code paths and make them share one source of truth.

- [ ] **"Journal Entries" KPI shows 0 while "Recent entries" lists 5 visible entries**
  Same class of bug as above — the counter is querying the wrong scope, or not counting the same dataset the journal feed pulls from.

- [ ] **Investigate whether these are the same root cause as the "By currency" double-count bug found on the Reports page**
  If the dashboard and reports both compute aggregates independently, unify into one reporting/aggregation layer to avoid this class of bug recurring on every new page.

---

## Current problem

The dashboard is currently doing the job of 4–5 different pages in one long scroll:
KPI summary → full Chart of Accounts accordion → recent journal entries → P&L snippet → transaction templates → bank feed import → version-control bar.

This makes it slow to scan and duplicates content that already has (or should have) its own dedicated page.

## Target structure (top to bottom)

### 1. Version/branch context bar — expand, don't shrink
- [x] Branch indicator confirmed present globally, across all pages/views
- [ ] Verify it gets a visually distinct treatment (banner color, warning) when NOT on `main` — not just the same style always
- [ ] Show last commit info (who/what, when) inline
- [x] Clear CTA into full Commit History (present via "Browse commit history" button)

### 2. KPI strip — keep, but trim and fix
- [ ] Fix Total Assets / Journal Entries bugs above
- [ ] Keep: Total Assets, Net Income (YTD), Revenue (YTD)
- [ ] Drop "Journal Entries" and "Audit Events" as equal-weight big boxes — demote to small secondary text, not full cards
- [ ] Make clear which branch/version these KPIs reflect if not `main`

### 3. Financial health snapshot (new, compact)
- [ ] One compact row: Assets, Liabilities, Equity, "✓ Balanced" / "✗ Out of balance"
- [ ] Link out to full Reports page — this is a summary, not a duplicate of the full Balance Sheet

### 4. Recent activity (trim existing journal feed)
- [x] Keep "Recent Journal Entries" but cap at ~5 entries — done
- [ ] Add "View all in Journal →" link instead of open-ended scrolling on the dashboard
- [ ] Avoid dashboard and Journal page silently drifting into two different "sources of truth" for recent activity

### 5. Move out entirely (already identified as separate pages)
- [x] Chart of Accounts → own page (done)
- [ ] Bank Feed Import → new Admin/Settings page
- [ ] P&L snippet on dashboard → remove; it duplicates the P&L tab on Reports page
- [ ] Transaction Templates → move to dedicated "Automation" / "Templates & Feeds" settings page

---

## Version-control safety items (apply across dashboard + Commit History page)

- [ ] **Protect `main` from history rewrites** — only fast-forward commits and reversals allowed on `main`; force-push/rewrite only permitted on branches
- [ ] **Merge must re-run the balance check** — if Assets ≠ Liabilities + Equity after a merge, block or flag it before it lands on `main`
- [ ] **Require a diff/preview step before Merge completes** — no one-click merge straight from the dropdown without seeing what's changing
- [ ] **Make tags human-meaningful** — replace auto-generated hash tag names (e.g. `g4-tag-1783411384655`) with labeled, sortable names (e.g. `FY2026-Q2-close`), especially for anything meant to represent a period-end close
- [ ] **Make tags immutable once created** — a tag that can later change defeats the auditor use case
- [ ] **Label ambiguous fields** — e.g. the unlabeled numeric field next to Restore/Reconcile/Preview Restore in Commit History; should be clear whether it's an amount, commit index, or account number

---

## Version-control view consistency — needs work

The branch/commit context bar is not consistent across states. Compare the normal dashboard bar (`main (current official books)` / `Browse commit history` / `Tag this view`) against the bar shown when viewing a specific past commit (`main · commit 2026-07-...` / `Return to current main` / commit date / `Tag this view` / "Safe to experiment — changes do not affect main" / `Restore to this` / `Branch from here`):

- [ ] Unify visual language between "on main, latest" vs "viewing a past commit" vs "on a branch" — right now these look like three different components rather than one bar with states
- [ ] Standardize button set/wording across all three states (e.g. is it always "Tag this view"? is "Return to current main" the same action as "Return to main" elsewhere?)
- [ ] Confirm the "Safe to experiment — changes do not affect main" reassurance message appears consistently whenever the user is off `main`, not just in this one commit-viewing state
- [ ] Decide where `Restore to this` and `Branch from here` should also appear when relevant (e.g. from the Commit History list itself, not only this top bar)
- [ ] This ties into the earlier item: confirm non-`main` states get a visually distinct treatment everywhere the bar appears, using one consistent pattern

## Engineering / quality debt (flagged by coding AI, needs resolution)

- [ ] **Failing Git-Model tests** — indicates the core accounting engine's restore/balance logic is currently broken, or the tests are stale. Resolve which it is before building further on top of the Git model; this could mask real correctness bugs in restore/balance behavior.
- [ ] **Heavy `any` usage will block a strict CI gate** — lint debt is concentrated in `lib/` helpers. Needs cleanup before a strict TypeScript/lint CI gate can be enabled.
- [ ] **i18n foundation claims "100% externalized" but only `en` locale exists** — no locale fallback coverage yet. Either add a second locale to actually test fallback behavior, or correct the "100% externalized" claim until fallback is verified.



## Suggested Priority Order (remaining work)

1. Resolve failing Git-Model tests (correctness risk — do first, before more Git-model UI work)
2. Fix Total Assets / Journal Entries KPI bugs
3. Unify version-control bar across main/branch/past-commit states
4. Verify non-`main` states get visually distinct warning treatment everywhere consistently
5. Financial health snapshot (Assets/Liabilities/Equity/Balanced)
6. Add "View all in Journal →" link on trimmed Recent Activity feed
7. Remove P&L snippet from dashboard (duplicates Reports page)
8. Move Bank Feed Import to new Admin/Settings page
9. Move Transaction Templates to dedicated "Automation" / "Templates & Feeds" settings page
10. Version-control safety items (main protection, merge balance-check, tag immutability/labeling)
11. Clean up `any` usage in `lib/` to unblock strict CI lint gate
12. Add second locale (or correct "100% externalized" claim) to get real i18n fallback coverage

### Already done
- Chart of Accounts moved to own page
- Recent Journal Entries capped at ~5 on dashboard
- Branch indicator present globally across pages
- CTA into Commit History present