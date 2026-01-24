# Claims Submission System

**Read this when:** Working on the claims submission feature, claim eligibility logic, or the Submit Claim workflow.

---

## Overview

The Claims Submission System allows brands to submit claims for fulfillment issues directly from the dashboard. Claims are submitted via:

1. **Global "Submit a Claim" button** - Bottom left of dashboard (all pages)
2. **In-context buttons** - In the Shipment Details slideout (Transactions > Shipments)

Claims feed into the existing Care Tickets system (`care_tickets` table).

---

## Claim Types & Eligibility

### Claim Types

| UI Label | Care Ticket `issue_type` | Eligibility Requirement |
|----------|-------------------------|------------------------|
| Lost in Transit | `Loss` | 15 days inactivity (domestic) OR 20 days (international) |
| Damage | `Damage` | Package delivered |
| Incorrect Items | `Pick Error` | Package delivered |
| Incorrect Quantity | `Short Ship` | Package delivered |

### Eligibility Rules

**"Last tracking update"** = Most recent carrier tracking event from `event_logs` (log_type_ids: 607, 608, 609, 611) or fallback to `event_intransit`, `event_outfordelivery`, `event_delivered` columns.

**Domestic vs International:**
- `shipments.origin_country === shipments.destination_country` → Domestic
- Otherwise → International

| Claim Type | Domestic Shipment | International Shipment |
|------------|-------------------|----------------------|
| Lost in Transit | ≥15 days since last tracking update | ≥20 days since last tracking update |
| Damage | `event_delivered IS NOT NULL` | `event_delivered IS NOT NULL` |
| Incorrect Items | `event_delivered IS NOT NULL` | `event_delivered IS NOT NULL` |
| Incorrect Quantity | `event_delivered IS NOT NULL` | `event_delivered IS NOT NULL` |

### Eligibility Error Messages

**Lost in Transit (not eligible):**
> "Lost in Transit claims can only be submitted after 15 days of inactivity for domestic shipments, or 20 days for international shipments. Please come back to file if the situation isn't resolved by then."

**Damage/Incorrect Items/Incorrect Quantity (not delivered):**
> "This claim type can only be submitted after the package has been delivered."

---

## Form Flow (Based on Typeform)

### Step 1: Shipment Selection
- If opened from shipment drawer: Pre-filled with shipment ID
- If opened from global button: Search/enter shipment ID

### Step 2: Issue Category
**Question:** "What seems to be the trouble?"
**Options:**
- Lost in Transit
- Damage
- Incorrect Items
- Incorrect Quantity

*Each option checks eligibility before proceeding*

### Step 3: Issue Description
**Question:** "Please describe the issue"
**Helper:** "Include relevant context, descriptions, or communications with customer."
**Type:** Textarea (required)

### Step 4: Reshipping Options (Damage, Incorrect Items, Incorrect Quantity only)
**Question:** "Reshipping Options"
**Helper:** "Reshipments eligible for credit only if picking error"
**Options:**
- Please reship for me
- I've already reshipped
- Don't reship

### Step 5: Reshipment ID (if "I've already reshipped")
**Question:** "Please enter the Shipment ID of your reshipment"
**Type:** Number input (optional)

### Step 6: Compensation Method (Damage, Incorrect Items, Incorrect Quantity)
**Question:** "How should we compensate you?"
**Options:**
- Credit to account
- Free replacement
- Refund to payment method

### Step 7: Supporting Documentation
**Question:** "Upload supporting images or files"
**Helper:** "Photos/screenshots required. Examples: damaged shipment photos, customer messages, PDFs"
**Type:** File upload (required for Damage claims)

### Step 8: Confirmation
- Show summary of claim
- Submit button
- Success message with ticket number

---

## Data Model

### New Fields for care_tickets (if not present)

The existing `care_tickets` table already has most fields needed:

| Field | Usage |
|-------|-------|
| `ticket_type` | Always "Claim" for this flow |
| `issue_type` | Loss, Damage, Pick Error, Short Ship |
| `shipment_id` | From form |
| `order_id` | Derived from shipment lookup |
| `carrier` | Derived from shipment lookup |
| `tracking_number` | Derived from shipment lookup |
| `ship_date` | Derived from shipment lookup |
| `description` | User's issue description |
| `reshipment_status` | "Please reship for me", "I've already reshipped", "Don't reship" |
| `what_to_reship` | (May not be needed - derived from shipment items) |
| `reshipment_id` | If user already reshipped |
| `compensation_request` | "Credit to account", "Free replacement", "Refund to payment method" |

### Potential New Fields

