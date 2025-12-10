# Billing & Invoicing System

**Read this when:** Working on markup rules, invoice generation, billing workflows, or admin billing features.

---

## Overview

Jetpack bills clients for fulfillment services by:
1. **Receiving costs from ShipBob** (our 3PL partner) via billing tables
2. **Applying markups** per transaction type, client, and conditions
3. **Generating weekly invoices** (PDFs + XLS) for client approval
4. **Managing approval workflow** for admin review before client delivery

---

## Database Schema

### Table Naming Convention
| Table | Purpose |
|-------|---------|
| `transactions` | **SOURCE OF TRUTH** - All billing transactions from ShipBob (includes markup data when invoiced) |
| `invoices_sb` | ShipBob's invoices to us (source of truth for invoice attribution) |
| `invoices_jetpack` | Our invoices to clients |
| `markup_rules` | Markup configuration with history via effective dates |
| `markup_rule_history` | Audit trail for markup changes |

**⚠️ DELETED (Dec 7, 2025):** `invoices_jetpack_line_items` table has been consolidated into `transactions`. Markup data is now stored directly on each transaction when invoiced.

### Transactions Table (Source of Truth - Dec 2025 Refactor)

The `transactions` table is the **sole source of truth** for all billing data.

**⚠️ CRITICAL: `billing_*` tables have been DELETED (Dec 5, 2025)**

The following tables no longer exist and should NEVER be referenced:
- ~~`billing_shipments`~~, ~~`billing_shipment_fees`~~, ~~`billing_storage`~~
- ~~`billing_credits`~~, ~~`billing_returns`~~, ~~`billing_receiving`~~
- ~~`billing_all` view~~

### Financial Column Structure (Dec 2025 - DEFINITIVE)

**⚠️ IMPORTANT: Different columns are used for Shipments vs Non-Shipments!**

#### For SHIPMENTS Only (`reference_type='Shipment'`, `transaction_fee='Shipping'`)

| Column | Source | Description | Client Sees? |
|--------|--------|-------------|--------------|
| `cost` | ShipBob API | Total cost to us (= base_cost + surcharge + insurance_cost) | NO (internal) |
| `base_cost` | SFTP | Base shipping cost from ShipBob (NOT marked up) | NO (internal) |
| `base_charge` | Calculated | `base_cost × (1 + markup%)` - marked up base cost | YES - "Base Fulfillment Charge" |
| `surcharge` | SFTP | Carrier surcharges (passed through, NO markup) | YES - "Surcharges" |
| `total_charge` | Calculated | `base_charge + surcharge` | YES - "Total Charge" |
| `insurance_cost` | SFTP | Insurance cost from ShipBob (NOT marked up) | NO (internal) |
| `insurance_charge` | Calculated | `insurance_cost × (1 + markup%)` - marked up insurance | YES - "Insurance" |
| `billed_amount` | Calculated | `total_charge + insurance_charge` - total charged to client | YES (summary) |

**Formula Summary for Shipments:**
```
base_charge = base_cost × (1 + markup_percentage)
total_charge = base_charge + surcharge
insurance_charge = insurance_cost × (1 + markup_percentage)
billed_amount = total_charge + insurance_charge
```

#### For NON-SHIPMENTS (All other transaction types)

| Column | Source | Description | Client Sees? |
|--------|--------|-------------|--------------|
| `cost` | ShipBob API | Cost to us | NO (internal) |
| `billed_amount` | Calculated | `cost × (1 + markup%)` - total charged to client | YES - "Total Charge" |
| `base_cost` | NULL | Not applicable | - |
| `base_charge` | NULL | Not applicable | - |
| `surcharge` | NULL | Not applicable | - |
| `total_charge` | NULL | Not applicable | - |
| `insurance_cost` | NULL | Not applicable | - |
| `insurance_charge` | NULL | Not applicable | - |

**Formula for Non-Shipments:**
```
billed_amount = cost × (1 + markup_percentage)
```

#### Internal-Only Columns (NEVER show to client)

| Column | Description |
|--------|-------------|
| `cost` | Our cost from ShipBob |
| `base_cost` | ShipBob's base shipping cost |
| `insurance_cost` | ShipBob's insurance cost |
| `markup_applied` | Dollar amount of markup |
| `markup_percentage` | Percentage applied (e.g., 0.18 for 18%) |
| `markup_rule_id` | Reference to markup_rules.id |

#### `billed_amount` - Universal Total Column

The `billed_amount` column is the **single source of truth for "total charged to client"** regardless of transaction type:
- **For Shipments:** `billed_amount = total_charge + insurance_charge`
- **For Non-Shipments:** `billed_amount = cost × (1 + markup%)`

Use this column whenever you need the final amount billed to client without caring about transaction type.

---

### Reference Type Mapping

| reference_type | transaction_fee | Description |
|----------------|-----------------|-------------|
| `Shipment` | `Shipping` | Base shipping charges (uses SFTP breakdown) |
| `Shipment` | `Per Pick Fee`, etc. | Additional fees on shipments |
| `FC` | `Warehousing Fee` | Storage/warehousing charges |
| `Return` | various | Return processing charges |
| `WRO` | `WRO Receiving Fee` | Warehouse receiving orders |
| `Default` | `Credit` | Credit adjustments |

### Client Billing Fields (added to `clients` table)
```sql
ALTER TABLE clients ADD COLUMN short_code TEXT;  -- 2-3 char code (HS, ML)
ALTER TABLE clients ADD COLUMN billing_period TEXT DEFAULT 'weekly';  -- weekly, bi-weekly, tri-weekly, monthly
ALTER TABLE clients ADD COLUMN billing_terms TEXT DEFAULT 'due_on_receipt';  -- due_on_receipt, 7_days, 14_days, 30_days
ALTER TABLE clients ADD COLUMN invoice_email_note TEXT;  -- Custom invoice email text
ALTER TABLE clients ADD COLUMN next_invoice_number INTEGER DEFAULT 1;  -- Auto-incrementing per client
ALTER TABLE clients ADD COLUMN billing_email TEXT;  -- Where to send invoices
```

**Current Client Data:**
| Client | Short Code | Next Invoice # |
|--------|------------|----------------|
| Henson | HS | 38 |
| Methyl-Life | ML | 22 |

---

## Invoice Number Format

Format: `JP{SHORT_CODE}-{NNNN}-{MMDDYY}`

Examples:
- `JPHS-0038-120825` = Jetpack Henson invoice #38, Dec 8, 2025
- `JPML-0022-120825` = Jetpack Methyl-Life invoice #22, Dec 8, 2025

