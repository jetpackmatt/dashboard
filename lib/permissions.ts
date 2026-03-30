/**
 * Brand User Permissions System
 *
 * Controls what brand_team users can see and do.
 * brand_owner users have implicit full access (permissions = NULL).
 * Internal users (admin, care_admin, care_team) bypass all checks.
 */

// ============================================================================
// Types
// ============================================================================

export type BrandRole = 'brand_owner' | 'brand_team'

/**
 * Flat permission keys stored as JSONB on user_clients.permissions.
 * Top-level keys (e.g. 'transactions') control section visibility.
 * Sub-keys (e.g. 'transactions.shipments') control features within sections.
 */
export interface BrandPermissions {
  // HOME
  'home': boolean
  'home.cost_statistics': boolean
  'home.deliveryiq_statistics': boolean

  // TRANSACTIONS
  'transactions': boolean
  'transactions.unfulfilled': boolean
  'transactions.shipments': boolean
  'transactions.additional_services': boolean
  'transactions.returns': boolean
  'transactions.receiving': boolean
  'transactions.storage': boolean
  'transactions.credits': boolean

  // ANALYTICS
  'analytics': boolean
  'analytics.performance': boolean
  'analytics.cost_speed': boolean
  'analytics.order_volume': boolean
  'analytics.carriers': boolean
  'analytics.financials': boolean
  'analytics.fulfillment': boolean

  // DELIVERY IQ
  'deliveryiq': boolean
  'deliveryiq.auto_file': boolean
  'deliveryiq.mark_shipments': boolean

  // INVOICES
  'invoices': boolean
  'invoices.download_files': boolean

  // CARE
  'care': boolean
  'care.edit_tickets': boolean
  'care.submit_claims': boolean
  'care.address_changes': boolean

  // BILLING
  'billing': boolean
}

export type PermissionKey = keyof BrandPermissions

// ============================================================================
// Defaults
// ============================================================================

/** All permissions enabled — used when creating new brand_team users */
export const DEFAULT_PERMISSIONS: BrandPermissions = {
  'home': true,
  'home.cost_statistics': true,
  'home.deliveryiq_statistics': true,

  'transactions': true,
  'transactions.unfulfilled': true,
  'transactions.shipments': true,
  'transactions.additional_services': true,
  'transactions.returns': true,
  'transactions.receiving': true,
  'transactions.storage': true,
  'transactions.credits': true,

  'analytics': true,
  'analytics.performance': true,
  'analytics.cost_speed': true,
  'analytics.order_volume': true,
  'analytics.carriers': true,
  'analytics.financials': true,
  'analytics.fulfillment': true,

  'deliveryiq': true,
  'deliveryiq.auto_file': true,
  'deliveryiq.mark_shipments': true,

  'invoices': true,
  'invoices.download_files': true,

  'care': true,
  'care.edit_tickets': true,
  'care.submit_claims': true,
  'care.address_changes': true,

  'billing': true,
}

// ============================================================================
// Permission Section Metadata (for UI checkbox tree)
// ============================================================================

export interface PermissionSection {
  key: string            // Top-level permission key
  label: string          // Display label
  children: Array<{
    key: PermissionKey
    label: string
  }>
}

