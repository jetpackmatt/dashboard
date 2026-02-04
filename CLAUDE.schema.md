# Database Schema

**Read this when:** Working with database queries, migrations, or understanding table relationships.

**Source:** Queried directly from Supabase (Dec 17, 2025)

---

## Tables Overview

| Table | Primary Key | Purpose |
|-------|-------------|---------|
| `clients` | `id` | Brand/company records |
| `orders` | `id` / `shipbob_order_id` | Order-level data |
| `shipments` | `id` / `shipment_id` | Shipment details, tracking, timeline |
| `transactions` | `id` / `transaction_id` | All billing transactions |
| `returns` | `id` / `shipbob_return_id` | Return records |
| `invoices_sb` | `id` / `shipbob_invoice_id` | ShipBob invoices |
| `invoices_jetpack` | `id` / `invoice_number` | Our invoices to clients |
| `markup_rules` | `id` | Pricing rules |
| `order_items` | `id` | Products per order |
| `shipment_items` | `id` | Products per shipment |
| `shipment_cartons` | `id` | Carton/box data |
| `products` | `id` | Product catalog |
| `fulfillment_centers` | `id` | FC lookup |
| `care_tickets` | `id` / `ticket_number` | Claims and credit requests |
| `lost_in_transit_checks` | `id` | Proactive at-risk shipment tracking (Delivery IQ) |
| `transit_benchmarks` | `id` | Transit time benchmarks by carrier/zone/route |

---

## clients

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `company_name` | text | Required |
| `merchant_id` | text | ShipBob merchant ID |
| `short_code` | text | For invoice numbers (e.g., "HS") |
| `is_active` | boolean | Default true |
| `is_internal` | boolean | True for system clients |
| `billing_email` | text | Legacy single email (deprecated) |
| `billing_emails` | text[] | Array of invoice recipient emails |
| `billing_phone` | text | Primary billing contact phone |
| `billing_contact_name` | text | Primary billing contact name |
| `billing_terms` | text | due_on_receipt, net_15, etc. |
| `billing_address` | jsonb | Address for PDF |
| `next_invoice_number` | integer | Auto-incrementing sequence |
| `billing_period` | text | weekly, monthly |
| `billing_currency` | text | USD |
| `payment_method` | text | `ach` (default) or `credit_card` |
| `stripe_customer_id` | text | Stripe customer ID (for CC payments) |
| `stripe_payment_method_id` | text | Stripe saved card PM ID |

**System Client (`is_internal=true`):**
- "Jetpack" - Parent-level transactions (ACH payments, CC processing fees, disputed charges)

---

## orders

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `client_id` | uuid | FK to clients |
| `shipbob_order_id` | text | Unique, from ShipBob |
| `store_order_id` | text | Shopify/BigCommerce order # |
| `customer_name` | text | |
| `customer_email` | text | |
| `order_import_date` | timestamptz | When imported to ShipBob |
| `purchase_date` | timestamptz | When customer ordered |
| `status` | text | Processing, Fulfilled, etc. |
| `order_type` | text | DTC, FBA, VAS |
| `channel_id` | integer | ShipBob channel |
| `channel_name` | text | |
| `application_name` | text | Shopify, BigCommerce, etc. |
| `city`, `state`, `zip_code`, `country` | text | Destination |
| `total_shipments` | integer | Count of shipments |
| `deleted_at` | timestamptz | Soft delete |
| `last_verified_at` | timestamptz | Last sync verification |
| `search_vector` | tsvector | Full-text search |

---

