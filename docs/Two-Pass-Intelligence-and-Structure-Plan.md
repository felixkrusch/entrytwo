# Two-Pass LLM Intelligence + Exact Structure + Validation Plan

**Status:** Design & planning document. This is the proposed next evolution after the single-intent + dispatcher approach.

**Date:** 2026-07-02

**Related documents:**
- `docs/Autonomous-AI-Execution-Plan.md`
- `docs/Git-Model-for-Accounting.md`
- `docs/Git-Model-Implementation-Plan.md`

---

## 1. Problem Statement (Why the current approach is failing)

Current single-pass forced structured output (`generateObject(IntentSchema)`) + heavy deterministic post-processing has these observed problems:

- The model is used primarily as a brittle classifier/extractor, not for real language intelligence.
- Descriptions, line items, addresses, country codes, casing, and reasonable inference are poor or lost.
- Hard early paths and fast-paths make the system feel 100% deterministic.
- We cannot enumerate every case as the app grows → deterministic layer is unsustainable.
- Full autonomy via tool calling is too unreliable in this domain.
- Result: the system does not save the user tedious work and feels "dumb as a brick".

We over-constrained the model in the name of safety and clean execution.

---

## 2. Core Idea: Two-Pass "Generate Then Canonicalize"

**Pass 1 – Intelligence / Understanding (broad)**
- Open or lightly-guided prompt.
- Goal: understand natural language, clean up messy input, produce good human-facing text (descriptions, notes, addresses), make reasonable inferences, decide roughly what action is needed.
- Output can be free-form text + loose/partial structure. Do **not** force the final rigid schema here.

**Pass 2 – Exact Packing / Structure (narrow)**
- Given the output of Pass 1 + the user message, ask the model to repack the information into one of our **exact, pre-defined schemas**.
- Prompt style is mechanical: "Take only the information present in the draft above. Do not invent. Output valid JSON that matches this schema exactly."
- We provide the precise schema for the chosen action.

**Validation Gate (before any mutation)**
- Schema validation (Zod / safeParse against the concrete sub-schema).
- Business/domain validation (balanced journal, real accounts, valid targets, positive amounts, etc.).
- Policy/safety validation (SAFE_AUTONOMOUS vs REQUIRES_EXPLICIT_CONFIRMATION, chatLocked, master data blocks, confidence threshold).
- Only if all layers pass → hand off to dispatcher for execute vs propose decision.

This separation gives the model room to be smart first, then forces it to be precise second, while the server (not the model) remains the final authority.

---

## 3. Schemas We Already Have (Single Source of Truth)

All action-specific parameter schemas live in:

`lib/chat/intent.ts`

Current schemas (as of now):
- `JournalLine`
- `CreateJournalParams`
- `ContactParams`
- `InvoiceDraftParams`
- `RecurringGenerateParams`
- `FeedMatchParams`
- `ReconcileParams`
- `RestoreParams`, `MergeParams`, `ReverseParams`, etc.
- `OpenLedgerParams`
- Top-level `IntentSchema` (union + `action` + `confidence` + `params`)

**Plan action:**
- Keep these as the contract.
- Export a helper (e.g. `getSchemaForAction(action)`) so the route can retrieve the exact schema to feed to Pass 2.
- The schemas are already used by the dispatcher and validation code — we just need to use them earlier and more strictly in the two-pass flow.

---

## 4. High-Level Flow (Chat Route)

In `app/api/chat/route.ts` (POST handler):

1. Ultra-fast non-LLM paths (data queries, certain reverses) — keep or slim.
2. Pass 1 call (intelligence):
   - Broad system prompt + context (accounts, tax rates, memory, feed rates, company location).
   - Model produces understanding + candidate action (or we derive action).
3. Action selection / classification.
   - If no clear safe action → fall back to legacy suggestion path or plain text streaming.
4. Pass 2 call (exact structure):
   - Look up the precise Zod schema for the action.
   - Second `generateObject` with a very strict "repack faithfully" prompt.
   - Output must match the schema.
5. Validation layer (new or centralized):
   - Structural (Zod).
   - Domain/business (`validateJournalIntent`, `validateContactIntent`, invoice validation, etc.).
   - If any validation fails → return error details + the attempted structure. Do **not** create, do **not** silently propose garbage.
6. Build clean `ChatIntent` and call `dispatchIntent(...)`.
7. Dispatcher (largely unchanged) decides:
   - chatLocked / master data → propose
   - requiresConfirmation action → propose
   - confidence below threshold → propose
   - validation already passed → execute via `exec*` functions (or propose if something still looks wrong)
8. Return response in the shapes the UI already understands (`createdAutonomously`, `suggestion`, `proposedAction`, `openLedger`, etc.).

Non-action messages continue to use `streamText`.

---

## 5. Dispatcher & Validation Changes

`lib/chat/dispatcher.ts`:

- Make validation an explicit, early gate inside or before `dispatchIntent`.
- Every `exec*` function should be able to assume the incoming intent has already passed schema + basic business validation (or re-validate defensively).
- Improve error messages in `DispatchResult` so the UI/chat can surface concrete problems ("unknown account code 9999", "journal not balanced", "country must be 2-letter ISO").
- Keep lenient account resolution in `execCreateJournal` only as a last-resort fallback, and log when used.
- Consider a top-level `validateIntent(intent)` dispatcher that routes to the right validator.

Validation that must happen before any creation:
- Schema compliance
- Business rules (balance, accounts exist, amounts positive, targets reachable, etc.)
- Safety policy (the existing SAFE / PROPOSE tables + confidence + chatLocked)

