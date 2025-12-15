# Jetpack Dashboard

**Project:** Secure web app for 3PL/fulfillment billing, analytics, and support
**Owner:** Matt McLeod | **Company:** Jetpack (3PL/Fulfillment Services)
**Started:** November 2025

---

## What This Is

Jetpack is a 3PL/fulfillment company serving D2C businesses (1K-50K orders/month). This dashboard provides:
- **Clients:** Analytics, billing, support tickets, reporting
- **Admins:** Billing automation, approval workflows, client management

Infrastructure partner is ShipBob (warehouses, systems) - we white-label their platform as "Jetpack."

---

## CRITICAL: Systems Thinking Required

**Never fix one component in isolation.** This codebase has deeply interconnected systems where changes ripple across multiple components. Before implementing ANY fix or feature:

### Ask These Questions First

1. **Data Dependencies**: What data does this component need? Where does that data come from? Is it guaranteed to exist when needed?
2. **Timing Dependencies**: What runs first? What order do cron jobs execute? Can race conditions occur?
3. **Attribution Chain**: How does data get attributed to a client? What happens if attribution fails at any step?
4. **Scalability**: Will this approach work with 50-100 clients? Does it make O(clients) or O(clients * items) API calls?

### Key Interdependencies

| System | Depends On | Feeds Into |
|--------|------------|------------|
| Transaction Sync | shipments, returns, orders, receiving_orders, products tables | Billing calculations |
| Return Sync | Transaction client_id OR proactive sync | Transaction attribution |
| Order Sync | Client tokens | Return attribution (via Comment parsing) |
| Shipment Sync | Client tokens | Transaction attribution |
| Invoice Attribution | At least one sibling transaction having client_id | Unattributed transaction recovery |

### Attribution Strategies (Order of Priority)

1. **Direct lookup**: shipment_id → shipments table, return_id → returns table
2. **Order reference**: Parse "Order 123456" from Comment → orders table lookup
3. **Invoice siblings**: If one transaction on an invoice has client_id, all do
4. **Proactive sync**: Sync ALL returns/orders for ALL clients to build lookup tables BEFORE transactions arrive

### Anti-Patterns to Avoid

- **Iterating through clients per item**: Making N API calls per unattributed item doesn't scale
- **Chicken-and-egg logic**: Don't require client_id to sync data that's needed for attribution
- **Assuming data exists**: Always handle the case where lookup tables are incomplete
- **FC-based attribution**: Multiple clients share the same fulfillment centers - NEVER use FC to determine client ownership

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 15 + App Router |
| Database | Supabase (PostgreSQL) |
| UI | shadcn/ui + Tailwind |
| Charts | Recharts |
| Auth | Supabase Auth + cookies |
| Payments | Stripe |
| Hosting | Vercel |

---

## Sub-Context Files

| File | When to Read |
|------|--------------|
| [CLAUDE.sync.md](CLAUDE.sync.md) | Data sync, cron jobs, ShipBob API |
| [CLAUDE.billing.md](CLAUDE.billing.md) | Invoicing, markup rules, SFTP processing |
| [CLAUDE.schema.md](CLAUDE.schema.md) | Database tables and columns |

## Active Projects

| File | Description |
|------|-------------|
| [docs/SYNC-FIX-PROJECT.md](docs/SYNC-FIX-PROJECT.md) | **ACTIVE** - Fixing sync issues (Dec 2025). Full analysis, root causes, fix plan. |

---

## Current Cron Jobs (vercel.json)

| Path | Schedule | Purpose |
|------|----------|---------|
| `/api/cron/sync` | Every 1 min | Orders & shipments (child tokens, LastUpdateStartDate) |
| `/api/cron/sync-timelines` | Every 1 min | Timeline events (0-14d, per-client parallel, auto-scales) |
| `/api/cron/sync-transactions` | Every 1 min | All billing transactions (parent token) |
| `/api/cron/sync-reconcile` | Every hour | Soft-delete detection (20-day lookback) |
| `/api/cron/sync-invoices` | Daily 1:36 AM UTC | ShipBob invoice sync |
| `/api/cron/sync-older-nightly` | Daily 3:00 AM UTC | Full refresh for older shipments (14-45 days) |

---

## Token Architecture

| Token | Source | Access |
|-------|--------|--------|
| **Parent Token** | `.env.local` SHIPBOB_API_TOKEN | Billing API only (invoices, transactions) |
| **Child Tokens** | `client_api_credentials` table | Orders, Shipments, Returns per-client |

