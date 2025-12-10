/**
 * Invoice Generator
 *
 * Generates PDF and XLS invoice files for client billing.
 * Uses @react-pdf/renderer for PDFs and exceljs for Excel files.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { calculateBatchMarkups, getShipmentFeeType, type BillingCategory, type TransactionContext } from './markup-engine'
import type { JetpackInvoice, LineCategory } from './types'
import ExcelJS from 'exceljs'
import { generatePDFInvoice } from './pdf-generator'

// Types for invoice generation
export interface DetailedBillingData {
  shipments: DetailedShipment[]
  shipmentFees: DetailedShipmentFee[]
  returns: DetailedReturn[]
  receiving: DetailedReceiving[]
  storage: DetailedStorage[]
  credits: DetailedCredit[]
}

export interface DetailedShipment {
  id: string
  order_id: string | null
  shipment_id: string | null
  tracking_id: string | null // Carrier tracking number (different from shipment_id)
  customer_name: string | null
  store_integration_name: string | null
  store_order_id: string | null
  transaction_type: string | null
  transaction_date: string | null
  total_amount: number | null
  products_sold: string | null
  total_quantity: number | null
  ship_option_id: string | null
  carrier_name: string | null
  ship_option_name: string | null
  zone_used: number | null
  actual_weight_oz: number | null
  dim_weight_oz: number | null
  billable_weight_oz: number | null
  length: number | null
  width: number | null
  height: number | null
  zip_code: string | null
  city: string | null
  state: string | null
  destination_country: string | null
  order_created_timestamp: string | null // From shipments.event_created
  label_generation_timestamp: string | null
  delivered_date: string | null
  transit_time_days: number | null
  fc_name: string | null
  order_category: string | null
}

export interface DetailedShipmentFee {
  id: string
  order_id: string | null
  fee_type: string | null
  amount: number | null
  transaction_date: string | null
}

export interface DetailedReturn {
  id: string
  return_id: string | null
  order_id: string | null
  tracking_id: string | null
  amount: number | null
  transaction_type: string | null
  return_status: string | null
  return_type: string | null
  return_creation_date: string | null
  fc_name: string | null
}

export interface DetailedReceiving {
  id: string
  wro_id: string | null
  fee_type: string | null
  amount: number | null
  transaction_type: string | null
  transaction_date: string | null
}

export interface DetailedStorage {
  id: string
  charge_start_date: string | null
  fc_name: string | null
  inventory_id: string | null
  sku: string | null
  location_type: string | null
  amount: number | null
  comment: string | null
}

export interface DetailedCredit {
  id: string
  reference_id: string | null
  transaction_date: string | null
  credit_reason: string | null
  credit_amount: number | null
}

export interface InvoiceLineItem {
  id: string
  billingTable: string
  billingRecordId: string
  invoiceIdSb?: number // ShipBob invoice ID (for tracking which SB invoice this came from)
  baseAmount: number // For shipments: base_cost from SFTP. For non-shipments: cost
  surcharge?: number // For shipments: pass-through surcharge (not marked up)
  insuranceCost?: number // For shipments: insurance cost from SFTP (not marked up)
  // Calculated fields:
  baseCharge?: number // For shipments: base_cost × (1 + markup%)
  insuranceCharge?: number // For shipments: insurance_cost × (1 + markup%)
  totalCharge?: number // For shipments: base_charge + surcharge
  markupApplied: number // Dollar amount of markup
  billedAmount: number // For shipments: total_charge + insurance_charge. For non-shipments: cost × (1 + markup%)
  markupRuleId: string | null
  markupPercentage: number // Stored as decimal (e.g., 0.18 for 18%)
  lineCategory: LineCategory
  description: string
  periodLabel?: string // For storage items
  orderNumber?: string
  trackingNumber?: string
  feeType?: string
  transactionDate: string
}

export interface InvoiceData {
  invoice: JetpackInvoice
  client: {
    id: string
    company_name: string
    short_code: string
    billing_email: string | null
    billing_terms: string
    merchant_id: string | null // ShipBob merchant/user ID (e.g., 386350 for Henson)
  }
  lineItems: InvoiceLineItem[]
  summary: {
    subtotal: number
    totalMarkup: number
    totalAmount: number
    byCategory: Record<LineCategory, { count: number; subtotal: number; markup: number; total: number }>
  }
}

// Additional service fee types (non-shipping fees on shipments)
const ADDITIONAL_SERVICE_FEES = [
  'Per Pick Fee',
  'B2B - Each Pick Fee',
  'B2B - Label Fee',
  'B2B - Case Pick Fee',
  'B2B - Pallet Pick Fee',
  'WRO Receiving Fee',
  'Inventory Placement Program Fee',
  'Warehousing Fee',
  'Multi-Hub IQ Fee',
  'Kitting Fee',
  'VAS Fee',
  'VAS - Paid Requests',
  'Duty/Tax',
  'Insurance',
  'Signature Required',
  'Fuel Surcharge',
  'Residential Surcharge',
  'Delivery Area Surcharge',
  'Saturday Delivery',
  'Oversized Package',
  'Dimensional Weight',
]

/**
 * Decode ULID timestamp from transaction_id
 * ULID first 10 characters encode a millisecond timestamp
 * Used for Credits to get full timestamps (matches reference XLSX)
 */
const ULID_ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
function decodeUlidTimestamp(ulid: string): string | null {
  if (!ulid || ulid.length < 10) return null
  const timeStr = ulid.substring(0, 10).toUpperCase()
  let time = 0
  for (const char of timeStr) {
    const index = ULID_ENCODING.indexOf(char)
    if (index === -1) return null
    time = time * 32 + index
  }
  return new Date(time).toISOString()
}

/**
 * Collect all billing transactions for a client and period
 * Uses the unified transactions table (source of truth)
 */
export async function collectBillingTransactions(
  clientId: string,
  periodStart: Date,
  periodEnd: Date
): Promise<InvoiceLineItem[]> {
  const supabase = createAdminClient()
  const startStr = periodStart.toISOString().split('T')[0]
  const endStr = `${periodEnd.toISOString().split('T')[0]}T23:59:59.999Z`

  const items: InvoiceLineItem[] = []

  // Fetch all transactions for the client and period
  const { data: transactions } = await supabase
    .from('transactions')
    .select('*')
    .eq('client_id', clientId)
    .gte('charge_date', startStr)
    .lte('charge_date', endStr)
    .order('charge_date', { ascending: true })

  for (const tx of transactions || []) {
    const referenceType = tx.reference_type || ''
    const transactionFee = tx.fee_type || ''
    const details = (tx.additional_details as Record<string, unknown>) || {}
    const baseAmount = Number(tx.cost) || 0

    // Skip if no cost
    if (baseAmount === 0) continue

    // Determine line category and description based on transaction type
    if (transactionFee === 'Credit') {
      // Credits
      items.push({
        id: tx.id,
        billingTable: 'billing_credits',
        billingRecordId: tx.id,
        baseAmount,
        markupApplied: 0,
        billedAmount: 0,
        markupRuleId: null,
        markupPercentage: 0,
        lineCategory: 'Credits',
        description: String(details.Comment || details.CreditReason || 'Credit'),
        feeType: 'Credit',
        transactionDate: tx.charge_date,
        // Store reference_id for shipping fee credit matching
        orderNumber: tx.reference_id,
      })
    } else if (referenceType === 'Shipment') {
      if (transactionFee === 'Shipping') {
        // Base shipping charge
        const orderCategory = String(details.OrderCategory || '')
        const feeType = getShipmentFeeType(orderCategory || null)
        const isRefund = tx.transaction_type === 'Refund'

        items.push({
          id: tx.id,
          billingTable: 'billing_shipments',
          billingRecordId: tx.id,
          baseAmount,
          markupApplied: 0,
          billedAmount: 0,
          markupRuleId: null,
          markupPercentage: 0,
          lineCategory: orderCategory === 'FBA' ? 'Fulfillment' : 'Shipping',
          description: `${isRefund ? 'Refund: ' : ''}Shipment ${tx.reference_id || 'N/A'} - ${transactionFee}`,
          orderNumber: tx.reference_id,
          trackingNumber: tx.tracking_id,
          feeType,
          transactionDate: tx.charge_date,
        })
      } else if (ADDITIONAL_SERVICE_FEES.includes(transactionFee)) {
        // Additional service fees on shipments
        const isB2B = transactionFee.startsWith('B2B')
        const isPick = transactionFee.includes('Pick')

        let category: LineCategory = 'Additional Services'
        if (isB2B) category = 'B2B Fees'
        else if (isPick) category = 'Pick Fees'

        items.push({
          id: tx.id,
          billingTable: 'billing_shipment_fees',
          billingRecordId: tx.id,
          baseAmount,
          markupApplied: 0,
          billedAmount: 0,
          markupRuleId: null,
          markupPercentage: 0,
          lineCategory: category,
          description: transactionFee,
          orderNumber: tx.reference_id,
          feeType: transactionFee,
          transactionDate: tx.charge_date,
        })
      } else {
        // Unknown fee type within Shipment reference - put in Additional Services
        console.warn(`[Invoice Generator] Unknown Shipment fee type - adding to Additional Services: transactionFee=${transactionFee}, txId=${tx.id}, amount=${baseAmount}`)
        items.push({
          id: tx.id,
          billingTable: 'billing_shipment_fees',
          billingRecordId: tx.id,
          baseAmount,
          markupApplied: 0,
          billedAmount: 0,
          markupRuleId: null,
          markupPercentage: 0,
          lineCategory: 'Additional Services',
          description: transactionFee || 'Unknown Shipment Fee',
          orderNumber: tx.reference_id,
          feeType: transactionFee || 'Unknown',
          transactionDate: tx.charge_date,
        })
      }
    } else if (referenceType === 'FC') {
      // Storage charges
      const refParts = String(tx.reference_id || '').split('-')
      const locationType = refParts[2] || String(details.LocationType || '')

      items.push({
        id: tx.id,
        billingTable: 'billing_storage',
        billingRecordId: tx.id,
        baseAmount,
        markupApplied: 0,
        billedAmount: 0,
        markupRuleId: null,
        markupPercentage: 0,
        lineCategory: 'Storage',
        description: `${locationType || 'Storage'} - ${tx.fulfillment_center || 'FC'}`,
        periodLabel: tx.charge_date ? formatStoragePeriod(new Date(tx.charge_date), new Date(tx.charge_date)) : undefined,
        feeType: locationType || 'Storage',
        transactionDate: tx.charge_date,
      })
    } else if (referenceType === 'Return') {
      // Returns
      items.push({
        id: tx.id,
        billingTable: 'billing_returns',
        billingRecordId: tx.id,
        baseAmount,
        markupApplied: 0,
        billedAmount: 0,
        markupRuleId: null,
        markupPercentage: 0,
        lineCategory: 'Returns',
        description: tx.transaction_type || 'Return',
        feeType: tx.transaction_type,
        transactionDate: tx.charge_date,
      })
    } else if (referenceType === 'WRO' || transactionFee.includes('Receiving')) {
      // Receiving (WRO = Warehouse Receiving Order)
      items.push({
        id: tx.id,
        billingTable: 'billing_receiving',
        billingRecordId: tx.id,
        baseAmount,
        markupApplied: 0,
        billedAmount: 0,
        markupRuleId: null,
        markupPercentage: 0,
        lineCategory: 'Receiving',
        description: `WRO ${tx.reference_id || 'N/A'} - ${transactionFee || 'Receiving'}`,
        feeType: transactionFee || 'Receiving',
        transactionDate: tx.charge_date,
      })
    } else if (referenceType === 'TicketNumber' && ADDITIONAL_SERVICE_FEES.includes(transactionFee)) {
      // VAS (Value Added Services) - linked to support tickets
      const isB2B = transactionFee.startsWith('B2B')
      const isPick = transactionFee.includes('Pick')

      let category: LineCategory = 'Additional Services'
      if (isB2B) category = 'B2B Fees'
      else if (isPick) category = 'Pick Fees'

      items.push({
        id: tx.id,
        billingTable: 'billing_shipment_fees',
        billingRecordId: tx.id,
        baseAmount,
        markupApplied: 0,
        billedAmount: 0,
        markupRuleId: null,
        markupPercentage: 0,
        lineCategory: category,
        description: transactionFee,
        orderNumber: tx.reference_id,
        feeType: transactionFee,
        transactionDate: tx.charge_date,
      })
    } else {
      // CATCH-ALL: Any transaction that doesn't match known patterns goes to Additional Services
      console.warn(`[Invoice Generator] Unknown transaction type - adding to Additional Services: referenceType=${referenceType}, transactionFee=${transactionFee}, txId=${tx.id}, amount=${baseAmount}`)
      items.push({
        id: tx.id,
        billingTable: 'billing_shipment_fees',
        billingRecordId: tx.id,
        baseAmount,
        markupApplied: 0,
        billedAmount: 0,
        markupRuleId: null,
        markupPercentage: 0,
        lineCategory: 'Additional Services',
        description: `${transactionFee || referenceType || 'Unknown Fee'}`,
        orderNumber: tx.reference_id,
        feeType: transactionFee || 'Unknown',
        transactionDate: tx.charge_date,
      })
    }
  }

  return items
}

