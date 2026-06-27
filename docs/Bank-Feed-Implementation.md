# Bank Feed Implementation Plan

## Overview
Connect every bank account in the chart of accounts (including PayPal and Stripe) to their transaction feeds for automatic reconciliation.

## Architecture

### 1. Feed Source Registry

**BankConnection table** - Maps accounts to feed connectors:
- `accountId` → Chart of Accounts ID
- `provider` → 'plaid' | 'salt-edge' | 'paypal' | 'stripe' | 'csv' | 'ofx'
- `externalId` → Provider-specific account identifier
- `credentials` → Encrypted connection tokens/API keys
- `lastSyncAt` → Timestamp of last successful sync
- `syncEnabled` → Boolean to pause/resume feeds

### 2. Feed Normalization Layer

All feeds normalize to a standard format:
```typescript
type FeedTransaction = {
  externalId: string        // Provider transaction ID
  accountId: string         // Our Chart of Accounts ID
  date: string              // ISO date
  description: string       // Merchant/description
  amount: number            // Debit positive, credit negative
  currency: string          // ISO 4217
  fxRateToBase?: number     // Exchange rate at transaction time
  rawData: Record           // Original provider data for matching
}
```

### 3. Connector Strategies

#### PayPal Integration
- **Webhook endpoint**: `/api/webhooks/paypal`
- **Auth**: Client ID + Secret stored encrypted
- **Flow**: 
  1. User connects via OAuth in admin interface
  2. Webhook receives payments/fees instantly
  3. Matching runs immediately on receive
- **Scope**: `https://uri.paypal.com/services/transactions.basic`

#### Stripe Integration
- **Webhook endpoint**: `/api/webhooks/stripe`
- **Auth**: Secret key (sk_live or sk_test)
- **Flow**:
  1. User enters API key (stored encrypted)
  2. Webhook receives charges/refunds/disputes
  3. Automatic match via charge description pattern
- **Objects**: `payment_intent.succeeded`, `charge.refunded`, `charge.dispute.created`

#### Plaid Integration (US/Canada banks)
- **OAuth flow** via server-side token exchange
- **Auth**: Access token + refresh token stored encrypted
- **Sync**: Nightly pull via `/processor_token`
- **Products needed**: Transactions, Auth (for micro-deposits)

#### Salt Edge Integration (EU/Global banks)
- PSD2 compliant (European banks)
- Similar OAuth flow to Plaid
- Supports 5,000+ banks globally

#### Manual CSV Upload
- **Template system**: Pre-built patterns for common banks
- **Column mapping**: Date, description, amount, balance
- **Recurring**: User uploads, system remembers format

### 4. Matching Engine

**Duplicate detection:**
- Same merchant + amount ±0.01 + date ±1 day = duplicate
- User can override matches

**Automatic matching rules:**
1. Merchant alias lookup (user-defined patterns)
2. Amount tolerance matching
3. Pending transaction matching (pre-auth vs final)
4. Split transaction matching (fees vs principal)

**Match UI:**
- Show suggested matches with confidence score
- One-click accept/reject
- Batch accept with filters (all >95% confidence, date range)

### 5. Reconciliation Workflow

```
Feed Transaction → Matching Engine → Suggested Entry
                                    ↓
                        User Review (optional in admin mode)
                                    ↓
                        Auto-post OR Queue for review
                                    ↓
                        Audit trail created
```

### 6. Implementation Phases

**Phase 1: Stripe + PayPal webhooks**
- Fastest ROI (instant transaction data)
- Required: webhook verification, signature checking
- Store stripe/paypal IDs in feed for reconciliation

**Phase 2: Plaid/Salt Edge**
- OAuth flow setup
- Token encryption service
- Background sync scheduler

**Phase 3: Advanced matching**
- Merchant learning from user corrections
- Multi-account feed consolidation
- Pending state handling

### 7. Security Considerations

- All provider tokens in `BankConnection.credentials` encrypted at rest
- Webhook signatures verified (stripe signatures, paypal certs)
- IP allowlisting for known provider IPs
- Rate limiting on sync endpoints

### 8. User-Friendly Key Management

**Connection Status Dashboard:**
- Visual indicators: "Connected ✓" / "Token expired - reconnect required"
- Last sync timestamp visible in admin panel
- Error count with auto-retry status

