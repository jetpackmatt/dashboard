# Jetpack Dashboard - Project Context

**Last Updated:** November 24, 2025
**Project Owner:** Matt McLeod
**Company:** Jetpack (3PL/Fulfillment Services)

---

## 🎯 Project Overview

The Jetpack Dashboard is a secure, comprehensive web application that serves both internal staff and external clients. It provides automated billing management, real-time support ticket tracking, analytics, and reporting for Jetpack's 3PL/fulfillment services.

### Business Context
- **Company:** Jetpack - 3PL/Fulfillment/Warehouse services
- **Client Base:** Small to medium businesses shipping 1,000-50,000 orders/month
- **Focus:** Primarily D2C, with excellent B2B services
- **Infrastructure Partner:** ShipBob (warehouses, personnel, systems)
- **White Label:** Licensed ShipBob's shipping platform as "Jetpack"

---

## 🏗️ Architecture Decisions

### Technology Stack

#### Frontend Framework
- **Next.js 15.0.3** with App Router
  - Server-side rendering for security
  - API routes for backend logic
  - Optimized performance and SEO
  - TypeScript for type safety

#### Database & Backend
- **Supabase** (PostgreSQL)
  - `@supabase/supabase-js@^2.45.4` - Core Supabase client
  - `@supabase/ssr@^0.5.2` - Server-side rendering support with cookie handling
  - Real-time capabilities for ticket updates
  - Built-in authentication with Row Level Security (RLS)
  - RESTful APIs and real-time subscriptions
  - Automatic API generation from schema
  - **Important:** Use JWT anon key (format: `eyJhbGci...`), NOT `sb_publishable_` key

#### Styling & UI
- **Tailwind CSS** - Utility-first CSS framework
- **shadcn/ui** - Primary component library (installed and configured)
  - Official dashboard blocks used as foundation
  - Fully responsive, accessible components
  - Customizable with Tailwind
  - Includes charts, tables, cards, forms, etc.
- **Recharts** (via shadcn/ui charts) - Data visualization

#### Authentication & Security
- **Supabase Auth** with RLS policies
- **JWT tokens** for session management (use JWT anon key, not publishable key)
- **Cookie-based sessions** via `@supabase/ssr` for SSR compatibility
- **Middleware** for automatic token refresh on every request
- **Multi-factor authentication** for admin accounts (planned)
- **Encrypted environment variables** for sensitive keys

#### Payment Processing
- **Stripe** - PCI-compliant payment processing
- **Stripe Customer Portal** for payment management

#### Integrations
- **ShipBob API** - Order data, inventory, shipping
- **Attio API** - Support ticket management
- **Stripe API** - Payment processing

#### Hosting & Deployment
- **Vercel** - Next.js optimized hosting
- **Supabase Cloud** - Managed database
- **Custom subdomain** (dashboard.shipwithjetpack.com)

---

## 🔐 Security Requirements

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

## 📊 Feature Requirements

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

---

### 2. Client Dashboard

#### A. Overview Section
- High-level analytics (orders, revenue, shipments)
- Visual charts and graphs (line, bar, pie)
- Date range filtering
- Key performance indicators (KPIs)

#### B. Reporting Section
- Multiple report types:
  - Order history and trends
  - Inventory levels
  - Shipping performance
  - Cost breakdown
- Visual charts + downloadable data (CSV/XLS)
- Custom date ranges
- Export functionality

#### C. Jetpack Care (Support Tickets)
- Table view of all support tickets
- Columns:
  - Status indicator (color-coded lights)
  - Ticket ID
  - Issue type
  - Tracking number (if applicable)
  - Date created
  - Last updated
  - Assigned representative
- Filter by status (Outstanding / Resolved)
- Real-time updates from Attio
- Click-through for detailed ticket view

#### D. Billing Section
- Table of all invoices (current + historical)
- Columns:
  - Invoice date
  - Invoice number
  - Amount
  - Status (Paid / Outstanding)
  - PDF Summary (download link)
  - XLS Details (download link)
- Outstanding balance display (prominent)
- "Pay Now" button → Stripe payment flow
- Payment history
- Auto-pay enrollment option

---

## 🔄 Integration Requirements

### ShipBob API
**Purpose:** Fetch order, inventory, and shipping data

**Data Flow:**
1. Scheduled jobs fetch data from ShipBob API
2. Data processed and stored in Supabase
3. Custom markup logic applied for billing
4. Data served to dashboard via Next.js API routes