/**
 * Collect billing transactions by ShipBob invoice IDs
 * Use this for testing against specific reference invoices
 */
export async function collectBillingTransactionsByInvoiceIds(
  clientId: string,
  invoiceIds: number[]
): Promise<InvoiceLineItem[]> {
  const supabase = createAdminClient()
  const items: InvoiceLineItem[] = []

  // Fetch all transactions for the client by invoice_id_sb
  // Use pagination to handle large datasets
  const allTransactions: Array<Record<string, unknown>> = []

  for (const invoiceId of invoiceIds) {
    let offset = 0
    while (true) {
      const { data: batch } = await supabase
        .from('transactions')
        .select('*')
        .eq('client_id', clientId)
        .eq('invoice_id_sb', invoiceId)
        .order('charge_date', { ascending: true })
        .order('id', { ascending: true }) // Secondary sort for stable pagination
        .range(offset, offset + 999)

      if (!batch || batch.length === 0) break
      allTransactions.push(...batch)
      if (batch.length < 1000) break
      offset += 1000
    }
  }

  const transactions = allTransactions

  for (const tx of transactions || []) {
    const referenceType = String(tx.reference_type || '')
    const transactionFee = String(tx.fee_type || '')
    const details = (tx.additional_details as Record<string, unknown>) || {}
    const baseAmount = Number(tx.cost) || 0
    const txId = String(tx.id)
    const txChargeDate = String(tx.charge_date)
    const txReferenceId = String(tx.reference_id || '')
    const txTrackingId = String(tx.tracking_id || '')
    const txFulfillmentCenter = String(tx.fulfillment_center || '')
    const txTransactionType = String(tx.transaction_type || '')
    const txInvoiceIdSb = tx.invoice_id_sb ? Number(tx.invoice_id_sb) : undefined

    // Skip if no cost
    if (baseAmount === 0) continue

    // Determine line category and description based on transaction type
    if (transactionFee === 'Credit') {
      items.push({
        id: txId,
        billingTable: 'billing_credits',
        billingRecordId: txId,
        invoiceIdSb: txInvoiceIdSb,
        baseAmount,
        markupApplied: 0,
        billedAmount: 0,
        markupRuleId: null,
        markupPercentage: 0,
        lineCategory: 'Credits',
        description: String(details.Comment || details.CreditReason || 'Credit'),
        feeType: 'Credit',
        transactionDate: txChargeDate,
        // Store reference_id for shipping fee credit matching
        orderNumber: txReferenceId,
      })
    } else if (referenceType === 'Shipment') {
      if (transactionFee === 'Shipping') {
        const orderCategory = String(details.OrderCategory || '')
        const feeType = getShipmentFeeType(orderCategory || null)
        const isRefund = txTransactionType === 'Refund'
        // For shipments: use base_cost (marked up) + surcharge (pass-through) + insurance
        const shipBaseAmount = Number(tx.base_cost) || Number(tx.cost) || 0
        const shipSurcharge = Number(tx.surcharge) || 0
        const shipInsuranceCost = Number(tx.insurance_cost) || 0

        items.push({
          id: txId,
          billingTable: 'billing_shipments',
          billingRecordId: txId,
          invoiceIdSb: txInvoiceIdSb,
          baseAmount: shipBaseAmount,
          surcharge: shipSurcharge,
          insuranceCost: shipInsuranceCost,
          markupApplied: 0,
          billedAmount: 0,
          markupRuleId: null,
          markupPercentage: 0,
          lineCategory: orderCategory === 'FBA' ? 'Fulfillment' : 'Shipping',
          description: `${isRefund ? 'Refund: ' : ''}Shipment ${txReferenceId || 'N/A'} - ${transactionFee}`,
          orderNumber: txReferenceId,
          trackingNumber: txTrackingId,
          feeType,
          transactionDate: txChargeDate,
        })
      } else if (ADDITIONAL_SERVICE_FEES.includes(transactionFee)) {
        const isB2B = transactionFee.startsWith('B2B')
        const isPick = transactionFee.includes('Pick')

        let category: LineCategory = 'Additional Services'
        if (isB2B) category = 'B2B Fees'
        else if (isPick) category = 'Pick Fees'

        items.push({
          id: txId,
          billingTable: 'billing_shipment_fees',
          billingRecordId: txId,
          invoiceIdSb: txInvoiceIdSb,
          baseAmount,
          markupApplied: 0,
          billedAmount: 0,
          markupRuleId: null,
          markupPercentage: 0,
          lineCategory: category,
          description: transactionFee,
          orderNumber: txReferenceId,
          feeType: transactionFee,
          transactionDate: txChargeDate,
        })
      } else {
        // Unknown fee type within Shipment reference - put in Additional Services
        console.warn(`[Invoice Generator] Unknown Shipment fee type - adding to Additional Services: transactionFee=${transactionFee}, txId=${txId}, amount=${baseAmount}`)
        items.push({
          id: txId,
          billingTable: 'billing_shipment_fees',
          billingRecordId: txId,
          invoiceIdSb: txInvoiceIdSb,
          baseAmount,
          markupApplied: 0,
          billedAmount: 0,
          markupRuleId: null,
          markupPercentage: 0,
          lineCategory: 'Additional Services',
          description: transactionFee,
          orderNumber: txReferenceId,
          feeType: transactionFee,
          transactionDate: txChargeDate,
        })
      }
    } else if (referenceType === 'FC') {
      const refParts = txReferenceId.split('-')
      const locationType = refParts[2] || String(details.LocationType || '')

      items.push({
        id: txId,
        billingTable: 'billing_storage',
        billingRecordId: txId,
        invoiceIdSb: txInvoiceIdSb,
        baseAmount,
        markupApplied: 0,
        billedAmount: 0,
        markupRuleId: null,
        markupPercentage: 0,
        lineCategory: 'Storage',
        description: `${locationType || 'Storage'} - ${txFulfillmentCenter || 'FC'}`,
        periodLabel: txChargeDate ? formatStoragePeriod(new Date(txChargeDate), new Date(txChargeDate)) : undefined,
        feeType: locationType || 'Storage',
        transactionDate: txChargeDate,
      })
    } else if (referenceType === 'Return') {
      items.push({
        id: txId,
        billingTable: 'billing_returns',
        billingRecordId: txId,
        invoiceIdSb: txInvoiceIdSb,
        baseAmount,
        markupApplied: 0,
        billedAmount: 0,
        markupRuleId: null,
        markupPercentage: 0,
        lineCategory: 'Returns',
        description: txTransactionType || 'Return',
        feeType: txTransactionType,
        transactionDate: txChargeDate,
      })
    } else if (referenceType === 'WRO' || transactionFee.includes('Receiving')) {
      items.push({
        id: txId,
        billingTable: 'billing_receiving',
        billingRecordId: txId,
        invoiceIdSb: txInvoiceIdSb,
        baseAmount,
        markupApplied: 0,
        billedAmount: 0,
        markupRuleId: null,
        markupPercentage: 0,
        lineCategory: 'Receiving',
        description: `WRO ${txReferenceId || 'N/A'} - ${transactionFee || 'Receiving'}`,
        feeType: transactionFee || 'Receiving',
        transactionDate: txChargeDate,
      })
    } else if (referenceType === 'TicketNumber' && ADDITIONAL_SERVICE_FEES.includes(transactionFee)) {
      // VAS - Paid Requests and other ticket-based additional services
      items.push({
        id: txId,
        billingTable: 'billing_shipment_fees',
        billingRecordId: txId,
        invoiceIdSb: txInvoiceIdSb,
        baseAmount,
        markupApplied: 0,
        billedAmount: 0,
        markupRuleId: null,
        markupPercentage: 0,
        lineCategory: 'Additional Services',
        description: transactionFee,
        orderNumber: txReferenceId,
        feeType: transactionFee,
        transactionDate: txChargeDate,
      })
    } else {
      /// CATCH-ALL: Any transaction that doesn't match known patterns goes to Additional Services
      // This ensures no fees are silently dropped - they will appear in the invoice
      // Log warning so we can review and add proper handling if needed
      console.warn(`[Invoice Generator] Unknown transaction type - adding to Additional Services: referenceType=${referenceType}, transactionFee=${transactionFee}, txId=${txId}, amount=${baseAmount}`)
      items.push({
        id: txId,
        billingTable: 'billing_shipment_fees',
        billingRecordId: txId,
        invoiceIdSb: txInvoiceIdSb,
        baseAmount,
        markupApplied: 0,
        billedAmount: 0,
        markupRuleId: null,
        markupPercentage: 0,
        lineCategory: 'Additional Services',
        description: `${transactionFee || referenceType || 'Unknown Fee'}`,
        orderNumber: txReferenceId,
        feeType: transactionFee || 'Unknown',
        transactionDate: txChargeDate,
      })
    }
  }

  return items
}

/**
 * Collect all unprocessed billing transactions for a client
 * Use this for the actual cron job - queries by invoiced_status_jp = false
 */
