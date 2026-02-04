# Data Sync Architecture

**Read this when:** Working on sync crons, ShipBob API integration, data flow issues, or fixing missing fields.

---

## CRITICAL: ShipBob Invoices Are Multi-Client

**ShipBob invoices (`invoice_id_sb`) contain ALL clients' transactions together.**

This is NOT intuitive and has caused bugs. Key facts:
- When syncing transactions, they arrive with an `invoice_id_sb` but NO `client_id`
- The invoice ID does NOT tell you which client the transaction belongs to
- Multiple different clients have transactions on the same ShipBob invoice
- Attribution MUST be done via lookup tables (shipments, orders, returns) - NOT via invoice grouping

**NEVER assume transactions on the same invoice belong to the same client.**

See [CLAUDE.billing.md](CLAUDE.billing.md) for full explanation of invoice structure.

---

## Cron Jobs

| Endpoint | Schedule | What It Does |
|----------|----------|--------------|
| `/api/cron/sync` | Every 1 min | Syncs orders/shipments using **child tokens** + `LastUpdateStartDate` (catches updates) |
| `/api/cron/sync-timelines` | Every 1 min | Updates timeline events for undelivered shipments (1000/run, 14-day window) |
| `/api/cron/sync-transactions` | Every 1 min | Syncs ALL transaction types using **parent token** (3-min lookback) |
| `/api/cron/sync-reconcile` | Every hour | Orders/shipments (20-day lookback) + transactions (3-day lookback) + soft-delete detection |
| `/api/cron/sync-invoices` | Daily 1:36 AM UTC | Syncs ShipBob invoice metadata |

---

## Token Architecture

| Token | Source | Used For |
|-------|--------|----------|
| **Parent Token** | `SHIPBOB_API_TOKEN` env var | Billing API: invoices, transactions (sees ALL merchants) |
| **Child Tokens** | `client_api_credentials` table | Orders API: orders, shipments, returns (per-client data) |

