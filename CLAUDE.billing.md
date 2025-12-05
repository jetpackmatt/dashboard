# Billing & Invoicing System

**Read this when:** Working on markup rules, invoice generation, billing workflows, or admin billing features.

---

## Overview

Jetpack bills clients for fulfillment services by:
1. **Receiving costs from ShipBob** (our 3PL partner) via billing tables
2. **Applying markups** per transaction type, client, and conditions
3. **Generating weekly invoices** (PDFs + XLS) for client approval
4. **Managing approval workflow** for admin review before client delivery

---

## Database Schema

### Table Naming Convention
| Table | Purpose |
|-------|---------|
| `invoices_shipbob` | ShipBob's invoices to us (renamed from `invoices`) |
| `invoices_jetpack` | Our invoices to clients |
| `invoices_jetpack_line_items` | Line items linking transactions to Jetpack invoices |
| `markup_rules` | Markup configuration with history via effective dates |
| `markup_rule_history` | Audit trail for markup changes |

### Client Billing Fields (added to `clients` table)
```sql
ALTER TABLE clients ADD COLUMN short_code TEXT;  -- 2-3 char code (HS, ML)
ALTER TABLE clients ADD COLUMN billing_period TEXT DEFAULT 'weekly';  -- weekly, bi-weekly, tri-weekly, monthly
ALTER TABLE clients ADD COLUMN billing_terms TEXT DEFAULT 'due_on_receipt';  -- due_on_receipt, 7_days, 14_days, 30_days
ALTER TABLE clients ADD COLUMN invoice_email_note TEXT;  -- Custom invoice email text
ALTER TABLE clients ADD COLUMN next_invoice_number INTEGER DEFAULT 1;  -- Auto-incrementing per client
ALTER TABLE clients ADD COLUMN billing_email TEXT;  -- Where to send invoices
```

**Current Client Data:**
| Client | Short Code | Next Invoice # |
|--------|------------|----------------|
| Henson | HS | 38 |
| Methyl-Life | ML | 22 |

---

## Invoice Number Format

Format: `JP{SHORT_CODE}-{NNNN}-{MMDDYY}`

Examples:
- `JPHS-0038-120825` = Jetpack Henson invoice #38, Dec 8, 2025
- `JPML-0022-120825` = Jetpack Methyl-Life invoice #22, Dec 8, 2025

**Regenerated invoices:** Append `-v2`, `-v3`, etc.
- `JPHS-0038-120825-v2` = Revised version

---

## Markup System

### Markup Rules Table (existing)
```sql
markup_rules:
  - client_id: NULL = all clients, UUID = specific client
  - fee_type: Transaction type to match
  - ship_option_id: Optional shipping service filter
  - conditions: JSONB for complex rules (weight, state, etc.)
  - markup_type: 'percentage' | 'fixed'
  - markup_value: Decimal value
  - priority: Higher = applied first
  - is_additive: If true, stacks with other rules
  - effective_from/to: Date range for versioning
```

### Transaction Types by Category

**billing_shipments** (order_category field):
| Category | Count | Description | Markup Strategy |
|----------|-------|-------------|-----------------|
| NULL | 68,761 | Standard shipments | By ship_option + weight bracket |
| FBA | 115 | Fulfillment by Amazon | Different markup rate |
| VAS | 5 | Value Added Services | Different markup rate |

**Weight Brackets for Standard Shipments:**
- `<8oz` - Lightest tier
- `8-16oz` - Light tier
- `1-5lbs` - Medium tier
- `5-10lbs` - Heavy tier
- `10-15lbs` - Extra heavy
- `20+lbs` - Freight tier

**billing_shipment_fees** (fee_type field):
| Fee Type | Count | Notes |
|----------|-------|-------|
| Per Pick Fee | 50,463 | Most common |
| B2B - Label Fee | 300 | B2B specific |
| B2B - Each Pick Fee | 290 | B2B specific |
| B2B - Case Pick Fee | 114 | B2B specific |
| B2B - Order Fee | 50 | B2B specific |
| B2B - Supplies | 39 | B2B specific |
| Address Correction | 35 | Carrier charge |
| Inventory Placement | 28 | Amazon program |
| URO Storage Fee | 27 | Unshippable inventory |
| B2B - Pallet Pack/Material | 12 | B2B specific |
| VAS - Paid Requests | 2 | Custom work |
| Kitting Fee | 1 | Assembly |

**billing_storage** (location_type field):
| Type | Count | Typical Rate |
|------|-------|--------------|
| Pallet | 5,516 | $30-40/month |
| Shelf | 2,983 | $10/month |
| Bin | 1,431 | $3/month |
| HalfPallet | 3 | $15/month |

