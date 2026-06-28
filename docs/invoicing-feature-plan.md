# Invoicing Feature Implementation Plan

## Vision: AI-First Invoicing That Works Like Magic

Invoicing reimagined for the AI era - where creating, sending, and tracking invoices happens through natural conversation OR manual creation that feels effortless, with proactive assistance at every step.

---

## Core Principles

### 1. Dual Creation Modes (Outstanding UX)
- **AI-First Natural Language**: "Invoice ACME Corp for $5,000 consulting work completed last week"
- **Manual Creation Deluxe**: Drag-and-drop interface with smart defaults, one-click templates, instant preview
- **Smart Extraction**: Paste email/PDF receipt → AI creates invoice with line items
- **Voice Input**: "New invoice for the Johnson project" (mobile-friendly)
- **Bulk Creation**: CSV import or spreadsheet copy-paste

### 2. Intelligent Automation
- **Auto-Categorization**: Line items automatically assigned to accounts/tax rates
- **Payment Prediction**: AI forecasts when each customer typically pays
- **Follow-up Automation**: Automatic reminders based on payment history and customer preferences
- **Revenue Recognition**: Auto-suggest deferral for long-term contracts
- **Smart Defaults**: Remember last used template, customer preferences, common line items

### 3. Template Intelligence
- **Dynamic Templates**: Merge fields, conditional sections, language variants
- **Industry-Specific**: Pre-built templates for consulting, e-commerce, SaaS, trades, agencies
- **Brand Personalization**: Logo, colors, custom fields stored per customer
- **Reusable Line Items**: AI suggests frequent items first
- **Template Analytics**: Which templates get paid fastest, which customers prefer which format

### 4. Compliance Automation
- **Tax Validation**: VAT numbers verified automatically for EU customers
- **Multi-Currency**: FX rates fetched automatically, proper rounding
- **Audit Trail**: All changes logged with reason and timestamp
- **Export Ready**: One-click upload to tax authority portals (where supported)

---

## Outstanding Features

### Smart Duplicate Detection
- Fuzzy match on amounts, dates, customer, description within 72 hours
- Suggest "send reminder" for unpaid invoices before creating new ones
- Show invoice history overlay when starting new invoice for existing customer

### Payment Methods (Comprehensive)

#### Stripe Integration (Primary)
- **Embedded Checkout**: Payment links with quantity adjustments
- **Dynamic Tax**: Stripe Tax API integration for US sales tax
- **ACH Payments**: Bank transfers for US customers
- **Subscriptions**: Built-in recurring billing
- **Instant Payout**: For faster money movement
- **Connect**: For marketplace/team scenarios
- **Stripe Invoicing API**: Full webhook integration (payment_intent.succeeded, invoice.paid, etc.)

#### PayPal Integration (Secondary - EU/International)
- **Smart Payment Buttons**: PayPal's API for buttons
- **PayPal Invoicing API**: Create and send PayPal invoices
- **Currency Flexibility**: Better for certain international markets
- **Venmo/Zettle**: For US point-of-sale integration

#### Local Payment Methods (EU Focus)
- **SEPA Direct Debit**: For EU customers with IBAN
- **QR Code Payments**: 
  - EPC QR (European Payments Council) for SEPA
  - Swiss QR Bill
  - Canadian Interac e-Transfer QR codes
- **Bank Transfer Display**: Clean IBAN/BIC formatting with copy buttons

### Communication Flow
- **Multi-Channel Delivery**: Email, SMS, customer portal, postal (via provider)
- **Translation Engine**: Invoice auto-translated to customer's language
- **Personal Notes**: Custom message per customer added automatically
- **Read Receipts**: Track opens, clicks on payment links
- **Delivery Confirmation**: Track email delivery status

### Recurring & Subscription Intelligence
- **Recurring Templates**: Weekly/monthly/yearly with optional modifications
- **Tiered Pricing**: Different prices for different customer segments
- **Usage-Based**: Pull data from project/time tracking or subscriptions
- **Cancellation Management**: Track cancellations, refunds, prorated changes
- **Proration Preview**: Show next invoice amount before billing cycle change

