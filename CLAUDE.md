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
| Database-Join Fix | shipments table with client_id populated | Unattributed transaction recovery |

### Attribution Strategies (Order of Priority)

1. **Direct lookup**: shipment_id → shipments table, return_id → returns table
2. **Order reference**: Parse "Order 123456" from Comment → orders table lookup
3. **Database-join fix**: After sync, query DB for unattributed Shipment transactions and join to shipments table
4. **Proactive sync**: Sync ALL returns/orders for ALL clients to build lookup tables BEFORE transactions arrive

### Anti-Patterns to Avoid

- **Iterating through clients per item**: Making N API calls per unattributed item doesn't scale
- **Chicken-and-egg logic**: Don't require client_id to sync data that's needed for attribution
- **Assuming data exists**: Always handle the case where lookup tables are incomplete
- **FC-based attribution**: Multiple clients share the same fulfillment centers - NEVER use FC to determine client ownership
- **Invoice-based attribution**: ShipBob invoices contain ALL clients' transactions together - NEVER assume transactions on the same invoice belong to the same client
- **Supabase pagination with .limit() > 1000**: Supabase returns MAX 1000 rows regardless of your limit. Use cursor-based pagination (see below)
- **Upsert with null client_id**: NEVER include `client_id: null` in upsert records - it will OVERWRITE existing attribution! Only include client_id when you have a valid value (see "Upsert Gotcha" below)

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
| [CLAUDE.claims.md](CLAUDE.claims.md) | Claims, care tickets, credit lifecycle |
| [CLAUDE.deliveryiq.md](CLAUDE.deliveryiq.md) | Delivery IQ (Lookout), at-risk monitoring, transit benchmarks |
| [CLAUDE.commissions.md](CLAUDE.commissions.md) | Sales partner commissions, eShipper data, formula calculations |
| [CLAUDE.schema.md](CLAUDE.schema.md) | Database tables and columns |

## Active Projects

| File | Description |
|------|-------------|
| [docs/SYNC-FIX-PROJECT.md](docs/SYNC-FIX-PROJECT.md) | **ACTIVE** - Fixing sync issues (Dec 2025). Full analysis, root causes, fix plan. |

---

## Current Cron Jobs (vercel.json)

| Path | Schedule | maxDuration | Purpose |
|------|----------|-------------|---------|
| `/api/cron/sync` | Every 1 min | - | Orders & shipments (child tokens, LastUpdateStartDate) |
| `/api/cron/sync-timelines` | Every 1 min | - | Timeline events (0-14d, per-client parallel, auto-scales) |
| `/api/cron/sync-transactions` | Every 1 min | 300s | All billing transactions + tracking backfill (parent token) |
| `/api/cron/sync-reconcile` | Every hour | 300s | Orders/shipments (45d) + transactions (3d) + soft-delete |
| `/api/cron/sync-invoices` | Daily 1 PM EST | - | ShipBob invoice sync |
| `/api/cron/sync-older-nightly` | Daily 3:00 AM UTC | 300s | Full refresh for older shipments (14-45 days) |
| `/api/cron/sync-products` | Daily 4:00 AM UTC | - | Products with variants (for inventory_id → client/SKU mapping) |
| `/api/cron/sync-sftp-costs` | Daily 5 AM EST | 300s | SFTP shipping breakdown (base_cost, surcharge_details) |
| `/api/cron/sync-at-risk` | Daily 3:00 AM UTC | - | Proactive Lost in Transit detection (TrackingMore) |
| `/api/cron/recheck-at-risk` | Every 5 hours | - | FREE recheck of at-risk shipments |
| `/api/cron/advance-claims` | Every 5 min | - | Auto-advance claims: Under Review → Credit Requested |

**Note:** `maxDuration = 300` (5 minutes) required for crons that process large datasets. Vercel Pro tier supports up to 300s. Without explicit `maxDuration`, functions may timeout prematurely.

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

## Reshipments vs Voided Labels

**Reshipments:** When an order needs to be shipped again (lost package, damaged, wrong item), ShipBob creates a new shipment with a new tracking number but the **same shipment_id**. This generates multiple Shipping transactions for the same shipment_id on different dates.

**Example - Reshipment:** Shipment 330867617
- Dec 22: First shipment, tracking `7517859134`, $3.95
- Dec 26: Reshipment, tracking `1437163232`, $3.95
- Both are billable (legitimate charges)

**Voided Labels:** When a shipping label is voided and replaced (carrier change, label error), we get two transactions with different tracking IDs for the same shipment. Only the newest should be billed.

**Example - Voided Label:** Shipment 338238030
- Jan 20: Voided label, tracking `CR000459826535`, $6.34 (CirroECommerce) → `is_voided = true`
- Jan 25: Current label, tracking `TBA328109631407`, $6.34 (Amazon) → billable

