# Billing System Testing Guide

**Purpose:** Self-contained guide for testing and validating the markup engine and invoice generator before Monday's first real invoice run.

**IMPORTANT:** This file contains ALL context needed. Do NOT read other CLAUDE.* files - that wastes context.

---

## System Overview

Jetpack bills clients by:
1. Receiving raw costs from ShipBob (stored in `transactions` table)
2. Fetching shipping breakdown from SFTP (base_cost, surcharge, insurance_cost)
3. Applying markup rules per transaction type
4. Generating XLSX (6 sheets) + PDF summary
5. Storing files in Supabase Storage

**Monday Cron Job:** `/api/cron/generate-invoices` runs at 5am PT every Monday.

---

## ⚠️ CRITICAL: Source of Truth for Invoice Attribution

**DO NOT** use `charge_date` ranges to collect transactions for invoices. Timezone issues make this unreliable.

**Source of Truth:** `invoices_sb.jetpack_invoice_id IS NULL`

**CORRECT approach:**
1. Query `invoices_sb` for ALL unprocessed ShipBob invoices (where `jetpack_invoice_id IS NULL`)
   - **⚠️ DO NOT filter by client_id** - ShipBob invoices are at PARENT TOKEN level (shared across all clients)
   - **⚠️ Filter out Payment type:** `.neq('invoice_type', 'Payment')` - not billable
2. Get the `shipbob_invoice_id` values from those invoices (TEXT column, convert to INT for tx query)
3. For EACH client: Query `transactions` by those `invoice_id_sb` values AND `client_id` **WITH PAGINATION**
4. Generate Jetpack invoice for each client with transactions
5. AFTER all clients processed: Mark ShipBob invoices with invoice number(s): `SET jetpack_invoice_id = 'JPHS-0037, JPML-0021'`

**Why:** Every transaction has an `invoice_id_sb` linking it to a ShipBob invoice. ShipBob generates 5-6 invoices per week (Shipping, Storage, Returns, etc.). These invoices are at the parent token level, covering all merchants. This matches how billing is done manually - take the newly generated ShipBob invoices and bill for those specific transactions.

**Secondary tracking:** `transactions.invoiced_status_jp` is a denormalized convenience field (NOT the source of truth).

---

## ⚠️ CRITICAL: Supabase Pagination (1000 Row Limit)

**Supabase returns MAX 1000 rows by default!** If you see exactly 1000 transactions, pagination is broken.

**EVERY transaction query MUST use pagination:**
```javascript
// CORRECT - with pagination
const allTransactions = []
for (const invoiceId of shipbobInvoiceIds) {
  let offset = 0
  while (true) {
    const { data: batch } = await supabase
      .from('transactions')
      .select('*')
      .eq('client_id', clientId)
      .eq('invoice_id_sb', invoiceId)
      .range(offset, offset + 999)

    if (!batch || batch.length === 0) break
    allTransactions.push(...batch)
    if (batch.length < 1000) break
    offset += 1000
  }
}
```

**WRONG - will silently truncate at 1000 rows:**
```javascript
// WRONG - no pagination!
const { data } = await supabase
  .from('transactions')
  .select('*')
  .eq('client_id', clientId)
  .in('invoice_id_sb', invoiceIds)  // Silently limited to 1000!
```

**Real example:** Henson Dec 1 week has 3,543 transactions. Without pagination you'd only get 1,000 and lose $4,000+ in billing.

---

## Database Schema (Key Tables)

### transactions (Source of Truth)

**Basic Identification:**
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `client_id` | UUID | FK to clients |
| `transaction_id` | TEXT | ShipBob's unique ID |
| `reference_id` | TEXT | Shipment ID, WRO ID, Return ID, etc. |
| `reference_type` | TEXT | `Shipment`, `FC`, `Return`, `WRO`, `Default` |
| `transaction_fee` | TEXT | `Shipping`, `Per Pick Fee`, `Credit`, etc. |
| `invoice_id_sb` | INT | ShipBob invoice ID |

**⚠️ Financial Columns - CRITICAL DISTINCTION:**

