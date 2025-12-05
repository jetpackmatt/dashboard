# Sync Architecture Plan - Dec 4, 2025

## Key Findings

1. **Historical data IS accessible** - API returns transactions from Jan 2024+
2. **Reference types observed**:
   - `Shipment` - Most common (shipping fees, pick fees)
   - `Default` - Credits, payments linked to shipments
   - `FC` - Storage fees (less frequent, monthly)
   - `WRO` - Receiving fees (less frequent)
   - `Return` - Return processing (less frequent)
3. **Full history sync possible** via `POST /transactions:query` with `from_date`/`to_date`

---

## Migration Required (Run First!)

Before running new sync scripts, execute this SQL in Supabase Dashboard:

```sql
-- Step 1: Rename ShipBob invoice columns for clarity
ALTER TABLE transactions RENAME COLUMN invoiced_status TO invoiced_status_sb;
ALTER TABLE transactions RENAME COLUMN invoice_id TO invoice_id_sb;

-- Step 2: Add Jetpack invoice tracking columns
ALTER TABLE transactions ADD COLUMN invoiced_status_jp BOOLEAN DEFAULT false;
ALTER TABLE transactions ADD COLUMN invoice_id_jp UUID;

-- Step 3: Add indexes for common queries
CREATE INDEX idx_transactions_invoice_jp ON transactions(invoice_id_jp) WHERE invoice_id_jp IS NOT NULL;
CREATE INDEX idx_transactions_unbilled_jp ON transactions(invoiced_status_jp) WHERE invoiced_status_jp = false;
CREATE INDEX idx_transactions_reference_id ON transactions(reference_id);
CREATE INDEX idx_transactions_reference_type ON transactions(reference_type);
```

**Migration script:** `scripts/migrations/001-rename-invoice-columns.js`

---

## Scripts Created

| Script | Purpose | Usage |
|--------|---------|-------|
| `scripts/sync-all-transactions.js` | Full historical transaction sync | `node scripts/sync-all-transactions.js --full` |
| `scripts/migrations/001-rename-invoice-columns.js` | Column rename migration | Outputs SQL to run |

## ✅ COMPLETED - Dec 4, 2025

### Phase 1: Full Transaction Sync - DONE
1. **Historical sync completed**: 146,912 transactions in database
2. **New cron endpoint**: `/api/cron/sync-transactions` - runs every 5 min
3. **New sync function**: `syncAllTransactions()` in `lib/shipbob/sync.ts`
4. **Column migration applied**: `invoiced_status` → `invoiced_status_sb`, `invoice_id` → `invoice_id_sb`

### Current Cron Schedule (Updated)
| Cron | Schedule | What It Does |
|------|----------|--------------|
| `/api/cron/sync` | Every minute | Orders, Shipments, order_items, shipment_items, cartons, transactions (shipment-linked) |
| `/api/cron/sync-transactions` | Every 5 min | ALL transactions (date-range based - storage, returns, receiving, credits) |
| `/api/cron/sync-reconcile` | Hourly | Full reconciliation + soft-delete detection |
| `/api/cron/generate-invoices` | Mon 10am UTC | Invoice generation |

### Transaction Data Summary
- **Total transactions**: 146,912
- **Reference types**: Shipment (129,475), FC (16,666), Default (393), Return (202), WRO (145), URO (27), TicketNumber (4)
- **Client attribution**: 88.3% attributed (Shipment/Default types matched to clients via shipment lookup)

---

## Current State

### Database Tables
| Table | Rows | Source | Status |
|-------|------|--------|--------|
| `transactions` | 6,098 | API sync (shipment-linked only) | Partial - missing non-shipment types |
| `billing_shipments` | 73,519 | Excel import | Historical data |
| `billing_shipment_fees` | 51,363 | Excel import | Historical data |
| `billing_storage` | 9,935 | Excel import | Historical data |
| `billing_credits` | 334 | Excel import | Historical data |
| `billing_returns` | 201 | Excel import | Historical data |
| `billing_receiving` | 116 | Excel import | Historical data |
| `orders` | ~68K | API sync | Working |
| `shipments` | ~73K | API sync | Working |
| `returns` | 207 | Unknown | Not being synced |

### Current Cron Jobs
| Cron | Schedule | What It Does |
|------|----------|--------------|
| `/api/cron/sync` | Every minute | Orders, Shipments, order_items, shipment_items, cartons, **transactions (shipment-linked only)** |
| `/api/cron/sync-reconcile` | Hourly | Same as above with 1-day lookback + soft-delete detection |
| `/api/cron/generate-invoices` | Mon 10am UTC | Invoice generation |

