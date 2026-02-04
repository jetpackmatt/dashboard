/**
 * Commission Calculation Logic
 *
 * Calculates commissions based on shipment volume across multiple partners.
 * Formula: C × (Shipments^K) where C and K are configurable per commission type.
 */

import { SupabaseClient } from '@supabase/supabase-js'
import type {
  CommissionCalculationResult,
  ClientCommissionBreakdown,
  CommissionType,
  UserCommission,
} from './types'

interface ClientWithPartners {
  id: string
  company_name: string
  merchant_id: string | null
  eshipper_id: string | null
  gofo_id: string | null
}

/**
 * Get the start and end dates for a given month
 */
export function getMonthBounds(year: number, month: number): { start: Date; end: Date } {
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0))
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)) // Last day of month
  return { start, end }
}

/**
 * Format date for Supabase queries (YYYY-MM-DD)
 */
function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]
}

/**
 * Apply the commission formula
 * Currently supports 'power' formula: C × (shipments^K)
 */
function applyFormula(
  formulaType: string,
  params: { C: number; K: number },
  shipments: number
): number {
  if (formulaType === 'power') {
    // C × (shipments^K)
    // e.g., $2.50 × √shipments when K=0.5
    return params.C * Math.pow(shipments, params.K)
  }
  // Default fallback
  return 0
}

/**
 * Get formula display string for UI
 */
export function getFormulaDisplay(formulaType: string, params: { C: number; K: number }): string {
  if (formulaType === 'power') {
    if (params.K === 0.5) {
      return `$${params.C.toFixed(2)} × √n`
    }
    return `$${params.C.toFixed(2)} × n^${params.K}`
  }
  return 'Unknown formula'
}

/**
 * Count shipments for a client from all their partners
 */
async function countClientShipments(
  supabase: SupabaseClient,
  client: ClientWithPartners,
  periodStart: string,
  periodEnd: string
): Promise<{ total: number; byPartner: Record<string, number> }> {
  const byPartner: Record<string, number> = {}

  // ShipBob: Count from shipments table (if client uses ShipBob)
  if (client.merchant_id) {
    const { count, error } = await supabase
      .from('shipments')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', client.id)
      .gte('created_at', periodStart)
      .lte('created_at', periodEnd + 'T23:59:59.999Z')

    if (!error && count !== null) {
      byPartner.shipbob = count
    }
  }

  // eShipper: Count from eshipper_shipments table (if client uses eShipper)
  if (client.eshipper_id) {
    const { count, error } = await supabase
      .from('eshipper_shipments')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', client.id)
      .gte('ship_date', periodStart)
      .lte('ship_date', periodEnd)

    if (!error && count !== null) {
      byPartner.eshipper = count
    }
  }

  // GOFO: Future - same pattern when implemented
  // if (client.gofo_id) { ... }

  const total = Object.values(byPartner).reduce((a, b) => a + b, 0)
  return { total, byPartner }
}

/**
 * Calculate commission for a user for a specific period
 */
export async function calculateUserCommission(
  supabase: SupabaseClient,
  userId: string,
  year: number,
  month: number
): Promise<CommissionCalculationResult | null> {
  // 1. Get user's active commission assignment with type
  const { data: userCommission, error: ucError } = await supabase
    .from('user_commissions')
    .select(`
      *,
      commission_type:commission_types(*)
    `)
    .eq('user_id', userId)
    .eq('is_active', true)
    .single()

  if (ucError || !userCommission) {
    return null
  }

  const commissionType = userCommission.commission_type as CommissionType
  if (!commissionType) {
    return null
  }

  // 2. Get assigned clients with their partner IDs
  const { data: clientAssignments, error: caError } = await supabase
    .from('user_commission_clients')
    .select(`
      client_id,
      client:clients(id, company_name, merchant_id, eshipper_id, gofo_id)
    `)
    .eq('user_commission_id', userCommission.id)

  if (caError || !clientAssignments) {
    return null
  }

  // 3. Calculate period bounds
  const { start, end } = getMonthBounds(year, month)
  const periodStart = formatDate(start)
  const periodEnd = formatDate(end)

  // 4. Calculate for each client
  const byClient: ClientCommissionBreakdown[] = []
  let totalShipments = 0
  let totalCommission = 0

  for (const assignment of clientAssignments) {
    // Supabase returns joined data as object for FK relationships
    const clientData = assignment.client as unknown
    const client = clientData as ClientWithPartners | null
    if (!client) continue

    const { total, byPartner } = await countClientShipments(
      supabase,
      client,
      periodStart,
      periodEnd
    )

    // Apply formula per client
    const commission = applyFormula(
      commissionType.formula_type,
      commissionType.formula_params,
      total
    )

    byClient.push({
      clientId: client.id,
      clientName: client.company_name,
      shipments: total,
      commission: Math.round(commission * 100) / 100, // Round to cents
      byPartner,
    })

    totalShipments += total
    totalCommission += commission
  }

  // Sort by commission descending
  byClient.sort((a, b) => b.commission - a.commission)

  return {
    totalShipments,
    totalCommission: Math.round(totalCommission * 100) / 100,
    byClient,
    periodStart,
    periodEnd,
    formula: {
      type: commissionType.formula_type,
      C: commissionType.formula_params.C,
      K: commissionType.formula_params.K,
      display: getFormulaDisplay(commissionType.formula_type, commissionType.formula_params),
    },
  }
}

/**
 * Check if a user has any commission assignment (for nav visibility)
 */
export async function userHasCommission(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const { count, error } = await supabase
    .from('user_commissions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_active', true)

  return !error && count !== null && count > 0
}

/**
 * Get user's commission assignment details
 */
export async function getUserCommissionAssignment(
  supabase: SupabaseClient,
  userId: string
): Promise<(UserCommission & { commission_type: CommissionType }) | null> {
  const { data, error } = await supabase
    .from('user_commissions')
    .select(`
      *,
      commission_type:commission_types(*)
    `)
    .eq('user_id', userId)
    .eq('is_active', true)
    .single()

  if (error || !data) {
    return null
  }

  return data as UserCommission & { commission_type: CommissionType }
}

/**
 * Get the last shipment dates for each partner for a user's assigned clients
 */
export async function getLastShipmentDates(
  supabase: SupabaseClient,
  userId: string
): Promise<{ shipbob: string | null; eshipper: string | null }> {
  // Get user's commission assignment
  const { data: userCommission } = await supabase
    .from('user_commissions')
    .select('id')
    .eq('user_id', userId)
    .eq('is_active', true)
    .single()

  if (!userCommission) {
    return { shipbob: null, eshipper: null }
  }

  // Get assigned client IDs
  const { data: clientAssignments } = await supabase
    .from('user_commission_clients')
    .select('client_id')
    .eq('user_commission_id', userCommission.id)

  if (!clientAssignments || clientAssignments.length === 0) {
    return { shipbob: null, eshipper: null }
  }

  const clientIds = clientAssignments.map(ca => ca.client_id)

  // Get last eShipper shipment date across all assigned clients
  const { data: lastEshipper } = await supabase
    .from('eshipper_shipments')
    .select('ship_date')
    .in('client_id', clientIds)
    .order('ship_date', { ascending: false })
    .limit(1)
    .single()

  return {
    shipbob: null, // ShipBob is real-time, we use the lastUpdated timestamp instead
    eshipper: lastEshipper?.ship_date || null,
  }
}