**For SHIPMENTS (`reference_type='Shipment'`, `transaction_fee='Shipping'`):**
| Column | Source | Description | Client Sees? |
|--------|--------|-------------|--------------|
| `cost` | ShipBob API | Total cost to us | NO (internal) |
| `base_cost` | SFTP | Base shipping cost (NOT marked up) | NO (internal) |
| `base_charge` | Calculated | `base_cost × (1 + markup%)` | YES - "Base Fulfillment Charge" |
| `surcharge` | SFTP | Carrier surcharges (NO markup) | YES - "Surcharges" |
| `total_charge` | Calculated | `base_charge + surcharge` | YES - "Total Charge" |
| `insurance_cost` | SFTP | Insurance cost (NOT marked up) | NO (internal) |
| `insurance_charge` | Calculated | `insurance_cost × (1 + markup%)` | YES - "Insurance" |
| `billed_amount` | Calculated | `total_charge + insurance_charge` | YES (summary) |

**For NON-SHIPMENTS (all other transaction types):**
| Column | Source | Description | Client Sees? |
|--------|--------|-------------|--------------|
| `cost` | ShipBob API | Cost to us | NO (internal) |
| `billed_amount` | Calculated | `cost × (1 + markup%)` | YES - "Total Charge" |
| All breakdown cols | NULL | Not applicable for non-shipments | - |

**Internal-Only Columns (NEVER show to client):**
| Column | Description |
|--------|-------------|
| `markup_applied` | Dollar amount of markup |
| `markup_percentage` | Percentage applied (e.g., 0.18 for 18%) |
| `markup_rule_id` | Reference to markup_rules.id |

**`billed_amount` = Universal Total:** Always use this for "total charged to client" regardless of transaction type.

### shipments (For ship_option_id lookup)
| Column | Type | Description |
|--------|------|-------------|
| `shipment_id` | INT | Primary key - matches `transactions.reference_id` |
| `ship_option_id` | INT | Carrier service ID (e.g., 146 = USPS Priority) |
| `carrier_name` | TEXT | Carrier name |
| `carrier_service_name` | TEXT | Service name |

**CRITICAL JOIN:** To apply ship_option_id-based markup rules, you MUST join:
```sql
SELECT t.*, s.ship_option_id
FROM transactions t
LEFT JOIN shipments s ON t.reference_id = CAST(s.shipment_id AS TEXT)
WHERE t.reference_type = 'Shipment' AND t.transaction_fee = 'Shipping'
```
**DO NOT** look for ship_option_id in `transactions.additional_details` - it's NOT there!

### markup_rules
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `client_id` | UUID | NULL = global, UUID = client-specific |
| `name` | TEXT | Human-readable name |
| `billing_category` | TEXT | `shipments`, `shipment_fees`, `storage`, etc. |
| `fee_type` | TEXT | `Standard`, `Per Pick Fee`, etc. |
| `ship_option_id` | TEXT | Specific shipping service (e.g., "146") |
| `markup_type` | TEXT | `percentage` or `fixed` |
| `markup_value` | NUMERIC | The markup value |
| `is_active` | BOOL | Whether rule is active |

### invoices_sb (ShipBob's invoices to us - SOURCE OF TRUTH)
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `shipbob_invoice_id` | TEXT | ShipBob's invoice ID (convert to INT for tx query) |
| `invoice_type` | TEXT | `Shipping`, `AdditionalFee`, `ReturnsFee`, `WarehouseInboundFee`, `WarehouseStorage`, `Credits`, `Payment` |
| `invoice_date` | DATE | Invoice date from ShipBob |
| `base_amount` | DECIMAL | Total amount from ShipBob |
| `jetpack_invoice_id` | TEXT | Jetpack invoice number(s) - **NULL = not yet processed** |

**Key:** Query `WHERE jetpack_invoice_id IS NULL AND invoice_type != 'Payment'` to find unprocessed billable invoices.

**IMPORTANT:**
- ShipBob invoices are at PARENT TOKEN level (shared across all clients). Do NOT filter by `client_id`.
- `shipbob_invoice_id` is TEXT but `transactions.invoice_id_sb` is INTEGER - convert with `parseInt()`.
- `Payment` type invoices are NOT billable - filter them out.
- The `jetpack_invoice_id` stores invoice number(s) like `JPHS-0037-120125, JPML-0021-120125` (comma-separated).