**Key Endpoints:**
- Orders
- Inventory
- Shipments
- Receiving
- Returns

---

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

---

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

## 🗄️ Database Schema (Preliminary)

### Core Tables

#### `users`
- `id` (UUID, primary key)
- `email` (unique)
- `role` (admin | client)
- `created_at`
- `last_login`

#### `clients`
- `id` (UUID, primary key)
- `user_id` (foreign key to users)
- `company_name`
- `shipbob_client_id`
- `attio_company_id`
- `stripe_customer_id`
- `created_at`

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

## 🚀 Development Phases

### Phase 1: Foundation ✅ COMPLETE
- [x] Initialize Next.js 15 project with TypeScript
- [x] Set up Supabase project
- [x] Implement authentication system (login/signup/logout)
- [x] Configure cookie-based session management
- [x] Set up protected routes with middleware
- [x] Create development environment
- [x] Create PROJECT_CONTEXT.md
- [ ] Create database schema (NEXT STEP)

### Phase 2: Internal Admin Panel (Weeks 3-4)
- [ ] ShipBob API integration
- [ ] Billing calculation engine
- [ ] Markup logic implementation
- [ ] XLS generation (ExcelJS)
- [ ] PDF generation (jsPDF or Puppeteer)
- [ ] Approval workflow UI
- [ ] Audit logging system

### Phase 3: Client Dashboard - Core (Weeks 5-6)
- [ ] Client authentication & authorization
- [ ] Overview section with analytics
- [ ] Reporting section with charts
- [ ] Data export functionality
- [ ] Responsive design implementation

### Phase 4: Support & Billing (Weeks 7-8)
- [ ] Attio API integration
- [ ] Jetpack Care ticket dashboard
- [ ] Real-time ticket updates
- [ ] Billing section UI
- [ ] Invoice display and download
- [ ] Stripe payment integration

### Phase 5: Testing & Security (Weeks 9-10)
- [ ] Comprehensive testing (unit, integration, e2e)
- [ ] Security audit
- [ ] Billing calculation verification
- [ ] Performance optimization
- [ ] Error handling and monitoring

### Phase 6: Deployment & Integration (Week 11)
- [ ] Vercel deployment
- [ ] Webflow integration
- [ ] DNS configuration
- [ ] SSL certificates
- [ ] Production monitoring setup

---

## 🔗 Webflow Integration Strategy

### Option 1: Subdomain (Recommended)
- **URL:** dashboard.shipwithjetpack.com
- **Pros:** Clean separation, full control, better SEO
- **Cons:** Requires DNS configuration
- **Implementation:**
  1. Deploy Next.js app to Vercel
  2. Add custom domain in Vercel
  3. Configure DNS records in domain registrar
  4. Link from Webflow site to dashboard subdomain

### Option 2: Iframe Embed
- **Pros:** Appears integrated within Webflow
- **Cons:** Security concerns, UX limitations, mobile issues
- **Not Recommended** due to security and UX constraints

### Option 3: Reverse Proxy
- **Pros:** Appears as single domain
- **Cons:** Complex setup, maintenance overhead
- **Implementation:** Use Cloudflare Workers or similar

---

## 📋 Directives & Best Practices

### Documentation & Context Management
1. **ALWAYS update PROJECT_CONTEXT.md** when we agree on:
   - New tools, libraries, or frameworks
   - New architectural approaches or patterns
   - Changes to the technology stack
   - Important implementation decisions
   - Process changes or workflow updates
2. **Update the Decision Log** with date, decision, and rationale
3. **Keep the document current** - It's the single source of truth
4. **Reference this document** at the start of complex tasks

### Code Quality
1. **TypeScript strict mode** - No `any` types unless absolutely necessary
2. **ESLint + Prettier** - Consistent code formatting
3. **Component-driven development** - Reusable, testable components
4. **API error handling** - Graceful degradation and user feedback

### Security Practices
1. **Never commit secrets** - Use `.env.local` and environment variables
2. **Validate all inputs** - Both client and server-side
3. **Implement rate limiting** - Prevent abuse
4. **Use HTTPS everywhere** - No exceptions
5. **Regular dependency updates** - Security patches

### Performance
1. **Server components by default** - Client components only when needed
2. **Image optimization** - Next.js Image component
3. **Code splitting** - Dynamic imports for large components
4. **Caching strategies** - Supabase caching, Next.js ISR

