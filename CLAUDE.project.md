# Jetpack Dashboard - Project Architecture

**Reference for:** Architecture, infrastructure, security, database, and integration work
**Parent:** [CLAUDE.md](CLAUDE.md)

---

## Technology Stack (Detailed)

### Frontend Framework
- **Next.js 15.0.3** with App Router
  - Server-side rendering for security
  - API routes for backend logic
  - Optimized performance and SEO
  - TypeScript for type safety

### Database & Backend
- **Supabase** (PostgreSQL)
  - `@supabase/supabase-js@^2.45.4` - Core Supabase client
  - `@supabase/ssr@^0.5.2` - Server-side rendering support with cookie handling
  - Real-time capabilities for ticket updates
  - Built-in authentication with Row Level Security (RLS)
  - RESTful APIs and real-time subscriptions
  - Automatic API generation from schema
  - **Important:** Use JWT anon key (format: `eyJhbGci...`), NOT `sb_publishable_` key

### Styling & UI
- **Tailwind CSS** - Utility-first CSS framework
- **shadcn/ui** - Primary component library (installed and configured)
  - Official dashboard blocks used as foundation
  - Fully responsive, accessible components
  - Customizable with Tailwind
  - Includes charts, tables, cards, forms, etc.
- **Recharts** (via shadcn/ui charts) - Data visualization

### Authentication & Security
- **Supabase Auth** with RLS policies
- **JWT tokens** for session management (use JWT anon key, not publishable key)
- **Cookie-based sessions** via `@supabase/ssr` for SSR compatibility
- **Middleware** for automatic token refresh on every request
- **Multi-factor authentication** for admin accounts (planned)
- **Encrypted environment variables** for sensitive keys

### Payment Processing
- **Stripe** - PCI-compliant payment processing
- **Stripe Customer Portal** for payment management

### Integrations
- **ShipBob API** - Order data, inventory, shipping
- **Attio API** - Support ticket management
- **Stripe API** - Payment processing

### Hosting & Deployment
- **Vercel** - Next.js optimized hosting
- **Supabase Cloud** - Managed database
- **Custom subdomain** (dashboard.shipwithjetpack.com)

---

## Security Requirements

### Critical Security Principles
1. **Encryption at Rest & Transit** - All sensitive data encrypted
2. **Row Level Security (RLS)** - Database-level access control
3. **Role-Based Access Control (RBAC)** - Admin vs. Client permissions
4. **API Key Management** - Secure storage in environment variables
5. **Audit Logging** - Track all billing and data access operations
6. **PCI Compliance** - Stripe handles card data (never stored locally)
7. **Rate Limiting** - Prevent API abuse
8. **Input Validation** - Sanitize all user inputs

### Data Protection
- Customer PII (Personally Identifiable Information)
- Order details and shipping information
- Invoice and billing data
- Payment information (handled by Stripe only)

---

## ⚠️ MANDATORY Security Implementation Checklist

**These requirements are NON-NEGOTIABLE. Apply them during development, not as an afterthought.**

### 1. Supabase Row Level Security (RLS)

**ALWAYS enable RLS immediately when creating ANY table:**
```sql
-- CORRECT: Enable RLS in same statement as table creation
CREATE TABLE new_table (...);
ALTER TABLE new_table ENABLE ROW LEVEL SECURITY;
-- No policies = deny-all by default (blocks anon key access)
```

**Why:** RLS with no policies is a deny-all default. This blocks direct PostgREST access via the `anon` key while `service_role` (used in API routes) bypasses RLS entirely.

**Check existing tables:**
```sql
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public' AND NOT rowsecurity;
```

### 2. PostgreSQL Function Security

**ALWAYS set explicit search_path when creating functions:**
```sql
-- CORRECT: Explicit search_path prevents SQL injection via path manipulation
CREATE OR REPLACE FUNCTION my_function()
RETURNS void
LANGUAGE plpgsql
SET search_path = public  -- REQUIRED
AS $function$
BEGIN
  -- function body
END;
$function$;
```

