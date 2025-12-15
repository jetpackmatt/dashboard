# Data Sync Architecture

**Read this when:** Working on sync crons, ShipBob API integration, data flow issues, or fixing missing fields.

---

## Cron Jobs

| Endpoint | Schedule | What It Does |
|----------|----------|--------------|
| `/api/cron/sync` | Every 1 min | Syncs orders/shipments using **child tokens** + `LastUpdateStartDate` (catches updates) |
| `/api/cron/sync-timelines` | Every 1 min | Updates timeline events for undelivered shipments (1000/run, 14-day window) |
| `/api/cron/sync-transactions` | Every 1 min | Syncs ALL transaction types using **parent token** (3-min lookback) |
| `/api/cron/sync-reconcile` | Every hour | Soft-delete detection (20-day lookback, uses `StartDate`) |
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
│                   EVERY 5 MINUTES (sync-transactions)               │
├─────────────────────────────────────────────────────────────────────┤
│  Using parent token:                                                │
│                                                                     │
│  1. POST /2025-07/transactions:query                                │
│     - from_date: 10 minutes ago                                     │
│     - to_date: now                                                  │
│     - page_size: 1000 (uses cursor pagination)                      │
│                                                                     │
│  2. For each transaction, attribute client_id by:                   │
│     - Shipment: reference_id → shipments.shipment_id → client_id    │
│     - FC: parse InventoryId from reference_id → products.variants   │
│     - Return: reference_id → returns.return_id → client_id          │
│     - Default/Payment: route to system clients                      │
│                                                                     │
│  3. Batch upsert transactions (500 at a time)                       │
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
3. **Invoice sibling attribution**: If ANY transaction on same invoice has client_id, use that for all
4. **Proactive sync**: Sync returns/orders for ALL clients (not just based on transactions)

### Attribution Priority Order

When syncing transactions with parent token, `client_id` is determined in this order:

| Priority | reference_type | Attribution Strategy |
|----------|----------------|---------------------|
| 1 | **Shipment** | `reference_id` → `shipments.shipment_id` → `client_id` |
| 2 | **FC** | Parse InventoryId from `{FC_ID}-{InventoryId}-{LocationType}` → `products.variants[].inventory.inventory_id` |
| 3a | **Return** | `reference_id` → `returns.return_id` → `client_id` |
| 3b | **Return** | (fallback) Parse "Order XXXXX" from Comment → `orders.shipbob_order_id` → `client_id` |
| 4 | **WRO/URO** | `reference_id` → `receiving_orders.shipbob_receiving_id` → `client_id` |
| 5 | **Default** | Route by `transaction_fee`: Payment → ShipBob Payments, CC Fee → Jetpack Costs |
| 6 | **Invoice Sibling** | If `invoice_id_sb` exists, find any sibling transaction with `client_id` |
| 7 | **TicketNumber** | Parse client name from Comment (fuzzy matching) |

### Why NOT to Iterate Through Clients

**Anti-pattern:** For each unattributed transaction, try each client's token until one works.

**Why it doesn't scale:**
- With 50 clients × 20 unattributed transactions = 1,000 API calls
- API rate limit is 150/min per token, but creates unnecessary load
- Sequential iteration adds latency

**Correct approach:** Build complete lookup tables FIRST (sync all returns for all clients), THEN attribute.

### System Clients

In `clients` table with `is_internal=true`:
- **ShipBob Payments**: Holds ACH payment transactions
- **Jetpack Costs**: Holds parent-level fees (CC processing, etc.)

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
| API Field | DB Column |
|-----------|-----------|
| `shipments[].id` | `shipment_id` |
| `shipments[].tracking.tracking_number` | `tracking_id` |
| `shipments[].tracking.carrier` | `carrier` |
| `shipments[].ship_option` | `carrier_service` |
| `shipments[].zone.id` | `zone_used` |
| `shipments[].location.name` | `fc_name` |
| `shipments[].measurements.total_weight_oz` | `actual_weight_oz` |
| `shipments[].measurements.length_in` | `length` |
| `shipments[].measurements.width_in` | `width` |
| `shipments[].measurements.depth_in` | `height` |
| (calculated) | `dim_weight_oz`, `billable_weight_oz` |

### Shipments Timeline Events (from Timeline API)
| log_type_id | DB Column |
|-------------|-----------|
| 601 | `event_created` |
| 602 | `event_picked` |
| 603 | `event_packed` |
| 604 | `event_labeled` |
| 605 | `event_labelvalidated` |
| 607 | `event_intransit` |
| 608 | `event_outfordelivery` |
| 609 | `event_delivered` |
| 611 | `event_deliveryattemptfailed` |

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

### transactions.tracking_id ~99.9% Populated
**Status:** Now well-populated. Sync extracts from `additional_details.TrackingId` when present, and backfill script ran to copy from linked shipments.

### transactions.base_cost/surcharge Only 50% Populated
**Why:** These come from SFTP files, not API. Historical data wasn't backfilled.

**Fix:** Process SFTP files for historical transactions or accept API total only.

### shipments.event_* ✅ 100% Populated (Dec 2025)
Timeline backfill completed for 72,855 historical shipments. The `sync-timelines` cron continues running for in-transit shipments.

**Important terminology:**
- `status = 'Completed'` = Shipped from warehouse (fulfilled) - NOT delivered to customer
- `event_delivered IS NOT NULL` = Actually delivered to customer (carrier tracking event)

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
