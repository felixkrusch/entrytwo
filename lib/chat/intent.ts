// lib/chat/intent.ts
// Comprehensive intent schema and classification for autonomous AI execution via chat.
// See docs/Autonomous-AI-Execution-Plan.md for full taxonomy and rules.

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Core Action Types (strict enum - model must output one of these)
// ---------------------------------------------------------------------------
export const ActionType = z.enum([
  // Safe autonomous (high confidence + validation passes -> execute)
  'CREATE_JOURNAL',
  'APPLY_TEMPLATE',
  'CREATE_CONTACT',
  'UPDATE_CONTACT',
  'CREATE_INVOICE_DRAFT',
  'GENERATE_RECURRING_DRAFT',
  'MATCH_FEED_TRANSACTION',
  'SYNC_FEED',
  'IMPORT_FEED_CSV',
  'RECONCILE_ACCOUNT',
  'LEARN_MERCHANT',
  'OPEN_LEDGER',
  'EXPLAIN',

  // Always propose / require explicit confirmation (never auto-execute)
  'PROPOSE_RESTORE',
  'PROPOSE_MERGE',
  'PROPOSE_REVERSE',
  'PROPOSE_TAG_CLOSE',
  'PROPOSE_SEND_INVOICE',
  'PROPOSE_CHARGE',
  'PROPOSE_BULK_REVERSE',
  'PROPOSE_IMPORT_BACKUP',

  // Master data / config - hard blocked from autonomous execution
  'PROPOSE_CREATE_ACCOUNT',
  'PROPOSE_UPDATE_TAX_RATE',
  'PROPOSE_UPDATE_SETTINGS',
  'PROPOSE_USER_CHANGE',

  // Explicit defer / unknown
  'SUGGEST_ONLY',
])

export type ActionType = z.infer<typeof ActionType>

// ---------------------------------------------------------------------------
// Parameter schemas per action (kept minimal but sufficient for execution)
// ---------------------------------------------------------------------------
const JournalLine = z.object({
  accountCode: z.string(),
  debit: z.number().min(0),
  credit: z.number().min(0),
  description: z.string().optional(),
  taxRateId: z.string().optional().nullable(),
  currency: z.string().optional(),
  fxRateToBase: z.number().optional().nullable(),
  fxSource: z.string().optional().nullable(),
  fxDate: z.string().optional().nullable(),
  contactId: z.string().optional().nullable(),
})

const CreateJournalParams = z.object({
  description: z.string().optional(),
  date: z.string().optional(), // ISO or yyyy-mm-dd
  lines: z.array(JournalLine).min(2),
  merchant: z.string().optional(),
})

const ContactParams = z.object({
  name: z.string().min(1),
  type: z.enum(['CUSTOMER', 'VENDOR']).optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  addressStreet: z.string().optional(),
  addressCity: z.string().optional(),
  addressCountry: z.string().optional(),
})

const InvoiceDraftParams = z.object({
  contactName: z.string().optional(),
  contactId: z.string().optional(),
  description: z.string(),
  amount: z.number().positive().optional(),
  currency: z.string().optional(),
  lines: z.array(z.object({
    description: z.string(),
    quantity: z.number().positive().optional(),
    unitPrice: z.number(),
    taxRateId: z.string().optional(),
  })).optional(),
})

const RecurringGenerateParams = z.object({
  recurringId: z.string().optional(),
  contactId: z.string().optional(),
})

const FeedMatchParams = z.object({
  feedTransactionId: z.string().optional(),
  externalId: z.string().optional(),
})

const ReconcileParams = z.object({
  accountCode: z.string(),
})

const RestoreParams = z.object({
  target: z.string(), // date or eventId
  branch: z.string().optional(),
})

const MergeParams = z.object({
  sourceBranch: z.string(),
  targetBranch: z.string().optional(),
})

const ReverseParams = z.object({
  originalId: z.string(),
})

const SendInvoiceParams = z.object({
  invoiceId: z.string(),
})

const OpenLedgerParams = z.object({
  code: z.string(),
  from: z.string().optional(),
  to: z.string().optional(),
  search: z.string().optional(),
  branch: z.string().optional(),
  asOf: z.string().optional(),
})

// ---------------------------------------------------------------------------
// Full Intent Schema (single source of truth for model output)
// ---------------------------------------------------------------------------
export const IntentSchema = z.object({
  action: ActionType,
  confidence: z.number().min(0).max(1),
  reasoning: z.string().optional(),
  params: z.union([
    CreateJournalParams,
    ContactParams,
    InvoiceDraftParams,
    RecurringGenerateParams,
    FeedMatchParams,
    ReconcileParams,
    RestoreParams,
    MergeParams,
    ReverseParams,
    SendInvoiceParams,
    OpenLedgerParams,
    z.record(z.string(), z.any()), // fallback for simple or future params
  ]).optional(),
  branch: z.string().optional(),
  asOf: z.string().optional(),
  approved: z.boolean().optional(), // used on confirmation calls
})

export type ChatIntent = z.infer<typeof IntentSchema>

// ---------------------------------------------------------------------------
// Classification tables (server source of truth - never driven only by model)
// ---------------------------------------------------------------------------
export const SAFE_AUTONOMOUS_ACTIONS: ActionType[] = [
  'CREATE_JOURNAL',
  'APPLY_TEMPLATE',
  'CREATE_CONTACT',
  'UPDATE_CONTACT',
  'CREATE_INVOICE_DRAFT',
  'GENERATE_RECURRING_DRAFT',
  'MATCH_FEED_TRANSACTION',
  'SYNC_FEED',
  'IMPORT_FEED_CSV',
  'RECONCILE_ACCOUNT',
  'LEARN_MERCHANT',
  'OPEN_LEDGER',
  'EXPLAIN',
]

export const REQUIRES_EXPLICIT_CONFIRMATION: ActionType[] = [
  'PROPOSE_RESTORE',
  'PROPOSE_MERGE',
  'PROPOSE_REVERSE',
  'PROPOSE_TAG_CLOSE',
  'PROPOSE_SEND_INVOICE',
  'PROPOSE_CHARGE',
  'PROPOSE_BULK_REVERSE',
  'PROPOSE_IMPORT_BACKUP',
  'PROPOSE_CREATE_ACCOUNT',
  'PROPOSE_UPDATE_TAX_RATE',
  'PROPOSE_UPDATE_SETTINGS',
  'PROPOSE_USER_CHANGE',
]

// Hard blocked master data / config actions (chat must never mutate these)
export const MASTER_DATA_ACTIONS: ActionType[] = [
  'PROPOSE_CREATE_ACCOUNT',
  'PROPOSE_UPDATE_TAX_RATE',
  'PROPOSE_UPDATE_SETTINGS',
  'PROPOSE_USER_CHANGE',
]

export function isSafeAutonomous(action: ActionType): boolean {
  return SAFE_AUTONOMOUS_ACTIONS.includes(action)
}

export function requiresConfirmation(action: ActionType): boolean {
  return REQUIRES_EXPLICIT_CONFIRMATION.includes(action) || MASTER_DATA_ACTIONS.includes(action)
}

export function isMasterDataAction(action: ActionType): boolean {
  return MASTER_DATA_ACTIONS.includes(action)
}

// Default confidence threshold (can be made per-action later)
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.85
