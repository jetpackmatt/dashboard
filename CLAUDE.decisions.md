# Jetpack Dashboard - Decision Log

**Reference for:** Historical context on why decisions were made
**Parent:** [CLAUDE.md](CLAUDE.md)
**Format:** Chronological, append-only

---

## November 21, 2025

### Initial Architecture Decisions

**Next.js 15 with App Router**
- Rationale: Server-side rendering for security, built-in API routes, optimal for dashboard apps

**Supabase for database and auth**
- Rationale: Real-time capabilities, built-in RLS, managed PostgreSQL, auth included

**Vercel for hosting**
- Rationale: Optimal Next.js support, easy deployment, great DX

**Store all Attio data in Supabase**
- Rationale: Performance, real-time updates, reduce API calls

**Subdomain strategy for Webflow integration**
- Rationale: Clean separation, better security, full control

### Authentication Implementation

**Use @supabase/ssr@^0.5.2 (not older versions)**
- Issue: Initial implementation used `@supabase/ssr@0.0.10` which failed to properly persist sessions
- Solution: Updated to `@supabase/ssr@0.5.2` and `@supabase/supabase-js@2.45.4`
- Debugging: Created `/app/dashboard-debug/page.tsx` to inspect server-side cookies, revealed package versioning issue

**Use window.location.href for post-authentication redirects**
- Rationale: Hard redirects ensure cookies are fully loaded before navigation
- Problem: `router.push()` can cause race conditions with cookies

**Use JWT anon key (format: eyJhbGci...), not sb_publishable_ key**
- Rationale: Supabase JS client requires the JWT anon key
- Note: Older Supabase projects may refer to this as "legacy anon key" but it remains correct

**Client-side auth with server-side validation**
- Pattern: `createClient()` for client-side, `createServerClient()` with cookies() for server-side
- Rationale: Client component handles auth UI/UX, server components validate sessions

---

## November 22, 2025

### UI Component Library Strategy

**shadcn/ui as primary component library with official dashboard blocks**
- Previous: Building custom components from scratch with Xenith template inspiration
- Decision: Use shadcn/ui dashboard-01 block (sidebar, charts, data tables, metric cards)
- Result: Faster development, better responsiveness, more maintainable
- Components installed: Button, Card, Table, Badge, Avatar, Dropdown, Drawer, Sheet, Tabs, Toggle, Checkbox, Input, Label, Select, Skeleton, AppSidebar, SiteHeader, ChartAreaInteractive, DataTable, SectionCards, NavMain, NavUser, NavDocuments, NavSecondary

### Data Table Multi-Tab Architecture

**Separate schemas, columns, and table instances for each tab type**
- Rationale: Each domain (Shipments, Additional Services, Returns, Receiving, Storage, Credits) has different data structures
- Pattern: Each tab has own schema, columns array, and useReactTable instance
- Benefits: Independent column customization, type safety per domain, easier maintenance

### Responsive Design Pattern

**Always show tab navigation at all screen sizes**
- Previous: Used responsive Select dropdown on small screens
- Decision: TabsList always visible
- Rationale: Tabs are fundamental navigation - hiding them reduces discoverability

### Design System Guidelines

- Checkbox to Order ID column: `pl-[25px]` for visual breathing room
- Table cell/header padding: `px-4` globally
- Checkbox border: `border-muted-foreground/30`
- Checkbox size: `h-4 w-4` consistent
- Quantities: Mostly 1s, occasional 2s and 3s (realistic)
- Order IDs: Start at 1001+ (professional numbering)

---

## November 23, 2025

### Shared Layout Architecture

**Shared layout pattern for all dashboard pages**
- Implementation: `/app/dashboard/layout.tsx` contains sidebar, header, auth
- Benefits: No full page reloads, sidebar/header static during navigation, faster client-side routing
- Individual pages only contain unique content

### Client-Side Navigation

**Use router.push() for internal navigation (not window.location.href)**
- Rationale: Enables client-side routing, preserves layout, no page reloads
- Exception: window.location.href still used for post-auth redirects

### Page Structure Template

```tsx
// /app/dashboard/[page]/page.tsx
import { SiteHeader } from "@/components/site-header"

export default function PageName() {
  return (
    <>
      <SiteHeader sectionName="Page Name" />
      <div className="flex flex-1 flex-col overflow-x-hidden">
        <div className="@container/main flex flex-1 flex-col gap-2 w-full">
          {/* Page content */}
        </div>
      </div>
    </>
  )
}
```

### Sidebar Responsiveness

**Sidebar collapses at 1280px breakpoint (not 1024px)**
- Desktop (≥1280px): Sidebar open by default
- Tablet (768-1279px): Sidebar collapsed/minimized
- Mobile (<768px): Sidebar in offcanvas mode

### Page Transition Animations

**Bidirectional slide animations between Dashboard and Shipments**
- Dashboard → Shipments: Cards fade out (y: -20), table slides up from y: 700
- Shipments → Dashboard: Table slides down to y: 700, cards fade in with stagger
- Spring animation: `stiffness: 100, damping: 20, mass: 0.8`

### Page Transition Pattern (Reusable)

**sessionStorage + Framer Motion for page transitions**
- Problem: `document.referrer` doesn't work with client-side navigation
- Solution: sessionStorage flags track navigation state

```tsx
// Source page: Set flag before navigation
sessionStorage.setItem('navigatingFromSource', 'true')
setTimeout(() => router.push("/target"), 300)

// Target page: Read flag in useState initializer (NOT useEffect)
const [fromSource] = React.useState(() => {
  if (typeof window !== "undefined") {
    const flag = sessionStorage.getItem('navigatingFromSource')
    if (flag === 'true') {
      sessionStorage.removeItem('navigatingFromSource')
      return true
    }
  }
  return false
})
```

### Table Controls Responsive Priority

**Priority order (highest to lowest):**
1. Tabs bar - Always visible
2. Search field - Always visible, width adjusts
3. Action buttons - Hide below lg (1024px)

### Filters Sidebar

**Filters button with slide-out sidebar**
- Sheet slides from right side
- Placeholder filters: Status, Order Type, Date Range
- Future: Make filters tab-aware and functional

### Data Schema Corrections

**Fixed all tab schemas to match data files**
- Issue: Mismatched column definitions and data structures
- Resolution: Updated schemas for Additional Services, Returns, Storage, Credits

---

## November 24, 2025

### React 18 Performance Pattern

**startTransition API + event loop deferral for heavy computation**
- Use case: Analytics with 40K shipments, city lookups, aggregations
- Problem: Heavy useMemo blocked UI for 1-2 seconds

```typescript
setIsDataLoading(true)
setTimeout(() => {
  startTransition(() => {
    // Heavy state updates
  })
}, 50)
```

- setTimeout(50ms): Allows 3-4 animation frames before computation
- startTransition: Marks updates as non-urgent, keeps UI responsive
- Result: Instant loading indicators, smooth 60fps throughout

### Responsive Table Controls Architecture

**Dynamic responsive controls without horizontal scrolling**
- Problem: Table controls cut off at various widths
- Root cause: ResponsiveSidebarProvider only checked width on mount