**Regenerated invoices:** Append `-v2`, `-v3`, etc.
- `JPHS-0038-120825-v2` = Revised version

---

## Markup System

### Markup Rules Table (existing)
```sql
markup_rules:
  - client_id: NULL = all clients, UUID = specific client
  - fee_type: Transaction type to match
  - ship_option_id: Optional shipping service filter
  - conditions: JSONB for complex rules (weight, state, etc.)
  - markup_type: 'percentage' | 'fixed'
  - markup_value: Decimal value
  - priority: Higher = applied first
  - is_additive: If true, stacks with other rules
  - effective_from/to: Date range for versioning
```

### Transaction Types by Category

All transaction data is in the `transactions` table, categorized by `reference_type` and `transaction_fee` columns.

**Shipping Transactions** (`reference_type='Shipment'`, `transaction_fee='Shipping'`):
| order_category | Description | Markup Strategy |
|----------------|-------------|-----------------|
| NULL/Standard | Standard shipments | By ship_option + weight bracket |
| FBA | Fulfillment by Amazon | Different markup rate |
| VAS | Value Added Services | Different markup rate |

**Weight Brackets for Standard Shipments:**
- `<8oz` - Lightest tier
- `8-16oz` - Light tier
- `1-5lbs` - Medium tier
- `5-10lbs` - Heavy tier
- `10-15lbs` - Extra heavy
- `20+lbs` - Freight tier

**Additional Service Fees** (`reference_type='Shipment'`, various `transaction_fee` values):
| transaction_fee | Notes |
|-----------------|-------|
| Per Pick Fee | Most common |
| B2B - Label Fee | B2B specific |
| B2B - Each Pick Fee | B2B specific |
| B2B - Case Pick Fee | B2B specific |
| B2B - Order Fee | B2B specific |
| B2B - Supplies | B2B specific |
| Address Correction | Carrier charge |
| Inventory Placement | Amazon program |
| URO Storage Fee | Unshippable inventory |
| Fuel Surcharge | Carrier surcharge |
| Residential Surcharge | Carrier surcharge |
| Delivery Area Surcharge | Carrier surcharge |
| Kitting Fee | Assembly |

**Storage Transactions** (`reference_type='FC'`):
| location_type | Typical Rate |
|---------------|--------------|
| Pallet | $30-40/month |
| Shelf | $10/month |
| Bin | $3/month |
| HalfPallet | $15/month |

**Credit Transactions** (`transaction_fee='Credit'`):
| Reason | Markup? |
|--------|---------|
| Claim for Lost Order | See below |
| Picking Error | Pass-through |
| Courtesy | Pass-through |
| Claim for Damaged Order | See below |

**Return Transactions** (`reference_type='Return'`):
| transaction_type | Description |
|------------------|-------------|
| Return to sender - Processing | RTS handling |
| Return Processed by Operations | Return processing |
| Return Label | Label cost |

**Receiving Transactions** (`reference_type='WRO'`):
| transaction_fee | Description |
|-----------------|-------------|
| WRO Receiving Fee | Inbound receiving charge |

**Insurance Markup** (special category):
Insurance is marked up separately from base shipping charges. Data comes from SFTP weekly file, not API transactions.
| Fee Type | Description |
|----------|-------------|
| Shipment Insurance | Insurance cost on shipments |

Insurance markup supports both:
- `markup_percent` (e.g., 0.10 for 10%)
- `markup_amount` (flat $ amount added)

Formula: `insurance_charge = insurance_cost + (insurance_cost × markup_percent) + markup_amount`

---

## Shipping Markup Analysis (Dec 2025)

### Key Discovery: Base vs Surcharge Markup

**Shipping costs have TWO components with DIFFERENT markup rates:**

| Component | Markup | Notes |
|-----------|--------|-------|
| Base Shipping | 14% or 18% | Two tiers exist |
| Surcharges | 0% | Passed through at cost |

**Analysis Results (Henson JPHS-0037, 1,435 shipments):**
- Average base markup: 16.83% (between 14% and 18% due to two tiers)
- Standard deviation: 1.82% (consistent)
- RMSE at 17.5%: $0.0866 (best fit)

**Formula:**
```
markedUpTotal = rawBase × 1.175 + rawSurcharge
```

Where:
- `rawSurcharge = xlsxSurcharge` (surcharges passed through at cost)
- `rawBase = dbCost - rawSurcharge`

**Correlation Evidence:**
| Surcharge % of Total | Total Markup % |
|---------------------|----------------|
| < 10% (1,422 shipments) | 16.5% |
| > 30% (13 shipments) | 9.4% |

This proves surcharges dilute the total markup percentage because they're not marked up.

### Challenge: API Doesn't Split Base/Surcharge

The ShipBob API returns a single "Shipping" transaction per shipment with total cost. It does NOT provide base vs surcharge breakdown.

**Options for Invoice Generation:**
1. **Flat 17.5% markup** - Simple, good average fit (RMSE $0.0866)
2. **Lookup surcharge from invoice details** - More accurate but requires data not in API
3. **Fixed surcharge table** - If surcharges are standard amounts per zone/carrier

**Recommendation:** Start with flat 17.5% markup on shipping. Average error is <$0.10 per shipment, which is acceptable for now.

### Script References
- `scripts/analyze-shipping-markup.js` - Shipping-only markup analysis
- `scripts/analyze-base-vs-surcharge.js` - Base vs surcharge breakdown analysis
- `scripts/compare-shipment-amounts.js` - XLSX vs DB comparison

---

## Shipping Breakdown Stopgap: SFTP Weekly CSV (Dec 2025)

### Problem
ShipBob's API returns total shipping cost per shipment, but NOT the base/surcharge/insurance breakdown needed for proper markup application:
- **Base shipping:** Marked up 14-18%
- **Surcharges:** Passed through at 0%
- **Insurance:** Passed through at 0%

### Solution
ShipBob drops a weekly CSV to our SFTP server with the breakdown data before invoice generation runs (Mondays).

**File format:** `extras-MMDDYY.csv` (e.g., `extras-120125.csv` for Dec 1, 2025)
**Location:** `sftp://{SFTP_HOST}/extras-MMDDYY.csv` (root directory)

### CSV Format (Actual ShipBob Export)
```csv
User ID,Merchant Name,OrderID,Invoice Number,Fulfillment without Surcharge,Surcharge Applied,Original Invoice,Insurance Amount
386350,Henson Shaving,314479977,8633612,$6.70,$0.15,$6.85,$0.00
392333,Methyl-Life®,318747654,8633612,$7.11,$0.20,$7.31,$0.00
```