export async function collectUnprocessedBillingTransactions(
  clientId: string
): Promise<InvoiceLineItem[]> {
  const supabase = createAdminClient()
  const items: InvoiceLineItem[] = []

  // Fetch all unprocessed transactions for the client
  const allTransactions: Array<Record<string, unknown>> = []
  let offset = 0

  while (true) {
    const { data: batch } = await supabase
      .from('transactions')
      .select('*')
      .eq('client_id', clientId)
      .eq('invoiced_status_jp', false)
      .order('charge_date', { ascending: true })
      .order('id', { ascending: true }) // Secondary sort for stable pagination
      .range(offset, offset + 999)

    if (!batch || batch.length === 0) break
    allTransactions.push(...batch)
    if (batch.length < 1000) break
    offset += 1000
  }

  const transactions = allTransactions

  for (const tx of transactions || []) {
    const referenceType = String(tx.reference_type || '')
    const transactionFee = String(tx.fee_type || '')
    const details = (tx.additional_details as Record<string, unknown>) || {}
    const baseAmount = Number(tx.cost) || 0
    const txId = String(tx.id)
    const txChargeDate = String(tx.charge_date)
    const txReferenceId = String(tx.reference_id || '')
    const txTrackingId = String(tx.tracking_id || '')
    const txFulfillmentCenter = String(tx.fulfillment_center || '')
    const txTransactionType = String(tx.transaction_type || '')
    const txInvoiceIdSb = tx.invoice_id_sb ? Number(tx.invoice_id_sb) : undefined

    if (baseAmount === 0) continue

    if (transactionFee === 'Credit') {
      items.push({
        id: txId,
        billingTable: 'billing_credits',
        billingRecordId: txId,
        invoiceIdSb: txInvoiceIdSb,
        baseAmount,
        markupApplied: 0,
        billedAmount: 0,
        markupRuleId: null,
        markupPercentage: 0,
        lineCategory: 'Credits',
        description: String(details.Comment || details.CreditReason || 'Credit'),
        feeType: 'Credit',
        transactionDate: txChargeDate,
        // Store reference_id for shipping fee credit matching
        orderNumber: txReferenceId,
      })
    } else if (referenceType === 'Shipment') {
      if (transactionFee === 'Shipping') {
        const orderCategory = String(details.OrderCategory || '')
        const feeType = getShipmentFeeType(orderCategory || null)
        const isRefund = txTransactionType === 'Refund'
        // For shipments: use base_cost (marked up) + surcharge (pass-through) + insurance
        const shipBaseAmount = Number(tx.base_cost) || Number(tx.cost) || 0
        const shipSurcharge = Number(tx.surcharge) || 0
        const shipInsuranceCost = Number(tx.insurance_cost) || 0

        items.push({
          id: txId,
          billingTable: 'billing_shipments',
          billingRecordId: txId,
          invoiceIdSb: txInvoiceIdSb,
          baseAmount: shipBaseAmount,
          surcharge: shipSurcharge,
          insuranceCost: shipInsuranceCost,
          markupApplied: 0,
          billedAmount: 0,
          markupRuleId: null,
          markupPercentage: 0,
          lineCategory: orderCategory === 'FBA' ? 'Fulfillment' : 'Shipping',
          description: `${isRefund ? 'Refund: ' : ''}Shipment ${txReferenceId || 'N/A'} - ${transactionFee}`,
          orderNumber: txReferenceId,
          trackingNumber: txTrackingId,
          feeType,
          transactionDate: txChargeDate,
        })
      } else if (ADDITIONAL_SERVICE_FEES.includes(transactionFee)) {
        const isB2B = transactionFee.startsWith('B2B')
        const isPick = transactionFee.includes('Pick')

        let category: LineCategory = 'Additional Services'
        if (isB2B) category = 'B2B Fees'
        else if (isPick) category = 'Pick Fees'

        items.push({
          id: txId,
          billingTable: 'billing_shipment_fees',
          billingRecordId: txId,
          invoiceIdSb: txInvoiceIdSb,
          baseAmount,
          markupApplied: 0,
          billedAmount: 0,
          markupRuleId: null,
          markupPercentage: 0,
          lineCategory: category,
          description: transactionFee,
          orderNumber: txReferenceId,
          feeType: transactionFee,
          transactionDate: txChargeDate,
        })
      } else {
        // Unknown fee type within Shipment reference - put in Additional Services
        console.warn(`[Invoice Generator] Unknown Shipment fee type - adding to Additional Services: transactionFee=${transactionFee}, txId=${txId}, amount=${baseAmount}`)
        items.push({
          id: txId,
          billingTable: 'billing_shipment_fees',
          billingRecordId: txId,
          invoiceIdSb: txInvoiceIdSb,
          baseAmount,
          markupApplied: 0,
          billedAmount: 0,
          markupRuleId: null,
          markupPercentage: 0,
          lineCategory: 'Additional Services',
          description: transactionFee,
          orderNumber: txReferenceId,
          feeType: transactionFee,
          transactionDate: txChargeDate,
        })
      }
    } else if (referenceType === 'FC') {
      const refParts = txReferenceId.split('-')
      const locationType = refParts[2] || String(details.LocationType || '')

      items.push({
        id: txId,
        billingTable: 'billing_storage',
        billingRecordId: txId,
        invoiceIdSb: txInvoiceIdSb,
        baseAmount,
        markupApplied: 0,
        billedAmount: 0,
        markupRuleId: null,
        markupPercentage: 0,
        lineCategory: 'Storage',
        description: `${locationType || 'Storage'} - ${txFulfillmentCenter || 'FC'}`,
        periodLabel: txChargeDate ? formatStoragePeriod(new Date(txChargeDate), new Date(txChargeDate)) : undefined,
        feeType: locationType || 'Storage',
        transactionDate: txChargeDate,
      })
    } else if (referenceType === 'Return') {
      items.push({
        id: txId,
        billingTable: 'billing_returns',
        billingRecordId: txId,
        invoiceIdSb: txInvoiceIdSb,
        baseAmount,
        markupApplied: 0,
        billedAmount: 0,
        markupRuleId: null,
        markupPercentage: 0,
        lineCategory: 'Returns',
        description: txTransactionType || 'Return',
        feeType: txTransactionType,
        transactionDate: txChargeDate,
      })
    } else if (referenceType === 'WRO' || transactionFee.includes('Receiving')) {
      items.push({
        id: txId,
        billingTable: 'billing_receiving',
        billingRecordId: txId,
        invoiceIdSb: txInvoiceIdSb,
        baseAmount,
        markupApplied: 0,
        billedAmount: 0,
        markupRuleId: null,
        markupPercentage: 0,
        lineCategory: 'Receiving',
        description: `WRO ${txReferenceId || 'N/A'} - ${transactionFee || 'Receiving'}`,
        feeType: transactionFee || 'Receiving',
        transactionDate: txChargeDate,
      })
    } else if (referenceType === 'TicketNumber' && ADDITIONAL_SERVICE_FEES.includes(transactionFee)) {
      // VAS - Paid Requests and other ticket-based additional services
      items.push({
        id: txId,
        billingTable: 'billing_shipment_fees',
        billingRecordId: txId,
        invoiceIdSb: txInvoiceIdSb,
        baseAmount,
        markupApplied: 0,
        billedAmount: 0,
        markupRuleId: null,
        markupPercentage: 0,
        lineCategory: 'Additional Services',
        description: transactionFee,
        orderNumber: txReferenceId,
        feeType: transactionFee,
        transactionDate: txChargeDate,
      })
    } else {
      /// CATCH-ALL: Any transaction that doesn't match known patterns goes to Additional Services
      // This ensures no fees are silently dropped - they will appear in the invoice
      // Log warning so we can review and add proper handling if needed
      console.warn(`[Invoice Generator] Unknown transaction type - adding to Additional Services: referenceType=${referenceType}, transactionFee=${transactionFee}, txId=${txId}, amount=${baseAmount}`)
      items.push({
        id: txId,
        billingTable: 'billing_shipment_fees',
        billingRecordId: txId,
        invoiceIdSb: txInvoiceIdSb,
        baseAmount,
        markupApplied: 0,
        billedAmount: 0,
        markupRuleId: null,
        markupPercentage: 0,
        lineCategory: 'Additional Services',
        description: `${transactionFee || referenceType || 'Unknown Fee'}`,
        orderNumber: txReferenceId,
        feeType: transactionFee || 'Unknown',
        transactionDate: txChargeDate,
      })
    }
  }

  return items
}

/**
 * Apply markups to all line items using the markup engine
 */
export async function applyMarkupsToLineItems(
  clientId: string,
  lineItems: InvoiceLineItem[]
): Promise<InvoiceLineItem[]> {
  const supabase = createAdminClient()

  // Step 1: Collect shipment IDs that need ship_option_id lookup
  // Note: billingTable can be 'billing_shipments' or 'shipments' depending on source
  const shipmentIds = lineItems
    .filter(item => (item.billingTable === 'billing_shipments' || item.billingTable === 'shipments') && item.orderNumber)
    .map(item => Number(item.orderNumber))
    .filter(id => id > 0)

  // Step 2: Fetch ship_option_id from shipments table
  const shipOptionMap = new Map<string, string>()
  if (shipmentIds.length > 0) {
    // Fetch in batches of 500 to avoid query limits
    for (let i = 0; i < shipmentIds.length; i += 500) {
      const batch = shipmentIds.slice(i, i + 500)
      const { data: shipments } = await supabase
        .from('shipments')
        .select('shipment_id, ship_option_id')
        .in('shipment_id', batch)

      for (const s of shipments || []) {
        if (s.ship_option_id) {
          shipOptionMap.set(String(s.shipment_id), String(s.ship_option_id))
        }
      }
    }
  }

  // Step 3: Build transaction contexts with ship_option_id from lookup
  const transactions = lineItems.map(item => ({
    id: item.id,
    baseAmount: item.baseAmount,
    context: {
      clientId,
      transactionDate: new Date(item.transactionDate),
      feeType: item.feeType || '',
      billingCategory: tableToBillingCategory(item.billingTable),
      orderCategory: null,
      shipOptionId: item.orderNumber ? shipOptionMap.get(item.orderNumber) || null : null,
      weightOz: undefined,
      state: undefined,
      country: undefined,
    } as TransactionContext,
  }))

  // Calculate markups in batch
  const markupResults = await calculateBatchMarkups(transactions)

  // Step 4: Build shipment markup map for shipping fee credit matching
  // Map: shipment_id -> { baseAmount, markupPercentage, markupRuleId }
  const shipmentMarkupMap = new Map<string, { baseAmount: number; markupPercentage: number; markupRuleId: string | null }>()

  // First pass: collect shipment markups from current invoice
  for (const item of lineItems) {
    if (item.billingTable === 'billing_shipments' && item.orderNumber) {
      const result = markupResults.get(item.id)
      if (result) {
        shipmentMarkupMap.set(item.orderNumber, {
          baseAmount: item.baseAmount,
          markupPercentage: result.markupPercentage,
          markupRuleId: result.ruleId,
        })
      }
    }
  }

  // Step 5: For credits referencing shipments not in current invoice, look up from database
  const creditShipmentRefs = lineItems
    .filter(item => item.lineCategory === 'Credits' && item.orderNumber && !shipmentMarkupMap.has(item.orderNumber))
    .map(item => item.orderNumber!)

  if (creditShipmentRefs.length > 0) {
    // Look up previously invoiced shipments from transactions table
    // Markup data is now stored directly on transactions
    for (let i = 0; i < creditShipmentRefs.length; i += 500) {
      const batch = creditShipmentRefs.slice(i, i + 500)

      const { data: shipmentTxs } = await supabase
        .from('transactions')
        .select('reference_id, cost, base_cost, markup_percentage, markup_rule_id, invoiced_status_jp')
        .eq('client_id', clientId)
        .eq('reference_type', 'Shipment')
        .eq('fee_type', 'Shipping')
        .in('reference_id', batch)

      for (const tx of shipmentTxs || []) {
        const refId = String(tx.reference_id)
        const baseAmount = Number(tx.base_cost) || Number(tx.cost) || 0

        if (tx.invoiced_status_jp && tx.markup_percentage != null) {
          // Use the markup from when it was invoiced
          shipmentMarkupMap.set(refId, {
            baseAmount,
            markupPercentage: Number(tx.markup_percentage),
            markupRuleId: tx.markup_rule_id,
          })
        } else if (baseAmount > 0) {
          // Not invoiced yet - store base amount, no markup
          shipmentMarkupMap.set(refId, {
            baseAmount,
            markupPercentage: 0,
            markupRuleId: null,
          })
        }
      }
    }
  }

  // Apply results to line items
  // For shipments:
  //   base_charge = base_cost × (1 + markup%)
  //   total_charge = base_charge + surcharge
  //   insurance_charge = insurance_cost × (1 + markup%)
  //   billed_amount = total_charge + insurance_charge
  // For non-shipments:
  //   billed_amount = cost × (1 + markup%)
  // For credits: if credit amount matches shipment base cost exactly, apply same markup
  return lineItems.map(item => {
    const result = markupResults.get(item.id)
    const surcharge = item.surcharge || 0
    const insuranceCost = item.insuranceCost || 0
    const isShipment = item.billingTable === 'billing_shipments'

    // Special handling for credits: check if this is a shipping fee credit
    if (item.lineCategory === 'Credits' && item.orderNumber) {
      const shipmentMarkup = shipmentMarkupMap.get(item.orderNumber)
      // Credit amount is negative, shipment base is positive
      // Match if absolute credit amount equals shipment base amount (within 1 cent tolerance)
      if (shipmentMarkup && Math.abs(Math.abs(item.baseAmount) - shipmentMarkup.baseAmount) < 0.01) {
        // This is a shipping fee credit - apply same markup as original shipment
        const markupDecimal = shipmentMarkup.markupPercentage / 100 // Convert from percentage to decimal
        const markupAmount = item.baseAmount * markupDecimal // baseAmount is negative
        const billedAmount = item.baseAmount + markupAmount
        return {
          ...item,
          markupApplied: Math.round(markupAmount * 100) / 100,
          billedAmount: Math.round(billedAmount * 100) / 100,
          markupRuleId: shipmentMarkup.markupRuleId,
          markupPercentage: markupDecimal, // Store as decimal
        }
      }
    }

    if (result) {
      // Convert markup percentage from result (which is in % like 18.00) to decimal (0.18)
      const markupDecimal = result.markupPercentage / 100

      if (isShipment) {
        // For shipments: calculate all the breakdown fields
        const baseCharge = Math.round(result.billedAmount * 100) / 100 // base_cost × (1 + markup%)
        const totalCharge = Math.round((baseCharge + surcharge) * 100) / 100
        const insuranceCharge = Math.round((insuranceCost * (1 + markupDecimal)) * 100) / 100
        const billedAmount = Math.round((totalCharge + insuranceCharge) * 100) / 100

        // Total markup = markup on base + markup on insurance
        const totalMarkup = Math.round((result.markupAmount + (insuranceCost * markupDecimal)) * 100) / 100

        return {
          ...item,
          baseCharge,
          totalCharge,
          insuranceCharge,
          markupApplied: totalMarkup,
          billedAmount,
          markupRuleId: result.ruleId,
          markupPercentage: markupDecimal, // Store as decimal
        }
      } else {
        // For non-shipments: simple calculation
        return {
          ...item,
          markupApplied: result.markupAmount,
          billedAmount: result.billedAmount,
          markupRuleId: result.ruleId,
          markupPercentage: markupDecimal, // Store as decimal
        }
      }
    }

    // No markup rule found - pass through at cost
    if (isShipment) {
      const baseCharge = item.baseAmount
      const totalCharge = Math.round((baseCharge + surcharge) * 100) / 100
      const insuranceCharge = insuranceCost
      const billedAmount = Math.round((totalCharge + insuranceCharge) * 100) / 100

      return {
        ...item,
        baseCharge,
        totalCharge,
        insuranceCharge,
        billedAmount,
      }
    }

    return {
      ...item,
      billedAmount: item.baseAmount, // No markup if no rule found
    }
  })
}

