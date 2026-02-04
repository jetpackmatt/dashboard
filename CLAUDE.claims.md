# Claims & Care Tickets System

**Read this when:** Working on the claims submission feature, care tickets, credit handling, or the claim lifecycle.

---

## Overview

The Care Tickets system handles fulfillment issues and credit requests. There are two sources:

1. **Claims** - Submitted by brands via the dashboard (Lost in Transit, Damage, etc.)
2. **Historic Credits** - Backfilled from ShipBob credit transactions

Both feed into the `care_tickets` table and follow the same lifecycle.

---

## Care Ticket Lifecycle ✅ Implemented (Jan 2026)

### Status Flow

| Step | Status | Trigger | Note Template |
|------|--------|---------|---------------|
| 1 | **Under Review** | Claim submitted | "Jetpack team is reviewing your claim request." |
| 2 | **Credit Requested** | 15 min auto-advance | "Credit request has been sent to the warehouse team for review." |
| 3 | **Credit Approved** | Credit transaction synced | "A credit of $XX.XX has been approved and will appear on your next invoice." |
| 4 | **Resolved** | Invoice approved | "Your credit of $XX.XX has been applied to invoice #XXXX." |

### Events JSONB Array

Events are stored in `care_tickets.events` as a JSONB array, **newest first**:

```typescript
{
  events: [
    { status: "Resolved", note: "Your credit of $45.00 has been applied to invoice #JP-2026-0015.", createdAt: "2026-01-25T...", createdBy: "System" },
    { status: "Credit Approved", note: "A credit of $45.00 has been approved and will appear on your next invoice.", createdAt: "2026-01-24T...", createdBy: "System" },
    { status: "Credit Requested", note: "Credit request has been sent to the warehouse team for review.", createdAt: "2026-01-23T...", createdBy: "System" },
    { status: "Under Review", note: "Jetpack team is reviewing your claim request.", createdAt: "2026-01-23T...", createdBy: "System" },
  ]
}
```

### Automation

| Cron | Schedule | Purpose |
|------|----------|---------|
| `/api/cron/advance-claims` | Every 5 min | Advances "Under Review" → "Credit Requested" after 15 minutes |
| `syncAllTransactions()` Fifth Pass | Per-minute sync | Advances "Credit Requested" → "Credit Approved" when credit transaction appears |
| `/api/admin/invoices/[id]/approve` | Manual | Advances "Credit Approved" → "Resolved" when invoice is approved |

---

## Issue Types

**Allowed values:** `Loss`, `Damage`, `Pick Error`, `Short Ship`, `Other`

| UI Label | `issue_type` value | Eligibility |
|----------|-------------------|-------------|
| Lost in Transit | `Loss` | 15 days inactivity (domestic) / 20 days (international) |
| Damage | `Damage` | Package delivered |
| Incorrect Items | `Pick Error` | Package delivered |
| Incorrect Quantity | `Short Ship` | Package delivered |
| Other | `Other` | Always eligible |

**IMPORTANT:** "Courtesy" is NOT an issue type - it's a credit reason. Historic Courtesy credits use `issue_type = 'Other'`.

---

## Claim Submission Flow

### Step 1: Shipment Selection
- From shipment drawer: Pre-filled
- From global button: Search/enter shipment ID

### Step 2: Issue Category
Options: Lost in Transit, Damage, Incorrect Items, Incorrect Quantity
*Each checks eligibility before proceeding*

### Step 3: Issue Description
Textarea (required)

### Step 4: Reshipping Options (Damage/Pick Error/Short Ship only)
- Please reship for me
- I've already reshipped
- Don't reship

### Step 5: Reshipment ID (if "I've already reshipped")
Number input (optional)

### Step 6: Compensation Method
- Credit to account
- Free replacement
- Refund to payment method

### Step 7: Supporting Documentation
File upload (required for Damage claims)

### Step 8: Confirmation & Submit

---

## Eligibility Rules

**"Last tracking update"** = Most recent carrier checkpoint from TrackingMore API, or fallback to `event_intransit`, `event_outfordelivery`, `event_delivered` columns.

**Domestic vs International:**
- `origin_country === destination_country` → Domestic (15 day threshold)
- Otherwise → International (20 day threshold)

| Claim Type | Requirement |
|------------|-------------|
| Lost in Transit | ≥15/20 days since last carrier scan |
| Damage | `event_delivered IS NOT NULL` |
| Incorrect Items | `event_delivered IS NOT NULL` |
| Incorrect Quantity | `event_delivered IS NOT NULL` |

---

## Transaction → Care Ticket Linking

When `syncAllTransactions()` syncs a Credit transaction:

1. **Fifth Pass** looks for care_tickets where:
   - `shipment_id` matches the credit's `reference_id`
   - `status = 'Credit Requested'`

2. If found, advances to "Credit Approved":
   ```typescript
   const approvedEvent = {
     note: `A credit of ${creditAmount.toFixed(2)} has been approved and will appear on your next invoice.`,
     status: 'Credit Approved',
     createdAt: new Date().toISOString(),
     createdBy: 'System',
   }
   ```

