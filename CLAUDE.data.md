# Data Strategy - ShipBob Integration & Database Architecture

**Read this when:** Working on database schema, ShipBob API integration, markup system, data imports, or billing features.

---

## Executive Summary

Strategy for transitioning from mock data to production database with real ShipBob data, implementing client markup tables, and establishing a webhook-first data pipeline.

---

## ShipBob API Capabilities

### Authentication
- **Personal Access Token (PAT)** - Non-expiring, best for single integration
- **OAuth 2.0** - Required for multi-user apps, 1-hour access tokens

### Per-Client Token Architecture

**Two-Tier Token Strategy:**

| Token Type | Owner | APIs Accessible | Storage |
|------------|-------|-----------------|---------|
| **Parent Token** | Jetpack (3PL) | Billing API only | `.env.local` |
| **Child Tokens** | Per-brand (Henson, Methyl-Life, etc.) | Orders, Shipments, Returns, Inventory APIs | `client_api_credentials` table |

**Why two tiers?**
- ShipBob's Billing API returns **consolidated billing** for all child merchants under the parent account
- The parent token CANNOT access individual brand data (orders, shipments, etc.)
- Each brand's data requires their own PAT from their ShipBob account
- **CRITICAL:** Child tokens return 0 transactions from Billing API - must use parent token!

**Context:** Parent account PAT only accesses consolidated Billing API. To access child merchant Orders/Shipments data, each child needs their own PAT.

**Transaction Sync Client Attribution (Dec 2025) - 100% ACHIEVED:**
- Parent token fetches ALL transactions (consolidated across all merchants)
- Attribution baked into `lib/shipbob/sync.ts` → `syncAllTransactions()`
- Cron: `/api/cron/sync-transactions` runs every 5 minutes

**System Clients (inactive, `is_active=false`):**
| Client | Purpose | Transaction Fees |
|--------|---------|-----------------|
| **ShipBob Payments** | ACH payments FROM clients TO ShipBob | Payment |
| **Jetpack Costs** | Parent-level charges TO Jetpack | CC Processing Fee, Warehousing Fee |

**Attribution Strategies by reference_type (in order):**
1. **Shipment**: `reference_id` → `shipments.shipment_id` → `shipments.client_id`
2. **FC (Storage)**: Parse InventoryId from `reference_id` format `{FC_ID}-{InventoryId}-{LocationType}` → lookup via `billing_storage`
3. **Return**: `reference_id` → `returns.return_id` → `returns.client_id`
4. **Default**: Route by `transaction_fee`:
   - `Payment` → ShipBob Payments client
   - `Credit Card Processing Fee`, `Warehousing Fee` → Jetpack Costs client
   - `Credit` → Invoice-based fallback (attributed to client on same invoice)
5. **WRO/URO**: Invoice-based fallback (same `invoice_id_sb` = same client)
6. **TicketNumber**: Currently unattributed - can parse client name from `additional_details.Comment`
7. **Final fallback**: Invoice-based attribution for any remaining