/**
 * Generate summary statistics from line items
 */
export function generateSummary(lineItems: InvoiceLineItem[]): InvoiceData['summary'] {
  const byCategory: Record<LineCategory, { count: number; subtotal: number; markup: number; total: number }> = {
    'Fulfillment': { count: 0, subtotal: 0, markup: 0, total: 0 },
    'Shipping': { count: 0, subtotal: 0, markup: 0, total: 0 },
    'Pick Fees': { count: 0, subtotal: 0, markup: 0, total: 0 },
    'B2B Fees': { count: 0, subtotal: 0, markup: 0, total: 0 },
    'Storage': { count: 0, subtotal: 0, markup: 0, total: 0 },
    'Returns': { count: 0, subtotal: 0, markup: 0, total: 0 },
    'Receiving': { count: 0, subtotal: 0, markup: 0, total: 0 },
    'Credits': { count: 0, subtotal: 0, markup: 0, total: 0 },
    'Additional Services': { count: 0, subtotal: 0, markup: 0, total: 0 },
  }

  let subtotal = 0
  let totalMarkup = 0

  for (const item of lineItems) {
    const surcharge = item.surcharge || 0
    subtotal += item.baseAmount + surcharge
    totalMarkup += item.markupApplied

    const cat = byCategory[item.lineCategory]
    if (cat) {
      cat.count++
      cat.subtotal += item.baseAmount + surcharge
      cat.markup += item.markupApplied
      cat.total += item.billedAmount
    }
  }

  return {
    subtotal: Math.round(subtotal * 100) / 100,
    totalMarkup: Math.round(totalMarkup * 100) / 100,
    totalAmount: Math.round((subtotal + totalMarkup) * 100) / 100,
    byCategory,
  }
}

/**
 * Generate Excel invoice file with 6 sheets matching reference format
 * Sheets: Shipments, Additional Services, Returns, Receiving, Storage, Credits
 */
export async function generateExcelInvoice(data: InvoiceData, detailedData: DetailedBillingData): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Jetpack Dashboard'
  workbook.created = new Date()

  // Helper to style headers
  const styleHeader = (sheet: ExcelJS.Worksheet, row: number) => {
    const headerRow = sheet.getRow(row)
    headerRow.font = { bold: true }
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    }
  }

  // Helper to add total row
  const addTotalRow = (sheet: ExcelJS.Worksheet, row: number, colIndex: number, total: number) => {
    sheet.getCell(row, 1).value = 'Total'
    sheet.getCell(row, 1).font = { bold: true }
    sheet.getCell(row, colIndex).value = total
    sheet.getCell(row, colIndex).font = { bold: true }
    sheet.getCell(row, colIndex).numFmt = '#,##0.00'
  }

  // Excel date/time format for timestamps
  const dateTimeFormat = 'yyyy-mm-dd hh:mm:ss'
  const dateOnlyFormat = 'yyyy-mm-dd'

  // 1. SHIPMENTS SHEET
  // Client-facing columns only - NO internal costs or markup percentages
  const shipmentsSheet = workbook.addWorksheet('Shipments')
  shipmentsSheet.getRow(1).values = [
    'User ID', 'Merchant Name', 'Customer Name', 'Store', 'Shipment ID', 'Transaction Type',
    'Transaction Date', 'Store Order ID', 'Tracking ID',
    'Base Fulfillment Charge', 'Surcharges', 'Total Fulfillment Charge', 'Insurance',
    'Products Sold', 'Total Quantity', 'Ship Option ID', 'Carrier',
    'Carrier Service', 'Zone', 'Actual Weight (Oz)', 'Dim Weight (Oz)', 'Billable Weight (Oz)',
    'Length', 'Width', 'Height', 'Zip Code', 'City', 'State', 'Country',
    'Order Created', 'Label Generated', 'Delivered', 'Transit Days', 'FC Name'
  ]
  styleHeader(shipmentsSheet, 1)

  // Sort shipments by transaction_date descending (newest first)
  const sortedShipments = [...detailedData.shipments].sort((a, b) => {
    const dateA = a.transaction_date ? new Date(a.transaction_date).getTime() : 0
    const dateB = b.transaction_date ? new Date(b.transaction_date).getTime() : 0
    return dateB - dateA // descending
  })

  let row = 2
  let shipmentsTotal = 0
  for (const s of sortedShipments) {
    const markupItem = data.lineItems.find(i => i.billingRecordId === s.id)
    // Client-facing amounts from the calculated markup
    const baseCharge = markupItem?.baseCharge || 0
    const surcharge = markupItem?.surcharge || 0
    const totalCharge = markupItem?.totalCharge || 0
    const insuranceCharge = markupItem?.insuranceCharge || 0
    const billedAmt = markupItem?.billedAmount || 0

    shipmentsTotal += billedAmt

    shipmentsSheet.getRow(row).values = [
      data.client.merchant_id || '',  // User ID
      data.client.company_name,
      s.customer_name || '',
      s.store_integration_name || '',
      s.order_id || '',
      s.transaction_type || '',
      s.transaction_date ? formatExcelDate(s.transaction_date) : '',
      s.store_order_id || '',
      s.tracking_id || '',            // Carrier tracking number (NOT shipment_id)
      baseCharge,                     // Base Fulfillment Charge
      surcharge,                      // Surcharges (pass-through)
      totalCharge,                    // Total Fulfillment Charge = base + surcharges
      insuranceCharge,                // Insurance (marked up)
      s.products_sold || '',
      s.total_quantity || '',
      s.ship_option_id || '',
      s.carrier_name || '',
      s.ship_option_name || '',
      s.zone_used || '',
      s.actual_weight_oz || '',
      s.dim_weight_oz || '',
      s.billable_weight_oz || '',
      s.length || '',
      s.width || '',
      s.height || '',
      s.zip_code || '',
      s.city || '',
      s.state || '',
      s.destination_country || '',
      s.order_created_timestamp ? formatExcelDate(s.order_created_timestamp) : '',  // From shipments.event_created
      s.label_generation_timestamp ? formatExcelDate(s.label_generation_timestamp) : '',
      s.delivered_date ? formatExcelDate(s.delivered_date) : '',
      s.transit_time_days || '',
      s.fc_name || ''
    ]
    row++
  }
  addTotalRow(shipmentsSheet, row, 12, shipmentsTotal) // Total Fulfillment Charge is col 12

  // Auto-fit columns
  shipmentsSheet.columns.forEach(col => { col.width = 15 })
  // Apply date/time format to date columns (new indices after adding User ID and removing Total)
  shipmentsSheet.getColumn(7).numFmt = dateTimeFormat  // Transaction Date
  shipmentsSheet.getColumn(30).numFmt = dateTimeFormat // Order Created
  shipmentsSheet.getColumn(31).numFmt = dateTimeFormat // Label Generated
  shipmentsSheet.getColumn(32).numFmt = dateTimeFormat // Delivered
  // Apply currency format to financial columns
  const currencyFormat = '#,##0.00'
  shipmentsSheet.getColumn(10).numFmt = currencyFormat // Base Fulfillment Charge
  shipmentsSheet.getColumn(11).numFmt = currencyFormat // Surcharges
  shipmentsSheet.getColumn(12).numFmt = currencyFormat // Total Fulfillment Charge
  shipmentsSheet.getColumn(13).numFmt = currencyFormat // Insurance

  // 2. ADDITIONAL SERVICES SHEET
  // Client-facing columns only - NO internal costs or markup percentages
  const feesSheet = workbook.addWorksheet('Additional Services')
  feesSheet.getRow(1).values = [
    'User ID', 'Merchant Name', 'Reference ID', 'Fee Type', 'Total Charge', 'Transaction Date'
  ]
  styleHeader(feesSheet, 1)

  // Sort fees by transaction_date descending (newest first)
  const sortedFees = [...detailedData.shipmentFees].sort((a, b) => {
    const dateA = a.transaction_date ? new Date(a.transaction_date).getTime() : 0
    const dateB = b.transaction_date ? new Date(b.transaction_date).getTime() : 0
    return dateB - dateA // descending
  })

  row = 2
  let feesTotal = 0
  for (const f of sortedFees) {
    const markupItem = data.lineItems.find(i => i.billingRecordId === f.id)
    const billedAmt = markupItem?.billedAmount || f.amount || 0

    feesTotal += billedAmt

    feesSheet.getRow(row).values = [
      data.client.merchant_id || '',  // User ID
      data.client.company_name,
      f.order_id || f.id,
      f.fee_type || '',
      billedAmt,
      f.transaction_date ? formatExcelDate(f.transaction_date) : ''
    ]
    row++
  }
  addTotalRow(feesSheet, row, 5, feesTotal)
  feesSheet.columns = [{ width: 12 }, { width: 20 }, { width: 15 }, { width: 25 }, { width: 15 }, { width: 20 }]
  feesSheet.getColumn(5).numFmt = currencyFormat // Total Charge
  feesSheet.getColumn(6).numFmt = dateTimeFormat // Transaction Date

  // 3. RETURNS SHEET
  // Client-facing columns only - NO internal costs or markup percentages
  const returnsSheet = workbook.addWorksheet('Returns')
  returnsSheet.getRow(1).values = [
    'User ID', 'Merchant Name', 'Return ID', 'Original Shipment ID', 'Tracking ID',
    'Total Charge', 'Transaction Type', 'Return Status', 'Return Type', 'Return Date', 'FC Name'
  ]
  styleHeader(returnsSheet, 1)

  // Sort returns by return_creation_date descending (newest first)
  const sortedReturns = [...detailedData.returns].sort((a, b) => {
    const dateA = a.return_creation_date ? new Date(a.return_creation_date).getTime() : 0
    const dateB = b.return_creation_date ? new Date(b.return_creation_date).getTime() : 0
    return dateB - dateA // descending
  })

  row = 2
  let returnsTotal = 0
  for (const r of sortedReturns) {
    const markupItem = data.lineItems.find(i => i.billingRecordId === r.id)
    const billedAmt = markupItem?.billedAmount || r.amount || 0

    returnsTotal += billedAmt

    returnsSheet.getRow(row).values = [
      data.client.merchant_id || '',  // User ID
      data.client.company_name,
      r.return_id || '',
      r.order_id || '',
      r.tracking_id || '',
      billedAmt,
      r.transaction_type || '',
      r.return_status || '',
      r.return_type || '',
      r.return_creation_date ? formatExcelDate(r.return_creation_date) : '',
      r.fc_name || ''
    ]
    row++
  }
  addTotalRow(returnsSheet, row, 6, returnsTotal)
  returnsSheet.columns.forEach(col => { col.width = 15 })
  returnsSheet.getColumn(6).numFmt = currencyFormat // Total Charge
  returnsSheet.getColumn(10).numFmt = dateTimeFormat // Return Date

  // 4. RECEIVING SHEET
  // Client-facing columns only - NO internal costs or markup percentages
  const receivingSheet = workbook.addWorksheet('Receiving')
  receivingSheet.getRow(1).values = [
    'User ID', 'Merchant Name', 'WRO ID', 'Fee Type', 'Total Charge', 'Transaction Type', 'Transaction Date'
  ]
  styleHeader(receivingSheet, 1)

  // Sort receiving by transaction_date descending (newest first)
  const sortedReceiving = [...detailedData.receiving].sort((a, b) => {
    const dateA = a.transaction_date ? new Date(a.transaction_date).getTime() : 0
    const dateB = b.transaction_date ? new Date(b.transaction_date).getTime() : 0
    return dateB - dateA // descending
  })

  row = 2
  let receivingTotal = 0
  for (const r of sortedReceiving) {
    const markupItem = data.lineItems.find(i => i.billingRecordId === r.id)
    const billedAmt = markupItem?.billedAmount || r.amount || 0

    receivingTotal += billedAmt

    receivingSheet.getRow(row).values = [
      data.client.merchant_id || '',  // User ID
      data.client.company_name,
      r.wro_id || '',
      r.fee_type || 'WRO Receiving Fee',
      billedAmt,
      r.transaction_type || '',
      r.transaction_date ? formatExcelDate(r.transaction_date) : ''
    ]
    row++
  }
  addTotalRow(receivingSheet, row, 5, receivingTotal)
  receivingSheet.columns = [{ width: 12 }, { width: 20 }, { width: 15 }, { width: 20 }, { width: 15 }, { width: 15 }, { width: 20 }]
  receivingSheet.getColumn(7).numFmt = dateTimeFormat // Transaction Date

  // 5. STORAGE SHEET
  // Client-facing columns only - NO internal costs or markup percentages
  const storageSheet = workbook.addWorksheet('Storage')
  storageSheet.getRow(1).values = [
    'User ID', 'Merchant Name', 'Charge Date', 'FC Name', 'Inventory ID',
    'Location Type', 'Total Charge', 'Comment'
  ]
  styleHeader(storageSheet, 1)

  // Sort storage by charge_start_date descending (newest first)
  const sortedStorage = [...detailedData.storage].sort((a, b) => {
    const dateA = a.charge_start_date ? new Date(a.charge_start_date).getTime() : 0
    const dateB = b.charge_start_date ? new Date(b.charge_start_date).getTime() : 0
    return dateB - dateA // descending
  })

  row = 2
  let storageTotal = 0
  for (const s of sortedStorage) {
    const markupItem = data.lineItems.find(i => i.billingRecordId === s.id)
    const billedAmt = markupItem?.billedAmount || s.amount || 0

    storageTotal += billedAmt

    storageSheet.getRow(row).values = [
      data.client.merchant_id || '',  // User ID
      data.client.company_name,
      s.charge_start_date ? formatExcelDate(s.charge_start_date) : '',
      s.fc_name || '',
      s.inventory_id || '',
      s.location_type || '',
      billedAmt,
      s.comment || ''
    ]
    row++
  }
  addTotalRow(storageSheet, row, 7, storageTotal)
  storageSheet.columns.forEach(col => { col.width = 15 })
  storageSheet.getColumn(3).numFmt = dateOnlyFormat // Charge Date (date only)

  // 6. CREDITS SHEET
  // Client-facing columns only - NO internal costs or markup percentages
  const creditsSheet = workbook.addWorksheet('Credits')
  creditsSheet.getRow(1).values = [
    'User ID', 'Merchant Name', 'Reference ID', 'Transaction Date', 'Credit Reason', 'Credit Amount'
  ]
  styleHeader(creditsSheet, 1)

  // Sort credits by transaction_date descending (newest first)
  const sortedCredits = [...detailedData.credits].sort((a, b) => {
    const dateA = a.transaction_date ? new Date(a.transaction_date).getTime() : 0
    const dateB = b.transaction_date ? new Date(b.transaction_date).getTime() : 0
    return dateB - dateA // descending
  })

  row = 2
  let creditsTotal = 0
  for (const c of sortedCredits) {
    const markupItem = data.lineItems.find(i => i.billingRecordId === c.id)
    const billedAmt = markupItem?.billedAmount || c.credit_amount || 0

    creditsTotal += billedAmt

    creditsSheet.getRow(row).values = [
      data.client.merchant_id || '',  // User ID
      data.client.company_name,
      c.reference_id || c.id,
      c.transaction_date ? formatExcelDate(c.transaction_date) : '',
      c.credit_reason || '',
      billedAmt
    ]
    row++
  }
  addTotalRow(creditsSheet, row, 6, creditsTotal)
  creditsSheet.columns = [{ width: 12 }, { width: 20 }, { width: 15 }, { width: 20 }, { width: 30 }, { width: 15 }]
  creditsSheet.getColumn(4).numFmt = dateTimeFormat // Transaction Date

  // Format number columns across all sheets (all financial values with 2 decimal places)
  const formatCurrencyColumns = (sheet: ExcelJS.Worksheet, cols: number[]) => {
    cols.forEach(colNum => {
      sheet.getColumn(colNum).numFmt = '#,##0.00'
    })
  }

  // Apply currency format to all financial columns (client-facing only)
  // With User ID added and Total removed: Base Fulfillment Charge(10), Surcharges(11), Total Fulfillment Charge(12), Insurance(13)
  formatCurrencyColumns(shipmentsSheet, [10, 11, 12, 13])
  // With User ID added to all sheets, column indices shift by 1
  formatCurrencyColumns(feesSheet, [5])                        // Total Charge
  formatCurrencyColumns(returnsSheet, [6])                     // Total Charge
  formatCurrencyColumns(receivingSheet, [5])                   // Total Charge
  formatCurrencyColumns(storageSheet, [7])                     // Total Charge
  formatCurrencyColumns(creditsSheet, [6])                     // Credit Amount

  // Generate buffer
  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