### The Problem
The current transaction sync (lines 639-691 in sync.ts) fetches transactions using:
```javascript
body: JSON.stringify({ reference_ids: batch, page_size: 1000 })
```
Where `batch` = shipment IDs from current sync. This misses:
- Storage fees (`reference_type: "FC"`)
- Receiving fees (`reference_type: "WRO"`)
- Return fees (`reference_type: "Return"`)
- Credits/adjustments (`reference_type: "TicketNumber"`, `"Default"`)
- Any transactions not tied to recently-synced shipments

---

## Table Strategy: `transactions` vs `billing_*`

### Option A: Single `transactions` Table (Recommended)
Keep one `transactions` table as the source of truth from the Transactions API:
- Raw data exactly as it comes from ShipBob
- Use views or query filters to categorize by `reference_type` and `transaction_fee`
- The `billing_*` tables become legacy (from Excel import) - eventually deprecated

**Pros:**
- Single source of truth
- Simpler sync logic
- Matches API structure directly

**Cons:**
- Need to migrate/reconcile with existing `billing_*` data

### Option B: Dual Tables (Hybrid)
Keep both:
- `transactions` = raw API data
- `billing_*` = categorized/enriched for reporting

**Cons:**
- Data duplication
- Sync complexity
- Risk of drift between tables

### Recommendation: Option A
The `billing_*` tables were populated from Excel imports. Going forward, sync everything to `transactions` and use views for categorization. Keep `billing_*` as read-only historical reference until we verify `transactions` has complete parity.

---

## APIs to Sync

### 1. Transactions API (via parent token)
**Endpoint:** `POST /2025-07/transactions:query`

**What to sync:**
- ALL transactions by date range (not just shipment-linked)
- Use `from_date` / `to_date` parameters
- Paginate with cursor

**Reference Types to capture:**
| reference_type | Description | Current Status |
|----------------|-------------|----------------|
| `Shipment` | Shipping fees, pick fees | Partially synced |
| `Default` | Credits, payments | Not synced |
| `WRO` | Receiving fees | Not synced |
| `FC` | Storage fees | Not synced |
| `Return` | Return processing | Not synced |
| `TicketNumber` | Manual adjustments | Not synced |

### 2. Returns API (via child token per client)
**Endpoint:** `GET /2025-07/return`

**What to sync:**
- Return ID, status, created_date
- Items being returned
- Order linkage

**Target table:** `returns`

### 3. Receiving API (via child token per client)
**Endpoint:** `GET /2025-07/receiving`

**What to sync:**
- WRO ID, status, created_date
- Items received
- FC location

**Target table:** `receiving` or `warehouse_receiving_orders`

### 4. Products/Catalog API (via child token per client)
**Endpoint:** `GET /2025-07/product`

**What to sync:**
- Product ID, SKU, name
- Inventory levels per FC

**Target table:** `products` or `catalog`

---

## Implementation Plan

### Phase 1: Full Transaction Sync
**Goal:** Sync ALL transactions regardless of reference type

**Changes to `lib/shipbob/sync.ts`:**

```typescript
// NEW: Sync all transactions for a date range (not just shipment-linked)
async function syncAllTransactions(
  startDate: Date,
  endDate: Date,
  clientId: string,  // For attribution via shipment JOINs
  parentToken: string
): Promise<TransactionSyncResult> {
  const transactions = []
  let cursor = null

  do {
    let url = `${SHIPBOB_API_BASE}/transactions:query`
    if (cursor) url += `?Cursor=${encodeURIComponent(cursor)}`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${parentToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from_date: startDate.toISOString(),
        to_date: endDate.toISOString(),
        page_size: 1000
      })
    })

    const data = await response.json()
    transactions.push(...(data.items || []))
    cursor = data.next
  } while (cursor)

  return transactions
}
```

**Client attribution strategy:**
- `Shipment`/`Default`: JOIN `transactions.reference_id` → `shipments.shipment_id` → `shipments.client_id`
- `WRO`/`Return`/`FC`: Store with `client_id = NULL` initially, enrich via Returns/Receiving sync later

### Phase 2: Returns Sync
**Goal:** Sync returns data per client

**New function:**
```typescript
async function syncReturns(
  clientId: string,
  token: string,  // Child token
  startDate: Date,
  endDate: Date
): Promise<ReturnSyncResult>
```

**Target table:** `returns` (verify schema matches API response)