**Database reality:**
- `shipments` table: ONE row per shipment_id (latest data wins)
- `transactions` table: MULTIPLE rows per shipment_id (one per shipping event)
- `transactions.is_voided`: TRUE for voided labels that shouldn't be billed

**Detection logic (hourly reconcile cron):**

| Pattern | Same Tracking? | Has Credit? | Action |
|---------|----------------|-------------|--------|
| **A: Reshipment** | Yes | Yes | DO NOT VOID - both are billable |
| **B: Duplicate billing** | Yes | No | Mark older as `is_voided = true` |
| **C: Voided w/ credit** | No | Yes | DO NOT VOID - ShipBob credited it |
| **D: Voided label** | No | No | Mark older as `is_voided = true` |

**Key insight:** If ShipBob issues a credit for the voided label (Pattern C), we don't need to mark it voided - the credit cancels it out. We only void when there's NO credit (Pattern B/D).

See [CLAUDE.sync.md](CLAUDE.sync.md) for full implementation details.

**Correct pattern for SFTP matching:**
```typescript
// Build lookup by shipment_id:charge_date for precise matching
const key = `${shipment_id}:${charge_date}`
txByShipmentDate.set(key, transaction_id)
```

---

## Critical Patterns

### CLIENT DATA ISOLATION (MANDATORY - BUSINESS CRITICAL)

**ABSOLUTELY CRUCIAL: Jetpack clients can NEVER see any other client's data.**
**Clients can NEVER see admin settings, markups, costs, or ShipBob invoices.**
**This is VITAL - failure could sink the business.**

#### Required Pattern for ALL Data Routes

Every API route in `/app/api/data/` MUST use `verifyClientAccess()` before returning any data:

```typescript
import { createAdminClient, verifyClientAccess, handleAccessError } from '@/lib/supabase/admin'

export async function GET(request: NextRequest) {
  // CRITICAL SECURITY: Verify user has access to requested client
  const searchParams = request.nextUrl.searchParams
  let clientId: string | null
  try {
    const access = await verifyClientAccess(searchParams.get('clientId'))
    clientId = access.requestedClientId
  } catch (error) {
    return handleAccessError(error)
  }

  // Now safe to query data with clientId filter
  const supabase = createAdminClient()
  // ... query with clientId filter
}
```

#### NEVER Do These:
- **NEVER use hardcoded client IDs** (e.g., `const DEFAULT_CLIENT_ID = '...'`)
- **NEVER trust clientId from query params without verification**
- **NEVER allow fallback to a default client if user is unauthenticated**
- **NEVER use `createAdminClient()` without verifying user access first**

#### What `verifyClientAccess()` Does:
1. Checks user is authenticated (returns 401 if not)
2. Checks if user is admin (admins can access everything)
3. For non-admins: Checks `user_clients` table to verify access
4. Returns 403 if user doesn't have access to requested client
5. For 'all' requests: Only allows admins

---

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
- Use UPSERT pattern for all sync operations (but see "Upsert Gotcha" below!)

### Upsert Gotcha (CRITICAL - Dec 2025)

**Problem:** Supabase upsert with `ignoreDuplicates: false` OVERWRITES all columns, even with `null` values.

**Scenario that caused bugs:**
1. Transaction sync builds attribution lookup (shipment_id → client_id)
2. Attribution fails for some transactions → `client_id: null`
3. Upsert runs with `{ client_id: null, ...otherFields }`
4. **Existing `client_id` gets WIPED to null!**

This was causing the hourly reconcile cron to wipe ~5,000 attributed transactions back to null every hour.

**Solution:** Only include `client_id`/`merchant_id` in upsert records when they're NOT null:
```typescript
// Build base record without client_id
const baseRecord = {
  transaction_id: tx.transaction_id,
  reference_id: tx.reference_id,
  // ... other fields
}

// Only include client_id if we successfully attributed
if (clientId) {
  baseRecord.client_id = clientId
  baseRecord.merchant_id = merchantId
}

return baseRecord
```

**Key insight:** Omitting a field from an upsert record means "don't touch this column on existing rows." Including `null` means "set this column to null."

### Supabase Pagination (CRITICAL)

**Problem:** Supabase returns MAX 1000 rows regardless of `.limit()` value. Scripts using `.limit(5000)` silently return only 1000 rows, causing incomplete data.

**Detection:** If your loop terminates early with exactly 1000 rows, you have this bug.

