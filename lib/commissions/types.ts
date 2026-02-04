/**
 * Commission System Types
 */

// Database row types
export interface CommissionType {
  id: string
  name: string
  formula_type: 'power' // C × X^K
  formula_params: {
    C: number // Coefficient (e.g., 2.50)
    K: number // Exponent (e.g., 0.5 for square root)
  }
  description: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface UserCommission {
  id: string
  user_id: string
  commission_type_id: string
  start_date: string // YYYY-MM-DD
  end_date: string | null
  is_active: boolean
  created_at: string
  updated_at: string
  // Joined fields
  commission_type?: CommissionType
}

export interface UserCommissionClient {
  id: string
  user_commission_id: string
  client_id: string
  created_at: string
  // Joined fields
  client?: {
    id: string
    name: string
    merchant_id: string | null
    eshipper_id: string | null
    gofo_id: string | null
  }
}

export interface CommissionSnapshot {
  id: string
  user_commission_id: string
  period_year: number
  period_month: number // 1-12
  shipment_count: number
  commission_amount: number // Decimal stored as number
  breakdown: ClientCommissionBreakdown[] | null
  locked_at: string
  created_at: string
}

export interface EshipperShipmentCount {
  id: string
  client_id: string
  eshipper_company_id: string
  shipment_date: string // YYYY-MM-DD
  shipment_count: number
  synced_at: string
}

// Calculation types
export interface ClientCommissionBreakdown {
  clientId: string
  clientName: string
  shipments: number
  commission: number
  byPartner: {
    shipbob?: number
    eshipper?: number
    gofo?: number
  }
}

export interface CommissionCalculationResult {
  totalShipments: number
  totalCommission: number
  byClient: ClientCommissionBreakdown[]
  periodStart: string
  periodEnd: string
  formula: {
    type: string
    C: number
    K: number
    display: string // e.g., "$2.50 × √n"
  }
}

// API response types
export interface CommissionDataResponse {
  success: boolean
  data?: {
    currentMonth: CommissionCalculationResult
    userCommission: UserCommission & {
      commission_type: CommissionType
    }
  }
  error?: string
}

export interface CommissionHistoryResponse {
  success: boolean
  data?: CommissionSnapshot[]
  error?: string
}

// Admin types
export interface CreateCommissionTypeRequest {
  name: string
  formula_type: 'power'
  formula_params: { C: number; K: number }
  description?: string
}

export interface AssignCommissionRequest {
  user_id: string
  commission_type_id: string
  start_date: string
  client_ids: string[]
}

export interface UpdateCommissionClientsRequest {
  client_ids: string[] // Full replacement
}