### Testing
1. **Unit tests** - Critical business logic (billing calculations)
2. **Integration tests** - API routes and database operations
3. **E2E tests** - Critical user flows (login, payment)
4. **Manual QA** - Billing accuracy verification

---

## 🤖 How This Document Works

### Purpose
This document serves as the **single source of truth** for the Jetpack Dashboard project. It contains:
- Project context and business requirements
- Architecture decisions and rationale
- Technical specifications
- Security requirements
- Integration details
- Development phases and progress

### Automation Strategy
To ensure I (Claude) consistently reference this document:

1. **Natural Language Prompts:**
   - Start conversations with: "Check PROJECT_CONTEXT.md first"
   - Reference explicitly: "Based on our PROJECT_CONTEXT.md..."

2. **Claude Code Custom Instructions (Future):**
   - Add to `.claude/settings.json` (when supported):
     ```json
     {
       "customInstructions": "Always read PROJECT_CONTEXT.md at the start of new sessions to understand project context and decisions."
     }
     ```

3. **Conversation Continuity:**
   - Each session, ask me to reference this file
   - Keep it updated with new decisions
   - Use as onboarding document for new developers

4. **Git Commit Hooks (Future Enhancement):**
   - Create pre-commit hook that reminds to update this file
   - Add checklist in PR template referencing this document

### Maintenance
- **Update this file** whenever we make architectural decisions
- **Track completed phases** by checking off items
- **Add new sections** as the project evolves
- **Version control** - Git tracks all changes

---

## 📝 Decision Log

### November 21, 2025

#### Initial Architecture Decisions
- **Decision:** Use Next.js 15 with App Router
  - **Rationale:** Server-side rendering for security, built-in API routes, optimal for dashboard apps

- **Decision:** Use Supabase for database and auth
  - **Rationale:** Real-time capabilities, built-in RLS, managed PostgreSQL, auth included

- **Decision:** Use Vercel for hosting
  - **Rationale:** Optimal Next.js support, easy deployment, great DX

- **Decision:** Store all Attio data in Supabase
  - **Rationale:** Performance, real-time updates, reduce API calls

- **Decision:** Use subdomain strategy for Webflow integration
  - **Rationale:** Clean separation, better security, full control

#### Authentication Implementation
- **Decision:** Use `@supabase/ssr@^0.5.2` (not older versions)
  - **Rationale:** Versions below 0.5.x had critical bugs with cookie handling causing `AuthSessionMissingError`
  - **Issue:** Initial implementation used `@supabase/ssr@0.0.10` which failed to properly persist sessions
  - **Solution:** Updated to `@supabase/ssr@0.5.2` and `@supabase/supabase-js@2.45.4`
  - **Debugging Process:** Created `/app/dashboard-debug/page.tsx` to inspect server-side cookies and session state, revealed package versioning issue

- **Decision:** Use `window.location.href` for post-authentication redirects
  - **Rationale:** Hard redirects ensure cookies are fully loaded before navigation, `router.push()` can cause race conditions

- **Decision:** Use JWT anon key (format: `eyJhbGci...`), not `sb_publishable_` key
  - **Rationale:** Supabase JS client requires the JWT anon key; publishable keys are for different use cases
  - **Note:** Older Supabase projects may refer to this as "legacy anon key" but it remains the correct key type

- **Decision:** Implement client-side authentication with server-side validation
  - **Rationale:** Client component handles auth UI/UX, server components validate sessions for security
  - **Pattern:** `createClient()` for client-side, `createServerClient()` with cookies() for server-side

### November 22, 2025

#### UI Component Library Strategy
- **Decision:** Use shadcn/ui as the primary component library with official dashboard blocks
  - **Rationale:** Eliminates need for custom component development, provides production-ready responsive layouts, fully accessible, excellent documentation
  - **Implementation:** Installed shadcn/ui and dashboard-01 block which includes sidebar, charts, data tables, and metric cards
  - **Previous Approach:** Initially building custom components from scratch with Xenith template inspiration
  - **Result:** Faster development, better responsiveness, more maintainable codebase
  - **Components Installed:**
    - Core UI: Button, Card, Table, Badge, Avatar, Dropdown, Drawer, Sheet, Tabs, Toggle, Checkbox, Input, Label, Select, Skeleton
    - Dashboard-specific: AppSidebar, SiteHeader, ChartAreaInteractive, DataTable, SectionCards, NavMain, NavUser, NavDocuments, NavSecondary
    - Chart components with Recharts integration
  - **Note:** All components customizable via Tailwind CSS classes