3. Updates `care_tickets.credit_amount` from the transaction

---

## Invoice Approval → Resolved

When `/api/admin/invoices/[invoiceId]/approve` is called:

1. Finds credit transactions on the invoice
2. Gets their `reference_id` (shipment_ids)
3. Finds care_tickets with:
   - `shipment_id` in those reference_ids
   - `status = 'Credit Approved'`

4. Advances to "Resolved":
   ```typescript
   const resolvedEvent = {
     note: `Your credit of ${creditAmount.toFixed(2)} has been applied to invoice ${invoice.invoice_number}.`,
     status: 'Resolved',
     createdAt: new Date().toISOString(),
     createdBy: 'System',
   }
   ```

---

## File Attachments

**Storage:** Supabase Storage bucket `claim-attachments`

**Structure:**
```
claim-attachments/
  {client_id}/
    {ticket_id}/
      {filename}
```

**`care_tickets.attachments` JSONB:**
```json
[
  {
    "name": "damaged-box.jpg",
    "url": "https://...supabase.co/storage/v1/object/...",
    "size": 245000,
    "type": "image/jpeg",
    "uploadedAt": "2026-01-25T..."
  }
]
```

---

## Historic Credits Backfill

Scripts for importing historic credits as resolved care_tickets:

| Script | Purpose |
|--------|---------|
| `scripts/backfill-historic-credits.js` | Creates care_tickets from Excel export of historic credits |
| `scripts/fix-historic-credit-events.js` | Rebuilds event timelines with proper status flow |
| `scripts/fix-courtesy-credits-resolved.js` | Adds Resolved event to Courtesy credits missing it |

**Credit Reason → Issue Type mapping:**
```javascript
const REASON_TO_ISSUE_TYPE = {
  'Claim for Lost Order': 'Loss',
  'Claim for Damaged Order': 'Damage',
  'Picking Error': 'Pick Error',
  'Courtesy': 'Other',           // NOT an issue type!
  'Courtesy - Orders': 'Other',
  'No Carrier Tracking': 'Loss',
  'Delivered Not Arrived': 'Loss',
  'Delayed Order/ShipBob': 'Other',
  'Order Swap Error': 'Pick Error',
  'Damaged Inventory': 'Damage',
}
```

---

## At-Risk Shipment Tracking (Proactive Claims)

Proactively identifies shipments that may be Lost in Transit BEFORE customers file claims.

### How It Works

1. **Daily sync** (`/api/cron/sync-at-risk`): Finds shipments that are:
   - NOT delivered
   - 15+ days since label creation
   - Creates TrackingMore tracking ($0.04 each)

2. **Frequent recheck** (`/api/cron/recheck-at-risk`): Every 5 hours
   - FREE GET requests to TrackingMore
   - Updates eligibility status based on days since last checkpoint

### Status Values (`lost_in_transit_checks.claim_eligibility_status`)

| Status | Meaning | UI Badge |
|--------|---------|----------|
| `at_risk` | Meets criteria but < 15/20 days since last scan | Amber "At Risk" |
| `eligible` | ≥ 15/20 days since last scan, can file claim | Red "File a Claim" (clickable) |

---

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/data/care-tickets` | GET | List care tickets with filters |
| `/api/data/care-tickets` | POST | Create new care ticket/claim |
| `/api/data/shipments/[id]/claim-eligibility` | GET | Check eligibility for all claim types |
| `/api/data/shipments/[id]/verify-lost-in-transit` | POST | Verify via TrackingMore before submitting |
| `/api/upload/claim-attachment` | POST | Upload file to Supabase Storage |

---

## Key Files

| File | Purpose |
|------|---------|
| `app/dashboard/care/page.tsx` | Care page UI (tickets list, filters, details) |
| `app/api/data/care-tickets/route.ts` | Care tickets CRUD API |
| `app/api/cron/advance-claims/route.ts` | 15-minute auto-advance cron |
| `lib/shipbob/sync.ts` | Fifth Pass: Credit → Care Ticket linking |
| `app/api/admin/invoices/[id]/approve/route.ts` | Credit Approved → Resolved on invoice approval |
| `components/claims/claim-submission-dialog.tsx` | Multi-step claim form |
| `components/shipment-details-drawer.tsx` | Shipment drawer with claim button |

---

## Database Columns (care_tickets)

| Column | Type | Purpose |
|--------|------|---------|
| `ticket_number` | int | Auto-incrementing display number |
| `ticket_type` | text | "Claim" or "Inquiry" |
| `issue_type` | text | Loss, Damage, Pick Error, Short Ship, Other |
| `status` | text | Under Review, Credit Requested, Credit Approved, Resolved |
| `shipment_id` | text | FK to shipments |
| `credit_amount` | decimal | Amount credited |
| `events` | jsonb | Timeline events array (newest first) |
| `attachments` | jsonb | File attachments array |
| `resolved_at` | timestamp | When status became Resolved |

---

## Security

1. **Client Access Verification** - All endpoints use `verifyClientAccess()`
2. **File Upload Validation** - Check file types, sizes (max 10MB)
3. **Shipment Ownership** - Verify user's client owns the shipment before allowing claim