**Critical:** Parent token cannot access order/shipment details. Child tokens cannot access billing data.

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                      EVERY 1 MINUTE (sync)                          │
├─────────────────────────────────────────────────────────────────────┤
│  For each client with child token:                                  │
│                                                                     │
│  1. GET /2025-07/order?LastUpdateStartDate={5min ago}              │
│     → Upsert orders table                                           │
│     NOTE: Uses LastUpdateStartDate (not StartDate) to catch         │
│           updates to existing orders, not just new orders           │
│                                                                     │
│  2. Extract shipments from order response                           │
│     → Upsert shipments table (with carrier, zone, weight, dims)     │
│                                                                     │
│  3. GET /2025-07/shipment/{id}/timeline (for undelivered)          │
│     → Update event_* columns (created, labeled, delivered, etc.)    │
│                                                                     │
│  4. Extract products from orders/shipments                          │
│     → Upsert order_items, Insert shipment_items                     │
│                                                                     │
│  5. POST /2025-07/transactions:query with reference_ids            │
│     → Upsert transactions (shipment-linked only)                    │
│                                                                     │
│  6. syncReturns() - fetch missing return records                    │
│     → Upsert returns table                                          │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                   EVERY 1 MINUTE (sync-transactions)                │
├─────────────────────────────────────────────────────────────────────┤
│  Using parent token:                                                │
│                                                                     │
│  1. POST /2025-07/transactions:query                                │
│     - from_date: 3 minutes ago                                      │
│     - to_date: now                                                  │
│     - page_size: 1000 (uses cursor pagination)                      │
│                                                                     │
│  2. For each transaction, attribute client_id by:                   │
│     - Shipment: reference_id → shipments.shipment_id → client_id    │
│     - FC: parse InventoryId from reference_id → products.variants   │
│     - Return: reference_id → returns.return_id → client_id          │
│     - Default/Payment: route to system clients                      │
│                                                                     │
│  3. Build upsert records:                                           │
│     ⚠️ CRITICAL: Only include client_id/merchant_id if NOT NULL!    │
│     If attribution fails, OMIT these fields to preserve existing    │
│     values. Including null will WIPE existing attribution.          │
│                                                                     │
│  4. Batch upsert transactions (500 at a time)                       │
│                                                                     │
│  5. Database-join fix: Query unattributed Shipment transactions,    │
│     join to shipments table, UPDATE client_id where found           │
└─────────────────────────────────────────────────────────────────────┘
```

---

## API Endpoints Used

### Orders API (Child Token)
| Endpoint | Purpose |
|----------|---------|
| `GET /2025-07/order` | Paginated order list with date filters |
| `GET /2025-07/shipping-method` | Ship option ID lookup |
| `GET /2025-07/channel` | Channel → application_name mapping |
| `GET /2025-07/shipment/{id}/timeline` | Timeline events for a shipment |
| `GET /1.0/return/{id}` | Return details |

### Billing API (Parent Token)
| Endpoint | Purpose |
|----------|---------|
| `POST /2025-07/transactions:query` | Query transactions with filters |
| `GET /2025-07/invoices` | ShipBob invoice list |
| `GET /2025-07/invoices/{id}/transactions` | Transactions for specific invoice |

---

## Transaction Attribution Logic

### CRITICAL: Chicken-and-Egg Problem

The biggest challenge in transaction sync is the **attribution chicken-and-egg problem**:

1. **Transaction Sync** uses parent token → gets ALL merchants' transactions → needs lookup tables to attribute `client_id`
2. **Lookup tables** (shipments, returns, orders) → built from child token syncs → require knowing which client to sync
3. **New Return transaction** arrives → return not in `returns` table yet → can't attribute → stays `client_id: null`

**Solutions implemented:**
1. **Direct lookup**: Works when data already exists in lookup tables
2. **Order reference parsing**: Parse "Order 123456" from Comment → lookup in orders table
3. **Database-join fix**: Post-sync pass queries unattributed Shipment transactions, joins to shipments table to get client_id
4. **Proactive sync**: Sync returns/orders for ALL clients (not just based on transactions)

**CRITICAL WARNING - Invoice-Based Attribution is WRONG:**
ShipBob invoices (`invoice_id_sb`) contain transactions from ALL clients together in a single invoice.
NEVER assume that transactions on the same invoice belong to the same client - this is FALSE.

### Attribution Priority Order

When syncing transactions with parent token, `client_id` is determined in this order:

| Priority | reference_type | Attribution Strategy |
|----------|----------------|---------------------|
| 1 | **Shipment** | `reference_id` → `shipments.shipment_id` → `client_id` |
| 2 | **FC** | Parse InventoryId from `{FC_ID}-{InventoryId}-{LocationType}` → `products.variants[].inventory.inventory_id` |
| 3a | **Return** | `reference_id` → `returns.return_id` → `client_id` |
| 3b | **Return** | (fallback) Parse "Order XXXXX" from Comment → `orders.shipbob_order_id` → `client_id` |
| 4 | **WRO/URO** | `reference_id` → `receiving_orders.shipbob_receiving_id` → `client_id` |
| 5 | **Default** | Route by `transaction_fee`: Payment → Jetpack, CC Fee → Jetpack |
| 6 | **Database-Join Fix** | Post-sync: query unattributed Shipment txs, join to `shipments` table |
| 7 | **TicketNumber** | Parse client name from Comment (fuzzy matching) |

### Why NOT to Iterate Through Clients

**Anti-pattern:** For each unattributed transaction, try each client's token until one works.

**Why it doesn't scale:**
- With 50 clients × 20 unattributed transactions = 1,000 API calls
- API rate limit is 150/min per token, but creates unnecessary load
- Sequential iteration adds latency

**Correct approach:** Build complete lookup tables FIRST (sync all returns for all clients), THEN attribute.

### System Client

In `clients` table with `is_internal=true`:
- **Jetpack**: Holds parent-level transactions (ACH payments, CC processing fees, disputed charges, credits that net out bad charges)

---

## Field Mapping: API → Database

### Orders Table (from Orders API)
| API Field | DB Column |
|-----------|-----------|
| `id` | `shipbob_order_id` |
| `order_number` | `store_order_id` |
| `created_date` | `order_import_date` |
| `recipient.name` | `customer_name` |
| `recipient.address.*` | `city`, `state`, `zip_code`, `country` |
| `type` | `order_type` |
| `channel.name` | `channel_name` |

### Shipments Table (from Orders API shipments array)
| API Field | DB Column | Notes |
|-----------|-----------|-------|
| `shipments[].id` | `shipment_id` | |
| `shipments[].tracking.tracking_number` | `tracking_id` | |
| `shipments[].tracking.carrier` | `carrier` | e.g., "USPS", "FedEx" |
| `shipments[].tracking.carrier_service` | `carrier_service` | e.g., "Ground Advantage", "FedEx Ground" |
| `shipments[].ship_option` | `ship_option_name` | e.g., "ShipBob Economy", "Ground" |
| `shipments[].zone.id` | `zone_used` | |
| `shipments[].location.name` | `fc_name` |
| `shipments[].measurements.total_weight_oz` | `actual_weight_oz` |
| `shipments[].measurements.length_in` | `length` |
| `shipments[].measurements.width_in` | `width` |
| `shipments[].measurements.depth_in` | `height` |
| (calculated) | `dim_weight_oz`, `billable_weight_oz` |

### Shipments Timeline Events (from Timeline API)

**Canonical events stored in event_* columns:**

| log_type_id | DB Column | Display Name |
|-------------|-----------|--------------|
| 601 | `event_created` | Shipment Created |
| 602 | `event_picked` | Picked |
| 603 | `event_packed` | Packed |
| 604 | `event_labeled` | Label Created |
| 605 | `event_labelvalidated` | Label Validated |
| 607 | `event_intransit` | In Transit |
| 608 | `event_outfordelivery` | Out for Delivery |
| 609 | `event_delivered` | Delivered |
| 611 | `event_deliveryattemptfailed` | Delivery Attempt Failed |

**Full event logs stored in `event_logs` JSONB column.**

### Timeline Display Filtering (Jan 2026)

The `event_logs` JSONB contains ALL ShipBob activity, including internal processing events that are noise to users. The shipment detail drawer (`/app/api/data/shipments/[id]/route.ts`) filters these for display.

**Hidden events (internal ShipBob processing):**

| log_type_id | Event Name | Why Hidden |
|-------------|------------|------------|
| 13 | OrderMovedToPending | Internal inventory allocation (happens on every order) |
| 19 | OrderPlacedStoreIntegration | Redundant with Shipment Created |
| 20 | OrderTrackingUploaded | Redundant with In Transit |
| 21 | ShipOptionMappingResolved | Internal ship option mapping |
| 35 | LabelGeneratedLog | Duplicate of 604 Label Created |
| 70 | OrderLabelValidated | Duplicate of 605 Label Validated |
| 78 | OrderDimensionSource | Internal dimensions |
| 98 | OrderSLAUpdated | Internal SLA setting |
| 106 | ShipmentSortedToCarrier | Too granular |
| 107 | ShipmentPickedupByCarrier | Redundant with In Transit |
| 135 | OrderInTransitToShipBobSortCenter | Internal sort center |
| 612 | Shipped | Redundant with 607 In Transit |

**Renamed events (for clarity):**

| log_type_id | Original Text | Display As |
|-------------|---------------|------------|
| 132 | "Order Address Changed" | "Address Validated" (ShipBob auto-standardizes addresses) |
| 603 | "Packaged" | "Packed" |
| 613 | "Inventory was Allocated to the FC" | "Inventory Allocated" |

**Why these events appear on almost every order:**
- "Order moved from Exception to Pending" (13): ShipBob's workflow briefly puts orders in Exception while allocating inventory
- "Order Address Changed" (132): ShipBob auto-validates/standardizes addresses (adds ZIP+4, abbreviates "Road" → "Rd")
- "Resolved ship option mapping" (21): ShipBob maps store shipping methods to internal carriers

### Transactions Table (from Billing API)
| API Field | DB Column |
|-----------|-----------|
| `transaction_id` | `transaction_id` (PK) |
| `amount` | `cost` |
| `charge_date` | `charge_date` |
| `invoice_date` | `invoice_date_sb` |
| `invoiced_status` | `invoiced_status_sb` |
| `invoice_id` | `invoice_id_sb` |
| `additional_details.TrackingId` | `tracking_id` |

---

## SFTP Files (extras-MMDDYY.csv)

ShipBob sends daily SFTP files with additional billing breakdown:

| SFTP Column | DB Column | Notes |
|-------------|-----------|-------|
| `base_cost` | `transactions.base_cost` | Base shipping cost |
| `surcharges` | `transactions.surcharge` | DAS, fuel, etc. |
| `insurance_cost` | `transactions.insurance_cost` | Insurance if applied |

**Processing:** Must be manually imported or processed via script. The API does NOT provide this breakdown.

---

## Known Issues & Gaps

### CRITICAL: Upsert Overwrites Attribution (Fixed Dec 2025)

**Bug discovered Dec 18, 2025:** The `syncAllTransactions()` function was building upsert records with `client_id: null` when attribution failed. Supabase upsert with `ignoreDuplicates: false` overwrites ALL columns, so this was **wiping existing attribution** every time the hourly reconcile cron ran.

**Symptoms:**
- Attribution drops from 100% to ~96% after each hourly cron
- Same transactions keep losing `client_id` repeatedly
- Fix scripts work but changes get overwritten

**Root cause:** `lib/shipbob/sync.ts` line ~1775 was returning:
```typescript
return {
  transaction_id: tx.transaction_id,
  client_id: clientId,  // ← This was null when attribution failed
  merchant_id: merchantId,  // ← Also null
  // ...
}
```

**Fix:** Only include `client_id`/`merchant_id` in the record when they're NOT null:
```typescript
const baseRecord = { transaction_id: tx.transaction_id, ... }
if (clientId) {
  baseRecord.client_id = clientId
  baseRecord.merchant_id = merchantId
}
return baseRecord
```

**Key insight:** Omitting a field from upsert = "don't touch." Including `null` = "set to null."

### transactions.tracking_id ✅ 100% Populated (Dec 2025)

**Status:** Fully populated. Tracking IDs come from two sources:

| Fee Type | Source | Notes |
|----------|--------|-------|
| **Shipping** | `additional_details.TrackingId` in API response | Direct from transaction data |
| **Per Pick Fee, B2B fees** | Lookup from `shipments` table via `reference_id` | Requires shipment to be synced first |

**How it works:**
1. During normal sync, `additional_details.TrackingId` is extracted for Shipping transactions
2. For other fee types (Per Pick Fee, etc.), tracking is NOT in the API response
3. A **third pass** in `syncAllTransactions()` queries ALL transactions missing `tracking_id` and joins to `shipments` table to backfill

**⚠️ Important:** The tracking backfill pass processes ALL missing transactions, not just the current sync window. With thousands of transactions, this can take 3-5 minutes. The `sync-transactions` cron has `maxDuration = 300` to accommodate this.

**If tracking coverage drops below 100%:**
1. Check if new fee types are appearing without tracking in API
2. Verify the shipments table has the tracking data (shipment must be synced first)
3. Run manual sync to trigger backfill: `curl -X POST .../api/cron/sync-transactions`

### transactions.base_cost/surcharge Only 50% Populated
**Why:** These come from SFTP files, not API. Historical data wasn't backfilled.

**Fix:** Process SFTP files for historical transactions or accept API total only.

### Voided Shipping Transactions (is_voided) ✅ Implemented (Jan 2026)

**Problem:** When ShipBob voids a shipping label and creates a new one, we get two Shipping transactions for the same shipment with different tracking IDs. Only one should be billed.

**Detection patterns:**

| Pattern | Same Tracking? | Has Credit? | Action |
|---------|----------------|-------------|--------|
| **A: Reshipment** | Yes | Yes | DO NOT VOID - legitimate reshipment with credit |
| **B: Duplicate billing** | Yes | No | Mark older as `is_voided = true` |
| **C: Voided w/ credit** | No | Yes | DO NOT VOID - ShipBob already credited |
| **D: Voided label** | No | No | Mark older as `is_voided = true` |

**How it works:**
1. Hourly reconcile cron (`sync-reconcile`) calls `reconcileVoidedShippingTransactions()`
2. Groups all positive Shipping transactions by `reference_id` (shipment)
3. For shipments with 2+ transactions, checks if ANY credit exists for that shipment
4. If NO credit exists, marks all but the newest (by `charge_date`) as `is_voided = true`
5. Invoice generation excludes `is_voided = true` transactions via `.or('is_voided.is.null,is_voided.eq.false')`

**Key insight:** ShipBob handles voided labels two ways:
1. Issue a credit for the old label (Pattern C) - we don't need to void, ShipBob already handled it
2. Simply void without credit (Pattern D) - we must mark `is_voided = true` to exclude from billing

**Files:**
- `lib/shipbob/sync.ts`: `reconcileVoidedShippingTransactions()` and `reconcileVoidedShippingTransactionsDirect()`
- `lib/billing/invoice-generator.ts`: Filters out voided transactions
- `lib/billing/preflight-validation.ts`: Filters out voided transactions

**Preflight warning:** "X shipping transaction(s) have tracking IDs that don't match the shipment's current tracking" indicates potential voided labels still being billed.

### Invoice Linking DB Fallback ✅ Fixed (Dec 2025)

**Problem discovered Dec 22, 2025:** ShipBob's `/invoices/{id}/transactions` API doesn't return all transactions that should be on an invoice. Transactions synced by `sync-transactions` before the invoice exists have `invoice_id_sb = NULL`, and when `sync-invoices` runs, the API doesn't return them.

**Symptoms:**
- Preflight shows fewer transactions than expected
- Shipping/AdditionalFee transactions stuck with `invoice_id_sb = NULL`
- Transactions exist in DB but aren't linked to invoices

**Root cause:** `sync-invoices` relied solely on ShipBob's `/invoices/{id}/transactions` API which may not return all transactions, especially for transactions synced before the invoice was created.

**Fix:** Added DB fallback in `sync-invoices` for ALL invoice types:
1. After processing what API returns, query DB for unlinked transactions
2. Match by `charge_date` within invoice period and appropriate `reference_type`/`fee_type`
3. Link matching transactions to the invoice

**Invoice type to transaction type mapping:**
| Invoice Type | reference_type | fee_type filter |
|--------------|----------------|-----------------|
| Shipping | Shipment | = 'Shipping' |
| AdditionalFee | Shipment | NOT IN ('Shipping', 'Credit') |
| WarehouseStorage | FC | (any) |
| WarehouseInboundFee | WRO, URO | (any) |
| ReturnsFee | Return | (any) |
| Credits | (any) | = 'Credit' |

### shipments.event_* ✅ 100% Populated (Dec 2025)
Timeline backfill completed for 72,855 historical shipments. The `sync-timelines` cron continues running for in-transit shipments.

**Important terminology:**
- `status = 'Completed'` = Shipped from warehouse (fulfilled) - NOT delivered to customer
- `event_delivered IS NOT NULL` = Actually delivered to customer (carrier tracking event)

---

## Vercel Cron Timeouts (maxDuration)

**Vercel Pro tier:** 300-second (5 minute) max timeout for serverless functions.

Cron jobs that can run long MUST export `maxDuration`:
```typescript
export const maxDuration = 300  // 5 minutes
```

| Cron | maxDuration | Why |
|------|-------------|-----|
| `sync` | 120 | Multiple clients + receiving orders |
| `sync-transactions` | 300 | Tracking backfill processes ALL missing transactions |
| `sync-reconcile` | 300 | 20-day lookback with soft-delete detection |
| `sync-backfill-items` | 300 | Backfill missing order_items/shipment_items |
| `sync-older-nightly` | 300 | Full refresh of 14-45 day shipments |
| `sync-sftp-costs` | 300 | SFTP fetch + 5000+ transaction updates |

**Without maxDuration:** Functions timeout at Vercel's default (may be 60s or less), causing incomplete syncs.

### CRITICAL: Missing order_items/shipment_items (Fixed Dec 2025)

**Bug discovered Dec 29, 2025:** Orders were being synced without their products. Coverage dropped from 95% to 26%.

**Root cause:** The sync functions (`sync` and `sync-reconcile`) did not have `maxDuration` set. Vercel's default timeout was killing the function AFTER orders were upserted (STEP 2) but BEFORE order_items were created (STEP 4). Orders appeared in the database but had no items.

**Evidence:**
- API returns products for ALL orders (verified)
- Same order could have items when fetched directly, but DB had none
- Pattern: some sync batches had 0% items, others had 100%

**Fix (Dec 29, 2025):**
1. Added `maxDuration = 120` to `/api/cron/sync/route.ts`
2. Added `maxDuration = 300` to `/api/cron/sync-reconcile/route.ts`
3. Created `/api/cron/sync-backfill-items/route.ts` - hourly safety net that finds and populates missing items

**Manual backfill:** Run `node scripts/backfill-order-items.js` to fix existing orders.

---

## Rate Limits

- **ShipBob: 150 requests/minute PER TOKEN** - Each client has own budget!
- Timeline API: 500ms delay between calls
- Timeline cron: 100 shipments/run with tiered frequency
- Batch upserts: 500 records per batch

**Rate limit budget (per minute):**
| Cron | Approx Calls | Notes |
|------|--------------|-------|
| sync | ~30-50 | Orders + shipments for active clients |
| sync-transactions | ~20-30 | Transaction queries with pagination |
| sync-timelines | ~100 | Tiered: fresh every 15min, older every 2hr |
| **Total** | ~130-180 | Per-token limits allow higher throughput |

## Timeline Sync Strategy

**Tiered check frequency (Dec 2025):**

| Shipment Age | Check Interval | What's Synced | Cron |
|--------------|----------------|---------------|------|
| 0-3 days | 15 minutes | Timeline events | `sync-timelines` |
| 3-14 days | 2 hours | Timeline events | `sync-timelines` |
| 14-45 days | Nightly (3 AM UTC) | **Full refresh**: status, tracking, measurements, timeline | `sync-older-nightly` |

**Per-client capacity (100 shipments/client/run):**
- 70% (70 slots) reserved for fresh shipments (0-3d)
- 30% (30 slots) reserved for older shipments (3-14d)
- Unused fresh capacity rolls over to older queue
- **Auto-scales with clients**: 3 clients = 300 shipments/run, 10 clients = 1000/run
- Each client processed in parallel (own 150 req/min budget)

**Key columns:**
- `timeline_checked_at`: Tracks last API poll to prevent redundant checks
- `event_delivered`: When set, shipment exits the sync queue

**⚠️ Why not use `last_update_at`?**
Tested Dec 2025: ShipBob's `last_update_at` does NOT change when timeline events are added.
It only updates when the shipment record itself changes (status, tracking, etc.).
Age-based polling with `timeline_checked_at` is the correct approach.

**Math (per client):**
- Fresh shipments (0-3d): 70/min × 15 min window = ~1,050 capacity/client
- Older shipments (3-14d): 30/min × 120 min window = ~3,600 capacity/client
- Nightly catches 14-45 day stragglers (200/client/night)

---

## UI Age Calculations

Different tabs calculate "Age" differently:

| Tab | Age Formula | Start Date | End Date |
|-----|-------------|------------|----------|
| **Shipments** | `event_labeled` → `delivered_date` or now | When label was created | When delivered (or now if in transit) |
| **Unfulfilled** | `order_import_date` → now | When order was imported to ShipBob | Now (order is still processing) |

**Key insight:** Shipped orders use `event_labeled` (label creation) as the start point because that's when the shipment actually began. Unfulfilled orders use `order_import_date` because they haven't shipped yet.

**Related columns:**
- `orders.order_import_date` - When order arrived in ShipBob
- `shipments.event_labeled` - When shipping label was created
- `shipments.delivered_date` - When carrier marked delivered

---

## Sync Files

| File | Purpose |
|------|---------|
| `lib/shipbob/sync.ts` | Core sync logic (syncAll, syncClient, syncAllTransactions, syncReturns) |
| `lib/shipbob/client.ts` | ShipBob API client wrapper |
| `app/api/cron/sync/route.ts` | 1-minute cron: orders & shipments |
| `app/api/cron/sync-timelines/route.ts` | 1-minute cron: timeline events (0-14 days, tiered) |
| `app/api/cron/sync-older-nightly/route.ts` | Nightly cron: full refresh for older shipments (14-45 days) |
| `app/api/cron/sync-transactions/route.ts` | 1-minute cron: billing transactions |
| `app/api/cron/sync-reconcile/route.ts` | Hourly: soft-delete detection |
| `app/api/cron/sync-invoices/route.ts` | Daily: ShipBob invoice sync |

---

## Manual Sync Scripts

| Script | Purpose |
|--------|---------|
| `scripts/sync-orders-fast.js` | High-performance batch sync (legacy) |
| `scripts/backfill-timeline-invoice.js` | Backfill timeline events for historical shipments |
| `scripts/sync-returns.js` | Manual returns sync |

---

## Debugging Sync Issues

1. **Check cron logs:** Vercel dashboard → Functions → Logs
2. **Manual trigger:** `curl -X POST https://your-domain.com/api/cron/sync`
3. **Data quality check:**
```sql
-- Check field population
SELECT
  COUNT(*) as total,
  COUNT(tracking_id) as has_tracking,
  COUNT(carrier) as has_carrier
FROM shipments;
```
