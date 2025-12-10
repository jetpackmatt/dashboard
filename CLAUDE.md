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