**Key Findings:**
- FC `reference_id` contains InventoryId even when `additional_details.InventoryId` is empty
- WRO transaction IDs (11711xxx) differ from Receiving API WRO IDs (87xxxx) - use invoice fallback
- URO fees charged AFTER package is attributed - invoice-based attribution works
- Credits have `invoice_id_sb` - attribute via sibling transactions on same invoice
- New transactions without invoice (e.g., today's credits) will be attributed on Monday when invoiced

**Attribution Scripts (for manual cleanup):**
- `scripts/attribute-transactions.js` - Full attribution with all strategies
- `scripts/attribute-credits.js` - Invoice-based credit attribution
- `scripts/create-jetpack-costs-client.js` - Create system client for parent-level costs

**Token Storage:** Supabase `client_api_credentials` table with RLS

```sql
-- Table structure (already created in Supabase)
CREATE TABLE client_api_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'shipbob',
  api_token TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, provider)
);

-- RLS enabled with NO policies = completely blocked from browser
ALTER TABLE client_api_credentials ENABLE ROW LEVEL SECURITY;
```

**Security Model:**
- RLS blocks all browser/client access (anon, authenticated)
- Only `service_role` key can access (server-side API routes only)
- Supabase encrypts at rest (AES-256)
- Equivalent security to env vars, but scales to N clients

**Adding a New Client Token:**

```sql
-- 1. Create client record (if not exists)
INSERT INTO clients (company_name, shipbob_user_id)
VALUES ('Henson Shaving', '386350')
RETURNING id;
-- Returns: 'abc123-uuid-here'

-- 2. Store their PAT token
INSERT INTO client_api_credentials (client_id, provider, api_token)
VALUES ('abc123-uuid-here', 'shipbob', 'pat_xxxxxxxxxxxxx');
```

**Retrieving Token in API Routes:**

```typescript
// lib/supabase-admin.ts
import { createClient } from '@supabase/supabase-js'

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!  // Never expose to client!
)

// In API route:
async function getClientToken(clientId: string) {
  const { data, error } = await supabaseAdmin
    .from('client_api_credentials')
    .select('api_token')
    .eq('client_id', clientId)
    .eq('provider', 'shipbob')
    .single()

  if (error) throw new Error('Token not found')
  return data.api_token
}
```

**Known Child Merchants:**
| Merchant | User ID | Status |
|----------|---------|--------|
| Henson Shaving | 386350 | Pending PAT |
| Methyl-Life® | 392333 | Pending PAT |

### Rate Limits
- 150 requests/minute (sliding window)
- 429 response with `x-retry-after` header when exceeded

### Webhooks (Real-time)

**⚠️ CRITICAL: Use 2025-07 Webhook API, NOT 1.0**

The 1.0 and 2025-07 webhook APIs have different topic names and management endpoints:

| Aspect | 1.0 API (DEPRECATED) | 2025-07 API (USE THIS) |
|--------|----------------------|------------------------|
| **Endpoint** | `/1.0/webhook` | `/2025-07/webhook` |
| **Pagination** | Page-based (`Page`, `Limit`) | Cursor-based (`Cursor`) |
| **Response** | Raw array | `{ items: [], next, prev }` |

**Topic Name Changes (1.0 → 2025-07):**

| 1.0 Topic (OLD) | 2025-07 Topic (USE THIS) |
|-----------------|--------------------------|
| `order_shipped` | `order.shipped` |
| `shipment_delivered` | `order.shipment.delivered` |
| `shipment_exception` | `order.shipment.exception` |
| `shipment_onhold` | `order.shipment.on_hold` |
| `shipment_cancelled` | `order.shipment.cancelled` |

**Available Events (2025-07):**

| Event | Description |
|-------|-------------|
| `order.shipped` | When shipment leaves warehouse |
| `order.shipment.delivered` | Delivery confirmation |
| `order.shipment.exception` | Delivery issues |
| `order.shipment.on_hold` | Shipment held |
| `order.shipment.cancelled` | Cancellation |
| `return.created` | Return initiated |
| `return.updated` | Return status changed |
| `return.completed` | Return finished |

**Webhook Management (2025-07):**
```bash
# List subscriptions
GET /2025-07/webhook?Cursor=xxx

# Create subscription
POST /2025-07/webhook
{
  "topic": "order.shipped",
  "subscription_url": "https://your-domain.com/api/webhooks/shipbob"
}

# Delete subscription
DELETE /2025-07/webhook/{subscription_id}
```

### ⚠️ CRITICAL: Data Flow Architecture

**Start from webhooks/events, enrich with billing data:**

| Transaction Type | Data Source | Trigger | Billing Link |
|------------------|-------------|---------|--------------|
| **Shipments** | Webhooks → Orders API (child token) | `order.shipped` | `reference_id` = Shipment ID |
| **Returns** | Webhooks → Returns API (child token) | `return.created` | `reference_id` = Return ID |
| **Receiving (WRO)** | Webhooks → Receiving API (child token) | Receiving events | `reference_id` = WRO ID |
| **Storage** | ⚠️ **Invoice only** (parent token) | Weekly/monthly invoice | No webhook trigger |

**Storage is DIFFERENT:**
- No webhooks for storage - it's calculated periodically by ShipBob
- Must reconcile from invoices, not real-time data
- Billing interval varies by client contract (weekly, monthly)
- Always pull storage charges from `invoice_type: "WarehouseStorage"` invoices

**Sync Strategy:**
1. **Per-brand sync:** Use child tokens to fetch orders/shipments/returns
2. **Billing enrichment:** Use parent token to get transaction costs via `reference_id`
3. **Storage sync:** Fetch from Storage invoices only (no webhook correlation)

### Billing API (2025-07 Version)
| Endpoint | Purpose |
|----------|---------|
| `GET /2025-07/invoices` | Paginated invoice list with date filtering |
| `POST /2025-07/transactions:query` | Query transactions with filters (batch support!) |
| `GET /2025-07/invoices/{invoiceid}/transactions` | Transactions by invoice |
| `GET /2025-07/transaction-fees` | Get all fee types (returns 86 types) |

**IMPORTANT:** API uses `snake_case` for all field names, not camelCase.

---

### ✅ VERIFIED: Invoice Types (7 total)

| Invoice Type | Description | Example Total (90 days) |
|--------------|-------------|-------------------------|
| **Shipping** | Carrier costs for B2C shipments | $62,382.39 |
| **AdditionalFee** | Pick fees, packaging, etc. | $5,268.68 |
| **WarehouseStorage** | Monthly storage fees | $3,438.18 |
| **WarehouseInboundFee** | Receiving/WRO fees | $358.75 |
| **ReturnsFee** | Return processing fees | $172.40 |
| **Credits** | Refunds, adjustments (negative) | -$2,624.11 |
| **Payment** | Payments made (negative) | -$67,024.63 |

---

### ✅ VERIFIED: Universal ID Strategy

**`reference_id` is the universal linker across all transaction types.**

#### How IDs Work in ShipBob

| Field | Purpose | Example | Use Case |
|-------|---------|---------|----------|
| `reference_id` | Shipment/Order/Return ID | `"319900667"` | **JOIN key** - links multiple fees to one shipment |
| `reference_type` | What reference_id refers to | `"Shipment"`, `"Return"`, `"Order"` | Filter by transaction category |
| `transaction_id` | Unique per fee line item | `"01KAYV6C5T8FSYNG67B5PTAP50"` | **PRIMARY KEY** - deduplication |
| `invoice_id` | Weekly billing invoice | `8595619` or `null` | Links to invoices (null until invoiced) |

#### Multi-Fee Pattern (Critical Understanding)

One shipment generates multiple transaction records, one per fee type:

```
Shipment #319900667:
├── transaction_id: "01KAX..." → Per Pick Fee:  $0.26
└── transaction_id: "01KAY..." → Shipping:      $6.07
                                 ─────────────────────
                         Total Cost for Shipment: $6.33
```

**Schema Implications:**
- Store `transaction_id` as PRIMARY KEY (deduplication)
- Store `reference_id` + `reference_type` for linking
- Query: "All costs for shipment X" = `WHERE reference_id = 'X'`
- Query: "All shipments" = `WHERE reference_type = 'Shipment'`

#### ✅ VERIFIED: Complete Reference Type Mapping (Dec 2025)

| reference_type | transaction_fee (examples) | reference_id format | Client Linkage |
|----------------|---------------------------|---------------------|----------------|
| **Shipment** | Shipping, Per Pick Fee | Shipment ID (e.g., `320953692`) | `transactions.client_id` or JOIN `shipments.shipment_id` |
| **Default** | Credit, Payment | Shipment ID | `transactions.client_id` or JOIN `shipments.shipment_id` |
| **WRO** | WRO Receiving Fee | WRO ID (e.g., `869656`) | `transactions.client_id` (per-client sync) |
| **FC** | Warehousing Fee | `{FC_ID}-{InventoryID}-{LocationType}` (e.g., `182-21286548-Shelf`) | `transactions.client_id` (per-client sync) |
| **Return** | Return to sender - Processing Fees | Return ID (e.g., `2933435`), Order ID in Comment | `transactions.client_id` (per-client sync) |
| **TicketNumber** | Various adjustments | Ticket ID | `transactions.client_id` |

**Key Insight:** The per-client sync strategy using child tokens automatically solves client attribution for ALL transaction types. When we query `POST /transactions:query` with a client's token, we only get that client's transactions. The `client_id` is implicit in the sync process - no need to decode reference_ids or look up inventory/products.

#### Storage Transaction Details (Warehousing Fee)

```json
{
  "transaction_fee": "Warehousing Fee",
  "reference_type": "FC",
  "reference_id": "182-21286548-Shelf",
  "additional_details": {
    "InventoryId": "",
    "LocationType": "",
    "Comment": "FulfillmentCenter = Riverside (CA) | 1 Shelf(s) @$8.0/month/Shelf"
  }
}
```

- Storage invoices (invoice_type: `WarehouseStorage`) contain thousands of line items
- One line per inventory item per location type per FC
- `reference_id` format: `{FC_ID}-{InventoryID}-{LocationType}`
- Inventory API returns 404 when using parent token (can only see products via child tokens)
- **Strategy:** Sync storage transactions per-client with child tokens to get automatic client_id

#### Returns Transaction Details

```json
{
  "transaction_fee": "Return to sender - Processing Fees",
  "reference_type": "Return",
  "reference_id": "2933435",
  "additional_details": {
    "Comment": "Return to sender fee for Order 316835698"
  }
}
```

- Returns invoices (invoice_type: `ReturnsFee`) link to Return IDs
- Order ID is embedded in the Comment field - can be parsed with regex: `/Order\s+(\d+)/i`
- **Strategy:** Sync returns per-client with child tokens, or parse Order ID from Comment to JOIN orders table

---

### ✅ VERIFIED: Transaction Fee Types (86 total)

Top fee types by frequency:
| Fee Type | Category | Notes |
|----------|----------|-------|
| **Shipping** | Carrier | Base shipping cost |
| **Per Pick Fee** | Fulfillment | Per-item picking |
| **Warehousing Fee** | Storage | Monthly storage |
| **WRO Receiving Fee** | Inbound | Receiving labor |
| **Return Fee** | Returns | Return processing |
| **Freight** | Inbound | B2B freight |
| **Address Correction** | Surcharge | Carrier correction |
| **Delivery Area Surcharge** | Surcharge | Remote area fee |
| **Long Term Storage Fee** | Storage | 6+ month storage |
| ... | ... | (86 total - see API) |

---

### ✅ VERIFIED: API Response Structures

#### Invoice Response
```json
{
  "items": [
    {
      "invoice_id": 8595619,
      "invoice_date": "2025-11-24",
      "invoice_type": "Credits",
      "amount": -200.00,
      "currency_code": "USD",
      "running_balance": 14020.69
    }
  ],
  "next": "cursor_string...",  // For pagination
  "last": "cursor_string..."
}
```

#### Transaction Response
```json
{
  "items": [
    {
      "transaction_id": "01KAYV6C5T8FSYNG67B5PTAP50",
      "amount": 6.58,
      "currency_code": "USD",
      "charge_date": "2025-11-26",
      "invoiced_status": false,
      "invoice_date": null,
      "invoice_id": null,
      "transaction_fee": "Shipping",
      "reference_id": "320263454",
      "reference_type": "Shipment",
      "transaction_type": "Charge",
      "fulfillment_center": "Ontario 6 (CA)",
      "taxes": [],
      "additional_details": {
        "TrackingId": "UUS5BS2764446177552",
        "Comment": ""
      }
    }
  ],
  "next": "cursor_string..."
}
```

#### Key Fields for Our Use:
- `additional_details.TrackingId` - Carrier tracking number
- `fulfillment_center` - Which warehouse shipped it
- `invoiced_status` - false until weekly invoice closes
- `transaction_type` - "Charge", "Refund", or "Credit"

---

### Pagination

**Cursor-based pagination** (not page numbers):
```typescript
let cursor: string | undefined
do {
  const response = await client.billing.getInvoices({
    startDate: thirtyDaysAgo.toISOString(),
    pageSize: 100,
    cursor: cursor
  })
  allInvoices.push(...response.items)
  cursor = response.next
} while (cursor)
```

---

### ⚠️ CRITICAL: API Endpoint Behavior (Dec 2025)

**Two endpoints, two different purposes:**

| Endpoint | Returns | Date Filter | Use Case |
|----------|---------|-------------|----------|
| `POST /transactions:query` | **PENDING (uninvoiced) only** | ⚠️ Ignored! Returns most recent | Hourly sync of current period |
| `GET /invoices/{id}/transactions` | **Invoiced transactions** | N/A (by invoice) | Weekly invoice reconciliation |

**Key finding:** The `POST /transactions:query` endpoint ignores date range parameters and returns only pending transactions sorted by most recent. It does NOT return historical invoiced transactions regardless of date range specified.

**Historical data:** Only available via `GET /invoices/{id}/transactions`. Some older invoices may return 0 transactions (possible data retention limit). Use Excel imports for historical backfill.

### ⚠️ CRITICAL: Pagination Bug in transactions:query (Dec 2025)

**The cursor pagination is BROKEN for `POST /transactions:query`:**
- The `next` cursor returns the **exact same data** on every page (100% duplicate)
- Following the cursor results in infinite loop with duplicate records
- Tested Dec 4, 2025 - may be fixed in future API versions

**Workaround:** Only fetch ONE page (max 1000 records). Do NOT use the cursor.

```javascript
// CORRECT - Single page, no pagination
const data = await fetch('/transactions:query', {
  method: 'POST',
  body: JSON.stringify({ page_size: 1000 })  // NO cursor!
})

// WRONG - Cursor loops forever with duplicates
while (cursor) { ... }  // Never do this for transactions:query
```

**Impact:** If you have >1000 pending transactions, only the first 1000 are retrieved.

### ✅ CORRECTED: Full Historical Access Available (Dec 4, 2025)

**~~7-day limit~~ was a MYTH caused by wrong API parameter names!**

With correct parameters (`from_date`/`to_date`, NOT `start_date`/`end_date`), we have access to:

| Time Period | Transactions Available |
|-------------|----------------------|
| Last 7 days | 6,699 |
| Last month | 18,643 |
| **All time** | **146,622** |

**Full historical data: March 7, 2025 → Present**

| Month | Transactions |
|-------|-------------|
| Mar 2025 | 16,423 |
| Apr 2025 | 15,715 |
| May 2025 | 13,646 |
| Jun 2025 | 14,554 |
| Jul 2025 | 16,509 |
| Aug 2025 | 17,089 |
| Sep 2025 | 14,423 |
| Oct 2025 | 18,304 |
| Nov 2025 | 17,197 |
| Dec 2025 | 2,762 (partial) |

**No Excel imports needed. Full backfill available via API.**

### `POST /transactions:query` - Correct Usage

**⚠️ The ShipBob billing GUIDE has WRONG parameter names!**

| Guide (WRONG) | API Reference (CORRECT) |
|---------------|------------------------|
| `start_date` | `from_date` |
| `end_date` | `to_date` |
| `limit` | `page_size` |
| Cursor in body | **Cursor in query string** |

**Working Code:**
```javascript
async function getAllTransactions(fromDate, toDate, invoicedStatus = null) {
  const allItems = []
  let cursor = null

  do {
    let url = `${BASE_URL}/2025-07/transactions:query`
    if (cursor) url += `?Cursor=${encodeURIComponent(cursor)}`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from_date: `${fromDate}T00:00:00Z`,
        to_date: `${toDate}T23:59:59Z`,
        invoiced_status: invoicedStatus,  // true=billed, false=unbilled, null=all
        page_size: 1000  // Max allowed
      })
    })

    const data = await response.json()
    allItems.push(...(data.items || []))
    cursor = data.next || null
  } while (cursor)

  return allTransactions
}
```

### ~~Historical Data: Excel Import Required~~ OBSOLETE

**CORRECTION: Full historical access available via API!**

With correct parameters, we can retrieve all 146,622 transactions going back to March 2025.
No Excel imports needed for historical data.

---

### ✅ Transaction Sync Workflow (CORRECTED Dec 4, 2025)

**Full access to all transactions - no caps, no time limits!**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    TRANSACTION SYNC ARCHITECTURE                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  SYNC CRON (Every 15-30 min) - PARENT TOKEN                                 │
│  ──────────────────────────────────────────                                 │
│  Purpose: Capture all pending transactions                                   │
│                                                                              │
│  POST /transactions:query with:                                             │
│    - invoiced_status: false (unbilled only)                                 │
│    - page_size: 1000                                                        │
│    - Cursor in query string for pagination                                  │
│  → Returns ALL pending transactions (tested: 2,629 in one sync)             │
│                                                                              │
│  2. Look up client_id via shipments table JOIN                              │
│     └─ transactions.reference_id → shipments.shipment_id                    │
│                                                                              │
│  3. Upsert only transactions that match our clients                         │
│     └─ Skip transactions for other Jetpack merchants                        │
│                                                                              │
│  Result: ~99% attribution rate for matched transactions                     │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  WEEKLY MONDAY AM (Before Jetpack Invoicing)                                │
│  ──────────────────────────────────────────────                             │
│  Purpose: Reconcile invoiced transactions - THIS IS THE RELIABLE SOURCE    │
│                                                                              │
│  1. GET /invoices?startDate={lastMonday}&endDate={today}                    │
│     └─ Find all new ShipBob invoices since last sync                        │
│                                                                              │
│  2. For each invoice (except Payment type):                                 │
│     GET /invoices/{id}/transactions (paginated)                             │
│     └─ Get all transactions for that invoice - NO 1000 LIMIT                                │
│                                                                              │
│  3. Upsert to transactions table by transaction_id                          │
│     └─ Updates existing pending records:                                    │
│        - invoiced_status = true                                             │
│        - invoice_id = {ShipBob invoice ID}                                  │
│        - invoice_date = {invoice date}                                      │
│     └─ Inserts any gaps (transactions we missed)                            │
│                                                                              │
│  4. Proceed with Jetpack invoice generation                                 │
│                                                                              │
│  Result: All transactions reconciled with ShipBob invoices                  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Transaction lifecycle:**
```
Charge occurs → Hourly sync captures (pending) → Weekly invoice closes →
Monday sync updates (invoiced) → Jetpack invoice generated
```

**Upsert strategy:**
- PRIMARY KEY: `transaction_id`
- Always safe to upsert - records update in place as status changes
- No duplicates possible since transaction_id is unique per fee line item

---

### ✅ COMPLETE API Response Structure (Dec 4, 2025)

**All fields available from `POST /transactions:query`:**

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `transaction_id` | string | Unique ID (ULID format) | `"01KBN5K0G8FD9GSVSPF5BJVHDQ"` |
| `amount` | number | Charge amount (negative for credits) | `7.46` |
| `currency_code` | string | Currency | `"USD"` |
| `charge_date` | string | Date of charge | `"2025-12-04"` |
| `invoiced_status` | boolean | Billed or pending | `false` |
| `invoice_date` | string\|null | Invoice date (null if pending) | `"2025-12-01"` |
| `invoice_id` | number\|null | ShipBob invoice ID | `8633612` |
| `invoice_type` | string\|null | Category (null if pending) | `"Shipping"` |
| `transaction_fee` | string | Specific fee type | `"Shipping"`, `"Per Pick Fee"` |
| `transaction_type` | string | Charge/Refund/Credit/Payment | `"Charge"` |
| `reference_id` | string | Links to shipment/order/return | `"323734146"` |
| `reference_type` | string | Type of reference | `"Shipment"` |
| `fulfillment_center` | string\|null | FC name | `"Twin Lakes (WI)"` |
| `taxes` | array | Tax objects (usually empty) | `[]` |
| `additional_details` | object | Extra info (JSONB) | See below |

**`additional_details` contents by invoice_type:**

| invoice_type | Fields | Notes |
|--------------|--------|-------|
| **Shipping** | `TrackingId`, `Comment` | TrackingId = carrier tracking number |
| **AdditionalFee** | `TrackingId`, `Comment` | Comment has fee breakdown text |
| **WarehouseStorage** | `InventoryId`, `LocationType`, `TrackingId`, `Comment` | Parse rate from Comment |
| **Credits** | `CreditReason`, `TicketReference` | CreditReason = "Claim for Lost Order", etc. |
| **Return** | `TrackingId`, `Comment` | Comment contains Order ID |
| **Inbound Fee** | (empty) | WRO fees have no additional_details |
| **Payment** | (empty) | Payment transactions have no additional_details |

---

### 🔑 CRITICAL FINDING: Fee Breakdown via Multiple Transactions

**The API does NOT provide pre-computed breakdown fields like `fulfillment_cost`, `surcharge`, `pick_fees`.**

**INSTEAD: Each fee component is a SEPARATE TRANSACTION with the same `reference_id`!**

```
Shipment #310571505 has 3 separate transactions:
├── transaction_fee: "Shipping"         → $8.10 (base shipping cost)
├── transaction_fee: "B2B - Each Pick Fee" → $3.60 (pick fees)
└── transaction_fee: "B2B - Label Fee"     → $0.50 (label fee)
                                   ─────────────────
                             Total for shipment: $12.20
```

**Observed: 6,807 shipments have MULTIPLE transactions (out of ~10K total)**

**To compute breakdown from API, aggregate by reference_id:**
```sql
SELECT
  reference_id as shipment_id,
  SUM(CASE WHEN transaction_fee = 'Shipping' THEN amount ELSE 0 END) as shipping_cost,
  SUM(CASE WHEN transaction_fee = 'Per Pick Fee' THEN amount ELSE 0 END) as pick_fees,
  SUM(CASE WHEN transaction_fee LIKE 'B2B%' THEN amount ELSE 0 END) as b2b_fees,
  SUM(amount) as total_cost
FROM transactions
WHERE reference_type = 'Shipment'
GROUP BY reference_id;
```

---

### API vs Excel Field Comparison

| Data Point | API Source | Excel Source | Notes |
|------------|------------|--------------|-------|
| Shipping cost | `transaction_fee='Shipping'` | `fulfillment_cost` + `surcharge` | ⚠️ API combines these |
| Pick fees | `transaction_fee='Per Pick Fee'` | `pick_fees` | ✅ SEPARATE transaction |
| B2B fees | `transaction_fee LIKE 'B2B%'` | `b2b_fees` | ✅ SEPARATE transaction |
| **Surcharge** | ❌ **BAKED INTO Shipping** | `surcharge` | **NOT SEPARATE** - see below |
| Insurance | ❓ Not seen in samples | `insurance` | Need to verify |
| Channel/Store | ❌ NOT in Billing API | `store_integration_name` | Need Orders/Shipments API |
| Products | ❌ NOT in Billing API | `products_sold` | Need Orders API |
| Quantity | ❌ NOT in Billing API | `total_quantity` | Need Orders API |
| Order category | ⚠️ Inferrable from fee types | `order_category` | B2B fees → B2B order |
| Transit time | ❌ NOT in Billing API | `transit_time_days` | Need Shipments API |
| Tracking ID | ✅ `additional_details.TrackingId` | TrackingId column | ✅ Available |

#### ⚠️ VERIFIED: Surcharge is NOT Separate in API (Dec 4, 2025)

Cross-referenced Excel shipments with API transactions:

| Source | Fulfillment | Surcharge | Pick Fees | Total |
|--------|-------------|-----------|-----------|-------|
| **Excel** | $6.38 | $0.15 | $0.52 | $7.05 |
| **API Shipping** | $6.53 (combined) | — | — | — |
| **API Per Pick Fee** | — | — | $0.52 | — |
| **API Total** | — | — | — | $7.05 ✅ |

**Proven formula:** `API "Shipping" = Excel fulfillment_cost + Excel surcharge`

**To get surcharge breakdown, you MUST use:**
1. Excel imports (has separate `surcharge` column)
2. OR reverse-engineer from carrier rate cards (complex, not recommended)

**Conclusion:** API provides all BILLING totals correctly. For surcharge breakdown specifically, Excel import required.

---

### Table Structure Decision (Dec 4, 2025)

**Use the `transactions` table for API data - it already has the correct structure!**

```sql
-- transactions table (already exists) - mirrors API structure
CREATE TABLE transactions (
  id UUID PRIMARY KEY,
  client_id UUID REFERENCES clients(id),
  transaction_id TEXT UNIQUE,        -- API's unique ID (PRIMARY dedup key)
  reference_id TEXT,                 -- Links to shipment/order/return
  reference_type TEXT,               -- Shipment, Return, FC, WRO, etc.
  amount NUMERIC,
  currency_code TEXT,
  charge_date DATE,
  transaction_fee TEXT,              -- "Shipping", "Per Pick Fee", etc.
  transaction_type TEXT,             -- Charge, Credit, Payment, Refund
  fulfillment_center TEXT,
  invoiced_status BOOLEAN,
  invoice_id INTEGER,
  invoice_date DATE,
  tracking_id TEXT,                  -- Extracted from additional_details
  additional_details JSONB,          -- Full API response
  raw_data JSONB,                    -- Optional: full raw response
  merchant_id TEXT
);
```

**Keep `billing_*` tables for historical Excel imports:**
- `billing_shipments` (73K rows) - Has pre-computed breakdown columns
- `billing_shipment_fees`, `billing_storage`, etc.

**Going forward:**
1. **API sync** → `transactions` table (one row per fee)
2. **Excel imports** → `billing_*` tables (legacy, pre-computed breakdowns)
3. **Views/RPCs** → Aggregate `transactions` into breakdown format when needed

---

## Production Sync Scripts (Updated Dec 4, 2025)

Four optimized scripts for syncing ShipBob data to Supabase:

### 1. sync-orders-fast.js - Main Sync Script

**Location:** `scripts/sync-orders-fast.js`

**Purpose:** High-performance batch sync of orders, shipments, and billing data

**Key Features:**
- **Batch upserts** (500 records at a time vs row-by-row)
- **13x faster** than original sync: 17.8 minutes vs 4+ hours for 60K orders
- **Zero errors** on full backfill (vs 141K+ errors with old script)
- Handles all 6 data types: orders, shipments, order_items, shipment_items, cartons, transactions
- DIM weight calculation with country-specific divisors (US: 166, AU: 110, International: 139)

**Usage:**
```bash
# Daily incremental sync (default: 7 days)
node scripts/sync-orders-fast.js --client=henson
node scripts/sync-orders-fast.js --client=methyl-life

# Custom date range
node scripts/sync-orders-fast.js --start=2025-03-01 --end=2025-11-27 --client=henson

# Full backfill (2 years)
node scripts/sync-orders-fast.js --all --client=henson

# Custom days back
node scripts/sync-orders-fast.js --days=30 --client=henson
```

**Performance Benchmarks:**

| Client | Orders | Shipments | Time | Errors |
|--------|--------|-----------|------|--------|
| Henson Shaving | 60,416 | 60,719 | 17.8 min | 0 |
| Methyl Life | 8,489 | 8,507 | 2.4 min | 0 |

### 2. find-missing-records.js - Gap Analysis

**Location:** `scripts/find-missing-records.js`

**Purpose:** Compare ShipBob API vs database to identify missing records after errors

**Usage:**
```bash
node scripts/find-missing-records.js --client=henson
node scripts/find-missing-records.js --client=methyl-life --days=30
node scripts/find-missing-records.js --fix  # Output retry commands
```

**Output:** JSON report with missing order/shipment IDs and coverage percentages

### 3. sync-parallel.js - Parallel Worker Runner

**Location:** `scripts/sync-parallel.js`

**Purpose:** Split large date ranges into chunks and run sync-orders-fast.js in parallel

**Usage:**
```bash
node scripts/sync-parallel.js                    # Default: 4 workers, quarterly chunks
node scripts/sync-parallel.js --workers=8        # More parallelism
node scripts/sync-parallel.js --chunk=monthly    # Smaller chunks
node scripts/sync-parallel.js --dry-run          # Preview without running
```

### 4. sync-pending-transactions.js - Hourly Transaction Sync (NEW Dec 4, 2025)

**Location:** `scripts/sync-pending-transactions.js`

**Purpose:** Sync all pending (uninvoiced) transactions from ShipBob Billing API

**Key Features:**
- Uses **parent token** (child tokens have no billing access)
- Fetches ALL pending transactions in one pass (API ignores date filters)
- Client attribution via JOIN to shipments table: `reference_id` → `shipment_id` → `client_id`
- Batch upserts (500 records at a time)
- 99.5% attribution success rate for Shipment/Default types

**Usage:**
```bash
node scripts/sync-pending-transactions.js           # Sync all pending
node scripts/sync-pending-transactions.js --dry-run # Preview only
```

**Performance (Dec 4, 2025):**
- 100,000 pending transactions in ~2 minutes
- 99,500 with client_id (99.5%)
- 300 shipments not yet in DB (sync orders first)
- 200 WRO transactions (need separate attribution)

**Intended Use:** Run hourly via cron to capture pending charges before weekly invoice closes

### Client Configuration

Both Henson and Methyl Life are configured in the sync scripts:

| Client Key | Client ID | Data Start Date |
|------------|-----------|-----------------|
| `henson` | `6b94c274-0446-4167-9d02-b998f8be59ad` | March 6, 2025 |
| `methyl-life` | `ca33dd0e-bd81-4ff7-88d1-18a3caf81d8e` | ~November 2023 |

### Batch Upsert Implementation

```javascript
const BATCH_SIZE = 500

async function batchUpsert(table, records, onConflict) {
  if (records.length === 0) return { success: 0, failed: [] }
  let successCount = 0
  const failedIds = []

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE)
    const { error } = await supabase
      .from(table)
      .upsert(batch, { onConflict, ignoreDuplicates: false })

    if (error) {
      failedIds.push(...batch.map(r => r.shipbob_order_id || r.shipment_id || r.order_id))
    } else {
      successCount += batch.length
    }
  }
  return { success: successCount, failed: failedIds }
}
```

**Why 500?** Supabase handles up to 1000 per upsert, but 500 provides better reliability and error isolation

---

### ⚠️ KNOWN API BUGS (Verified Nov 26, 2025)

**1. Transaction Query Cursor Returns Duplicates**
- The `POST /2025-07/transactions:query` endpoint returns a `next` cursor
- Using this cursor returns the SAME items (duplicates), not the next page
- **Workaround:** Use `page_size: 1000` (max) to get more items per request, but pagination is broken

**2. Transaction Query Only Returns Pending/Uninvoiced Transactions**
- The query endpoint ignores date filters and only returns uninvoiced transactions
- Even querying older date ranges returns current week's pending transactions
- **Workaround:** Fetch invoiced transactions via `/invoices/{id}/transactions` endpoint

**3. Per-Invoice Cursor Pagination DOES Work** ✅
- The `/invoices/{id}/transactions?pageSize=1000&cursor=X` returns paginated results
- Cursor pagination works correctly (unlike the query endpoint)
- Example: Shipping invoice with 1018 tx fetched successfully in 2 pages

**4. Historical Transaction Data Not Available**
- API only exposes transaction-level detail for **most recent billing cycle** (current week)
- Older invoices return 0 transactions via `/invoices/{id}/transactions`
- This is a data retention limitation, not a bug

**5. Invoice Amounts Don't Match Transaction Totals**
Even for invoices that return transactions, amounts often don't match:
- Shipping invoice: $13,003.29 → only $6,702.64 in transactions (51%)
- Some charges may be aggregated without line-item detail

**Recommended Sync Strategy:**
```typescript
// 1. Fetch pending transactions (current billing period)
const pending = await queryTransactions({ page_size: 1000 })

// 2. Fetch invoiced transactions with cursor pagination
for (const invoice of allInvoices) {
  let cursor = undefined
  do {
    const response = await getInvoiceTransactions(invoice.id, { cursor, pageSize: 1000 })
    transactions.push(...response.items)
    cursor = response.next
  } while (cursor)
}
```

**Impact:** Cannot fetch ALL historical transactions. Best coverage is:
- Current week pending: ~1,000 transactions via query endpoint
- Current week invoiced: ~2,000 transactions via per-invoice endpoint (with cursor)
- Historical: Invoice totals only, no transaction-level detail

**Workaround for Historical Data:** Import from ShipBob Excel exports

**Filed with ShipBob:** TBD - recommend contacting support about:
1. Transaction query cursor returning duplicates
2. Historical transaction data availability
3. Invoice vs transaction amount discrepancies

---

### Shipments Endpoint Note

**The `/shipment` endpoint returns 404.** Shipment data is available through:
1. **Transactions API** - `reference_type: "Shipment"` with `additional_details.TrackingId`
2. **Orders API** - Orders contain embedded shipment data (when available)

---

### ⚠️ CRITICAL GAP: Merchant/User ID Not Available via API

**Context:** This dashboard serves a **PARENT account** structure where:
- ShipBob bills the parent for ALL child merchant transactions on one consolidated invoice
- Each child merchant has a unique `User ID` and `Merchant Name`
- These identifiers appear in ShipBob's Excel exports but NOT in the API

#### API Endpoints Tested (2025-11-26)

| Endpoint | Status | Data |
|----------|--------|------|
| `POST /2025-07/transactions:query` | ✅ 200 | Transactions **without** merchant ID |
| `GET /1.0/order` | ⚠️ 200 | Empty array `[]` |
| `GET /1.0/shipment/{id}` | ❌ 404 | Not Found |
| `GET /1.0/channel` | ✅ 200 | Channel IDs (341684, 433646) |
| `GET /1.0/return` | ✅ 200 | Empty array |
| `GET /1.0/inventory` | ✅ 200 | Items exist, no merchant field |
| `GET /1.0/merchant` | ❌ 404 | Not Found |
| `GET /1.0/user` | ❌ 404 | Not Found |
| `GET /1.0/account` | ❌ 404 | Not Found |

#### Transaction Fields Available vs Missing

**Available in API:**
- `transaction_id`, `amount`, `currency_code`, `charge_date`
- `reference_id` (Shipment ID), `reference_type`
- `transaction_fee`, `fulfillment_center`
- `additional_details.TrackingId`

**Missing (present in Excel exports):**
- ❌ `User ID` - Numeric child merchant identifier (e.g., 392333)
- ❌ `Merchant Name` - String name (e.g., "Methyl-Life®")

#### Workaround Options

1. **Build Reference ID → User ID Lookup Table**
   - Parse historic Excel exports
   - Create mapping: `reference_id` → `user_id`, `merchant_name`
   - Join transactions with lookup table
   - **Limitation:** Only works for historic data; new shipments won't have mapping

2. **Request API Enhancement from ShipBob**
   - Contact ShipBob support to add `user_id` / `merchant_id` field to Billing API
   - Reference: Billing API 2025-07 doesn't expose parent/child relationships

3. **Check PAT Permissions**
   - Current PAT may not have access to Orders API data
   - Orders endpoint returns 200 but empty - suggest permission issue
   - Request expanded access from ShipBob

4. **Use Channel as Proxy (Partial Solution)**
   - Channels: `341684` (ShipBob Default), `433646` (PAT Channel)
   - Products have `channel.id` embedded
   - But transactions don't reference channels
   - May not map cleanly to child merchants

#### Impact on Dashboard Architecture

If merchant ID cannot be resolved via API:
- Cannot automatically filter transactions by child merchant
- Cannot provide merchant-specific dashboards
- Must rely on historic data import with manual merchant tagging
- New transactions would need manual merchant assignment

**ACTION REQUIRED:** Contact ShipBob support to clarify:
1. Is there an API endpoint for parent/child merchant relationships?
2. Can `user_id` be added to Billing API transaction responses?
3. Why does Orders API return empty for a PAT with `orders_read` scope?

### ✅ API Field Coverage - VERIFIED
**Analysis complete:** ~90% of historic Excel fields are directly available via API.

| Data Type | Excel Columns | API Coverage | Notes |
|-----------|---------------|--------------|-------|
| **Shipments** | 9 | ✅ 100% | All via Orders/Shipments API |
| **Returns** | 40 | ✅ 95% | Some calculated (transit time), rest direct |
| **Storage** | 10 | ✅ 100% | Via Inventory API |
| **Receiving** | 10 | ✅ 100% | Via Receiving API |
| **Additional Services** | 14 | ✅ 90% | Via Orders + Billing APIs |
| **Credits** | 9 | ✅ 100% | Via Billing API |

### ✅ VERIFIED: Data Source Mapping (Nov 27, 2025)

**Critical insight:** The Transactions API (`2025-07`) provides BILLING data only. Shipment details come from the Orders API (`1.0`).

| Field | API Source | API Path | Notes |
|-------|-----------|----------|-------|
| **zone_used** | Orders API | `shipment.zone.id` | Integer (4, 5, etc.) - null until shipped |
| **actual_weight_oz** | Orders API | `shipment.measurements.total_weight_oz` | Always populated |
| **length_in** | Orders API | `shipment.measurements.length_in` | Package dimensions |
| **width_in** | Orders API | `shipment.measurements.width_in` | Package dimensions |
| **height/depth_in** | Orders API | `shipment.measurements.depth_in` | Package dimensions |
| **fulfillment_center** | Orders API | `shipment.location.name` | e.g., "Twin Lakes (WI)" |
| **carrier** | Orders API | `shipment.tracking.carrier` | e.g., "USPS", "OnTrac" |
| **carrier_service** | Orders API | `shipment.ship_option` | e.g., "ShipBob Economy" |
| **ship_option_id** | Shipping Methods API | Lookup via `/1.0/shippingmethod` → `service_level.id` | 146=ShipBob Economy, 49=GlobalEDDPExpedited, 3=Ground, 5=UPS Ground |
| **tracking_number** | Orders API | `shipment.tracking.tracking_number` | Carrier tracking |
| **fee_type** | Transactions API | `transaction_fee` | e.g., "Shipping", "Per Pick Fee" |
| **amount** | Transactions API | `amount` | Cost in USD |
| **invoice_status** | Transactions API | `invoiced_status` | Boolean |
| **charge_date** | Transactions API | `charge_date` | ISO date string |

**Ship Option ID Mapping Complexity:**

The Orders API `ship_option` field returns DIFFERENT names than the Shipping Methods API `service_level.name`. A lookup + manual fallbacks are required:

| Orders API `ship_option` | Shipping Methods API `service_level.name` | ID | Lookup Method |
|--------------------------|-------------------------------------------|-----|---------------|
| ShipBob Economy | ShipBob Economy | 146 | Exact match |
| GlobalEDDPExpedited | Global E DDP Expedited | 49 | Normalized match |
| Ground | Standard (Ground) | 3 | Manual fallback |
| 1 Day | (FedEx 1 Day) | 8 | Manual fallback |
| 2 Day | (FedEx 2 Day) | 9 | Manual fallback |
| UPS Ground | UPS Ground | 5 | Exact match |

**Sync implementation in `scripts/sync-henson-test.js`:**
```javascript
const manualMappings = {
  'Ground': 3,           // API returns "Standard (Ground)" with ID 3
  '1 Day': 8,            // FedEx 1 Day service level
  '2 Day': 9,            // FedEx 2 Day service level
}
```

**Transactions API `additional_details` ONLY contains:**
```json
{
  "Comment": "",
  "TrackingId": "TBA326309366176"  // Tracking number (duplicate)
}
```

**Does NOT contain:** zone, weights, dimensions, carrier info - those come from Orders API.

**Sync strategy:**
1. Fetch orders from Orders API (child token) → populates shipments table with details
2. Extract shipment IDs from orders
3. Query Transactions API with `reference_ids` (parent token) → populates transactions table with costs

**Action items before implementation:**
- [x] Confirm `zone_used` field availability in webhooks vs API → Zone available in Orders API `shipment.zone.id`
- [ ] Verify surcharge vs base cost separation with ShipBob support
- [ ] Test transaction-fee breakdown granularity in Billing API

---

## Historic Billing Data (reference/data/historic/)

**Source:** ShipBob Excel exports (updated Nov 27, 2025)

| Excel File | DB Table | Rows | Purpose |
|------------|----------|------|---------|
| SHIPMENTS.xlsx | `billing_shipments` | 73,666 | Main shipment costs with full breakdown |
| ADDITIONAL-SERVICES.xlsx | `billing_shipment_fees` | 51,366 | Line-item fees per shipment |
| STORAGE.xlsx | `billing_storage` | 14,466 | Warehouse storage fees |
| CREDITS.xlsx | `billing_credits` | 336 | Credits and refunds |
| RETURNS.xlsx | `billing_returns` | 204 | Return processing fees |
| RECEIVING.xlsx | `billing_receiving` | 118 | WRO/inbound receiving fees |
| **TOTAL** | | **140,156** | |

### Billing Tables Schema (Migration 008)

**Design Principle:** Billing tables store ONLY billing-specific data. Shipment/order details live in existing `shipments`/`orders` tables and are joined via foreign keys.

#### 1. `billing_shipments` - Main Shipment Costs
Links to: `shipments.shipment_id` via `shipment_id` column

| Column | Type | Source |
|--------|------|--------|
| order_id | INTEGER | OrderID |
| shipment_id | TEXT | TrackingId |
| fulfillment_cost | DECIMAL | Fulfillment without Surcharge |
| surcharge | DECIMAL | Surcharge Applied |
| total_amount | DECIMAL | Original Invoice |
| pick_fees | DECIMAL | Pick Fees |
| b2b_fees | DECIMAL | B2B Fees |
| insurance | DECIMAL | Insurance Amount |
| invoice_number | INTEGER | Invoice Number |
| invoice_date | DATE | Invoice Date |
| transaction_date | DATE | Transaction Date |
| transaction_status | TEXT | 'invoiced' / 'invoice pending' |
| transaction_type | TEXT | 'Charge' / 'Credit' |

#### 2. `billing_shipment_fees` - Line-Item Fees
Multiple rows per shipment (pick fees, shipping, etc.)

| Column | Type | Source |
|--------|------|--------|
| shipment_id | TEXT | Reference ID |
| fee_type | TEXT | Fee Type |
| amount | DECIMAL | Invoice Amount |

#### 3. `billing_storage` - Storage Fees
Includes parsed quantity and rate from Comment field

| Column | Type | Source |
|--------|------|--------|
| inventory_id | INTEGER | Inventory ID |
| fc_name | TEXT | FC Name |
| location_type | TEXT | 'Bin', 'Shelf', 'Pallet', 'HalfPallet', 'ShoeShelf' |
| quantity | INTEGER | Parsed from Comment |
| rate_per_month | DECIMAL | Parsed from Comment |
| amount | DECIMAL | Invoice amount |

**Storage Types & Rates:**
- pallet: $30-40/month
- shelf: $8-10/month
- bin: $4-5/month
- halfpallet: $15/month
- shoeshelf: $8/month

#### 4. `billing_credits` - Credits/Refunds

| Column | Type | Source |
|--------|------|--------|
| reference_id | TEXT | Reference ID |
| credit_reason | TEXT | 'Courtesy', 'Shipping Error', etc. |
| credit_amount | DECIMAL | Negative value |

#### 5. `billing_returns` - Return Processing

| Column | Type | Source |
|--------|------|--------|
| return_id | INTEGER | Return ID |
| original_order_id | INTEGER | Original Order ID |
| return_type | TEXT | 'Regular', 'ReturnToSender' |
| amount | DECIMAL | Invoice |

#### 6. `billing_receiving` - WRO/Inbound Fees

| Column | Type | Source |
|--------|------|--------|
| reference_id | TEXT | WRO ID |
| fee_type | TEXT | 'WRO Receiving Fee' |
| amount | DECIMAL | Invoice Amount |

### Import Script

```bash
# Import all billing data from Excel
node scripts/import-billing-xlsx.js --client=henson

# Import single file type
node scripts/import-billing-xlsx.js --file=shipments

# Dry run (preview without inserting)
node scripts/import-billing-xlsx.js --dry-run
```

### Unified View

Query all billing data via `billing_all` view:
```sql
SELECT billing_type, reference_id, amount, invoice_date, transaction_status
FROM billing_all
WHERE client_id = 'xxx'
ORDER BY transaction_date DESC;
```

---

## Database Schema

### Core Tables

```sql
-- 1. Clients
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  company_name TEXT NOT NULL,
  shipbob_merchant_id TEXT,
  anonymize_after_months INTEGER DEFAULT 24,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true
);

-- 2. Rule-Based Markup System (additive, priority-ordered)
CREATE TABLE markup_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,           -- Human-readable rule name
  fee_type TEXT,                -- 'shipping', 'pick_fee', 'storage', etc. (NULL = all)
  ship_option_id TEXT,          -- ShipBob Ship Option ID (NULL = all)

  -- Flexible conditions stored as JSONB
  conditions JSONB NOT NULL DEFAULT '{}',
  /* Example conditions:
     {"weight_min_oz": 0, "weight_max_oz": 128}     -- Weight range
     {"state": ["AK", "HI"]}                        -- Remote states
     {"country": "CA"}                              -- International
     {"weight_min_oz": 128, "state": ["AK", "HI"]}  -- Combined
  */

  markup_type TEXT NOT NULL,    -- 'percentage' or 'fixed'
  markup_value DECIMAL(10,4) NOT NULL,
  priority INTEGER DEFAULT 0,   -- Higher priority = applied first (for ordering)
  is_additive BOOLEAN DEFAULT true, -- If true, stacks with other rules
  effective_from DATE NOT NULL,
  effective_to DATE,            -- NULL = currently active
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for efficient rule lookups
CREATE INDEX idx_markup_rules_lookup ON markup_rules(client_id, fee_type, is_active)
  WHERE is_active = true;

/* Markup Application Logic:
   1. Find ALL active rules matching: client + fee_type + ship_option + date
   2. Filter by conditions (weight, state, country)
   3. Sort by priority (highest first)
   4. Apply additively: base_cost + markup1 + markup2 + ...

   Example: 8lb package to Alaska
   - Base rule: +15% on all shipping → $8.50 * 1.15 = $9.78
   - Heavy rule (>4lb): +$2.00 → $9.78 + $2.00 = $11.78
   - Remote state (AK): +$3.00 → $11.78 + $3.00 = $14.78
*/

-- 3. Orders (order-level data - stable entity from ecommerce platform)
-- NOTE: One order can have MULTIPLE shipments (split shipments, replacements, partial fulfillment)
-- Henson example: 60,431 orders → 60,734 shipments (~0.5% have multiple shipments)
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id),

  -- ShipBob identifiers (PRIMARY KEY is shipbob_order_id)
  shipbob_order_id TEXT NOT NULL UNIQUE,  -- Stable order identifier from ShipBob
  store_order_id TEXT,                     -- Customer-facing order # (Shopify/BigCommerce)

  -- Order details (stable, set at order creation)
  customer_name TEXT,
  order_date DATE,
  status TEXT,                             -- Processing, Fulfilled, Cancelled, etc.

  -- Destination (from order, not shipment)
  zip_code TEXT,
  city TEXT,
  state TEXT,
  country TEXT,

  -- Order classification
  order_category TEXT,                     -- e.g., 'standard', 'express', 'economy'

  -- Aggregated totals (calculated from shipments)
  total_shipments INTEGER DEFAULT 0,
  total_base_cost DECIMAL(10,2),
  total_marked_up_cost DECIMAL(10,2),

  -- Metadata
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_orders_client ON orders(client_id);
CREATE INDEX idx_orders_date ON orders(order_date);
CREATE INDEX idx_orders_store_order ON orders(store_order_id);

-- 4. Shipments (shipment-level data - can be multiple per order)
-- IMPORTANT: shipment_id is used for claims/disputes with carriers
CREATE TABLE shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id),
  order_id UUID REFERENCES orders(id),     -- FK to orders table

  -- ShipBob identifiers
  shipment_id TEXT NOT NULL UNIQUE,        -- Used for claims, disputes, tracking
  shipbob_order_id TEXT,                   -- Denormalized for convenience
  tracking_id TEXT,

  -- Shipment details
  status TEXT,                             -- Processing, LabeledCreated, Completed, Cancelled
  label_generation_date TIMESTAMPTZ,
  shipped_date TIMESTAMPTZ,
  delivered_date TIMESTAMPTZ,
  transit_time_days DECIMAL(5,2),

  -- Carrier & service
  carrier TEXT,
  carrier_service TEXT,
  ship_option_id INTEGER,                  -- ShipBob Ship Option ID (146, 49, 3, etc.)
  zone_used INTEGER,
  fc_name TEXT,

  -- Package dimensions & weights
  actual_weight_oz DECIMAL(10,2),
  dim_weight_oz DECIMAL(10,2),             -- Calculated: (L*W*H)/139
  billable_weight_oz DECIMAL(10,2),        -- max(actual, dim)
  length DECIMAL(6,2),
  width DECIMAL(6,2),
  height DECIMAL(6,2),

  -- BASE costs (ShipBob's cost to us)
  base_fulfillment_cost DECIMAL(10,2),
  base_surcharge DECIMAL(10,2),
  base_insurance DECIMAL(10,2),
  base_total_cost DECIMAL(10,2),

  -- MARKED UP costs (what client sees/pays)
  marked_up_fulfillment_cost DECIMAL(10,2),
  marked_up_surcharge DECIMAL(10,2),
  marked_up_insurance DECIMAL(10,2),
  marked_up_total_cost DECIMAL(10,2),

  -- Metadata
  invoice_number TEXT,
  invoice_date DATE,
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_shipments_client ON shipments(client_id);
CREATE INDEX idx_shipments_order ON shipments(order_id);
CREATE INDEX idx_shipments_shipbob_order ON shipments(shipbob_order_id);

/* FRONTEND DESIGN NOTE:
   - Orders page shows ORDERS as primary entity (not shipments)
   - Multi-shipment orders display badge: "2 shipments"
   - Order row is expandable to show individual shipments
   - Claims/disputes UI must reference shipment_id (not order_id)
   - Order totals aggregate costs across all shipments
*/

-- 5. SLA Rules (carrier delivery SLA tracking)
CREATE TABLE sla_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  carrier TEXT NOT NULL,
  carrier_service TEXT,        -- NULL = applies to all services for carrier
  sla_hours INTEGER NOT NULL,  -- Expected delivery time in hours
  effective_from DATE NOT NULL,
  effective_to DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Invoices (weekly billing cycles - critical for deduplication)
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id),
  shipbob_invoice_id TEXT UNIQUE,
  invoice_number TEXT NOT NULL,

  -- Invoice period (weekly, ending Sunday 23:59:59)
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  invoice_date DATE NOT NULL,

  -- Transaction type this invoice covers
  invoice_type TEXT NOT NULL,  -- 'Shipping', 'Storage', 'Returns', 'Receiving', 'Additional Services', 'Credits'

  -- Costs (BASE only - our actual ShipBob costs)
  base_amount DECIMAL(12,2),
  marked_up_amount DECIMAL(12,2),  -- Calculated after all transactions ingested
  currency_code TEXT DEFAULT 'USD',

  -- Transaction counts for reconciliation
  expected_transaction_count INTEGER,  -- From ShipBob API
  actual_transaction_count INTEGER,    -- Our count in database

  -- Reconciliation status
  reconciliation_status TEXT DEFAULT 'open',  -- 'open', 'pending', 'reconciled', 'mismatch'
  reconciled_at TIMESTAMPTZ,

  -- Payment tracking
  payment_status TEXT DEFAULT 'pending', -- 'pending', 'paid', 'overdue'

  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(invoice_number, invoice_type)
);

/* Invoice Reconciliation Process:
   1. Webhooks arrive in real-time → transactions inserted with invoice_number
   2. After Sunday 23:59:59 → invoice "closes" in ShipBob
   3. Monday: Fetch invoice metadata from Billing API
   4. Compare expected_transaction_count vs actual_transaction_count
   5. If mismatch: Fetch missing transactions via API
   6. Once counts match: Set reconciliation_status = 'reconciled'
   7. Reconciled invoices = immutable. Any new transaction claiming this
      invoice number is either a duplicate or an anomaly.
*/

-- 6. Inventory (for storage cost tracking)
CREATE TABLE inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id),
  shipbob_inventory_id TEXT,
  sku TEXT,
  product_name TEXT,
  fc_name TEXT,
  location_type TEXT,
  quantity_on_hand INTEGER,
  last_movement_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Fee Type Categories (for grouping in UI)
CREATE TABLE fee_type_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fee_type TEXT UNIQUE NOT NULL,
  category TEXT NOT NULL,      -- 'Shipping', 'Fulfillment', 'Storage', 'Returns', 'Other'
  display_name TEXT,
  description TEXT,
  is_active BOOLEAN DEFAULT true
);

-- 8. Credits (with Care Central linkage)
CREATE TABLE credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id),

  -- ShipBob identifiers
  reference_id TEXT NOT NULL,           -- ShipBob's unique credit ID
  shipbob_order_id TEXT,                -- Associated order (if applicable)

  -- Care Central linkage
  care_id UUID,                         -- Links to Care Central ticket (claims)
  /* When a claim is created in Care Central with an Order ID,
     and a credit arrives with matching reference_id → auto-link.
     Inversely, care_id stored here for bidirectional lookup. */

  -- Credit details
  credit_reason TEXT NOT NULL,
  credit_type TEXT,                     -- 'shipping_refund', 'damage_claim', 'adjustment', etc.
  credit_amount DECIMAL(10,2) NOT NULL,
  currency_code TEXT DEFAULT 'USD',

  -- Associated transaction (optional)
  original_transaction_type TEXT,       -- 'shipment', 'return', 'storage', etc.
  original_transaction_id TEXT,         -- Reference to original transaction

  -- Invoice assignment
  invoice_number TEXT,
  invoice_date DATE,

  -- Metadata
  notes TEXT,
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT uq_credits_ref UNIQUE (reference_id)
);

-- Index for Care Central lookups
CREATE INDEX idx_credits_care_id ON credits(care_id) WHERE care_id IS NOT NULL;
CREATE INDEX idx_credits_order_id ON credits(shipbob_order_id) WHERE shipbob_order_id IS NOT NULL;

-- 9-12: Other transaction tables (returns, storage, receiving, additional_services)
-- (See full schema in supabase/migrations/)
```

### Deduplication Constraints (Critical for Real-Time Accuracy)

```sql
-- Every transaction type has a ShipBob-assigned unique ID
-- These constraints are the PRIMARY deduplication mechanism (not invoice number)

-- Shipments: One record per ShipBob order
ALTER TABLE shipments ADD CONSTRAINT uq_shipments_shipbob_id
  UNIQUE (shipbob_order_id);

-- Returns: One record per return
ALTER TABLE returns ADD CONSTRAINT uq_returns_return_id
  UNIQUE (return_id);

-- Storage: One record per inventory item per charge period
ALTER TABLE storage ADD CONSTRAINT uq_storage_charge
  UNIQUE (inventory_id, fc_name, charge_start_date);

-- Additional Services: One record per transaction
ALTER TABLE additional_services ADD CONSTRAINT uq_additional_services_ref
  UNIQUE (reference_id, fee_type, transaction_date);

-- Credits: One record per credit
ALTER TABLE credits ADD CONSTRAINT uq_credits_ref
  UNIQUE (reference_id);
```

### Key Indexes
```sql
CREATE INDEX idx_shipments_client ON shipments(client_id);
CREATE INDEX idx_shipments_date ON shipments(order_date);
CREATE INDEX idx_shipments_tracking ON shipments(tracking_id);
CREATE INDEX idx_shipments_invoice ON shipments(invoice_number);
CREATE INDEX idx_shipments_shipbob_id ON shipments(shipbob_order_id);
```

### Row Level Security
```sql
-- Clients see only their own data
CREATE POLICY "Clients see own data" ON shipments
  FOR SELECT USING (
    client_id IN (SELECT id FROM clients WHERE user_id = auth.uid())
  );

-- Admins see everything
CREATE POLICY "Admins see all" ON shipments
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE id = auth.uid()
      AND raw_user_meta_data->>'role' = 'admin'
    )
  );
```

---

## Data Ingestion Strategy

### Webhook-Triggered Billing Lookup (Corrected Architecture)

#### The Key Distinction
| Source | Provides | Does NOT Provide |
|--------|----------|------------------|
| **Webhooks** | Event notifications (shipped, delivered, returned) | Detailed cost breakdowns |
| **Billing API** | Actual costs, surcharges, fee breakdowns | Real-time event notifications |

**Webhooks tell us WHEN something happened. Billing API tells us HOW MUCH it cost.**

#### Architecture: Event-Driven with Immediate Cost Lookup

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      REAL-TIME INGESTION FLOW                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ShipBob Event (order.shipped, etc.)                                   │
│           │                                                             │
│           ▼                                                             │
│   ┌───────────────────┐                                                │
│   │ Webhook Received  │ ← Event data only (tracking, carrier, status)  │
│   └─────────┬─────────┘                                                │
│             │                                                           │
│             ▼                                                           │
│   ┌───────────────────┐                                                │
│   │ Add to Job Queue  │ ← Redis/BullMQ for reliability                 │
│   │ (with order_id)   │                                                │
│   └─────────┬─────────┘                                                │
│             │                                                           │
│             ▼                                                           │
│   ┌───────────────────────────────────────────────────────────────┐    │
│   │ Queue Worker: Billing API Lookup                              │    │
│   │ POST /2025-07/transactions/search { order_id: X }            │    │
│   │ → Returns: costs, surcharges, insurance, fee breakdown        │    │
│   └─────────┬─────────────────────────────────────────────────────┘    │
│             │                                                           │
│             ▼                                                           │
│   ┌───────────────────┐                                                │
│   │ Apply Markup      │                                                │
│   │ Rules + Store     │                                                │
│   └───────────────────┘                                                │
│                                                                         │
│   Result: Complete record with base costs + marked-up costs             │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Why Queue the API Calls?

1. **Rate limit protection** - Queue processes at controlled rate (< 150/min)
2. **Retry on failure** - Billing API might be temporarily unavailable
3. **Decouple webhook response** - Return 200 immediately, process async
4. **Backpressure handling** - If API slows, queue absorbs burst

#### Layers

| Layer | Purpose | Timing |
|-------|---------|--------|
| **1. Webhook** | Trigger for new events | Instant (1-2 sec) |
| **2. Queued Billing Lookup** | Get actual costs for specific order | ~5-30 sec after webhook |
| **3. Daily Reconciliation** | Catch missed webhooks, verify completeness | Once per day |
| **4. Weekly Invoice Validation** | Final reconciliation against ShipBob invoices | After Sunday close |

#### Daily Reconciliation (Safety Net)

```typescript
// Runs at 2:00 AM daily
async function dailyReconciliation() {
  const yesterday = subDays(new Date(), 1);

  // 1. Fetch all transactions from ShipBob for yesterday
  const shipbobTransactions = await billingApi.searchTransactions({
    date_from: startOfDay(yesterday),
    date_to: endOfDay(yesterday)
  });

  // 2. Compare to our database
  for (const tx of shipbobTransactions) {
    const existing = await db.shipments.findUnique({
      where: { shipbob_order_id: tx.order_id }
    });

    if (!existing) {
      // Missed webhook - ingest now
      await ingestShipment(tx);
      logAnomaly('Missed webhook - caught in daily sync', tx.order_id);
    } else if (existing.base_total_cost !== tx.total_cost) {
      // Cost discrepancy - update if invoice still open
      await handleCostDiscrepancy(existing, tx);
    }
  }
}
```

#### Historic Data Import (One-time)
- Import `reference/data/historic/` files
- Apply historical markup rates (using `effective_from` dates)
- Store BOTH original costs AND marked-up costs

---

## Scale Analysis: High-Volume Considerations

### Rate Limit Math

ShipBob rate limit: **150 requests/minute** = 9,000/hour = 216,000/day

| Daily Volume | API Calls/Hour | % of Limit | Status |
|--------------|----------------|------------|--------|
| 1,000 | 42 | 0.5% | ✅ Trivial |
| 5,000 | 208 | 2.3% | ✅ Easy |
| 20,000 | 833 | 9.3% | ✅ Comfortable |
| 50,000 | 2,083 | 23% | ✅ Good |
| 100,000 | 4,167 | 46% | ⚠️ Watch closely |
| 200,000 | 8,333 | 93% | 🔴 At limit |

### The Burst Problem

The math above assumes even distribution. Real traffic is bursty:
- Peak hours (9 AM - 5 PM) may be 3-5x average rate
- Flash sales, holiday peaks can spike 10x+

**Example: 100K/day with 5x peak burst**
- Average: 70 req/min (46% of limit)
- Peak: 350 req/min (233% of limit) ❌

### Mitigation Strategies

#### 1. Queue with Rate Limiting (Primary)
```typescript
// BullMQ with rate limiter
const billingQueue = new Queue('billing-lookup', {
  limiter: {
    max: 120,        // Leave headroom (80% of 150)
    duration: 60000  // Per minute
  }
});

// Webhook handler - instant response, async processing
app.post('/webhooks/shipbob', async (req, res) => {
  await billingQueue.add('lookup', { orderId: req.body.order_id });
  res.status(200).send('OK');  // Return immediately
});
```

#### 2. Batch Lookups (✅ CONFIRMED SUPPORTED)
```typescript
// ShipBob Billing API supports batch lookups via reference_ids array
// POST /2025-07/transactions:query
// {
//   "reference_ids": ["order_1", "order_2", "order_3", ...],
//   "start_date": "2025-01-01T00:00:00Z",
//   "end_date": "2025-01-31T23:59:59Z"
// }

// Available filter parameters:
// - reference_ids: array of order/reference IDs
// - invoice_ids: array of invoice IDs
// - transaction_types: ["Charge", "Refund", etc.]
// - start_date: ISO 8601 format
// - end_date: ISO 8601 format

// Implementation: Batch webhooks every 5-10 seconds
const BATCH_SIZE = 50;  // Test to find optimal size
const BATCH_INTERVAL_MS = 5000;  // 5 seconds

async function processBatchedBillingLookups() {
  const pendingOrderIds = await getQueuedOrderIds(BATCH_SIZE);

  if (pendingOrderIds.length === 0) return;

  const transactions = await billingApi.query({
    reference_ids: pendingOrderIds,
    start_date: subDays(new Date(), 7).toISOString()
  });

  // One API call for 50 orders = 50x more efficient!
  for (const tx of transactions.items) {
    await ingestTransaction(tx);
  }
}
```

**✅ Verified:** ShipBob Billing API supports batch lookups via `reference_ids` array.
**⚠️ Unknown:** Maximum batch size not documented - test incrementally (start with 50).

#### 3. Graceful Degradation
```typescript
// If queue depth exceeds threshold, skip immediate lookup
// Rely on daily reconciliation to catch up

const QUEUE_THRESHOLD = 10000;  // Jobs

async function handleWebhook(orderId: string) {
  const queueDepth = await billingQueue.count();

  if (queueDepth > QUEUE_THRESHOLD) {
    // Store basic info from webhook, mark as 'pending_billing'
    await db.shipments.upsert({
      where: { shipbob_order_id: orderId },
      create: { ...basicInfo, billing_status: 'pending' },
      update: { ...basicInfo }
    });
    // Daily sync will fill in costs
  } else {
    // Normal flow - queue for immediate billing lookup
    await billingQueue.add('lookup', { orderId });
  }
}
```

#### 4. Multi-PAT Strategy (Enterprise Scale)
At extreme volumes (200K+/day), consider:
- Multiple ShipBob Personal Access Tokens (if allowed by ShipBob ToS)
- Each PAT has independent rate limit
- Load balance across PATs

**⚠️ Requires verification with ShipBob support.**

### Database Scale Considerations

| Annual Volume | Rows/Year | 3-Year Total | DB Size Estimate |
|---------------|-----------|--------------|------------------|
| 5K/day | 1.8M | 5.5M | ~2 GB |
| 20K/day | 7.3M | 22M | ~8 GB |
| 100K/day | 36.5M | 110M | ~40 GB |

**Mitigation:**
- Partitioning by date (monthly tables)
- Archival strategy after GDPR retention period
- Index optimization for common queries
- Consider TimescaleDB for time-series data

### Supabase Tier Implications

| Tier | Database Size | Connections | Suitable For |
|------|---------------|-------------|--------------|
| Free | 500 MB | 60 | Dev/Testing |
| Pro ($25/mo) | 8 GB | 100 | Up to ~20K/day |
| Team ($599/mo) | 100 GB | 200 | Up to ~100K/day |
| Enterprise | Custom | Custom | 100K+/day |

### Summary: Architecture Scales to 500K+/day with Batching

With batch lookups confirmed, the math changes dramatically:

| Daily Volume | Without Batching | With Batching (50/call) | % of Limit |
|--------------|------------------|-------------------------|------------|
| 100K/day | 4,167 calls/hr | 83 calls/hr | **0.9%** |
| 200K/day | 8,333 calls/hr | 167 calls/hr | **1.9%** |
| 500K/day | 20,833 calls/hr | 417 calls/hr | **4.6%** |

**The architecture now handles enterprise scale easily because:**

1. **Webhooks are free** - No rate limit concerns on receiving
2. **Batch lookups** - 50 orders per API call = 50x efficiency
3. **Queue absorbs bursts** - Collect webhooks, batch every 5-10 sec
4. **Rate limiter protects API** - Never exceed 150/min
5. **Daily sync catches gaps** - No data loss if queue backs up
6. **UPSERT is idempotent** - Safe to retry, no duplicates

**New bottleneck:** Database write throughput, not ShipBob API. At 500K/day, plan for Supabase Team tier or higher.

---

## API Query Performance Patterns (Dec 2, 2025)

**Critical insight:** Supabase queries that require computed values or cross-table calculations cannot use standard PostgREST filters. If you try to filter on a calculated field, you'll fetch ALL records and filter client-side - destroying pagination and causing 10-30+ second load times at scale.

### When to Use PostgreSQL RPC Functions

| Filter Type | Standard Query | RPC Function |
|-------------|----------------|--------------|
| Simple column (`status = 'Delivered'`) | ✅ `.eq('status', 'Delivered')` | ❌ Overkill |
| Date range (`order_date > X`) | ✅ `.gte('order_date', X)` | ❌ Overkill |
| JSONB nested (`status_details->0->name`) | ✅ `.eq('status_details->0->>name', 'InTransit')` | ❌ Overkill |
| **Computed value (age = NOW() - order_date)** | ❌ Must fetch all | ✅ **Required** |
| **Cross-table calculation** | ❌ Must fetch + join | ✅ **Required** |

### The Age Filter Problem (Solved Dec 2, 2025)

**Symptom:** Shipments Age filter took 11-30+ seconds
**Root cause:** Age = `(delivered_date || NOW()) - order_import_date` requires:
1. JOIN with orders table (for `order_import_date`)
2. Date arithmetic (not stored in DB)
3. Therefore: Must fetch ALL 70K+ records to calculate and filter

**Solution:** PostgreSQL RPC function that calculates age and filters at database level:

```sql
-- scripts/sql/create-age-filter-function.sql
CREATE OR REPLACE FUNCTION get_shipments_by_age(
  p_client_id UUID,
  p_age_ranges JSONB,  -- [{"min": 7, "max": null}] for "7+ days"
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS TABLE(shipment_id UUID, age_days NUMERIC, total_count BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH age_calc AS (
    SELECT s.id as sid,
           EXTRACT(EPOCH FROM (COALESCE(s.delivered_date, NOW()) - o.order_import_date)) / 86400.0 as calc_age
    FROM shipments s
    INNER JOIN orders o ON s.order_id = o.id
    WHERE s.shipped_date IS NOT NULL
      AND (p_client_id IS NULL OR s.client_id = p_client_id)
  ),
  filtered AS (
    SELECT ac.sid, ac.calc_age FROM age_calc ac
    WHERE EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_age_ranges) r
      WHERE ac.calc_age >= (r->>'min')::NUMERIC
        AND (r->>'max' IS NULL OR ac.calc_age < (r->>'max')::NUMERIC)
    )
  ),
  counted AS (SELECT COUNT(*) as cnt FROM filtered)
  SELECT f.sid, f.calc_age, c.cnt FROM filtered f CROSS JOIN counted c
  ORDER BY f.calc_age ASC LIMIT p_limit OFFSET p_offset;
END;
$$;
```

**Performance improvement:** 11+ seconds → ~1.6 seconds (7x faster)

### API Implementation Pattern (with Graceful Fallback)

Always implement RPC calls with fallback - the function may not exist in all environments:

```typescript
// app/api/data/shipments/route.ts
if (ageFilter.length > 0) {
  // Convert UI filters to JSONB format
  const ageRanges = ageFilter.map(f => {
    switch (f) {
      case '0-1': return { min: 0, max: 1 }
      case '7+': return { min: 7, max: null }  // null = no upper limit
      // ... etc
    }
  })

  // Try RPC first
  const { data: rpcData, error: rpcError } = await supabase.rpc('get_shipments_by_age', {
    p_client_id: clientId,
    p_age_ranges: ageRanges,
    p_limit: 1000,
    p_offset: 0
  })

  if (!rpcError && rpcData) {
    // RPC worked! Use the filtered IDs
    if (rpcData.length === 0) {
      return NextResponse.json({ data: [], totalCount: 0 })
    }
    matchingShipmentIds = rpcData.map(r => r.shipment_id)
    totalCount = rpcData[0]?.total_count
    query = query.in('id', matchingShipmentIds)
  } else if (rpcError) {
    // RPC not available - fall back to parallel batch fetching
    // (slower but works without migration)
    console.log('RPC fallback:', rpcError.message)
    // ... batch fetch implementation
  }
}
```

### Decision Checklist for New Filters

Before implementing a new filter, ask:

1. **Is the filter value stored in a single column?**
   - YES → Use standard `.eq()`, `.in()`, `.gte()`, etc.
   - NO → Continue to #2

2. **Does the filter require data from multiple tables?**
   - YES → Consider RPC function
   - NO → Continue to #3

3. **Is the filter value calculated (not stored)?**
   - YES → RPC function required
   - NO → Standard query should work

4. **Would you need to fetch >1000 records to filter client-side?**
   - YES → RPC function for performance
   - NO → Client-side filtering may be acceptable

### Existing RPC Functions

| Function | Purpose | Used By |
|----------|---------|---------|
| `get_shipments_by_age` | Filter shipments by calculated age | `/api/data/shipments` |

### Pending RPC Candidates

| Filter | Current Approach | Issue | Priority |
|--------|------------------|-------|----------|
| Unfulfilled age filter | Client-side | Same as shipments age issue | Medium |

### Denormalized Columns (Dec 2, 2025)

For frequently-filtered values that require JOINs, we denormalize onto the child table:

| Table | Denormalized Column | Source | Purpose |
|-------|---------------------|--------|---------|
| `shipments` | `order_type` | `orders.order_type` | Type filter without JOIN |
| `shipments` | `channel_name` | `orders.channel_name` | Channel filter without JOIN |
| `shipments` | `shipbob_order_id` | `orders.shipbob_order_id` | Display without JOIN |

**Performance impact:** Type filter query time reduced from ~2s to ~0.7s (3x improvement).

**Maintenance:** Sync scripts must populate these columns when inserting/updating shipments. Backfill SQL:
```sql
UPDATE shipments s
SET order_type = o.order_type, channel_name = o.channel_name
FROM orders o
WHERE s.order_id = o.id AND s.order_type IS NULL;
```

---

## Three-Layer Data Integrity System

### Layer 1: Transaction ID Deduplication (Real-Time, 24/7)
**This is the PRIMARY deduplication mechanism.**

Every ShipBob transaction has a unique identifier from the moment it's created - before any invoice exists:

```typescript
// Ingestion uses UPSERT pattern - always safe to re-process
async function ingestShipment(data: ShipBobShipment, clientId: string) {
  const existing = await db.shipments.findUnique({
    where: { shipbob_order_id: data.order_id }
  });

  // Check if this is a cost change on a reconciled invoice
  if (existing?.invoice_number) {
    const invoice = await db.invoices.findFirst({
      where: { invoice_number: existing.invoice_number }
    });

    if (invoice?.reconciliation_status === 'reconciled') {
      // Invoice is sealed - cost changes are NOT allowed
      // ShipBob handles this via credits on the next invoice
      if (data.fulfillment_cost !== existing.base_fulfillment_cost) {
        logAnomaly('Cost change on reconciled invoice - expect credit', {
          order_id: data.order_id,
          old_cost: existing.base_fulfillment_cost,
          new_cost: data.fulfillment_cost
        });
        // Only update non-financial fields (status, tracking, etc.)
        await db.shipments.update({
          where: { shipbob_order_id: data.order_id },
          data: {
            transaction_status: data.status,
            delivered_date: data.delivered_date,
            updated_at: new Date()
          }
        });
        return;
      }
    }
  }

  // Normal UPSERT - recalculate markup if costs changed
  const markedUpCost = await calculateMarkedUpCost(
    data.fulfillment_cost,
    clientId,
    buildContext(data)
  );

  await db.shipments.upsert({
    where: { shipbob_order_id: data.order_id },
    create: { ...mapToSchema(data), marked_up_fulfillment_cost: markedUpCost },
    update: { ...mapToSchema(data), marked_up_fulfillment_cost: markedUpCost, updated_at: new Date() }
  });
}
```

**Result:** Even if a webhook fires 10 times, or API sync overlaps with webhooks, you get exactly ONE record.

### Handling Updates After Ingestion

| Scenario | Invoice Status | Action |
|----------|----------------|--------|
| Status change (delivered) | Any | Update record |
| Tracking update | Any | Update record |
| Cost change | `open` | Update record + recalculate markup |
| Cost change | `reconciled` | Log anomaly, wait for credit on next invoice |
| New adjustment/credit | N/A | Insert as new credit record |

**Key principle:** Once an invoice is reconciled, financial data is IMMUTABLE. ShipBob's own billing works this way - corrections appear as credits, not edits.

### Layer 2: Webhook Idempotency (Optional Extra Safety)
Track webhook event IDs to detect replays:

```sql
CREATE TABLE webhook_events (
  event_id TEXT PRIMARY KEY,      -- ShipBob's event ID
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT NOW(),
  raw_payload JSONB
);

-- Before processing: Check if already seen
-- INSERT ... ON CONFLICT DO NOTHING
```

### Layer 3: Invoice Reconciliation (Weekly Validation)

**This is NOT for deduplication - it's for COMPLETENESS verification.**

Once invoices close on Sunday, use them to:
1. Verify we captured ALL transactions (count match)
2. Verify total costs match (sum check)
3. Seal the data as "reconciled" (immutable)

---

## Invoice Structure

### ShipBob Invoice Timing
- **Weekly cycles:** Invoices close every Sunday at 23:59:59
- **Separate invoices per type:** Shipments, Returns, Storage, Receiving, Additional Services, Credits each have their own invoice number
- **Immutable assignment:** A transaction can ONLY appear on ONE invoice, ever
- **BASE costs only:** Invoices contain ShipBob's actual charges (no markup)
- **~7 day window:** Transactions exist WITHOUT invoice number until Sunday close

### Invoice as Validation Seal (Not Deduplication Key)

```
Invoice #SHP-2024-W47 (Week ending Nov 24, 2024)
├── Transaction A ✓ (can NEVER appear elsewhere)
├── Transaction B ✓
└── Transaction C ✓
```

### Dual-Layer Validation Strategy

| Layer | Purpose | Timing |
|-------|---------|--------|
| **Webhooks** | Real-time transaction visibility | Instant (1-2 sec) |
| **Invoice Reconciliation** | Completeness + deduplication | Weekly (after close) |

### Reconciliation Process

```
Mon-Sat: Webhooks arrive → Transactions stored with invoice_number (status: 'open')
Sunday 23:59:59: Invoice closes in ShipBob
Monday AM: Cron job runs reconciliation:

1. Fetch invoice metadata from Billing API
   - Get expected_transaction_count
   - Get total base_amount

2. Compare to our database
   - Count transactions WHERE invoice_number = X
   - Sum base costs

3. If counts match:
   - Set reconciliation_status = 'reconciled'
   - This invoice is now IMMUTABLE

4. If mismatch:
   - Fetch missing transactions via API
   - Log anomalies
   - Retry reconciliation

5. Reconciled invoice protection:
   - Any new transaction claiming this invoice = REJECT or ALERT
   - Prevents double-counting and double-billing
```

### ⚠️ Critical Business Rule: Invoice-Gated Client Billing

**A transaction is NOT billable to clients until it has a ShipBob invoice number assigned.**

```
Transaction Lifecycle:
┌─────────────────────────────────────────────────────────────┐
│  UNBILLED (invoice_number = NULL)                           │
│  ─────────────────────────────────────────────────────────  │
│  • Transaction exists in our database                       │
│  • Visible in dashboard for tracking/analytics              │
│  • NOT included in client invoices                          │
│  • Could still be cancelled/adjusted by ShipBob             │
└─────────────────────────────────────────────────────────────┘
                              │
                    Sunday 23:59:59
                    ShipBob assigns invoice_number
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  BILLABLE (invoice_number != NULL)                          │
│  ─────────────────────────────────────────────────────────  │
│  • ShipBob has billed us for this transaction               │
│  • Safe to include in client invoices                       │
│  • We never bill clients for something we weren't billed for│
└─────────────────────────────────────────────────────────────┘
```

**Why this matters:**
- Protects against billing for cancelled/voided transactions
- Ensures 1:1 correspondence between our costs and client charges
- Creates a natural ~7 day delay between transaction and billing eligibility
- If ShipBob didn't bill us, we don't bill the client

**Implementation:**
```sql
-- Client invoice generation query
SELECT * FROM shipments
WHERE client_id = $1
  AND invoice_number IS NOT NULL  -- CRITICAL: Only billable transactions
  AND invoice_date BETWEEN $2 AND $3;
```

### Admin Use Cases

With invoice tracking, admins can:
- **View costs by invoice:** "What did we owe ShipBob for week 47?"
- **Profit analysis:** Compare base_amount vs marked_up_amount per invoice
- **Reconciliation dashboard:** See which invoices are open, pending, reconciled, or in mismatch
- **Audit trail:** Every transaction traceable to a specific billing period
- **Billing eligibility:** Filter transactions by `invoice_number IS NOT NULL` for client invoicing

---

## Data Flow Architecture

**Critical principle:** Dashboard NEVER calls ShipBob API directly. All data comes from Supabase.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         DATA INGESTION                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   ShipBob (Webhooks/API)                                           │
│           │                                                         │
│           ▼                                                         │
│   ┌───────────────────┐                                            │
│   │ Raw Transaction   │                                            │
│   │ (base costs only) │                                            │
│   └─────────┬─────────┘                                            │
│             │                                                       │
│             ▼                                                       │
│   ┌───────────────────────────────────────┐                        │
│   │ Markup Rule Engine                    │                        │
│   │ • Find ALL matching rules for client  │                        │
│   │ • Filter by conditions (weight/state) │                        │
│   │ • Apply additively in priority order  │                        │
│   │ • Use rates active on transaction date│                        │
│   └─────────┬─────────────────────────────┘                        │
│             │                                                       │
│             ▼                                                       │
│   ┌───────────────────────────────────────┐                        │
│   │ Store BOTH in Supabase                │                        │
│   │ • base_cost: $8.50 (original)         │                        │
│   │ • marked_up_cost: $9.78 (calculated)  │                        │
│   │ • raw_data: {complete original JSON}  │                        │
│   └───────────────────────────────────────┘                        │
│                                                                     │
│   ⚠️ Markup calculated ONCE at ingestion                           │
│   ⚠️ Original data NEVER overwritten                               │
│   ⚠️ Historical rates preserved via effective_from/to dates        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                       DASHBOARD DISPLAY                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   Client View                         Admin View                    │
│       │                                   │                         │
│       ▼                                   ▼                         │
│   Query Supabase                     Query Supabase                 │
│   (RLS filters to                    (sees ALL data)                │
│    their data only)                       │                         │
│       │                                   │                         │
│       ▼                                   ▼                         │
│   Display marked_up_*             Display base_* AND marked_up_*    │
│   columns only                    + profit margin = difference      │
│                                                                     │
│   ⚠️ NEVER calls ShipBob API      ⚠️ NEVER calls ShipBob API       │
│   ⚠️ Fast Supabase queries only   ⚠️ Fast Supabase queries only    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Markup System

### Rule-Based Additive Architecture
The markup system uses **additive rules with conditions** instead of simple per-fee-type rates. This enables complex pricing scenarios without column explosion.

### Configuration
- **Granularity:** Per client + per fee type + per ship option + conditions (weight, state, country)
- **Types:** Percentage OR fixed amount
- **Stacking:** Multiple rules can apply additively to the same transaction
- **Priority:** Rules ordered by priority; higher priority rules applied first
- **Time-based:** `effective_from` / `effective_to` dates ensure historical accuracy

### Condition Types
| Condition | Example | Description |
|-----------|---------|-------------|
| `weight_min_oz` / `weight_max_oz` | `{"weight_min_oz": 64, "weight_max_oz": 128}` | Package weight range |
| `state` | `{"state": ["AK", "HI"]}` | Destination state(s) |
| `country` | `{"country": "CA"}` | Destination country |
| Combined | `{"weight_min_oz": 128, "state": ["AK", "HI"]}` | Multiple conditions (AND logic) |

### Example: Markup Calculation
**Scenario:** 8lb package to Alaska, base shipping cost $8.50

| Rule | Condition | Markup | Running Total |
|------|-----------|--------|---------------|
| Base shipping | None | +15% | $8.50 × 1.15 = $9.78 |
| Heavy package | weight > 64oz | +$2.00 | $9.78 + $2.00 = $11.78 |
| Remote state | state IN (AK, HI) | +$3.00 | $11.78 + $3.00 = $14.78 |

**Final marked-up cost: $14.78**

### Application Logic
```typescript
// lib/billing/markup-engine.ts
interface MarkupRule {
  id: string;
  name: string;
  fee_type: string | null;
  ship_option_id: string | null;
  conditions: {
    weight_min_oz?: number;
    weight_max_oz?: number;
    state?: string[];
    country?: string;
  };
  markup_type: 'percentage' | 'fixed';
  markup_value: number;
  priority: number;
  is_additive: boolean;
  effective_from: Date;
  effective_to: Date | null;
}

interface ShipmentContext {
  fee_type: string;
  ship_option_id: string;
  weight_oz: number;
  state: string;
  country: string;
  transaction_date: Date;
}

function matchesConditions(rule: MarkupRule, context: ShipmentContext): boolean {
  const { conditions } = rule;
  if (conditions.weight_min_oz && context.weight_oz < conditions.weight_min_oz) return false;
  if (conditions.weight_max_oz && context.weight_oz > conditions.weight_max_oz) return false;
  if (conditions.state && !conditions.state.includes(context.state)) return false;
  if (conditions.country && context.country !== conditions.country) return false;
  return true;
}

async function calculateMarkedUpCost(
  baseCost: number,
  clientId: string,
  context: ShipmentContext
): Promise<number> {
  // 1. Fetch all active rules for client + fee_type within date range
  const rules = await getActiveRules(clientId, context.fee_type, context.transaction_date);

  // 2. Filter by conditions and sort by priority
  const matchingRules = rules
    .filter(rule => matchesConditions(rule, context))
    .sort((a, b) => b.priority - a.priority);

  // 3. Apply additively
  let result = baseCost;
  for (const rule of matchingRules) {
    if (rule.markup_type === 'percentage') {
      result = result * (1 + rule.markup_value);
    } else {
      result = result + rule.markup_value;
    }
  }

  return result;
}

// Applied ONCE at data ingestion time - NEVER replace original
async function processShipment(rawData: any, clientId: string) {
  const context: ShipmentContext = {
    fee_type: 'shipping',
    ship_option_id: rawData.ship_option_id,
    weight_oz: rawData.billable_weight_oz,
    state: rawData.state,
    country: rawData.country,
    transaction_date: new Date(rawData.order_date),
  };

  const markedUpCost = await calculateMarkedUpCost(
    rawData.fulfillment_cost,
    clientId,
    context
  );

  return {
    base_fulfillment_cost: rawData.fulfillment_cost,
    marked_up_fulfillment_cost: markedUpCost,
    // ... both values ALWAYS stored
  };
}
```

---

## Data Anonymization (GDPR)

```sql
-- Configurable per client
ALTER TABLE clients ADD COLUMN anonymize_after_months INTEGER DEFAULT 24;

-- Scheduled function (pg_cron)
CREATE OR REPLACE FUNCTION anonymize_old_records()
RETURNS void AS $$
BEGIN
  UPDATE shipments s
  SET
    customer_name = 'REDACTED',
    zip_code = LEFT(zip_code, 3) || '**',
    city = 'REDACTED'
  FROM clients c
  WHERE s.client_id = c.id
    AND s.order_date < NOW() - (c.anonymize_after_months || ' months')::INTERVAL
    AND s.customer_name != 'REDACTED';
END;
$$ LANGUAGE plpgsql;
```

---

## Implementation Phases

| Phase | Tasks |
|-------|-------|
| **1. Database Foundation** | Supabase migrations, RLS policies, TypeScript types, data access layer |
| **2. Historic Import** | Excel parser, admin import UI, validate data integrity |
| **3. Markup System** | Markup config UI, calculation engine, client-specific rules |
| **4. API Integration** | ShipBob auth, webhook receivers, daily sync cron |
| **5. Dashboard Migration** | Replace sample data, admin profit views, caching |

---

## Files to Create

### Database Layer
- `supabase/migrations/001_create_tables.sql` - Core schema (clients, markup_rules, shipments, etc.)
- `supabase/migrations/002_rls_policies.sql` - Row level security
- `supabase/migrations/003_anonymization.sql` - GDPR compliance functions
- `supabase/migrations/004_sla_rules.sql` - Carrier SLA configuration
- `supabase/migrations/005_invoices_inventory.sql` - Billing reconciliation tables
- `lib/db/types.ts` - TypeScript types from schema
- `lib/db/clients.ts` - Client CRUD operations
- `lib/db/shipments.ts` - Shipment queries
- `lib/db/markup-rules.ts` - Rule-based markup configuration

### ShipBob Integration
- `lib/shipbob/client.ts` - API client with auth
- `lib/shipbob/billing.ts` - Billing API methods
- `lib/shipbob/webhooks.ts` - Webhook handlers
- `app/api/webhooks/shipbob/route.ts`
- `app/api/cron/billing-sync/route.ts`

### Markup Engine
- `lib/billing/markup-engine.ts`
- `lib/billing/import.ts`

### Admin UI
- `app/admin/markups/page.tsx`
- `app/admin/import/page.tsx`

---

## Catalog Sync: Products, Returns, Receiving (Migration 010)

### 4. sync-catalog.js - Catalog Data Sync

**Location:** `scripts/sync-catalog.js`

**Purpose:** Sync product catalog, returns, and receiving (WRO) data from ShipBob 2025-07 API

**Tables synced:**
- `products` - Product catalog with variants as JSONB
- `returns` - Return orders with inventory items as JSONB
- `receiving_orders` - Warehouse receiving orders (WROs) with inventory quantities as JSONB

**Usage:**
```bash
# Sync all for default client (henson)
node scripts/sync-catalog.js

# Sync for specific client
node scripts/sync-catalog.js --client=methyl-life

# Sync only specific type
node scripts/sync-catalog.js --type=products
node scripts/sync-catalog.js --type=returns
node scripts/sync-catalog.js --type=receiving
```

**Key API details:**

| Endpoint | Purpose | Max Page Size |
|----------|---------|---------------|
| `/2025-07/product` | Product catalog | 50 |
| `/2025-07/return` | Return orders | 250 |
| `/2025-07/receiving` | Warehouse receiving orders | 250 |

**⚠️ CRITICAL: 2025-07 API Endpoint Naming**
- Endpoints use **SINGULAR** names: `/product`, `/return`, `/receiving`
- NOT plural: ~~`/products`~~, ~~`/returns`~~, ~~`/receivings`~~
- Common mistake: Using plural names returns 404 errors

**⚠️ CRITICAL: Cursor Pagination URL Parsing**
The `next` field in 2025-07 API responses is a **URL path**, not a raw cursor value:
```json
{
  "items": [...],
  "next": "/Product?cursor=eyJhbGciOi..."
}
```

**Correct parsing:**
```javascript
if (data.next) {
  const nextUrl = new URL(data.next, 'https://api.shipbob.com')
  cursor = nextUrl.searchParams.get('cursor') || nextUrl.searchParams.get('Cursor')
}
```

**Wrong approach (causes 500 errors):**
```javascript
cursor = data.next  // WRONG - passes "/Product?cursor=..." as the cursor value
```

**Sync results (Nov 27, 2025):**

| Client | Products | Returns | Receiving Orders |
|--------|----------|---------|------------------|
| Henson Shaving | 143 | 181 | 97 |
| Methyl Life | 89 | 26 | 20 |

### Catalog Tables Schema (Migration 010)

**Design Principle:** Use JSONB for nested arrays to minimize table count and simplify queries.

#### 1. `products` - Product Catalog

```sql
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  merchant_id TEXT,                     -- ShipBob user_id
  shipbob_product_id INTEGER NOT NULL,
  name TEXT,
  type TEXT,                            -- 'Bundle', 'Simple'
  taxonomy TEXT,
  variants JSONB,                       -- Full variants array with SKUs, inventory
  created_on TIMESTAMPTZ,
  updated_on TIMESTAMPTZ,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_products_shipbob_id UNIQUE (client_id, shipbob_product_id)
);
```

**Variants JSONB structure:**
```json
[{
  "id": 12345,
  "sku": "RAZOR-BLK-001",
  "name": "Black Razor",
  "status": "Active",
  "inventory": { "inventory_id": 67890, "on_hand_qty": 150 },
  "dimension": { "length": 6, "width": 2, "height": 1 },
  "weight": { "value": 4.5, "unit": "oz" }
}]
```

#### 2. `returns` - Return Orders

```sql
CREATE TABLE returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  merchant_id TEXT,
  shipbob_return_id INTEGER NOT NULL,
  reference_id TEXT,
  status TEXT,                          -- 'Completed', 'Processing', 'AwaitingArrival'
  return_type TEXT,                     -- 'Regular', 'System Generated', 'ReturnToSender'
  tracking_number TEXT,
  original_shipment_id INTEGER,
  store_order_id TEXT,
  customer_name TEXT,
  invoice_amount DECIMAL(10,2),
  fc_id INTEGER,
  fc_name TEXT,
  channel_id INTEGER,
  channel_name TEXT,
  insert_date TIMESTAMPTZ,
  completed_date TIMESTAMPTZ,
  status_history JSONB,                 -- Array of {status, timestamp}
  inventory JSONB,                      -- Returned items with SKUs
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_returns_shipbob_id UNIQUE (shipbob_return_id)
);
```

#### 3. `receiving_orders` - WROs

```sql
CREATE TABLE receiving_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  merchant_id TEXT,
  shipbob_receiving_id INTEGER NOT NULL,
  purchase_order_number TEXT,
  status TEXT,                          -- 'Awaiting', 'Processing', 'Completed'
  package_type TEXT,                    -- 'Pallet', 'Package', 'FloorLoaded'
  box_packaging_type TEXT,
  fc_id INTEGER,
  fc_name TEXT,
  expected_arrival_date TIMESTAMPTZ,
  insert_date TIMESTAMPTZ,
  last_updated_date TIMESTAMPTZ,
  status_history JSONB,
  inventory_quantities JSONB,           -- Items with expected/received/stowed quantities
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_receiving_orders_shipbob_id UNIQUE (shipbob_receiving_id)
);
```

**Inventory quantities JSONB structure:**
```json
[{
  "inventory_id": 12345,
  "sku": "RAZOR-BLK-001",
  "expected_quantity": 500,
  "received_quantity": 500,
  "stowed_quantity": 500
}]
```

---

## Confirmed Requirements

1. **Billing API:** ✅ Available (2025-07 version) - field coverage verified at ~90%
2. **Markup Granularity:** Rule-based with conditions (fee type + ship option + weight + state + country)
3. **Historic Data:** Import ALL with both original AND marked-up costs (using historical markup rates)
4. **Real-time:** Webhooks provide instant billing data (costs known at label generation); daily sync is safety net only
5. **Multi-tenant:** RLS per client, admin sees all with profit analysis
6. **Privacy:** Data anonymization after configurable period
7. **Data Flow:** Ingest → Apply markup rules → Store both → Dashboard queries Supabase only (never ShipBob)
8. **Schema Validation:** ✅ 98% aligned with current dashboard UI - additional tables added for SLA, invoices, inventory
9. **Three-Layer Data Integrity:** (1) Transaction ID unique constraints for real-time deduplication, (2) Webhook idempotency tracking, (3) Invoice reconciliation for weekly completeness validation
10. **Admin Cost Analysis:** Track invoices with base costs for profit margin analysis, cost sifting/sorting, ShipBob payment tracking

---

*Last updated: December 1, 2025 - Added shipment status field architecture documentation*

---

## ⚠️ CRITICAL: Shipment Status Field Architecture (Dec 1, 2025)

**Key Discovery:** For shipped records, the `status` column is typically `'Completed'`. The actual tracking status comes from the `status_details` JSONB column.

### Database Column Structure

| Column | Type | Purpose | Example Values |
|--------|------|---------|----------------|
| `status` | TEXT | ShipBob fulfillment status | `Processing`, `LabeledCreated`, `Completed`, `Cancelled`, `Exception` |
| `status_details` | JSONB | Carrier tracking status (array) | `[{"name": "InTransit", "description": "Package in transit"}]` |
| `estimated_fulfillment_date_status` | TEXT | EFD status | `AwaitingInventoryAllocation`, `PendingOnTime`, `FulfilledOnTime` |
| `shipped_date` | TIMESTAMPTZ | When label was scanned by carrier | `2025-11-28T14:30:00Z` |
| `delivered_date` | TIMESTAMPTZ | Delivery confirmation | `2025-12-01T10:15:00Z` |

### Status Field Hierarchy

```
┌─────────────────────────────────────────────────────────────────────┐
│ SHIPMENT RECORD                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   status = 'Completed'  ← This is ALWAYS 'Completed' once shipped  │
│                                                                     │
│   status_details = [                                                │
│     {                                                               │
│       "name": "InTransit",        ← ACTUAL tracking status         │
│       "description": "Package in transit to destination"           │
│     }                                                               │
│   ]                                                                 │
│                                                                     │
│   delivered_date = null or timestamp  ← Definitive delivery check  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### UI Status Filter → Database Query Mapping

**For Shipments Tab (shipped records only):**

| UI Filter | Database Query | Notes |
|-----------|----------------|-------|
| **Delivered** | `delivered_date.not.is.null` | Check the timestamp column, not status |
| **In Transit** | `status_details->0->>name.eq.InTransit` | JSONB array access |
| **Out for Delivery** | `status_details->0->>name.eq.OutForDelivery` | JSONB array access |
| **Exception** | `status_details->0->>name.eq.DeliveryException` OR `status_details->0->>name.eq.DeliveryAttemptFailed` | Multiple exception types |
| **Awaiting Carrier** | `status.eq.AwaitingCarrierScan` OR `status_details->0->>name.eq.AwaitingCarrierScan` OR `status_details->0->>description.ilike.*Carrier*` | Multiple sources |
| **Labelled** | `status.eq.LabeledCreated` | Pre-ship status |

### Supabase PostgREST Query Syntax

```typescript
// Single JSONB filter
query = query.eq('status_details->0->>name', 'InTransit')

// Multiple OR conditions (for multi-source statuses)
const dbFilters: string[] = []
dbFilters.push('status_details->0->>name.eq.DeliveryException')
dbFilters.push('status_details->0->>name.eq.DeliveryAttemptFailed')
query = query.or(dbFilters.join(','))

// ILIKE pattern match on JSONB text
query = query.ilike('status_details->0->>description', '*Carrier*')
```

### getShipmentStatus() Function Logic

Location: `app/api/data/shipments/route.ts:291-365`

**Priority order:**
1. `delivered_date` set → "Delivered"
2. `status_details[0].name` tracking status → map to display name
3. `status` column → map to display name
4. `shipped_date` set → "Shipped"
5. `estimated_fulfillment_date_status` → fallback display
6. Default → "Pending"

### Common Tracking Statuses in status_details

| status_details[0].name | Display Name | Description |
|------------------------|--------------|-------------|
| `Delivered` | Delivered | Package delivered |
| `InTransit` | In Transit | Package with carrier |
| `OutForDelivery` | Out for Delivery | Final delivery attempt |
| `AwaitingCarrierScan` | Awaiting Carrier | Label created, not scanned |
| `DeliveryException` | Delivery Exception | Delivery problem |
| `DeliveryAttemptFailed` | Delivery Attempt Failed | Failed delivery |
| `Processing` | Awaiting Carrier* | *Only if description contains "Carrier" |
| `Picked` | Picked | Items picked |
| `Packed` | Packed | Package packed |
| `PickInProgress` | Pick In-Progress | Picking started |

### Important Implementation Notes

1. **Never filter on `status` alone for shipped records** - it's always 'Completed'
2. **Always use `status_details->0->>name`** for tracking status
3. **Use `delivered_date` column** for delivery check (most reliable)
4. **Combine multiple conditions with `.or()`** for statuses with multiple sources
5. **Date filtering uses JOINs** - filter on `orders.order_import_date`, not shipments table

### Orders vs Shipments Table Relationship

```
orders table:                    shipments table:
┌────────────────────┐          ┌────────────────────────────────┐
│ id (UUID PK)       │◄─────────│ order_id (FK to orders.id)     │
│ shipbob_order_id   │          │ shipbob_order_id (denormalized)│
│ order_import_date  │ ◄── DATE │ shipped_date                   │
│ order_type         │   FILTER │ status                         │
│ channel_name       │          │ status_details (JSONB)         │
│ customer_name      │          │ delivered_date                 │
└────────────────────┘          └────────────────────────────────┘
```

**For date range filtering on Shipments tab:**
- Use `!inner` JOIN syntax: `orders!inner(order_import_date, ...)`
- Filter on `orders.order_import_date`, not `shipments.shipped_date`
- This matches what users expect (order date, not ship date)

---

## Meilisearch - Full-Text Search (Dec 1, 2025)

### Why Meilisearch?

PostgreSQL ILIKE with leading wildcards (`%john%`) cannot use indexes, causing:
- Sequential scans on every search
- 200-500ms+ response times at 60K records
- 1-3+ seconds at 1M+ records

Meilisearch provides:
- Sub-50ms responses even with 10M+ records
- Typo tolerance out of the box
- Prefix search (results as you type)
- Faceted filtering

### Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         SEARCH FLOW                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   User types in search box                                          │
│           │                                                         │
│           ▼                                                         │
│   ┌───────────────────┐                                            │
│   │ /api/search       │ ← Meilisearch API                          │
│   └─────────┬─────────┘                                            │
│             │                                                       │
│             ▼                                                       │
│   ┌───────────────────┐                                            │
│   │ Meilisearch       │ ← ~10-50ms response                        │
│   │ (shipments index) │                                            │
│   └─────────┬─────────┘                                            │
│             │                                                       │
│             ▼                                                       │
│   Instant results with typo tolerance                               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                         SYNC FLOW                                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   Supabase (source of truth)                                        │
│           │                                                         │
│           ├── Initial sync: scripts/sync-meilisearch.js --full     │
│           │                                                         │
│           ├── Real-time: /api/webhooks/meilisearch-sync             │
│           │              (triggered by Supabase Database Webhooks)  │
│           │                                                         │
│           └── Daily cron: scripts/sync-meilisearch.js               │
│                           (catch any missed updates)                │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Setup

#### 1. Sign up for Meilisearch Cloud
https://cloud.meilisearch.com/
- Create a project (starts at $30/month)
- Get your Host URL and API Key

#### 2. Add environment variables
```bash
# .env.local
MEILISEARCH_HOST=https://your-project.meilisearch.cloud
MEILISEARCH_API_KEY=your-master-key
MEILISEARCH_WEBHOOK_SECRET=your-webhook-secret  # Optional, for webhook auth
```

#### 3. Initial sync
```bash
# Full sync (clears and rebuilds indexes)
node scripts/sync-meilisearch.js --full

# Sync specific client only
node scripts/sync-meilisearch.js --full --client=henson
```

#### 4. Set up real-time sync (optional)
In Supabase Dashboard → Database → Webhooks:
- Create webhook on `shipments` table for INSERT/UPDATE/DELETE
- URL: `https://your-domain.com/api/webhooks/meilisearch-sync`
- Headers: `Authorization: Bearer your-webhook-secret`

### Files

| File | Purpose |
|------|---------|
| [lib/meilisearch/client.ts](lib/meilisearch/client.ts) | Meilisearch client, index configuration, search functions |
| [scripts/sync-meilisearch.js](scripts/sync-meilisearch.js) | Full/incremental sync from Supabase to Meilisearch |
| [app/api/search/route.ts](app/api/search/route.ts) | Search API endpoint |
| [app/api/webhooks/meilisearch-sync/route.ts](app/api/webhooks/meilisearch-sync/route.ts) | Webhook for real-time sync |
| [hooks/use-meilisearch.ts](hooks/use-meilisearch.ts) | React hook for client-side search |

### Indexes

| Index | Documents | Searchable Fields | Filterable Fields |
|-------|-----------|-------------------|-------------------|
| `shipments` | Shipped orders | customerName, recipientName, storeOrderId, orderId, trackingId | clientId, status, orderType, channelName, shippedDate, importDate |
| `orders` | Unfulfilled orders | customerName, recipientName, storeOrderId, orderId | clientId, status, orderType, channelName, orderDate |

### Usage

#### In API routes (server-side)
```typescript
import { searchShipments } from '@/lib/meilisearch/client'

const results = await searchShipments({
  query: 'john',
  clientId: '6b94c274-...',
  status: ['Delivered', 'In Transit'],
  dateFrom: '2025-01-01',
  limit: 50,
})
// results.hits, results.totalHits, results.processingTimeMs
```

#### In React components (client-side)
```typescript
import { useMeilisearch } from '@/hooks/use-meilisearch'

const { search, isSearching, isAvailable } = useMeilisearch<Shipment>()

// Check if Meilisearch is available
if (isAvailable && searchQuery) {
  const results = await search({
    query: searchQuery,
    index: 'shipments',
    clientId,
  })
  // Use Meilisearch results
} else {
  // Fallback to database search
}
```

### Fallback Strategy

The system gracefully falls back to database search if Meilisearch is unavailable:
1. `useMeilisearch` hook sets `isAvailable: false` on 503 responses
2. Table components check `isAvailable` before using Meilisearch
3. If unavailable, existing database ILIKE search is used

### Performance Expectations

| Records | Meilisearch | Database ILIKE |
|---------|-------------|----------------|
| 60K | 10-30ms | 200-500ms |
| 1M | 20-50ms | 1-3 seconds |
| 10M | 30-80ms | 5-15 seconds |

---

## ✅ Data Verification (Nov 28, 2025)

**All data verified against Excel exports:**

| Source | Henson | Methyl-Life | Total |
|--------|--------|-------------|-------|
| Excel SHIPMENTS.xlsx rows | 65,228 | 8,436 | 73,664 |
| Excel unique OrderIDs | 60,449 | 8,432 | 68,881 |
| DB billing_shipments | 60,449 ✅ | 8,432 ✅ | 68,881 ✅ |
| DB shipments (API) | 60,944 | 8,507 | 69,451 |

**Why Excel has more rows than unique orders:**
1. Refund transactions (2,392) - not separate shipments, just adjustments
2. Multi-shipment orders (2,389) - same OrderID appears twice

**API has more than Excel because:** Recent shipments after Excel export date

**Conclusion:** Data is 100% complete and verified.