export const PERMISSION_SECTIONS: PermissionSection[] = [
  {
    key: 'home',
    label: 'Home',
    children: [
      { key: 'home.cost_statistics', label: 'Cost Statistics' },
      { key: 'home.deliveryiq_statistics', label: 'Delivery IQ Statistics' },
    ],
  },
  {
    key: 'transactions',
    label: 'Transactions',
    children: [
      { key: 'transactions.unfulfilled', label: 'Unfulfilled' },
      { key: 'transactions.shipments', label: 'Shipments' },
      { key: 'transactions.additional_services', label: 'Additional Services' },
      { key: 'transactions.returns', label: 'Returns' },
      { key: 'transactions.receiving', label: 'Receiving' },
      { key: 'transactions.storage', label: 'Storage' },
      { key: 'transactions.credits', label: 'Credits' },
    ],
  },
  {
    key: 'analytics',
    label: 'Analytics',
    children: [
      { key: 'analytics.performance', label: 'Performance' },
      { key: 'analytics.cost_speed', label: 'Cost + Speed' },
      { key: 'analytics.order_volume', label: 'Order Volume' },
      { key: 'analytics.carriers', label: 'Carriers' },
      { key: 'analytics.financials', label: 'Financials' },
      { key: 'analytics.fulfillment', label: 'Fulfillment' },
    ],
  },
  {
    key: 'deliveryiq',
    label: 'Delivery IQ',
    children: [
      { key: 'deliveryiq.auto_file', label: 'Auto-File On/Off' },
      { key: 'deliveryiq.mark_shipments', label: 'Mark Shipments (Reshipped, Notes)' },
    ],
  },
  {
    key: 'invoices',
    label: 'Invoices',
    children: [
      { key: 'invoices.download_files', label: 'Download PDF/XLS Files' },
    ],
  },
  {
    key: 'care',
    label: 'Jetpack Care',
    children: [
      { key: 'care.edit_tickets', label: 'Edit Tickets' },
      { key: 'care.submit_claims', label: 'Submit Claims' },
      { key: 'care.address_changes', label: 'Address Changes' },
    ],
  },
  {
    key: 'billing',
    label: 'Billing',
    children: [],
  },
]

// ============================================================================
// Permission Checking Helpers (Server-Side)
// ============================================================================

/**
 * Minimal access info needed for permission checks.
 * Matches fields from ClientAccessResult in lib/supabase/admin.ts.
 */
export interface PermissionContext {
  isAdmin: boolean
  isCareUser: boolean
  brandRole: BrandRole | null
  permissions: BrandPermissions | null
}

/**
 * Check if a user has a specific permission.
 *
 * - Internal users (admin, care_admin, care_team): always true
 * - brand_owner: always true (implicit full access)
 * - brand_team: checks permissions JSONB, defaults true if key missing (fail-open for future keys)
 */
export function hasPermission(ctx: PermissionContext, key: string): boolean {
  // Internal users bypass all brand permission checks
  if (ctx.isAdmin || ctx.isCareUser) return true

  // brand_owner has implicit full access
  if (ctx.brandRole === 'brand_owner' || !ctx.brandRole) return true

  // brand_team: check permissions object
  if (!ctx.permissions) return true // Defensive: null permissions = allow

  const value = (ctx.permissions as unknown as Record<string, boolean>)[key]
  // Fail-open: unknown keys default to true (future-proof)
  return value !== false
}

/**
 * Check permission and return a 403 Response if denied, or null if allowed.
 * Use in API routes:
 *   const denied = checkPermission(access, 'transactions.shipments')
 *   if (denied) return denied
 */
export function checkPermission(ctx: PermissionContext, key: string): Response | null {
  if (hasPermission(ctx, key)) return null

  return new Response(
    JSON.stringify({ error: 'Permission denied' }),
    { status: 403, headers: { 'Content-Type': 'application/json' } }
  )
}

// ============================================================================
// Nav Mapping (URL → permission key)
// ============================================================================

/** Maps sidebar nav URLs to their top-level permission key */
export const NAV_PERMISSION_MAP: Record<string, PermissionKey> = {
  '/dashboard': 'home',
  '/dashboard/transactions': 'transactions',
  '/dashboard/analytics': 'analytics',
  '/dashboard/deliveryiq': 'deliveryiq',
  '/dashboard/invoices': 'invoices',
  '/dashboard/care': 'care',
  '/dashboard/billing': 'billing',
}

/** Maps transaction tab values to permission keys */
export const TRANSACTION_TAB_PERMISSIONS: Record<string, PermissionKey> = {
  'unfulfilled': 'transactions.unfulfilled',
  'shipments': 'transactions.shipments',
  'additional-services': 'transactions.additional_services',
  'returns': 'transactions.returns',
  'receiving': 'transactions.receiving',
  'storage': 'transactions.storage',
  'credits': 'transactions.credits',
}

/** Maps analytics tab values to permission keys */
export const ANALYTICS_TAB_PERMISSIONS: Record<string, PermissionKey> = {
  'state-performance': 'analytics.performance',
  'cost-speed': 'analytics.cost_speed',
  'order-volume': 'analytics.order_volume',
  'carriers-zones': 'analytics.carriers',
  'financials': 'analytics.financials',
  'sla': 'analytics.fulfillment',
}