### Phase 3: Receiving Sync
**Goal:** Sync WRO data per client

**New function:**
```typescript
async function syncReceiving(
  clientId: string,
  token: string,  // Child token
  startDate: Date,
  endDate: Date
): Promise<ReceivingSyncResult>
```

**Target table:** Create `receiving` or `warehouse_receiving_orders`

### Phase 4: Products/Catalog Sync
**Goal:** Sync product catalog per client

**New function:**
```typescript
async function syncProducts(
  clientId: string,
  token: string,  // Child token
): Promise<ProductSyncResult>
```

**Target table:** Create `products` or `catalog`

---

## Updated Cron Schedule

| Cron | Schedule | What It Syncs |
|------|----------|---------------|
| `/api/cron/sync` | Every minute | Orders, Shipments, order_items, shipment_items, cartons |
| `/api/cron/sync-transactions` | Every 5 min | ALL transactions (date-range based) |
| `/api/cron/sync-reconcile` | Hourly | Full reconciliation + soft-delete detection |
| `/api/cron/sync-returns` | Every 15 min | Returns per client |
| `/api/cron/sync-receiving` | Every 15 min | Receiving/WRO per client |
| `/api/cron/sync-products` | Daily | Product catalog per client |
| `/api/cron/generate-invoices` | Mon 10am UTC | Invoice generation |

**Alternative:** Consolidate into fewer crons that call different sync functions based on options.

---

## Schema Updates Needed

### 1. `transactions` table enhancements
```sql
-- Ensure client_id is nullable (for attribution-pending records)
ALTER TABLE transactions ALTER COLUMN client_id DROP NOT NULL;

-- Add attribution timestamp
ALTER TABLE transactions ADD COLUMN attributed_at TIMESTAMPTZ;

-- Add index for attribution JOINs
CREATE INDEX idx_transactions_reference_id ON transactions(reference_id);
CREATE INDEX idx_transactions_reference_type ON transactions(reference_type);
```

### 2. `receiving` table (if doesn't exist)
```sql
CREATE TABLE receiving (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id),
  wro_id TEXT NOT NULL UNIQUE,
  status TEXT,
  created_date TIMESTAMPTZ,
  expected_arrival_date TIMESTAMPTZ,
  fc_name TEXT,
  fc_id INTEGER,
  -- items stored as JSONB or separate table
  items JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE receiving ENABLE ROW LEVEL SECURITY;
```

### 3. `products` table (if doesn't exist)
```sql
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id),
  shipbob_product_id TEXT NOT NULL,
  sku TEXT,
  name TEXT,
  barcode TEXT,
  gtin TEXT,
  unit_price DECIMAL(10,2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, shipbob_product_id)
);
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
```

---

## Next Steps (Priority Order)

1. **[HIGH]** Implement full transaction sync (Phase 1)
   - Modify sync.ts to fetch ALL transactions by date range
   - Add client attribution via shipment JOINs
   - Test with recent data

2. **[HIGH]** Verify transaction data completeness
   - Compare `transactions` table vs ShipBob dashboard totals
   - Verify all reference_types are being captured

3. **[MEDIUM]** Add Returns sync (Phase 2)
   - Create/verify `returns` table schema
   - Implement sync function
   - Link to transactions via reference_id

4. **[MEDIUM]** Add Receiving sync (Phase 3)
   - Create `receiving` table
   - Implement sync function
   - Link to transactions via WRO ID

5. **[LOW]** Add Products sync (Phase 4)
   - Create `products` table
   - Implement sync function
   - Use for enriching shipment/order item data

6. **[FUTURE]** Deprecate `billing_*` tables
   - Verify `transactions` has complete historical data
   - Create views to match `billing_*` table queries
   - Update reports to use `transactions` table

---

## Questions to Resolve

1. **Keep `billing_*` tables?**
   - They contain historical data from Excel imports
   - Schema differs from raw `transactions` API
   - Recommendation: Keep as read-only archive, use `transactions` going forward

2. **Transaction attribution for non-shipment types?**
   - Storage (FC): Parse reference_id format `{FC_ID}-{InventoryID}-{LocationType}`
   - Returns: Link via return_id → orders table
   - Receiving: Link via WRO ID → receiving table
   - Credits: Often linked to shipments via additional_details.Comment

3. **Rate limits with full transaction sync?**
   - Parent token: 150 req/min
   - Per-client tokens: 150 req/min each
   - Full sync may need batching over multiple minutes

---

*Created: Dec 4, 2025*
*Status: Planning - awaiting approval*
