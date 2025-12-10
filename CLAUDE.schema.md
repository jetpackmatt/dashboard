# Database Schema

**Read this when:** Working with database queries, migrations, or understanding table relationships.

**Source:** Queried directly from Supabase (Dec 2025)

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
| `billing_email` | text | Invoice recipient |
| `billing_terms` | text | due_on_receipt, net_15, etc. |
| `billing_address` | jsonb | Address for PDF |
| `next_invoice_number` | integer | Auto-incrementing sequence |
| `billing_period` | text | weekly, monthly |
| `billing_currency` | text | USD |

**System Clients (`is_internal=true`):**
- "ShipBob Payments" - ACH payment transactions
- "Jetpack Costs" - Parent-level fees

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
| `carrier_service` | text | ShipBob Economy, Ground, etc. |
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
| `surcharge` | numeric | DAS, fuel, etc. from SFTP |
| `insurance_cost` | numeric | Insurance from SFTP |

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
| `status` | text | draft, approved, sent, paid |
| `pdf_path`, `xlsx_path` | text | Storage paths |
| `generated_at` | timestamptz | |
| `approved_by` | uuid | FK to auth.users |
| `approved_at` | timestamptz | |
| `shipbob_invoice_ids` | jsonb | Array of SB invoice IDs |
| `line_items_json` | jsonb | Snapshot for regeneration |

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
