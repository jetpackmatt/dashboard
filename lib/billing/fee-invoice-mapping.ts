/**
 * Maps ShipBob transaction_fee types to invoice categories
 *
 * ShipBob Invoice Types:
 * - Shipping: Carrier shipping costs
 * - AdditionalFee: Fulfillment fees (picking, handling, surcharges)
 * - WarehouseStorage: Monthly storage fees
 * - WarehouseInboundFee: Receiving/inbound fees (WRO)
 * - ReturnsFee: Return processing fees
 * - Credits: Credit adjustments (negative)
 * - Payment: Payments made to ShipBob (negative, tracked separately)
 */

export type InvoiceType =
  | 'Shipping'
  | 'AdditionalFee'
  | 'WarehouseStorage'
  | 'WarehouseInboundFee'
  | 'ReturnsFee'
  | 'Credits'
  | 'Payment'

export const FEE_TO_INVOICE_TYPE: Record<string, InvoiceType> = {
  // Shipping - carrier costs and corrections
  'Shipping': 'Shipping',
  'Address Correction': 'Shipping',

  // Additional Fees - fulfillment and handling
  'Per Pick Fee': 'AdditionalFee',
  'B2B - Case Pick Fee': 'AdditionalFee',
  'B2B - Each Pick Fee': 'AdditionalFee',
  'B2B - Order Fee': 'AdditionalFee',
  'B2B - Label Fee': 'AdditionalFee',
  'B2B - Pallet Material Charge': 'AdditionalFee',
  'B2B - Pallet Pack Fee': 'AdditionalFee',
  'B2B - Supplies': 'AdditionalFee',
  'B2B - ShipBob Freight Fee': 'AdditionalFee',
  'VAS - Paid Requests': 'AdditionalFee',
  'Inventory Placement Program Fee': 'AdditionalFee',
  'WRO Label Fee': 'AdditionalFee',
  'Kitting Fee': 'AdditionalFee',
  'Credit Card Processing Fee': 'AdditionalFee',

  // Warehouse Storage
  'Warehousing Fee': 'WarehouseStorage',
  'URO Storage Fee': 'WarehouseStorage',

  // Warehouse Inbound (Receiving)
  'WRO Receiving Fee': 'WarehouseInboundFee',

  // Returns
  'Return to sender - Processing Fees': 'ReturnsFee',
  'Return Processed by Operations Fee': 'ReturnsFee',
  'Return Label': 'ReturnsFee',

  // Credits
  'Credit': 'Credits',

  // Payments (tracked separately from charges)
  'Payment': 'Payment',
}

/**
 * Get invoice type for a transaction fee
 * Returns 'AdditionalFee' for unmapped fees as a safe default
 */
export function getInvoiceType(transactionFee: string | null): InvoiceType {
  if (!transactionFee) return 'AdditionalFee'
  return FEE_TO_INVOICE_TYPE[transactionFee] || 'AdditionalFee'
}

/**
 * Group transactions by invoice type and sum amounts
 */
export function aggregateByInvoiceType(
  transactions: Array<{ fee_type: string | null; amount: number }>
): Record<InvoiceType, number> {
  const result: Record<InvoiceType, number> = {
    Shipping: 0,
    AdditionalFee: 0,
    WarehouseStorage: 0,
    WarehouseInboundFee: 0,
    ReturnsFee: 0,
    Credits: 0,
    Payment: 0,
  }

  for (const tx of transactions) {
    const invoiceType = getInvoiceType(tx.fee_type)
    result[invoiceType] += tx.amount
  }

  return result
}

/**
 * Display names for invoice types (for PDF/XLS generation)
 */
export const INVOICE_TYPE_LABELS: Record<InvoiceType, string> = {
  Shipping: 'Shipping & Handling',
  AdditionalFee: 'Fulfillment Fees',
  WarehouseStorage: 'Storage Fees',
  WarehouseInboundFee: 'Receiving Fees',
  ReturnsFee: 'Returns Processing',
  Credits: 'Credits & Adjustments',
  Payment: 'Payments',
}
