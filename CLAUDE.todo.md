# Billing System TODO

---

## 🔴 REMAINING - Action Required

### [ ] Canadian FC Tax Handling Strategy (Before Monday Dec 30)
**Priority**: Must resolve before next invoicing

**Problem**: `fulfillment_centers` table identifies Canadian FCs (Brampton Ontario = CA, 13% HST), but ShipBob's API is inconsistent about tax reporting.

| Fee Type | Current Handling | Status |
|----------|------------------|--------|
| Storage | We calculate 13% HST at invoice generation | ✅ Working |
| Per Pick Fee | Preflight warns but no auto-fix | ⚠️ Needs strategy |
| Shipping/Returns/Other | Not handled | ❓ TBD |

**Questions to answer**:
1. Which Additional Services fee types need Canadian tax handling?
2. For fees where GST is embedded in cost, do we back-calculate base cost?
3. Should we populate `taxes` JSONB during sync for Canadian FC transactions?
4. Does SFTP breakdown data include Canadian taxes separately?

**Files**: `lib/fulfillment-centers.ts`, `lib/billing/invoice-generator.ts`, `lib/shipbob/sync.ts`

---

### [ ] Optimize tracking_id Backfill (Low Priority)
**Context**: Third pass in `syncAllTransactions()` backfills tracking_id from shipments table.

**Issue**: Currently queries ALL transactions with `tracking_id IS NULL`. Some transaction types never have tracking (certain B2B fees). We re-check them every sync unnecessarily.

**Fix idea**: Add exclusion filter for fee types that never have shipment tracking.

---

## 📋 Reference: Tax Handling by Fee Type

| Fee Type | API Amount | Taxes in API | Current Handling |
|----------|------------|--------------|------------------|
| WRO Receiving Fee | Includes tax | Yes | ✅ Sync subtracts taxes from cost |
| Shipping | Pre-tax | Yes (Canadian) | ✅ Uses taxes column |
| Per Pick Fee (USA) | $0.26/pick | No | ✅ No tax needed |
| Per Pick Fee (Canada) | $0.25 or $0.28 | **Inconsistent** | ⚠️ Sometimes GST embedded |
| Storage (FC) | Pre-tax | No | ✅ Invoice calculates 13% GST for Brampton |
| Returns/Additional Services | Pre-tax | Yes (Canadian) | ✅ Uses taxes column |
| Credits | Pre-tax | No | ✅ No tax |

---
---

## ✅ COMPLETED

### Dec 23, 2025

| Issue | Summary | Fix |
|-------|---------|-----|
| Upsert null client_id bug | Hourly reconcile was wiping ~5K attributed transactions | Only include client_id in upsert when non-null |
| Attribution race conditions | Verified architecture is sound with 3-pass system | No changes needed |
| Supabase 1000-row limit | Preflight/invoice batches could exceed limit | Reduced batch size 200→50 shipments |
| Storage tax calculation | Brampton storage had no automatic tax handling | Invoice generator now calculates 13% HST |
| Per Pick Fee mystery | API inconsistently embeds GST in Canadian Per Pick | Documented; preflight warns |
| sync-reconcile safety | Verified calls fixed syncAllTransactions | Safe |
| Preflight validation | Added 5 data quality checks | Catches unattributed transactions, duplicates, tax issues |
| WRO Receiving Fee taxes | Taxes weren't being extracted | Sync now subtracts taxes from cost |
| Tax Type column | Missing from XLS export | Added to all 6 tabs |
| Preflight UI | Cleanup and styling | Dynamic grid layout |

### Dec 13, 2025

| Issue | Summary | Fix |
|-------|---------|-----|
| Missing base_cost (shipment 323745975) | Duplicate transactions caused SFTP sync failure | Filter by invoice_id_sb, manual backfill |
| Missing products_sold (6 shipments) | B2B/manual orders don't return quantity | Preflight skips validation for B2B/manual |
| B2B/Manual validation | Too strict for orders without store_order_id | Relaxed validation rules |

### Earlier

- Fixed receiving count (5→3) - excluded "Inventory Placement Program Fee" from WRO count
- Updated CLAUDE.md with client ID verification guidance
- Fixed tracking_id coverage for Per Pick Fee transactions