**Why:** Without explicit search_path, attackers could create objects in user schemas that shadow system functions.

### 3. View Security

**NEVER use SECURITY DEFINER on views unless absolutely necessary:**
```sql
-- DANGEROUS: Runs with creator's permissions, bypasses RLS
CREATE VIEW my_view WITH (security_invoker = false) AS SELECT ...

-- SAFE: Runs with querying user's permissions
CREATE VIEW my_view WITH (security_invoker = true) AS SELECT ...
-- Or simply don't create the view if not needed
```

**Why:** SECURITY DEFINER views execute with the permissions of the view creator, bypassing RLS policies.

### 4. Client-Side Code Restrictions

**NEVER use the browser Supabase client for data queries:**
```typescript
// lib/supabase/client.ts - ONLY for authentication
// ❌ FORBIDDEN: Browser-side data fetching
const { data } = await createClient().from('orders').select('*')

// ✅ CORRECT: All data access via API routes using service_role
// app/api/data/orders/route.ts
const supabase = createAdminClient() // Uses service_role key
const { data } = await supabase.from('orders').select('*')
```

**Current client.ts usage (verified safe):**
- `LoginForm.tsx` - auth.signInWithPassword
- `LogoutButton.tsx` - auth.signOut
- These are the ONLY acceptable uses

### 5. API Route Security

**All data-fetching API routes MUST:**
1. Use `createAdminClient()` (service_role) for database access
2. Validate user authentication via session check
3. Validate user authorization (check client_id access)
4. Sanitize all input parameters
5. Return only necessary data (no `SELECT *` without reason)

### 6. Regular Security Audits

**Run Supabase linter regularly:**
```bash
# In Supabase Dashboard: Database → Linter
# Or via CLI if available
```

**Check for:**
- Tables with RLS disabled (ERROR)
- SECURITY DEFINER views/functions (ERROR)
- Functions without SET search_path (WARN)
- RLS enabled but no policies (INFO - usually intentional)

### 7. Secrets Management

**NEVER commit secrets. Required in `.env.local` only:**
```
SUPABASE_SERVICE_ROLE_KEY=  # Server-side only, never expose
NEXT_PUBLIC_SUPABASE_ANON_KEY=  # Safe for browser (with RLS)
SHIPBOB_API_TOKEN=  # Server-side only
```

### 8. Defense in Depth

Even when one layer protects data, add additional layers:
- API routes validate auth → AND RLS blocks direct access
- service_role bypasses RLS → BUT only used in authenticated API routes
- anon key is public → BUT RLS denies all data access

---

## Feature Requirements

### 1. Internal Admin Panel
**Purpose:** Billing automation and approval workflows

**Features:**
- Fetch raw data from ShipBob API
- Apply custom markup rules to specific charges
- Pass through other charges unchanged
- Generate detailed XLS with line-item charges
- Generate PDF invoice summary with broad categories
- Approval workflow with audit trail
- Manual override capabilities with justification logging
- Historical billing data access

**Security Considerations:**
- Admin-only access (strict authentication)
- Approval workflows with multi-person verification
- Immutable audit logs
- Failsafes to prevent duplicate billing

### 1b. Admin Features - Multi-Brand Management

> **Terminology:** Database uses `clients` table, but UI displays "Brands" to users.

**Brand Selector (Header Component)** - `components/client-selector.tsx`
Admin users see a dropdown in the header to switch context between brands:
```
┌─────────────────────────────────────────┐
│  Viewing Data For                       │
│  ─────────────────────────────────────  │
│  • All Brands (consolidated)     ✓      │
│  ─────────────────────────────────────  │
│  • Henson Shaving                       │
│  • Methyl-Life®                    ●    │  (● = no API token)
└─────────────────────────────────────────┘
```
- Selecting a brand filters ALL dashboard views (shipments, analytics, billing)
- "All Brands" shows consolidated parent account view
- Non-admin users see only their assigned brand (no dropdown)
- React Context (`ClientProvider`) manages selection state