#### Data Table Multi-Tab Architecture
- **Decision:** Implement separate schemas, columns, and table instances for each tab type
  - **Rationale:** Each business domain (Shipments, Additional Services, Returns, Receiving, Storage, Credits) has different data structures and requirements. Separating them allows independent evolution and clearer code organization
  - **Pattern:**
    ```typescript
    // Each tab has its own:
    export const shipmentsSchema = z.object({ ... })
    const shipmentsColumns: ColumnDef<z.infer<typeof shipmentsSchema>>[] = [...]
    const shipmentsTable = useReactTable({ data, columns: shipmentsColumns, ... })
    ```
  - **Implementation:** `/components/data-table.tsx` organized with clear section markers and TODO comments for each tab type
  - **Benefits:** Independent "Customize Columns" dropdowns, type safety per domain, easier maintenance

#### Responsive Design Pattern for Tables
- **Decision:** Always show tab navigation at all screen sizes (no mobile dropdown)
  - **Previous Approach:** Used responsive Select dropdown on small screens with `@4xl/main:hidden` and `@4xl/main:flex`
  - **Updated Approach:** TabsList always visible for better UX
  - **Rationale:** Tabs are fundamental navigation - hiding them reduces discoverability on mobile

#### Design System Guidelines
- **Spacing:**
  - Checkbox to Order ID column: `pl-[25px]` for visual breathing room
  - Table cell/header padding: `px-4` (global via TableCell and TableHead components)
- **Checkboxes:**
  - Border: `border-muted-foreground/30` for subtle visibility without overwhelming the UI
  - Size: `h-4 w-4` consistent across all tables
- **Sample Data Realism:**
  - Quantities: Mostly 1s, occasional 2s and 3s (realistic for actual order patterns)
  - Order IDs: Start at 1001+ (professional numbering)
  - Dates: ISO 8601 format for consistency

### November 23, 2025

#### Shared Layout Architecture Pattern
- **Decision:** Implement shared layout pattern for all dashboard pages
  - **Rationale:** Eliminates full page reloads, keeps sidebar/header/logo static, improves UX and performance
  - **Implementation:**
    - Created `/app/dashboard/layout.tsx` containing shared components (AppSidebar, ResponsiveSidebarProvider, SidebarInset)
    - Layout handles authentication once for all child pages
    - Individual pages only contain their unique content
  - **Benefits:**
    - Sidebar, logo, and header remain static during navigation (no flash/reload)
    - Only content area changes when navigating between pages
    - Faster navigation (client-side routing instead of full page refresh)
    - Smoother animations and transitions
    - Better user experience

#### Client-Side Navigation Pattern
- **Decision:** Use Next.js `router.push()` for all internal navigation (not `window.location.href`)
  - **Rationale:** Enables client-side routing, preserves shared layout components, eliminates page reloads
  - **Exception:** `window.location.href` still used for post-authentication redirects (ensures cookies are fully loaded)
  - **Pattern for New Pages:**
    ```tsx
    // In component that needs navigation:
    import { useRouter } from "next/navigation"
    const router = useRouter()

    // For programmatic navigation:
    router.push("/dashboard/new-page")

    // For intercepting link clicks with animations:
    e.preventDefault()
    // ... run animation ...
    setTimeout(() => router.push("/destination"), animationDuration)
    ```

#### Page Structure Pattern (Template for All New Pages)
- **Decision:** Standardize page structure across all dashboard pages
  - **Pattern:**
    ```tsx
    // /app/dashboard/[page]/page.tsx
    import { SiteHeader } from "@/components/site-header"

    export default function PageName() {
      return (
        <>
          <SiteHeader sectionName="Page Name" />
          <div className="flex flex-1 flex-col overflow-x-hidden">
            <div className="@container/main flex flex-1 flex-col gap-2 w-full">
              {/* Page content here */}
            </div>
          </div>
        </>
      )
    }
    ```
  - **Key Points:**
    - Each page includes its own `<SiteHeader>` with appropriate `sectionName` prop
    - Pages do NOT include sidebar, authentication, or layout wrapper components
    - Layout components are in `/app/dashboard/layout.tsx` and apply to all pages
    - Server components for static content, client components ("use client") only when needed for interactivity/state

