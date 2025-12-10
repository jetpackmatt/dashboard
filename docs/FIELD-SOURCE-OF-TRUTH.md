# Field Source of Truth

**Created:** December 8, 2025
**Purpose:** Definitive mapping of what fields are needed, where they come from, and current population status.

---

## How Invoice Generator Gets Data

The invoice generator (`lib/billing/invoice-generator.ts`) uses this data flow:

```
1. Query transactions table (filter by client_id + invoice_id_sb)
2. For Shipment transactions → JOIN to shipments table (via reference_id = shipment_id)
3. For shipments → JOIN to orders table (via order_id)
4. For shipments → JOIN to shipment_items table (for products_sold)
5. For Return transactions → JOIN to returns table (via reference_id = shipbob_return_id)
```

**Key Insight:** The invoice generator JOINs to related tables. It does NOT rely on denormalized fields in transactions (except for fallbacks).

---

## TRANSACTIONS Table

### Fields DIRECTLY Used from transactions

| Field | Used For | Source | Current % | Notes |
|-------|----------|--------|-----------|-------|
| `client_id` | Filter & attribution | Sync attribution logic | 99.9% | Critical |
| `cost` | Base amount for billing | Billing API | 100% | Critical |
| `charge_date` | Transaction date (fallback) | Billing API | 100% | Used if event_labeled missing |
| `transaction_fee` | Categorization (Shipping, Credit, etc.) | Billing API | 100% | Critical |
| `transaction_type` | Refund detection | Billing API | ~100% | Refund vs Charge |
| `reference_type` | Categorization (Shipment, FC, Return) | Billing API | 100% | Critical |
| `reference_id` | JOIN key to shipments/returns | Billing API | 100% | Critical |
| `invoice_id_sb` | Filter by SB invoice | Billing API | 99% | Critical |
| `fulfillment_center` | FC name (fallback) | Billing API | 86% | Used if shipment lookup fails |
| `additional_details` | Various fallback fields | Billing API (JSONB) | ~100% | Contains OrderCategory, etc. |
| `transaction_id` | ULID timestamp decoding | Billing API | 100% | For Credits timestamps |

### Fields from transactions that ARE fallbacks (not primary)

| Field | Primary Source | Fallback From | Current % | Recommendation |
|-------|----------------|---------------|-----------|----------------|
| `tracking_id` | shipments.tracking_id | transactions.additional_details.TrackingId | 3.6% | **Don't rely on this** |
| `base_cost` | SFTP file | N/A | 45% | Needed for shipping breakdown |
| `surcharge` | SFTP file | N/A | 45% | Needed for shipping breakdown |
| `insurance_cost` | SFTP file | N/A | 45% | Needed for shipping breakdown |

### Fields ONLY used for Jetpack invoicing (set at invoice time)

| Field | Purpose | When Set | Current % |
|-------|---------|----------|-----------|
| `invoiced_status_jp` | Mark as billed | On approval | 94% |
| `invoice_id_jp` | Link to our invoice | On approval | 94% |
| `invoice_date_jp` | When we billed | On approval | **0%** (BUG) |
| `markup_applied` | $ markup | On generation | 94% |
| `markup_percentage` | % markup | On generation | 94% |
| `markup_rule_id` | Which rule matched | On generation | **2%** (BUG) |
| `billed_amount` | Final amount | On generation | 94% |

---

## SHIPMENTS Table

### Fields Used by Invoice Generator (via JOIN)

| Field | Used For | Source | Current % | Notes |
|-------|----------|--------|-----------|-------|
| `shipment_id` | JOIN key from transactions | Orders API | 100% | Critical |
| `tracking_id` | Carrier tracking number | Orders API | **96.8%** | Primary source |
| `carrier` | Carrier name | Orders API | 96.8% | |
| `carrier_service` | Service level name | Orders API | 100% | |
| `ship_option_id` | For markup rules | Orders API | 99.5% | |
| `zone_used` | Shipping zone | Orders API | 96.5% | |
| `actual_weight_oz` | Actual weight | Orders API | 97.2% | |
| `dim_weight_oz` | Dimensional weight | Orders API (calculated) | 97.2% | |
| `billable_weight_oz` | max(actual, dim) | Orders API (calculated) | 97.2% | |
| `length`, `width`, `height` | Package dims | Orders API | 97.2% | |
| `fc_name` | Fulfillment center | Orders API | 97% | |
| `order_id` | JOIN to orders | Orders API | 100% | |
| `event_created` | Order created timestamp | Timeline API | **43%** | For Transaction Date |
| `event_labeled` | Label gen timestamp | Timeline API | **41%** | **Primary Transaction Date** |
| `event_delivered` | Delivered timestamp | Timeline API | **37%** | Primary for delivered_date |
| `delivered_date` | Delivered (fallback) | Orders API | 91% | Fallback if event_delivered missing |
| `transit_time_days` | Transit calculation | Calculated from events | N/A | Or calculate from event_intransit → event_delivered |
| `event_intransit` | Transit start | Timeline API | ~40% | For transit_time_days |

### Fields NOT Used by Invoice Generator

| Field | Purpose | Notes |
|-------|---------|-------|
| `status` | Dashboard display only | |
| `tracking_url` | Dashboard display only | |
| `recipient_*` | Dashboard display only | |
| `package_material_type` | Not currently used | |
| `gift_message` | Not currently used | |

---

## ORDERS Table

### Fields Used by Invoice Generator (via JOIN from shipments)