/**
 * Convert JavaScript Date to Excel serial date number
 * Excel serial date: days since Dec 30, 1899 (with time as decimal fraction)
 * This allows Excel to properly format dates with times
 */
function toExcelDate(dateStr: string | null | undefined): number | string {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return dateStr

  // Excel epoch is Dec 30, 1899 (accounting for Excel's leap year bug)
  const excelEpoch = new Date(Date.UTC(1899, 11, 30))
  const msPerDay = 24 * 60 * 60 * 1000

  // Calculate days since Excel epoch (including fractional day for time)
  const excelDate = (date.getTime() - excelEpoch.getTime()) / msPerDay

  return excelDate
}

/**
 * Format date for Excel output - returns string for date-only values
 * Use toExcelDate() for timestamp columns that need time precision
 */
function formatExcelDate(dateStr: string): number | string {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return dateStr

  // Check if input has time component (ISO timestamp with T and timezone)
  const hasTime = dateStr.includes('T') || dateStr.includes(':')

  if (hasTime) {
    // Return Excel serial date number for proper datetime display
    return toExcelDate(dateStr) as number
  }

  // Date-only: return Excel serial date (integer)
  return toExcelDate(dateStr) as number
}

/**
 * Store invoice files to Supabase Storage
 * Files are stored using invoice number as folder: {clientId}/{invoiceNumber}/{invoiceNumber}-details.xlsx
 * This matches the historical invoice storage format
 */
export async function storeInvoiceFiles(
  invoiceId: string,
  clientId: string,
  invoiceNumber: string,
  xlsBuffer: Buffer,
  pdfBuffer?: Buffer
): Promise<{ xlsPath: string; pdfPath: string | null }> {
  const supabase = createAdminClient()

  // Use invoice number as folder name (matches historical format)
  // Format: {clientId}/{invoiceNumber}/{invoiceNumber}-details.xlsx
  const xlsPath = `${clientId}/${invoiceNumber}/${invoiceNumber}-details.xlsx`
  const pdfPath = pdfBuffer ? `${clientId}/${invoiceNumber}/${invoiceNumber}.pdf` : null

  // Upload XLS
  const { error: xlsError } = await supabase.storage
    .from('invoices')
    .upload(xlsPath, xlsBuffer, {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      upsert: true,
    })

  if (xlsError) {
    console.error('Error uploading XLS:', xlsError)
    throw new Error(`Failed to upload XLS: ${xlsError.message}`)
  }

  // Upload PDF if provided
  if (pdfBuffer && pdfPath) {
    const { error: pdfError } = await supabase.storage
      .from('invoices')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      })

    if (pdfError) {
      console.error('Error uploading PDF:', pdfError)
      throw new Error(`Failed to upload PDF: ${pdfError.message}`)
    }
  }

  // Update invoice record with file paths
  const { error: updateError } = await supabase
    .from('invoices_jetpack')
    .update({
      xlsx_path: xlsPath,
      pdf_path: pdfPath,
      updated_at: new Date().toISOString(),
    })
    .eq('id', invoiceId)

  if (updateError) {
    console.error('Error updating invoice paths:', updateError)
  }

  return { xlsPath, pdfPath }
}


// Helpers

function formatStoragePeriod(start: Date, end: Date): string {
  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }
  return `${start.toLocaleDateString('en-US', options)} - ${end.toLocaleDateString('en-US', options)}`
}

function tableToBillingCategory(billingTable: string): BillingCategory {
  // Handle both formats: 'billing_shipment_fees' and 'shipment_fees'
  const mapping: Record<string, BillingCategory> = {
    'billing_shipments': 'shipments',
    'billing_shipment_fees': 'shipment_fees',
    'billing_storage': 'storage',
    'billing_credits': 'credits',
    'billing_returns': 'returns',
    'billing_receiving': 'receiving',
    'shipments': 'shipments',
    'shipment_fees': 'shipment_fees',
    'storage': 'storage',
    'credits': 'credits',
    'returns': 'returns',
    'receiving': 'receiving',
  }
  return mapping[billingTable] || 'shipments'
}

/**
 * Collect detailed billing data for XLSX export
 * Uses the unified transactions table (source of truth)
 */