#### Sidebar Responsiveness
- **Decision:** Sidebar collapses at 1280px breakpoint (not 1024px)
  - **Rationale:** Tablets (768-1024px) should have collapsed sidebar for better content visibility
  - **Implementation:** `/components/responsive-sidebar-provider.tsx` uses `window.innerWidth >= 1280`
  - **Behavior:**
    - Desktop (≥ 1280px): Sidebar open by default
    - Tablet (768-1279px): Sidebar collapsed/minimized
    - Mobile (< 768px): Sidebar in offcanvas mode

#### Page Transition Animations
- **Decision:** Bidirectional slide animations between Dashboard and Shipments pages
  - **Dashboard → Shipments:**
    - Cards and chart fade out (opacity 0, y: -20)
    - Navigate after 300ms delay
    - Shipments table slides up from y: 700 to 0
  - **Shipments → Dashboard:**
    - Table slides down from y: 0 to 700
    - Navigate after 400ms delay
    - Cards and chart fade in (opacity 0→1, y: 20→0) with 0.1s stagger
  - **Animation Values:** `y: 700` pixels for table slide distance (matches visual position on homepage)
  - **Spring Animation:** `stiffness: 100, damping: 20, mass: 0.8` for smooth, natural feel

#### Page Transition Animation Pattern (Reusable)
- **Decision:** Implement smooth page transitions using sessionStorage + Framer Motion
  - **Problem:** `document.referrer` doesn't work reliably with client-side navigation in Next.js App Router
  - **Solution:** Use sessionStorage flags to track navigation state across client-side route changes

  **Implementation Pattern:**

  1. **Navigation Source (e.g., Dashboard):**
     ```tsx
     // Intercept link clicks
     React.useEffect(() => {
       const handleClick = (e: MouseEvent) => {
         const link = target.closest('a[href="/target-page"]')
         if (link) {
           e.preventDefault()
           setIsNavigating(true) // Trigger exit animation
           sessionStorage.setItem('navigatingFromSource', 'true') // Set flag
           setTimeout(() => router.push("/target-page"), 300) // Navigate after animation
         }
       }
       document.addEventListener("click", handleClick, true)
       return () => document.removeEventListener("click", handleClick, true)
     }, [router])
     ```

  2. **Navigation Target (e.g., Shipments):**
     ```tsx
     // Read sessionStorage synchronously during state initialization
     const [fromSource] = React.useState(() => {
       if (typeof window !== "undefined") {
         const flag = sessionStorage.getItem('navigatingFromSource')
         if (flag === 'true') {
           sessionStorage.removeItem('navigatingFromSource') // Clear flag
           return true
         }
       }
       return false
     })

     // Use flag in Framer Motion initial prop
     <motion.div
       initial={fromSource ? { y: 700 } : false}
       animate={{ y: 0 }}
       transition={{ type: "spring", stiffness: 100, damping: 20, mass: 0.8 }}
     >
     ```

  **Critical Implementation Details:**
  - ✅ Read sessionStorage in `useState` initializer (NOT `useEffect`)
  - ✅ Clear flag immediately after reading to prevent repeated animations
  - ✅ Use synchronous check (`typeof window !== "undefined"`) for SSR safety
  - ✅ Match animation timing: `setTimeout` delay should equal animation duration
  - ✅ Use event capturing (`addEventListener(..., true)`) to intercept clicks before routing

  **Why This Works:**
  - sessionStorage persists across client-side navigation
  - State initializer runs before first render, so `initial` prop has correct value
  - Flags are self-cleaning (removed after reading)
  - No flashing or race conditions

  **Spring Physics Recommendations:**
  - **Slide animations:** `stiffness: 100, damping: 20, mass: 0.8`
  - **Fade animations:** `duration: 0.3, ease: "easeOut"`
  - **Stagger delays:** `0.1s` between sequential elements

  **Files Demonstrating Pattern:**
  - `/components/dashboard-content.tsx` - Dashboard exit animation
  - `/app/dashboard/shipments/page.tsx` - Shipments entry animation