**⚠️ WARNING:** There's also an `invoices_shipbob` table (created by seed script) - DO NOT USE IT. Use `invoices_sb`.

### invoices_jetpack (Our invoices to clients)
| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Primary key |
| `client_id` | UUID | FK to clients |
| `invoice_number` | TEXT | e.g., `JPHS-0038-120825` |
| `period_start` | DATE | Billing period start (derived from transaction dates) |
| `period_end` | DATE | Billing period end |
| `subtotal` | NUMERIC | Sum of raw costs |
| `total_markup` | NUMERIC | Sum of markups |
| `total_amount` | NUMERIC | Final invoice total |
| `status` | TEXT | `draft`, `pending_approval`, `approved` |
| `xlsx_path` | TEXT | Path in Supabase Storage |
| `pdf_path` | TEXT | Path in Supabase Storage |

---

## Current Clients

| Client | ID | Short Code | Merchant ID | Next Invoice # |
|--------|-----|------------|-------------|----------------|
| Henson Shaving | `6b94c274-0446-4167-9d02-b998f8be59ad` | HS | 386350 | 38 |
| Methyl-Life | `ca33dd0e-bd81-4ff7-88d1-18a3caf81d8e` | ML | 392333 | 22 |

---

## Markup Rules

**CRITICAL: Never hardcode markup values. Always query from database.**

### How to Get Current Rules
```sql
SELECT name, client_id, billing_category, fee_type, ship_option_id,
       markup_type, markup_value, is_active
FROM markup_rules
WHERE is_active = true
ORDER BY client_id, billing_category, fee_type;
```

### Rule Structure
| Field | Description |
|-------|-------------|
| `client_id` | NULL = global rule, UUID = client-specific |
| `billing_category` | `shipments`, `shipment_fees`, `storage`, `returns`, `receiving`, `credits`, `insurance` |
| `fee_type` | e.g., `Standard`, `Per Pick Fee`, `Inventory Placement Program Fee` |
| `ship_option_id` | Specific carrier service (e.g., "146" for USPS Priority) |
| `markup_type` | `percentage` or `fixed` |
| `markup_value` | The markup (e.g., 14.0 for 14%, or 0.04 for $0.04 fixed) |

### Rule Selection: "Most Conditions Wins"
When multiple rules match a transaction, the most specific rule wins:
1. Client-specific beats global
2. More conditions (fee_type + ship_option_id) beats fewer
3. If still tied, first created wins

### Categories with No Rules = Pass-Through
If no rule matches, the transaction passes through at 0% markup (billed amount = raw cost).

---

## Reference Invoice: JPHS-0037

**Location:** `reference/invoiceformatexamples/INVOICE-DETAILS-JPHS-0037-120125.xlsx`
**Period:** Nov 24 - Nov 30, 2025
**Invoice IDs:** `8633612, 8633618, 8633632, 8633634, 8633637, 8633641`

### Expected Row Counts and Totals

**VERIFIED Dec 6, 2025:** All row counts match exactly between DB and reference XLSX.

| Category | DB Raw Cost | Count | Reference Marked-Up Total |
|----------|-------------|-------|---------------------------|
| Shipments | $8,329.54 | 1,435 | $9,715.24 |
| Additional Services | $674.35 | 1,112 | $765.95 |
| Storage | $998.41 | 981 | $997.94 |
| Returns | $14.79 | 3 | $14.79 |
| Receiving | $35.00 | 1 | $35.00 |
| Credits | -$686.12 | 11 | -$686.12 |
| **TOTAL** | **$9,365.97** | **3,543** | **$10,842.80** |

**Note:** Reference XLSX has header row (row 1) + data rows + "Total" row at bottom of each sheet. When counting, exclude both header and total rows.

### Validation Notes for JPHS-0037
These totals are **historical reference data** for validating our invoice generator against a known-good invoice. When testing:
1. **Do NOT hardcode these values** - run transactions through the markup engine
2. **Query current rules** from `markup_rules` table at test time
3. **Compare output totals** against this reference to validate the flow works
4. If totals don't match, the markup engine or invoice generator has a bug

