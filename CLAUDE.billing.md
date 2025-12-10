# Billing & Invoicing

**Read this when:** Working on invoice generation, markup rules, SFTP file processing, or billing workflows.

---

## Invoice Generation Flow

```
ShipBob Weekly Invoices → Sync to invoices_sb → Admin Review → Generate Draft → Approve → Mark Transactions
```

1. **ShipBob closes invoices** - Every Sunday at 23:59:59
2. **sync-invoices cron** - Syncs invoice metadata to `invoices_sb` table
3. **Admin reviews preflight** - `/api/admin/invoices/preflight` checks data quality
4. **Generate invoices** - `/api/admin/invoices/generate` creates drafts with PDF/XLSX
5. **Approve invoice** - `/api/admin/invoices/[id]/approve` marks transactions as billed

---

## Invoice Number Format

```
JP{SHORT_CODE}-{SEQUENCE}-{MMDDYY}
Example: JPHS-0038-120825
```

- `JP` = Jetpack prefix
- `SHORT_CODE` = Client's 2-4 letter code (e.g., "HS" for Henson Shaving)
- `SEQUENCE` = Auto-incrementing per client (`clients.next_invoice_number`)
- `MMDDYY` = Invoice date

---

## Markup Rules

### Rule Selection: "Most Conditions Wins"

Rules are **standalone** (no stacking). If multiple rules match, the most specific one wins.

| Conditions Count | Example |
|------------------|---------|
| 0 conditions | "Standard" = 14% (applies to all) |
| 1 condition | "Standard + Ship Option 146" = 18% |
| 2 conditions | "Standard + Ship 146 + 5-10lbs" = 25% |

### Conditions Counted
- `client_id` specified (vs global rule): +1
- `ship_option_id` specified: +1
- Weight bracket specified: +1

### markup_rules Table

| Column | Type | Description |
|--------|------|-------------|
| `client_id` | UUID | NULL = global rule |
| `fee_type` | TEXT | "Standard", "FBA", "VAS", etc. |
| `ship_option_id` | TEXT | ShipBob ship option ID |
| `billing_category` | TEXT | "shipments", "storage", "returns", etc. |
| `conditions` | JSONB | `{weight_min_oz, weight_max_oz, states, countries}` |
| `markup_type` | TEXT | "percentage" or "fixed" |
| `markup_value` | NUMERIC | 14.0 = 14% or $14.00 fixed |
| `effective_from` | DATE | When rule becomes active |
| `effective_to` | DATE | NULL = currently active |

### Weight Brackets

| Label | Range |
|-------|-------|
| `<8oz` | 0 - 8 oz |
| `8-16oz` | 8 - 16 oz |
| `1-5lbs` | 16 - 80 oz |
| `5-10lbs` | 80 - 160 oz |
| `10-15lbs` | 160 - 240 oz |
| `15-20lbs` | 240 - 320 oz |
| `20+lbs` | 320+ oz |

---

## Billing Categories

| Category | reference_type(s) | Source |
|----------|-------------------|--------|
| `shipments` | Shipment | Shipping charges |
| `shipment_fees` | Shipment | Pick fees, materials |
| `storage` | FC | Warehousing fees |
| `returns` | Return | Return processing |
| `receiving` | WRO, URO | Receiving/inbound |
| `credits` | Default, TicketNumber | Refunds, adjustments |
| `insurance` | Shipment | Insurance charges |

---

## Transaction Fields for Invoicing

### From Billing API (synced)
| Field | DB Column | Required |
|-------|-----------|----------|
| Amount | `cost` | Yes |
| Charge date | `charge_date` | Yes |
| Fee type | `transaction_fee` | Yes |
| Invoice ID | `invoice_id_sb` | Yes |
| Client | `client_id` | Yes |

### From SFTP (extras-MMDDYY.csv)
| SFTP Field | DB Column | Purpose |
|------------|-----------|---------|
| `base_cost` | `base_cost` | Base shipping (for detailed breakdown) |
| `surcharges` | `surcharge` | DAS, fuel, etc. |
| `insurance_cost` | `insurance_cost` | Insurance amount |

