/**
 * Data Layer - Server-side database queries
 *
 * All data fetching for dashboard pages goes through here.
 * Functions return data already mapped to frontend types.
 */

import { createClient } from '@/lib/supabase/server'

// ============================================================================
// Types
// ============================================================================

// Format expected by DataTable (Shipments tab)
export interface ShipmentRow {
  id: number
  orderId: string
  status: string
  customerName: string
  orderType: string
  qty: number
  cost: number
  importDate: string
  slaDate: string
  // Extended fields for detail view
  trackingId?: string
  carrier?: string
  carrierService?: string
  zone?: number
  city?: string
  state?: string
}

// Format for Additional Services tab
export interface AdditionalServiceRow {
  id: number
  referenceId: string
  feeType: string
  amount: number
  transactionDate: string
  status: string
}

// Format for Returns tab
export interface ReturnRow {
  id: number
  returnId: string
  originalOrderId: string
  status: string
  returnType: string
  amount: number
  createdDate: string
}

// Format for Receiving tab
export interface ReceivingRow {
  id: number
  referenceId: string
  feeType: string
  amount: number
  transactionDate: string
}

// Format for Storage tab
export interface StorageRow {
  id: number
  inventoryId: string
  fcName: string
  locationType: string
  quantity: number
  amount: number
  chargeDate: string
}

// Format for Credits tab
export interface CreditRow {
  id: number
  referenceId: string
  creditReason: string
  amount: number
  transactionDate: string
}

// Pagination result type
export interface PaginatedResult<T> {
  data: T[]
  totalCount: number
  hasMore: boolean
  cursor?: string
}

// ============================================================================
// Shipments Queries
// ============================================================================

/**
 * Fetch shipments for the data table
 * Combines billing_shipments with orders for complete data
 */
export async function getShipments(
  clientId: string,
  options: {
    limit?: number
    offset?: number
    cursor?: string  // For infinite scroll: last shipment_id
    orderBy?: 'transaction_date' | 'order_id'
    orderDir?: 'asc' | 'desc'
  } = {}
): Promise<PaginatedResult<ShipmentRow>> {
  const supabase = await createClient()

  const {
    limit = 50,
    offset = 0,
    orderBy = 'transaction_date',
    orderDir = 'desc'
  } = options

  // Query billing_shipments joined with orders for customer info
  let query = supabase
    .from('billing_shipments')
    .select(`
      id,
      order_id,
      shipment_id,
      fulfillment_cost,
      surcharge,
      total_amount,
      transaction_date,
      transaction_type,
      transaction_status,
      orders!billing_shipments_order_id_fkey (
        customer_name,
        status,
        order_category,
        city,
        state
      ),
      shipments!billing_shipments_shipment_id_fkey (
        tracking_id,
        carrier,
        carrier_service,
        zone_used,
        label_generation_date
      )
    `, { count: 'exact' })
    .eq('client_id', clientId)
    .order(orderBy, { ascending: orderDir === 'asc' })
    .range(offset, offset + limit - 1)

  const { data, error, count } = await query

  if (error) {
    console.error('Error fetching shipments:', error)
    return { data: [], totalCount: 0, hasMore: false }
  }

  // Map to frontend format
  const mapped: ShipmentRow[] = (data || []).map((row: any, index: number) => ({
    id: row.id || offset + index + 1,
    orderId: String(row.order_id),
    status: mapShipmentStatus(row.transaction_status, row.orders?.status),
    customerName: row.orders?.customer_name || 'Unknown',
    orderType: row.orders?.order_category || 'D2C',
    qty: 1, // TODO: Get from order_items count
    cost: row.total_amount || 0,
    importDate: row.transaction_date || new Date().toISOString(),
    slaDate: calculateSlaDate(row.transaction_date),
    // Extended fields
    trackingId: row.shipments?.tracking_id || row.shipment_id,
    carrier: row.shipments?.carrier,
    carrierService: row.shipments?.carrier_service,
    zone: row.shipments?.zone_used,
    city: row.orders?.city,
    state: row.orders?.state,
  }))

  return {
    data: mapped,
    totalCount: count || 0,
    hasMore: (offset + limit) < (count || 0),
  }
}

/**
 * Fetch shipments using cursor-based pagination (for infinite scroll)
 */