export async function collectDetailedBillingData(
  clientId: string,
  periodStart: Date,
  periodEnd: Date
): Promise<DetailedBillingData> {
  const supabase = createAdminClient()
  const startStr = periodStart.toISOString().split('T')[0]
  const endStr = `${periodEnd.toISOString().split('T')[0]}T23:59:59.999Z`

  // Fetch all transactions for the client and period
  const { data: transactions } = await supabase
    .from('transactions')
    .select('*')
    .eq('client_id', clientId)
    .gte('charge_date', startStr)
    .lte('charge_date', endStr)
    .order('charge_date', { ascending: true })

  // Build returns data lookup from returns table for full timestamps
  const returnIds = (transactions || [])
    .filter((tx: Record<string, unknown>) => tx.reference_type === 'Return')
    .map((tx: Record<string, unknown>) => Number(tx.reference_id))
    .filter((id: number) => id > 0)

  const returnDataMap = new Map<string, Record<string, unknown>>()

  // Fetch return data in batches
  for (let i = 0; i < returnIds.length; i += 500) {
    const batch = returnIds.slice(i, i + 500)
    const { data: returnData } = await supabase
      .from('returns')
      .select('shipbob_return_id, insert_date, status, return_type, fc_name, original_shipment_id, tracking_number')
      .in('shipbob_return_id', batch)

    for (const r of returnData || []) {
      returnDataMap.set(String(r.shipbob_return_id), r)
    }
  }

  const shipments: DetailedShipment[] = []
  const shipmentFees: DetailedShipmentFee[] = []
  const returns: DetailedReturn[] = []
  const receiving: DetailedReceiving[] = []
  const storage: DetailedStorage[] = []
  const credits: DetailedCredit[] = []

  for (const tx of transactions || []) {
    const referenceType = tx.reference_type || ''
    const transactionFee = tx.fee_type || ''
    const details = (tx.additional_details as Record<string, unknown>) || {}
    const cost = Number(tx.cost) || 0

    if (transactionFee === 'Credit') {
      // Credits - decode ULID for full timestamp (matches reference XLSX)
      credits.push({
        id: tx.id,
        reference_id: tx.reference_id,
        transaction_date: decodeUlidTimestamp(tx.transaction_id) || tx.charge_date,
        credit_reason: String(details.Comment || details.CreditReason || ''),
        credit_amount: cost,
      })
    } else if (referenceType === 'Shipment') {
      if (transactionFee === 'Shipping') {
        // Base shipping charges - map to detailed shipment format
        // Note: This function doesn't have access to shipments table, so tracking_id and order_created are from transaction data
        shipments.push({
          id: tx.id,
          order_id: tx.reference_id,
          shipment_id: tx.tracking_id,
          tracking_id: null, // Would need shipments table lookup
          customer_name: String(details.CustomerName || ''),
          store_integration_name: String(details.StoreIntegrationName || ''),
          store_order_id: String(details.StoreOrderId || ''),
          transaction_type: tx.transaction_type,
          transaction_date: tx.charge_date,
          total_amount: cost,
          products_sold: String(details.ProductsSold || ''),
          total_quantity: Number(details.TotalQuantity) || null,
          ship_option_id: String(details.ShipOptionId || ''),
          carrier_name: String(details.CarrierName || ''),
          ship_option_name: String(details.ShipOptionName || ''),
          zone_used: Number(details.ZoneUsed) || null,
          actual_weight_oz: Number(details.ActualWeightOz) || null,
          dim_weight_oz: Number(details.DimWeightOz) || null,
          billable_weight_oz: Number(details.BillableWeightOz) || null,
          length: Number(details.Length) || null,
          width: Number(details.Width) || null,
          height: Number(details.Height) || null,
          zip_code: String(details.ZipCode || ''),
          city: String(details.City || ''),
          state: String(details.State || ''),
          destination_country: String(details.DestinationCountry || ''),
          order_created_timestamp: null, // Would need shipments.event_created
          label_generation_timestamp: String(details.LabelGenerationTimestamp || '') || null,
          delivered_date: String(details.DeliveredDate || '') || null,
          transit_time_days: Number(details.TransitTimeDays) || null,
          fc_name: tx.fulfillment_center,
          order_category: String(details.OrderCategory || ''),
        })
      } else if (ADDITIONAL_SERVICE_FEES.includes(transactionFee)) {
        // Additional service fees
        shipmentFees.push({
          id: tx.id,
          order_id: tx.reference_id,
          fee_type: transactionFee,
          amount: cost,
          transaction_date: tx.charge_date,
        })
      } else {
        // Unknown fee type within Shipment reference - put in Additional Services
        shipmentFees.push({
          id: tx.id,
          order_id: tx.reference_id,
          fee_type: transactionFee,
          amount: cost,
          transaction_date: tx.charge_date,
        })
      }
    } else if (referenceType === 'FC') {
      // Storage charges
      const refParts = String(tx.reference_id || '').split('-')
      const inventoryId = refParts[1] || ''
      const locationType = refParts[2] || String(details.LocationType || '')

      storage.push({
        id: tx.id,
        charge_start_date: tx.charge_date,
        fc_name: tx.fulfillment_center || refParts[0] || '',
        inventory_id: inventoryId,
        sku: String(details.SKU || ''),
        location_type: locationType,
        amount: cost,
        comment: String(details.Comment || ''),
      })
    } else if (referenceType === 'Return') {
      // Returns - look up return data for full timestamp
      const returnId = String(tx.reference_id)
      const returnData = returnDataMap.get(returnId)
      // Use return's insert_date for full timestamp, fallback to charge_date
      const returnTimestamp = (returnData?.insert_date || tx.charge_date) as string

      returns.push({
        id: tx.id,
        return_id: returnId,
        // Original Shipment ID - the shipment that was returned (from returns.original_shipment_id)
        order_id: returnData?.original_shipment_id ? String(returnData.original_shipment_id) : String(details.OriginalOrderId || ''),
        // Tracking ID from returns table
        tracking_id: returnData?.tracking_number as string || tx.tracking_id,
        amount: cost,
        // Transaction Type comes from transaction_fee (e.g., "Return to sender - Processing Fees")
        transaction_type: transactionFee || tx.transaction_type,
        return_status: returnData?.status as string || String(details.ReturnStatus || ''),
        return_type: returnData?.return_type as string || String(details.ReturnType || ''),
        return_creation_date: returnTimestamp,
        fc_name: returnData?.fc_name as string || tx.fulfillment_center,
      })
    } else if (referenceType === 'WRO' || transactionFee.includes('Receiving')) {
      // Receiving (WRO = Warehouse Receiving Order) - decode ULID for full timestamp
      receiving.push({
        id: tx.id,
        wro_id: tx.reference_id,
        fee_type: transactionFee,
        amount: cost,
        // Transaction Type - falls back to transaction_fee (e.g., "WRO Receiving Fee")
        transaction_type: tx.transaction_type || transactionFee,
        transaction_date: decodeUlidTimestamp(tx.transaction_id) || tx.charge_date,
      })
    } else if (referenceType === 'TicketNumber' && ADDITIONAL_SERVICE_FEES.includes(transactionFee)) {
      // VAS - Paid Requests and other ticket-based additional services
      shipmentFees.push({
        id: tx.id,
        order_id: tx.reference_id,
        fee_type: transactionFee,
        amount: cost,
        transaction_date: decodeUlidTimestamp(tx.transaction_id) || tx.charge_date,
      })
    } else {
      /// CATCH-ALL: Any unknown transaction goes to Additional Services (shipmentFees)
      // This ensures XLSX matches PDF - no orphaned fees
      shipmentFees.push({
        id: tx.id,
        order_id: tx.reference_id,
        fee_type: transactionFee || referenceType || 'Unknown',
        amount: cost,
        transaction_date: tx.charge_date,
      })
    }
  }

  return {
    shipments,
    shipmentFees,
    returns,
    receiving,
    storage,
    credits,
  }
}

/**
 * Collect detailed billing data by ShipBob invoice IDs
 * Use this for testing against specific reference invoices
 */
