# Billing & Invoicing

**Read this when:** Working on invoice generation, markup rules, SFTP file processing, or billing workflows.

---

## Invoice Generation Flow

```
ShipBob Weekly Invoices → Sync to invoices_sb → Admin Review → Generate Draft → Approve → Mark Transactions
```

1. **ShipBob closes invoices** - Every Sunday at 23:59:59
2. **sync-invoices cron** - Syncs invoice metadata to `invoices_sb` table
3. **Admin reviews preflight** - `/api/admin/invoices/preflight` checks data quality
4. **Generate invoices** - `/api/admin/invoices/generate` creates drafts with PDF/XLSX
5. **Approve invoice** - `/api/admin/invoices/[id]/approve` marks transactions as billed

---

## CRITICAL: ShipBob Invoice Structure

**ShipBob invoices contain ALL clients' transactions together in a single invoice.**

This is a common point of confusion. Here's how it actually works:

| Invoice Type | Contains | Example |
|--------------|----------|---------|
| **ShipBob Invoice** (`invoices_sb`) | ALL clients' transactions for that week | `invoice_id_sb = 8693044` has Henson, Methyl-Life, and all other clients' charges |
| **Jetpack Invoice** (`invoices_jetpack`) | Single client's transactions only | `JPHS-0038-120825` = only Henson Shaving charges |

**Why this matters:**
- Transaction sync uses parent API token which sees ALL merchants
- Transactions arrive with `invoice_id_sb` but need `client_id` attribution
- **NEVER** assume "all transactions on same `invoice_id_sb` belong to same client" - this is FALSE
- Attribution MUST be done via shipment/order/return lookups, NOT via invoice grouping

**Flow:**
```
ShipBob Invoice (ALL clients) → Our Attribution → Split into per-client Jetpack Invoices
```

---

## Invoice Number Format

```
JP{SHORT_CODE}-{SEQUENCE}-{MMDDYY}
Example: JPHS-0038-120825
```

- `JP` = Jetpack prefix
- `SHORT_CODE` = Client's 2-4 letter code (e.g., "HS" for Henson Shaving)
- `SEQUENCE` = Auto-incrementing per client (`clients.next_invoice_number`)
- `MMDDYY` = Invoice date

---

## Markup Rules

### Rule Selection: "Most Conditions Wins"

Rules are **standalone** (no stacking). If multiple rules match, the most specific one wins.

| Conditions Count | Example |
|------------------|---------|
| 0 conditions | "Standard" = 14% (applies to all) |
| 1 condition | "Standard + Ship Option 146" = 18% |
| 2 conditions | "Standard + Ship 146 + 5-10lbs" = 25% |

### Conditions Counted
- `client_id` specified (vs global rule): +1
- `ship_option_id` specified: +1
- Weight bracket specified: +1

### markup_rules Table

| Column | Type | Description |
|--------|------|-------------|
| `client_id` | UUID | NULL = global rule |
| `fee_type` | TEXT | "Standard", "FBA", "VAS", etc. |
| `ship_option_id` | TEXT | ShipBob ship option ID |
| `billing_category` | TEXT | "shipments", "storage", "returns", etc. |
| `conditions` | JSONB | `{weight_min_oz, weight_max_oz, states, countries}` |
| `markup_type` | TEXT | "percentage" or "fixed" |
| `markup_value` | NUMERIC | 14.0 = 14% or $14.00 fixed |
| `effective_from` | DATE | When rule becomes active |
| `effective_to` | DATE | NULL = currently active |

### Weight Brackets

| Label | Range |
|-------|-------|
| `<8oz` | 0 - 8 oz |
| `8-16oz` | 8 - 16 oz |
| `1-5lbs` | 16 - 80 oz |
| `5-10lbs` | 80 - 160 oz |
| `10-15lbs` | 160 - 240 oz |
| `15-20lbs` | 240 - 320 oz |
| `20+lbs` | 320+ oz |

---

## Billing Categories