**Column Mapping:**
| CSV Column | Our Field | Description |
|------------|-----------|-------------|
| OrderID | `shipment_id` | ShipBob shipment ID (matches `reference_id` on transactions) |
| Fulfillment without Surcharge | `base_cost` | Base shipping cost (gets marked up) |
| Surcharge Applied | `surcharge` | Carrier surcharges (passed through at 0%) |
| Insurance Amount | `insurance_cost` | Insurance (passed through at 0%) |
| Original Invoice | `total` | Total = base + surcharge (for validation) |

### Environment Variables Required
```bash
SFTP_HOST=us-east-1.sftpcloud.io
SFTP_PORT=22  # optional, defaults to 22
SFTP_USERNAME=shipbob
SFTP_PASSWORD=...  # or use SFTP_PRIVATE_KEY
SFTP_PRIVATE_KEY=...  # base64-encoded private key (alternative to password)
SFTP_REMOTE_PATH=/  # root directory where extras-MMDDYY.csv files live
```

### Implementation
**File:** `lib/billing/sftp-client.ts`

The SFTP fetch is **automatically integrated** into the invoice cron job (`app/api/cron/generate-invoices/route.ts`):

```typescript
// Step 1: Fetch shipping breakdown data from SFTP (if available)
const sftpResult = await fetchShippingBreakdown(invoiceDate)

if (sftpResult.success && sftpResult.rows.length > 0) {
  // Update transactions with breakdown data
  const updateResult = await updateTransactionsWithBreakdown(adminClient, sftpResult.rows)
  // Updates base_cost, surcharge, insurance_cost on matching transactions
}

// Step 2: Generate invoices (now with breakdown data available)
```

### Database Schema
The `transactions` table has these columns for breakdown data:
- `base_cost` NUMERIC - Base shipping cost from SFTP
- `surcharge` NUMERIC - Carrier surcharges from SFTP
- `insurance_cost` NUMERIC - Insurance cost from SFTP

### Vercel Compatibility
Uses `ssh2-sftp-client` with `ssh2` v1.17.0 which is pure JavaScript (no native bindings required). Configured in `next.config.ts`:
```typescript
serverExternalPackages: ['ssh2', 'ssh2-sftp-client']
```

### Workflow Integration
1. ShipBob uploads `extras-MMDDYY.csv` to SFTP root by Sunday night
2. Monday 5am: Invoice cron fetches CSV for the week's date
3. Updates all matching Shipping transactions with `base_cost`, `surcharge`, `insurance_cost`
4. Invoice generation uses breakdown for correct markup application
5. If CSV missing, invoice generation continues (breakdown columns stay null, uses flat markup)

### Scripts
- `scripts/apply-sftp-breakdown.js` - Manual backfill from SFTP CSV
- `scripts/find-missing-breakdown.js` - Debug which shipments don't match
- `scripts/test-sftp-connection.js` - Test SFTP connectivity and list files

---

## Credits Handling (Special Case)

Credits are complex because they may contain:
1. **Product reimbursement only** - Pass through at 0% markup
2. **Shipping charge refund only** - Apply SAME markup as original shipment
3. **Combined** - Split and apply markup only to shipping portion

**Rules:**
- Max credit: -$100
- Need to link credit to original shipment via `reference_id`
- Look up original shipment's `billed_amount` vs `amount` to determine markup used
- Apply same markup to shipping portion of credit

**Discovery Required:**
- Can we identify shipping portion from credit details?
- Can we link to original transaction via tracking/order ID?

---

## Storage Billing (Special Case)

Storage billing intervals vary by client:
- **Monthly:** 1st Monday after 1st of month
- **Semi-monthly:** Also 1st Monday after 15th
- **Weekly:** Every Monday

**Key Rule:** If storage transactions exist for a given week, include them. If not, no storage line item.

**⚠️ CRITICAL: Storage Invoice Shared Between Clients (Dec 2025 Discovery)**

Storage invoices (`invoice_id_sb`) are SHARED across all clients on the same billing cycle. When querying storage transactions:
- **ALWAYS filter by BOTH `invoice_id_sb` AND `client_id`**
- The `merchant_id` field from ShipBob API is the authoritative source for client attribution
- Reference files from ShipBob may include other clients' inventory if they only filter by invoice_id

Example: Invoice 8633618 contains storage for both Henson (969 rows) and Methyl-Life (12 rows for inventory 20114295). Our DB correctly attributes by `merchant_id`, but ShipBob's raw export included both.

**PDF Requirement:** Always show billing period in line item:
- "Storage (Nov 1 - Nov 15, 2025)"
- "Storage (Nov 1 - Nov 30, 2025)"

---

## Transaction Timestamps (ULID Decoding)

ShipBob's `transaction_id` field is a ULID which embeds a millisecond-precision timestamp in its first 10 characters. This can provide more precise timestamps than `charge_date` (which is date-only).

**ULID Timestamp Behavior by Transaction Type:**

| Type | ULID Timestamp Works? | What to Use | Notes |
|------|----------------------|-------------|-------|
| **Credits** | ✅ YES | `decodeUlidTimestamp()` | Matches reference within 1-2ms |
| **Receiving (WRO)** | ✅ YES | `decodeUlidTimestamp()` | Matches reference within 1ms |
| **Returns** | ❌ NO | `returns.insert_date` | ULID = completed_date, not insert_date. Use Returns API. |
| **Shipments** | ✅ YES | Shipment timeline events | More accurate dates available from timeline API |
| **Storage** | ❌ NO | `charge_date` | All ULIDs decode to period end date |

**ULID Decode Function:**
```typescript
const ULID_ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
function decodeUlidTimestamp(ulid: string): string | null {
  if (!ulid || ulid.length < 10) return null
  const timeStr = ulid.substring(0, 10).toUpperCase()
  let time = 0
  for (const char of timeStr) {
    const index = ULID_ENCODING.indexOf(char)
    if (index === -1) return null
    time = time * 32 + index
  }
  return new Date(time).toISOString()
}
```

**Returns Timestamp Source:**
The Returns API (`/1.0/return/{id}`) provides two timestamps:
- **`insert_date`** = Return Creation Date (what we need, matches reference within 1ms)
- **`completed_date`** = When return was completed (what ULID decodes to)

Our `returns` table already stores `insert_date` from the API. The invoice generator joins with `returns` table to get this timestamp. Falls back to `charge_date` (date-only) if return not found.

---

## ShipBob Invoice Reconciliation

### invoices_sb Table
The `invoices_sb` table stores ShipBob's weekly invoices imported from CSV export (API has ~1 month history limit).