export async function collectDetailedBillingDataByInvoiceIds(
  clientId: string,
  invoiceIds: number[]
): Promise<DetailedBillingData> {
  const supabase = createAdminClient()

  // Fetch all transactions for the client by invoice_id_sb with pagination
  let allTransactions: Array<Record<string, unknown>> = []

  for (const invoiceId of invoiceIds) {
    let offset = 0
    while (true) {
      const { data: batch } = await supabase
        .from('transactions')
        .select('*')
        .eq('client_id', clientId)
        .eq('invoice_id_sb', invoiceId)
        .order('charge_date', { ascending: true })
        .order('id', { ascending: true }) // Secondary sort for stable pagination
        .range(offset, offset + 999)

      if (!batch || batch.length === 0) break
      allTransactions.push(...batch)
      if (batch.length < 1000) break
      offset += 1000
    }
  }

  const transactions = allTransactions

  // Build shipment data lookup from shipments table
  // For Shipment transactions: reference_id = shipment_id
  // We need: event_labeled (label gen timestamp), delivered_date, order info, etc.
  // Transaction Date = event_labeled (from ShipBob timeline API, backfilled)
  const shipmentIds = transactions
    .filter(tx => tx.reference_type === 'Shipment' && tx.fee_type === 'Shipping')
    .map(tx => String(tx.reference_id))
    .filter(id => id && id !== 'undefined')

  const shipmentDataMap = new Map<string, Record<string, unknown>>()

  // Fetch shipment data in batches
  for (let i = 0; i < shipmentIds.length; i += 500) {
    const batch = shipmentIds.slice(i, i + 500)
    const { data: shipmentData } = await supabase
      .from('shipments')
      .select(`
        shipment_id, tracking_id, created_at, event_created, event_labeled, carrier, carrier_service,
        ship_option_id, zone_used, actual_weight_oz, dim_weight_oz, billable_weight_oz,
        length, width, height, fc_name, order_id, shipbob_order_id, status,
        transit_time_days, event_intransit, event_delivered
      `)
      .eq('client_id', clientId)
      .in('shipment_id', batch)

    for (const s of shipmentData || []) {
      shipmentDataMap.set(String(s.shipment_id), s)
    }
  }

  // Fetch shipment_items to build products_sold and total_quantity
  // Use smaller batches (200) and higher limit (2000) to avoid Supabase's 1000 row default
  const shipmentItemsMap = new Map<string, Array<{ name: string; quantity: number }>>()
  const shipmentsNeedingQtyFallback: string[] = [] // Track shipments with null quantity

  for (let i = 0; i < shipmentIds.length; i += 200) {
    const batch = shipmentIds.slice(i, i + 200)
    const { data: itemsData } = await supabase
      .from('shipment_items')
      .select('shipment_id, name, quantity')
      .eq('client_id', clientId)
      .in('shipment_id', batch)
      .limit(2000)

    for (const item of itemsData || []) {
      const sid = String(item.shipment_id)
      if (!shipmentItemsMap.has(sid)) {
        shipmentItemsMap.set(sid, [])
      }
      const qty = item.quantity !== null && item.quantity !== undefined ? Number(item.quantity) : null
      if (qty === null) {
        shipmentsNeedingQtyFallback.push(sid)
      }
      shipmentItemsMap.get(sid)!.push({ name: item.name || '', quantity: qty ?? 0 }) // temp 0, will update from order_items
    }
  }

  // Also fetch order data for customer names, store info, etc.
  // Use smaller batches (50) for UUIDs - they're 36 chars each and can overflow HTTP headers
  const orderIds = [...new Set([...shipmentDataMap.values()].map(s => s.order_id).filter(Boolean))]
  const orderDataMap = new Map<string, Record<string, unknown>>()

  for (let i = 0; i < orderIds.length; i += 50) {
    const batch = orderIds.slice(i, i + 50)
    const { data: orderData } = await supabase
      .from('orders')
      .select(`
        id, shipbob_order_id, store_order_id, customer_name, channel_name,
        application_name, order_import_date, zip_code, city, state, country, order_type
      `)
      .in('id', batch as string[])

    for (const o of orderData || []) {
      orderDataMap.set(String(o.id), o)
    }
  }

  // Fallback: Get quantity from order_items for shipments with null quantity in shipment_items
  if (shipmentsNeedingQtyFallback.length > 0) {
    // Build shipment_id -> order_id mapping
    const shipmentToOrderMap = new Map<string, string>()
    for (const [sid, shipment] of shipmentDataMap.entries()) {
      if (shipment.order_id) {
        shipmentToOrderMap.set(sid, String(shipment.order_id))
      }
    }

    // Get unique order_ids for shipments needing fallback
    const uniqueOrderIds = [...new Set(
      shipmentsNeedingQtyFallback.map(sid => shipmentToOrderMap.get(sid)).filter(Boolean)
    )] as string[]

    // Fetch order_items for these orders
    const orderItemsMap = new Map<string, Array<{ name: string; quantity: number }>>()
    for (let i = 0; i < uniqueOrderIds.length; i += 50) {
      const batch = uniqueOrderIds.slice(i, i + 50)
      const { data: orderItemsData } = await supabase
        .from('order_items')
        .select('order_id, name, quantity')
        .in('order_id', batch)
        .limit(1000)

      for (const item of orderItemsData || []) {
        const oid = String(item.order_id)
        if (!orderItemsMap.has(oid)) {
          orderItemsMap.set(oid, [])
        }
        orderItemsMap.get(oid)!.push({ name: item.name || '', quantity: Number(item.quantity) || 1 })
      }
    }

    // Update shipmentItemsMap with fallback quantities from order_items
    for (const sid of shipmentsNeedingQtyFallback) {
      const orderId = shipmentToOrderMap.get(sid)
      if (!orderId) continue

      const orderItems = orderItemsMap.get(orderId)
      if (!orderItems || orderItems.length === 0) continue

      // Replace shipment_items entries with order_items data
      const shipmentItems = shipmentItemsMap.get(sid)
      if (shipmentItems) {
        // Match by name or just use order_items if names differ
        for (const si of shipmentItems) {
          if (si.quantity === 0) { // Was null, needs fallback
            // Find matching item by name in order_items
            const match = orderItems.find(oi => oi.name === si.name)
            if (match) {
              si.quantity = match.quantity
            } else {
              // If no name match, use first order item or default to 1
              si.quantity = orderItems[0]?.quantity || 1
            }
          }
        }
      }
    }
  }

  // Build returns data lookup from returns table
  // For Return transactions: reference_id = shipbob_return_id
  // We need: insert_date (full timestamp for Transaction Date)
  const returnIds = transactions
    .filter(tx => tx.reference_type === 'Return')
    .map(tx => Number(tx.reference_id))
    .filter(id => id > 0)

  const returnDataMap = new Map<string, Record<string, unknown>>()

  // Fetch return data in batches
  for (let i = 0; i < returnIds.length; i += 500) {
    const batch = returnIds.slice(i, i + 500)
    const { data: returnData } = await supabase
      .from('returns')
      .select('shipbob_return_id, insert_date, status, return_type, customer_name, store_order_id, fc_name, original_shipment_id, tracking_number')
      .in('shipbob_return_id', batch)

    for (const r of returnData || []) {
      returnDataMap.set(String(r.shipbob_return_id), r)
    }
  }

  const shipments: DetailedShipment[] = []
  const shipmentFees: DetailedShipmentFee[] = []
  const returns: DetailedReturn[] = []
  const receiving: DetailedReceiving[] = []
  const storage: DetailedStorage[] = []
  const credits: DetailedCredit[] = []

  for (const tx of transactions || []) {
    const referenceType = String(tx.reference_type || '')
    const transactionFee = String(tx.fee_type || '')
    const details = (tx.additional_details as Record<string, unknown>) || {}
    const cost = Number(tx.cost) || 0

    if (transactionFee === 'Credit') {
      // Credits - decode ULID for full timestamp (matches reference XLSX)
      credits.push({
        id: tx.id as string,
        reference_id: tx.reference_id as string,
        transaction_date: decodeUlidTimestamp(tx.transaction_id as string) || tx.charge_date as string,
        credit_reason: String(details.Comment || details.CreditReason || ''),
        credit_amount: cost,
      })
    } else if (referenceType === 'Shipment') {
      if (transactionFee === 'Shipping') {
        const shipmentId = String(tx.reference_id)
        const shipmentData = shipmentDataMap.get(shipmentId)
        const orderData = shipmentData?.order_id ? orderDataMap.get(String(shipmentData.order_id)) : null

        // Use shipment's event_labeled for transaction_date (label generation timestamp)
        // This matches the reference XLSX which shows full timestamps
        // Falls back to created_at if event_labeled hasn't been backfilled yet
        const labelGenTimestamp = (shipmentData?.event_labeled || shipmentData?.created_at) as string || null

        // Build products_sold from shipment_items (format: "Product A(2) ; Product B(1)")
        const items = shipmentItemsMap.get(shipmentId) || []
        const productsSold = items.length > 0
          ? items.map(i => `${i.name}(${i.quantity})`).join(' ; ')
          : ''
        const totalQuantity = items.reduce((sum, i) => sum + i.quantity, 0) || null

        // Get transit_time_days from shipments table or calculate from events
        let transitDays: number | null = (shipmentData?.transit_time_days as number) || null
        if (!transitDays && shipmentData?.event_intransit && shipmentData?.event_delivered) {
          const inTransit = new Date(shipmentData.event_intransit as string)
          const delivered = new Date(shipmentData.event_delivered as string)
          const diffMs = delivered.getTime() - inTransit.getTime()
          transitDays = Math.round((diffMs / (1000 * 60 * 60 * 24)) * 10) / 10 // One decimal place
        }

        shipments.push({
          id: tx.id as string,
          order_id: orderData?.shipbob_order_id as string || tx.reference_id as string,
          shipment_id: shipmentId,
          tracking_id: shipmentData?.tracking_id as string || null, // Carrier tracking number
          customer_name: orderData?.customer_name as string || String(details.CustomerName || ''),
          store_integration_name: orderData?.application_name as string || orderData?.channel_name as string || String(details.StoreIntegrationName || ''),
          store_order_id: orderData?.store_order_id as string || String(details.StoreOrderId || ''),
          transaction_type: tx.transaction_type as string,
          // Use label generation timestamp for Transaction Date (matches reference)
          transaction_date: labelGenTimestamp || tx.charge_date as string,
          total_amount: cost,
          products_sold: productsSold,
          total_quantity: totalQuantity,
          ship_option_id: shipmentData?.ship_option_id ? String(shipmentData.ship_option_id) : String(details.ShipOptionId || ''),
          carrier_name: shipmentData?.carrier as string || String(details.CarrierName || ''),
          ship_option_name: shipmentData?.carrier_service as string || String(details.ShipOptionName || ''),
          zone_used: (shipmentData?.zone_used as number) || Number(details.ZoneUsed) || null,
          actual_weight_oz: (shipmentData?.actual_weight_oz as number) || Number(details.ActualWeightOz) || null,
          dim_weight_oz: (shipmentData?.dim_weight_oz as number) || Number(details.DimWeightOz) || null,
          billable_weight_oz: (shipmentData?.billable_weight_oz as number) || Number(details.BillableWeightOz) || null,
          length: (shipmentData?.length as number) || Number(details.Length) || null,
          width: (shipmentData?.width as number) || Number(details.Width) || null,
          height: (shipmentData?.height as number) || Number(details.Height) || null,
          zip_code: orderData?.zip_code as string || String(details.ZipCode || ''),
          city: orderData?.city as string || String(details.City || ''),
          state: orderData?.state as string || String(details.State || ''),
          destination_country: orderData?.country as string || String(details.DestinationCountry || ''),
          order_created_timestamp: shipmentData?.event_created as string || null, // From shipments.event_created
          label_generation_timestamp: labelGenTimestamp,
          delivered_date: shipmentData?.event_delivered as string || String(details.DeliveredDate || '') || null,
          transit_time_days: transitDays,
          fc_name: shipmentData?.fc_name as string || tx.fulfillment_center as string,
          order_category: orderData?.order_type as string || String(details.OrderCategory || ''),
        })
      } else if (ADDITIONAL_SERVICE_FEES.includes(transactionFee)) {
        // Additional Services - decode ULID for full timestamp (matches reference XLSX)
        shipmentFees.push({
          id: tx.id as string,
          order_id: tx.reference_id as string,
          fee_type: transactionFee,
          amount: cost,
          transaction_date: decodeUlidTimestamp(tx.transaction_id as string) || tx.charge_date as string,
        })
      } else {
        // Unknown fee type within Shipment reference - put in Additional Services
        shipmentFees.push({
          id: tx.id as string,
          order_id: tx.reference_id as string,
          fee_type: transactionFee,
          amount: cost,
          transaction_date: tx.charge_date as string,
        })
      }
    } else if (referenceType === 'FC') {
      const refParts = String(tx.reference_id || '').split('-')
      const inventoryId = refParts[1] || ''
      const locationType = refParts[2] || String(details.LocationType || '')

      storage.push({
        id: tx.id as string,
        charge_start_date: tx.charge_date as string,
        fc_name: (tx.fulfillment_center as string) || refParts[0] || '',
        inventory_id: inventoryId,
        sku: String(details.SKU || ''),
        location_type: locationType,
        amount: cost,
        comment: String(details.Comment || ''),
      })
    } else if (referenceType === 'Return') {
      // Look up return data for full timestamp
      const returnId = String(tx.reference_id)
      const returnData = returnDataMap.get(returnId)
      // Use return's insert_date for full timestamp, fallback to charge_date
      const returnTimestamp = (returnData?.insert_date || tx.charge_date) as string

      returns.push({
        id: tx.id as string,
        return_id: returnId,
        // Original Shipment ID - the shipment that was returned (from returns.original_shipment_id)
        order_id: returnData?.original_shipment_id ? String(returnData.original_shipment_id) : String(details.OriginalOrderId || ''),
        // Tracking ID from the original shipment
        tracking_id: returnData?.tracking_number as string || tx.tracking_id as string,
        amount: cost,
        // Transaction Type comes from transaction_fee (e.g., "Return to sender - Processing Fees")
        transaction_type: transactionFee || tx.transaction_type as string,
        return_status: returnData?.status as string || String(details.ReturnStatus || ''),
        return_type: returnData?.return_type as string || String(details.ReturnType || ''),
        return_creation_date: returnTimestamp,
        fc_name: returnData?.fc_name as string || tx.fulfillment_center as string,
      })
    } else if (referenceType === 'WRO' || transactionFee.includes('Receiving')) {
      // Receiving (WRO) - decode ULID for full timestamp (matches reference XLSX)
      receiving.push({
        id: tx.id as string,
        wro_id: tx.reference_id as string,
        fee_type: transactionFee,
        amount: cost,
        // Transaction Type - falls back to transaction_fee (e.g., "WRO Receiving Fee")
        transaction_type: tx.transaction_type as string || transactionFee,
        transaction_date: decodeUlidTimestamp(tx.transaction_id as string) || tx.charge_date as string,
      })
    } else if (referenceType === 'TicketNumber' && ADDITIONAL_SERVICE_FEES.includes(transactionFee)) {
      // VAS - Paid Requests and other ticket-based additional services
      shipmentFees.push({
        id: tx.id as string,
        order_id: tx.reference_id as string,
        fee_type: transactionFee,
        amount: cost,
        transaction_date: decodeUlidTimestamp(tx.transaction_id as string) || tx.charge_date as string,
      })
    } else {
      /// CATCH-ALL: Any unknown transaction goes to Additional Services (shipmentFees)
      // This ensures XLSX matches PDF - no orphaned fees
      shipmentFees.push({
        id: tx.id as string,
        order_id: tx.reference_id as string,
        fee_type: transactionFee || referenceType || 'Unknown',
        amount: cost,
        transaction_date: tx.charge_date as string,
      })
    }
  }

  return {
    shipments,
    shipmentFees,
    returns,
    receiving,
    storage,
    credits,
  }
}

// Note: Returns timestamp lookup added above uses returnDataMap.get(returnId)?.insert_date
// TODO: Receiving (WRO) also needs full timestamps - requires syncing WRO data from ShipBob API

/**
 * Collect detailed billing data for unprocessed transactions
 * Use this for the actual cron job - queries by invoiced_status_jp = false
 */
