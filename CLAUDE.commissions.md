# Commissions System

**Added:** February 2026
**Purpose:** Track partner-generated revenue and calculate commissions for sales partners

---

## Overview

The commissions system allows Jetpack to track shipment volumes across multiple fulfillment partners (ShipBob, eShipper, GOFO) and calculate commissions for sales partners based on the clients they've brought in.

### Key Features

- **Multi-partner support**: Counts shipments from ShipBob (real-time via API) and eShipper (CSV upload)
- **Configurable formulas**: Currently uses Volume-Based formula: `$2.50 × √shipments`
- **Monthly snapshots**: Commissions are locked on the 1st of each month
- **Real-time dashboard**: Shows current month progress with breakdown by brand/partner
- **Admin view**: Aggregate view across all commission recipients

---

## Database Schema

### `commission_types`

Defines the available commission calculation formulas.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `name` | text | Display name (e.g., "Volume-Based") |
| `formula_type` | text | Formula identifier (e.g., "power") |
| `formula_params` | jsonb | Formula parameters (e.g., `{"C": 2.5, "K": 0.5}`) |
| `description` | text | Human-readable description |
| `is_active` | boolean | Whether this type can be assigned |

**Current Configuration:**
- "Volume-Based" with `power` formula: `C × (shipments^K)` where C=$2.50, K=0.5
- This gives `$2.50 × √shipments` (square root scaling)

### `user_commissions`

Links users to their commission assignments.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `user_id` | uuid | FK to auth.users |
| `commission_type_id` | uuid | FK to commission_types |
| `start_date` | date | When commission tracking begins |
| `end_date` | date | When commission tracking ends (NULL = ongoing) |
| `is_active` | boolean | Active assignment flag |

### `user_commission_clients`

Maps which clients count toward a user's commission.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `user_commission_id` | uuid | FK to user_commissions |
| `client_id` | uuid | FK to clients |

### `commission_snapshots`

Locked monthly commission records (created on 1st of each month).

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `user_commission_id` | uuid | FK to user_commissions |
| `period_year` | integer | Year (e.g., 2026) |
| `period_month` | integer | Month (1-12) |
| `shipment_count` | integer | Total shipments for the period |
| `commission_amount` | numeric | Calculated commission |
| `breakdown` | jsonb | Per-client breakdown (see below) |
| `locked_at` | timestamptz | When snapshot was created |

**Breakdown JSONB structure:**
```json
[
  {
    "clientId": "uuid",
    "clientName": "Henson Shaving",
    "shipments": 1234,
    "commission": 87.84,
    "byPartner": { "shipbob": 1000, "eshipper": 234 }
  }
]
```

---

## eShipper Data

eShipper shipments are imported via CSV upload (no API integration yet).

### `eshipper_shipments`

Stores individual eShipper shipment records.

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `client_id` | uuid | FK to clients (matched via eshipper_company_id) |
| `eshipper_company_id` | text | eShipper's company identifier |
| `eshipper_company_name` | text | Company name in eShipper |
| `tracking_number` | text | Unique tracking number (used for dedup) |
| `transaction_number` | text | eShipper transaction ID |
| `order_date` | date | When order was placed |
| `ship_date` | date | **When shipment was created (used for counting)** |
| `delivery_date` | date | When delivered (if known) |
| `carrier` | text | Carrier name |
| `carrier_service` | text | Service level |
| `status` | text | Current status |
| `ship_from_*` | text | Origin address fields |
| `ship_to_*` | text | Destination address fields |
| `base_charge` | numeric | Base shipping cost |
| `fuel_surcharge` | numeric | Fuel surcharge |
| `total_surcharges` | numeric | All surcharges |
| `total_charge` | numeric | Total cost |
| `imported_at` | timestamptz | When record was imported |
| `import_source` | text | Source identifier |

**Important:** Commissions count by `ship_date`, not `order_date`. When filtering eShipper exports by "order date", the actual ship dates may span a wider range.

### `eshipper_shipment_counts` (deprecated)

Legacy table for daily aggregates. Not currently used - we now store individual shipments.

### Client Matching

Clients are matched to eShipper data via the `eshipper_id` column on the `clients` table:
- `clients.eshipper_id` should match `eshipper_shipments.eshipper_company_id`
- If a client has both `merchant_id` (ShipBob) and `eshipper_id`, shipments from both partners are summed

---

## Commission Calculation

### Formula

Current formula is "Volume-Based" (`power` type):
```
commission = C × (shipments^K)
```

With default params C=2.50, K=0.5:
```
commission = $2.50 × √shipments
```

Examples:
- 100 shipments → $2.50 × 10 = $25.00
- 1,000 shipments → $2.50 × 31.62 = $79.06
- 10,000 shipments → $2.50 × 100 = $250.00

### Counting Shipments

For each assigned client, shipments are counted from:

1. **ShipBob** (if `client.merchant_id` is set):
   - Query `shipments` table
   - Filter by `client_id` and `created_at` within period
   - Real-time data (synced every minute)

2. **eShipper** (if `client.eshipper_id` is set):
   - Query `eshipper_shipments` table
   - Filter by `client_id` and `ship_date` within period
   - Manual CSV upload (typically daily/weekly)

3. **GOFO** (future - if `client.gofo_id` is set):
   - Not yet implemented

Total shipments = ShipBob + eShipper + GOFO