**Schema:**
- `shipbob_invoice_id` - Primary key, also serves as invoice number (e.g., "8633612")
- `invoice_date` - Date invoice was issued
- `invoice_type` - Category (see mapping below)
- `base_amount` - USD amount (negative for credits/payments)
- `period_start/end` - Billing period (7-day week)

**Invoice Types from ShipBob:**
| Type | Description |
|------|-------------|
| Shipping | Carrier shipping costs |
| AdditionalFee | Fulfillment fees (picking, handling) |
| WarehouseStorage | Monthly storage fees |
| WarehouseInboundFee | Receiving fees (WRO) |
| ReturnsFee | Return processing |
| Credits | Credit adjustments (negative) |
| Payment | Payments made to ShipBob (negative) |

### Transaction Fee → Invoice Type Mapping

See `lib/billing/fee-invoice-mapping.ts` for the canonical mapping. Key mappings:

| Transaction Fee | Invoice Type |
|-----------------|--------------|
| Shipping, Address Correction | Shipping |
| Per Pick Fee, B2B fees, VAS, Kitting | AdditionalFee |
| Warehousing Fee, URO Storage Fee | WarehouseStorage |
| WRO Receiving Fee | WarehouseInboundFee |
| Return to sender, Return Processed | ReturnsFee |
| Credit | Credits |
| Payment | Payment |

### Reconciliation Results (Dec 2025 Testing)

**✅ CONFIRMED: Transaction sums EXACTLY match invoice amounts when properly queried.**

Tested invoice 8633612 (Shipping, Nov 24-30, 2025):
| Metric | Value |
|--------|-------|
| Invoice amount | $11,127.61 |
| Transaction sum | $11,127.61 |
| Transaction count | 1,875 |
| **Difference** | **$0.00** |

Overall sync status:
- API total transactions: 147,281
- DB synced transactions: 147,150 (99.9%)
- Invoice attribution: Working correctly via `invoice_id_sb` field

### Critical: Supabase Pagination Requirement

⚠️ **When summing transactions by invoice, you MUST paginate!**

Supabase has a default 1,000 row limit. Queries without pagination will return incorrect sums.

```javascript
// CORRECT: Paginated query
let allTx = []
let offset = 0
const pageSize = 1000

while (true) {
  const { data } = await supabase
    .from('transactions')
    .select('cost')  // NOTE: Column was renamed from 'amount' to 'cost' in Dec 2025
    .eq('invoice_id_sb', invoiceId)
    .range(offset, offset + pageSize - 1)
    .order('id')

  if (!data || data.length === 0) break
  allTx.push(...data)
  offset += data.length
  if (data.length < pageSize) break
}

const total = allTx.reduce((sum, tx) => sum + Number(tx.cost), 0)
```

### Key Decision: Source of Truth

**For Jetpack invoicing, transactions ARE the source of truth.**

Why:
- Markups happen at the **transaction level**, not invoice level
- We need transaction-level detail to apply different markup rates
- Transaction sums match invoice amounts exactly (verified Dec 5, 2025)

Key rules:
1. **Match by `invoice_id_sb`**, NOT date ranges (avoids timezone issues)
2. **ALWAYS filter by BOTH `invoice_id_sb` AND `client_id`** - invoices are shared across clients!
3. Only bill transactions where `invoiced_status_sb = true`
4. Only include transactions whose `invoice_id_sb` matches active week's ShipBob invoice IDs
5. Always use paginated queries when summing large transaction sets

The fee-to-invoice mapping (`lib/billing/fee-invoice-mapping.ts`) is for categorization/grouping in Jetpack invoices.

---

## Invoice Generation & Approval Workflow (Dec 2025 Refactor)

### Core Principle: Separation of Generation and Approval

**⚠️ CRITICAL: Transactions and invoices_sb are NOT marked until APPROVAL, not generation.**

This ensures:
1. Drafts can be regenerated freely without data corruption
2. Draft invoices can be deleted safely (no orphaned transaction marks)
3. What you approve is EXACTLY what was generated (no recalculation on approval)

### Database Schema for Workflow

The `invoices_jetpack` table has two key JSONB columns:

```sql
-- Stores which ShipBob invoices are included (for regeneration)
shipbob_invoice_ids JSONB DEFAULT '[]'::jsonb

-- Stores calculated line items with markup data (for approval)
line_items_json JSONB
```

### The Workflow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  1. GENERATE (Cron or Manual)                                               │
│                                                                             │
│  • Collect transactions from invoices_sb (where jetpack_invoice_id IS NULL) │
│  • Apply markup rules, calculate amounts                                    │
│  • Store shipbob_invoice_ids on invoice record                              │
│  • Store line_items_json with all calculated markup data                    │
│  • Generate PDF and XLSX files                                              │
│  • Create invoice with status = 'draft'                                     │
│                                                                             │
│  ❌ Does NOT mark transactions.invoice_id_jp                                │
│  ❌ Does NOT mark invoices_sb.jetpack_invoice_id                            │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│  2. REVIEW (Admin UI)                                                       │
│                                                                             │
│  • Admin reviews PDF and XLSX files                                         │
│  • Can regenerate if issues found (recalculates from shipbob_invoice_ids)   │
│  • Draft shows in "Pending Approval" section                                │
│  • Same SB invoices can appear in preflight until approved                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│  3. APPROVE (Finalization)                                                  │
│                                                                             │
│  • Reads line_items_json (NO recalculation!)                                │
│  • Marks transactions with invoice_id_jp using EXACT amounts from files     │
│  • Marks invoices_sb.jetpack_invoice_id                                     │
│  • Changes status to 'approved'                                             │
│                                                                             │
│  ✅ NOW transactions are marked (same amounts as PDF/XLSX)                  │
│  ✅ NOW invoices_sb is marked (removed from preflight)                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Why line_items_json Matters

The `line_items_json` column stores the calculated markup data at generation time:
- `markupApplied` - Dollar amount of markup
- `billedAmount` - Final amount billed to client
- `markupPercentage` - The percentage used
- `markupRuleId` - Reference to the rule applied
- Plus all other line item fields

When you approve, the system reads this cached data and marks transactions with these EXACT amounts. This guarantees that what the admin reviewed in the PDF/XLSX is exactly what gets committed to the database.

**If we recalculated at approval time:**
- Markup rules might have changed between generation and approval
- Underlying data might have been modified
- The approved amounts could differ from the PDF/XLSX files reviewed
- This would be a critical bug!

### Regeneration

When regenerating a draft invoice:
1. Reads `shipbob_invoice_ids` from the invoice record
2. Recollects transactions for those IDs
3. Reapplies current markup rules
4. Updates `line_items_json` with new calculations
5. Regenerates PDF and XLSX files
6. Increments version number