**billing_credits** (credit_reason field):
| Reason | Count | Markup? |
|--------|-------|---------|
| Claim for Lost Order | 221 | See below |
| Picking Error | 40 | Pass-through |
| Courtesy | 35 | Pass-through |
| Claim for Damaged Order | 29 | See below |
| Others | 9 | Pass-through |

**billing_returns** (transaction_type field):
| Type | Count |
|------|-------|
| Return to sender - Processing | 123 |
| Return Processed by Operations | 73 |
| Return Label | 4 |
| Credit | 1 |

**billing_receiving** (transaction_type field):
| Type | Count |
|------|-------|
| Charge | 116 |

---

## Credits Handling (Special Case)

Credits are complex because they may contain:
1. **Product reimbursement only** - Pass through at 0% markup
2. **Shipping charge refund only** - Apply SAME markup as original shipment
3. **Combined** - Split and apply markup only to shipping portion

**Rules:**
- Max credit: -$100
- Need to link credit to original shipment via `reference_id`
- Look up original shipment's `billed_amount` vs `amount` to determine markup used
- Apply same markup to shipping portion of credit

**Discovery Required:**
- Can we identify shipping portion from credit details?
- Can we link to original transaction via tracking/order ID?

---

## Storage Billing (Special Case)

Storage billing intervals vary by client:
- **Monthly:** 1st Monday after 1st of month
- **Semi-monthly:** Also 1st Monday after 15th
- **Weekly:** Every Monday

**Key Rule:** If storage transactions exist for a given week, include them. If not, no storage line item.

**PDF Requirement:** Always show billing period in line item:
- "Storage (Nov 1 - Nov 15, 2025)"
- "Storage (Nov 1 - Nov 30, 2025)"

---

## Invoice Generation

### Weekly Schedule
- **When:** Mondays at 5am PT (Vercel Cron)
- **Status:** Generates as "draft"
- **Regeneration window:** 24 hours only

### Invoice Statuses
| Status | Description |
|--------|-------------|
| `draft` | Just generated, pending review |
| `pending_approval` | Under admin review |
| `approved` | Finalized, sent to client |
| `regenerated` | Replaced by newer version |

### Regeneration Rules
- Only within 24 hours of creation
- Adds `-v2`, `-v3` suffix
- Original marked as `regenerated`
- Email includes bold warning about correction

### Invoice Email Content
1. Default template with PDF attached
2. Optional custom note per client (`clients.invoice_email_note`)
3. If past-due invoices exist: Add warning paragraph
4. If regenerated: Add bold correction notice

---

## File Storage

**Location:** Supabase Storage
```
invoices/
  {client_id}/
    JPHS-0038-120825.pdf
    JPHS-0038-120825.xlsx
```

**Future:** Mirror to Google Drive (integration TBD)

---

## Database Migrations Required

### 1. Rename existing invoices table
```sql
ALTER TABLE invoices RENAME TO invoices_shipbob;
```

### 2. Add client billing fields
```sql
ALTER TABLE clients ADD COLUMN short_code TEXT;
ALTER TABLE clients ADD COLUMN billing_period TEXT DEFAULT 'weekly';
ALTER TABLE clients ADD COLUMN billing_terms TEXT DEFAULT 'due_on_receipt';
ALTER TABLE clients ADD COLUMN invoice_email_note TEXT;
ALTER TABLE clients ADD COLUMN next_invoice_number INTEGER DEFAULT 1;
ALTER TABLE clients ADD COLUMN billing_email TEXT;

-- Backfill existing clients
UPDATE clients SET short_code = 'HS', next_invoice_number = 38 WHERE company_name ILIKE '%henson%';
UPDATE clients SET short_code = 'ML', next_invoice_number = 22 WHERE company_name ILIKE '%methyl%';
```

### 3. Add markup columns to billing tables
```sql
-- Add to ALL 6 billing tables:
ALTER TABLE billing_shipments ADD COLUMN billed_amount DECIMAL(10,2);
ALTER TABLE billing_shipments ADD COLUMN markup_rule_id UUID REFERENCES markup_rules(id);
ALTER TABLE billing_shipments ADD COLUMN markup_percentage DECIMAL(5,2);

-- Repeat for: billing_shipment_fees, billing_storage, billing_credits, billing_returns, billing_receiving
```

### 4. Create markup history table
```sql
CREATE TABLE markup_rule_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  markup_rule_id UUID NOT NULL REFERENCES markup_rules(id),
  changed_by UUID,  -- auth.users reference
  change_type TEXT NOT NULL,  -- 'created', 'updated', 'deactivated'
  previous_values JSONB,
  new_values JSONB,
  change_reason TEXT,
  changed_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE markup_rule_history ENABLE ROW LEVEL SECURITY;
```

