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
| UI | shadcn/ui + Tailwind + Framer Motion |
| Tables | @tanstack/react-table |
| Charts | Recharts |
| Auth | Supabase Auth + cookies |
| Payments | Stripe |
| Tracking | TrackingMore API (V3 realtime + V4 CRUD) |
| AI | Google Gemini Flash (checkpoint normalization, watch reasons) |
| Email | Resend |
| Hosting | Vercel |

---

## Sub-Context Files

| File | When to Read |
|------|--------------|
| [CLAUDE.sync.md](CLAUDE.sync.md) | Data sync, cron jobs, ShipBob API |
| [CLAUDE.billing.md](CLAUDE.billing.md) | Invoicing, markup rules, SFTP processing |
| [CLAUDE.claims.md](CLAUDE.claims.md) | Claims, care tickets, credit lifecycle |
| [CLAUDE.deliveryiq.md](CLAUDE.deliveryiq.md) | Delivery IQ, at-risk monitoring, transit benchmarks |
| [CLAUDE.commissions.md](CLAUDE.commissions.md) | Sales partner commissions, eShipper data, formula calculations |
| [CLAUDE.schema.md](CLAUDE.schema.md) | Database tables and columns |

---

## Current Cron Jobs (vercel.json)

### Data Sync (High Frequency)

| Path | Schedule | maxDuration | Purpose |
|------|----------|-------------|---------|
| `/api/cron/sync` | Every 3 min | 120s | Orders, shipments, returns, receiving (child tokens) |
| `/api/cron/sync-timelines` | Every 3 min | - | Timeline events (tiered: 0-3d/15min, 3-14d/2hr) |
| `/api/cron/sync-transactions` | Every 3 min | 300s | All billing transactions + tracking backfill (parent token) |
| `/api/cron/sync-reconcile` | Hourly | 300s | Orders/shipments (45d) + transactions (3d) + voided label detection + soft-delete |
| `/api/cron/sync-backfill-items` | Hourly (:30) | 300s | Safety net: backfill missing order_items/shipment_items |

### Data Sync (Daily/Weekly)

| Path | Schedule | Purpose |
|------|----------|---------|
| `/api/cron/preflight-refresh` | Mondays 9 AM UTC | Targeted /order/{id} refresh on stale shipments referenced by unprocessed SB invoices (runs 1h before sync-invoices) |
| `/api/cron/sync-invoices` | Mondays 10 AM UTC | ShipBob invoice sync + SFTP breakdown + preflight |
| `/api/cron/sync-older-nightly` | Daily 3 AM UTC | Full refresh for shipments 14-180 days old |
| `/api/cron/sync-products` | Daily 4 AM UTC | Products with variants (inventory_id → client mapping) |
| `/api/cron/sync-sftp-costs` | Daily 10 AM UTC | SFTP shipping cost breakdown (base_cost, surcharge_details) |
| `/api/cron/sync-at-risk` | Daily 3 AM UTC | New at-risk candidates (15+ days, TrackingMore $0.04/ea) |

### Delivery IQ & Claims

| Path | Schedule | Purpose |
|------|----------|---------|
| `/api/cron/monitoring-entry` | Hourly | Add shipments to Delivery IQ (benchmark-based entry) |
| `/api/cron/recheck-at-risk` | Hourly | FREE recheck of existing at-risk shipments |
| `/api/cron/ai-reassess` | Every 15 min | AI watch-reason reassessment (Gemini Flash) |
| `/api/cron/advance-claims` | Every 5 min | Auto-advance: Under Review → Credit Requested (15min delay) |
| `/api/cron/auto-file-claims` | Daily 9 AM UTC | Auto-file LIT claims for clients with auto_file_claims=true |
| `/api/cron/normalize-checkpoints` | Every 15 min | AI-normalize tracking checkpoints (Gemini, 200/run) |
| `/api/cron/calculate-benchmarks` | Daily 4 AM UTC | Transit time benchmarks from 90 days of delivered shipments |