**Solution:**
1. Dynamic sidebar with resize listener (controlled `open` state)
2. Buttons always visible (removed `hidden lg:flex`)
3. Button text at 2xl (1536px), icon-only below
4. Renamed "Customize Columns" → "Columns"
5. Button order: Filters, Export, Columns

### Mobile Search

**Inline expansion pattern (not Sheet/modal)**
- Icon button on mobile (<768px)
- Expands inline to full width when clicked
- Shows ChevronLeft + full-width input
- Auto-focuses for immediate typing

### CLAUDE.md Hierarchy

**Multi-file context management**
- CLAUDE.md: Core essentials, routing instructions
- CLAUDE.project.md: Architecture, infra, database
- CLAUDE.analytics.md: Analytics specs, patterns
- CLAUDE.decisions.md: This file (chronological log)
- CLAUDE.local.md: Personal notes (gitignored)

### Analytics Loading Animation Fix

**Fixed double-nested startTransition causing frozen spinner**
- Problem: "Refreshing Data" spinner froze before animating in Order Volume tab
- Root cause: Date range handlers had double-nested `startTransition(() => { startTransition(() => { ... }) })`
- Also: Malformed indentation from bad merge/paste
- Solution: Fixed all ~20 occurrences to use single `setTimeout(() => { startTransition(() => { ... }) }, 50)`
- Result: Spinner animates smoothly during heatmap recalculation

---

## November 25, 2025

### ShipBob Data Ingestion Architecture Clarification

**Webhook vs Billing API roles**
- Context: Documentation incorrectly stated "Webhooks ARE Real-Time Billing"
- Clarification: Webhooks provide EVENT notifications (shipped, delivered, returned), NOT cost data
- Billing API provides actual costs, surcharges, fee breakdowns
- Decision: Webhook-triggered billing lookup architecture
  1. Webhook arrives → Queue job with order_id
  2. Queue worker calls Billing API for that specific order
  3. Apply markup rules → Store complete record
- Rationale: Real-time cost accuracy without polling, rate-limit safe via queue
- Queue tech: BullMQ with rate limiter (120/min, leaving 30/min headroom)

### Credits → Care Central Linkage

**Added care_id field to credits table**
- Context: Credits need to link to Care Central claim tickets
- Implementation: `care_id UUID` field in credits table
- Workflow: When claim created with Order ID, and credit arrives with matching reference → auto-link
- Bidirectional: Can lookup credit from Care ticket, or Care ticket from credit

### Scale Analysis Added

**Architecture validated to ~100K shipments/day**
- Rate limit math: 150 req/min = 216K/day capacity
- At 100K/day: Using ~46% of capacity (even distribution)
- Burst handling: Queue absorbs spikes, graceful degradation if needed
- Mitigations documented: Rate-limited queue, batch lookups (TBD), graceful degradation

### Batch Lookups Verified

**ShipBob Billing API DOES support batch transaction lookups**
- Endpoint: `POST /2025-07/transactions:query`
- Parameter: `reference_ids` accepts an array of order/reference IDs
- Additional filters: `invoice_ids` (array), `transaction_types`, `start_date`, `end_date`
- Max batch size: Not documented - recommend testing incrementally (start with 50)
- Impact: Changes scale from 100K/day to 500K+/day feasible
  - 100K/day: 83 calls/hr (0.9% of limit) vs 4,167 without batching
  - 500K/day: 417 calls/hr (4.6% of limit)
