/**
 * Billing System Types
 *
 * Shared type definitions for markup rules, invoices, and billing transactions.
 */

// Re-export from markup-engine for convenience
export type {
  MarkupRule,
  MarkupConditions,
  MarkupResult,
  AppliedRule,
  TransactionContext,
  BillingCategory,
} from './markup-engine'

// Invoice types
export interface JetpackInvoice {
  id: string
  client_id: string
  invoice_number: string
  invoice_date: string
  period_start: string
  period_end: string
  subtotal: number
  total_markup: number
  total_amount: number
  pdf_path: string | null
  xlsx_path: string | null
  status: InvoiceStatus
  generated_at: string
  approved_by: string | null
  approved_at: string | null
  approval_notes: string | null
  version: number
  replaced_by: string | null
  regeneration_locked_at: string | null
  email_sent_at: string | null
  email_error: string | null
  created_at: string
  updated_at: string
}

export type InvoiceStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'regenerated'
  | 'sent'

export interface JetpackInvoiceLineItem {
  id: string
  invoice_id: string
  billing_table: BillingTable
  billing_record_id: string
  base_amount: number
  markup_applied: number
  billed_amount: number
  markup_rule_id: string | null
  markup_percentage: number | null
  line_category: LineCategory
  description: string | null
  period_label: string | null  // For storage: "Nov 1 - Nov 30, 2025"
  created_at: string
}

export type BillingTable =
  | 'billing_shipments'
  | 'billing_shipment_fees'
  | 'billing_storage'
  | 'billing_credits'
  | 'billing_returns'
  | 'billing_receiving'

export type LineCategory =
  | 'Fulfillment'
  | 'Shipping'
  | 'Pick Fees'
  | 'B2B Fees'
  | 'Storage'
  | 'Returns'
  | 'Receiving'
  | 'Credits'
  | 'Additional Services'

// Client billing settings
export interface ClientBillingSettings {
  id: string
  company_name: string
  short_code: string | null
  billing_period: BillingPeriod
  billing_terms: BillingTerms
  invoice_email_note: string | null
  next_invoice_number: number
  billing_email: string | null
}

export type BillingPeriod = 'weekly' | 'bi-weekly' | 'tri-weekly' | 'monthly'
export type BillingTerms = 'due_on_receipt' | '7_days' | '14_days' | '30_days'

// Billing terms display mapping
export const BILLING_TERMS_DISPLAY: Record<BillingTerms, string> = {
  due_on_receipt: 'Due on Receipt',
  '7_days': 'Net 7',
  '14_days': 'Net 14',
  '30_days': 'Net 30',
}

export const BILLING_PERIOD_DISPLAY: Record<BillingPeriod, string> = {
  weekly: 'Weekly',
  'bi-weekly': 'Every 2 Weeks',
  'tri-weekly': 'Every 3 Weeks',
  monthly: 'Monthly',
}