### Analytics & Admin

| Path | Schedule | Purpose |
|------|----------|---------|
| `/api/cron/refresh-analytics` | Every 5 min | Refresh pre-aggregated analytics summary tables |
| `/api/cron/refresh-carrier-views` | Daily 5:30 AM UTC | Refresh carrier filter materialized views |
| `/api/cron/calculate-client-sizes` | 1st of month, 6 AM UTC | Client size labels (whale/shark/dolphin/bass/goldfish) |
| `/api/cron/lock-commissions` | 1st of month, 11 AM UTC | Lock previous month's commissions into snapshots |

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

**CRITICAL: Never use hardcoded or memorized client_ids.** Always query the database:

```javascript
const { data: clients } = await supabase
  .from('clients')
  .select('id, company_name')
  .eq('is_active', true)
  .order('company_name')
```

---

## User Roles & Permissions

### Internal Roles (stored in `user_metadata.role`)

| Role | Access |
|------|--------|
| `admin` | Full platform access — all clients, all features, admin panel |
| `care_admin` | All clients, full care management, no admin panel |
| `care_team` | All clients, read-only care access |

### Brand Roles (stored in `user_clients.role`)

| Role | Access |
|------|--------|
| `brand_owner` | Full brand access, manages team. `permissions` column = NULL (implicit full access) |
| `brand_team` | Custom permissions per JSONB. Default: all true, brand_owner unchecks as needed |

**Permission structure:** Flat dot-notation keys in `user_clients.permissions` JSONB:
- Top-level: `home`, `transactions`, `analytics`, `deliveryiq`, `invoices`, `care`, `billing`
- Sub-keys: `transactions.shipments`, `care.submit_claims`, `invoices.download_files`, etc.
- Missing key → defaults to `true` (fail-open for forward compatibility)

**Permission checking:** `lib/permissions.ts` exports `hasPermission()` and `checkPermission()`.
- Internal users → always true (bypass all brand checks)
- `brand_owner` → always true
- `brand_team` → check `permissions[key]`

**Launch override (Mar 2026):** Delivery IQ hidden from ALL brand users regardless of permissions.

### Terminology

| Database | UI | Notes |
|----------|------|-------|
| `clients` | "Brands" | User-facing term is always "Brand" |
| `client_id` | - | UUID foreign key |
| `admin` | "Admin" | Internal Jetpack staff |
| `brand_owner` | "Owner" | Brand user with full access |
| `brand_team` | "Team Member" | Brand user with custom permissions |

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
2. Checks if user is admin or care user (admins/care can access all clients)
3. For brand users: Checks `user_clients` table to verify access
4. Returns 403 if user doesn't have access to requested client
5. For 'all' requests: Only allows admins/care users
6. Returns `brandRole` and `permissions` for brand permission checking

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

**Production Pattern (Application Code):**
- NEVER query data from browser client
- All data fetching via API routes with `service_role` key
- Use UPSERT pattern for all sync operations (but see "Upsert Gotcha" below!)

**Development Pattern (Claude Direct Access):**
Claude has direct access to Supabase via MCP tools. Use these for:
- Debugging issues (pull logs, check data quality)
- Schema exploration (list tables, inspect migrations)
- Performance analysis (query slow logs, get advisories)
- Quick data checks during development

**Available MCP Tools:**
```typescript
// Schema & Data
mcp__supabase__list_tables()           // List all tables/schemas
mcp__supabase__execute_sql()           // Run read-only SQL queries
mcp__supabase__list_migrations()       // See migration history

// Monitoring & Debugging
mcp__supabase__get_logs()              // Pull logs by service (api, postgres, auth, etc.)
mcp__supabase__get_advisors()          // Security & performance advisories

// Type Generation
mcp__supabase__generate_typescript_types()  // Auto-generate types from schema

// Documentation
mcp__supabase__search_docs()           // Search Supabase docs via GraphQL
```