export async function getShipmentsCursor(
  clientId: string,
  options: {
    limit?: number
    cursor?: number  // Last ID seen
  } = {}
): Promise<PaginatedResult<ShipmentRow>> {
  const supabase = await createClient()

  const { limit = 50, cursor } = options

  let query = supabase
    .from('billing_shipments')
    .select(`
      id,
      order_id,
      shipment_id,
      fulfillment_cost,
      surcharge,
      total_amount,
      transaction_date,
      transaction_type,
      transaction_status,
      orders!billing_shipments_order_id_fkey (
        customer_name,
        status,
        order_category,
        city,
        state
      ),
      shipments!billing_shipments_shipment_id_fkey (
        tracking_id,
        carrier,
        carrier_service,
        zone_used
      )
    `, { count: 'exact' })
    .eq('client_id', clientId)
    .order('id', { ascending: false })
    .limit(limit + 1) // Fetch one extra to check if more exist

  if (cursor) {
    query = query.lt('id', cursor)
  }

  const { data, error, count } = await query

  if (error) {
    console.error('Error fetching shipments:', error)
    return { data: [], totalCount: 0, hasMore: false }
  }

  const hasMore = (data?.length || 0) > limit
  const items = hasMore ? data!.slice(0, limit) : data || []

  const mapped: ShipmentRow[] = items.map((row: any) => ({
    id: row.id,
    orderId: String(row.order_id),
    status: mapShipmentStatus(row.transaction_status, row.orders?.status),
    customerName: row.orders?.customer_name || 'Unknown',
    orderType: row.orders?.order_category || 'D2C',
    qty: 1,
    cost: row.total_amount || 0,
    importDate: row.transaction_date || new Date().toISOString(),
    slaDate: calculateSlaDate(row.transaction_date),
    trackingId: row.shipments?.tracking_id || row.shipment_id,
    carrier: row.shipments?.carrier,
    carrierService: row.shipments?.carrier_service,
    zone: row.shipments?.zone_used,
    city: row.orders?.city,
    state: row.orders?.state,
  }))

  return {
    data: mapped,
    totalCount: count || 0,
    hasMore,
    cursor: mapped.length > 0 ? String(mapped[mapped.length - 1].id) : undefined,
  }
}

// ============================================================================
// Additional Services Queries
// ============================================================================

export async function getAdditionalServices(
  clientId: string,
  options: { limit?: number; offset?: number } = {}
): Promise<PaginatedResult<AdditionalServiceRow>> {
  const supabase = await createClient()

  const { limit = 50, offset = 0 } = options

  const { data, error, count } = await supabase
    .from('billing_additional_services')
    .select('*', { count: 'exact' })
    .eq('client_id', clientId)
    .order('transaction_date', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) {
    console.error('Error fetching additional services:', error)
    return { data: [], totalCount: 0, hasMore: false }
  }

  const mapped: AdditionalServiceRow[] = (data || []).map((row: any, index: number) => ({
    id: row.id || offset + index + 1,
    referenceId: row.reference_id || '',
    feeType: row.fee_type || '',
    amount: row.amount || 0,
    transactionDate: row.transaction_date || '',
    status: row.transaction_status || 'invoiced',
  }))

  return {
    data: mapped,
    totalCount: count || 0,
    hasMore: (offset + limit) < (count || 0),
  }
}

// ============================================================================
// Returns Queries
// ============================================================================

export async function getReturns(
  clientId: string,
  options: { limit?: number; offset?: number } = {}
): Promise<PaginatedResult<ReturnRow>> {
  const supabase = await createClient()

  const { limit = 50, offset = 0 } = options

  const { data, error, count } = await supabase
    .from('returns')
    .select('*', { count: 'exact' })
    .eq('client_id', clientId)
    .order('insert_date', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) {
    console.error('Error fetching returns:', error)
    return { data: [], totalCount: 0, hasMore: false }
  }

  const mapped: ReturnRow[] = (data || []).map((row: any, index: number) => ({
    id: row.id || offset + index + 1,
    returnId: String(row.shipbob_return_id || ''),
    originalOrderId: String(row.original_shipment_id || ''),
    status: row.status || 'Unknown',
    returnType: row.return_type || '',
    amount: row.invoice_amount || 0,
    createdDate: row.insert_date || '',
  }))

  return {
    data: mapped,
    totalCount: count || 0,
    hasMore: (offset + limit) < (count || 0),
  }
}

// ============================================================================
// Receiving (WRO) Queries
// ============================================================================