#### Table Controls Responsive Priority
- **Decision:** Priority-based visibility for table controls at different breakpoints
  - **Priority Order (highest to lowest):**
    1. **Tabs bar** - Always visible at all screen sizes
    2. **Search field** - Always visible, width adjusts (120px → 180px @ md → 250px @ xl)
    3. **Action buttons** (Filters, Customize Columns, Export) - Hide below lg (1024px)
  - **Implementation:**
    - Below 1024px: Only tabs and search visible
    - 1024px-1279px (lg): Tabs, search, and buttons (icons only)
    - 1280px+ (xl): Tabs, search, and buttons (icons + text)

#### Filters Sidebar Feature
- **Decision:** Add Filters button with slide-out sidebar for data filtering
  - **Rationale:** Provide advanced filtering capabilities without cluttering the main interface
  - **Implementation:**
    - Filters button in table controls (priority 3)
    - Sheet component slides in from right side
    - Placeholder filters: Status, Order Type, Date Range
    - Clear Filters and Apply Filters actions
  - **Future Enhancement:** Make filters tab-aware and functional with actual data filtering

#### Data Schema Corrections
- **Decision:** Fixed all tab schemas to match their respective data files
  - **Issue:** Initial implementation had mismatched column definitions and data structures
  - **Resolution:** Updated schemas for Additional Services, Returns, Storage, and Credits to match actual JSON data
  - **Pattern:** Each tab has its own dedicated schema, columns array, and table instance
  - **Files Updated:**
    - `/components/data-table.tsx` - All tab schemas and column definitions
    - Data files remain as source of truth for structure

#### Tab Column Structures (Dashboard Table)
Each tab in the main dashboard data table has its own column structure:

**Shipments (Implemented):**
- Checkbox (row selection)
- Order ID
- Status (badge with color coding)
- Customer Name
- Order Type (B2B, D2C, Wholesale)
- Qty (quantity)
- Import Date
- SLA Date

**Additional Services (Planned):**
- Checkbox
- Service ID
- Service Type
- Customer Name
- Status
- Quantity
- Request Date
- Completion Date

**Returns (Planned):**
- Checkbox
- RMA Number
- Original Order ID
- Customer Name
- Reason
- Status
- Items Qty
- Received Date
- Resolution Date

**Receiving (Planned):**
- Checkbox
- ASN Number
- Supplier
- Expected Items
- Received Items
- Status
- Expected Date
- Received Date

**Storage (Planned):**
- Checkbox
- SKU
- Product Name
- Location
- Quantity on Hand
- Reserved
- Available
- Last Updated

**Credits (Planned):**
- Checkbox
- Credit ID
- Customer Name
- Order Reference
- Reason
- Amount
- Status
- Issue Date

### November 24, 2025

#### React 18 Performance Pattern for Heavy Computation
- **Decision:** Use React 18 `startTransition` API combined with event loop deferral for expensive operations
  - **Use Case:** Analytics dashboard with 40K shipments, city coordinate lookups, and complex aggregations
  - **Problem:** Heavy `useMemo` calculations blocked UI, causing 1-2 second delays and frozen animations
  - **Solution Pattern:**
    ```typescript
    setIsDataLoading(true)
    setTimeout(() => {
      startTransition(() => {
        // Heavy state updates here
      })
    }, 50)
    ```
  - **Rationale:**
    - `setTimeout(50ms)` allows 3-4 animation frames to render before computation
    - `startTransition` marks updates as non-urgent, keeping UI responsive
    - Combined approach maintains smooth 60fps animations during data processing
  - **Result:** Instant loading indicators with smooth animations throughout heavy computation
  - **Reusability:** Pattern applicable to any dashboard feature with expensive operations (exports, reports, data imports)
  - **Files:** `/app/dashboard/analytics/page.tsx`
  - **Documentation:** Full implementation details in `ANALYTICS_CONTEXT.md`