- New bottleneck: Database write throughput, not ShipBob API
- Source: [ShipBob Billing Guide](https://developer.shipbob.com/guides/billing)

### API Test Harness Created

**First successful API connection to ShipBob**
- Created: `lib/shipbob/client.ts` - TypeScript API client
- Created: `scripts/test-shipbob-api.ts` - CLI test script
- Run with: `npx tsx scripts/test-shipbob-api.ts`
- Initial results showed field mapping issues

### API Response Structure Corrected

**ShipBob API uses snake_case for all field names**
- Created debug script to inspect raw responses
- Key corrections:
  - Invoices: `invoice_id`, `invoice_date`, `invoice_type`, `running_balance`
  - Transactions: `transaction_id`, `charge_date`, `invoiced_status`, `transaction_fee`, `reference_id`, `reference_type`, `additional_details.TrackingId`
  - Fee Types: Returns `{ fee_list: string[] }` not array of objects
  - Pagination: Uses cursor-based `next`/`last` strings, not page numbers
- Shipments endpoint doesn't exist - shipment data available via:
  1. Transactions with `reference_type: "Shipment"`
  2. `additional_details.TrackingId` contains tracking number
- Final test results (all passing):
  - ✅ Connection working
  - ✅ Invoices: 5 found, includes Credits, ReturnsFee types
  - ✅ Transactions: 100 found, includes Shipping and Per Pick Fee
  - ✅ Fee Types: 86 fee types returned
  - ✅ Batch Lookup: Successfully fetched 3 transactions by reference_ids
  - ⚠️ Orders API: Working but 0 recent orders in account

### Comprehensive Data Exploration

**All 7 Invoice Types Verified**
- Created `scripts/explore-shipbob-data.ts` for comprehensive API data pull
- Saved raw data to `scripts/output/` for inspection
- Invoice types found: Shipping, AdditionalFee, WarehouseStorage, WarehouseInboundFee, ReturnsFee, Credits, Payment
- 32 invoices in 90 days, 100 transactions in 30 days

**Universal ID Strategy Confirmed: reference_id**
- `reference_id` = Universal linker (Shipment/Order/Return ID)
- `reference_type` = What reference_id refers to ("Shipment", "Return", "Order")
- `transaction_id` = Unique per fee line item (PRIMARY KEY for dedup)
- `invoice_id` = Weekly billing invoice (null until invoiced)

**Multi-Fee Pattern Discovered**
- One shipment generates multiple transaction records
- Example: Shipment #319900667 has Per Pick Fee ($0.26) + Shipping ($6.07)
- Schema must support rollup: `WHERE reference_id = X` to get total cost

**Documentation Updated**
- CLAUDE.data.md: Added verified invoice types, ID strategy, response structures
- Scripts: `explore-shipbob-data.ts` saves JSON files to `scripts/output/`

---

## November 26, 2025

### CRITICAL: Merchant/User ID Not Available via API

**Context:** Dashboard serves a PARENT account structure
- ShipBob bills the parent (Jetpack) for ALL child merchant transactions
- Each child has unique `User ID` and `Merchant Name` (visible in Excel exports)
- API Billing transactions do NOT include these fields

**Investigation Results:**
- Created `scripts/deep-api-search.ts` to test all possible endpoints
- Billing API (2025-07): Works, but no merchant/user fields
- Orders API: Returns 200 OK but empty array (possible permission issue)
- Shipments API: 404 Not Found (endpoint doesn't exist)
- `/merchant`, `/user`, `/account`: All 404
- Channels: Work (341684, 433646) but transactions don't reference them

**Available Fields in Billing Transactions:**
- `transaction_id`, `reference_id`, `reference_type`
- `amount`, `charge_date`, `fulfillment_center`
- `additional_details.TrackingId`

**Missing Fields (present in Excel exports):**
- `User ID` - Child merchant numeric identifier
- `Merchant Name` - Child merchant string name

**Workaround Options:**
1. Build Reference ID → User ID lookup from historic Excel data (limited to historic)
2. Request API enhancement from ShipBob support
3. Check if PAT permissions can be expanded for Orders API access
4. Manual merchant assignment for new transactions

**Impact:** Cannot automatically filter transactions by child merchant via API
**Action Required:** Contact ShipBob support to clarify parent/child API access

### Per-Client Token Storage Architecture

**Context:** Each child merchant needs their own PAT token to access Orders/Shipments API
- Parent PAT only provides consolidated Billing API access
- Child tokens must be stored securely and accessed server-side only

**Options Considered:**
1. **Supabase Vault (pgsodium)** - Column-level encryption
   - Issue: Supabase hosted instances have restricted permissions on crypto functions
   - Errors: `permission denied for function _crypto_aead_det_noncegen`
2. **pgcrypto encryption** - Manual encrypt/decrypt
   - Issue: Key management complexity, still had permission issues
3. **Simple RLS table** - Plain storage with access control
   - Decision: Chosen approach

**Decision:** Simple `client_api_credentials` table with RLS (no encryption layer)

**Rationale:**
- Parent PAT already stored as plain text in `.env.local` - industry standard
- Supabase encrypts all data at rest with AES-256
- RLS with no policies = complete browser access block
- Only `service_role` key (server-side) can read
- Security equivalent to env vars, but scales to N clients
- Simpler = fewer failure points

**Implementation:**
```sql
CREATE TABLE client_api_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'shipbob',
  api_token TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, provider)
);
ALTER TABLE client_api_credentials ENABLE ROW LEVEL SECURITY;
-- No policies = anon/authenticated get nothing
```

**Usage Pattern:**
1. Add client via SQL Editor: `INSERT INTO clients...`
2. Add token via SQL Editor: `INSERT INTO client_api_credentials...`
3. Retrieve in API route via `supabaseAdmin` with `service_role` key

**Status:** Table created, awaiting child account PAT tokens from ShipBob

### Admin Multi-Client Management UI

**Context:** Dashboard serves multiple child merchants. Admins need to:
- Switch between viewing individual client data vs consolidated view
- Manage client API tokens
- Monitor connection health

**Decision:** Implement two admin-only features:

1. **Client Selector Dropdown** (Header)
   - Shows in site-header for admin users only
   - Options: "All Clients", individual client names
   - Selection filters all dashboard views
   - Persisted in localStorage

2. **Admin Settings Page** (`/dashboard/settings`)
   - List all clients with connection status
   - Test connection buttons
   - Token management via secure modal
   - Add new client workflow

**Implementation:**
- API routes: `/api/admin/clients/*` (created)
- Admin client: `lib/supabase/admin.ts` (created)
- UI components: Client selector, settings page (pending)

**Rationale:**
- Admins need consolidated + per-client views
- Token management should be accessible but secure
- Connection testing prevents debugging headaches

### UI Terminology: "Clients" → "Brands"

**Context:** User-facing terminology review
- Internal code/database: `clients` table, `client_id` columns
- User-facing UI: Changed from "Clients" to "Brands"

**Changes Made:**
- Settings tab: "Clients" → "Brands"
- Card title: "Client Management" → "Brand Management"
- Buttons: "Add Client" → "Add Brand"
- Dropdowns: "All Clients" → "All Brands"
- Empty states: "No clients found" → "No brands found"

**Rationale:**
- "Brands" is more intuitive for users
- Database layer unchanged (breaking change avoided)
- Consistent with DTC/e-commerce terminology

### User Role Rename: "admin" → "owner"

**Context:** Role system in `user_clients` table
- Previously: `admin | editor | viewer`
- Now: `owner | editor | viewer`

**Changes Made:**
- TypeScript types in `lib/supabase/admin.ts`
- API validation in `app/api/admin/users/invite/route.ts`
- UI labels in `components/settings-content.tsx`:
  - "Admin (full access)" → "Owner (full access)"

**Rationale:**
- "Admin" conflicted with Jetpack admin concept (`user_metadata.role === 'admin'`)
- "Owner" clearer for brand-level full access
- Pending: Database constraint migration (admin → owner)

### MCP Server for Database Access

**Context:** Enabling Claude to run SQL directly against Supabase
- Configured MCP (Model Context Protocol) server with postgres connector
- Location: `~/.claude/settings.json` (user-level, not project-level)

**Configuration:**
```json
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres", "postgresql://..."]
    }
  }
}
```

**Notes:**
- Project-level `.claude/settings.json` cannot contain `mcpServers` (schema error)
- Connection string includes password in URL format
- Requires Claude Code restart to activate

### MCP Server Update: Deprecated Package → Official Supabase MCP

**Context:** MCP postgres server wasn't working after configuration
**Root cause:** `@modelcontextprotocol/server-postgres` is deprecated/archived
**Solution:** Switched to official Supabase MCP server

**Old config:**
```json
{
  "mcpServers": {
    "supabase": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres", "postgresql://..."]
    }
  }
}
```

**New config:**
```json
{
  "mcpServers": {
    "supabase": {
      "type": "http",
      "url": "https://mcp.supabase.com/mcp?project_ref=xhehiuanvcowiktcsmjr"
    }
  }
}
```

**Benefits:**
- Officially maintained by Supabase community
- HTTP-based (no npx issues)
- Project-scoped for security
- OAuth authentication instead of raw connection string

**Sources:**
- [Supabase MCP Server](https://github.com/supabase-community/supabase-mcp)
- [MCP Servers Repository](https://github.com/modelcontextprotocol/servers)

### MCP Postgres Server - Working Configuration

**Context:** Needed direct database access from Claude Code for migrations and queries.

**Issues encountered:**
1. Supabase HTTP MCP (`mcp.supabase.com`) requires OAuth but popup never triggered
2. Direct connection (`db.*.supabase.co:5432`) - hostname doesn't resolve (IPv4 incompatible)
3. Wrong pooler region - was using `aws-0-us-west-1`, actual region is `aws-1-us-east-1`
4. MCP postgres server is **read-only** - can't run DDL via `mcp__postgres__query`

**Working configuration:**
```bash
npx @anthropic-ai/claude-code mcp add --transport stdio --scope user postgres -- \
  npx -y @modelcontextprotocol/server-postgres \
  "postgresql://postgres.xhehiuanvcowiktcsmjr:[PASSWORD]@aws-1-us-east-1.pooler.supabase.com:5432/postgres"
```

**Key details:**
- Use **Session Pooler** (port 5432), not Transaction Pooler (port 6543)
- Region must match your Supabase project (check Dashboard > Settings > Database)
- MCP server provides read-only access via `mcp__postgres__query` tool
- For write operations (DDL, migrations), use node `pg` client directly

**Migration completed:** `user_clients.role` constraint updated to `('owner', 'editor', 'viewer')`

### Database Schema Created for ShipBob Data

**Tables created via migration script (`scripts/migrate-shipbob-schema.js`):**
- `shipments` - Main order/shipment records with base + marked-up costs
- `transactions` - Billing line items (multiple per shipment)
- `invoices_sb` - ShipBob weekly invoices (costs to us)
- `markup_rules` - Rule-based pricing engine
- `credits` - Refunds/adjustments
- `fee_type_categories` - Fee grouping (pre-seeded with 9 types)
- `webhook_events` - Idempotency tracking

**Also modified:**
- `clients` table: Added `anonymize_after_months` column for GDPR

### Invoice Table Naming Convention

**Context:** Need to distinguish between incoming ShipBob invoices and outgoing Jetpack invoices to clients.

**Decision:** Use suffix naming convention:
- `invoices_sb` - ShipBob invoices (what they bill us, base costs)
- `invoices_jp` - Jetpack invoices (what we bill clients, marked-up costs) - to be created later

**Rationale:**
- Clear distinction between cost tracking vs revenue tracking
- Different schemas (base amounts vs marked-up amounts, Stripe integration)
- Prevents confusion when querying/coding
- `_sb` and `_jp` suffixes are short but unambiguous

---

## November 27, 2025

### Ship Option ID Investigation & Resolution

**Investigation: Why ~49 shipments had NULL ship_option**
- Context: During Henson sync, discovered 46 shipments with NULL `carrier_service` (ship_option)
- Root causes identified:
  1. **14 legacy records**: Old sync used `shipbob_order_id` as upsert key, didn't capture shipment details
  2. **32 stale shipments**: Shipment IDs no longer exist in ShipBob (cancelled/replaced orders)
  3. **5 unmapped services**: Orders API `ship_option` names differ from Shipping Methods API `service_level.name`

**Ship Option ID Discovery**
- `ship_option_id` is the numeric ID (e.g., 146, 49, 3) used in ShipBob's billing system
- NOT directly available in Orders API - requires lookup via `/1.0/shippingmethod` → `service_level.id`
- Naming mismatch problem: Orders API returns "Ground", but Shipping Methods API calls it "Standard (Ground)"

**Decision: Manual fallback mappings for service level names**
- Rationale: ShipBob APIs are inconsistent between Orders and Shipping Methods endpoints
- Implementation: Added manual mapping table in sync script for known mismatches:
  ```javascript
  const manualMappings = {
    'Ground': 3,    // Orders API: "Ground" → Shipping API: "Standard (Ground)"
    '1 Day': 8,     // FedEx 1 Day
    '2 Day': 9,     // FedEx 2 Day
  }
  ```
- Result: 100% ship_option_id coverage achieved after cleanup and re-sync

**Decision: Use `shipment_id` as primary key for shipments table**
- Previous: Some syncs used `shipbob_order_id` (order-level, not shipment-level)
- Problem: One order can have multiple shipments; stale data when orders are modified
- Solution: Always upsert on `shipment_id` for accurate shipment-level tracking
- Added cleanup script to remove orphaned records

### Orders vs Shipments Architecture Decision

**Discovery: One order can have multiple shipments**
- Henson data: 60,431 orders but 60,734 shipments (303 extra)
- 99.9% of orders have 1 shipment, but some have 2-4 shipments
- Causes: split shipments, partial fulfillment, replacement shipments

**Decision: Migrate to order-centric data model**
- Current (wrong): Single `shipments` table mixing order-level and shipment-level data
- Proposed (correct): Separate `orders` and `shipments` tables with proper FK relationship

**Key identifiers (both important):**
| Identifier | Level | Usage |
|------------|-------|-------|
| `shipbob_order_id` | Order | Stable identifier, primary key for orders table |
| `store_order_id` | Order | Customer-facing (Shopify/BigCommerce order #) |
| `shipment_id` | Shipment | Used for claims/disputes, tracking, billing |

**Frontend design implications:**
- Orders page should show orders as primary entity, not shipments
- Multi-shipment orders need visual indicator (badge showing "2 shipments", expandable row)
- Shipment details accessible via drill-down/expansion from order row
- Claims/disputes UI must reference `shipment_id`, not order_id
- Order totals should aggregate across all shipments

### Order Type (B2B vs DTC) Discovery

**Context:** Need to distinguish between Direct-to-Consumer and wholesale/B2B orders for analytics and billing

**Discovery:** ShipBob Orders API provides `type` field with values:
- `DTC` - Direct-to-Consumer orders
- `B2B` - Business-to-Business / wholesale orders

**Additional channel fields captured:**
| Field | Description | Example Values |
|-------|-------------|----------------|
| `order_type` | DTC or B2B | `'DTC'`, `'B2B'` |
| `channel_id` | ShipBob channel numeric ID | `341684`, `433646` |
| `channel_name` | Channel identifier string | `sjconsulting`, `hs-wholesale`, `A3J9TGFX9T7BK0` |
| `reference_id` | External order ID (Shopify/BigCommerce) | `5678901234567` |
| `shipping_method` | Customer-facing shipping option | `Standard Shipping (5 Business Days)` |
| `purchase_date` | Original purchase timestamp | `2025-11-25T14:30:00Z` |

**Henson channel breakdown:**
- `sjconsulting` → DTC orders (Shopify)
- `hs-wholesale` → B2B wholesale orders
- `A3J9TGFX9T7BK0` → Amazon channel (DTC)

**Migration:** `002-add-order-type-fields.sql` added these columns to orders table with indexes

**Sync results after migration:**
- DTC orders: 1,339 (98.8%)
- B2B orders: 7 (0.5%)
- NULL: 9 (0.7% - older orders not yet re-synced)

### Batch Upsert Sync Architecture

**Context:** Original row-by-row sync took 4+ hours for 60K orders with 141,187+ network errors

**Problem:**
- Each upsert was a separate network request
- Supabase connection throttling after thousands of sequential requests
- No error recovery - had to restart entire sync
- No visibility into which records failed

**Decision:** Rewrite sync with batch upserts (500 records per request)

**Implementation:**
- Created `scripts/sync-orders-fast.js` - Main batch sync script
- Created `scripts/find-missing-records.js` - Gap analysis after errors
- Created `scripts/sync-parallel.js` - Parallel date-range workers

**Results:**

| Metric | Old Script | New Script | Improvement |
|--------|-----------|------------|-------------|
| Henson full sync | 4+ hours | 17.8 minutes | **13x faster** |
| Methyl Life sync | ~30 min | 2.4 minutes | **12x faster** |
| Error rate | 141K+ errors | 0 errors | **Perfect** |
| Batch size | 1 record | 500 records | **500x fewer requests** |

**Key design decisions:**
1. **Batch size 500** (not 1000): Better reliability, easier error isolation
2. **Delete+insert for child tables**: Shipment items, cartons use delete+insert pattern to handle updates cleanly
3. **Failed record tracking**: Script saves failed record IDs to JSON for retry
4. **DIM weight calculation**: Country-specific divisors (US: 166, AU: 110, International: 139)

**Rationale:** Batch operations reduce network overhead exponentially. 60K records = 120 requests instead of 60,000.

### Full Historical Backfill Complete

**Context:** Both active clients needed complete historical data synced

**Clients synced:**

| Client | Orders | Shipments | Order Items | Shipment Items | Transactions | Time |
|--------|--------|-----------|-------------|----------------|--------------|------|
| Henson Shaving | 60,568 | 60,871 | 141,351 | 141,790 | 2,579 | 17.8 min |
| Methyl Life | 8,489 | 8,507 | 10,048 | 10,282 | 593 | 2.4 min |
| **Combined** | **69,057** | **69,378** | **151,399** | **152,072** | **3,172** | **~20 min** |

**Key discovery:** Henson started with ShipBob on March 6, 2025 (not 2 years ago as assumed)
- Historical queries before that date return 0 orders
- Sync adjusted to start from March 2025

**Scripts location:** `scripts/sync-orders-fast.js`, `scripts/find-missing-records.js`, `scripts/sync-parallel.js`

### Catalog Sync: Products, Returns, Receiving (Migration 010)

**Context:** Need to sync product catalog, returns, and receiving (WRO) data to support billing transaction details.

**Decision:** Create 3 new tables with JSONB for nested data:
- `products` - Product catalog with variants array as JSONB
- `returns` - Return orders with inventory items as JSONB
- `receiving_orders` - WROs with inventory_quantities as JSONB

**Rationale:**
- JSONB reduces table count (no need for separate variants/items tables)
- Simplifies queries for dashboard display
- Matches ShipBob API structure closely
- Maintains query flexibility with JSONB operators

### ⚠️ CRITICAL: 2025-07 API Endpoint Naming Convention

**Discovery:** After initial 404 errors, discovered ShipBob 2025-07 API uses **SINGULAR** endpoint names:
- `/2025-07/product` ✅ (NOT `/products`)
- `/2025-07/return` ✅ (NOT `/returns`)
- `/2025-07/receiving` ✅

**Lesson Learned:** When API returns 404, troubleshoot the endpoint naming first before assuming the endpoint doesn't exist.

### ⚠️ CRITICAL: Cursor Pagination URL Parsing

**Problem:** Products API returned exactly 50 records for both clients despite having 143 and 89 products respectively.

**Root causes identified:**
1. **Wrong break condition:** `items.length < limit` broke loop when 50 < 250, even with more pages (some endpoints cap at 50 regardless of Limit parameter)
2. **Wrong cursor extraction:** The `next` field is a **URL path** like `/Product?cursor=eyJ...`, not a raw cursor value

**Solution:**
```javascript
// OLD (broken):
if (!cursor || items.length < limit) break
cursor = data.next  // Wrong - passes URL path as cursor

// NEW (fixed):
if (data.next) {
  const nextUrl = new URL(data.next, 'https://api.shipbob.com')
  cursor = nextUrl.searchParams.get('cursor') || nextUrl.searchParams.get('Cursor')
} else {
  cursor = null
}
if (!cursor) break
```

**Results after fix:**
| Client | Products | Returns | Receiving |
|--------|----------|---------|-----------|
| Henson | 143 | 181 | 97 |
| Methyl Life | 89 | 26 | 20 |

---

## November 28, 2025

### Orders/Shipments API Version Migration (1.0 → 2025-07)

**Migrated sync-orders-fast.js and sync-orders-shipments.js from 1.0 to 2025-07 API**
- Context: Discovered that orders/shipments sync scripts were using 1.0 API while other scripts (catalog, transactions) used 2025-07
- Issue: Inconsistent API versions across sync scripts could lead to data format inconsistencies
- Investigation: Tested 2025-07 `/order` endpoint - confirmed field structures are identical (measurements, tracking, zone, location)

**Changes made:**
| Script | Before | After |
|--------|--------|-------|
| sync-orders-fast.js | `1.0/order`, `1.0/shippingmethod` | `2025-07/order`, `2025-07/shipping-method` |
| sync-orders-shipments.js | `1.0/order`, `1.0/shippingmethod` | `2025-07/order`, `2025-07/shipping-method` |

**2025-07 API differences from 1.0:**
- Shipping method endpoint: `/shipping-method` (hyphenated) vs `/shippingmethod`
- Order endpoint: `/order` (singular, same as 1.0)
- Pagination: Returns `total-pages`, `total-count`, `next-page` in response headers
- Response body: Still raw array (same as 1.0), not wrapped in object

**Risk assessment:** LOW - field structures are identical, uses upsert so no data loss

**Note:** Debug/investigation scripts in /scripts still use 1.0 API - this is intentional as they're one-off tools and 1.0 remains backward compatible.

### Webhook API Version Documentation (1.0 vs 2025-07)

**Documented webhook management API differences for future implementation**
- Context: Webhooks haven't been implemented yet, but discovered that webhook APIs differ significantly between 1.0 and 2025-07
- Decision: Use 2025-07 webhook API exclusively when implementing

**Key differences:**

| Aspect | 1.0 API (DEPRECATED) | 2025-07 API (USE THIS) |
|--------|----------------------|------------------------|
| Endpoint | `/1.0/webhook` | `/2025-07/webhook` |
| Pagination | Page-based (`Page`, `Limit`) | Cursor-based (`Cursor`) |
| Response | Raw array | `{ items: [], next, prev }` |

**Topic naming changes:**
| 1.0 Topic | 2025-07 Topic |
|-----------|---------------|
| `order_shipped` | `order.shipped` |
| `shipment_delivered` | `order.shipment.delivered` |
| `shipment_exception` | `order.shipment.exception` |
| `shipment_onhold` | `order.shipment.on_hold` |
| `shipment_cancelled` | `order.shipment.cancelled` |

**Files updated:** CLAUDE.data.md - added webhook management API documentation with code examples

### Data Verification Complete

**All synced data verified against Excel exports:**

| Verification | Result |
|--------------|--------|
| billing_shipments matches Excel unique OrderIDs | ✅ 68,881 = 68,881 |
| API shipments > Excel | ✅ Expected (recent data) |
| Henson exact match | ✅ 60,449 |
| Methyl-Life exact match | ✅ 8,432 |

**Excel row inflation explained:**
- 2,392 Refund rows (not separate shipments)
- 2,389 multi-row orders (same OrderID twice)

**Status:** Ready for frontend wiring

---

## November 30, 2025

### ⚠️ CRITICAL: TanStack Table Column Sizing Does Not Work Reliably

**Context:** Spent significant time debugging why table columns weren't respecting percentage widths. All columns rendered with equal widths (~86px each) regardless of defined percentages.

**Problem:**
- TanStack Table's `column.getSize()` method and `size` property do not reliably translate to CSS widths
- Using `column.getSize()` with `%` suffix (e.g., `${column.getSize()}%`) did not work
- Adding `table-layout: fixed`, `<colgroup>`, inline styles on `<th>` and `<td>` - none of these fixed the issue
- Browser inspector showed all columns had identical computed widths

**Solution: Bypass TanStack Table's sizing system entirely**

```tsx
// Define widths directly - DO NOT use TanStack's size property for rendering
const COLUMN_WIDTHS: Record<string, number> = {
  orderId: 7,
  status: 15,
  customerName: 17,
  // ... etc
}

// Helper function to get width by column ID
function getColumnWidth(columnId: string): string {
  return `${COLUMN_WIDTHS[columnId] || 10}%`
}

// Use in table rendering - reference column.id, not column.getSize()
<col style={{ width: getColumnWidth(column.id) }} />
<th style={{ width: getColumnWidth(header.column.id) }}>
<td style={{ width: getColumnWidth(cell.column.id) }}>
```

**Key implementation details:**
1. Use raw HTML `<table>`, `<thead>`, `<tbody>`, `<tr>`, `<th>`, `<td>` (not shadcn Table components)
2. Set `table-layout: fixed` and `width: 100%` on the table
3. Use `<colgroup>` with `<col>` elements for each column
4. Apply widths to `<col>`, `<th>`, AND `<td>` elements for consistency
5. Add Tailwind classes `overflow-hidden text-ellipsis whitespace-nowrap` for text truncation

**Files affected:**
- `components/transactions/unfulfilled-table.tsx` - Uses `COLUMN_WIDTHS` + `getColumnWidth()`
- `components/data-table.tsx` - Uses `ALL_COLUMN_WIDTHS` + `getColumnWidth()`

**Lesson learned:** TanStack Table is great for data management, sorting, filtering, pagination - but DO NOT rely on its column sizing for CSS layout. Build your own column width system.

---

### Unified Responsive Table System with Column Priority

**Context:** Tables needed responsive column hiding where columns disappear on smaller screens based on priority, not just truncating. Also needed reusable/configurable table components for easy modification.

**Solution: Priority-based responsive column system**

Created a unified system with these components:

1. **`lib/table-config.ts`** - Central configuration
   ```typescript
   interface ColumnConfig {
     id: string
     header: string
     width: number        // Base width percentage
     priority: number     // 1 = highest (always visible), higher = hides first
     defaultVisible?: boolean
   }

   // Breakpoints define max priority visible at each screen size
   breakpoints: { xl: 10, lg: 8, md: 6, sm: 4, xs: 3 }
   ```

2. **`hooks/use-responsive-table.ts`** - Hook for responsive column management
   - Tracks window width and determines current breakpoint
   - Calculates which columns are visible based on priority
   - Handles intersection of user preferences (column selector) and responsive hiding
   - Redistributes widths proportionally when columns hide

3. **`components/transactions/transactions-table.tsx`** - Unified table component
   - Generic component accepting config + cell renderers
   - Handles loading states, pagination, empty states
   - First-column padding preserved for edge-to-edge header backgrounds

4. **`components/transactions/cell-renderers.tsx`** - Cell rendering logic
   - Separate file for easy modification of how each column renders
   - Exports `unfulfilledCellRenderers` and `shipmentCellRenderers`

**Priority assignments:**
- Unfulfilled: Order ID(1), Status(2), Order Date(3), Customer(4), Age(5), Picks(6), SLA Date(7), Type(8), Store ID(9), Channel(10)
- Shipments: Order ID(1), Status(2), Import Date(3), Total Cost(4), Customer(5), Transit(6), Picks(7), Type(8), Delivery Date(9), Store ID(10)
- Optional columns (user must enable): priority 11+

**Files created:**
- `lib/table-config.ts` - Column configs with priorities
- `hooks/use-responsive-table.ts` - Responsive visibility hook
- `components/transactions/transactions-table.tsx` - Unified table component
- `components/transactions/cell-renderers.tsx` - Cell renderers
- `components/transactions/shipments-table.tsx` - Shipments wrapper

**Benefits:**
- Easy to modify column names, widths, priorities in one place
- Columns hide entirely (not truncate) based on screen size
- Width redistribution maintains visual proportions
- User column selector preferences respected alongside responsive hiding
- Foundation for migrating other tables progressively

---

## December 1, 2025

### ShipBob Status Field Architecture

**Understanding status vs status_details for Shipments**
- Context: Status filters on Shipments tab (In Transit, Delivered, Exception, etc.) were returning 0 results
- Problem: For shipped records, the `status` column is always `'Completed'` - the actual tracking status lives in `status_details` JSONB
- Discovery: ShipBob uses `status` for fulfillment lifecycle (Processing → LabeledCreated → Completed) and `status_details` array for carrier tracking (InTransit, Delivered, etc.)
- Solution: Use JSONB queries like `status_details->0->>name.eq.InTransit` for tracking status filters

**Database-level vs Client-side Filtering**
- Issue: Filtering was happening client-side AFTER pagination, showing incorrect counts
- Decision: Move all status filters to database queries using Supabase `.or()` with multiple conditions
- Implementation: Build array of PostgREST filter strings and combine with `query.or(dbFilters.join(','))`
- Result: Correct pagination counts, proper server-side filtering

**Date Range Filtering with JOINs**
- Context: Date filtering on Shipments tab wasn't working because `order_import_date` is on orders table, not shipments
- Solution: Use Supabase `!inner` JOIN syntax: `orders!inner(order_import_date, ...)`
- Then filter with `query.gte('orders.order_import_date', startDate)`
- Key insight: Users expect to filter by order date, not ship date

**Full documentation added to CLAUDE.data.md** - See "Shipment Status Field Architecture" section

---

## December 2, 2025

### PostgreSQL RPC Functions for Computed Filters (Performance Pattern)

**Problem:** Age filter on Shipments tab took 11-30+ seconds because it:
1. Fetched ALL 70K+ shipments from database
2. JOINed with orders table to get `order_import_date`
3. Calculated age in JavaScript: `(delivered_date || NOW()) - order_import_date`
4. Filtered client-side based on age ranges
5. Pagination was useless - had to load everything to filter

**Solution:** Create PostgreSQL RPC function that calculates and filters at database level:

```sql
-- scripts/sql/create-age-filter-function.sql
CREATE OR REPLACE FUNCTION get_shipments_by_age(
  p_client_id UUID,
  p_age_ranges JSONB,  -- e.g., [{"min": 7, "max": null}] for 7+ days
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS TABLE(shipment_id UUID, age_days NUMERIC, total_count BIGINT)
```

**API Implementation Pattern (with graceful fallback):**

```typescript
// Try RPC first
const { data: rpcData, error: rpcError } = await supabase.rpc('get_shipments_by_age', {
  p_client_id: clientId,
  p_age_ranges: ageRanges,
  p_limit: 1000,
  p_offset: 0
})

if (!rpcError && rpcData) {
  // RPC worked! Use the filtered IDs
  matchingShipmentIds = rpcData.map(r => r.shipment_id)
  query = query.in('id', matchingShipmentIds)
} else if (rpcError) {
  // RPC not available - fall back to parallel batch fetching
  console.log('RPC not available, using fallback')
}
```

**Performance Results:**
| Approach | Time | Records Transferred |
|----------|------|---------------------|
| Client-side filter | 11-30+ sec | 70K+ (all) |
| RPC function | ~1.6 sec | 50 (page only) |

**When to Use RPC Functions:**

| Filter Type | RPC Needed? | Why |
|-------------|-------------|-----|
| **Computed values** (age, duration, calculated fields) | ✅ YES | Value doesn't exist in DB, requires JOIN + calculation |
| **Cross-table calculations** (field from table A - field from table B) | ✅ YES | Can't filter without loading both |
| **Simple column filter** (status, carrier, type) | ❌ NO | Use `.eq()`, `.in()`, `.or()` |
| **Date range on existing column** | ❌ NO | Use `.gte()`, `.lte()` |
| **JSONB field query** | ❌ NO | Use `->` / `->>` operators |
| **Full-text search** | ❌ NO | Use `.textSearch()` with GIN index |

**Decision Criteria Checklist:**
1. Does the filter require data from multiple tables? → Consider RPC
2. Is the filter value calculated (not stored)? → Consider RPC
3. Would you need to fetch >1000 records to filter client-side? → Consider RPC
4. Is the calculation expensive (date math, aggregations)? → Consider RPC

**Files Created:**
- `scripts/sql/create-age-filter-function.sql` - SQL for RPC function
- `scripts/create-age-filter-function.js` - Alternative: Direct connection migration script

**Applying to Other Filters:**

Currently, unfulfilled orders table also does client-side age filtering ([unfulfilled-table.tsx:158-173](components/transactions/unfulfilled-table.tsx#L158-L173)). Same RPC function can be reused by:
1. Updating `/api/data/orders/unfulfilled/route.ts` to call `get_shipments_by_age`
2. The RPC function already supports filtering by `shipped_date IS NULL` internally

---

## December 3, 2025

### ⚠️ CRITICAL: Supabase Security Audit & Hardening

**Context:** Supabase Dashboard security linter flagged multiple issues that should have been addressed during development:

**Issues Found:**
1. **RLS Disabled on 23 tables** (ERROR level) - All public tables had Row Level Security disabled
2. **SECURITY DEFINER view** (ERROR level) - `billing_all` view ran with creator permissions, bypassing RLS
3. **4 functions with mutable search_path** (WARN level) - SQL injection vulnerability via path manipulation
4. **26 tables with RLS but no policies** (INFO level) - Intentional, not a problem

**Fixes Applied:**

**1. Enabled RLS on all 23 tables:**
```sql
ALTER TABLE billing_additional_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_receiving ENABLE ROW LEVEL SECURITY;
-- ... (23 tables total)
```

**2. Dropped unused `billing_all` SECURITY DEFINER view:**
```sql
DROP VIEW IF EXISTS billing_all;
```
- Verified not used anywhere in codebase via grep search
- View was a UNION of 6 billing tables created during development, never used

**3. Fixed 4 functions with SET search_path = public:**
- `shipments_search_vector_update()` - Full-text search trigger
- `orders_search_vector_update()` - Full-text search trigger
- `search_to_tsquery()` - Search query parser
- `get_shipments_by_age()` - Age filter RPC function

```sql
CREATE OR REPLACE FUNCTION public.function_name()
RETURNS ...
LANGUAGE plpgsql
SET search_path = public  -- Added this line
AS $function$
...
$function$;
```

**Why This Matters:**
- RLS disabled = anon key could potentially access data directly via PostgREST
- SECURITY DEFINER = queries run with elevated permissions, bypassing RLS
- Mutable search_path = SQL injection risk via schema manipulation

**Actual Risk Assessment:**
- **Low practical risk** - Application only uses service_role in API routes, browser client only used for auth
- **Still critical to fix** - Defense in depth requires multiple security layers
- Security should be built-in, not bolted on as afterthought

**Remaining (Cannot Fix):**
- **Leaked Password Protection** - Requires Supabase Pro plan, not available on Free/Team tier

**Lessons Learned:**
1. Enable RLS immediately when creating ANY table (deny-all default)
2. Always include `SET search_path = public` in function definitions
3. Avoid SECURITY DEFINER views/functions unless absolutely necessary
4. Run `supabase db lint` regularly during development
5. Document security requirements in CLAUDE.md files so they're applied from the start

**Documentation Updated:**
- CLAUDE.project.md - Added "⚠️ MANDATORY Security Implementation Checklist" section
- CLAUDE.decisions.md - This entry
- CLAUDE.md - Added security patterns to Key Patterns section

---

### BUG FIX: ShipBob 2025-07 API Channels Response Format

**Context:** Orders synced after Dec 2 21:05 were missing `application_name`, causing the channel column to show "SJC" (truncated channel_name) instead of the Shopify icon.

**Root Cause Analysis:**

The ShipBob 2025-07 API changed the `/channel` endpoint response format:
- **Old format (1.0 API):** Direct array `[{ id, name, application_name }, ...]`
- **New format (2025-07 API):** Object with items `{ items: [{ id, name, application_name }, ...] }`

Our code expected a direct array:
```javascript
// BUG: channelsRes.json() returns { items: [...] }, not an array
const channels = await channelsRes.json()
for (const ch of channels) {  // Silently iterates over nothing
  channelLookup[ch.id] = ch.application_name
}
```

When iterating over an object with `for...of`, JavaScript doesn't throw an error - it just doesn't iterate, leaving `channelLookup` empty. All orders synced with an empty lookup got `application_name: null`.

**Fix Applied:**

Updated both sync locations to handle both response formats:
```javascript
const channelsData = await channelsRes.json()
// 2025-07 API returns { items: [...] }, extract the array
const channels = Array.isArray(channelsData) ? channelsData : (channelsData.items || [])
```

**Files Modified:**
- [lib/shipbob/sync.ts:198-200](lib/shipbob/sync.ts#L198-L200) - Cron sync
- [app/api/webhooks/shipbob/route.ts:135-137](app/api/webhooks/shipbob/route.ts#L135-L137) - Webhook handler

**Data Recovery:**
- Ran `scripts/backfill-application-name.js` (uses 1.0 API which still works)
- Fixed 289 Henson orders + 34 Methyl-Life orders
- Orders now at 100% with application_name populated

**Lesson Learned:**
When using a versioned API (like `2025-07`), always check the actual response format - it may differ from older versions. The 1.0 API scripts continued working because they use the old endpoint format.

---

## December 4, 2025

### ✅ ShipBob Billing API: Invoice Transactions Endpoint is the Solution

**Context:** We discovered that `POST /transactions:query` has multiple bugs:
1. Pagination cursor returns 100% duplicate data (infinite loop)
2. Date filters are ignored
3. Hard cap of 1,000 records

**Investigation:** Tested `GET /invoices/{id}/transactions` as alternative

**Discovery:** This endpoint WORKS correctly:
- Pagination: ✅ 0 duplicates across 10 pages
- No record cap: ✅ Retrieved all 946 transactions
- Client filtering: ✅ API returns only OUR clients' transactions

**Key Finding - Automatic Client Filtering:**
- Invoice total: $11,127.61 (all Jetpack merchants)
- Transactions returned: $5,340.55 (Henson + Methyl-Life only)
- 100% of returned transactions matched our shipments database
- The 52% "gap" is transactions for OTHER Jetpack merchants

**Decision:** Use invoice-scoped queries as primary transaction sync method
- Weekly Monday sync via `GET /invoices/{id}/transactions`
- Pre-invoice preview via single-page `POST /transactions:query` (max 1,000)

**Impact on Billing Workflow:**
1. Monday morning: Fetch new ShipBob invoices
2. For each invoice: Paginate through all transactions
3. JOIN to shipments table for client_id
4. Generate per-client Jetpack invoices

**Scripts Created:**
- `scripts/test-invoice-transactions.js` - Pagination verification
- `scripts/test-invoice-client-match.js` - Client attribution test
- `scripts/test-invoice-breakdown.js` - Per-client breakdown analysis

---

### ⚠️ CRITICAL: ShipBob API Has 7-Day Rolling Data Window

**Context:** While testing invoice reconciliation on Dec 4, we discovered we were only getting ~48% of expected transaction data for the Dec 1 invoice.

**Investigation:**
1. Tested multiple invoices (Dec 1, Nov 24, Nov 17, Nov 10)
2. Nov 24 and older invoices returned 0 transactions
3. Dec 1 invoice only returned Nov 27 - Dec 1 data (missing Nov 24-26)
4. Watched 6 transactions disappear during the testing session

**Root Cause Confirmed:**
- ShipBob Billing API has a **hard 7-day rolling window** for transaction details
- Today (Dec 4) → earliest data available is Nov 27 (exactly 7 days ago)
- Nov 24-26 data is **permanently inaccessible** via API
- Invoice metadata (totals, dates) survives, but transaction details do not

**Critical Implication:**
- **MUST sync on Monday morning** when invoices are created
- Waiting until Thursday loses ~43% of the invoice period (3 of 7 days)
- Historical data requires Excel import from ShipBob dashboard

**Verified Behavior:**
| Endpoint | Older Than 7 Days |
|----------|-------------------|
| Invoice LIST | ✅ Shows all invoices |
| Invoice DETAILS | ❌ 404 error |
| Invoice TRANSACTIONS | ❌ 200 OK but 0 items |
| POST /transactions:query | ❌ Ignores date filters entirely |

**Action Required:**
1. Set up Monday AM cron job for invoice sync (before 7-day window expires)
2. Use Excel imports for historical billing data
3. Contact ShipBob support about retention policy

---

## December 4, 2025 (continued)

### Two-Phase Transaction Sync Workflow

**Context:** Need to capture all transactions before 7-day API window expires AND ensure perfect reconciliation with ShipBob invoices.

**Previous Approach (problematic):**
- Weekly sync on Monday morning only
- Tried to pull entire week's transactions from invoice endpoint
- Problem: If sync runs late or fails, transactions expire permanently

**New Two-Phase Approach:**

**Phase 1: Continuous Sync (every 15-30 min)**
- POST /transactions:query to capture pending transactions
- Uses filter strategy to bypass API caps
- Stores in `billing_transactions` table
- Links to shipments via reference_id
- Powers "Transactions" tab with running unbilled totals

**Phase 2: Monday Invoice Verification**
- GET /invoices to fetch new ShipBob invoices
- GET /invoices/{id}/transactions to get official invoice transactions
- Match against our DB, attach invoice_id
- Verify totals match ShipBob's amounts
- Generate Jetpack invoices ONLY for verified charges

**Filter Strategy for API Caps:**
- Discovered different filters access different transaction pools
- Testing showed: Single query max 250, combined filters got 273 (+9%)
- Strategy: Query each transaction_type and reference_type separately, deduplicate

**Benefits:**
1. No data loss from 7-day window
2. Client transparency (running totals visible in dashboard)
3. Perfect reconciliation (only invoice what ShipBob billed)
4. Audit trail (every transaction linked to ShipBob invoice)

**Implementation:** See CLAUDE.billing.md "Transaction Sync & Invoicing Workflow"

---

### ShipBob Billing API - Correct Parameter Names

**Context:** POST /transactions:query was only returning ~250-500 transactions when 2,500+ were expected.

**Root Cause:** The ShipBob billing GUIDE documentation has WRONG parameter names:
- Guide says `start_date`/`end_date` → Actually `from_date`/`to_date`
- Guide says `limit`/`offset` → Actually `page_size` and `Cursor` (as query param)

**Discovery Process:**
1. Guide documentation showed `start_date`/`end_date` - didn't work
2. Fetched full API reference from https://developer.shipbob.com/api-reference/2025-07/billing/search-transactions
3. Found correct params: `from_date`, `to_date`, `page_size`, `Cursor`

**Working Configuration:**
```javascript
// Cursor in QUERY string, not body!
let url = `${BASE_URL}/2025-07/transactions:query`
if (cursor) url += `?Cursor=${encodeURIComponent(cursor)}`

body: {
  invoiced_status: false,  // Unbilled only
  page_size: 1000,         // Max (not "limit"!)
  from_date: '2025-12-01T00:00:00Z',  // ISO 8601 (not "start_date"!)
  to_date: '2025-12-04T23:59:59Z',
}
```

**Results with correct params:**
- Unbilled transactions: 2,629 (was getting ~270 before)
- All transactions: 6,448
- Pagination works perfectly, 0 duplicates

**Lesson:** Always verify against full API reference, not just guide docs.

### API Field Structure Discovery (Fee Breakdown)

**Context:** Needed to understand if API provides `fulfillment_cost`, `surcharge`, `pick_fees` breakdown like Excel exports.

**Discovery:** The API does NOT provide pre-computed breakdown fields. Instead, each fee component is a **SEPARATE TRANSACTION** with the same `reference_id`:

```
Shipment #310571505:
├── transaction_fee: "Shipping"           → $8.10
├── transaction_fee: "B2B - Each Pick Fee" → $3.60
└── transaction_fee: "B2B - Label Fee"     → $0.50
                                    Total: $12.20
```

**Key findings:**
- 6,807 of ~10K shipments have MULTIPLE transactions
- API response has 15 fields (see CLAUDE.data.md for complete list)
- `additional_details` JSONB varies by invoice_type
- TrackingId available in additional_details for Shipping transactions
- CreditReason/TicketReference available for Credits
- Surcharges may be baked into base Shipping amount (no explicit surcharge transactions found)

**Table structure decision:**
- Use existing `transactions` table for API sync (one row per fee)
- Keep `billing_*` tables for historical Excel imports
- Create views/RPCs to aggregate breakdown when needed

**Implications:**
1. No Excel imports needed going forward - API provides full data
2. Aggregation queries required to compute per-shipment totals
3. For enrichment (channel, products, quantity), JOIN with `shipments`/`orders` tables

### Surcharge Breakdown - VERIFIED Not in API

**Context:** User asked to keep looking for surcharge breakdown in API data.

**Investigation:**
1. Deep search of all transactions for keywords: surcharge, DIM, residential, DAS, fuel, peak, oversize
2. Cross-referenced Excel shipments (with surcharges) against API transactions

**Finding:** Surcharge is **BAKED INTO the Shipping transaction amount**:

```
Excel Order 320860433:
  Fulfillment: $5.97
  Surcharge:   $0.15
  Pick Fees:   $0.26
  Total:       $6.38

API for same order:
  Shipping:      $6.12 (= fulfillment + surcharge combined!)
  Per Pick Fee:  $0.26
  Total:         $6.38 ✅
```

**Verified formula:** `API "Shipping" = Excel fulfillment_cost + Excel surcharge`

**Decision:** For surcharge breakdown specifically, Excel imports are REQUIRED.
API provides correct totals, but not the fulfillment vs surcharge split.

---

## Template for New Entries

```markdown
## [Date]

### [Decision Category]

**[Decision Title]**
- Context: What prompted this decision
- Options considered: What alternatives existed
- Decision: What was chosen
- Rationale: Why this was the best choice
- Implementation: Key details if relevant
```

---

*This file is append-only. Add new decisions at the bottom with date headers.*