### Calculated at Invoice Time
| Field | DB Column | Calculation |
|-------|-----------|-------------|
| Markup amount | `markup_applied` | `cost * markup_percentage` |
| Billed amount | `billed_amount` | `cost + markup_applied` |
| Markup rule | `markup_rule_id` | FK to `markup_rules` |

### Set at Approval
| Field | DB Column | Purpose |
|-------|-----------|---------|
| Jetpack invoice ID | `invoice_id_jp` | Links to `invoices_jetpack` |
| Jetpack invoice date | `invoice_date_jp` | When we billed client |
| Invoiced status | `invoiced_status_jp` | TRUE = billed |

---

## SFTP File Processing

ShipBob sends daily files via SFTP with cost breakdown:

```
extras-MMDDYY.csv
```

### Fields in SFTP File
| Field | Maps To |
|-------|---------|
| `transaction_id` | Join key |
| `base_cost` | `transactions.base_cost` |
| `surcharges` | `transactions.surcharge` |
| `insurance_cost` | `transactions.insurance_cost` |

### Processing Script
```bash
# TODO: Create SFTP processing script
node scripts/process-sftp-extras.js --file=extras-120825.csv
```

---

## Invoice Tables

### invoices_sb (ShipBob invoices)
| Column | Description |
|--------|-------------|
| `shipbob_invoice_id` | ShipBob's invoice ID |
| `invoice_type` | Shipping, AdditionalFee, Credits, etc. |
| `invoice_date` | When ShipBob created it |
| `base_amount` | Total amount |
| `jetpack_invoice_id` | FK to our invoice (NULL = unprocessed) |

### invoices_jetpack (Our invoices to clients)
| Column | Description |
|--------|-------------|
| `invoice_number` | JPHS-0038-120825 format |
| `client_id` | FK to clients |
| `status` | draft, approved, sent, paid |
| `subtotal` | Sum of base costs |
| `total_markup` | Sum of markups |
| `total_amount` | subtotal + total_markup |
| `period_start`, `period_end` | Billing week |
| `shipbob_invoice_ids` | Array of SB invoice IDs included |
| `line_items_json` | Snapshot for regeneration |

---

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/admin/invoices` | GET | List invoices |
| `/api/admin/invoices/preflight` | GET | Pre-generation validation |
| `/api/admin/invoices/generate` | POST | Generate draft invoices |
| `/api/admin/invoices/[id]/approve` | POST | Approve and mark transactions |
| `/api/admin/invoices/[id]/regenerate` | POST | Regenerate draft |
| `/api/admin/invoices/[id]/files` | GET | Download PDF/XLSX |

---

## Preflight Validation

Before generating invoices, preflight checks:

1. **Transaction completeness** - All transactions have required fields
2. **Client attribution** - All transactions have client_id
3. **Markup rules exist** - Matching rules for all fee types
4. **No duplicates** - No transaction already billed
5. **Data quality** - Reasonable amounts, valid dates

---

## Invoice Status Flow

```
draft → approved → sent → paid
         ↓
      rejected (can regenerate)
```

- **draft**: Generated but not finalized
- **approved**: Transactions marked, files locked
- **sent**: Sent to client
- **paid**: Payment received

---

## Files

| File | Purpose |
|------|---------|
| `lib/billing/markup-engine.ts` | Rule matching and calculation |
| `lib/billing/invoice-generator.ts` | Invoice data collection |
| `lib/billing/preflight-validation.ts` | Pre-generation checks |
| `lib/billing/pdf-subprocess.ts` | PDF generation |
| `app/api/admin/invoices/*` | Invoice API routes |

---

## Manual Operations

### Generate invoice for specific client
```bash
curl -X POST https://your-domain.com/api/admin/invoices/generate \
  -H "Cookie: your-auth-cookie" \
  -H "Content-Type: application/json" \
  -d '{"clientId": "uuid-here"}'
```

### Skip preflight (emergency only)
```bash
curl -X POST .../generate -d '{"skipPreflight": true}'
```