#### Responsive Table Controls Architecture
- **Decision:** Implement dynamic responsive controls that adapt to all screen sizes without horizontal scrolling
  - **Problem:** Table controls were getting cut off at various browser widths due to misaligned breakpoints. Sidebar collapse point (1024px) didn't match button visibility point (1024px) or text visibility point (1280px), causing content to overflow.
  - **Root Cause:** ResponsiveSidebarProvider only checked width once on mount, didn't respond to resize events. Content area width calculations assumed collapsed sidebar even when expanded.
  - **Solution Approach:** "Smooth and automatic" handling instead of breakpoint whack-a-mole

  **Implementation:**

  1. **Dynamic Sidebar with Resize Listener:**
     - Changed ResponsiveSidebarProvider from `defaultOpen` to controlled `open` state
     - Added `window.addEventListener("resize", handleResize)` for dynamic responsiveness
     - Set SIDEBAR_BREAKPOINT to 1280px for proper tablet/desktop behavior
     - Content area now responds to actual sidebar state, not assumed state

  2. **Always-Visible Button Pattern:**
     - Removed `hidden lg:flex` classes - buttons ALWAYS visible at all screen sizes
     - Changed button text visibility from `xl:` (1280px) to `2xl:` (1536px)
     - Below 2xl: Icon-only buttons with proper `flex-shrink-0`
     - At 2xl+: Icons with text labels
     - **Rationale:** Horizontal scrolling is absolute last resort. Better to minimize controls than hide them.

  3. **Button Naming and Ordering:**
     - Renamed "Customize Columns" → "Columns" for space efficiency
     - Button order: Filters, Export, Columns (user's explicit request)
     - Consistent icon sizes (`h-4 w-4`) across all buttons

  4. **Intelligent Search Field Sizing:**
     - Mobile (< md): Icon button only, expands inline when clicked
     - Tablet (md, 768px): `w-[140px]` visible input field
     - Desktop (lg, 1024px): `w-[160px]`
     - Wide (xl, 1280px): `w-[180px]`
     - No max-width caps to allow flexible growth
     - **Rationale:** Search shrinks to accommodate buttons instead of requiring horizontal scroll

  5. **Mobile Search Inline Expansion:**
     - Icon button (`<SearchIcon>`) on mobile (< md breakpoint)
     - When clicked: Expands inline to full width, hides other buttons
     - Shows ChevronLeft back button + full-width search input
     - Auto-focuses on input for immediate typing
     - **NOT a Sheet/modal** - feels inline and native
     - **User's explicit request:** "simple full width search tool that expands out from the button... prefer it feel inline even on a phone"

  **Responsive Behavior Summary:**
  - **Mobile (< 768px):**
    - Sidebar: Offcanvas mode (overlay when opened)
    - Search: Icon button → expands inline to full width
    - Buttons: Hidden when search expanded, otherwise visible as icons

  - **Tablet (768-1279px):**
    - Sidebar: Collapsed/minimized (icon-only)
    - Search: Visible input field (140px → 160px)
    - Buttons: Always visible, icon-only

  - **Desktop (1280-1535px):**
    - Sidebar: Expanded (full width with labels)
    - Search: Larger input field (160px → 180px)
    - Buttons: Always visible, icon-only

  - **Wide (1536px+):**
    - Sidebar: Expanded
    - Search: Full size (180px+)
    - Buttons: Icons + text labels

  **Files Modified:**
  - `/components/responsive-sidebar-provider.tsx` - Added resize listener and controlled state
  - `/components/data-table.tsx` - Implemented responsive button pattern, mobile search expansion

  **Key Takeaway:** Prioritize visibility minimization over hiding/scrolling. Elements should adapt gracefully across ALL screen sizes without breakpoint-specific edge cases.

---

## 🎓 Learning Resources

### For Matt (Project Owner)
- **Next.js:** https://nextjs.org/docs
- **Supabase:** https://supabase.com/docs
- **React Basics:** https://react.dev/learn
- **TypeScript:** https://www.typescriptlang.org/docs/handbook/intro.html

### Key Concepts to Understand
1. **Components** - Reusable UI building blocks
2. **API Routes** - Backend endpoints in Next.js
3. **Database Schemas** - How data is structured
4. **Authentication** - Verifying user identity
5. **Environment Variables** - Secure configuration storage

---

## 🆘 Common Commands

### Development
```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run start        # Start production server
npm run lint         # Run ESLint
```

### Database (Supabase)
```bash
supabase start       # Start local Supabase
supabase db reset    # Reset local database
supabase migration new <name>  # Create new migration
```

---

## 📞 Key Contacts & Resources

### APIs & Services
- **ShipBob API Docs:** https://developer.shipbob.com/
- **Attio API Docs:** https://developers.attio.com
- **Stripe API Docs:** https://stripe.com/docs/api

### Support
- **Supabase Discord:** https://discord.supabase.com
- **Next.js GitHub:** https://github.com/vercel/next.js
- **Vercel Support:** https://vercel.com/support

---

**Note:** This document will evolve as we build. Remember to keep it updated with every major decision or change in process, featureset, approach, and technology decision!
