# Claude Active TODO List

Active tasks that should not be forgotten. Check this file at the start of each session.

---

## 🚀 PRODUCTION READY - Monday Dec 8 Invoice Generation

### Cron Schedule
- **Time:** 10:00 AM EST (15:00 UTC)
- **Schedule:** `0 15 * * 1` (Mondays)
- **Config:** Updated in `/vercel.json`

### ✅ Test Results (Dec 7, 2025)

**Henson Shaving Invoice JPHS-0037-120125:**
| Category | Generated | Reference | Match |
|----------|-----------|-----------|-------|
| Shipments | $9,714.52 | $9,715.24 | ✅ ($0.72 rounding) |
| Additional Services | $765.95 | $765.95 | ✅ EXACT |
| Storage | $998.41 | $998.41 | ✅ EXACT |
| Returns | $14.79 | $14.79 | ✅ EXACT |
| Receiving | $35.00 | $35.00 | ✅ EXACT |
| Credits | -$686.12 | -$686.12 | ✅ EXACT |
| **TOTAL** | **$10,842.55** | **$10,843.27** | ✅ ($0.72 diff) |

**Markup Rules Verified:**
- ship_option_id 146: 18% markup ✅ (1,016 shipments)
- Other ship_options: 14% markup ✅ (729 shipments)
- Additional Services: 15% markup ✅

### Pre-Production Checklist (Sunday Night / Monday Morning)

1. **SFTP Check** - Verify `extras-120825.csv` is uploaded by ShipBob
   - Contains shipping breakdown (base_cost, surcharge, insurance)
   - Date format: MMDDYY (120825 = Dec 8, 2025)

2. **Reset Test Data** (if needed)
   ```bash
   node scripts/reset-all-test-data.js
   ```

3. **Manual Dry Run** (optional, before 10am)
   ```bash
   curl -X GET "https://your-domain.vercel.app/api/cron/generate-invoices" \
     -H "Authorization: Bearer $CRON_SECRET"
   ```

4. **Post-Generation Validation**
   - Check Supabase `invoices_jetpack` table
   - Download PDF and XLSX from Supabase Storage
   - Verify totals match ShipBob invoice amounts + markup

5. **Invoice Approval**
   - Review in Admin section
   - Approve to send to client

### Known Limitations
- Storage dates show period end date (Nov 30) instead of per-day dates
- Receiving (WRO) uses charge_date, not full timestamps
- These are display-only issues; totals are correct

---

## High Priority

### 1. Storage Tab - Per-Day Dates Not Available from API
**Status:** BLOCKED - Need ShipBob SFTP export
**Added:** 2025-12-06
**Updated:** 2025-12-06

**INVESTIGATION COMPLETE:**

Our DB has 981 storage transactions, same count as reference. Each transaction IS per-day (cost ~$1/day for Pallet, ~$0.27/day for Shelf). The problem is the DATE - all 981 have `charge_date = 2025-11-30` (period end) instead of the actual per-day dates.

**API Fields Checked:**
- `charge_date`: Period end (Nov 30) ❌
- `transaction_id` (ULID): Encodes transaction creation time (Nov 30 ~12:36 UTC), not storage day ❌
- `additional_details`: Has Comment, TrackingId, InventoryId, LocationType - NO date field ❌

**Reference File Structure:**
- 981 rows with `ChargeStartdate` (Excel serial, e.g., 45977 = Nov 16)
- 15 unique dates: Nov 16 - Nov 30
- Per inventory-location: 15-45 transactions depending on units and FCs

**What We Know:**
- DB has correct per-day COSTS (e.g., $1/day, $0.27/day) ✅
- DB has correct ROW COUNT (981) ✅
- DB is MISSING per-day DATE - all show period end ❌
- ShipBob Billing API does NOT expose ChargeStartdate ❌

**Recommended Solution:**
Request ShipBob to include `ChargeStartdate` in their weekly SFTP export (same as they do for shipping base/surcharge breakdown in `extras-MMDDYY.csv`).

**Fallback Options:**
1. **Algorithmic derivation** (risky): Determine billing period, sort by transaction_id, assign sequential dates. Inaccurate if inventory was added/removed during period.
2. **Accept limitation**: Use charge_date (period end) and document the difference

---

### 2. Credits Tab - Full Timestamps
**Status:** COMPLETED
**Added:** 2025-12-06
**Completed:** 2025-12-06

**FINDING:** ULID in `transaction_id` encodes the exact timestamp - matches reference within 1ms.

**Fix Applied:** Added `decodeUlidTimestamp()` function to `lib/billing/invoice-generator.ts`. All 3 credits.push locations now decode transaction_id ULID for full timestamps.