**Admin Settings Page** (`/dashboard/settings`) - `components/settings-content.tsx`
Tabs: Profile | Users | Brands | Dev Tools (dev only)

**Users Tab:**
- View all platform users with their brand assignments
- Invite new users by email with role assignment
- Roles: `owner` (full access) | `editor` (can edit) | `viewer` (read-only)

**Brands Tab:**
```
┌─────────────────────────────────────────┐
│  Brand Management                       │
│  Manage brand ShipBob API connections   │
├─────────────────────────────────────────┤
│  Henson Shaving (386350)                │
│  └─ API Status: ✅ Connected            │
│  └─ [Test Connection] [Edit Token]      │
│                                         │
│  Methyl-Life® (392333)                  │
│  └─ API Status: ⚠️ Token Missing        │
│  └─ [Add Token]                         │
│                                         │
│  [+ Add Brand]                          │
└─────────────────────────────────────────┘
```

**API Routes (Implemented)**
- `GET /api/admin/clients` - List all brands with token status
- `POST /api/admin/clients` - Create new brand
- `GET /api/admin/clients/[clientId]` - Get single brand details
- `POST /api/admin/clients/[clientId]/test-connection` - Test ShipBob token
- `GET /api/admin/users` - List all users with brand assignments
- `POST /api/admin/users/invite` - Invite user to a brand

**Implementation Files**
- `lib/supabase/admin.ts` - Admin Supabase client with service_role key
  - `getClientsWithTokenStatus()` - Brands with API status
  - `createNewClient()` - Add new brand
  - `inviteUser()` - Create auth user and link to brand
  - `getUsersWithClients()` - All users with assignments
- `components/client-context.tsx` - React Context for brand selection
- `components/client-selector.tsx` - Header dropdown
- `components/settings-content.tsx` - Settings page UI

**Role System**
- **Jetpack Admin:** `user.user_metadata?.role === 'admin'` - Jetpack staff
- **Brand User Roles** (in `user_clients` table):
  - `owner` - Full access to their brand
  - `editor` - Can edit but not admin functions
  - `viewer` - Read-only access

**Database Tables**
- `clients` - Brand records (company_name, shipbob_user_id, is_active)
- `client_api_credentials` - ShipBob API tokens per brand (encrypted)
- `user_clients` - Links users to brands with role

**Role Constraint** (migrated Nov 26, 2025)
```sql
-- Roles: owner | editor | viewer
CONSTRAINT user_clients_role_check CHECK (role IN ('owner', 'editor', 'viewer'))
```

### 2. Client Dashboard

#### A. Overview Section
- High-level analytics (orders, revenue, shipments)
- Visual charts and graphs (line, bar, pie)
- Date range filtering
- Key performance indicators (KPIs)

#### B. Reporting Section
- Multiple report types: Order history, Inventory, Shipping performance, Cost breakdown
- Visual charts + downloadable data (CSV/XLS)
- Custom date ranges
- Export functionality

#### C. Jetpack Care (Support Tickets)
- Table view of all support tickets
- Status indicator (color-coded), Ticket ID, Issue type, Tracking number, Dates, Assigned rep
- Filter by status (Outstanding / Resolved)
- Real-time updates from Attio

#### D. Billing Section
- Table of all invoices (current + historical)
- Invoice date, number, amount, status, PDF/XLS downloads
- Outstanding balance display (prominent)
- "Pay Now" button → Stripe payment flow
- Payment history
- Auto-pay enrollment option

#### E. Orders Section (formerly "Shipments")

> **Data Model:** Orders are the stable entity. One order can have multiple shipments.
> Henson example: 60,431 orders → 60,734 shipments (~0.5% have multiple shipments)

**Primary View: Orders Table**
```
┌────────────────────────────────────────────────────────────────────────────┐
│ Order #    │ Date       │ Customer     │ Status    │ Shipments │ Total    │
├────────────────────────────────────────────────────────────────────────────┤
│ 497972     │ 2025-11-26 │ John Smith   │ Fulfilled │     1     │ $12.50   │
│ 496126  ▼  │ 2025-11-20 │ Jane Doe     │ Fulfilled │  ⓶ 2     │ $28.75   │  ← Expandable
│ ├─ Shipment 320154270  │ Completed │ USPS Ground │ $14.25   │
│ └─ Shipment 320154271  │ Completed │ USPS Ground │ $14.50   │
└────────────────────────────────────────────────────────────────────────────┘
```