**Solution:** Use cursor-based pagination with `pageSize = 1000`:
```javascript
const pageSize = 1000;  // Never higher than this!
let lastId = null;

while (true) {
  let query = supabase
    .from('table')
    .select('id, field1, field2')
    .order('id', { ascending: true })
    .limit(pageSize);

  if (lastId) {
    query = query.gt('id', lastId);  // Cursor: get rows AFTER lastId
  }

  const { data, error } = await query;
  if (!data || data.length === 0) break;

  // Process data...
  lastId = data[data.length - 1].id;

  if (data.length < pageSize) break;  // Last page
}
```

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

## Data Quality Status (Dec 29, 2025)

| Table | Field | % Populated | Status |
|-------|-------|-------------|--------|
| transactions | client_id | 100% (Shipment type) | ✅ Fixed upsert-null-overwrite bug |
| transactions | tracking_id | 100% | ✅ All fee types now have tracking (backfilled from shipments table)
| transactions | base_cost, surcharge | ~60K updated | ✅ SFTP backfill complete |
| shipments | event_* fields | 100% | ✅ Timeline backfill complete (72,855 shipments) |
| shipments | transit_time | 100% | ✅ Transit time backfill complete (69,506 shipments) |
| clients | stripe_customer_id | Varies | ✅ Per-client CC setup via billing page |

**Note:** Transaction `client_id` attribution happens via:
1. Direct lookup (shipment_id → shipments table) during sync - **only sets if non-null**
2. Database-join fix (post-sync pass queries unattributed transactions and joins to shipments table)

**Important:** The upsert in `syncAllTransactions()` was fixed Dec 18, 2025 to NOT include `client_id`/`merchant_id` when null. This prevents the hourly reconcile cron from wiping existing attribution.

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

## Dev Server Management (IMPORTANT)

Claude manages the dev server. Follow these rules to avoid crashes:

**Safe File Editing Practices:**
1. **NEVER use `git checkout` or `git stash` to revert files while dev server is running** - These operations can cause file system events that crash the hot-reloader. Instead, use the Edit tool to manually restore changes.
2. **Make smaller, incremental edits** - Don't do large sweeping changes
3. **Always verify the server after edits** - Check it's still running with `lsof -i :3000 | grep LISTEN`
4. **If server crashes, restart it immediately** before proceeding

### File Editing Rules
- **NEVER use `sed` for file modifications** - it rewrites files in-place, causing the dev server to see incomplete files and crash
- **ALWAYS use the Edit tool** for all file changes - it's more atomic
- **For large deletions (>50 lines)**, break into smaller incremental edits rather than one massive removal
- **Avoid Write tool for existing files** when possible - prefer Edit for surgical changes

### Dev Server Rules (CRITICAL - READ CAREFULLY)

**Problem:** Background shell sessions persist across Claude conversations. Each time Claude runs `npm run dev` in background, a new shell session is created. These accumulate and can cause race conditions where old orphaned sessions interfere with the current server.

**The Solution - DO NOT START DEV SERVER AUTOMATICALLY:**

1. **ASSUME the dev server is already running** - The user likely has it running in a terminal
2. **First, CHECK if port 3000 is listening**: `lsof -i :3000 | grep LISTEN`
3. **If server IS running** - Do nothing, proceed with your task
4. **If server is NOT running** - Ask the user: "The dev server isn't running. Would you like me to start it, or will you start it in your terminal?"
5. **Only start the server if the user explicitly asks** - then use `npm run dev` with `run_in_background: true`

**NEVER do this:**
- Don't automatically restart the server after making edits
- Don't use `lsof -ti :3000 | xargs kill -9 && npm run dev` as a one-liner (this creates a new background session every time)
- Don't use `pkill -f "next-server"` or `pkill -f "next dev"` - this kills ALL Next.js processes including other projects on different ports

**Protected ports (other projects):**
- Port 3002: VenicePress project - NEVER touch

**If site becomes unreachable and user asks to fix it:**
```bash
# Step 1: Kill only port 3000
lsof -ti :3000 | xargs kill -9 2>/dev/null

# Step 2: Start fresh (separate command)
npm run dev
```

### Build Verification
- Use `npm run build` (one-shot) to verify changes compile correctly
- Don't rely on dev server HMR for verification of large changes

---

## Environment Variables

| Variable | Purpose | Required |
|----------|---------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase public key | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase admin key | Yes |
| `SHIPBOB_API_TOKEN` | Parent token for billing API | Yes |
| `SFTP_HOST`, `SFTP_USER`, `SFTP_PASSWORD` | ShipBob SFTP for cost breakdown | Yes |
| `STRIPE_SECRET_KEY` | Stripe API key for payments | Yes |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe public key | Yes |
| `VERCEL_CRON_SECRET` | Auth for cron endpoints | Production |

---

## Update Protocol

After ANY technology/architecture/schema change, update the relevant CLAUDE file immediately. Don't wait to be asked.