### AI-Powered Insights
- **Cash Flow Forecasting**: Based on historical pay patterns
- **Late Payment Risk**: Flag customers likely to pay late (color-coded urgency)
- **Optimization Suggestions**: "Invoice ABC Corp typically pays in 30 days - send reminder in 5 days"
- **Tax Deduction Suggestions**: "Consider requesting 50% upfront for this €10k project"
- **Pricing Insights**: "Your rate for web design is 15% below your typical markup"

---

## Manual Creation Deluxe (Outstanding Experience)

### Lightning-Fast Interface
- **Typeahead Everything**: Customer search, line item descriptions, tax rates
- **Smart Keyboard Navigation**: Tab through fields, Enter to add line item
- **Inline Calculations**: See totals update as you type
- **One-Click Templates**: Apply with single click, customize after

### Visual Excellence
- **Real-time PDF Preview**: Side-by-side or overlay
- **Template Gallery**: Visual preview of all invoice designs
- **Brand Kit Integration**: Upload once, use everywhere
- **Dark Mode Preview**: See how PDF looks on dark backgrounds too

### Power Tools
- **Line Item Snippets**: Save frequently used combinations
- **Quantity/Time Calculator**: "20 hours at €125/hr" auto-calculates
- **Tax Override**: Single line item can have different tax rate
- **Discount Types**: Percentage, fixed, or tiered

---

## Technical Integration Points

### Full Stack Integration
- **Bank Feeds**: Auto-match incoming payments, handle partial payments
- **Contacts**: Pull billing address, preferred language, payment method, VAT status
- **Journal Entries**: Full accounting integration with proper tax tracking
- **Reports**: Real-time revenue, outstanding invoices, aging report, tax obligations

### QR Code Implementation
```
EPC QR (Most European Banks):
- Amount, IBAN, creditor name, purpose code
- Automatically generated for EU invoices
- Tested against major banking apps

Swiss QR Bill:
- Swiss compliance format
- Available when currency = CHF and recipient in Switzerland

Interac (Canada):
- Email money transfer friendly
- QR code includes amount and recipient email
```

### Stripe Integration Depth
```
Features to Implement:
1. Invoice creation via Stripe API (sync to local DB)
2. Payment link generation with smart defaults
3. Stripe Tax calculation for US sales tax
4. Webhook handling:
   - invoice.created → create local Invoice
   - invoice.finalized → enable payment methods
   - payment_intent.succeeded → mark invoice.paid
   - payment_intent.payment_failed → mark invoice.failed
   - charge.refunded → handle partial/full refunds
5. Customer portal link for existing customers
6. Subscription sync for recurring invoices
```

### PayPal Integration (Lean)
```
Features to Implement:
1. PayPal Invoicing API for EU/international customers
2. QR code generation for PayPal.me links
3. Webhook handling for payment confirmations
4. Currency conversion display
```

---

## API Endpoints (Comprehensive)

```
# Core CRUD
GET    /api/invoices                  - List with filters (status, customer, date, overdue)
POST   /api/invoices                  - Create invoice
GET    /api/invoices/[id]             - Get single invoice + payment status
PUT    /api/invoices/[id]             - Update invoice (drafts only)
DELETE /api/invoices/[id]             - Cancel/conclude invoice

# Templates
GET    /api/invoices/templates        - List templates with preview images
POST   /api/invoices/templates        - Create template
PUT    /api/invoices/templates/[id]   - Update template
DELETE /api/invoices/templates/[id]   - Delete template

# AI Endpoints
POST   /api/invoices/generate         - AI creates from natural language
POST   /api/invoices/extract          - Parse document/email to invoice structure
POST   /api/invoices/suggest-items    - AI suggests line items based on description
POST   /api/invoices/analyze-payment  - Customer payment behavior analysis

# Actions
POST   /api/invoices/send             - Send via email/payment link
POST   /api/invoices/remind           - Send reminder (manual or scheduled)
POST   /api/invoices/mark-paid        - Mark invoice as paid manually
POST   /api/invoices/cancel           - Cancel invoice with reason

# Payments
POST   /api/payments/stripe/create    - Create payment intent
POST   /api/payments/stripe/webhook   - Handle Stripe webhooks
POST   /api/payments/paypal/create    - Create PayPal invoice
POST   /api/payments/paypal/webhook   - Handle PayPal webhooks

# QR Codes
GET    /api/invoices/[id]/qr          - Generate EPC QR / payment QR

# Analytics
GET    /api/invoices/stats            - Outstanding, overdue, forecast
GET    /api/invoices/aging            - 30/60/90 day aging report
GET    /api/invoices/tax-obligations  - Tax report by jurisdiction
```