export async function collectUnprocessedDetailedBillingData(
  clientId: string
): Promise<DetailedBillingData> {
  const supabase = createAdminClient()

  // Fetch all unprocessed transactions for the client with pagination
  let allTransactions: Array<Record<string, unknown>> = []
  let offset = 0

  while (true) {
    const { data: batch } = await supabase
      .from('transactions')
      .select('*')
      .eq('client_id', clientId)
      .eq('invoiced_status_jp', false)
      .order('charge_date', { ascending: true })
      .order('id', { ascending: true }) // Secondary sort for stable pagination
      .range(offset, offset + 999)

    if (!batch || batch.length === 0) break
    allTransactions.push(...batch)
    if (batch.length < 1000) break
    offset += 1000
  }

  const transactions = allTransactions

  // Build returns data lookup from returns table for full timestamps
  const returnIds = transactions
    .filter(tx => tx.reference_type === 'Return')
    .map(tx => Number(tx.reference_id))
    .filter(id => id > 0)

  const returnDataMap = new Map<string, Record<string, unknown>>()

  // Fetch return data in batches
  for (let i = 0; i < returnIds.length; i += 500) {
    const batch = returnIds.slice(i, i + 500)
    const { data: returnData } = await supabase
      .from('returns')
      .select('shipbob_return_id, insert_date, status, return_type, fc_name, original_shipment_id, tracking_number')
      .in('shipbob_return_id', batch)

    for (const r of returnData || []) {
      returnDataMap.set(String(r.shipbob_return_id), r)
    }
  }

  const shipments: DetailedShipment[] = []
  const shipmentFees: DetailedShipmentFee[] = []
  const returns: DetailedReturn[] = []
  const receiving: DetailedReceiving[] = []
  const storage: DetailedStorage[] = []
  const credits: DetailedCredit[] = []

  for (const tx of transactions || []) {
    const referenceType = String(tx.reference_type || '')
    const transactionFee = String(tx.fee_type || '')
    const details = (tx.additional_details as Record<string, unknown>) || {}
    const cost = Number(tx.cost) || 0

    if (transactionFee === 'Credit') {
      // Credits - decode ULID for full timestamp (matches reference XLSX)
      credits.push({
        id: tx.id as string,
        reference_id: tx.reference_id as string,
        transaction_date: decodeUlidTimestamp(tx.transaction_id as string) || tx.charge_date as string,
        credit_reason: String(details.Comment || details.CreditReason || ''),
        credit_amount: cost,
      })
    } else if (referenceType === 'Shipment') {
      if (transactionFee === 'Shipping') {
        // Note: This function doesn't have access to shipments table, so tracking_id and order_created are null
        shipments.push({
          id: tx.id as string,
          order_id: tx.reference_id as string,
          shipment_id: tx.tracking_id as string,
          tracking_id: null, // Would need shipments table lookup
          customer_name: String(details.CustomerName || ''),
          store_integration_name: String(details.StoreIntegrationName || ''),
          store_order_id: String(details.StoreOrderId || ''),
          transaction_type: tx.transaction_type as string,
          transaction_date: tx.charge_date as string,
          total_amount: cost,
          products_sold: String(details.ProductsSold || ''),
          total_quantity: Number(details.TotalQuantity) || null,
          ship_option_id: String(details.ShipOptionId || ''),
          carrier_name: String(details.CarrierName || ''),
          ship_option_name: String(details.ShipOptionName || ''),
          zone_used: Number(details.ZoneUsed) || null,
          actual_weight_oz: Number(details.ActualWeightOz) || null,
          dim_weight_oz: Number(details.DimWeightOz) || null,
          billable_weight_oz: Number(details.BillableWeightOz) || null,
          length: Number(details.Length) || null,
          width: Number(details.Width) || null,
          height: Number(details.Height) || null,
          zip_code: String(details.ZipCode || ''),
          city: String(details.City || ''),
          state: String(details.State || ''),
          destination_country: String(details.DestinationCountry || ''),
          order_created_timestamp: null, // Would need shipments.event_created
          label_generation_timestamp: String(details.LabelGenerationTimestamp || '') || null,
          delivered_date: String(details.DeliveredDate || '') || null,
          transit_time_days: Number(details.TransitTimeDays) || null,
          fc_name: tx.fulfillment_center as string,
          order_category: String(details.OrderCategory || ''),
        })
      } else if (ADDITIONAL_SERVICE_FEES.includes(transactionFee)) {
        // Additional Services - decode ULID for full timestamp (matches reference XLSX)
        shipmentFees.push({
          id: tx.id as string,
          order_id: tx.reference_id as string,
          fee_type: transactionFee,
          amount: cost,
          transaction_date: decodeUlidTimestamp(tx.transaction_id as string) || tx.charge_date as string,
        })
      } else {
        // Unknown fee type within Shipment reference - put in Additional Services
        shipmentFees.push({
          id: tx.id as string,
          order_id: tx.reference_id as string,
          fee_type: transactionFee,
          amount: cost,
          transaction_date: tx.charge_date as string,
        })
      }
    } else if (referenceType === 'FC') {
      const refParts = String(tx.reference_id || '').split('-')
      const inventoryId = refParts[1] || ''
      const locationType = refParts[2] || String(details.LocationType || '')

      storage.push({
        id: tx.id as string,
        charge_start_date: tx.charge_date as string,
        fc_name: (tx.fulfillment_center as string) || refParts[0] || '',
        inventory_id: inventoryId,
        sku: String(details.SKU || ''),
        location_type: locationType,
        amount: cost,
        comment: String(details.Comment || ''),
      })
    } else if (referenceType === 'Return') {
      // Returns - look up return data for full timestamp
      const returnId = String(tx.reference_id)
      const returnData = returnDataMap.get(returnId)
      // Use return's insert_date for full timestamp, fallback to charge_date
      const returnTimestamp = (returnData?.insert_date || tx.charge_date) as string

      returns.push({
        id: tx.id as string,
        return_id: returnId,
        // Original Shipment ID - the shipment that was returned (from returns.original_shipment_id)
        order_id: returnData?.original_shipment_id ? String(returnData.original_shipment_id) : String(details.OriginalOrderId || ''),
        // Tracking ID from returns table
        tracking_id: returnData?.tracking_number as string || tx.tracking_id as string,
        amount: cost,
        // Transaction Type comes from transaction_fee (e.g., "Return to sender - Processing Fees")
        transaction_type: transactionFee || tx.transaction_type as string,
        return_status: returnData?.status as string || String(details.ReturnStatus || ''),
        return_type: returnData?.return_type as string || String(details.ReturnType || ''),
        return_creation_date: returnTimestamp,
        fc_name: returnData?.fc_name as string || tx.fulfillment_center as string,
      })
    } else if (referenceType === 'WRO' || transactionFee.includes('Receiving')) {
      // Receiving (WRO) - decode ULID for full timestamp
      receiving.push({
        id: tx.id as string,
        wro_id: tx.reference_id as string,
        fee_type: transactionFee,
        amount: cost,
        // Transaction Type - falls back to transaction_fee (e.g., "WRO Receiving Fee")
        transaction_type: tx.transaction_type as string || transactionFee,
        transaction_date: decodeUlidTimestamp(tx.transaction_id as string) || tx.charge_date as string,
      })
    } else if (referenceType === 'TicketNumber' && ADDITIONAL_SERVICE_FEES.includes(transactionFee)) {
      // VAS - Paid Requests and other ticket-based additional services
      shipmentFees.push({
        id: tx.id as string,
        order_id: tx.reference_id as string,
        fee_type: transactionFee,
        amount: cost,
        transaction_date: decodeUlidTimestamp(tx.transaction_id as string) || tx.charge_date as string,
      })
    } else {
      /// CATCH-ALL: Any unknown transaction goes to Additional Services (shipmentFees)
      // This ensures XLSX matches PDF - no orphaned fees
      shipmentFees.push({
        id: tx.id as string,
        order_id: tx.reference_id as string,
        fee_type: transactionFee || referenceType || 'Unknown',
        amount: cost,
        transaction_date: tx.charge_date as string,
      })
    }
  }

  return {
    shipments,
    shipmentFees,
    returns,
    receiving,
    storage,
    credits,
  }
}

/**
 * Mark transactions as invoiced and save markup data
 * Updates invoiced_status_jp, invoice_id_jp, and all calculated markup fields
 *
 * For shipments, saves:
 *   - base_charge: base_cost × (1 + markup%)
 *   - total_charge: base_charge + surcharge
 *   - insurance_charge: insurance_cost × (1 + markup%)
 *   - billed_amount: total_charge + insurance_charge
 *
 * For non-shipments, saves:
 *   - billed_amount: cost × (1 + markup%)
 */
/**
 * Mark transactions as invoiced with their markup data
 * @param lineItems - Line items with markup applied
 * @param invoiceNumber - Human-readable invoice number (e.g., "JPHS-0037-120125"), NOT the UUID
 * @param invoiceDate - Optional invoice date (defaults to current date if not provided)
 */
export async function markTransactionsAsInvoiced(
  lineItems: InvoiceLineItem[],
  invoiceNumber: string,
  invoiceDate?: string | Date
): Promise<{ updated: number; errors: string[] }> {
  const supabase = createAdminClient()
  const errors: string[] = []
  let updated = 0

  // Convert invoice date to ISO string if provided
  const invoiceDateIso = invoiceDate
    ? (typeof invoiceDate === 'string' ? new Date(invoiceDate).toISOString() : invoiceDate.toISOString())
    : new Date().toISOString()

  // Update each transaction with its markup data
  for (let i = 0; i < lineItems.length; i += 500) {
    const batch = lineItems.slice(i, i + 500)

    for (const item of batch) {
      const isShipment = item.billingTable === 'billing_shipments'

      // Build update object with common fields
      const updateData: Record<string, unknown> = {
        invoiced_status_jp: true,
        invoice_id_jp: invoiceNumber,
        invoice_date_jp: invoiceDateIso,
        markup_applied: item.markupApplied,
        billed_amount: item.billedAmount,
        markup_percentage: item.markupPercentage,
        markup_rule_id: item.markupRuleId,
        updated_at: new Date().toISOString(),
      }

      // Add shipment-specific fields
      if (isShipment) {
        updateData.base_charge = item.baseCharge || null
        updateData.total_charge = item.totalCharge || null
        updateData.insurance_charge = item.insuranceCharge || null
      }

      const { error } = await supabase
        .from('transactions')
        .update(updateData)
        .eq('id', item.id)

      if (error) {
        errors.push(`Transaction ${item.id}: ${error.message}`)
      } else {
        updated++
      }
    }
  }

  return { updated, errors }
}

/**
 * Main function: Generate a complete invoice with files
 */
export async function generateInvoice(
  invoice: JetpackInvoice,
  client: InvoiceData['client']
): Promise<InvoiceData> {
  const periodStart = new Date(invoice.period_start)
  const periodEnd = new Date(invoice.period_end)

  // Collect all billing transactions (for line items and markup calculation)
  let lineItems = await collectBillingTransactions(client.id, periodStart, periodEnd)

  // Apply markups
  lineItems = await applyMarkupsToLineItems(client.id, lineItems)

  // Generate summary
  const summary = generateSummary(lineItems)

  // Build invoice data
  const data: InvoiceData = {
    invoice,
    client,
    lineItems,
    summary,
  }

  // Collect detailed data for XLSX (includes all raw fields)
  const detailedData = await collectDetailedBillingData(client.id, periodStart, periodEnd)

  // Generate XLS file with 6 sheets
  const xlsBuffer = await generateExcelInvoice(data, detailedData)

  // Generate PDF summary
  const pdfBuffer = await generatePDFInvoice(data)

  // Store files (both XLSX and PDF)
  await storeInvoiceFiles(invoice.id, client.id, invoice.invoice_number, xlsBuffer, pdfBuffer)

  // Mark transactions as invoiced and save markup data
  await markTransactionsAsInvoiced(lineItems, invoice.id)

  return data
}

// Re-export PDF generator for direct use
export { generatePDFInvoice }