**Does NOT touch:**
- `transactions.invoice_id_jp` (still null for drafts)
- `invoices_sb.jetpack_invoice_id` (still null for drafts)

### Weekly Schedule
- **When:** Mondays at 6pm EST (Vercel Cron)
- **Status:** Generates as "draft"
- **Regeneration:** Unlimited while in draft status

### Invoice Dates and Billing Periods

**Invoice Date & Due Date:**
- Always the Monday when the invoice is generated
- Example: If cron runs Monday Dec 1, invoice_date = Dec 1, 2025

**Billing Period (for non-storage line items):**
- Always the PRIOR Monday through Sunday
- Example: Dec 1 invoice → billing period = Nov 24 - Nov 30, 2025
- Applies to: Shipping, Additional Services, Returns, Receiving, Credits

**Storage Billing Period:**
- Determined from actual storage transaction `charge_date` values
- Rounded to the nearest half-month boundary:
  - If transactions span Nov 1 - Nov 30 → "Nov 1 - Nov 30, 2025"
  - If transactions only Nov 16 - Nov 30 → "Nov 16 - Nov 30, 2025"
  - If transactions only Nov 1 - Nov 15 → "Nov 1 - Nov 15, 2025"
- Storage can be monthly or semi-monthly depending on client billing cycle

**Period Detection Logic:**
```typescript
// Calculate storage period from transaction dates
function detectStoragePeriod(storageDates: Date[]): { start: Date, end: Date } {
  const minDate = Math.min(...storageDates.map(d => d.getTime()))
  const maxDate = Math.max(...storageDates.map(d => d.getTime()))

  const earliest = new Date(minDate)
  const latest = new Date(maxDate)

  // Round to half-month boundaries
  const month = earliest.getMonth()
  const year = earliest.getFullYear()

  // If transactions cross the 15th, use full month
  const dayMin = earliest.getDate()
  const dayMax = latest.getDate()

  if (dayMin <= 15 && dayMax > 15) {
    // Full month
    return { start: new Date(year, month, 1), end: new Date(year, month + 1, 0) }
  } else if (dayMax <= 15) {
    // First half
    return { start: new Date(year, month, 1), end: new Date(year, month, 15) }
  } else {
    // Second half
    return { start: new Date(year, month, 16), end: new Date(year, month + 1, 0) }
  }
}
```

### Invoice Statuses
| Status | Description |
|--------|-------------|
| `draft` | Just generated, pending review |
| `pending_approval` | Under admin review |
| `approved` | Finalized, sent to client |
| `regenerated` | Replaced by newer version |

### Regeneration Rules
- Only within 24 hours of creation
- Adds `-v2`, `-v3` suffix
- Original marked as `regenerated`
- Email includes bold warning about correction

### Invoice Email Content
1. Default template with PDF attached
2. Optional custom note per client (`clients.invoice_email_note`)
3. If past-due invoices exist: Add warning paragraph
4. If regenerated: Add bold correction notice

---

## Pre-Flight Validation (Dec 2025)

Before generating invoices, the cron job runs a comprehensive validation to ensure all required data is populated. This prevents generating incomplete invoices.

### How It Works

**Location:** `lib/billing/preflight-validation.ts`

The validation runs per-client, checking ALL fields that appear in the generated XLS output:

```typescript
// Called in the cron job before generating each client's invoice
const validation = await runPreflightValidation(adminClient, client.id, shipbobInvoiceIds)

if (!validation.passed) {
  // Critical issues block invoice generation
  console.error(`❌ Pre-flight validation FAILED for ${client.company_name}`)
  errors.push({ client: client.company_name, error: validation.issues.map(i => i.message).join('; ') })
  continue  // Skip this client
}
```

### What Gets Validated

The validation checks EVERY column in ALL 6 XLS sheets:

#### 1. Shipments Sheet (12 field categories)
| Field | Source | Required? |
|-------|--------|-----------|
| `tracking_id` | shipments table | Warning if missing |
| `base_cost` | SFTP breakdown file | **100% REQUIRED** - ANY missing blocks generation |
| `carrier` | shipments.carrier | Warning if missing |
| `carrier_service` | shipments.carrier_service | Warning if missing |
| `zone_used` | shipments.zone_used | Warning if missing |
| `weight_oz` / `weight_actual` | shipments table | Warning if missing |
| `dimensions` | shipments (length/width/height) | Warning if missing |
| `event_labeled` | shipment timeline events | Warning if missing |
| `products_sold` | shipment_items table | Warning if missing |
| `customer_name` | orders.recipient_name | Warning if missing |
| `zip_code` | orders.ship_to_postal | Warning if missing |

#### 2. Additional Services Sheet (3 field categories)
| Field | Source |
|-------|--------|
| `reference_id` | transactions.reference_id |
| `fee_type` | transactions.transaction_fee |
| `transaction_date` | transactions.charge_date |

#### 3. Returns Sheet (5 field categories)
| Field | Source |
|-------|--------|
| `return_id` | transactions.reference_id |
| `order_id` | returns.order_id |
| `tracking_id` | transactions.tracking_id |
| `return_date` | returns.insert_date |
| `fc_name` | transactions.fulfillment_center |

#### 4. Receiving Sheet (4 field categories)
| Field | Source |
|-------|--------|
| `wro_id` | transactions.reference_id |
| `fee_type` | transactions.transaction_fee |
| `transaction_type` | transactions.transaction_type |
| `transaction_date` | transactions.charge_date |

#### 5. Storage Sheet (4 field categories)
| Field | Source |
|-------|--------|
| `fc_name` | transactions.fulfillment_center |
| `inventory_id` | transactions.additional_details.InventoryId |
| `sku` | transactions.additional_details.SKU |
| `location_type` | transactions.additional_details.LocationType |

#### 6. Credits Sheet (3 field categories)
| Field | Source |
|-------|--------|
| `reference_id` | transactions.reference_id |
| `transaction_date` | transactions.charge_date |
| `credit_reason` | transactions.additional_details.Comment or CreditReason |

### Thresholds

```typescript
const CRITICAL_THRESHOLD = 5  // >5% missing = CRITICAL (blocks generation)
const WARNING_THRESHOLD = 1   // >1% missing = WARNING (logs but continues)
```

**`base_cost` requires 100% completion** - Even a single missing `base_cost` value blocks invoice generation. This is because:
- Without base/surcharge breakdown, we cannot apply correct markup rates
- Markup is applied to base cost only, surcharges pass through at 0%
- Incorrect markup would result in incorrect billing

All other fields use threshold-based validation (>5% missing = critical, >1% = warning) and generate warnings but allow invoice generation to proceed (they affect XLS detail but not billing accuracy).