**Key UX Elements:**
- Multi-shipment badge: Orders with 2+ shipments show count badge (e.g., "⓶ 2")
- Expandable rows: Click to reveal individual shipment details
- Order totals: Aggregate costs across all shipments
- Search: By order # (`store_order_id`) or ShipBob order ID (`shipbob_order_id`)

**Key Identifiers (both visible to users):**
| Field | Display Name | Usage |
|-------|--------------|-------|
| `store_order_id` | "Order #" | Customer-facing (Shopify/BigCommerce) |
| `shipment_id` | "Shipment ID" | Required for claims/disputes with carriers |
| `shipbob_order_id` | "ShipBob Order" | Internal reference (can hide from most users) |

**Claims/Disputes Flow:**
- User selects a SHIPMENT (not order) to file a claim
- Shipment ID is required field in claim forms
- Claims reference `shipment_id`, which maps to carrier records

---

## Integration Requirements

### ShipBob API
**Purpose:** Fetch order, inventory, and shipping data

**Data Flow:**
1. Scheduled jobs fetch data from ShipBob API
2. Data processed and stored in Supabase
3. Custom markup logic applied for billing
4. Data served to dashboard via Next.js API routes

**Key Endpoints:** Orders, Inventory, Shipments, Receiving, Returns

### Attio Integration
**Purpose:** Support ticket management system

**Data Flow:**
1. Internal team creates/updates tickets in Attio
2. Webhook or polling mechanism syncs to Supabase
3. Real-time updates pushed to client dashboard
4. Clients view tickets (read-only) in Jetpack Care section

**Implementation Options:**
- Attio Webhooks → Next.js API route → Supabase
- Scheduled sync job (polling Attio API every 1-5 minutes)

**Storage Strategy:**
- Store ALL Attio data in Supabase for performance
- Attio remains the source of truth for editing
- Dashboard displays cached data from Supabase

### Stripe Integration
**Purpose:** Secure payment processing

**Features:**
- One-time payments for outstanding invoices
- Payment method storage (optional)
- Payment history
- Receipt generation
- Webhook handling for payment confirmations

**Security:**
- Never store card details locally
- Use Stripe Elements for PCI compliance
- Webhook signature verification

---

## Database Schema

### Core Tables

#### `users`
- `id` (UUID, primary key)
- `email` (unique)
- `role` (admin | client)
- `created_at`
- `last_login`

#### `clients` (UI: "Brands")
- `id` (UUID, primary key)
- `company_name`
- `shipbob_user_id` (ShipBob merchant ID)
- `is_active` (boolean, default true)
- `created_at`

#### `client_api_credentials`
- `id` (UUID, primary key)
- `client_id` (FK → clients, ON DELETE CASCADE)
- `provider` (text, default 'shipbob')
- `api_token` (text, encrypted at rest by Supabase)
- `created_at`
- UNIQUE(client_id, provider)
- RLS enabled, no policies = server-only access via service_role

#### `user_clients`
- `id` (UUID, primary key)
- `user_id` (UUID, FK → auth.users)
- `client_id` (FK → clients)
- `role` ('owner' | 'editor' | 'viewer') ← constraint pending migration
- `invited_by` (UUID, FK → auth.users, nullable)
- `created_at`
- UNIQUE(user_id, client_id)

#### `invoices`
- `id` (UUID, primary key)
- `client_id` (foreign key)
- `invoice_number` (unique)
- `invoice_date`
- `due_date`
- `total_amount`
- `status` (draft | sent | paid | overdue)
- `pdf_url`
- `xls_url`
- `created_by` (admin user_id)
- `approved_by` (admin user_id)
- `approved_at`