### Current Month vs Historical

- **Current month**: Calculated real-time from live data
- **Historical months**: Read from `commission_snapshots` table (locked data)
- Snapshots are created by the `lock-commissions` cron on the 1st of each month

---

## API Routes

### Data Routes (authenticated users)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/data/commissions` | GET | Get current month commission (real-time calculation) |
| `/api/data/commissions/history` | GET | Get locked historical snapshots |

Query params:
- `userId`: (Admin only) Preview another user's commissions

### Admin Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/admin/commission-types` | GET | List commission type definitions |
| `/api/admin/user-commissions` | GET/POST | Manage user assignments |
| `/api/admin/user-commissions/[id]/clients` | GET/POST/DELETE | Manage client assignments |
| `/api/admin/eshipper-upload` | POST | Upload eShipper CSV |
| `/api/admin/eshipper-stats` | GET | Get eShipper import statistics |

### Cron Routes

| Route | Schedule | Purpose |
|-------|----------|---------|
| `/api/cron/lock-commissions` | 1st of month, 11 AM UTC | Lock previous month into snapshots |

---

## UI Components

### Financials Page (`/dashboard/financials`)

- **Admin view**: Shows tabs (Revenue, Activity, Commissions - only Commissions active)
- **User selector**: Admins can view "All Recipients" aggregate or individual users
- **Non-admin view**: Shows only their own commission data (no tabs or selector)

### Commission Display

- **Hero stat**: Large commission amount for selected month
- **Feature cards**: ShipBob count, eShipper count, Total shipments, Brands count
- **Month selector**: Click historical months in left panel to view that period
- **Brand breakdown**: Per-client shipment counts with progress bars

### Key Files

| File | Purpose |
|------|---------|
| `app/dashboard/financials/page.tsx` | Main commissions UI |
| `lib/commissions/calculator.ts` | Commission calculation logic |
| `lib/commissions/types.ts` | TypeScript interfaces |

---

## Current Recipients

| User | Commission Type | Clients | Start Date |
|------|-----------------|---------|------------|
| Nora Smith | Volume-Based | 14 | Feb 4, 2026 |

---

## CSV Upload Process

### eShipper CSV Format

The upload accepts standard eShipper export CSVs with these key columns:
- `Tracking #` - Used as unique identifier for deduplication
- `Company ID` - Matched to `clients.eshipper_id`
- `Company Name` - Stored for reference
- `Order Date` - When order was placed
- `Ship Date` - **Used for commission counting**
- `Carrier`, `Service`
- Cost fields: `Base Charge`, `Fuel Surcharge`, etc.

### Upload Endpoint

`POST /api/admin/eshipper-upload`

- Accepts multipart form data with CSV file
- Parses CSV and maps to `eshipper_shipments` schema
- Upserts on `tracking_number` (deduplicates)
- Returns count of inserted/updated records

### Date Consideration

eShipper exports may filter by `Order Date`, but we count commissions by `Ship Date`. An export filtered for "Feb 1-4 orders" might include shipments with ship dates spanning Feb 1-6.

---

## Implementation Status

Based on the original plan at `~/.claude/plans/purrfect-napping-waterfall.md`:

| Feature | Status | Notes |
|---------|--------|-------|
| Database schema | ✅ Complete | All tables created |
| Commission types | ✅ Complete | Volume-Based formula active |
| User assignments | ✅ Complete | Nora Smith assigned |
| Client assignments | ✅ Complete | 14 clients assigned |
| Real-time calculation | ✅ Complete | Current month calculated live |
| Monthly snapshots | ✅ Complete | lock-commissions cron active |
| Admin UI | ✅ Complete | Financials page with tabs |
| User UI | ✅ Complete | Personal commission view |
| ShipBob counting | ✅ Complete | Via shipments table |
| eShipper CSV upload | ✅ Complete | Individual shipment storage |
| eShipper API sync | ❌ Not started | Using CSV upload instead |
| GOFO integration | ❌ Not started | Future |
| sales_partner role | ❌ Not started | Future |
| Client size labels | ❌ Not started | Future |

---

## Planned Future Enhancements

### Client Size Labels (Internal)

Classification based on monthly shipment volume:

| Label | Monthly Shipments |
|-------|-------------------|
| Goldfish | < 100 |
| Bass | 100 - 500 |
| Salmon | 500 - 1,000 |
| Dolphin | 1,000 - 5,000 |
| Swordfish | 5,000 - 10,000 |
| Shark | 10,000 - 50,000 |
| Whale | > 50,000 |

Would be stored in `clients.size_label` column (not yet added).

### eShipper API Integration

Reference: https://ww2.eshipper.com/swagger-ui/index.html

Would enable real-time sync instead of manual CSV uploads. Environment variables needed:
```
ESHIPPER_API_KEY=xxx
ESHIPPER_API_URL=https://ww2.eshipper.com
```

### sales_partner Role

New user role for external partners with limited access:
- Can only see Commissions page
- No access to client data, billing, or admin features
- Commission data isolated by user_id via RLS

### Other Enhancements

1. **GOFO Integration**: Add support for GOFO partner shipments
2. **Additional Formula Types**: Linear, tiered, percentage-based
3. **Commission Payouts**: Track actual payments to recipients
4. **Sidebar visibility**: Show Financials only for users with commission assignments