| Category | reference_type(s) | Source |
|----------|-------------------|--------|
| `shipments` | Shipment | Shipping charges |
| `shipment_fees` | Shipment | Pick fees, materials |
| `storage` | FC | Warehousing fees |
| `returns` | Return | Return processing |
| `receiving` | WRO, URO | Receiving/inbound |
| `credits` | Default, TicketNumber | Refunds, adjustments |
| `insurance` | Shipment | Insurance charges |

### Storage Billing Schedule

**IMPORTANT:** Storage (WarehouseStorage) is NOT billed every week. ShipBob charges storage fees on some Mondays but not others - the schedule varies. When calculating invoice costs, ALL transaction types including storage must be included based on the billing period dates. Do NOT exclude storage transactions.

---

## Transaction Fields for Invoicing

### From Billing API (synced)
| Field | DB Column | Required |
|-------|-----------|----------|
| Amount | `cost` | Yes |
| Charge date | `charge_date` | Yes |
| Fee type | `transaction_fee` | Yes |
| Invoice ID | `invoice_id_sb` | Yes |
| Client | `client_id` | Yes |

### From SFTP (extras-MMDDYY.csv)
| SFTP Field | DB Column | Purpose |
|------------|-----------|---------|
| `base_cost` | `base_cost` | Base shipping (for detailed breakdown) |
| `surcharges` | `surcharge` | DAS, fuel, etc. |
| `insurance_cost` | `insurance_cost` | Insurance amount |

### Calculated at Invoice Time
| Field | DB Column | Calculation |
|-------|-----------|-------------|
| Markup amount | `markup_applied` | `cost * markup_percentage` |
| Billed amount | `billed_amount` | `cost + markup_applied` |
| Markup rule | `markup_rule_id` | FK to `markup_rules` |

### Set at Approval
| Field | DB Column | Purpose |
|-------|-----------|---------|
| Jetpack invoice ID | `invoice_id_jp` | Links to `invoices_jetpack` |
| Jetpack invoice date | `invoice_date_jp` | When we billed client |
| Invoiced status | `invoiced_status_jp` | TRUE = billed |

---

## Tax Handling (GST/HST for Canadian FCs)

### When Taxes Apply

ShipBob charges **GST (5%)** or **HST (13%)** on transactions from Canadian fulfillment centers:

| Province | Tax Type | Rate |
|----------|----------|------|
| Ontario | HST | 13% |
| British Columbia | GST | 5% |
| Other Canadian | GST/HST | Varies |

**Current Canadian FC:** Brampton (Ontario) 2 → charges 13% HST

### Tax Data Structure

Taxes are stored in the `transactions.taxes` column as JSONB:

```json
[
  { "tax_type": "GST", "tax_rate": 13, "tax_amount": 0.65 }
]
```

### Tax Flow Through the System

```
ShipBob API → sync-invoices/sync.ts → transactions.taxes (JSONB)
                    ↓
      collectBillingTransactions() → extractTaxInfo() → InvoiceLineItem.taxType/taxRate/taxAmount
                    ↓
              generateSummary() → taxBreakdown aggregation
                    ↓
         PDF: Subtotal → Tax Line(s) → Total
         Excel: Conditional Tax Rate/Amount columns
```

### Key Functions

| Function | Location | Purpose |
|----------|----------|---------|
| `extractTaxInfo()` | `invoice-generator.ts` | Extract first tax from array into flat fields |
| `generateSummary()` | `invoice-generator.ts` | Aggregate taxes by type (GST/HST) |
| `InvoicePDF` | `pdf-generator.tsx` | Render tax lines in totals section |

### Excel Tax Columns

Tax columns appear **conditionally** - only if at least one transaction has taxes:

| Sheet | Without Tax | With Tax |
|-------|-------------|----------|
| Shipments | 34 columns | 36 columns (+Tax Rate %, +Tax Amount) |
| Additional Services | 6 columns | 8 columns |
| Returns | 11 columns | 13 columns |
| Receiving | 7 columns | 9 columns |
| Storage | 8 columns | 10 columns |
| Credits | 6 columns | 8 columns |