**Key insight:** Parent token sees ALL merchants' billing. Child tokens only see their own operational data.

---

## Key Tables

| Table | Primary Key | Purpose |
|-------|-------------|---------|
| `orders` | `shipbob_order_id` | Order-level data |
| `shipments` | `shipment_id` | Shipment details, tracking, timeline events |
| `transactions` | `transaction_id` | All billing (shipping, storage, returns, etc.) |
| `invoices_sb` | `invoice_id` | ShipBob invoices |
| `invoices_jetpack` | `id` | Our invoices to clients |
| `markup_rules` | `id` | Per-client markup configuration |

See [CLAUDE.schema.md](CLAUDE.schema.md) for full schema.

---

## Client IDs - ALWAYS VERIFY

**CRITICAL: Never use hardcoded or memorized client_ids.** Client IDs can change or be misremembered. Always verify by querying the database.

### How to Get Client IDs

```javascript
// Query the clients table to get current client IDs
const { data: clients } = await supabase
  .from('clients')
  .select('id, name')
  .order('name')

// Or query transactions to see which client_ids have data
const { data: txByClient } = await supabase
  .from('transactions')
  .select('client_id')
  .in('invoice_id_sb', invoiceIds)
  // Then group and count
```

### Current Clients (Dec 2025)

| Name | client_id |
|------|-----------|
| Henson Shaving | `6b94c274-0446-4167-9d02-b998f8be59ad` |
| Methyl-Life | `ca33dd0e-bd81-4ff7-88d1-18a3caf81d8e` |

**Note:** This table may become stale. When in doubt, query the database directly.

---

## Terminology

| Database | UI | Notes |
|----------|------|-------|
| `clients` | "Brands" | User-facing term is always "Brand" |
| `client_id` | - | UUID foreign key |
| User roles | `owner`, `editor`, `viewer` | NOT admin/editor/viewer |
| Jetpack admin | `user_metadata.role === 'admin'` | Internal staff |

---

## Critical Patterns

### Security (MANDATORY)
```sql
-- ALWAYS enable RLS on new tables
ALTER TABLE new_table ENABLE ROW LEVEL SECURITY;

-- ALWAYS set search_path in functions
CREATE FUNCTION my_func() ... SET search_path = public ...
```

### Authentication
- Client-side: `createClient()` - ONLY for auth, never data queries
- Server-side: `createServerClient()` with cookies()
- Post-auth redirects: Use `window.location.href` (not router.push)

### Data Queries
- NEVER query data from browser client
- All data fetching via API routes with `service_role` key
- Use UPSERT pattern for all sync operations

### Date Formatting (Timezone Fix)
When displaying date-only values (e.g., invoice dates), **DO NOT** use `new Date(dateString)` directly.

**Problem:** `new Date("2025-01-15")` interprets the string as UTC midnight, which shifts back a day in US timezones.

**Solution:** Use `formatDateFixed()` from `components/transactions/cell-renderers.tsx`:
```typescript
function formatDateFixed(dateStr: string): string {
  if (!dateStr) return '-'
  const datePart = dateStr.split('T')[0]
  const [year, month, day] = datePart.split('-')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[parseInt(month) - 1]} ${parseInt(day)}, ${year}`
}
```

**When to use:** Any date-only display (invoice dates, billing dates, etc.) where you need "Jan 15, 2025" format without time component.

---

## Data Quality Status (Dec 10, 2025)

| Table | Field | % Populated | Status |
|-------|-------|-------------|--------|
| transactions | tracking_id | 100% | ✅ Complete |
| transactions | base_cost, surcharge | ~60K updated | ✅ SFTP backfill complete |
| shipments | event_* fields | 100% | ✅ Timeline backfill complete (72,855 shipments) |
| shipments | transit_time | 100% | ✅ Transit time backfill complete (69,506 shipments) |

---

## File Structure

```
/app/dashboard/           # All dashboard pages
/app/api/cron/            # Sync cron jobs
/app/api/admin/           # Admin-only routes
/lib/shipbob/             # ShipBob API client & sync logic
/lib/supabase/            # Database clients
/components/              # React components
/scripts/                 # Manual sync & utility scripts
```

---

## Commands

```bash
npm run dev          # Dev server (localhost:3000)
npm run build        # Production build
npm run lint         # ESLint
```

---

## Update Protocol

After ANY technology/architecture/schema change, update the relevant CLAUDE file immediately. Don't wait to be asked.