**When to Use Which:**
- **Application code** → Always use API routes with `createAdminClient()`
- **Claude debugging/analysis** → Use MCP tools directly
- **Schema changes** → Use migrations (via MCP or Supabase CLI)
- **Never** → Don't use postgres MCP (`mcp__postgres__query`) - use Supabase MCP instead

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

## Data Quality Status

All critical fields are fully populated as of Dec 2025. Attribution, tracking, timeline, and SFTP cost data are all at 100% coverage. The upsert-null-overwrite bug (Dec 18, 2025) is fixed — `client_id`/`merchant_id` are omitted from upsert when null.

---

## File Structure

```
/app/
  /dashboard/               # All dashboard pages
    /admin/                 #   Admin panel + admin delivery-iq config
    /analytics/             #   Analytics (5 tabs: Performance, Cost & Speed, Order Volume, Carriers, Fulfillment)
    /billing/               #   Client billing & payment setup
    /care/                  #   Care tickets & claims
    /deliveryiq/            #   Delivery IQ monitoring (admin/care only at launch)
    /financials/            #   Commissions dashboard
    /invoices/              #   Invoice listing & downloads
    /misfits/               #   Unlinked credits & credit classification
    /settings/              #   User settings, brand team management
    /transactions/          #   7-tab billing transactions (Unfulfilled, Shipments, Additional, Returns, Receiving, Storage, Credits)
  /api/
    /cron/                  # 21 scheduled cron jobs (see vercel.json)
    /data/                  # Client-facing data routes (all use verifyClientAccess)
    /admin/                 # Admin-only routes (invoices, markup, users, sync, disputes)
    /auth/                  # Auth routes (clients, profile, password, avatar)
    /stripe/                # Stripe payment routes
    /webhooks/              # TrackingMore webhook receiver
  /about-delivery-iq/      # Public marketing page
  /login/, /password/       # Auth pages
/components/
  /analytics/               # Charts, maps, KPI panels
  /deliveryiq/              # Table, filters, mission control, timeline drawer
  /transactions/            # Per-tab table components, cell renderers
  /claims/                  # Claim submission dialog, file upload
  /care/                    # Ticket create/edit/delete/status dialogs
  /settings/                # Permission editor
  /ui/                      # shadcn/ui base components
/lib/
  /supabase/                # DB clients (admin.ts, client.ts, server.ts)
  /shipbob/                 # ShipBob API client + sync logic
  /trackingmore/            # TrackingMore API + at-risk detection + checkpoint storage
  /billing/                 # Markup engine, invoice generator, SFTP, PDF
  /claims/                  # Eligibility, ticket creation, reshipment detection
  /care/                    # Types + constants
  /analytics/               # Types, aggregators, geo-config
  /commissions/             # Calculator + types
  /ai/                      # Gemini client, checkpoint normalization
  permissions.ts            # Brand permission types, helpers, UI metadata
  format.ts                 # Shared formatCurrency()
  cron-lock.ts              # Distributed cron locking (prevents overlapping runs)
  export.ts                 # CSV/XLSX export utilities
  table-config.ts           # Responsive table column config
  slack.ts                  # Slack webhook alerts
/hooks/
  use-copy-to-clipboard.ts  # Clipboard + toast utility
  use-debounced-filters.ts  # Generic filter debounce (400ms)
  use-responsive-table.ts   # Priority-based responsive column hiding
  use-table-preferences.ts  # localStorage column visibility/order/page size
  use-saved-views.ts        # Named filter presets per tab
  use-watchlist.ts          # Client-side shipment watchlist
  use-user-settings.ts      # Singleton user preference store
/scripts/                   # Manual sync & backfill scripts
/supabase/migrations/       # Database migrations
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
- **NEVER run `npm run build` while the dev server is running** — it overwrites `.next` and corrupts the running server
- Use the dev server's own TypeScript checking instead
- If you must build, stop the dev server first

---

## Environment Variables

| Variable | Purpose | Required |
|----------|---------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase public key | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase admin key | Yes |
| `SHIPBOB_API_TOKEN` | Parent token for billing API | Yes |
| `SFTP_HOST`, `SFTP_USERNAME`, `SFTP_PASSWORD` | ShipBob SFTP for cost breakdown | Yes |
| `STRIPE_SECRET_KEY` | Stripe API key for payments | Yes |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe public key | Yes |
| `TRACKINGMORE_API_KEY` | TrackingMore API authentication | Yes |
| `TRACKINGMORE_WEBHOOK_SECRET` | HMAC-SHA256 for webhook verification | Yes |
| `GOOGLE_AI_API_KEY` | Gemini API key (checkpoint normalization, AI reassess) | Yes |
| `SLACK_WEBHOOK_URL` | Slack alerts (care tickets, address changes, permanent email failures). Callers pass `{ channel: '#foo' }` to override target channel. | Optional |
| `RESEND_API_KEY` | Resend email service | Yes |
| `SITE_PASSWORD` | Pre-launch site password gate | Optional |
| `CRON_SECRET` | Auth for cron endpoints | Production |

---

## Demo Client Isolation (Paul's Boutique)

A demo brand ("Paul's Boutique", guitar accessories) lives in the production DB tagged `is_demo=true`. Its data feeds the demo user's dashboard but MUST NOT appear in any aggregate analytics, admin "All Brands" views, financial/commission reporting, benchmarks, or client-size rankings.

**How isolation works:**
- `clients.is_demo` boolean column (partial-indexed via `idx_clients_is_demo`)
- `public.is_demo_client(uuid)` SQL helper + `lib/demo/exclusion.ts` TS helper (`excludeDemoClients()`)
- Admin selector (`getClientsWithTokenStatus()` in `lib/supabase/admin.ts`) filters `is_demo=false`
- Cross-client crons filter demo: `calculate-benchmarks`, `monitoring-entry`, `calculate-client-sizes`, `auto-file-claims`
- Commissions (`lib/commissions/calculator.ts`) skip demo in all-clients mode
- `get_monitoring_stats` RPC patched with `NOT is_demo_client(client_id)`
- `get_dashboard_kpi_totals` RPC patched with `AND (p_client_id IS NOT NULL OR NOT public.is_demo_client(client_id))`
- `get_otd_percentiles` (both overloads) patched with `AND (p_client_id IS NOT NULL OR NOT public.is_demo_client(s.client_id))`
- `get_analytics_from_summaries` RPC patched — all ~12 WHERE clauses across `analytics_daily_summaries`, `analytics_city_summaries`, `analytics_billing_summaries` have `AND (NOT v_all_clients OR NOT public.is_demo_client(client_id))`
- Data routes patched: `care-tickets`, `shipments`, `monitoring/shipments`, `misfits` all call `excludeDemoClients()` in their all-brands branches

**Scripts:**
- `scripts/seed-demo.js` — create demo client + 20 guitar SKUs + demo user
- `scripts/backfill-demo-shipments.js <CLIENT_ID>` — 12 months of shipments (anonymized clones from 4 real clients)
- `scripts/backfill-demo-care.js <CLIENT_ID>` — 1% care tickets with real-sampled language
- `scripts/purge-demo.js [--execute]` — full teardown (delete all `is_demo=true` rows); reversibility guarantee

**Daily refresh:** `/api/cron/refresh-demo` at 02:00 UTC (before 04:00 benchmarks cron). Adds ~1 day of shipments with +/- random(3,77) daily variance and +5%/mo compounding growth. Also advances care ticket lifecycles.

**Demo credentials:** `demo@jetpack3pl.com` / `PaulsBoutique2026!`

**DO NOT** add new cross-client aggregate queries without calling `excludeDemoClients()` (TS) or `is_demo_client()` (SQL).

---

## Update Protocol

After ANY technology/architecture/schema change, update the relevant CLAUDE file immediately. Don't wait to be asked.