### Validation Output Example

```
╔══════════════════════════════════════════════════════════════╗
║  PRE-FLIGHT VALIDATION: ✅ PASSED                            ║
╠══════════════════════════════════════════════════════════════╣
║ TRANSACTION COUNTS:                                          ║
║   Shipping: 1,435  | Add'l Svc: 389    | Storage: 0          ║
║   Returns: 51      | Receiving: 0      | Credits: 2          ║
╠══════════════════════════════════════════════════════════════╣
║ SHIPMENTS SHEET FIELDS:                                      ║
║   Tracking ID:    1435/1435 (100%)     Event Labeled: 1435/1435║
║   Base Cost:      1435/1435 (100%)     Products Sold: 1398/1435║
║   Carrier:        1432/1435 (99%)      Customer Name: 1435/1435║
║   Carrier Svc:    1430/1435 (99%)      Zip Code:      1435/1435║
║   Zone:           1420/1435 (99%)      Weights:       1435/1435║
║   Dimensions:     1400/1435 (97%)                              ║
╠══════════════════════════════════════════════════════════════╣
║ ADDITIONAL SERVICES SHEET FIELDS:                            ║
║   Reference ID: 389/389 (100%)         Fee Type:    389/389   ║
║   Tx Date:      389/389 (100%)                                ║
╠══════════════════════════════════════════════════════════════╣
║ RETURNS SHEET FIELDS:                                        ║
║   Return ID: 51/51 (100%)              Return Date: 48/51     ║
║   Order ID:  48/51 (94%)               FC Name:     51/51     ║
╠══════════════════════════════════════════════════════════════╣
║ CREDITS SHEET FIELDS:                                        ║
║   Reference ID: 2/2 (100%)             Tx Date:      2/2      ║
║   Credit Reason: 2/2 (100%)                                   ║
╠══════════════════════════════════════════════════════════════╣
║ ℹ️  WARNINGS:                                                 ║
║   [SHIPMENTS] 37 shipments (3%) missing products_sold        ║
║   [RETURNS] 3 returns (6%) missing return_date               ║
╚══════════════════════════════════════════════════════════════╝
```

### Cron Job Integration

The validation is called in Step 4.5 of the invoice generation flow:

```typescript
// In app/api/cron/generate-invoices/route.ts

// Step 4: Collect billing transactions
let lineItems = await collectBillingTransactionsByInvoiceIds(client.id, shipbobInvoiceIds)

// Step 4.5: Run pre-flight validation
const validation = await runPreflightValidation(adminClient, client.id, shipbobInvoiceIds)
validationResults.push({ client: client.company_name, validation })

if (!validation.passed) {
  errors.push({ client: client.company_name, error: `Pre-flight validation failed` })
  continue  // Skip to next client
}

// Step 5: Apply markups (only if validation passed)
lineItems = await applyMarkupsToLineItems(client.id, lineItems)
```

### Response Output

The cron job response includes validation results for each client:

```json
{
  "success": true,
  "generated": 2,
  "preflightValidation": [
    {
      "client": "Henson Shaving",
      "passed": true,
      "issues": 0,
      "warnings": 2,
      "summary": { /* detailed field counts */ }
    },
    {
      "client": "Methyl-Life",
      "passed": true,
      "issues": 0,
      "warnings": 1,
      "summary": { /* detailed field counts */ }
    }
  ]
}
```

### Data Population Scripts

If validation fails due to missing data, these scripts can backfill:

| Missing Data | Script | Notes |
|--------------|--------|-------|
| SFTP breakdown | `scripts/apply-sftp-breakdown.js` | Reads from SFTP CSV |
| Timeline events | `scripts/backfill-timeline-fast.js` | Fetches from ShipBob API |
| Shipment items | `scripts/backfill-shipment-items.js <days>` | Fetches product data |
| Returns data | `scripts/sync-returns.js` | Syncs Returns API |

---

## File Storage

**Location:** Supabase Storage
```
invoices/
  {client_id}/
    JPHS-0038-120825.pdf
    JPHS-0038-120825.xlsx
```

**Future:** Mirror to Google Drive (integration TBD)

---

## Database Migrations Required

### 1. Rename existing invoices table
```sql
ALTER TABLE invoices RENAME TO invoices_shipbob;
```

### 2. Add client billing fields
```sql
ALTER TABLE clients ADD COLUMN short_code TEXT;
ALTER TABLE clients ADD COLUMN billing_period TEXT DEFAULT 'weekly';
ALTER TABLE clients ADD COLUMN billing_terms TEXT DEFAULT 'due_on_receipt';
ALTER TABLE clients ADD COLUMN invoice_email_note TEXT;
ALTER TABLE clients ADD COLUMN next_invoice_number INTEGER DEFAULT 1;
ALTER TABLE clients ADD COLUMN billing_email TEXT;

-- Backfill existing clients
UPDATE clients SET short_code = 'HS', next_invoice_number = 38 WHERE company_name ILIKE '%henson%';
UPDATE clients SET short_code = 'ML', next_invoice_number = 22 WHERE company_name ILIKE '%methyl%';
```

### 3. Add markup columns to transactions table (COMPLETED Dec 2025)
```sql
-- Phase 1: Renamed amount to cost (our cost from ShipBob)
ALTER TABLE transactions RENAME COLUMN amount TO cost;

-- Phase 2: Renamed charge to total_charge, added insurance_charge
ALTER TABLE transactions RENAME COLUMN charge TO total_charge;
ALTER TABLE transactions ADD COLUMN insurance_charge NUMERIC(12,2);

-- Phase 3: Consolidated line_items into transactions (Dec 7, 2025)
-- See migration: scripts/migrations/014-consolidate-line-items-to-transactions.sql
ALTER TABLE transactions ADD COLUMN markup_applied NUMERIC DEFAULT 0;
ALTER TABLE transactions ADD COLUMN billed_amount NUMERIC;
ALTER TABLE transactions ADD COLUMN markup_percentage NUMERIC DEFAULT 0;
ALTER TABLE transactions ADD COLUMN markup_rule_id UUID REFERENCES markup_rules(id);

-- Dropped old unused columns
ALTER TABLE transactions DROP COLUMN markup_amount;
ALTER TABLE transactions DROP COLUMN markup_percent;

-- Dropped redundant table
DROP TABLE invoices_jetpack_line_items;
```

**Column Summary (see "Financial Column Structure" section for full details):**