---

## XLSX Sheet Structure (6 Tabs)

### 1. Shipments
```
Columns: User ID, Merchant Name, Customer Name, StoreIntegrationName, OrderID,
         Transaction Type, Transaction Date, Store OrderID, TrackingId,
         Fulfillment without Surcharge (base_charge), Surcharge Applied,
         Original Invoice (total_charge), Insurance Amount,
         Products Sold, Total Quantity, Ship Option ID, Carrier, Carrier Service,
         Zone Used, Actual Weight, Dim Weight, Billable Weight,
         Length, Width, Height, Zip Code, City, State, Country,
         Order Insert Timestamp, Label Generation Timestamp, Delivered Date,
         Transit Time, FC Name, Order Category
```
**Key:** `OrderID` column = `reference_id` (shipment ID)

### 2. Additional Services
```
Columns: User ID, Merchant Name, Reference ID, Fee Type, Invoice Amount, Transaction Date
```
**Key:** Includes Per Pick Fee, IPP Fee, Kitting Fee, etc.

### 3. Returns
```
Columns: User ID, Merchant Name, Return ID, Original Order ID, Tracking ID,
         Invoice, Transaction Type, Return Status, Return Type, Return Creation Date, FC Name
```

### 4. Receiving
```
Columns: User ID, Merchant Name, Reference ID, Fee Type, Invoice Amount,
         Transaction Type, Transaction Date
```

### 5. Storage
```
Columns: Merchant Name, ChargeStartdate, FC Name, Inventory ID,
         Location Type, Comment, Invoice
```
**Key:** `Inventory ID` = parsed from `reference_id` (format: `FC-InventoryID-LocationType`)

### 6. Credits
```
Columns: User ID, Merchant Name, Reference ID, Transaction Date,
         Credit Reason, Credit Amount
```

---

## Charge Formulas

### For Shipments (with SFTP breakdown data)
```
base_charge = base_cost + (base_cost × markup_percent)
surcharge_charge = surcharge  // Pass-through at 0%
insurance_charge = insurance_cost  // Pass-through (no rule yet)
total_charge = base_charge + surcharge_charge
```

### For Shipments (without SFTP data)
```
total_charge = cost + (cost × markup_percent)
```
*Fallback when SFTP file is missing*

### For Additional Services (Per Pick Fee)
```
total_charge = cost × (1 + markup_percent / 100)  // e.g., $0.26 × 1.153846 = $0.30
```
**Note:** Per Pick Fee uses PERCENTAGE markup (15.3846%), not fixed amount.
This ensures multi-pick orders scale correctly: 1 pick = $0.30, 2 picks = $0.60, 3 picks = $0.90.

### For Everything Else (no rule)
```
total_charge = cost  // Pass-through
```

---

## SFTP Breakdown File

**Filename:** `extras-MMDDYY.csv` (e.g., `extras-120825.csv` for Dec 8, 2025)
**Location:** `/shipbob-data/` on SFTP server
**Timing:** ShipBob uploads by Sunday night before Monday invoice run

### CSV Columns
| CSV Column | Maps To | Description |
|------------|---------|-------------|
| OrderID | `reference_id` | Shipment ID for matching |
| Fulfillment without Surcharge | `base_cost` | Gets marked up |
| Surcharge Applied | `surcharge` | Pass-through |
| Insurance Amount | `insurance_cost` | Pass-through (for now) |
| Original Invoice | validation | Should = base + surcharge |

### Environment Variables
```bash
SFTP_HOST=us-east-1.sftpcloud.io
SFTP_PORT=22
SFTP_USERNAME=shipbob
SFTP_PASSWORD=...
SFTP_REMOTE_PATH=/shipbob-data
```

---

## Monday Cron Workflow (Exact Sequence)

The cron job at `/api/cron/generate-invoices` does this:

### Step 1: Fetch SFTP Breakdown (if available)
```javascript
const sftpResult = await fetchShippingBreakdown(invoiceDate)
// Looks for: extras-MMDDYY.csv

if (sftpResult.success) {
  await updateTransactionsWithBreakdown(adminClient, sftpResult.rows)
  // Updates base_cost, surcharge, insurance_cost on matching transactions
}
```