### PDF Tax Display

Taxes appear in the totals section:

```
Subtotal (before tax)     $ 1,234.56
HST (13%)                 $   160.49
Total                     $ 1,395.05
Amount Due (USD)          $ 1,395.05
```

### Important Implementation Notes

1. **Extract taxes for ALL line item types** - `extractTaxInfo()` must be called for ALL transaction types (Shipping, Storage, Returns, Receiving, Credits, Additional Services, etc.), not just shipping.

2. **Tax aggregation by type** - Multiple tax types (e.g., GST + PST) are aggregated separately in the summary.

3. **Total includes tax** - `summary.totalAmount` is the final amount including all taxes.

4. **Sync preserves taxes** - Both `sync-invoices` and `sync.ts` capture taxes from the API and handle INSERT vs UPDATE correctly to avoid overwriting.

---

## SFTP File Processing

ShipBob provides cost breakdown data via SFTP in **two formats**:

### NEW: Daily Format (Dec 2025+)

**Filename:** `JetPack_Shipment_Extras_YYYY-MM-DD.csv`

**CRITICAL:** SFTP files appear **1 day AFTER** the transaction's charge_date.
- Transactions charged on Dec 27 → appear in Dec 28's file
- Daily cron runs at 5 AM EST (10 AM UTC) to sync today's file (yesterday's charges)

**Columns:**
| CSV Column | Description |
|------------|-------------|
| `User ID` | ShipBob merchant ID |
| `Merchant Name` | Brand name |
| `Shipment ID` | Join key (matches transactions.reference_id) |
| `Fee_Type` | "Base Rate", "Peak Surcharge", etc. |
| `Fee Amount` | Dollar amount |

**Fee Type Classification:**
| Fee_Type | Maps To |
|----------|---------|
| `Base Rate` | `base_cost` |
| Insurance (TBD) | `insurance_cost` |
| Everything else | `surcharge` (aggregated) + `surcharge_details` JSONB |

**Surcharge Details Storage:**

The `transactions.surcharge_details` column (JSONB) stores individual surcharge types:
```json
[
  { "type": "Peak Surcharge", "amount": 0.15 },
  { "type": "Fuel Surcharge", "amount": 0.10 }
]
```

This enables analytics on surcharge types while maintaining backwards compatibility with the aggregated `surcharge` column.

**Daily Sync Cron:** `/api/cron/sync-sftp-costs` at `0 10 * * *` (5 AM EST)

---

### LEGACY: Weekly Format (Before Dec 2025)

**Filename:** `extras-MMDDYY.csv`

The MMDDYY is the **invoice generation date** (Monday AFTER the billing period).

| Billing Period | Invoice Generated | Filename |
|----------------|-------------------|----------|
| Dec 8-14, 2025 | Dec 15, 2025 | `extras-121525.csv` |
| Dec 1-7, 2025 | Dec 8, 2025 | `extras-120825.csv` |

**Fields:**
| CSV Column | DB Column | Notes |
|------------|-----------|-------|
| `OrderID` | `shipment_id` | Join key (NOT order_id!) |
| `Invoice Number` | `invoice_id_sb` | For cross-reference |
| `Fulfillment without Surcharge` | `base_cost` | Base shipping cost |
| `Surcharge Applied` | `surcharge` | DAS, fuel, etc. (aggregated) |
| `Insurance Amount` | `insurance_cost` | Insurance |
| `Original Invoice` | (derived) | base_cost + surcharge |

**Processing Scripts:**
```bash
# Reprocess SFTP for a specific date (legacy format)
npx tsx scripts/reprocess-sftp-breakdown.ts 121525  # Dec 15, 2025
```

---

### Accounting Format for Negative Numbers

SFTP files use **accounting format** for negative amounts (parentheses instead of minus sign):