---

## 6. Prompt Strategy

Two very different prompts:

**Pass 1 (Intelligence)**
- Emphasize understanding the user's words, cleaning language, producing good descriptions, respecting context (company country/region, recent merchants, feed rates).
- Allow the model to produce natural text.
- Ask it to identify the intended action at a high level.

**Pass 2 (Structure)**
- Extremely mechanical.
- "Here is the draft/understanding you produced earlier: [paste]. Here is the exact schema for action `CREATE_INVOICE_DRAFT`: [schema]. Repack only facts that are present. Do not invent values. Output only valid JSON matching the schema."

We should pass the relevant schema (not the giant union) in Pass 2.

Context (account list, tax rates, etc.) is more important in Pass 1; Pass 2 can be narrower.

---

## 7. UI / Response Contract

Intentionally minimal change:

- Keep the existing response shapes the frontend already handles in `app/app/page.tsx`.
- Optionally add an `understanding` or `draftText` field when we return a proposal, so the UI can show the intelligent text the model produced before structuring.
- `handleApproveProposal` path continues to work (sends approved intent back to the same endpoint).

---

## 8. Incremental Rollout Plan

Recommended order:

1. **Journals** (`CREATE_JOURNAL`) — highest pain point today.
2. **Contacts** (`CREATE_CONTACT`, `UPDATE_CONTACT`).
3. **Invoice drafts** (`CREATE_INVOICE_DRAFT`).
4. Reconcile, match feed, apply template, open ledger, explain.
5. The `PROPOSE_*` actions (they already require confirmation).
6. Deprecate or greatly reduce the ultra-early hard regex paths and the old single `generateObject(IntentSchema)` forced path.

For each area:
- Implement two-pass.
- Strengthen the validator for that action.
- Test with the real prompts that currently produce bad output (wrong descriptions, bad country codes, no casing fixes, etc.).
- Only then move to the next area.

---

## 9. Fallbacks & Safety Nets

- If Pass 1 or Pass 2 fails or produces invalid output → fall back to legacy `SuggestionSchema` path or `generateFallback`.
- Keep a small number of deterministic ultra-safe fast paths only for cases where model mistakes are unacceptable (rare).
- `chatLocked` still forces everything to proposal.
- Master data actions remain hard-blocked.
- Destructive actions (`PROPOSE_RESTORE`, `PROPOSE_MERGE`, `PROPOSE_REVERSE`, etc.) still always propose.
- Plan to remove the large shareholder-loan / owner contribution regex hacks once the two-pass flow is reliable for those cases.

---

## 10. Risks & Limitations (Be Honest)

- Two model calls per turn → higher latency and cost.
- Pass 1 and Pass 2 can still diverge (model "forgets" details between calls).
- The model can still produce schema-compliant but semantically wrong data (wrong account, bad description that passes as a string, plausible but incorrect country code that happens to be valid ISO-2).
- Validation is a safety net, not a correctness guarantee. Many fields (description, address lines, memo) have almost no useful schema-level validation.
- Action selection after Pass 1 is still a potential point of failure.
- We may still need a third "repair" step in some cases.
- Full autonomy remains limited by the weakness of reliable structured output from current models.

This approach improves the situation but does not magically make the LLM a perfect bookkeeper.

---

## 11. Observability

- Log Pass 1 output, chosen action, Pass 2 structured result, validation outcome, and final dispatch decision.
- Log when lenient fallbacks inside executors are triggered.
- Consider a lightweight "AI trace" for development/debugging.

---

## 12. Testing Focus

Manual regression on the exact user pain points:
- Creating invoices with good line descriptions and proper country/city casing.
- Shareholder loans / owner contributions.
- Mixed currency transactions.
- Address and contact creation.

Keep `npm test`, build, and lint passing.

---

## 13. File Change Map (Rough)

- `lib/chat/intent.ts` — minor: export schema lookup helper, minor tightening if needed.
- `app/api/chat/route.ts` — major refactor of the POST flow: introduce Pass 1 + action decision + Pass 2 + validation before dispatch. Update prompts.
- `lib/chat/dispatcher.ts` — strengthen validation as an explicit gate; improve error surfacing.
- (Optional) New file `lib/chat/prompts.ts` — or keep prompts well-commented inside the route.
- `app/app/page.tsx` — small / additive only (richer proposal display if we add draft text).
- `docs/Two-Pass-Intelligence-and-Structure-Plan.md` — this document.

---

## 14. Open Decisions Before Implementation

- Exact output shape of Pass 1 (free text + action? small permissive schema?).
- Whether to do a tiny separate action-classifier call or let Pass 1 also emit the action.
- How aggressively to slim down the existing hard fast-paths during the transition.
- Whether to show the Pass 1 "understanding" text to the user even on autonomous execution (or only on proposals).
- Error handling UX when validation fails after Pass 2.

---

## 15. Summary

This plan replaces the "force the model into the final schema on the first shot" strategy with:

**Understand broadly first → pack exactly second → validate rigorously → then decide execute vs propose.**

It re-uses the schemas and dispatcher we already built, adds an explicit validation gate, and gives the model permission to use its language capabilities on the parts that matter (descriptions, cleanup, inference) before we demand mechanical perfection.

We still treat the server + schemas + Git/event model as the source of truth for safety and correctness.

This is the pragmatic next step given the current state of LLM structured output reliability in a complex domain like accounting.

---

**End of plan.**