| Field | Used For | Source | Current % | Notes |
|-------|----------|--------|-----------|-------|
| `id` | JOIN key | Orders API | 100% | |
| `shipbob_order_id` | Order ID display | Orders API | 100% | |
| `store_order_id` | Store's order # | Orders API | 99.4% | |
| `customer_name` | Customer name | Orders API | 100% | |
| `channel_name` | Channel name | Orders API | 99.99% | |
| `application_name` | Integration name | Orders API | 99.99% | |
| `zip_code` | Destination | Orders API | 99.99% | |
| `city` | Destination | Orders API | 99.99% | |
| `state` | Destination | Orders API | 99% | |
| `country` | Destination | Orders API | 100% | |
| `order_type` | FBA/VAS/Standard | Orders API | 100% | For order_category |

---

## RETURNS Table

### Fields Used by Invoice Generator (via JOIN)

| Field | Used For | Source | Current % | Notes |
|-------|----------|--------|-----------|-------|
| `shipbob_return_id` | JOIN key from transactions | Returns API | 100% | |
| `insert_date` | Transaction date | Returns API | 100% | Full timestamp |
| `status` | Return status | Returns API | 100% | |
| `return_type` | Return type | Returns API | 100% | |
| `customer_name` | Customer | Returns API | 100% | |
| `store_order_id` | Original order | Returns API | 100% | |
| `fc_name` | FC name | Returns API | 100% | |
| `tracking_number` | Return tracking | Returns API | 100% | |

---

## SHIPMENT_ITEMS Table

### Fields Used by Invoice Generator

| Field | Used For | Source | Current % | Notes |
|-------|----------|--------|-----------|-------|
| `shipment_id` | JOIN key | Orders API | 100% | |
| `name` | Product name | Orders API | 100% | |
| `quantity` | Qty per product | Orders API | **12%** | Falls back to order_items |

---

## ORDER_ITEMS Table (Fallback)

### Fields Used (when shipment_items.quantity is NULL)

| Field | Used For | Source | Current % |
|-------|----------|--------|-----------|
| `order_id` | JOIN key | Orders API | 100% |
| `name` | Product name | Orders API | **0%** (never populated) |
| `quantity` | Qty | Orders API | 100% |

---

## SUMMARY: What's Actually Broken

### Critical Issues (Blocking Invoicing)

1. **`transactions.invoice_date_jp`** - Never set (0%)
   - **Impact:** Can't track when we billed
   - **Fix:** Update approval flow to set this

2. **`transactions.markup_rule_id`** - Rarely set (2%)
   - **Impact:** Can't trace which rule was applied
   - **Fix:** Update invoice generation to set this

3. **`transactions.base_cost/surcharge`** - 45% populated
   - **Impact:** Can't show shipping breakdown
   - **Fix:** Process SFTP files

### Important Issues (Affecting Invoice Quality)

4. **`shipments.event_labeled`** - 41% populated
   - **Impact:** Transaction dates fallback to charge_date instead of label timestamp
   - **Fix:** Timeline API backfill

5. **`shipments.event_delivered`** - 37% populated
   - **Impact:** Delivered dates fallback to delivered_date
   - **Fix:** Timeline API backfill

6. **`shipment_items.quantity`** - 12% populated
   - **Impact:** Falls back to order_items (works, just indirect)
   - **Fix:** Check Orders API response for quantity field

### NOT Issues (Despite Looking Like It)

7. **`transactions.tracking_id`** - 3.6%
   - **NOT a problem** because invoice generator JOINs to shipments.tracking_id (96.8%)
   - Denormalizing would be nice-to-have but not required

8. **`order_items.name`** - 0%
   - **NOT a problem** because shipment_items.name IS populated (100%)
   - order_items is only used for quantity fallback

---

## RECOMMENDED FIX ORDER

### Phase 1: Fix the Bugs (Quick)
1. Fix `invoice_date_jp` not being set on approval
2. Fix `markup_rule_id` not being stored on generation

### Phase 2: Backfill Timeline Events (Medium)
3. Run Timeline API backfill for historical shipments
4. Verify event_labeled and event_delivered populate going forward

### Phase 3: SFTP Processing (When Ready)
5. Create SFTP processor for base_cost/surcharge/insurance_cost
6. Backfill historical SFTP files

### Phase 4: Cleanup (Optional)
7. Remove unused tables (webhook_events, credential_access_log, credits)
8. Clean up middleware.ts webhook reference
9. Consider whether to denormalize tracking_id to transactions (convenience, not required)

---

## VERIFICATION QUERIES

### Check Invoice-Critical Fields
```sql
SELECT
  COUNT(*) as total,
  COUNT(client_id) as has_client,
  COUNT(invoice_id_sb) as has_sb_invoice,
  COUNT(cost) as has_cost,
  COUNT(charge_date) as has_date,
  COUNT(reference_id) as has_reference
FROM transactions
WHERE invoiced_status_jp IS NOT TRUE;
```

### Check Shipment JOIN Fields
```sql
SELECT
  COUNT(*) as total,
  COUNT(tracking_id) as has_tracking,
  COUNT(event_labeled) as has_event_labeled,
  COUNT(event_delivered) as has_event_delivered,
  COUNT(carrier) as has_carrier,
  COUNT(zone_used) as has_zone
FROM shipments
WHERE deleted_at IS NULL;
```

### Check Transaction → Shipment JOIN Success
```sql
SELECT
  COUNT(*) as total_shipment_tx,
  COUNT(s.shipment_id) as found_in_shipments,
  COUNT(s.tracking_id) as has_tracking_via_join
FROM transactions t
LEFT JOIN shipments s ON t.reference_id = s.shipment_id
WHERE t.reference_type = 'Shipment';
```