| Format | Meaning | Parsed Value |
|--------|---------|--------------|
| `$10.27` | Positive | 10.27 |
| `($10.27)` | Negative (refund) | -10.27 |

The `parseCurrency()` function in `lib/billing/sftp-client.ts` handles this automatically.

### Matching Logic

**Daily format (preferred):** Matches by `shipment_id` + `charge_date`
- SFTP file date = charge_date + 1 day
- Handles reshipments correctly (same shipment_id, different dates)

**Weekly format (legacy):** Matches by:
1. `shipment_id` + `invoice_id_sb` + transaction type (charge vs refund) - most specific
2. `shipment_id` + `invoice_id_sb` - fallback
3. `shipment_id` only - last resort

Refund detection: If `base_cost < 0` or `total < 0`, it's a refund row.

### Reshipment Handling

Reshipments create multiple Shipping transactions for the same `shipment_id` on different dates. The SFTP files also contain multiple rows for the same shipment (one per shipping event).

**Example:** Shipment 330867617
- SFTP file 2025-12-23 contains row for Dec 22 charge ($3.95)
- SFTP file 2025-12-27 contains row for Dec 26 reshipment ($3.95)

The daily sync uses `shipment_id:charge_date` as the matching key to ensure each SFTP row updates the correct transaction.

---

## Invoice Tables

### CRITICAL: ShipBob Invoices Contain ALL Clients

**ShipBob invoices (invoice_id_sb) contain transactions for ALL merchants combined, not per-client!**

When querying transaction costs for a specific Jetpack invoice, you MUST filter by BOTH:
1. `invoice_id_sb IN (shipbob_invoice_ids)` - the ShipBob invoices linked to this Jetpack invoice
2. `client_id = <client_id>` - the specific client

Failing to filter by client_id will include other clients' transactions and produce wildly incorrect totals.

### invoices_sb (ShipBob invoices)
| Column | Description |
|--------|-------------|
| `shipbob_invoice_id` | ShipBob's invoice ID |
| `invoice_type` | Shipping, AdditionalFee, Credits, etc. |
| `invoice_date` | When ShipBob created it |
| `base_amount` | Total amount (for ALL clients combined!) |
| `jetpack_invoice_id` | FK to our invoice (NULL = unprocessed) |

### invoices_jetpack (Our invoices to clients)
| Column | Description |
|--------|-------------|
| `invoice_number` | JPHS-0038-120825 format |
| `client_id` | FK to clients |
| `status` | draft, approved, sent, paid |
| `subtotal` | Sum of base costs |
| `total_markup` | Sum of markups |
| `total_amount` | subtotal + total_markup |
| `period_start`, `period_end` | Billing week |
| `shipbob_invoice_ids` | Array of SB invoice IDs included |
| `line_items_json` | Snapshot for regeneration |

---

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/admin/invoices` | GET | List invoices |
| `/api/admin/invoices/preflight` | GET | Pre-generation validation |
| `/api/admin/invoices/generate` | POST | Generate draft invoices |
| `/api/admin/invoices/[id]/approve` | POST | Approve and mark transactions |
| `/api/admin/invoices/[id]/regenerate` | POST | Regenerate draft |
| `/api/admin/invoices/[id]/files` | GET | Download PDF/XLSX |

---

## Preflight Validation

Before generating invoices, preflight checks:

1. **Transaction completeness** - All transactions have required fields
2. **Client attribution** - All transactions have client_id
3. **Markup rules exist** - Matching rules for all fee types
4. **No duplicates** - No transaction already billed
5. **Data quality** - Reasonable amounts, valid dates

---

## Invoice Status Flow

```
draft → approved → sent → paid
         ↓
      rejected (can regenerate)