For **Shipments**:
- `cost` - Our total cost from ShipBob API (internal only)
- `base_cost` - Base shipping cost from SFTP (internal only, gets marked up)
- `base_charge` - Marked up base cost = `base_cost × (1 + markup%)` (client sees as "Base Fulfillment Charge")
- `surcharge` - Carrier surcharges from SFTP (passed through at cost, no markup)
- `total_charge` - `base_charge + surcharge` (client sees as "Total Charge")
- `insurance_cost` - Insurance cost from SFTP (internal only, gets marked up)
- `insurance_charge` - Marked up insurance = `insurance_cost × (1 + markup%)` (client sees as "Insurance")
- `billed_amount` - `total_charge + insurance_charge` (universal total for any transaction type)

For **Non-Shipments**:
- `cost` - Our cost from ShipBob API (internal only)
- `billed_amount` - `cost × (1 + markup%)` (client sees as "Total Charge")
- All breakdown columns (`base_cost`, `base_charge`, `surcharge`, `total_charge`, `insurance_cost`, `insurance_charge`) are NULL

**⚠️ DELETED:** The old `billing_*` tables have been permanently deleted (Dec 5, 2025). All billing data is now in the `transactions` table.

### 4. Create markup history table
```sql
CREATE TABLE markup_rule_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  markup_rule_id UUID NOT NULL REFERENCES markup_rules(id),
  changed_by UUID,  -- auth.users reference
  change_type TEXT NOT NULL,  -- 'created', 'updated', 'deactivated'
  previous_values JSONB,
  new_values JSONB,
  change_reason TEXT,
  changed_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE markup_rule_history ENABLE ROW LEVEL SECURITY;
```

### 5. Create Jetpack invoices table
```sql
CREATE TABLE invoices_jetpack (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id),

  -- Invoice identification
  invoice_number TEXT NOT NULL UNIQUE,  -- JPHS-0038-120825
  invoice_date DATE NOT NULL,

  -- Billing period
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,

  -- Amounts
  subtotal DECIMAL(12,2) NOT NULL,
  total_markup DECIMAL(12,2) NOT NULL,
  total_amount DECIMAL(12,2) NOT NULL,

  -- Files
  pdf_path TEXT,
  xlsx_path TEXT,

  -- Workflow
  status TEXT NOT NULL DEFAULT 'draft',
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  approval_notes TEXT,

  -- Regeneration
  version INTEGER DEFAULT 1,
  replaced_by UUID REFERENCES invoices_jetpack(id),
  regeneration_locked_at TIMESTAMPTZ,  -- 24 hours after generated_at

  -- Email tracking
  email_sent_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE invoices_jetpack ENABLE ROW LEVEL SECURITY;
```

**Note:** Line items are NOT stored in a separate table. When transactions are invoiced, their markup data is stored directly on the `transactions` table:
- `invoiced_status_jp` = true
- `jetpack_invoice_id` = Human-readable invoice number (e.g., "JPHS-0038-120825") - TEXT field, NOT a UUID
- `markup_percentage` = the percentage applied (e.g., 0.18 for 18%)
- `markup_rule_id` = reference to the markup rule used
- `markup_applied` = dollar amount of markup

**⚠️ Invoice Identifier Decision (Dec 2025):**
We use the human-readable `invoice_number` (e.g., "JPHS-0038-120825") as the primary identifier instead of UUIDs:
- `invoices_jetpack.invoice_number` = Primary key / unique identifier (TEXT)
- `transactions.jetpack_invoice_id` = Direct text reference to invoice_number
- Join: `transactions.jetpack_invoice_id = invoices_jetpack.invoice_number`
- **Rationale:** Simpler, human-readable, no UUID lookups needed, easier debugging

**For Shipments:**
- `base_charge` = base_cost × (1 + markup_percentage)
- `total_charge` = base_charge + surcharge
- `insurance_charge` = insurance_cost × (1 + markup_percentage)
- `billed_amount` = total_charge + insurance_charge

**For Non-Shipments:**
- `billed_amount` = cost × (1 + markup_percentage)

---

## Transaction Sync & Invoicing Workflow (Dec 2025)

### Overview

Two-phase approach that solves the 7-day data retention limit:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 1: CONTINUOUS SYNC (every 15-30 min)                                 │
│  POST /transactions:query → transactions table                              │
│                                                                             │
│  • Captures pending transactions before 7-day expiry                        │
│  • Links to shipments via reference_id for context                          │
│  • Powers "Transactions" tab (running unbilled totals)                      │
│  • Uses FILTER STRATEGY to bypass 250/1000 record caps                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 2: MONDAY 6PM EST INVOICE VERIFICATION                               │
│                                                                             │
│  1. GET /invoices → Fetch new week's ShipBob invoices                       │
│  2. GET /invoices/{id}/transactions → Official invoice transactions         │
│  3. Match against DB, attach invoice_id + invoice_date                      │
│  4. Verify counts match ShipBob's totals                                    │
│  5. Generate Jetpack invoices ONLY for verified charges                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Correct API Usage (Dec 4, 2025 - IMPORTANT!)

**⚠️ The ShipBob billing guide has WRONG parameter names!**

| Documented (WRONG) | Actual (CORRECT) |
|--------------------|------------------|
| `start_date` | `from_date` |
| `end_date` | `to_date` |
| `limit` | `page_size` |

**Working Code:**
```javascript
async function getAllPendingTransactions() {
  const allItems = []
  let cursor = null

  do {
    // Cursor goes in QUERY string, not body
    let url = `${BASE_URL}/2025-07/transactions:query`
    if (cursor) url += `?Cursor=${encodeURIComponent(cursor)}`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        invoiced_status: false,  // Unbilled only
        page_size: 1000,         // Max allowed
        // Optional date range:
        // from_date: '2025-12-01T00:00:00Z',
        // to_date: '2025-12-04T23:59:59Z',
      })
    })

    const data = await response.json()
    allItems.push(...(data.items || []))
    cursor = data.next || null
  } while (cursor)

  return allItems
}
```

**Results (tested Dec 4, 2025):**
| Query | Transactions | Notes |
|-------|--------------|-------|
| Unbilled only | **2,629** | Dec 1-4 pending |
| All transactions | 6,448 | Nov 27 - Dec 4 |
| Date range Dec 1-4 | 2,759 | With from_date/to_date |

**By date (unbilled):**
- Dec 1: 704
- Dec 2: 789
- Dec 3: 692
- Dec 4: 444

**Script:** `scripts/test-correct-api-params.js`

### Reference Type Attribution

| reference_type | Links To | Attribution |
|----------------|----------|-------------|
| `Shipment` | shipments.shipment_id | Direct JOIN |
| `Default` | shipments.shipment_id | Direct JOIN (same as Shipment) |
| `WRO` | warehouse receiving orders | Separate WRO table lookup |
| `FC Transfer` | storage charges | No shipment link (FC = fulfillment center) |
| `TicketNumber` | support tickets | Manual review (credits/adjustments) |