// Fee type categories for the UI
// Shipments use order_category as the fee type. Refunds automatically use
// the same markup percentage as their corresponding charge type.
export const FEE_TYPE_CATEGORIES = {
  shipments: {
    label: 'Shipments',
    description: 'Markup applies to both charges and refunds for each category',
    types: [
      { value: 'Standard', label: 'Standard (D2C)', dbValue: null },
      { value: 'FBA', label: 'FBA Shipments', dbValue: 'FBA' },
      { value: 'VAS', label: 'Value Added Service', dbValue: 'VAS' },
    ],
  },
  shipment_fees: {
    label: 'Additional Services',
    types: [
      { value: 'Per Pick Fee', label: 'Per Pick Fee' },
      { value: 'Address Correction', label: 'Address Correction' },
      { value: 'Kitting Fee', label: 'Kitting Fee' },
      { value: 'Inventory Placement Program Fee', label: 'Inventory Placement' },
      { value: 'URO Storage Fee', label: 'URO Storage' },
      { value: 'VAS - Paid Requests', label: 'VAS - Paid Requests' },
      { value: 'B2B - Case Pick Fee', label: 'B2B - Case Pick' },
      { value: 'B2B - Each Pick Fee', label: 'B2B - Each Pick' },
      { value: 'B2B - Label Fee', label: 'B2B - Label Fee' },
      { value: 'B2B - Order Fee', label: 'B2B - Order Fee' },
      { value: 'B2B - Pallet Material Charge', label: 'B2B - Pallet Material' },
      { value: 'B2B - Pallet Pack Fee', label: 'B2B - Pallet Pack' },
      { value: 'B2B - ShipBob Freight Fee', label: 'B2B - Freight' },
      { value: 'B2B - Supplies', label: 'B2B - Supplies' },
    ],
  },
  storage: {
    label: 'Storage',
    types: [
      { value: 'Bin', label: 'Bin Storage' },
      { value: 'Shelf', label: 'Shelf Storage' },
      { value: 'Pallet', label: 'Pallet Storage' },
      { value: 'HalfPallet', label: 'Half Pallet Storage' },
    ],
  },
  credits: {
    label: 'Credits',
    types: [
      { value: 'Claim for Lost Order', label: 'Lost Order Claim' },
      { value: 'Claim for Damaged Order', label: 'Damaged Order Claim' },
      { value: 'Courtesy', label: 'Courtesy Credit' },
      { value: 'Courtesy - Orders', label: 'Courtesy - Orders' },
      { value: 'Picking Error', label: 'Picking Error' },
      { value: 'Damaged Inventory', label: 'Damaged Inventory' },
      { value: 'Delayed Order/ShipBob', label: 'Delayed Order' },
      { value: 'Delivered Not Arrived', label: 'Delivered Not Arrived' },
      { value: 'FC Move Error', label: 'FC Move Error' },
      { value: 'Order Swap Error', label: 'Order Swap Error' },
    ],
  },
  returns: {
    label: 'Returns',
    types: [
      { value: 'Return Processed by Operations Fee', label: 'Return Processing' },
      { value: 'Return to sender - Processing Fees', label: 'Return to Sender' },
      { value: 'Return Label', label: 'Return Label' },
      { value: 'Credit', label: 'Return Credit' },
    ],
  },
  receiving: {
    label: 'Receiving',
    types: [
      { value: 'Charge', label: 'WRO Receiving Fee' },
    ],
  },
  insurance: {
    label: 'Insurance',
    description: 'Markup applies to shipment insurance (from SFTP cost breakdown)',
    types: [
      { value: 'Shipment Insurance', label: 'Shipment Insurance' },
    ],
  },
} as const

// Weight brackets for markup rules
export const WEIGHT_BRACKETS = [
  { value: '0-8', label: 'Under 8oz', minOz: 0, maxOz: 8 },
  { value: '8-16', label: '8oz - 1lb', minOz: 8, maxOz: 16 },
  { value: '16-80', label: '1lb - 5lbs', minOz: 16, maxOz: 80 },
  { value: '80-160', label: '5lbs - 10lbs', minOz: 80, maxOz: 160 },
  { value: '160-240', label: '10lbs - 15lbs', minOz: 160, maxOz: 240 },
  { value: '240-320', label: '15lbs - 20lbs', minOz: 240, maxOz: 320 },
  { value: '320+', label: '20lbs+', minOz: 320, maxOz: null },
] as const

// Markup rule history entry
export interface MarkupRuleHistoryEntry {
  id: string
  markup_rule_id: string
  changed_by: string | null
  change_type: 'created' | 'updated' | 'deactivated'
  previous_values: Partial<MarkupRuleFormData> | null
  new_values: Partial<MarkupRuleFormData> | null
  change_reason: string | null
  changed_at: string
}

// Form data for creating/editing rules
export interface MarkupRuleFormData {
  name: string
  client_id: string | null
  billing_category: string
  fee_type: string | null
  order_category: string | null
  ship_option_id: string | null
  markup_type: 'percentage' | 'fixed'
  markup_value: number
  priority: number
  is_additive: boolean
  effective_from: string
  effective_to: string | null
  description: string | null
  conditions: {
    weight_min_oz?: number
    weight_max_oz?: number
    states?: string[]
    countries?: string[]
    ship_option_ids?: string[]
  } | null
}