```sql
-- Attachments storage (if not using existing mechanism)
ALTER TABLE care_tickets ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]';

-- Claim eligibility metadata (for audit trail)
ALTER TABLE care_tickets ADD COLUMN IF NOT EXISTS eligibility_metadata JSONB;
-- Example: { "daysSinceLastUpdate": 18, "isInternational": false, "lastTrackingEvent": "2025-01-05T14:30:00Z" }
```

---

## UI Components

### 1. Global Submit Claim Button

**Location:** Bottom-left of dashboard layout (all pages)
**Component:** `components/submit-claim-button.tsx`

```
┌─────────────────────┐
│  📋 Submit a Claim  │  ← Button with dropdown
└─────────────────────┘
         │
         ▼
┌─────────────────────┐
│ Lost in Transit     │
│ Damage              │
│ Incorrect Items     │
│ Incorrect Quantity  │
└─────────────────────┘
```

### 2. Shipment Drawer Claim Section

**Location:** Top of shipment details drawer, after status badge area
**Visibility:** Only when claim-eligible OR to show eligibility status

```
┌─────────────────────────────────────────────────────┐
│ Shipment - 338703744  [In Transit]            [X]  │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │ Submit a Claim              [▾ Select Type] │   │  ← NEW SECTION
│  │                                             │   │
│  │ Last tracking: 5 days ago • Domestic        │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  [Progress Timeline...]                             │
```

### 3. Claim Submission Modal/Dialog

**Component:** `components/claims/claim-submission-dialog.tsx`

Multi-step form dialog:
- Step indicator at top
- Back/Next navigation
- Form fields per step
- Submit on final step

---

## API Endpoints

### POST /api/data/care-tickets (existing)
Already supports creating care tickets. Claims use this with:
```typescript
{
  clientId: string,
  ticketType: "Claim",
  issueType: "Loss" | "Damage" | "Pick Error" | "Short Ship",
  shipmentId: string,
  // ... other fields auto-populated from shipment lookup
}
```

### GET /api/data/shipments/[id]/claim-eligibility (new)
Returns eligibility status for all claim types:
```typescript
{
  shipmentId: string,
  isDelivered: boolean,
  lastTrackingUpdate: string | null,
  daysSinceLastUpdate: number | null,
  isInternational: boolean,
  eligibility: {
    lostInTransit: { eligible: boolean, reason?: string },
    damage: { eligible: boolean, reason?: string },
    incorrectItems: { eligible: boolean, reason?: string },
    incorrectQuantity: { eligible: boolean, reason?: string }
  }
}
```

---

## File Upload Strategy

Options:
1. **Supabase Storage** - Direct upload to Supabase bucket
2. **Vercel Blob** - Simple blob storage
3. **Google Drive** (current Typeform approach) - Requires OAuth

**Recommended:** Supabase Storage
- Already using Supabase
- Simple integration
- RLS for security
- Can generate signed URLs for download

---

## Implementation Phases

### Phase 1: Core Infrastructure
- [ ] Add `eligibility_metadata` and `attachments` columns to care_tickets (if needed)
- [ ] Create `/api/data/shipments/[id]/claim-eligibility` endpoint
- [ ] Create `lib/claims/eligibility.ts` with eligibility logic

### Phase 2: Global Submit Claim Button
- [ ] Create `components/claims/submit-claim-button.tsx`
- [ ] Create `components/claims/claim-submission-dialog.tsx`
- [ ] Add button to dashboard layout (`app/dashboard/layout.tsx`)

### Phase 3: Shipment Drawer Integration
- [ ] Add claim section to `shipment-details-drawer.tsx`
- [ ] Pre-fill shipment data when opening from drawer
- [ ] Show eligibility status

### Phase 4: File Upload
- [ ] Create Supabase storage bucket for claim attachments
- [ ] Create upload component with drag-and-drop
- [ ] Store attachment URLs in care_tickets.attachments

### Phase 5: Polish & Testing
- [ ] Form validation
- [ ] Error handling
- [ ] Success notifications
- [ ] Mobile responsiveness

---

## Security Considerations

1. **Client Access Verification** - Use `verifyClientAccess()` for all endpoints
2. **File Upload Validation** - Check file types, sizes
3. **Rate Limiting** - Prevent spam submissions
4. **Shipment Ownership** - Verify user owns the shipment before allowing claim

---

## Related Files

| File | Purpose |
|------|---------|
| `CLAUDE.claims.md` | This documentation |
| `app/dashboard/care/page.tsx` | Existing Care page (tickets display) |
| `app/api/data/care-tickets/route.ts` | Care tickets API |
| `components/shipment-details-drawer.tsx` | Shipment drawer (add claim button here) |
| `lib/claims/eligibility.ts` | (NEW) Claim eligibility logic |
| `components/claims/submit-claim-button.tsx` | (NEW) Global claim button |
| `components/claims/claim-submission-dialog.tsx` | (NEW) Claim form dialog |