```

- **draft**: Generated but not finalized
- **approved**: Transactions marked, files locked
- **sent**: Sent to client
- **paid**: Payment received

---

## Payment Methods & Stripe Integration

Clients can pay via **ACH** (default) or **Credit Card** (with 3% fee).

### Payment Method Types

| Method | Fee | Auto-Charge | Setup Required |
|--------|-----|-------------|----------------|
| `ach` | None | No | None |
| `credit_card` | +3% | Yes (on approval) | Stripe customer + payment method |

### CC Setup Flow (Client-side)

1. Client goes to `/dashboard/billing` and clicks "Setup Credit Card"
2. Backend creates Stripe SetupIntent via `/api/stripe/setup-intent`
3. Client enters card in Stripe PaymentElement
4. On success, `/api/stripe/save-payment-method` saves:
   - `clients.stripe_customer_id` - Stripe customer ID
   - `clients.stripe_payment_method_id` - Saved card payment method
   - `clients.payment_method` → `'credit_card'`

### CC Fee Calculation (3%)

When generating invoices for CC clients, a line item is added:

```javascript
{
  feeType: 'Credit Card Processing Fee (3%)',
  billingTable: 'cc_processing_fee',
  lineCategory: 'Additional Services',
  billedAmount: subtotal * 0.03,  // 3% of invoice subtotal
}
```

**Key rule:** CC fee is calculated on the **subtotal** (all other charges), not recursively on itself.

### Auto-Charge Flow (On Invoice Approval)

When admin approves a CC invoice, auto-charge happens if ALL conditions met:

1. Invoice has `Credit Card Processing Fee (3%)` line item
2. Client has `stripe_customer_id` AND `stripe_payment_method_id`

```
Admin clicks "Approve"
    ↓
/api/admin/invoices/[id]/approve
    ↓
Transactions marked as invoiced
    ↓
Check for CC fee + Stripe setup
    ↓
stripe.paymentIntents.create({
  amount: invoice.total_amount * 100,
  customer: client.stripe_customer_id,
  payment_method: client.stripe_payment_method_id,
  off_session: true,
  confirm: true,
})
    ↓
If succeeded: Update invoice paid_status='paid', paid_at, stripe_payment_intent_id
If failed: Invoice stays approved/unpaid (admin can retry via "Pay Via CC")
```

### Manual "Pay Via CC" Feature

For invoices that weren't auto-charged (e.g., client switched to CC after invoice generated):

1. Admin goes to Admin → Invoicing → Recent Invoices table
2. For unpaid invoices of CC-enabled clients, dropdown shows "Pay Via CC"
3. Dialog shows charge preview:
   - Base amount (invoice total)
   - +3% CC fee (if not already in invoice)
   - Total to charge
4. On confirm: `/api/admin/invoices/[id]/charge-cc` POST
5. If CC fee wasn't in invoice, it's added to line_items_json and total_amount updated

### Stripe Payment Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/stripe/setup-intent` | POST | Create SetupIntent for card setup |
| `/api/stripe/save-payment-method` | POST | Save PM to client after setup |
| `/api/admin/invoices/[id]/charge-cc` | GET | Preview charge amounts |
| `/api/admin/invoices/[id]/charge-cc` | POST | Execute manual CC charge |

### Stripe Test Cards

For testing in development (Stripe test mode):

| Card | Result |
|------|--------|
| `4242 4242 4242 4242` | Success |
| `4000 0000 0000 0002` | Declined |
| `4000 0000 0000 9995` | Insufficient funds |
| `4000 0000 0000 0069` | Expired |

### Related Files

| File | Purpose |
|------|---------|
| `app/api/stripe/setup-intent/route.ts` | Creates SetupIntent for card setup |
| `app/api/stripe/save-payment-method/route.ts` | Saves payment method to client |
| `app/api/admin/invoices/[id]/approve/route.ts` | Auto-charge on approval |
| `app/api/admin/invoices/[id]/charge-cc/route.ts` | Manual CC charge endpoint |
| `components/stripe-card-setup.tsx` | Card setup UI component |
| `components/admin-content.tsx` | Pay Via CC dialog (in admin invoicing) |
| `lib/billing/invoice-generator.ts` | Adds CC fee line item |

---

## Files