### 5. Create Jetpack invoices tables
```sql
CREATE TABLE invoices_jetpack (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id),

  -- Invoice identification
  invoice_number TEXT NOT NULL UNIQUE,  -- JPHS-0038-120825
  invoice_date DATE NOT NULL,

  -- Billing period
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,

  -- Amounts
  subtotal DECIMAL(12,2) NOT NULL,
  total_markup DECIMAL(12,2) NOT NULL,
  total_amount DECIMAL(12,2) NOT NULL,

  -- Files
  pdf_path TEXT,
  xlsx_path TEXT,

  -- Workflow
  status TEXT NOT NULL DEFAULT 'draft',
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  approval_notes TEXT,

  -- Regeneration
  version INTEGER DEFAULT 1,
  replaced_by UUID REFERENCES invoices_jetpack(id),
  regeneration_locked_at TIMESTAMPTZ,  -- 24 hours after generated_at

  -- Email tracking
  email_sent_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE invoices_jetpack ENABLE ROW LEVEL SECURITY;

CREATE TABLE invoices_jetpack_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices_jetpack(id) ON DELETE CASCADE,

  -- Source
  billing_table TEXT NOT NULL,
  billing_record_id UUID NOT NULL,

  -- Frozen amounts
  base_amount DECIMAL(10,2) NOT NULL,
  markup_applied DECIMAL(10,2) NOT NULL,
  billed_amount DECIMAL(10,2) NOT NULL,
  markup_rule_id UUID REFERENCES markup_rules(id),

  -- Display
  line_category TEXT NOT NULL,
  description TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE invoices_jetpack_line_items ENABLE ROW LEVEL SECURITY;
```

---

## Transaction Sync & Invoicing Workflow (Dec 2025)

### Overview

Two-phase approach that solves the 7-day data retention limit:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 1: CONTINUOUS SYNC (every 15-30 min)                                 │
│  POST /transactions:query → billing_transactions table                      │
│                                                                             │
│  • Captures pending transactions before 7-day expiry                        │
│  • Links to shipments via reference_id for context                          │
│  • Powers "Transactions" tab (running unbilled totals)                      │
│  • Uses FILTER STRATEGY to bypass 250/1000 record caps                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 2: MONDAY 5AM INVOICE VERIFICATION                                   │
│                                                                             │
│  1. GET /invoices → Fetch new week's ShipBob invoices                       │
│  2. GET /invoices/{id}/transactions → Official invoice transactions         │
│  3. Match against DB, attach invoice_id + invoice_date                      │
│  4. Verify counts match ShipBob's totals                                    │
│  5. Generate Jetpack invoices ONLY for verified charges                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Correct API Usage (Dec 4, 2025 - IMPORTANT!)

**⚠️ The ShipBob billing guide has WRONG parameter names!**

| Documented (WRONG) | Actual (CORRECT) |
|--------------------|------------------|
| `start_date` | `from_date` |
| `end_date` | `to_date` |
| `limit` | `page_size` |

**Working Code:**
```javascript
async function getAllPendingTransactions() {
  const allItems = []
  let cursor = null

  do {
    // Cursor goes in QUERY string, not body
    let url = `${BASE_URL}/2025-07/transactions:query`
    if (cursor) url += `?Cursor=${encodeURIComponent(cursor)}`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        invoiced_status: false,  // Unbilled only
        page_size: 1000,         // Max allowed
        // Optional date range:
        // from_date: '2025-12-01T00:00:00Z',
        // to_date: '2025-12-04T23:59:59Z',
      })
    })

    const data = await response.json()
    allItems.push(...(data.items || []))
    cursor = data.next || null
  } while (cursor)

  return allItems
}
```

**Results (tested Dec 4, 2025):**
| Query | Transactions | Notes |
|-------|--------------|-------|
| Unbilled only | **2,629** | Dec 1-4 pending |
| All transactions | 6,448 | Nov 27 - Dec 4 |
| Date range Dec 1-4 | 2,759 | With from_date/to_date |

**By date (unbilled):**
- Dec 1: 704
- Dec 2: 789
- Dec 3: 692
- Dec 4: 444

**Script:** `scripts/test-correct-api-params.js`

### Reference Type Attribution

| reference_type | Links To | Attribution |
|----------------|----------|-------------|
| `Shipment` | shipments.shipment_id | Direct JOIN |
| `Default` | shipments.shipment_id | Direct JOIN (same as Shipment) |
| `WRO` | warehouse receiving orders | Separate WRO table lookup |
| `FC Transfer` | storage charges | No shipment link (FC = fulfillment center) |
| `TicketNumber` | support tickets | Manual review (credits/adjustments) |