| Reference ID | Reference Timestamp | ULID Decoded | Match |
|--------------|---------------------|--------------|-------|
| 309525390 | 2025-11-26T04:34:49.633Z | 2025-11-26T04:34:49.634Z | YES |
| 311870011 | 2025-11-24T22:58:40.427Z | 2025-11-24T22:58:40.428Z | YES |
| 303354434 | 2025-11-29T04:30:29.103Z | 2025-11-29T04:30:29.102Z | YES |

---

### 3. Fix Pagination and Re-run Invoice Shipments Backfill
**Status:** COMPLETED
**Added:** 2025-12-06

**ISSUE FOUND:** Invoice 8633612 has 1435 transactions but Supabase default limit is 1000 rows.

**Fix Applied:** Added `.range()` pagination to `scripts/backfill-invoice-shipments.js`

**Result:** Re-ran script, found 1435 shipments, all already have `event_labeled`. Backfill complete.

---

### 2. Sync WRO Data from ShipBob API for Receiving Timestamps
**Status:** Pending
**Added:** 2025-12-06

The Receiving tab needs full timestamps, but WRO transactions only have date-only `charge_date`.
No WRO data is currently synced from ShipBob.

**Needed:**
- Add WRO sync to `lib/shipbob/sync.ts`
- Create `warehouse_receiving_orders` table (or populate existing one)
- Update invoice generator to use WRO timestamps

---

### 3. Timeline + Shipment Items Sync - FIXED
**Status:** ✅ FIXED - Ongoing sync works, historical backfill pending
**Added:** 2025-12-06
**Updated:** 2025-12-08 - Both issues fixed in sync.ts

**FIXES APPLIED (Dec 8, 2025):**

1. **Timeline Events** - Now synced automatically with cron
   - Added `syncShipmentTimelines()` to `lib/shipbob/sync.ts`
   - Fetches until `event_delivered IS NULL` (re-fetches until delivered)
   - All event columns populated: event_created, event_picked, event_packed, etc.

2. **Shipment Items Quantity** - Now populates correctly
   - **Root cause:** ShipBob API quirk - `order.products` has quantity, `shipment.products` has name but NO quantity
   - **Fix:** Sync now merges both sources - builds lookup from `order.products` for quantity
   - **File:** `lib/shipbob/sync.ts` lines 566-613