## shipments

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `client_id` | uuid | FK to clients |
| `order_id` | uuid | FK to orders |
| `shipment_id` | text | Unique, from ShipBob |
| `shipbob_order_id` | text | Denormalized |
| `tracking_id` | text | Carrier tracking number |
| `tracking_url` | text | |
| `status` | text | Processing, LabeledCreated, Completed (see note below) |
| `carrier` | text | USPS, FedEx, UPS, etc. |
| `carrier_service` | text | Actual carrier service (e.g., "Ground Advantage", "FedEx Ground") |
| `ship_option_name` | text | ShipBob ship option (e.g., "ShipBob Economy", "Ground") |
| `ship_option_id` | integer | ShipBob service level ID |
| `zone_used` | integer | Shipping zone |
| `fc_name` | text | Fulfillment center name |
| `fc_id` | integer | |
| `actual_weight_oz` | numeric | Package weight |
| `dim_weight_oz` | numeric | Calculated dimensional weight |
| `billable_weight_oz` | numeric | max(actual, dim) |
| `length`, `width`, `height` | numeric | Package dimensions (inches) |
| `delivered_date` | timestamptz | Delivery timestamp |
| `order_type` | text | Denormalized from order |
| `channel_name` | text | Denormalized |
| `application_name` | text | Denormalized |
| `deleted_at` | timestamptz | Soft delete |
| `last_verified_at` | timestamptz | |
| `timeline_checked_at` | timestamptz | Last timeline API poll (prevents re-checking too often) |
| `last_update_at` | timestamptz | ShipBob's update timestamp (⚠️ see note below) |

**⚠️ `last_update_at` Limitation:**
This field does NOT update when timeline events are added (tested Dec 2025).
It only changes when the shipment record itself changes (status, tracking, etc.).
Do NOT use for timeline sync optimization - use age-based polling instead.

### Timeline Event Columns
| Column | Type | log_type_id |
|--------|------|-------------|
| `event_created` | timestamptz | 601 |
| `event_picked` | timestamptz | 602 |
| `event_packed` | timestamptz | 603 |
| `event_labeled` | timestamptz | 604 |
| `event_labelvalidated` | timestamptz | 605 |
| `event_intransit` | timestamptz | 607 |
| `event_outfordelivery` | timestamptz | 608 |
| `event_delivered` | timestamptz | 609 |
| `event_deliveryattemptfailed` | timestamptz | 611 |
| `event_logs` | jsonb | Raw timeline data |

**⚠️ Completed ≠ Delivered:**
- `status = 'Completed'` means **shipped from warehouse** (fulfillment complete)
- `event_delivered IS NOT NULL` means **delivered to customer** (carrier event)
- A shipment can be "Completed" but not yet delivered (in transit)

---

## transactions

**This is the main billing table - ALL transaction types.**

