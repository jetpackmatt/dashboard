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

When syncing transactions with parent token, `client_id` is determined by:

| reference_type | Attribution Strategy |
|----------------|---------------------|
| **Shipment** | `reference_id` → `shipments.shipment_id` → `client_id` |
| **FC** | Parse InventoryId from `{FC_ID}-{InventoryId}-{LocationType}` → `products.variants[].inventory.inventory_id` |
| **Return** | `reference_id` → `returns.return_id` → `client_id` |
| **Default** | Route by `transaction_fee`: Payment → ShipBob Payments, CC Fee → Jetpack Costs |
| **WRO/URO** | Currently unattributed (manual review needed) |
| **TicketNumber** | Currently unattributed |

System clients (in `clients` table with `is_internal=true`):
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

| Shipment Age | Check Interval | What's Synced |
|--------------|----------------|---------------|
| 0-3 days | 15 minutes | Timeline events only |
| 3-14 days | 2 hours | Timeline events only |
| 14-45 days | Nightly (3 AM UTC) | **Full refresh**: status, tracking, measurements, timeline |

**Key columns:**
- `timeline_checked_at`: Tracks last API poll to prevent redundant checks
- `event_delivered`: When set, shipment exits the sync queue

**Math:**
- Fresh shipments (0-3d): ~1,600 / 15 min = 107/min needed
- Older shipments (3-14d): ~5,000 / 120 min = 42/min needed
- Nightly catches 14-45 day stragglers (200/client/night)

---

## Sync Files

| File | Purpose |
|------|---------|
| `lib/shipbob/sync.ts` | Core sync logic (syncAll, syncClient, syncAllTransactions, syncReturns) |
| `lib/shipbob/client.ts` | ShipBob API client wrapper |
| `app/api/cron/sync/route.ts` | 1-minute cron: orders & shipments |
| `app/api/cron/sync-timelines/route.ts` | 1-minute cron: timeline events (0-14 days, tiered) |
| `app/api/cron/sync-timelines-nightly/route.ts` | Nightly cron: older shipments (14-45 days) |
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