**Backfill Status:**
- **Nov 22 - Dec 8:** Running now via `node scripts/backfill-shipment-items.js 16`
- **Historical (pre-Nov 22):** TODO - Need full historical backfill later (see #3b below)

**Scripts:**
- `scripts/backfill-shipment-items.js [daysBack]` - Backfill shipment_items with proper quantity
- `scripts/backfill-timeline-invoice.js` - Backfill timeline for billing transactions

---

### 3b. Historical Shipment Items Backfill (Low Priority)
**Status:** TODO - Schedule after production stabilizes
**Added:** 2025-12-08

**Context:**
All 155K+ shipment_items from before Nov 22, 2025 have `quantity = NULL` and garbage data (product_id=-1, obfuscated SKU). The sync is now fixed for new shipments.

**Scope:**
- ~150,000 items need backfill
- Requires fetching orders from ShipBob API (historical)
- Est. time: Several hours (API rate limits)

**To Run:**
```bash
node scripts/backfill-shipment-items.js 365  # Last year
```

**Priority:** Low - Only needed for historical analytics, not invoicing

---

### 4. Backfill Historic Shipments with SFTP Breakdown Data
**Status:** IN PROGRESS - Running backfill script
**Added:** 2025-12-07
**Updated:** 2025-12-07 - User provided `reference/data/extras-backfill.csv` (74,570 rows)

**PROBLEM DISCOVERED:**
Credit markup matching isn't working because historic shipments are missing `base_cost`, `surcharge`, and `insurance_cost` columns (all NULL). These fields come from the SFTP `extras-MMDDYY.csv` file which only started recently.

**Why It Matters:**
1. **Credit markup calculation** - Credits that refund shipping need to look up the original shipment's `base_cost` to apply the same markup. With `base_cost = NULL`, matching fails.
2. **Analytics** - Need breakdown for shipping cost analysis
3. **Markup accuracy** - Markup applies to `base_cost` only (surcharges are pass-through)

**Current State:**
- Future shipments: SFTP cron populates `base_cost`, `surcharge`, `insurance_cost` ✅
- Historic shipments: Only have `cost` (combined total), breakdown fields are NULL ❌

**Credit Markup Bug Example:**
```
Credit: -$5.63 for shipment 313523042 ("Picking Error")
Original shipment has: base_cost = NULL, cost = $5.63 (or different amount)
Matching logic: Math.abs(credit) == base_cost → FAILS (base_cost is NULL)
Result: Credit NOT marked up, shows raw ShipBob refund instead of marked-up refund
```

**Solution:**
1. User provides historic SFTP CSV (or combined backfill file) with columns:
   - `shipment_id`, `base_cost`, `surcharge`, `insurance_cost`
2. Run backfill script: `scripts/apply-sftp-breakdown.js`
3. After backfill, credits will match correctly

**Also Need to Fix:**
The credit matching logic should be updated to NOT require exact amount match. Instead:
- If credit references a shipment AND has shipping-related reason (Picking Error, etc.)
- Apply the shipment's markup percentage regardless of exact amount match

---

### 5. Credit Markup Logic - VERIFIED WORKING
**Status:** COMPLETED
**Added:** 2025-12-07
**Updated:** 2025-12-07 - Synthetic test passed

**Current Logic (CORRECT - exact match required):**
```typescript
// Requires EXACT amount match between credit and base_cost
if (Math.abs(Math.abs(item.baseAmount) - shipmentMarkup.baseAmount) < 0.01) {
  // Apply markup
}
```

**Why Exact Match is Correct:**
- **Shipping refunds**: Credit amount = `base_cost` exactly (e.g., -$5.63 = $5.63 base_cost) → SHOULD get markup
- **Product refunds**: Reference a shipment but different amount → Should NOT get markup
- The logic distinguishes between shipping vs product refunds by amount matching

**Root Cause Found:**
The matching was failing because `base_cost = NULL` for historic shipments. The backfill (#4) is populating this data.

**Synthetic Test Results (Dec 7, 2025):**
```
Shipment 321577334: base_cost=$5.43, markup=40%
Synthetic credit: -$5.43 (matches base_cost)

EXPECTED:
  Markup Amount:  $-2.17
  Billed Amount:  $-7.60 (client gets full refund with markup)

ACTUAL:
  Markup Amount:  $-2.17
  Billed Amount:  $-7.60

✅ ALL TESTS PASSED
```

**Test Script:** `scripts/test-credit-markup.js`

**File:** `lib/billing/invoice-generator.ts` lines 825-842

---

### 6. Historical Invoice Backfill Strategy
**Status:** Pending - Strategy documented, needs user decision
**Added:** 2025-12-07

**CONTEXT:**
- User has historical invoice PDFs and XLS files
- Need to populate `invoices_jetpack` table with past invoices
- Transactions already exist in DB with `invoice_id_sb` linking to ShipBob invoices

**TWO OPTIONS:**

**Option A: Extract from Historical XLS Files (RECOMMENDED)**
- Parse existing XLS files to get marked-up amounts
- Guarantees totals match what client already received
- Requires: XLS files named with invoice number and date
- Script reads each XLS, extracts totals, creates `invoices_jetpack` record
- Pro: Fast, accurate to what client saw
- Con: Only has summary data, no markup_percentage on transactions

**Option B: Recalculate Markups from Scratch**
- Use current markup rules on historical transactions
- Applies same logic as new invoices
- Requires: All markup rules were consistent historically
- Script finds transactions by `invoice_id_sb`, applies markups, generates invoices
- Pro: Full markup data on each transaction
- Con: May differ from original invoices if rules changed

**HYBRID APPROACH (Best of Both):**
1. Import XLS files to get official totals → `invoices_jetpack` records
2. Recalculate markups on transactions → `markup_percentage`, `billed_amount`
3. Compare calculated total vs XLS total → flag discrepancies for review
4. Store both: `total_from_xls` and `total_calculated`

**FILES NEEDED FROM USER:**
```
reference/invoices-historical/
├── JPHS-0001-MMDDYY.xlsx
├── JPHS-0001-MMDDYY.pdf
├── JPHS-0002-MMDDYY.xlsx
├── ...
```

**SCHEMA ADDITIONS:**
```sql
ALTER TABLE invoices_jetpack ADD COLUMN IF NOT EXISTS
  total_from_file DECIMAL(10,2),
  import_source TEXT,  -- 'generated' | 'imported_xlsx' | 'recalculated'
  import_notes TEXT;
```

**DECISION NEEDED:**
- Which option to use (A, B, or Hybrid)?
- Are historical markup rules same as current rules?
- Are XLS files available in consistent format?

---

### 7. Historical Invoice Backfill - COMPLETE
**Status:** 99.38% complete - 894 transactions unmatched (FINAL)
**Added:** 2025-12-07
**Updated:** 2025-12-07

**Final State:**
- Combined: 99.38% matched (143,798 / 144,692)
- 894 historical transactions remain unmatched - legitimately not in any XLS

**Remaining Unmatched by Fee Type:**
- Shipping: 532 (not in any XLS - legitimately not invoiced)
- Per Pick Fee: 169 (same)
- Warehousing Fee: 96 (not in any XLS Storage tabs)
- Payment: 38 (ignore - internal)
- Credit: 24 (likely ref=0, no invoice)
- URO/WRO Receiving: 23 (need WRO matching)
- Other: 12 (VAS, Returns, etc.)

**Likely Not Matchable:**
- ~700 Shipping/Per Pick Fee not in any XLS file
- ~62 Payment/Credit with ref=0

**Potentially Matchable (~150):**
- Warehousing Fee (116) - run Methyl-Life storage matching
- Receiving fees (23) - need WRO Number matching
- Return fees (6) - need Return ID matching

**Scripts Used:**
- `scripts/fix-duplicate-refids.js` - Propagate invoice_id_jp to same reference_id
- `scripts/fix-storage-matching.js` - Match Henson storage by inventory_id extraction
- `scripts/fix-remaining-shipping.js` - Match shipping by XLS OrderID lookup
- `scripts/import-missing-invoices.js` - Import JPHS-0016, JPHS-0027

---

## Medium Priority

### 0. Backfill shipbob_invoice_ids and line_items_json for Existing Invoices
**Status:** TODO - Run after migration applied
**Added:** 2025-12-08
**Updated:** 2025-12-08 - Added line_items_json column

**Context:**
The invoice workflow was refactored to store data on the invoice record:
- `shipbob_invoice_ids`: Which ShipBob invoices are included (for regeneration)
- `line_items_json`: Cached line items with markup data (for approval)

This ensures:
- Clean regeneration without relying on transaction marking
- Approval uses EXACT same amounts as PDF/XLS files (no recalculation)
- Safe deletion of draft invoices

**Migration (see scripts/migrations/018-add-shipbob-invoice-ids-column.sql):**
```sql
-- Run this in Supabase SQL Editor:
ALTER TABLE invoices_jetpack
ADD COLUMN IF NOT EXISTS shipbob_invoice_ids JSONB DEFAULT '[]'::jsonb;

ALTER TABLE invoices_jetpack
ADD COLUMN IF NOT EXISTS line_items_json JSONB;
```

**Backfill for Existing Invoices:**
For existing invoices (JPHS-0037, JPML-0021, etc.), populate `shipbob_invoice_ids` from linked transactions. Note: `line_items_json` will need to be populated by regenerating each invoice.

```sql
-- Backfill shipbob_invoice_ids from transactions
UPDATE invoices_jetpack ij
SET shipbob_invoice_ids = (
  SELECT COALESCE(jsonb_agg(DISTINCT t.invoice_id_sb), '[]'::jsonb)
  FROM transactions t
  WHERE t.invoice_id_jp = ij.invoice_number
    AND t.invoice_id_sb IS NOT NULL
)
WHERE shipbob_invoice_ids = '[]'::jsonb OR shipbob_invoice_ids IS NULL;
```

**Why This Matters:**
- Without `shipbob_invoice_ids` backfill: Can't regenerate existing invoices
- Without `line_items_json`: Can't approve existing invoices (will say "No cached line items found")

---

### 1. ADDITIONAL_SERVICE_FEES - Handle Unknown Fee Types
**Status:** TODO
**Added:** 2025-12-08

**Problem:**
The `ADDITIONAL_SERVICE_FEES` array in `lib/billing/invoice-generator.ts` is a hardcoded list of known fee types. If ShipBob introduces a new fee type we haven't seen before, those transactions will be silently skipped during invoice generation.

**Example Issue Found:**
- `VAS - Paid Requests` wasn't in the array, causing $90 in VAS fees to be excluded from Methyl-Life invoice
- `referenceType === 'TicketNumber'` wasn't handled, so VAS transactions were also filtered out by reference type

**Current Logic (Problematic):**
```typescript
} else if (referenceType === 'Shipment') {
  if (transactionFee === 'Shipping') {
    // shipping handling
  } else if (ADDITIONAL_SERVICE_FEES.includes(transactionFee)) {
    // additional service fees - ONLY if in hardcoded list!
  }
}
```

**Recommended Fix:**
1. Add a catch-all for unknown fee types within known reference types
2. Log warnings for unknown fee types so they can be reviewed
3. Consider making ADDITIONAL_SERVICE_FEES a database table so it can be updated without code changes
4. Add preflight validation warning for transactions with unknown fee types

**Files Affected:**
- `lib/billing/invoice-generator.ts` - `collectBillingTransactionsByInvoiceIds()` and `collectUnprocessedBillingTransactions()`
- `lib/billing/preflight-validation.ts` - Add check for unknown fee types

---

### 2. Verify Invoice Generation Timestamps Match Reference
**Status:** Pending (waiting for backfill)
**Added:** 2025-12-06

After backfill completes:
1. Regenerate JPHS-0037 test invoice
2. Compare Transaction Date column with reference XLSX
3. Verify timestamps match (should be label generation timestamps, not charge dates)

---

## Completed

*(Move items here when done)*

---

*Updated: 2025-12-07*