### Monday Verification Logic

```javascript
async function verifyInvoiceTransactions(invoiceId, invoiceTotal) {
  // 1. Get official transactions from invoice endpoint
  const officialTxns = await getAllInvoiceTransactions(invoiceId)
  const officialTotal = officialTxns.reduce((sum, t) => sum + t.amount, 0)

  // 2. Match against our synced data
  const matched = []
  const missing = []
  for (const t of officialTxns) {
    const dbRecord = await findInDB(t.transaction_id)
    if (dbRecord) {
      // Update with invoice_id
      await updateTransaction(t.transaction_id, { invoice_id: invoiceId })
      matched.push(t)
    } else {
      // Missing from our sync - log for investigation
      missing.push(t)
    }
  }

  // 3. Verify totals match
  const isValid = Math.abs(officialTotal - invoiceTotal) < 0.01
  if (!isValid || missing.length > 0) {
    await flagForReview(invoiceId, { missing, totalMismatch: !isValid })
  }

  return { matched, missing, isValid }
}
```

### Sync Frequency Considerations

| Volume | Recommended Frequency | Reason |
|--------|----------------------|--------|
| <500 pending/day | Every 30 min | Well under caps |
| 500-1000/day | Every 15 min | Approaching caps |
| >1000/day | Every 10 min + Excel backup | Need filter strategy |

**Current state (Dec 2025):** ~250-300 pending transactions at any time. Hourly sync is safe for now, but should move to 15-30 min as volume grows.

### Fallback: Excel Import

If API caps become unworkable:
1. Daily manual Excel export from ShipBob dashboard
2. Import script to upsert transactions
3. Monday cron still verifies against invoice API

---

## Technical Implementation

### Libraries
- **PDF:** `@react-pdf/renderer`
- **XLS:** `exceljs`
- **Cron:** Vercel Cron (`/api/cron/generate-invoices`)

### Key Files
```
/lib/billing/
  markup-engine.ts      # Markup calculation logic
  invoice-generator.ts  # PDF + XLS generation
  email-sender.ts       # Invoice email delivery

/app/api/cron/
  generate-invoices/route.ts  # Weekly cron job

/app/dashboard/admin/
  page.tsx              # Admin section
  markup-tables/        # Markup management UI
  invoicing/            # Invoice workflow UI
```

### Markup Engine API
```typescript
interface MarkupResult {
  baseAmount: number;
  markupAmount: number;
  billedAmount: number;
  ruleId: string | null;
  markupPercentage: number;
}

function calculateMarkup(
  transaction: BillingTransaction,
  clientId: string,
  transactionDate: Date
): MarkupResult;

function findMatchingRules(
  feeType: string,
  clientId: string,
  date: Date,
  conditions?: { weight?: number; state?: string; shipOption?: string }
): MarkupRule[];
```

---

## Historical Data Backfill

### Source Data
1. **ShipBob costs:** All in `transactions` table via API sync (147K+ records)
2. **Billed amounts:** From Excel invoices since inception

### Strategy
1. Import Excel invoices to get actual billed amounts
2. Calculate implied markup for each transaction
3. Create markup rules that match historical patterns
4. Validate by regenerating old invoices and comparing to PDFs

### Files to Import
```
reference/invoices/
  henson/
    JPHS-0001-*.xlsx through JPHS-0037-*.xlsx
  methyl-life/
    JPML-0001-*.xlsx through JPML-0021-*.xlsx
```

---

## Admin UI Structure

### Navigation
```
/dashboard/admin
  ├── Markup Tables (Tab 1)
  │   ├── Rules list grouped by client
  │   ├── Create/Edit rule modal
  │   ├── Deactivate with reason
  │   └── View change history
  │
  └── Run Invoicing (Tab 2)
      ├── Pre-flight Validation Card (collapsible)
      │   ├── Summary badges: Failed/Warnings/Passed counts
      │   ├── Per-client validation details
      │   └── Field-level issue breakdown
      │
      ├── Pending Approval Section
      │   ├── Draft invoices table
      │   ├── View button (dropdown: PDF/XLSX)
      │   ├── Re-Run button (regenerate with fresh data)
      │   ├── Approve button (per invoice)
      │   └── Approve All button
      │
      └── Recent Invoices Section
          ├── Approved/sent invoices table
          └── Download button (dropdown: PDF/XLSX)
```

### Admin API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/admin/invoices` | GET | List all Jetpack invoices |
| `/api/admin/invoices/generate` | POST | Generate draft invoices for current week |
| `/api/admin/invoices/preflight` | GET | Run pre-flight validation for all clients |
| `/api/admin/invoices/[invoiceId]/files` | GET | Get signed URLs for PDF/XLSX files |
| `/api/admin/invoices/[invoiceId]/approve` | POST | Approve a draft invoice |
| `/api/admin/invoices/[invoiceId]/regenerate` | POST | Regenerate a draft invoice |
| `/api/admin/markup-rules` | GET/POST | List or create markup rules |
| `/api/admin/markup-rules/[ruleId]` | GET/PATCH | Get or update a markup rule |
| `/api/admin/markup-rules/[ruleId]/deactivate` | POST | Deactivate a markup rule |

### Confirmation Dialogs

All destructive actions require confirmation:
- **Approve Invoice**: "This will finalize the invoice and mark it as approved. Once approved, invoices cannot be modified."
- **Approve All**: "This will approve N draft invoice(s) and mark them as finalized."
- **Regenerate Invoice**: "This will regenerate the invoice with fresh data, recalculate markups, and create new PDF/XLSX files."

### Invoice Files

Files are stored in Supabase Storage and accessed via signed URLs:
```
invoices/{client_id}/
  {invoice_number}.pdf
  {invoice_number}.xlsx
```

Signed URLs are valid for 1 hour (3600 seconds).

### Client-Facing
```
/dashboard/invoices
  ├── Invoice list (approved only)
  ├── Download PDF / XLS
  └── Payment status
```

---

## Testing Checklist

- [ ] Markup rules apply correctly by priority
- [ ] Effective dates respected for historical lookups
- [ ] Credits handled correctly (shipping vs product)
- [ ] Storage periods detected and labeled
- [ ] Invoice numbers increment correctly
- [ ] PDF matches existing format
- [ ] XLS matches existing format
- [ ] Regeneration creates new version
- [ ] 24-hour lock enforced
- [ ] Email sends with correct content
- [ ] Past-due warning appears when needed

---

*This file documents the billing and invoicing system. Update when making changes to markup logic, invoice format, or billing workflows.*