**⚠️ Reshipments:** A single `shipment_id` (reference_id) can have MULTIPLE Shipping transactions if the order was reshipped. Each shipping event generates a new transaction with a unique `transaction_id` but the same `reference_id`. Use `reference_id + charge_date` for precise matching.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `transaction_id` | text | Unique, from ShipBob (ULID) |
| `client_id` | uuid | FK to clients |
| `merchant_id` | text | |
| `reference_id` | text | Links to shipment/return/FC |
| `reference_type` | text | Shipment, FC, Return, WRO, etc. |
| `cost` | numeric | Our cost (API's "amount") |
| `currency_code` | text | USD |
| `charge_date` | date | When charged |
| `transaction_fee` | text | Shipping, Per Pick Fee, etc. |
| `transaction_type` | text | Charge, Credit, Payment |
| `fulfillment_center` | text | FC name |
| `tracking_id` | text | From additional_details |
| `additional_details` | jsonb | Raw API data |

### ShipBob Invoice Fields
| Column | Type | Notes |
|--------|------|-------|
| `invoiced_status_sb` | boolean | Billed by ShipBob |
| `invoice_id_sb` | integer | ShipBob invoice ID |
| `invoice_date_sb` | date | ShipBob invoice date |

### SFTP Cost Breakdown
| Column | Type | Notes |
|--------|------|-------|
| `base_cost` | numeric | Base shipping from SFTP |
| `surcharge` | numeric | Sum of all surcharges from SFTP |
| `surcharge_details` | jsonb | Individual surcharge types (Dec 2025+) |
| `insurance_cost` | numeric | Insurance from SFTP |

**Surcharge Details Structure:**
```json
[
  { "type": "Peak Surcharge", "amount": 0.15 },
  { "type": "Fuel Surcharge", "amount": 0.10 }
]
```
The `surcharge` column contains the aggregated sum for backwards compatibility. The `surcharge_details` JSONB column stores individual surcharge types for analytics.

### Markup/Billing Fields
| Column | Type | Notes |
|--------|------|-------|
| `base_charge` | numeric | Calculated base charge |
| `total_charge` | numeric | After markup |
| `insurance_charge` | numeric | After markup |
| `markup_applied` | numeric | Markup dollar amount |
| `markup_percentage` | numeric | Effective % |
| `markup_rule_id` | uuid | FK to markup_rules |
| `billed_amount` | numeric | Final amount to client |

### Jetpack Invoice Fields
| Column | Type | Notes |
|--------|------|-------|
| `invoiced_status_jp` | boolean | Billed to client |
| `invoice_id_jp` | text | JPHS-0038-120825 format |
| `invoice_date_jp` | timestamptz | When we billed |

### Dispute Fields
| Column | Type | Notes |
|--------|------|-------|
| `dispute_status` | text | null=normal, `disputed`=under review, `invalid`=bad charge, `credited`=matched |
| `dispute_reason` | text | Free-text explanation |
| `dispute_created_at` | timestamptz | When dispute was created |
| `matched_credit_id` | text | transaction_id of credit that zeros out this charge |

**Dispute Workflow:**
1. Admin marks transaction as `invalid` with reason → moves to Jetpack system client
2. ShipBob issues credit → credit transaction syncs in
3. Admin matches credit to original charge → both set to `credited`
4. Invoice generation excludes `invalid` transactions from client bills

### Tax Fields (Canadian FCs)
| Column | Type | Notes |
|--------|------|-------|
| `taxes` | jsonb | Array of tax objects from ShipBob API |

**Tax Data Structure:**
```json
[
  { "tax_type": "GST", "tax_rate": 13, "tax_amount": 0.65 }
]
```

Canadian fulfillment centers (e.g., Brampton Ontario) charge GST/HST. The `taxes` array contains one or more tax entries. For invoice generation, these are aggregated by tax type (e.g., all HST amounts summed together).

---

## returns

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `client_id` | uuid | FK to clients |
| `shipbob_return_id` | integer | Unique, from ShipBob |
| `reference_id` | text | |
| `status` | text | AwaitingArrival, Processing, etc. |
| `return_type` | text | |
| `tracking_number` | text | Return tracking |
| `original_shipment_id` | integer | |
| `store_order_id` | text | |
| `customer_name` | text | |
| `fc_id`, `fc_name` | int/text | |
| `channel_id`, `channel_name` | int/text | |
| `insert_date` | timestamptz | Return creation date |
| `arrived_date` | timestamptz | |
| `processing_date` | timestamptz | |
| `completed_date` | timestamptz | |
| `cancelled_date` | timestamptz | |
| `inventory` | jsonb | Returned items |

---

## invoices_sb (ShipBob Invoices)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `shipbob_invoice_id` | text | Unique |
| `client_id` | uuid | FK (nullable - parent invoices) |
| `invoice_type` | text | Shipping, AdditionalFee, Credits, etc. |
| `invoice_date` | date | |
| `period_start`, `period_end` | timestamptz | Billing period |
| `base_amount` | numeric | Total |
| `currency_code` | text | USD |
| `jetpack_invoice_id` | text | FK to our invoice (NULL = unprocessed) |
| `reconciliation_status` | text | open, reconciled |

**Invoice Types:**
- `Shipping` - Carrier costs
- `AdditionalFee` - Pick fees, packaging
- `WarehouseStorage` - Monthly storage
- `WarehouseInboundFee` - Receiving/WRO
- `ReturnsFee` - Return processing
- `Credits` - Refunds (negative)
- `Payment` - Payments (negative, not billable)

---

## invoices_jetpack (Our Invoices)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `client_id` | uuid | FK to clients |
| `invoice_number` | text | JPHS-0038-120825 |
| `invoice_date` | date | |
| `period_start`, `period_end` | date | Billing week |
| `subtotal` | numeric | Sum of base costs |
| `total_markup` | numeric | Sum of markups |
| `total_amount` | numeric | subtotal + markup |
| `status` | text | draft, approved, sent |
| `paid_status` | text | unpaid, paid, partial |
| `paid_at` | timestamptz | When payment received |
| `stripe_payment_intent_id` | text | Stripe PI ID (for CC payments) |
| `pdf_path`, `xlsx_path` | text | Storage paths |
| `generated_at` | timestamptz | |
| `approved_by` | uuid | FK to auth.users |
| `approved_at` | timestamptz | |
| `shipbob_invoice_ids` | jsonb | Array of SB invoice IDs |
| `line_items_json` | jsonb | Snapshot for regeneration |

**Note:** `status` is the invoice workflow state (draft→approved→sent). `paid_status` tracks payment separately.

---

## markup_rules

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `client_id` | uuid | NULL = global rule |
| `name` | text | Human-readable |
| `fee_type` | text | Standard, FBA, VAS |
| `billing_category` | text | shipments, storage, etc. |
| `order_category` | text | FBA, VAS, null=standard |
| `ship_option_id` | text | ShipBob service level |
| `conditions` | jsonb | `{weight_min_oz, weight_max_oz, states, countries}` |
| `markup_type` | text | percentage, fixed |
| `markup_value` | numeric | 14.0 = 14% or $14.00 |
| `priority` | integer | Higher = applied first |
| `is_additive` | boolean | (deprecated - single rule applies) |
| `effective_from` | date | |
| `effective_to` | date | NULL = active |
| `is_active` | boolean | |

---

## Supporting Tables

### client_api_credentials
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `client_id` | uuid | FK |
| `provider` | text | "shipbob" |
| `api_token` | text | Encrypted PAT |

### fulfillment_centers
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `fc_id` | integer | ShipBob FC ID |
| `name` | text | Full name |
| `country` | text | US, CA, AU, etc. |

### products
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `client_id` | uuid | FK |
| `variants` | jsonb | Contains `inventory.inventory_id` for FC attribution |

### ship_options
| Column | Type | Notes |
|--------|------|-------|
| `id` | serial | PK |
| `ship_option_id` | integer | Unique, ShipBob ship option ID |
| `name` | text | Ship option name (e.g., "ShipBob Economy", "Ground") |
| `description` | text | Optional description |
| `is_active` | boolean | Default true |

**Known ship options:**
| ship_option_id | name |
|----------------|------|
| 3 | Ground |
| 5 | UPSGround |
| 8 | 1 Day |
| 9 | 2 Day |
| 49 | GlobalEDDPExpedited |
| 146 | ShipBob Economy |
| 160 | Walmart FBM |

---

## Key Relationships

```
clients
  ├── orders (client_id)
  │     └── shipments (order_id)
  │           ├── shipment_items (shipment_id)
  │           └── shipment_cartons (shipment_id)
  │     └── order_items (order_id)
  ├── transactions (client_id)
  ├── returns (client_id)
  ├── invoices_jetpack (client_id)
  ├── markup_rules (client_id, nullable)
  └── client_api_credentials (client_id)

transactions
  ├── reference_id → shipments.shipment_id (when reference_type='Shipment')
  ├── reference_id → returns.shipbob_return_id (when reference_type='Return')
  └── invoice_id_sb → invoices_sb.shipbob_invoice_id
```

---

## Unique Constraints

| Table | Unique Column(s) |
|-------|------------------|
| `orders` | `client_id, shipbob_order_id` |
| `shipments` | `shipment_id` |
| `transactions` | `transaction_id` |
| `returns` | `shipbob_return_id` |
| `invoices_sb` | `shipbob_invoice_id` |
| `invoices_jetpack` | `invoice_number` |
| `client_api_credentials` | `client_id, provider` |
| `care_tickets` | `ticket_number` |

---

## care_tickets

**Claims and credit requests from brands.**

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `client_id` | uuid | FK to clients |
| `ticket_number` | integer | Auto-incrementing display number |
| `ticket_type` | text | "Claim" or "Inquiry" |
| `issue_type` | text | Loss, Damage, Pick Error, Short Ship, Other |
| `status` | text | Under Review, Credit Requested, Credit Approved, Resolved |
| `shipment_id` | text | FK to shipments.shipment_id |
| `order_id` | text | FK to orders.shipbob_order_id |
| `carrier` | text | From shipment |
| `tracking_number` | text | From shipment |
| `ship_date` | date | From shipment |
| `description` | text | User's issue description |
| `reshipment_status` | text | "Please reship for me", "I've already reshipped", "Don't reship" |
| `reshipment_id` | text | If user already reshipped |
| `compensation_request` | text | "Credit to account", "Free replacement", "Refund to payment method" |
| `credit_amount` | numeric | Amount credited |
| `currency` | text | USD |
| `events` | jsonb | Timeline events array (see below) |
| `attachments` | jsonb | File attachments array |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |
| `resolved_at` | timestamptz | When status became Resolved |

### Status Flow

```
Under Review → Credit Requested → Credit Approved → Resolved
     │              │                   │              │
     │              │                   │              └── Invoice approved
     │              │                   └── Credit transaction synced
     │              └── 15 min auto-advance (cron)
     └── Claim submitted
```

### Events JSONB Structure

Events stored **newest first**:
```json
[
  { "status": "Resolved", "note": "Your credit of $45.00 has been applied to invoice #JP-2026-0015.", "createdAt": "2026-01-25T...", "createdBy": "System" },
  { "status": "Credit Approved", "note": "A credit of $45.00 has been approved...", "createdAt": "2026-01-24T...", "createdBy": "System" },
  { "status": "Credit Requested", "note": "Credit request has been sent...", "createdAt": "2026-01-23T...", "createdBy": "System" },
  { "status": "Under Review", "note": "Jetpack team is reviewing your claim request.", "createdAt": "2026-01-23T...", "createdBy": "System" }
]
```

### Issue Type Constraint

```sql
CHECK (issue_type = ANY (ARRAY['Loss', 'Damage', 'Pick Error', 'Short Ship', 'Other']))
```

**Note:** "Courtesy" is NOT an issue type - it's a credit reason. Map to "Other".

---

## lost_in_transit_checks

**Proactive tracking for at-risk shipments (Delivery IQ).**

See [CLAUDE.deliveryiq.md](CLAUDE.deliveryiq.md) for full system documentation.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `client_id` | uuid | FK to clients |
| `shipment_id` | text | FK to shipments.shipment_id |
| `tracking_number` | text | |
| `carrier` | text | |
| `is_international` | boolean | origin_country ≠ destination_country |
| `days_in_transit` | integer | Days since label created |
| `days_since_last_update` | integer | Days since last carrier scan |
| `eligible_after` | date | When claim becomes eligible |
| `claim_eligibility_status` | text | See status values below |
| `trackingmore_tracking_id` | text | TrackingMore's tracking ID |
| `first_checked_at` | timestamptz | When first added to monitoring |
| `last_recheck_at` | timestamptz | Last TrackingMore fetch |
| `last_scan_date` | timestamptz | Most recent carrier checkpoint |
| `last_scan_description` | text | Checkpoint description |
| `last_scan_location` | text | Checkpoint location |
| `created_at` | timestamptz | |

### AI Assessment Columns
| Column | Type | Notes |
|--------|------|-------|
| `ai_assessment` | jsonb | Full AI analysis response |
| `ai_assessed_at` | timestamptz | When last assessed |
| `ai_next_check_at` | timestamptz | When to reassess |
| `ai_status_badge` | text | Short status (e.g., "Delayed") |
| `ai_risk_level` | text | low, medium, high, critical |
| `ai_reshipment_urgency` | text | Recommended action urgency |
| `ai_predicted_outcome` | text | AI's prediction |

**Status Values (`claim_eligibility_status`):**
- `at_risk` - Exceeds threshold but < 15/20 days since last scan (amber badge)
- `eligible` - ≥ 15/20 days since last scan, can file claim (red badge)
- `claim_filed` - Existing claim found for shipment (gray badge)
- `missed_window` - Exceeded maximum claim window (strikethrough)

---

## transit_benchmarks

**Transit time benchmarks for Delivery IQ monitoring entry thresholds.**

See [CLAUDE.deliveryiq.md](CLAUDE.deliveryiq.md) for full system documentation.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `benchmark_type` | text | carrier_service, ship_option, international_route |
| `benchmark_key` | text | Unique key within type |
| `display_name` | text | Human-readable name |
| `zone_1_avg` through `zone_10_avg` | decimal | Average transit days per zone |
| `zone_1_count` through `zone_10_count` | integer | Sample size per zone |
| `last_calculated_at` | timestamptz | When last updated |

**Unique constraint:** `(benchmark_type, benchmark_key)`

**Benchmark Types:**
- `carrier_service` - Per-carrier averages by zone (e.g., "USPS")
- `ship_option` - Per ShipBob service level by zone (e.g., "146")
- `international_route` - Carrier + route (e.g., "DHLExpress:US:AU"), avg stored in zone_1_avg
