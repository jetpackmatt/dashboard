# Jetpack Dashboard - Claude Context

**Project:** Jetpack Dashboard - Secure web app for 3PL/fulfillment billing, analytics, and support
**Owner:** Matt McLeod | **Company:** Jetpack (3PL/Fulfillment Services)
**Started:** November 2025 | **Status:** Phase 1 Complete (Auth + Analytics MVP)

---

## Quick Context

Jetpack is a 3PL/fulfillment company serving D2C businesses (1K-50K orders/month). This dashboard provides:
- **Clients:** Analytics, billing, support tickets, reporting
- **Admins:** Billing automation, approval workflows, client management

Infrastructure partner is ShipBob (warehouses, systems) - we white-label their platform as "Jetpack."

---

## Tech Stack (One-Liners)

| Layer | Choice | Why |
|-------|--------|-----|
| Framework | Next.js 15 + App Router | SSR security, API routes, TypeScript |
| Database | Supabase (PostgreSQL) | Real-time, RLS, managed auth |
| UI | shadcn/ui + Tailwind | Accessible, customizable, fast |
| Charts | Recharts (via shadcn) | React-native, composable |
| Auth | Supabase Auth + cookies | SSR-compatible sessions |
| Payments | Stripe | PCI compliance, portals |
| Hosting | Vercel | Next.js optimized |

---

## Sub-Context Files

**Read these based on what you're working on:**

| File | When to Read | Contains |
|------|--------------|----------|
| [CLAUDE.project.md](CLAUDE.project.md) | Architecture, infra, security, database work | Full tech stack, security requirements, database schema, integrations, dev phases |
| [CLAUDE.analytics.md](CLAUDE.analytics.md) | Analytics section work | Report specs, chart implementations, performance patterns, data schemas |
| [CLAUDE.data.md](CLAUDE.data.md) | ShipBob API, database schema, data imports | Data strategy, webhook integration, billing API, GDPR compliance |
| [CLAUDE.billing.md](CLAUDE.billing.md) | **Markup rules, invoicing, admin billing** | Markup engine, invoice generation, approval workflow, PDF/XLS formats |
| [CLAUDE.billingtesting.md](CLAUDE.billingtesting.md) | **Testing markup engine and invoices** | Test scripts, validation criteria, reference XLSX comparison |
| [CLAUDE.decisions.md](CLAUDE.decisions.md) | Need historical context on why something was done | Chronological decision log with rationale |
| CLAUDE.local.md | N/A (personal notes) | Not in git - Matt's personal scratchpad |

---

## Update Protocol

**After ANY of the following, Claude MUST update the appropriate file immediately:**

| Event | Update This File |
|-------|------------------|
| Technology/library choice | CLAUDE.decisions.md + relevant section file |
| Architecture change | CLAUDE.project.md + CLAUDE.decisions.md |
| Analytics implementation detail | CLAUDE.analytics.md |
| Database schema, ShipBob API | CLAUDE.data.md |
| Markup rules, invoicing, billing workflow | CLAUDE.billing.md |
| New pattern or best practice | Relevant section file |
| Process/workflow change | CLAUDE.md (this file) |
| Bug fix with learning | CLAUDE.decisions.md |

**Do not wait to be asked. Propose the update immediately after the decision is made.**

Example: "I'll add this Redis caching decision to CLAUDE.decisions.md now."

---

## Current State (Update This Section)

### What's Working
- Authentication (login/signup/logout with Supabase)
- Protected routes with middleware
- Dashboard layout with responsive sidebar
- **Transactions section** (`/dashboard/transactions`) with 7 tabs:
  - Unfulfilled, Shipments, Additional Services, Returns, Receiving, Storage, Credits
  - Unified `TransactionsTable` component with config-driven responsive column hiding
  - Priority-based column visibility (lower priority = stays visible longer on narrow screens)
- Analytics section (7 tabs, 34 charts, 40K sample shipments)
- Page transitions with Framer Motion
- **Multi-Brand Management (Admin)**
  - Brand selector dropdown in header (admin only)
  - Settings page with tabs: Profile, Users, Brands, Dev Tools
  - User invite system with role assignment
  - Brand API token management and connection testing
- **User Management**
  - Invite users by email with role assignment
  - Link users to brands with roles: owner/editor/viewer
  - View all users and their brand assignments
- **Profile Settings**
  - Update display name and email
  - Change password
- **Brand Management (Manage dialog)**
  - Edit brand details (company name, ShipBob user ID)
  - Add/update/delete API tokens
  - Delete brands (soft delete)

### Current Focus
- **Phase 2: Billing & Invoicing System** (see [CLAUDE.billing.md](CLAUDE.billing.md))
  - Admin section with Markup Tables and Run Invoicing tabs
  - Invoice generation (PDF + XLS) with approval workflow
  - Weekly cron job (Mondays 6pm EST)
- MCP postgres server connected for direct database access (read-only queries via `mcp__postgres__query`)

### Known Issues
- None currently blocking

