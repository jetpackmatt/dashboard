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
  order_insert_timestamp: string | null
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
  baseAmount: number
  markupApplied: number
  billedAmount: number
  markupRuleId: string | null
  markupPercentage: number
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
  }
  lineItems: InvoiceLineItem[]
  summary: {
    subtotal: number
    totalMarkup: number
    totalAmount: number
    byCategory: Record<LineCategory, { count: number; subtotal: number; markup: number; total: number }>
  }
}

/**
 * Collect all billing transactions for a client and period
 */
export async function collectBillingTransactions(
  clientId: string,
  periodStart: Date,
  periodEnd: Date
): Promise<InvoiceLineItem[]> {
  const supabase = createAdminClient()
  const startStr = periodStart.toISOString().split('T')[0]
  const endStr = periodEnd.toISOString().split('T')[0]

  const items: InvoiceLineItem[] = []

  // Fetch shipments
  const { data: shipments } = await supabase
    .from('billing_shipments')
    .select('*')
    .eq('client_id', clientId)
    .gte('transaction_date', startStr)
    .lte('transaction_date', endStr)
    .order('transaction_date', { ascending: true })

  for (const s of shipments || []) {
    // Determine fee type based on order_category: Standard (null), FBA, VAS
    // This applies to both Charges and Refunds - refunds use the same markup as the original charge
    const feeType = getShipmentFeeType(s.order_category)
    const isRefund = s.transaction_type === 'Refund'

    // For refunds, the base amount is already negative from ShipBob
    const baseAmount = Number(s.total_amount) || 0

    items.push({
      id: s.id,
      billingTable: 'billing_shipments',
      billingRecordId: s.id,
      baseAmount,
      markupApplied: 0, // Will be calculated
      billedAmount: 0,
      markupRuleId: null,
      markupPercentage: 0,
      lineCategory: s.order_category === 'FBA' ? 'Fulfillment' : 'Shipping',
      description: `${isRefund ? 'Refund: ' : ''}Order ${s.order_id || 'N/A'} - ${s.carrier_name || 'Carrier'} ${s.ship_option_name || ''}`.trim(),
      orderNumber: s.order_id,
      trackingNumber: s.shipment_id, // shipment_id is the tracking number
      feeType,
      transactionDate: s.transaction_date,
    })
  }

  // Fetch shipment fees
  const { data: fees } = await supabase
    .from('billing_shipment_fees')
    .select('*')
    .eq('client_id', clientId)
    .gte('transaction_date', startStr)
    .lte('transaction_date', endStr)
    .order('transaction_date', { ascending: true })

  for (const f of fees || []) {
    // Categorize B2B fees
    const isB2B = f.fee_type?.startsWith('B2B')
    const isPick = f.fee_type?.includes('Pick')

    let category: LineCategory = 'Additional Services'
    if (isB2B) category = 'B2B Fees'
    else if (isPick) category = 'Pick Fees'

    items.push({
      id: f.id,
      billingTable: 'billing_shipment_fees',
      billingRecordId: f.id,
      baseAmount: Number(f.amount) || 0,
      markupApplied: 0,
      billedAmount: 0,
      markupRuleId: null,
      markupPercentage: 0,
      lineCategory: category,
      description: f.fee_type || 'Fee',
      orderNumber: f.order_id,
      feeType: f.fee_type,
      transactionDate: f.transaction_date,
    })
  }

  // Fetch storage
  const { data: storage } = await supabase
    .from('billing_storage')
    .select('*')
    .eq('client_id', clientId)
    .gte('charge_start_date', startStr)
    .lte('charge_start_date', endStr)
    .order('charge_start_date', { ascending: true })

  for (const s of storage || []) {
    const start = new Date(s.charge_start_date)
    const end = s.charge_end_date ? new Date(s.charge_end_date) : start
    const periodLabel = formatStoragePeriod(start, end)

    items.push({
      id: s.id,
      billingTable: 'billing_storage',
      billingRecordId: s.id,
      baseAmount: Number(s.amount) || 0,
      markupApplied: 0,
      billedAmount: 0,
      markupRuleId: null,
      markupPercentage: 0,
      lineCategory: 'Storage',
      description: `${s.location_type} Storage - ${s.sku || 'N/A'}`,
      periodLabel,
      feeType: s.location_type,
      transactionDate: s.charge_start_date,
    })
  }

  // Fetch returns
  const { data: returns } = await supabase
    .from('billing_returns')
    .select('*')
    .eq('client_id', clientId)
    .gte('return_creation_date', startStr)
    .lte('return_creation_date', endStr)
    .order('return_creation_date', { ascending: true })

  for (const r of returns || []) {
    items.push({
      id: r.id,
      billingTable: 'billing_returns',
      billingRecordId: r.id,
      baseAmount: Number(r.amount) || 0,
      markupApplied: 0,
      billedAmount: 0,
      markupRuleId: null,
      markupPercentage: 0,
      lineCategory: 'Returns',
      description: r.transaction_type || 'Return',
      feeType: r.transaction_type,
      transactionDate: r.return_creation_date,
    })
  }

  // Fetch receiving
  const { data: receiving } = await supabase
    .from('billing_receiving')
    .select('*')
    .eq('client_id', clientId)
    .gte('transaction_date', startStr)
    .lte('transaction_date', endStr)
    .order('transaction_date', { ascending: true })

  for (const r of receiving || []) {
    items.push({
      id: r.id,
      billingTable: 'billing_receiving',
      billingRecordId: r.id,
      baseAmount: Number(r.amount) || 0,
      markupApplied: 0,
      billedAmount: 0,
      markupRuleId: null,
      markupPercentage: 0,
      lineCategory: 'Receiving',
      description: `WRO ${r.wro_id || 'N/A'} - ${r.transaction_type || 'Receiving'}`,
      feeType: r.transaction_type,
      transactionDate: r.transaction_date,
    })
  }

  // Fetch credits (negative values)
  const { data: credits } = await supabase
    .from('billing_credits')
    .select('*')
    .eq('client_id', clientId)
    .gte('transaction_date', startStr)
    .lte('transaction_date', endStr)
    .order('transaction_date', { ascending: true })

  for (const c of credits || []) {
    items.push({
      id: c.id,
      billingTable: 'billing_credits',
      billingRecordId: c.id,
      baseAmount: Number(c.credit_amount) || 0, // Already negative in DB
      markupApplied: 0,
      billedAmount: 0,
      markupRuleId: null,
      markupPercentage: 0,
      lineCategory: 'Credits',
      description: c.credit_reason || 'Credit',
      feeType: c.credit_reason,
      transactionDate: c.transaction_date,
    })
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
  // Build transaction contexts for markup calculation
  const transactions = lineItems.map(item => ({
    id: item.id,
    baseAmount: item.baseAmount,
    context: {
      clientId,
      transactionDate: new Date(item.transactionDate),
      feeType: item.feeType || '',
      billingCategory: tableToBillingCategory(item.billingTable),
      orderCategory: null, // Could be enhanced to include order category
      shipOptionId: null,  // Could be enhanced to include ship option
      weightOz: undefined,
      state: undefined,
      country: undefined,
    } as TransactionContext,
  }))

  // Calculate markups in batch
  const markupResults = await calculateBatchMarkups(transactions)

  // Apply results to line items
  return lineItems.map(item => {
    const result = markupResults.get(item.id)
    if (result) {
      return {
        ...item,
        markupApplied: result.markupAmount,
        billedAmount: result.billedAmount,
        markupRuleId: result.ruleId,
        markupPercentage: result.markupPercentage,
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
    subtotal += item.baseAmount
    totalMarkup += item.markupApplied

    const cat = byCategory[item.lineCategory]
    if (cat) {
      cat.count++
      cat.subtotal += item.baseAmount
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

  // 1. SHIPMENTS SHEET
  const shipmentsSheet = workbook.addWorksheet('Shipments')
  shipmentsSheet.getRow(1).values = [
    'Merchant Name', 'Customer Name', 'Store', 'Order ID', 'Transaction Type',
    'Transaction Date', 'Store Order ID', 'Tracking ID', 'ShipBob Cost', 'Markup %',
    'Billed Amount', 'Products Sold', 'Total Quantity', 'Ship Option ID', 'Carrier',
    'Carrier Service', 'Zone', 'Actual Weight (Oz)', 'Dim Weight (Oz)', 'Billable Weight (Oz)',
    'Length', 'Width', 'Height', 'Zip Code', 'City', 'State', 'Country',
    'Order Created', 'Label Generated', 'Delivered', 'Transit Days', 'FC Name', 'Order Category'
  ]
  styleHeader(shipmentsSheet, 1)

  let row = 2
  let shipmentsTotal = 0
  for (const s of detailedData.shipments) {
    const markupItem = data.lineItems.find(i => i.billingRecordId === s.id)
    const markupPct = markupItem?.markupPercentage || 0
    const billedAmt = markupItem?.billedAmount || s.total_amount || 0

    shipmentsTotal += billedAmt

    shipmentsSheet.getRow(row).values = [
      data.client.company_name,
      s.customer_name || '',
      s.store_integration_name || '',
      s.order_id || '',
      s.transaction_type || '',
      s.transaction_date ? formatExcelDate(s.transaction_date) : '',
      s.store_order_id || '',
      s.shipment_id || '',
      s.total_amount || 0,
      markupPct,
      billedAmt,
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
      s.order_insert_timestamp ? formatExcelDate(s.order_insert_timestamp) : '',
      s.label_generation_timestamp ? formatExcelDate(s.label_generation_timestamp) : '',
      s.delivered_date ? formatExcelDate(s.delivered_date) : '',
      s.transit_time_days || '',
      s.fc_name || '',
      s.order_category || ''
    ]
    row++
  }
  addTotalRow(shipmentsSheet, row, 11, shipmentsTotal)

  // Auto-fit columns
  shipmentsSheet.columns.forEach(col => { col.width = 15 })

  // 2. ADDITIONAL SERVICES SHEET
  const feesSheet = workbook.addWorksheet('Additional Services')
  feesSheet.getRow(1).values = [
    'Merchant Name', 'Reference ID', 'Fee Type', 'ShipBob Cost', 'Markup %', 'Billed Amount', 'Transaction Date'
  ]
  styleHeader(feesSheet, 1)

  row = 2
  let feesTotal = 0
  for (const f of detailedData.shipmentFees) {
    const markupItem = data.lineItems.find(i => i.billingRecordId === f.id)
    const markupPct = markupItem?.markupPercentage || 0
    const billedAmt = markupItem?.billedAmount || f.amount || 0

    feesTotal += billedAmt

    feesSheet.getRow(row).values = [
      data.client.company_name,
      f.order_id || f.id,
      f.fee_type || '',
      f.amount || 0,
      markupPct,
      billedAmt,
      f.transaction_date ? formatExcelDate(f.transaction_date) : ''
    ]
    row++
  }
  addTotalRow(feesSheet, row, 6, feesTotal)
  feesSheet.columns = [{ width: 20 }, { width: 15 }, { width: 25 }, { width: 12 }, { width: 10 }, { width: 12 }, { width: 15 }]

  // 3. RETURNS SHEET
  const returnsSheet = workbook.addWorksheet('Returns')
  returnsSheet.getRow(1).values = [
    'Merchant Name', 'Return ID', 'Original Order ID', 'Tracking ID', 'ShipBob Cost',
    'Markup %', 'Billed Amount', 'Transaction Type', 'Return Status', 'Return Type', 'Return Date', 'FC Name'
  ]
  styleHeader(returnsSheet, 1)

  row = 2
  let returnsTotal = 0
  for (const r of detailedData.returns) {
    const markupItem = data.lineItems.find(i => i.billingRecordId === r.id)
    const markupPct = markupItem?.markupPercentage || 0
    const billedAmt = markupItem?.billedAmount || r.amount || 0

    returnsTotal += billedAmt

    returnsSheet.getRow(row).values = [
      data.client.company_name,
      r.return_id || '',
      r.order_id || '',
      r.tracking_id || '',
      r.amount || 0,
      markupPct,
      billedAmt,
      r.transaction_type || '',
      r.return_status || '',
      r.return_type || '',
      r.return_creation_date ? formatExcelDate(r.return_creation_date) : '',
      r.fc_name || ''
    ]
    row++
  }
  addTotalRow(returnsSheet, row, 7, returnsTotal)
  returnsSheet.columns.forEach(col => { col.width = 15 })

  // 4. RECEIVING SHEET
  const receivingSheet = workbook.addWorksheet('Receiving')
  receivingSheet.getRow(1).values = [
    'Merchant Name', 'WRO ID', 'Fee Type', 'ShipBob Cost', 'Markup %', 'Billed Amount', 'Transaction Type', 'Transaction Date'
  ]
  styleHeader(receivingSheet, 1)

  row = 2
  let receivingTotal = 0
  for (const r of detailedData.receiving) {
    const markupItem = data.lineItems.find(i => i.billingRecordId === r.id)
    const markupPct = markupItem?.markupPercentage || 0
    const billedAmt = markupItem?.billedAmount || r.amount || 0

    receivingTotal += billedAmt

    receivingSheet.getRow(row).values = [
      data.client.company_name,
      r.wro_id || '',
      r.fee_type || 'WRO Receiving Fee',
      r.amount || 0,
      markupPct,
      billedAmt,
      r.transaction_type || '',
      r.transaction_date ? formatExcelDate(r.transaction_date) : ''
    ]
    row++
  }
  addTotalRow(receivingSheet, row, 6, receivingTotal)
  receivingSheet.columns = [{ width: 20 }, { width: 15 }, { width: 20 }, { width: 12 }, { width: 10 }, { width: 12 }, { width: 15 }, { width: 15 }]

  // 5. STORAGE SHEET
  const storageSheet = workbook.addWorksheet('Storage')
  storageSheet.getRow(1).values = [
    'Merchant Name', 'Charge Date', 'FC Name', 'Inventory ID', 'SKU',
    'Location Type', 'ShipBob Cost', 'Markup %', 'Billed Amount', 'Comment'
  ]
  styleHeader(storageSheet, 1)

  row = 2
  let storageTotal = 0
  for (const s of detailedData.storage) {
    const markupItem = data.lineItems.find(i => i.billingRecordId === s.id)
    const markupPct = markupItem?.markupPercentage || 0
    const billedAmt = markupItem?.billedAmount || s.amount || 0

    storageTotal += billedAmt

    storageSheet.getRow(row).values = [
      data.client.company_name,
      s.charge_start_date ? formatExcelDate(s.charge_start_date) : '',
      s.fc_name || '',
      s.inventory_id || '',
      s.sku || '',
      s.location_type || '',
      s.amount || 0,
      markupPct,
      billedAmt,
      s.comment || ''
    ]
    row++
  }
  addTotalRow(storageSheet, row, 9, storageTotal)
  storageSheet.columns.forEach(col => { col.width = 15 })

  // 6. CREDITS SHEET
  const creditsSheet = workbook.addWorksheet('Credits')
  creditsSheet.getRow(1).values = [
    'Merchant Name', 'Reference ID', 'Transaction Date', 'Credit Reason',
    'ShipBob Credit', 'Markup %', 'Billed Credit'
  ]
  styleHeader(creditsSheet, 1)

  row = 2
  let creditsTotal = 0
  for (const c of detailedData.credits) {
    const markupItem = data.lineItems.find(i => i.billingRecordId === c.id)
    const markupPct = markupItem?.markupPercentage || 0
    const billedAmt = markupItem?.billedAmount || c.credit_amount || 0

    creditsTotal += billedAmt

    creditsSheet.getRow(row).values = [
      data.client.company_name,
      c.reference_id || c.id,
      c.transaction_date ? formatExcelDate(c.transaction_date) : '',
      c.credit_reason || '',
      c.credit_amount || 0,
      markupPct,
      billedAmt
    ]
    row++
  }
  addTotalRow(creditsSheet, row, 7, creditsTotal)
  creditsSheet.columns = [{ width: 20 }, { width: 15 }, { width: 15 }, { width: 25 }, { width: 15 }, { width: 10 }, { width: 15 }]

  // Format number columns across all sheets
  const formatCurrencyColumns = (sheet: ExcelJS.Worksheet, cols: number[]) => {
    cols.forEach(colNum => {
      sheet.getColumn(colNum).numFmt = '#,##0.00'
    })
  }

  formatCurrencyColumns(shipmentsSheet, [9, 11])
  formatCurrencyColumns(feesSheet, [4, 6])
  formatCurrencyColumns(returnsSheet, [5, 7])
  formatCurrencyColumns(receivingSheet, [4, 6])
  formatCurrencyColumns(storageSheet, [7, 9])
  formatCurrencyColumns(creditsSheet, [5, 7])

  // Generate buffer
  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

function formatExcelDate(dateStr: string): string {
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return dateStr
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * Store invoice files to Supabase Storage
 */
export async function storeInvoiceFiles(
  invoiceId: string,
  clientId: string,
  invoiceNumber: string,
  xlsBuffer: Buffer,
  pdfBuffer?: Buffer
): Promise<{ xlsPath: string; pdfPath: string | null }> {
  const supabase = createAdminClient()

  const xlsPath = `${clientId}/${invoiceNumber}.xlsx`
  const pdfPath = pdfBuffer ? `${clientId}/${invoiceNumber}.pdf` : null

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

/**
 * Save line items to database
 */
export async function saveLineItems(
  invoiceId: string,
  lineItems: InvoiceLineItem[]
): Promise<void> {
  const supabase = createAdminClient()

  const records = lineItems.map(item => ({
    invoice_id: invoiceId,
    billing_table: item.billingTable,
    billing_record_id: item.billingRecordId,
    base_amount: item.baseAmount,
    markup_applied: item.markupApplied,
    billed_amount: item.billedAmount,
    markup_rule_id: item.markupRuleId,
    markup_percentage: item.markupPercentage,
    line_category: item.lineCategory,
    description: item.description,
    period_label: item.periodLabel || null,
  }))

  // Insert in batches of 1000
  for (let i = 0; i < records.length; i += 1000) {
    const batch = records.slice(i, i + 1000)
    const { error } = await supabase
      .from('invoices_jetpack_line_items')
      .insert(batch)

    if (error) {
      console.error('Error saving line items:', error)
      throw new Error(`Failed to save line items: ${error.message}`)
    }
  }
}

// Helpers

function formatStoragePeriod(start: Date, end: Date): string {
  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }
  return `${start.toLocaleDateString('en-US', options)} - ${end.toLocaleDateString('en-US', options)}`
}

function tableToBillingCategory(table: string): BillingCategory {
  const mapping: Record<string, BillingCategory> = {
    billing_shipments: 'shipments',
    billing_shipment_fees: 'shipment_fees',
    billing_storage: 'storage',
    billing_credits: 'credits',
    billing_returns: 'returns',
    billing_receiving: 'receiving',
  }
  return mapping[table] || 'shipments'
}

/**
 * Collect detailed billing data for XLSX export
 */
export async function collectDetailedBillingData(
  clientId: string,
  periodStart: Date,
  periodEnd: Date
): Promise<DetailedBillingData> {
  const supabase = createAdminClient()
  const startStr = periodStart.toISOString().split('T')[0]
  const endStr = periodEnd.toISOString().split('T')[0]

  // Fetch shipments with all fields
  const { data: shipments } = await supabase
    .from('billing_shipments')
    .select('*')
    .eq('client_id', clientId)
    .gte('transaction_date', startStr)
    .lte('transaction_date', endStr)
    .order('transaction_date', { ascending: true })

  // Fetch shipment fees
  const { data: shipmentFees } = await supabase
    .from('billing_shipment_fees')
    .select('*')
    .eq('client_id', clientId)
    .gte('transaction_date', startStr)
    .lte('transaction_date', endStr)
    .order('transaction_date', { ascending: true })

  // Fetch returns
  const { data: returns } = await supabase
    .from('billing_returns')
    .select('*')
    .eq('client_id', clientId)
    .gte('return_creation_date', startStr)
    .lte('return_creation_date', endStr)
    .order('return_creation_date', { ascending: true })

  // Fetch receiving
  const { data: receiving } = await supabase
    .from('billing_receiving')
    .select('*')
    .eq('client_id', clientId)
    .gte('transaction_date', startStr)
    .lte('transaction_date', endStr)
    .order('transaction_date', { ascending: true })

  // Fetch storage
  const { data: storage } = await supabase
    .from('billing_storage')
    .select('*')
    .eq('client_id', clientId)
    .gte('charge_start_date', startStr)
    .lte('charge_start_date', endStr)
    .order('charge_start_date', { ascending: true })

  // Fetch credits
  const { data: credits } = await supabase
    .from('billing_credits')
    .select('*')
    .eq('client_id', clientId)
    .gte('transaction_date', startStr)
    .lte('transaction_date', endStr)
    .order('transaction_date', { ascending: true })

  return {
    shipments: shipments || [],
    shipmentFees: shipmentFees || [],
    returns: returns || [],
    receiving: receiving || [],
    storage: storage || [],
    credits: credits || [],
  }
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

  // Save line items to database
  await saveLineItems(invoice.id, lineItems)

  return data
}

// Re-export PDF generator for direct use
export { generatePDFInvoice }