### Step 2: Get ALL Unprocessed ShipBob Invoices (PARENT TOKEN level)
```javascript
// ⚠️ DO NOT filter by client_id - ShipBob invoices are shared across all clients
// ⚠️ Filter out Payment type - not billable
const { data: unprocessedInvoices } = await supabase
  .from('invoices_sb')  // NOT invoices_shipbob!
  .select('id, shipbob_invoice_id, invoice_type, base_amount')
  .is('jetpack_invoice_id', null)  // Not yet processed
  .neq('invoice_type', 'Payment')  // Exclude non-billable

if (!unprocessedInvoices || unprocessedInvoices.length === 0) return  // Nothing to invoice

// Convert TEXT to INTEGER for transactions query
const shipbobInvoiceIds = unprocessedInvoices
  .map(inv => parseInt(inv.shipbob_invoice_id, 10))
  .filter(id => !isNaN(id))
// e.g., [8633612, 8633618, 8633632, 8633634, 8633637, 8633641]
```

### Step 3: For Each Active Client
```javascript
for (const client of clients) {
  // 3a. Collect transactions by ShipBob invoice IDs AND client_id
  // ⚠️ MUST USE PAGINATION - Supabase limits to 1000 rows!
  const lineItems = await collectBillingTransactionsByInvoiceIds(client.id, shipbobInvoiceIds)

  if (lineItems.length === 0) continue  // No transactions for this client this week

  // 3b. Apply markup rules (with ship_option_id lookup)
  lineItems = await applyMarkupsToLineItems(client.id, lineItems)

  // 3c. Calculate period from transaction dates (for display only)
  const periodStart = minDate(lineItems)
  const periodEnd = maxDate(lineItems)

  // 3d. Generate invoice number
  const invoiceNumber = `JP${client.short_code}-${nextNum.padStart(4,'0')}-${MMDDYY}`
  // e.g., JPHS-0037-120125

  // 3e. Create invoice record in invoices_jetpack table
  // 3f. Generate XLSX with 6 sheets
  // 3g. Generate PDF summary
  // 3h. Upload to Supabase Storage

  // 3i. Mark transactions as invoiced AND save markup data to transactions table
  // This updates: invoiced_status_jp, invoice_id_jp, markup_applied, billed_amount, markup_percentage, markup_rule_id
  await markTransactionsAsInvoiced(lineItems, invoice.id)

  // 3k. Increment client.next_invoice_number
}
```

### Step 4: Mark ShipBob Invoices as Processed (AFTER all clients)
```javascript
// Mark ALL ShipBob invoices with the generated Jetpack invoice numbers
// e.g., "JPHS-0037-120125, JPML-0021-120125"
const invoiceNumbers = generatedInvoices.map(i => i.invoiceNumber).join(', ')

await supabase
  .from('invoices_sb')  // NOT invoices_shipbob!
  .update({ jetpack_invoice_id: invoiceNumbers })
  .in('id', unprocessedInvoices.map(i => i.id))
```

**Key:** Source of truth is `invoices_sb.jetpack_invoice_id IS NULL`. Transaction collection uses ShipBob invoice IDs AND client_id **WITH PAGINATION**. ShipBob invoices are marked AFTER all clients are processed.

---

## Test Scripts

### 1. Test SFTP Connection
```bash
node scripts/test-sftp-connection.js
```
Verifies SFTP credentials work and lists available files.

### 2. Test Invoice Generation (Against Reference)
```bash
node scripts/test-invoice-generation.js
```
Generates XLSX for JPHS-0037 period and compares against reference.
- Output: `scripts/output/INVOICE-DETAILS-JPHS-0037-TEST.xlsx`
- Compares row counts and totals per category

### 3. Simulate Monday Cron (DRY RUN)
```bash
# Call the cron endpoint locally (requires CRON_SECRET)
curl -X GET "http://localhost:3000/api/cron/generate-invoices" \
  -H "Authorization: Bearer $CRON_SECRET"
```