#### `invoice_line_items`
- `id` (UUID, primary key)
- `invoice_id` (foreign key)
- `description`
- `quantity`
- `unit_price`
- `markup_applied` (boolean)
- `markup_percentage`
- `total`

#### `support_tickets`
- `id` (UUID, primary key)
- `client_id` (foreign key)
- `attio_ticket_id` (unique)
- `ticket_number`
- `status` (open | in_progress | resolved | closed)
- `issue_type`
- `tracking_number`
- `description`
- `created_at`
- `updated_at`
- `resolved_at`

#### `shipbob_orders`
- `id` (UUID, primary key)
- `client_id` (foreign key)
- `shipbob_order_id` (unique)
- `order_number`
- `order_date`
- `ship_date`
- `tracking_number`
- `status`
- `raw_data` (JSONB)
- `synced_at`

#### `billing_approvals`
- `id` (UUID, primary key)
- `invoice_id` (foreign key)
- `admin_id` (foreign key to users)
- `action` (approved | rejected | modified)
- `notes`
- `created_at`

---

## Development Phases

### Phase 1: Foundation ✅ COMPLETE
- [x] Initialize Next.js 15 project with TypeScript
- [x] Set up Supabase project
- [x] Implement authentication system (login/signup/logout)
- [x] Configure cookie-based session management
- [x] Set up protected routes with middleware
- [x] Create development environment
- [x] Create PROJECT_CONTEXT.md
- [ ] Create database schema (NEXT STEP)

### Phase 2: Internal Admin Panel
- [ ] ShipBob API integration
- [ ] Billing calculation engine
- [ ] Markup logic implementation
- [ ] XLS generation (ExcelJS)
- [ ] PDF generation (jsPDF or Puppeteer)
- [ ] Approval workflow UI
- [ ] Audit logging system

### Phase 3: Client Dashboard - Core
- [ ] Client authentication & authorization
- [ ] Overview section with analytics
- [ ] Reporting section with charts
- [ ] Data export functionality
- [ ] Responsive design implementation

### Phase 4: Support & Billing
- [ ] Attio API integration
- [ ] Jetpack Care ticket dashboard
- [ ] Real-time ticket updates
- [ ] Billing section UI
- [ ] Invoice display and download
- [ ] Stripe payment integration

### Phase 5: Testing & Security
- [ ] Comprehensive testing (unit, integration, e2e)
- [ ] Security audit
- [ ] Billing calculation verification
- [ ] Performance optimization
- [ ] Error handling and monitoring

### Phase 6: Deployment & Integration
- [ ] Vercel deployment
- [ ] Webflow integration
- [ ] DNS configuration
- [ ] SSL certificates
- [ ] Production monitoring setup

---

## Webflow Integration Strategy

### Option 1: Subdomain (Recommended)
- **URL:** dashboard.shipwithjetpack.com
- **Pros:** Clean separation, full control, better SEO
- **Implementation:**
  1. Deploy Next.js app to Vercel
  2. Add custom domain in Vercel
  3. Configure DNS records in domain registrar
  4. Link from Webflow site to dashboard subdomain

---

## Code Quality Standards

### TypeScript
- Strict mode - No `any` types unless absolutely necessary
- ESLint + Prettier for consistent formatting

### Components
- Server components by default
- "use client" only when needed for interactivity/state
- Component-driven development - reusable, testable

### Performance
- Image optimization via Next.js Image component
- Code splitting with dynamic imports
- Caching strategies (Supabase caching, Next.js ISR)

### Testing
- Unit tests for critical business logic (billing calculations)
- Integration tests for API routes and database
- E2E tests for critical flows (login, payment)
- Manual QA for billing accuracy

---

## API Documentation Links

- **ShipBob API:** https://developer.shipbob.com/
- **Attio API:** https://developers.attio.com
- **Stripe API:** https://stripe.com/docs/api
- **Supabase Docs:** https://supabase.com/docs
- **Next.js Docs:** https://nextjs.org/docs

---

*This file contains project architecture details. Update when making infrastructure, security, or database changes.*