export async function getReceiving(
  clientId: string,
  options: { limit?: number; offset?: number } = {}
): Promise<PaginatedResult<ReceivingRow>> {
  const supabase = await createClient()

  const { limit = 50, offset = 0 } = options

  const { data, error, count } = await supabase
    .from('receiving_orders')
    .select('*', { count: 'exact' })
    .eq('client_id', clientId)
    .order('insert_date', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) {
    console.error('Error fetching receiving:', error)
    return { data: [], totalCount: 0, hasMore: false }
  }

  const mapped: ReceivingRow[] = (data || []).map((row: any, index: number) => ({
    id: row.id || offset + index + 1,
    referenceId: row.purchase_order_number || '',
    feeType: 'WRO Receiving',
    amount: 0, // Receiving fees tracked separately in billing
    transactionDate: row.insert_date || '',
  }))

  return {
    data: mapped,
    totalCount: count || 0,
    hasMore: (offset + limit) < (count || 0),
  }
}

// ============================================================================
// Storage Queries
// ============================================================================

export async function getStorage(
  clientId: string,
  options: { limit?: number; offset?: number } = {}
): Promise<PaginatedResult<StorageRow>> {
  const supabase = await createClient()

  const { limit = 50, offset = 0 } = options

  const { data, error, count } = await supabase
    .from('billing_storage')
    .select('*', { count: 'exact' })
    .eq('client_id', clientId)
    .order('charge_start_date', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) {
    console.error('Error fetching storage:', error)
    return { data: [], totalCount: 0, hasMore: false }
  }

  const mapped: StorageRow[] = (data || []).map((row: any, index: number) => ({
    id: row.id || offset + index + 1,
    inventoryId: String(row.inventory_id || ''),
    fcName: row.fc_name || '',
    locationType: row.location_type || '',
    quantity: row.quantity || 0,
    amount: row.amount || 0,
    chargeDate: row.charge_start_date || '',
  }))

  return {
    data: mapped,
    totalCount: count || 0,
    hasMore: (offset + limit) < (count || 0),
  }
}

// ============================================================================
// Credits Queries
// ============================================================================

export async function getCredits(
  clientId: string,
  options: { limit?: number; offset?: number } = {}
): Promise<PaginatedResult<CreditRow>> {
  const supabase = await createClient()

  const { limit = 50, offset = 0 } = options

  const { data, error, count } = await supabase
    .from('billing_credits')
    .select('*', { count: 'exact' })
    .eq('client_id', clientId)
    .order('transaction_date', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) {
    console.error('Error fetching credits:', error)
    return { data: [], totalCount: 0, hasMore: false }
  }

  const mapped: CreditRow[] = (data || []).map((row: any, index: number) => ({
    id: row.id || offset + index + 1,
    referenceId: row.reference_id || '',
    creditReason: row.credit_reason || '',
    amount: Math.abs(row.credit_amount || 0), // Credits stored as negative
    transactionDate: row.transaction_date || '',
  }))

  return {
    data: mapped,
    totalCount: count || 0,
    hasMore: (offset + limit) < (count || 0),
  }
}

// ============================================================================
// Dashboard Summary Queries
// ============================================================================

export interface DashboardSummary {
  totalShipments: number
  totalCost: number
  avgCostPerShipment: number
  shipmentsByStatus: { status: string; count: number }[]
}

export async function getDashboardSummary(clientId: string): Promise<DashboardSummary> {
  const supabase = await createClient()

  // Get total counts and sum
  const { count: totalShipments } = await supabase
    .from('billing_shipments')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', clientId)

  const { data: costData } = await supabase
    .from('billing_shipments')
    .select('total_amount')
    .eq('client_id', clientId)

  const totalCost = (costData || []).reduce((sum, row) => sum + (row.total_amount || 0), 0)
  const avgCostPerShipment = totalShipments ? totalCost / totalShipments : 0

  return {
    totalShipments: totalShipments || 0,
    totalCost,
    avgCostPerShipment,
    shipmentsByStatus: [] // TODO: Add status breakdown
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function mapShipmentStatus(transactionStatus?: string, orderStatus?: string): string {
  // Map transaction status to display status
  if (transactionStatus === 'invoiced') {
    return orderStatus === 'Completed' ? 'Delivered' : 'Shipped'
  }
  if (transactionStatus === 'invoice pending') {
    return 'Processing'
  }
  return orderStatus || 'Processing'
}

function calculateSlaDate(transactionDate: string | null): string {
  if (!transactionDate) return new Date().toISOString()

  const date = new Date(transactionDate)
  // Add 5 business days for SLA (simplified - just adds 7 calendar days)
  date.setDate(date.getDate() + 7)
  return date.toISOString()
}