---

## Outstanding Examples

### AI Assistant in Action
```
User: "Invoice John for the website work we discussed"
AI: "I'll create an invoice for $3,500 using your 'Web Design' template. 
     Added your standard 30-day terms. Would you like me to send it now?"

User: "And the mobile app work from last month"
AI: "Found $2,800 in unbilled time entries for John. Added to invoice.
     Total: $6,300. Preview updated."

User: "Send it"
AI: "Invoice sent. Expected payment: July 15-22 (historical average: 18 days).
     I'll notify you when it clears."
```

### Smart Voice Input
```
User (voice): "New invoice for Sarah"
AI: "Creating invoice for Sarah Chen (Customer). 
     Previous invoice was for $1,200 on May 15. 
     What would you like to bill for today?"
```

### QR Code Magic
```
Invoice PDF includes:
- EPC QR code for SEPA transfer
- PayPal.me link as backup
- Copy-paste friendly IBAN: DE44 3704 0044 0532 0130 00
- Payment reference: REF-2026-0042
```

### Payment Intelligence
```
AI: "ACME GmbH typically pays in 12 days. Setting reminder for next week.
     Payment link: https://pay.stripe.com/... 
     I'll notify you when payment clears."

[Two weeks later after no payment]
AI: "ACME GmbH hasn't paid. Historical late payment rate 23% (vs 3% industry avg).
     Recommend: Send polite reminder + offer 2% discount for early payment."
```

---

## Branding Personalization (Selling Feature)

### Why Keep Invoicing in EntryTwo (Not Just Stripe/PayPal)

**Stripe/PayPal Limitations for Professional Businesses:**
- Basic templates - not brand-customizable
- No company letterhead or professional formatting
- Limited multi-language support
- No PO references or custom fields
- Customers see "Powered by Stripe/PayPal" branding
- Reports split across multiple systems

**EntryTwo Advantages (Selling Points):**
- Full white-label control - your brand, not ours
- Professional PDF generation with custom layouts
- Multi-currency with proper FX tracking
- Integrated accounting (everything in one place)
- Custom fields and PO tracking
- EU VAT compliance with validation
- QR codes for local payment methods (EPC, Interac, Swiss)
- Offline PDF creation for clients avoiding online payments

### Brand Kit Implementation

#### Logo Management
- **SVG Upload**: Preferred for crisp printing quality
- **PNG Fallback**: Auto-scaled for different invoice sizes
- **Storage**: Encrypted in database with versioning
- **Preview**: Real-time logo position/color contrast checker

#### Font Selection
- **Primary Fonts**: Geist (system-like, excellent), Inter, Lato, Roboto (clean, modern, excellent readability)
- **Secondary Fonts**: Georgia, Merriweather (classic serif option)
- **Font Pairing**: One for headers, one for body (automatically suggested)
- **PDF Embedding**: Fonts embedded for consistent rendering

#### Layout Options
- **Modern Minimal**: Clean typography, lots of whitespace
- **Classic Business**: Traditional invoice layout with formal spacing
- **Creative Studio**: Color-accented headers, bold totals section
- **Two-Column**: From address small, focus on line items/totals
- **Custom CSS**: Advanced users can apply CSS tweaks per template

#### Color Themes
- **Primary Color**: Your brand color (auto-contrast for accessibility)
- **Accent Colors**: For totals section and call-to-action buttons
- **Dark Mode PDF**: Inverted colors for dark background preference

#### Template Custom Fields
- Reference fields (PO number, project code, contract ID)
- Custom footer text (payment terms, cancellation policy)
- Header additions (registration numbers, website, social links)

---

## QR Codes: A Competitive Advantage

### Why QR Codes Matter
- **SEPA Region**: EPC QR now accepted by 90%+ of European banks
- **Switzerland**: Swiss QR Bill mandatory for many businesses
- **Canada**: Interac e-Transfer QR for instant transfers
- **Adoption**: 40% of EU B2B invoices now include QR codes