### 4. Compare Generated vs Reference
```bash
node scripts/compare-xlsx-db-ids.js       # Compare IDs between XLSX and DB
node scripts/compare-invoice-xls.js       # Compare invoice XLS formats
node scripts/compare-invoice-marked-up.js # Compare marked-up amounts
```
Various comparison scripts for validating generated output against reference.

---

## Validation Checklist

### Pre-Monday Validation (Run These NOW)

- [ ] **SFTP Connection:** `node scripts/test-sftp-connection.js` returns file list
- [ ] **Row Counts Match:**
  - Shipments: 1,435
  - Additional Services: 1,112
  - Storage: 981
  - Returns: 3
  - Receiving: 1
  - Credits: 11
- [ ] **Totals Match (within $1):**
  - Shipments: ~$9,715.24
  - Additional Services: ~$765.95
  - Storage: ~$997.94
  - Returns: $14.79
  - Receiving: $35.00
  - Credits: -$686.12
- [x] **Markup Rules Applied:**
  - Shipping: 14% default, 18% for ship_option_id=146 (USPS Priority)
  - Per Pick Fee: 15.3846% (scales per pick: $0.26→$0.30)
  - Storage/Returns/Receiving: pass-through (no rules)
- [ ] **XLSX Format:**
  - 6 sheets with correct names
  - Column headers match reference
  - Currency formatting on amount columns
- [ ] **PDF Generated:** Summary page with totals by category

### Monday Morning Checklist

- [ ] SFTP file `extras-MMDDYY.csv` exists for this week
- [ ] Cron job triggered at 5am PT
- [ ] Both clients (Henson, Methyl-Life) generated invoices
- [ ] Invoice numbers correct: JPHS-0038, JPML-0022
- [ ] Files uploaded to Supabase Storage
- [ ] `invoices_jetpack` records created with status='draft'

---

## Key Implementation Files

| File | Purpose |
|------|---------|
| `lib/billing/markup-engine.ts` | Rule fetching, matching, calculation |
| `lib/billing/invoice-generator.ts` | Transaction collection, XLSX/PDF generation |
| `lib/billing/sftp-client.ts` | SFTP connection, CSV parsing |
| `app/api/cron/generate-invoices/route.ts` | Monday cron job |
| `scripts/test-invoice-generation.js` | Test against reference |

---

## ✅ Validation Status (Dec 6, 2025)

**Result: PASSING** - All categories match within acceptable rounding tolerances.

### Test Results from `scripts/test-invoice-amounts.js`:

| Category | Count | Our Total | Reference | Diff | Status |
|----------|-------|-----------|-----------|------|--------|
| Shipments | 1,435 ✓ | $9,714.54 | $9,715.24 | -$0.70 | ✓ Rounding |
| Additional Services | 1,112 ✓ | $765.95 | $765.95 | $0.00 | ✓ Exact |
| Storage | 981 ✓ | $998.41 | $997.94 | +$0.47 | ✓ Rounding |
| Returns | 3 ✓ | $14.79 | $14.79 | $0.00 | ✓ Exact |
| Receiving | 1 ✓ | $35.00 | $35.00 | $0.00 | ✓ Exact |
| Credits | 11 ✓ | -$686.12 | -$686.12 | $0.00 | ✓ Exact |
| **Grand Total** | **3,543 ✓** | **$10,842.57** | **$10,842.80** | **-$0.23** | **✓ Rounding** |

### Fixes Applied:
1. **ship_option_id lookup**: Added JOIN with `shipments` table in `invoice-generator.ts` to fetch `ship_option_id` for carrier-specific markup rules
2. **Per Pick Fee**: Changed from fixed +$0.04 to percentage 15.3846% to correctly scale multi-pick orders
3. **Surcharge handling**: Added `surcharge` field to InvoiceLineItem; shipments use `base_cost` for markup and add `surcharge` as pass-through
4. **Query by invoice_id_sb**: Created `collectBillingTransactionsByInvoiceIds()` and `collectDetailedBillingDataByInvoiceIds()` to query by ShipBob invoice ID instead of date range (avoids timezone issues)
5. **Source of truth**: `invoices_shipbob.jetpack_invoice_id IS NULL` determines what to invoice. Added `jetpack_invoice_id` column to `invoices_shipbob` table (migration 011). Cron queries unprocessed ShipBob invoices, not transactions directly.
6. **Parent token level**: Removed `client_id` filter from `invoices_shipbob` query - ShipBob invoices are shared across all clients. Mark ShipBob invoices AFTER all clients are processed.
7. **TEXT not UUID**: Changed `jetpack_invoice_id` from UUID to TEXT (migration 012) to store human-readable invoice numbers like `JPHS-0038-120825` instead of opaque UUIDs.