### Monday Verification Logic

```javascript
async function verifyInvoiceTransactions(invoiceId, invoiceTotal) {
  // 1. Get official transactions from invoice endpoint
  const officialTxns = await getAllInvoiceTransactions(invoiceId)
  const officialTotal = officialTxns.reduce((sum, t) => sum + t.amount, 0)

  // 2. Match against our synced data
  const matched = []
  const missing = []
  for (const t of officialTxns) {
    const dbRecord = await findInDB(t.transaction_id)
    if (dbRecord) {
      // Update with invoice_id
      await updateTransaction(t.transaction_id, { invoice_id: invoiceId })
      matched.push(t)
    } else {
      // Missing from our sync - log for investigation
      missing.push(t)
    }
  }

  // 3. Verify totals match
  const isValid = Math.abs(officialTotal - invoiceTotal) < 0.01
  if (!isValid || missing.length > 0) {
    await flagForReview(invoiceId, { missing, totalMismatch: !isValid })
  }

  return { matched, missing, isValid }
}
```

### Sync Frequency Considerations

| Volume | Recommended Frequency | Reason |
|--------|----------------------|--------|
| <500 pending/day | Every 30 min | Well under caps |
| 500-1000/day | Every 15 min | Approaching caps |
| >1000/day | Every 10 min + Excel backup | Need filter strategy |

**Current state (Dec 2025):** ~250-300 pending transactions at any time. Hourly sync is safe for now, but should move to 15-30 min as volume grows.

### Fallback: Excel Import

If API caps become unworkable:
1. Daily manual Excel export from ShipBob dashboard
2. Import script to upsert transactions
3. Monday cron still verifies against invoice API

---

## Technical Implementation

### Libraries
- **PDF:** `@react-pdf/renderer`
- **XLS:** `exceljs`
- **Cron:** Vercel Cron (`/api/cron/generate-invoices`)

### Key Files
```
/lib/billing/
  markup-engine.ts      # Markup calculation logic
  invoice-generator.ts  # PDF + XLS generation
  email-sender.ts       # Invoice email delivery

/app/api/cron/
  generate-invoices/route.ts  # Weekly cron job

/app/dashboard/admin/
  page.tsx              # Admin section
  markup-tables/        # Markup management UI
  invoicing/            # Invoice workflow UI
```

### Markup Engine API
```typescript
interface MarkupResult {
  baseAmount: number;
  markupAmount: number;
  billedAmount: number;
  ruleId: string | null;
  markupPercentage: number;
}

function calculateMarkup(
  transaction: BillingTransaction,
  clientId: string,
  transactionDate: Date
): MarkupResult;

function findMatchingRules(
  feeType: string,
  clientId: string,
  date: Date,
  conditions?: { weight?: number; state?: string; shipOption?: string }
): MarkupRule[];
```

---

## Historical Data Backfill

### Source Data
1. **ShipBob costs:** Already in `billing_*` tables (140K+ records)
2. **Billed amounts:** From Excel invoices since inception

### Strategy
1. Import Excel invoices to get actual billed amounts
2. Calculate implied markup for each transaction
3. Create markup rules that match historical patterns
4. Validate by regenerating old invoices and comparing to PDFs

### Files to Import
```
reference/invoices/
  henson/
    JPHS-0001-*.xlsx through JPHS-0037-*.xlsx
  methyl-life/
    JPML-0001-*.xlsx through JPML-0021-*.xlsx
```

---

## Admin UI Structure

### Navigation
```
/dashboard/admin
  ├── Markup Tables (Tab 1)
  │   ├── Rules list grouped by client
  │   ├── Create/Edit rule modal
  │   ├── Deactivate with reason
  │   └── View change history
  │
  └── Run Invoicing (Tab 2)
      ├── This Week's Invoices
      ├── Per-client preview
      ├── Approve Individual / Approve All
      ├── Regenerate (24hr window only)
      └── Past invoices archive
```

### Client-Facing
```
/dashboard/invoices
  ├── Invoice list (approved only)
  ├── Download PDF / XLS
  └── Payment status
```

---

## Testing Checklist

- [ ] Markup rules apply correctly by priority
- [ ] Effective dates respected for historical lookups
- [ ] Credits handled correctly (shipping vs product)
- [ ] Storage periods detected and labeled
- [ ] Invoice numbers increment correctly
- [ ] PDF matches existing format
- [ ] XLS matches existing format
- [ ] Regeneration creates new version
- [ ] 24-hour lock enforced
- [ ] Email sends with correct content
- [ ] Past-due warning appears when needed

---

*This file documents the billing and invoicing system. Update when making changes to markup logic, invoice format, or billing workflows.*