| File | Purpose |
|------|---------|
| `lib/billing/markup-engine.ts` | Rule matching and calculation |
| `lib/billing/invoice-generator.ts` | Invoice data collection |
| `lib/billing/preflight-validation.ts` | Pre-generation checks |
| `lib/billing/pdf-subprocess.ts` | PDF generation |
| `app/api/admin/invoices/*` | Invoice API routes |

---

## Transactions Tab APIs

Each billing tab has a dedicated API route with search and filter support:

| Tab | Route | Search Fields |
|-----|-------|---------------|
| Unfulfilled | `/api/data/orders/unfulfilled` | recipient_name, order_id, shipment_id |
| Shipments | `/api/data/shipments` | recipient_name, order_id, tracking_id |
| Additional Services | `/api/data/billing/additional-services` | reference_id |
| Returns | `/api/data/billing/returns` | return_id, original_shipment, tracking_#, invoice_#, charge |
| Receiving | `/api/data/billing/receiving` | wro_id, contents, invoice_#, charge |
| Storage | `/api/data/billing/storage` | inventory_id, invoice_#, charge |
| Credits | `/api/data/billing/credits` | reference_id, sb_ticket, credit_invoice_#, amount |

### Filter Options

Dynamic filter options are loaded from `/filter-options` endpoints:
- Returns: `/api/data/billing/returns/filter-options` → statuses, types
- Receiving: `/api/data/billing/receiving/filter-options` → statuses
- Storage: `/api/data/billing/storage/filter-options` → FCs, location types
- Credits: `/api/data/billing/credits/credit-reasons` → reasons

### Receiving Contents Logic

WRO Contents column uses fallback logic in `getWroContents()`:
1. Try `purchase_order_number` from receiving_orders
2. Fallback: Extract unique SKUs from `inventory_quantities` JSONB
3. Show first 3 SKUs, then "+N more" if more exist

---

## Manual Operations

### Generate invoice for specific client
```bash
curl -X POST https://your-domain.com/api/admin/invoices/generate \
  -H "Cookie: your-auth-cookie" \
  -H "Content-Type: application/json" \
  -d '{"clientId": "uuid-here"}'
```

### Skip preflight (emergency only)
```bash
curl -X POST .../generate -d '{"skipPreflight": true}'
```

---

## Common Gotchas & Debugging

### Shipment Count Discrepancy

**Symptom:** Preflight shows more Shipping transactions than ShipBob's invoice shows shipments.

**Cause:** A single shipment can have multiple Shipping transactions:
- Original charge
- Refund (negative amount)
- Re-charge (if shipping was adjusted)

**Example:** ShipBob says 4977 shipments, preflight shows 4983 transactions = 6 shipments with adjustments.

**Resolution:** This is expected behavior. The 6 "extra" transactions are refund/adjustment pairs.

### Transactions Missing client_id

**Symptom:** Preflight shows 0 transactions or very low counts. Filtering by client_id returns nothing.

**Cause:** Transactions are synced from parent token (sees all merchants) but `client_id` attribution failed.

**Debug:**
```sql
-- Check how many transactions have NULL client_id
SELECT COUNT(*) FROM transactions WHERE client_id IS NULL;

-- Check specific invoice
SELECT COUNT(*), COUNT(client_id) as with_client
FROM transactions WHERE invoice_id_sb = 8693044;
```

**Resolution:** Run `scripts/backfill-transaction-clientid.js` or wait for invoice sync's two-pass attribution.

### Missing base_cost (SFTP Breakdown)

**Symptom:** Transactions have NULL base_cost/surcharge after SFTP processing.

**Debug checklist:**
1. **Wrong file date?** Remember: filename is invoice GENERATION date (Monday after billing period)
2. **Accounting format?** Check if file has `($X.XX)` format for negatives
3. **Matching failed?** Check if `shipment_id` in SFTP matches `reference_id` in DB

```bash
# Reprocess with correct date
npx tsx scripts/reprocess-sftp-breakdown.ts MMDDYY
```