### Rounding Analysis:

**Shipments (-$0.70):** Accumulated per-row `Math.round()` across 1,435 shipments.
- 419 shipments at 14% markup → $1,969.00
- 1,016 shipments at 18% markup (ship_option_id=146) → $7,498.39
- Each row rounds to 2 decimal places; tiny differences accumulate

**Storage (+$0.47):** Source data precision difference.
- Reference XLSX uses full precision: $0.266700/day (= $8/month ÷ 30)
- ShipBob API returns rounded values: $0.27/day
- 32 inventory IDs affected, $0.03-$0.05 each

**Conclusion:** Both are inherent floating-point/source-data variances, NOT logic bugs. Grand total variance = 0.002%.

---

## Troubleshooting

### "No transactions found"
- Check date range: Are transactions in the billing period?
- Check `client_id`: Is it the correct UUID?
- Check `invoice_id_sb`: For historical invoices, filter by invoice ID instead of date

### "SFTP file not found"
- Filename format: `extras-MMDDYY.csv` (Monday's date, not period end)
- Path: `/shipbob-data/extras-MMDDYY.csv`
- Timing: ShipBob uploads Sunday night

### "Markup not applied" or "Wrong markup percentage"
- Check `markup_rules.is_active = true`
- Check `billing_category` matches (e.g., `shipments` not `shipping`)
- Check `fee_type` matches exactly (case-sensitive)
- **For ship_option_id rules:** You MUST JOIN transactions with shipments table!
  - `ship_option_id` is in `shipments` table, NOT in `transactions.additional_details`
  - Join: `transactions.reference_id = CAST(shipments.shipment_id AS TEXT)`
  - If you skip this join, all shipments get the default rule instead of ship-specific rules

### "Row counts don't match reference"
- **FIRST CHECK THIS:** Reference XLSX has a "Total" row at the bottom of each sheet. When counting rows, exclude BOTH the header row (row 1) AND the "Total" row (last row). Data rows are row 2 through (rowCount - 1).
- Use `sheet.eachRow((row, idx) => { if (idx > 1 && row.getCell(1).value !== 'Total') ... })` to skip both

### "Totals don't match reference"
- **FIRST CHECK THIS:** Are you accidentally including the "Total" row as a data row? See above.
- SFTP breakdown: Is `base_cost`/`surcharge` populated on transactions?
- Rounding: Use `Math.round(x * 100) / 100` for 2 decimal places
- Category mapping: Verify `reference_type` and `transaction_fee` logic

---

## Next Steps After Validation

1. **If all tests pass:** Monday cron will run automatically
2. **If tests fail:** Fix issues, re-run `test-invoice-generation.js`
3. **After first real invoice:** Compare output against historical pattern
4. **Future:** Add markup rules for Insurance, FBA, VAS categories

---

## Quick Reference: Transaction Categories

| reference_type | transaction_fee | XLSX Sheet | billing_category |
|----------------|-----------------|------------|------------------|
| Shipment | Shipping | Shipments | `shipments` |
| Shipment | Per Pick Fee | Additional Services | `shipment_fees` |
| Shipment | IPP Fee | Additional Services | `shipment_fees` |
| Shipment | (other fees) | Additional Services | `shipment_fees` |
| FC | * | Storage | `storage` |
| Return | * | Returns | `returns` |
| WRO | * | Receiving | `receiving` |
| Default | Credit | Credits | `credits` |

**Markup values come from `markup_rules` table - never hardcode them.**

---

---

## ✅ ULID Timestamp Discovery (Dec 6, 2025)

**KEY INSIGHT:** Transaction timestamps can be derived from ULID-formatted `transaction_id` for SOME transaction types.

The first 10 characters of a ULID encode a millisecond timestamp:

| Type | ULID Works? | What to Use | Notes |
|------|-------------|-------------|-------|
| **Credits** | ✅ YES | `decodeUlidTimestamp()` | Matches reference within 1ms |
| **Receiving** | ✅ YES | `decodeUlidTimestamp()` | Matches reference within 1ms |
| **Returns** | ❌ NO | `returns.insert_date` | ULID = completed_date, not insert_date |
| **Storage** | ❌ NO | `charge_date` | All ULIDs decode to period end date |

**Implementation:** `decodeUlidTimestamp()` function in `lib/billing/invoice-generator.ts`:
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
- Returns API `/1.0/return/{id}` has `insert_date` (creation) and `completed_date` (completion)
- ULID decodes to `completed_date`, NOT `insert_date`
- Reference XLSX "Return Creation Date" = `insert_date` (1ms accuracy)
- Our `returns` table stores `insert_date` from sync
- `collectDetailedBillingData()` joins with `returns` table to get timestamp

---

## 🔄 Event Column Backfill Status (Dec 6, 2025)

**Status:** Running in background

| Column | Shipments with Data | Percentage |
|--------|---------------------|------------|
| event_labeled | 11,824 | 16% |
| event_intransit | 10,313 | 14% |
| event_delivered | 10,149 | 14% |
| event_logs | 11,775 | 16% |
| **Total Shipments** | **74,158** | - |

**Backfill Progress:**
- Script: `scripts/backfill-timeline-fast.js` (multi-worker, ~6.8/sec)
- Processing: ~62,000 shipments
- **99%+ success rate** - timeline data EXISTS for nearly all shipments
- ETA: ~2.5 hours from start

---

## 📊 XLSX Generation Improvements (Dec 6, 2025)

### Timestamp Handling (Full Precision)
All transaction dates now include time components using Excel serial dates:

| Tab | Timestamp Source | Notes |
|-----|-----------------|-------|
| **Shipments** | `shipments.event_labeled` | Label generation timestamp from shipments table |
| **Additional Services** | ULID decode from `transaction_id` | First 10 chars = 48-bit ms timestamp |
| **Returns** | `returns.insert_date` | From returns table (NOT ULID) |
| **Receiving** | ULID decode from `transaction_id` | Same as Additional Services |
| **Storage** | `charge_date` | Date-only (no time available) |
| **Credits** | ULID decode from `transaction_id` | Same as Additional Services |

### Sorting (All Tabs Newest First)
All sheets now sorted descending by date (newest transactions first).

### Table Joins for Empty Columns
The test script now fetches additional data from related tables to fill previously empty columns:

**Shipments tab joins with:**
- `shipments` table: `ship_option_id`, `carrier`, `carrier_service`, `zone_used`, weights, dimensions, `event_labeled`, `delivered_date`, `fc_name`
- `orders` table: `customer_name`, `store_order_id`, `application_name`, address fields, `order_import_date`, `order_type`

**Returns tab joins with:**
- `returns` table: `status`, `return_type`, `tracking_number`, `original_shipment_id`, `fc_name`, `insert_date`

### Excel Number Formatting
- **Currency columns:** `#,##0.00` format (always 2 decimals)
- **DateTime columns:** `yyyy-mm-dd hh:mm:ss` format
- Applied to: base_charge, surcharge, total_charge, insurance, amount columns

### Excel Date Conversion
Dates converted to Excel serial numbers (days since Dec 30, 1899):
```javascript
function toExcelDate(dateStr) {
  const excelEpoch = new Date(Date.UTC(1899, 11, 30))
  const msPerDay = 24 * 60 * 60 * 1000
  return (new Date(dateStr).getTime() - excelEpoch.getTime()) / msPerDay
}
// Example: 2025-11-30 → 45992.xxx
```

---

*Last updated: Dec 6, 2025 - Source of truth = invoices_sb.jetpack_invoice_id (NOT invoices_shipbob!), Payment types excluded, PAGINATION REQUIRED (1000 row limit!), ULID timestamps for Credits/Returns/Receiving, table joins for empty columns, sorted newest-first, ready for Monday cron*