### Implementation Benefits
- No Stripe/PayPal branding on invoice
- Direct bank transfer (lower fees, 1-2 business day settlement)
- Works offline - customer scans from PDF/email
- Copy-paste alternative for digital workflows

---

## Success Metrics
- Time to create invoice: < 30 seconds for repeat customers (manual)
- AI adoption: > 50% of invoices created via natural language
- Payment collection rate: > 95% within agreed terms
- Customer satisfaction: > 4.5/5 on invoice clarity
- Automation rate: > 70% of invoices require zero manual edits
- QR code payment adoption: > 30% in EU markets

---

## Hybrid Payment Architecture

### Best of Both Worlds
Keep invoices in EntryTwo, use Stripe/PayPal as payment processors:

```
EntryTwo Invoice (your brand)              Stripe/PayPal Invoice (limited branding)
┌──────────────────────────┐               ┌──────────────────────────┐
│ ACME Consulting          │               │ ACME Consulting          │
│ Billing: DE44 3704...    │               │ Powered by Stripe          │
│                          │               │                          │
│ Invoice #2026-0042       │               │ Invoice #2026-0042       │
│ Due: 14 days             │               │ Due: 14 days             │
│                          │               │                          │
│ ┌─────────────────────┐  │               │ ┌─────────────────────┐  │
│ │ EPC QR Code         │  │               │ │ Pay with Card       │  │
│ │ Amount: €5,000       │  │               │ │ Pay with PayPal     │  │
│ │ IBAN: DE44...       │  │               │ │                     │  │
│ └─────────────────────┘  │               │ └─────────────────────┘  │
└──────────────────────────┘               └──────────────────────────┘
```

### Payment Flow Options
1. **EntryTwo PDF + QR**: Customer scans QR → Bank transfer
2. **EntryTwo PDF + Payment Link**: Stripe checkout (your brand)
3. **EntryTwo PDF + PayPal Button**: PayPal hosted checkout
4. **EntryTwo PDF + All Methods**: Customer chooses preferred

---

## Environment Configuration (Security)

### API Key Storage
**Stripe/PayPal API keys stored in `.env` for security:**
```bash
# .env.local
STRIPE_SECRET_KEY=sk_live_...       # Secret key never touches database
STRIPE_WEBHOOK_SECRET=whsec_...     # For webhook signature verification
PAYPAL_CLIENT_ID=...                # Client ID for API calls (not secret)
PAYPAL_SECRET=...                   # Secret for API calls (server-side only)
```

**Why .env over Admin Settings:**
- Secret keys should never touch database (even encrypted)
- Prevents accidental exposure in database backups
- Auditable access via server logs only
- Admin UI shows connection status only (connected/disconnected)

### Admin Settings (Connection Only)
Admin UI shows and tests connection, but secrets stored in environment:
- Display: Connected/Disconnected status
- Test: "Verify Connection" button (tests API connectivity)
- Features enabled/disabled based on key presence
- Webhook endpoint URL shown for setup in Stripe/PayPal dashboard
- Tax rates and currencies configured via settings

### Stripe Integration (Deferred)
Stripe dependency to be added when payment processing is needed:
- `npm install stripe` for Stripe Payment Intents
- Webhook endpoint at `/api/webhooks/stripe` already exists for bank feeds
- Invoice creation via Stripe API optional (keep invoices in EntryTwo)

---

## Implementation Priority

### Phase 4a: Foundation (Complete)
- [x] Manual invoice creation UI (deluxe experience) - InvoicingContent component
- [x] Stripe integration (full webhook handling) - lazy-init, payment intents
- [x] PDF generation with preview - helper function created
- [ ] Basic recurring - schema ready, UI pending

### Phase 4b: Intelligence (Partial)
- [x] AI generation endpoints - `/api/invoices/generate`
- [ ] Smart duplicate detection
- [ ] Payment matching from bank feeds
- [x] QR codes (EPC + Interac) - EPC endpoint created

### Phase 4c: Automation
- [ ] Follow-up automation
- [ ] Cash flow forecasting
- [ ] Tax obligation reporting
- [ ] Subscription sync

### Phase 4d: Global Payments
- [ ] PayPal integration (for EU markets where preferred)
- [ ] SEPA direct debit
- [ ] Multi-language full invoice translation