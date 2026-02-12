/**
 * Invoice-format export column configurations.
 * These define the exact column headers and data field mappings
 * used in invoice XLS files, so dashboard exports match invoices.
 *
 * Source of truth: lib/billing/invoice-generator.ts (generateExcelInvoice)
 */

/**
 * Column mapping: ordered array of { key, header } pairs.
 * - key: the data field name in the API response
 * - header: the invoice column header (exact match)
 */
export type InvoiceExportColumn = { key: string; header: string }

/**
 * Shipments invoice sheet columns (34 columns).
 * Used by both Shipments and Unfulfilled export tabs.
 */
export const SHIPMENTS_INVOICE_COLUMNS: InvoiceExportColumn[] = [
  { key: 'merchantId', header: 'User ID' },
  { key: 'merchantName', header: 'Merchant Name' },
  { key: 'customerName', header: 'Customer Name' },
  { key: 'channelName', header: 'Store' },
  { key: 'shipmentId', header: 'Shipment ID' },
  { key: 'transactionType', header: 'Transaction Type' },
  { key: 'transactionDate', header: 'Transaction Date' },
  { key: 'storeOrderId', header: 'Store Order ID' },
  { key: 'trackingId', header: 'Tracking ID' },
  { key: 'baseCharge', header: 'Base Fulfillment Charge' },
  { key: 'surchargeAmount', header: 'Surcharges' },
  { key: 'charge', header: 'Total Fulfillment Charge' },
  { key: 'insuranceCharge', header: 'Insurance' },
  { key: 'productsSold', header: 'Products Sold' },
  { key: 'qty', header: 'Total Quantity' },
  { key: 'shipOptionId', header: 'Ship Option ID' },
  { key: 'carrier', header: 'Carrier' },
  { key: 'carrierService', header: 'Carrier Service' },
  { key: 'zone', header: 'Zone' },
  { key: 'actualWeightOz', header: 'Actual Weight (Oz)' },
  { key: 'dimWeightOz', header: 'Dim Weight (Oz)' },
  { key: 'billableWeightOz', header: 'Billable Weight (Oz)' },
  { key: 'lengthIn', header: 'Length' },
  { key: 'widthIn', header: 'Width' },
  { key: 'heightIn', header: 'Height' },
  { key: 'zipCode', header: 'Zip Code' },
  { key: 'city', header: 'City' },
  { key: 'state', header: 'State' },
  { key: 'destCountry', header: 'Country' },
  { key: 'orderDate', header: 'Order Created' },
  { key: 'labelCreated', header: 'Label Generated' },
  { key: 'deliveredDate', header: 'Delivered' },
  { key: 'transitTimeDays', header: 'Transit Days' },
  { key: 'fcName', header: 'FC Name' },
]

/**
 * Additional Services invoice sheet columns (6 columns).
 */
export const ADDITIONAL_SERVICES_INVOICE_COLUMNS: InvoiceExportColumn[] = [
  { key: 'merchantId', header: 'User ID' },
  { key: 'merchantName', header: 'Merchant Name' },
  { key: 'referenceId', header: 'Reference ID' },
  { key: 'feeType', header: 'Fee Type' },
  { key: 'charge', header: 'Total Charge' },
  { key: 'transactionDate', header: 'Transaction Date' },
]

/**
 * Returns invoice sheet columns (11 columns).
 */
export const RETURNS_INVOICE_COLUMNS: InvoiceExportColumn[] = [
  { key: 'merchantId', header: 'User ID' },
  { key: 'merchantName', header: 'Merchant Name' },
  { key: 'returnId', header: 'Return ID' },
  { key: 'originalShipmentId', header: 'Original Shipment ID' },
  { key: 'trackingNumber', header: 'Tracking ID' },
  { key: 'charge', header: 'Total Charge' },
  { key: 'transactionType', header: 'Transaction Type' },
  { key: 'returnStatus', header: 'Return Status' },
  { key: 'returnType', header: 'Return Type' },
  { key: 'returnCreationDate', header: 'Return Date' },
  { key: 'fcName', header: 'FC Name' },
]

/**
 * Receiving invoice sheet columns (7 columns).
 */
export const RECEIVING_INVOICE_COLUMNS: InvoiceExportColumn[] = [
  { key: 'merchantId', header: 'User ID' },
  { key: 'merchantName', header: 'Merchant Name' },
  { key: 'wroId', header: 'WRO ID' },
  { key: 'feeType', header: 'Fee Type' },
  { key: 'charge', header: 'Total Charge' },
  { key: 'transactionType', header: 'Transaction Type' },
  { key: 'transactionDate', header: 'Transaction Date' },
]

/**
 * Storage invoice sheet columns (8 columns).
 */
export const STORAGE_INVOICE_COLUMNS: InvoiceExportColumn[] = [
  { key: 'merchantId', header: 'User ID' },
  { key: 'merchantName', header: 'Merchant Name' },
  { key: 'chargeStartDate', header: 'Charge Date' },
  { key: 'fcName', header: 'FC Name' },
  { key: 'inventoryId', header: 'Inventory ID' },
  { key: 'locationType', header: 'Location Type' },
  { key: 'charge', header: 'Total Charge' },
  { key: 'comment', header: 'Comment' },
]

/**
 * Credits invoice sheet columns (6 columns).
 */
export const CREDITS_INVOICE_COLUMNS: InvoiceExportColumn[] = [
  { key: 'merchantId', header: 'User ID' },
  { key: 'merchantName', header: 'Merchant Name' },
  { key: 'referenceId', header: 'Reference ID' },
  { key: 'transactionDate', header: 'Transaction Date' },
  { key: 'creditReason', header: 'Credit Reason' },
  { key: 'creditAmount', header: 'Credit Amount' },
]

/**
 * Convert an InvoiceExportColumn[] config to the columnMapping + columns format
 * expected by exportData().
 */
export function toExportMapping(config: InvoiceExportColumn[]): {
  columnMapping: Record<string, string>
  columns: string[]
} {
  const columnMapping: Record<string, string> = {}
  const columns: string[] = []
  for (const col of config) {
    columnMapping[col.key] = col.header
    columns.push(col.key)
  }
  return { columnMapping, columns }
}