### Terminology
- **Database:** `clients` table, `client_id` columns
- **UI:** "Brands" (user-facing), "Brand Management", "All Brands"
- **User Roles:** `owner` | `editor` | `viewer` (not admin/editor/viewer)
- **Jetpack Admin:** Internal Jetpack staff (detected via `user_metadata.role === 'admin'`)

---

## Key Patterns (Quick Reference)

### ⚠️ Security (MANDATORY - Read CLAUDE.project.md for full checklist)
```sql
-- ALWAYS enable RLS when creating tables
CREATE TABLE new_table (...);
ALTER TABLE new_table ENABLE ROW LEVEL SECURITY;

-- ALWAYS set search_path in functions
CREATE OR REPLACE FUNCTION my_func()
RETURNS void LANGUAGE plpgsql
SET search_path = public  -- REQUIRED
AS $function$ ... $function$;

-- NEVER use SECURITY DEFINER views
-- NEVER query data from browser client (only auth)
```

### Authentication
```typescript
// Client-side: createClient() - ONLY for auth, never data queries
// Server-side: createServerClient() with cookies()
// Post-auth redirects: Use window.location.href (not router.push)
// JWT anon key format: eyJhbGci... (NOT sb_publishable_)
```

### Page Structure
```tsx
// All pages under /app/dashboard/ use shared layout
// Each page includes <SiteHeader sectionName="Page Name" />
// Layout handles auth - pages just render content
```

### Heavy Computation (40K+ records)
```typescript
// Use React 18 startTransition for smooth UI
setIsLoading(true)
setTimeout(() => {
  startTransition(() => { /* heavy state updates */ })
}, 50)
```

### Navigation
```typescript
// Internal: router.push() for client-side routing
// Post-auth: window.location.href for full cookie reload
```

### Database Filters (Computed Values)
```typescript
// If filter requires calculation (age = NOW() - order_date):
// DON'T: Fetch all records and filter client-side (destroys pagination)
// DO: Use PostgreSQL RPC function to calculate/filter at database level
// See CLAUDE.data.md "API Query Performance Patterns" for full guide
const { data } = await supabase.rpc('get_shipments_by_age', {
  p_client_id: clientId,
  p_age_ranges: [{ min: 7, max: null }]  // "7+ days"
})
```

---

## Common Commands

```bash
npm run dev          # Start dev server (localhost:3000)
npm run build        # Production build
npm run lint         # ESLint check
```

---

## File Structure (Key Locations)

```
/app/dashboard/           # All dashboard pages
  layout.tsx              # Shared layout (sidebar, auth)
  page.tsx                # Main dashboard (overview)
  analytics/page.tsx      # Analytics section (7 tabs, sample data)
  transactions/page.tsx   # Transactions section (7 tabs, DB data)
  settings/page.tsx       # Settings (Profile, Users, Brands, Dev)
/app/api/admin/           # Admin-only API routes
  clients/route.ts        # GET/POST clients (brands)
  clients/[clientId]/     # Single client operations
    route.ts              # GET/PATCH/DELETE client
    token/route.ts        # GET/POST/DELETE API token
    test-connection/      # Test ShipBob API token
  users/
    route.ts              # GET all users with brand assignments
    invite/route.ts       # POST invite user to brand
/app/api/auth/            # Auth API routes
  profile/route.ts        # GET/PATCH user profile
  password/route.ts       # POST change password
/components/              # Reusable components
  ui/                     # shadcn/ui components
  app-sidebar.tsx         # Main navigation
  client-context.tsx      # React Context for brand selection (admin)
  client-selector.tsx     # Brand dropdown (header, admin only)
  settings-content.tsx    # Settings page tabs and forms
  data-table.tsx          # Transactions page container (7 tabs)
  dashboard-content.tsx   # Dashboard cards/charts
  transactions/           # Transaction table components
    transactions-table.tsx    # Unified table (config-driven, responsive)
    cell-renderers.tsx        # Cell renderers for each tab type
/lib/
  table-config.ts         # Column configs for all 7 tabs
  analytics/              # Analytics data & utils
  supabase/
    server.ts             # createClient() for server components
    client.ts             # createBrowserClient() for client components
    admin.ts              # createAdminClient() with service_role key
```

---

## Critical Reminders

1. **🚨 ALWAYS check CLAUDE.md files for next steps** - NEVER guess what's next. BEFORE suggesting next steps or asking "what's next", MUST read CLAUDE.data.md, CLAUDE.billing.md, and CLAUDE.project.md to find Implementation Phases. This applies AFTER EVERY CONTEXT COMPACTION - re-read these files immediately. NON-NEGOTIABLE.
2. **⚠️ Security first** - Enable RLS on ALL new tables, SET search_path in ALL functions (see CLAUDE.project.md)
3. **Never commit secrets** - Use .env.local
4. **Server components by default** - "use client" only when needed
5. **No browser data queries** - client.ts is for auth ONLY, all data via API routes with service_role
6. **Update context files** - After every significant decision
7. **Test responsive** - Sidebar collapses at 1280px
8. **Supabase SSR** - Use @supabase/ssr@^0.5.2+ (older versions have cookie bugs)

---

*This file is read at the start of every Claude Code session. Keep it lean. Details go in sub-files.*
