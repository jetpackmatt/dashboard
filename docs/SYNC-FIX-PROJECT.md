# Sync Fix Project - December 2025

**Created:** December 8, 2025
**Status:** In Progress
**Goal:** Fix all sync issues affecting invoicing and dashboard display

**Related Docs:**
- [FIELD-SOURCE-OF-TRUTH.md](FIELD-SOURCE-OF-TRUTH.md) - Definitive field mapping (what's needed, where it comes from)

---

## Executive Summary

The sync system has **significant data gaps** that affect both invoicing and dashboard display. Most issues are fixable with targeted updates and scripts.

---

## 1. Current Sync Architecture

### Cron Jobs (vercel.json)
| Endpoint | Schedule | Purpose | Status |
|----------|----------|---------|--------|
| `/api/cron/sync` | Every 1 min | Orders, shipments, items (child tokens) | Running |
| `/api/cron/sync-timelines` | Every 1 min | Timeline events for undelivered shipments (1000/run) | Running |
| `/api/cron/sync-transactions` | Every 1 min | All transaction types (parent token) | Running |
| `/api/cron/sync-reconcile` | Every hour | Soft-delete detection | Running |
| `/api/cron/sync-invoices` | Daily 1:36 AM UTC | ShipBob invoice metadata | Running |

### Token Architecture
| Token | Used For | Source |
|-------|----------|--------|
| **Parent Token** | Billing API (invoices, transactions) | `SHIPBOB_API_TOKEN` env var |
| **Child Tokens** | Orders API (orders, shipments, returns) | `client_api_credentials` table |

---

## 2. Data Quality Analysis (Dec 8, 2025)

### Transactions Table (150,752 total)

#### Split by Invoice Status
| Status | Count | % |
|--------|-------|---|
| Invoiced (billed to client) | 141,286 | 94% |
| Uninvoiced (pending) | 9,466 | 6% |

#### Field Population - ALL Transactions

| Field | Invoiced (141K) | Uninvoiced (9K) | Issue |
|-------|-----------------|-----------------|-------|
| `client_id` | 99.99% | 99.9% | Good |
| `cost` | 100% | 100% | Perfect |
| `charge_date` | 100% | 100% | Perfect |
| `transaction_fee` | 100% | 100% | Perfect |
| `invoice_id_sb` | 100% | 79% | OK (some pending) |
| `fulfillment_center` | 86% | 99% | OK |
| **`tracking_id`** | **0.6%** | **42%** | **CRITICAL** |
| **`base_cost`** | **45%** | **31%** | **SFTP not processed** |
| **`surcharge`** | **45%** | **31%** | **SFTP not processed** |
| **`insurance_cost`** | **45%** | **31%** | **SFTP not processed** |
| `markup_rule_id` | 2% | 0% | Rules not linked |
| **`invoice_date_jp`** | **0%** | N/A | **Never set** |

#### The Tracking ID Gap - FIXED (Dec 9)
```
Shipment transactions total:        133,381
Transactions WITH tracking_id:      133,332  (100%)
═══════════════════════════════════════════════════
STATUS: FIXED - Backfill script ran Dec 9, 2025
```

**Fix applied:** Ran `scripts/backfill-tracking-id.js` to copy from linked shipments. Sync also extracts from `additional_details.TrackingId` when present.

---

### Shipments Table (76,253 active)

| Field | Populated | % | Status |
|-------|-----------|---|--------|
| `client_id` | 76,253 | 100% | Perfect |
| `tracking_id` | 73,797 | 96.8% | Good |
| `carrier` | 73,797 | 96.8% | Good |
| `carrier_service` | 76,253 | 100% | Perfect |
| `ship_option_id` | 75,893 | 99.5% | Good |
| `zone_used` | 73,612 | 96.5% | Good |
| `actual_weight_oz` | 74,141 | 97.2% | Good |
| `delivered_date` | 69,178 | 91% | Good |
| **`event_created`** | **~40,000** | **~52%** | Timeline backfill in progress |
| **`event_labeled`** | **~38,000** | **~50%** | Timeline backfill in progress |
| **`event_delivered`** | **~35,000** | **~46%** | Timeline backfill in progress |

---

### Orders Table (75,932 active)
**HEALTHY** - All key fields 99%+ populated

---

### Returns Table (208 total)
**HEALTHY** - All key fields 94%+ populated

---

### Invoices Tables

#### invoices_sb (ShipBob invoices): 250 rows
| Field | Populated | Issue |
|-------|-----------|-------|
| `client_id` | **0%** | Never attributed (may be intentional - parent invoices) |
| `jetpack_invoice_id` | 98% | Good |

#### invoices_jetpack (Our invoices): 58 rows
| Field | Populated | Issue |
|-------|-----------|-------|
| `pdf_path` | **3%** | Only 2 have PDFs |
| `xlsx_path` | **3%** | Only 2 have XLSXs |
| `approved_by` | 3% | Most not approved yet |

---

## 3. Obsolete/Unused Items

### Tables to DROP
| Table | Rows | Reason |
|-------|------|--------|
| `webhook_events` | 0 | Webhooks never implemented |
| `credential_access_log` | 0 | Never used |
| `credits` | 0 | Redundant - credits come via transactions |

### Tables to Consider Removing
| Table | Rows | Notes |
|-------|------|-------|
| `shipment_cartons` | 378 | Only 0.5% of shipments have data |
| `merchant_client_map` | 2 | Attribution now via shipments lookup |

### Code to Clean Up
| Item | Location | Action |
|------|----------|--------|
| Webhook middleware bypass | `middleware.ts:19-23` | Remove `/api/webhooks/` reference |
| Webhook subscriptions | ShipBob API | **DONE** - Deleted Dec 8, 2025 |

---

## 4. Root Causes of Sync Issues

### Issue 1: tracking_id Not Copied
**Location:** `lib/shipbob/sync.ts` lines 868-886
```typescript
// Current: Extracts from additional_details (rarely populated)
tracking_id: (tx.additional_details as Record<string, unknown>)?.TrackingId as string || null,
```
**Fix:** After transaction upsert, run UPDATE to copy from shipments table

### Issue 2: SFTP Files Not Processed
**Problem:** ShipBob sends `extras-MMDDYY.csv` via SFTP with `base_cost`, `surcharge`, `insurance_cost`
**Current:** No processing script exists
**Fix:** Create SFTP processor script

### Issue 3: Timeline Events Not Backfilled
**Location:** `lib/shipbob/sync.ts` lines 199-285
**Problem:** Timeline API only called for undelivered shipments during sync
**Fix:** Run one-time backfill for historical shipments

### Issue 4: invoice_date_jp Never Set
**Location:** Invoice approval flow
**Problem:** Field exists but approval doesn't populate it
**Fix:** Update approval endpoint to set this field

### Issue 5: markup_rule_id Not Linked
**Problem:** Markup calculated at invoice time but rule ID not stored back to transaction
**Fix:** Update invoice generation to write `markup_rule_id` back

---

## 5. Fix Plan

### Phase 1: Quick Wins

#### 1A. Copy tracking_id from shipments to transactions
```sql
UPDATE transactions t
SET tracking_id = s.tracking_id
FROM shipments s
WHERE t.reference_type = 'Shipment'
  AND t.reference_id = s.shipment_id
  AND t.tracking_id IS NULL
  AND s.tracking_id IS NOT NULL;
```
**Impact:** Filled 128,439 records (96% of gap)
**Status:** [x] DONE (Dec 9, 2025) - Now 100% populated

#### 1B. Remove webhook middleware code
```typescript
// Remove from middleware.ts
const isWebhookApi = pathname.startsWith('/api/webhooks/')
```
**Status:** [ ] Not started

#### 1C. Drop unused tables
```sql
DROP TABLE IF EXISTS webhook_events;
DROP TABLE IF EXISTS credential_access_log;
DROP TABLE IF EXISTS credits;
```
**Status:** [ ] Not started

---

### Phase 2: Sync Code Fixes

#### 2A. Update transaction sync to copy tracking_id
Modify `syncAllTransactions()` to JOIN with shipments and copy tracking_id
**Status:** [ ] Not started

#### 2B. Fix invoice approval to set invoice_date_jp
Update `/api/admin/invoices/[id]/approve/route.ts`
**Status:** [ ] Not started

#### 2C. Store markup_rule_id on transactions
Update invoice generation to write rule IDs back
**Status:** [ ] Not started

---

### Phase 3: Backfill & SFTP

#### 3A. Create SFTP processor
```bash
node scripts/process-sftp-extras.js --file=extras-MMDDYY.csv
```
Matches by `transaction_id`, updates `base_cost`, `surcharge`, `insurance_cost`
**Status:** [ ] Not started

#### 3B. Timeline backfill for historical shipments
Run timeline API for all shipments where `event_created IS NULL AND status = 'Completed'`
**Status:** [x] IN PROGRESS (Dec 9, 2025)
- Dedicated `/api/cron/sync-timelines` deployed (1000 shipments/min)
- Background backfill scripts running
- Progress: ~52% complete (39,768 / 76,378 shipments)

---

### Phase 4: Monitoring

#### 4A. Add sync health check endpoint
Reports:
- % of transactions with tracking_id
- % of shipments with timeline events
- Count of unattributed transactions
**Status:** [ ] Not started

#### 4B. Alert on sync failures
Monitor Vercel cron logs for errors
**Status:** [ ] Not started

---

### Phase 5: Supabase Realtime (Future)

Enable live updates in dashboard when sync writes new data.

#### 5A. Enable Realtime on tables
In Supabase Dashboard → Database → Replication, enable for:
- `shipments` - Status changes, tracking updates
- `transactions` - New transactions
- `orders` - Status changes
- `invoices_jetpack` - Invoice status (admin)
**Status:** [ ] Not started

#### 5B. Add client-side subscriptions
```typescript
// Example pattern for React components
useEffect(() => {
  const channel = supabase
    .channel('shipments-realtime')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'shipments', filter: `client_id=eq.${clientId}` },
      (payload) => {
        // Handle INSERT, UPDATE, DELETE
      }
    )
    .subscribe()
  return () => { supabase.removeChannel(channel) }
}, [clientId])
```
**Status:** [ ] Not started

**Note:** Realtime doesn't require sync changes - it pushes database changes to connected clients automatically.

---

## 6. Fields Required for Invoicing

### Must Have (Blocking)
| Table | Field | Source | Current % |
|-------|-------|--------|-----------|
| transactions | `client_id` | Attribution logic | 99.9% |
| transactions | `cost` | Billing API | 100% |
| transactions | `charge_date` | Billing API | 100% |
| transactions | `transaction_fee` | Billing API | 100% |
| transactions | `invoice_id_sb` | Billing API | 99% |

### Should Have (For Accuracy)
| Table | Field | Source | Current % |
|-------|-------|--------|-----------|
| transactions | `base_cost` | SFTP | 45% |
| transactions | `surcharge` | SFTP | 45% |
| transactions | `tracking_id` | Shipments JOIN | 100% ✅ |
| shipments | `billable_weight_oz` | Orders API | 97% |
| shipments | `ship_option_id` | Orders API | 99.5% |

### Nice to Have (For Display)
| Table | Field | Source | Current % |
|-------|-------|--------|-----------|
| shipments | `event_created` | Timeline API | ~62% (backfill running) |
| shipments | `event_delivered` | Timeline API | ~54% (backfill running) |
| transactions | `markup_rule_id` | Invoice gen | 2% |

---

## 7. Progress Log

### December 8, 2025
- [x] Analyzed all CLAUDE.md files for contradictions
- [x] Compressed CLAUDE files from 7 files (~5,500 lines) to 4 files (~1,100 lines)
- [x] Backed up old files to `docs/archive/claude-backup-2025-12-08/`
- [x] Comprehensive NULL analysis on all tables
- [x] Identified webhook subscriptions still active in ShipBob
- [x] Deleted webhook subscriptions (Henson + Methyl-Life)
- [x] Created this project document
- [x] Read invoice-generator.ts to understand actual field requirements
- [x] Created FIELD-SOURCE-OF-TRUTH.md with definitive field mapping
- [x] **KEY FINDING:** `tracking_id` in transactions is NOT required - invoice generator JOINs to shipments (96.8%)
- [x] **KEY FINDING:** Real bugs are `invoice_date_jp` (0%) and `markup_rule_id` (2%)
- [x] Added Phase 5 for Supabase Realtime

### December 9, 2025
- [x] **CRITICAL FIX:** Changed per-minute sync to use `LastUpdateStartDate` instead of `StartDate`
  - **Root cause:** `StartDate` filters by ORDER CREATION date, not modification date
  - **Impact:** Orders/shipments older than 5 minutes were NEVER being re-fetched for updates
  - **Fix:** Now uses `LastUpdateStartDate`/`LastUpdateEndDate` for minutesBack syncs
  - **Location:** `lib/shipbob/sync.ts` lines 525-534
  - This catches: tracking updates, delivery status, timeline events, etc.
- [x] Investigated ShipBob API docs and found the `LastUpdateStartDate` parameter
- [x] **Changed transactions sync to every 1 minute** (was 5 min)
  - Near real-time billing data capture
  - Reduced lookback from 10 min to 3 min
- [x] **Extended reconciliation lookback to 20 days** (was 1 day)
  - Catches orders cancelled/deleted within the last 20 days
  - Still uses StartDate (creation date) filter for soft-delete detection
- [x] **Investigated `invoice_date_jp` and `line_items_json` bugs**
  - **Root cause:** Code fixes were deployed AFTER historical invoices were processed
  - `line_items_json` fix deployed at 22:13 UTC
  - `invoice_date_jp` fix deployed at 22:21 UTC
  - Invoices were approved at 21:20 UTC (BEFORE both fixes)
  - **Future invoices will work correctly!**
  - Historical data needs backfill script

### Revised Priority (Based on Analysis)
1. ~~**Fix per-minute sync to catch updates**~~ - **DONE** (Dec 9)
2. ~~**Fix `invoice_date_jp`**~~ - Code is correct, historical data needs backfill
3. ~~**Fix `line_items_json`**~~ - Code is correct, historical data needs backfill
4. ~~**Backfill `invoice_date_jp` for historical transactions**~~ - **DONE** (Dec 9)
5. ~~**Fix `period_start`/`period_end` on invoices_jetpack**~~ - **DONE** (Dec 9) - Fixed 56 invoices
6. **Timeline API backfill** - For `event_labeled` (41%) and `event_delivered` (37%)
7. **SFTP processing** - For `base_cost`/`surcharge` (45%)
8. **Cleanup** - Remove webhook tables/code
9. **Nice-to-have** - Denormalize `tracking_id` to transactions (convenience only)

### December 9, 2025 (Afternoon)
- [x] **Fixed `period_start` and `period_end` on all 58 invoices**
  - `period_end` = invoice_date - 1 day (Sunday)
  - `period_start` = Monday of that week
  - Script: `scripts/backfill-invoice-dates.js`
- [x] **Backfilled `invoice_date_jp` on 132,661 transactions** (100% coverage)
  - All transactions with `invoice_id_jp` now have matching `invoice_date_jp`
- [x] **Linked historical transactions to Jetpack invoices**
  - Script: `scripts/link-historical-transactions.js`
  - Linked ~17,000 transactions (mostly warehousing fees) by matching ShipBob invoice dates to JP invoice dates
  - Updated 19+ Jetpack invoices with missing `shipbob_invoice_ids`
  - **Final result: 96.6% of transactions with SB invoices are now linked to JP invoices**
  - Remaining 5,084 unlinked:
    - 4,748 = Dec 2025 pending (not yet invoiced) - expected
    - 336 = Pre-billing history or internal accounts (ShipBob Payments, Jetpack Costs)

### December 9, 2025 (Evening)
- [x] **Created dedicated `/api/cron/sync-timelines` endpoint**
  - Processes 1000 undelivered shipments per minute
  - Uses 14-day window (336 hours) for recent shipments
  - Deployed and added to vercel.json
- [x] **Fixed `return_id` bug in sync-transactions**
  - Error: `column returns.return_id does not exist`
  - Fix: Changed to `shipbob_return_id` in sync.ts lines 1310, 1328-1329
- [x] **Backfilled `tracking_id` on transactions**
  - Ran `scripts/backfill-tracking-id.js`
  - Result: 100% populated (133,332 / 133,381)
- [x] **Timeline backfill in progress**
  - Running parallel backfill scripts for Henson and Methyl-Life
  - Progress: ~62% complete (47,165 / 76,379 shipments) as of Dec 9, 7:20pm EST
- [x] **Updated all documentation**
  - CLAUDE.md - Added sync-timelines cron, fixed data quality stats
  - CLAUDE.sync.md - Added sync-timelines, updated known issues
  - SYNC-FIX-PROJECT.md - Updated all status markers

---

## 8. Remaining Work Summary

### ✅ Completed
| Item | Status |
|------|--------|
| tracking_id backfill | 100% ✅ |
| invoice_date_jp backfill | 100% ✅ |
| period_start/period_end fix | 100% ✅ |
| Link historical transactions | 96.6% ✅ |
| Fix return_id bug | ✅ |
| Dedicated sync-timelines cron | ✅ |

### 🔄 In Progress
| Item | Progress | Notes |
|------|----------|-------|
| Timeline events backfill | 62% | Background scripts running, ~29K remaining |

### ❌ Not Started (Lower Priority)
| Item | Impact | Notes |
|------|--------|-------|
| SFTP processor | 50% of Shipment tx missing base_cost/surcharge | SFTP files needed from ShipBob |
| Drop unused tables | Cleanup | `webhook_events`, `credential_access_log`, `credits` |
| Remove webhook middleware | Cleanup | `middleware.ts` lines 19-23 |
| markup_rule_id linking | 2% populated | Low priority - set at invoice time |
| Sync health check endpoint | Monitoring | Nice-to-have |
| Sync failure alerts | Monitoring | Nice-to-have |