**Automatic Token Refresh:**
- Plaid tokens: Background rotation before 90-day expiry
- Refresh tokens renewed without user interaction where supported
- Stripe/PayPal webhooks: Use refresh flows for expired credentials

**In-App Notifications:**
- Banner alerts: "Action required: Reconnect your PayPal account"
- Email notifications 7 days before token expiry
- One-click reconnect buttons (OAuth flow embedded)

**Grace Period Handling:**
- Cached transactions remain visible during connection issues
- Manual CSV/PDF upload unaffected during outages
- 30-day reconnect window before full disconnection
- No blocking of core app functionality

### 9. Admin UI

**Connection Management:**
- Connect new feed button per account
- Status indicator (connected, last sync, errors)
- Manual sync trigger
- Disable/enable toggle

**Match Review:**
- Sidebar showing pending suggestions
- Confidence indicators
- Batch actions

### Key Feature: Automatic Reconciliation

This is the core value proposition. When a feed transaction arrives:
1. System finds existing journal entries with matching merchant/amount/date
2. If potential match found, creates suggestion with confidence score
3. Admin can auto-accept all high-confidence matches
4. Audit log tracks all automatic decisions

Example flow:
 ```
 Stripe webhook: $1200 from ACME Corp
 ↓
 Matching finds: No existing entries
 ↓
 Creates suggestion: Debit Stripe account $1200, Credit Revenue $1200
 ↓
 Admin accepts (or auto-accepts if rule matches)
 ↓
 Journal entry created and linked to feed transaction
 ```

 ---

 ## Production Readiness Status

 ### Implemented (Ready for Production):
 - ✅ **Database Schema**: BankConnection and FeedTransaction models with unique constraint on (connectionId, externalId)
 - ✅ **Webhook Receivers**: `/api/webhooks/stripe` and `/api/webhooks/paypal` with signature verification hooks
 - ✅ **Matching Engine**: `lib/matching.ts` - finds existing entries or suggests new ones based on amount/date/merchant
 - ✅ **Transaction Lifecycle**: pending → matched → posted, or pending → ignored
 - ✅ **Encryption Service**: `lib/encryption.ts` - AES-256-GCM for storing provider credentials
 - ✅ **Admin UI**: `/admin/bank-feeds` with connection list, pending transactions table, and match interface
 - ✅ **API Routes**: GET/POST connections, GET transactions, POST match/ignore actions

 ### Required Configuration (Production):
 - [ ] Set `ENCRYPTION_KEY` (64 hex chars) in `.env` for credential encryption
 - [ ] Set `STRIPE_WEBHOOK_SECRET` in `.env` for webhook signature verification
 - [ ] Configure provider API keys via admin UI (currently no form - see below)

 ### Missing for Production Connectors:
 
 #### Stripe/PayPal Webhook Activation:
 - Webhook endpoints receive data but skip signature verification in dev mode
 - Production mode requires `STRIPE_WEBHOOK_SECRET` to be set
 - **Current status**: Works in dev, signature verification code in place but gated

 #### Provider Credential Management:
 - Admin UI shows "Connect Feed" modal but credentials field is empty object
 - No UI for entering OAuth tokens or API keys
 - **Next**: Add credentials input form with encryption display

 #### OAuth Flow (Plaid/Salt Edge):
 - No OAuth connection endpoints implemented
 - No token refresh/renewal logic
 - **Current**: Only Stripe/PayPal webhooks (no OAuth)

 ### Environment Variables Required:
 ```bash
 ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000  # 64 hex chars
 STRIPE_WEBHOOK_SECRET=whsec_xxx   # From Stripe webhook endpoint config
 ```

### Production Checklist:
 1. Configure `.env` with encryption key and webhook secret
 2. Register webhook URLs in Stripe/PayPal dashboards
 3. Test with real provider data
 4. Credentials input now available in admin UI (JSON format)

 ### Production Status Update (Completed):
 - ✅ Credentials input added to admin UI (JSON format)
 - ✅ Encryption auto-applies on connection creation
 - ✅ Stripe webhook extracts billing details and handles multiple event types
 - ✅ PayPal webhook extracts merchant info and validates signature header in production
 - ✅ Raw data captured for debugging/reconciliation