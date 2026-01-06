/**
 * Fix Approved Invoice Files
 *
 * This script regenerates XLSX/PDF files for approved invoices
 * WITHOUT changing any amounts or status. Used to fix the Shipment ID column bug.
 *
 * Usage: npx tsx scripts/fix-approved-invoice-files.ts [invoiceId]
 *
 * If no invoiceId is provided, lists all approved invoices.
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import {
  applyMarkupsToLineItems,
  generateSummary,
  generateExcelInvoice,
  storeInvoiceFiles,
  type InvoiceLineItem,
  type DetailedBillingData,
  type DetailedShipment,
  type DetailedShipmentFee,
  type DetailedReturn,
  type DetailedReceiving,
  type DetailedStorage,
  type DetailedCredit,
  ADDITIONAL_SERVICE_FEES,
  decodeUlidTimestamp,
} from '../lib/billing/invoice-generator'
import { generatePDFViaSubprocess } from '../lib/billing/pdf-subprocess'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface Invoice {
  id: string
  invoice_number: string
  status: string
  client_id: string
  version: number
  generated_at: string
  total_amount: number
  shipbob_invoice_ids: number[]
  period_start: string
  period_end: string
  invoice_date: string
  subtotal: number
  total_markup: number
  due_date: string | null
  client?: {
    id: string
    company_name: string
    short_code: string | null
    billing_email: string | null
    billing_terms: string | null
    merchant_id: string | null
    billing_address: string | null
  }
}

// Collect transactions that are ALREADY linked to a Jetpack invoice
// (different from collectBillingTransactionsByInvoiceIds which filters for unbilled)
// NOTE: invoice_id_jp stores the invoice NUMBER (e.g., JPHS-0039-121525), not the UUID
async function collectTransactionsByJetpackInvoiceNumber(
  invoiceNumber: string
): Promise<InvoiceLineItem[]> {
  const items: InvoiceLineItem[] = []

  // Fetch all transactions linked to this Jetpack invoice by invoice NUMBER
  let offset = 0
  const allTransactions: Array<Record<string, unknown>> = []

  while (true) {
    const { data: batch } = await supabase
      .from('transactions')
      .select('*')
      .eq('invoice_id_jp', invoiceNumber)  // invoice_id_jp stores invoice NUMBER, not UUID
      .order('charge_date', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + 999)

    if (!batch || batch.length === 0) break
    allTransactions.push(...batch)
    if (batch.length < 1000) break
    offset += 1000
  }

  // Convert transactions to InvoiceLineItem format (same as in invoice-generator.ts)
  for (const tx of allTransactions) {
    const feeType = tx.fee_type as string
    const referenceType = tx.reference_type as string
    const referenceId = tx.reference_id as string
    const totalCharge = Number(tx.total_charge) || 0
    const baseCharge = Number(tx.base_cost) || totalCharge
    const surcharge = Number(tx.surcharge) || 0
    const chargeDate = tx.charge_date as string

    // Determine line category
    let lineCategory: string
    if (referenceType === 'Shipment') {
      lineCategory = 'Shipping'
    } else if (referenceType === 'Return') {
      lineCategory = 'Returns'
    } else if (feeType?.includes('Storage')) {
      lineCategory = 'Storage'
    } else if (feeType?.includes('Receiving')) {
      lineCategory = 'Receiving'
    } else if (totalCharge < 0) {
      lineCategory = 'Credits'
    } else {
      lineCategory = 'Other Fees'
    }

    items.push({
      transactionId: tx.transaction_id as string,
      referenceId: referenceId || '',
      referenceType,
      feeType,
      description: feeType,
      baseCharge,
      surcharge,
      totalCharge,
      markupPercent: 0,
      markupAmount: 0,
      finalCharge: totalCharge,
      transactionDate: chargeDate,
      lineCategory,
    })
  }

  return items
}

// Collect detailed billing data for an approved invoice
// Uses invoice_id_jp (invoice number) instead of filtering for unbilled transactions
async function collectDetailedBillingDataByJetpackInvoiceNumber(
  clientId: string,
  invoiceNumber: string
): Promise<DetailedBillingData> {
  // Fetch all transactions linked to this Jetpack invoice by invoice NUMBER
  let offset = 0
  const allTransactions: Array<Record<string, unknown>> = []

  while (true) {
    const { data: batch } = await supabase
      .from('transactions')
      .select('*')
      .eq('invoice_id_jp', invoiceNumber)  // Query by invoice NUMBER
      .order('charge_date', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + 999)

    if (!batch || batch.length === 0) break
    allTransactions.push(...batch)
    if (batch.length < 1000) break
    offset += 1000
  }

  const transactions = allTransactions

  // Build shipment data lookup from shipments table
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

  // Fetch shipment_items for products_sold and total_quantity
  const shipmentItemsMap = new Map<string, Array<{ name: string; quantity: number }>>()
  const shipmentsNeedingQtyFallback: string[] = []

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
      shipmentItemsMap.get(sid)!.push({ name: item.name || '', quantity: qty ?? 0 })
    }
  }

  // Fetch order data for customer names, store info, etc.
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

  // Fallback: Get quantity from order_items for shipments with null quantity
  if (shipmentsNeedingQtyFallback.length > 0) {
    const shipmentToOrderMap = new Map<string, string>()
    for (const [sid, shipment] of shipmentDataMap.entries()) {
      if (shipment.order_id) {
        shipmentToOrderMap.set(sid, String(shipment.order_id))
      }
    }

    const uniqueOrderIds = [...new Set(
      shipmentsNeedingQtyFallback.map(sid => shipmentToOrderMap.get(sid)).filter(Boolean)
    )] as string[]

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

    for (const sid of shipmentsNeedingQtyFallback) {
      const orderId = shipmentToOrderMap.get(sid)
      if (!orderId) continue
      const orderItems = orderItemsMap.get(orderId)
      if (!orderItems || orderItems.length === 0) continue

      const shipmentItems = shipmentItemsMap.get(sid)
      if (shipmentItems) {
        for (const si of shipmentItems) {
          if (si.quantity === 0) {
            const match = orderItems.find(oi => oi.name === si.name)
            if (match) {
              si.quantity = match.quantity
            } else {
              si.quantity = orderItems[0]?.quantity || 1
            }
          }
        }
      }
    }
  }

  // Build returns data lookup
  const returnIds = transactions
    .filter(tx => tx.reference_type === 'Return')
    .map(tx => Number(tx.reference_id))
    .filter(id => id > 0)

  const returnDataMap = new Map<string, Record<string, unknown>>()

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

        const labelGenTimestamp = (shipmentData?.event_labeled || shipmentData?.created_at) as string || null

        const items = shipmentItemsMap.get(shipmentId) || []
        const productsSold = items.length > 0
          ? items.map(i => `${i.name}(${i.quantity})`).join(' ; ')
          : ''
        const totalQuantity = items.reduce((sum, i) => sum + i.quantity, 0) || null

        let transitDays: number | null = (shipmentData?.transit_time_days as number) || null
        if (!transitDays && shipmentData?.event_intransit && shipmentData?.event_delivered) {
          const inTransit = new Date(shipmentData.event_intransit as string)
          const delivered = new Date(shipmentData.event_delivered as string)
          const diffMs = delivered.getTime() - inTransit.getTime()
          transitDays = Math.round((diffMs / (1000 * 60 * 60 * 24)) * 10) / 10
        }

        shipments.push({
          id: tx.id as string,
          order_id: orderData?.shipbob_order_id as string || tx.reference_id as string,
          shipment_id: shipmentId,
          tracking_id: shipmentData?.tracking_id as string || null,
          customer_name: orderData?.customer_name as string || String(details.CustomerName || ''),
          store_integration_name: orderData?.application_name as string || orderData?.channel_name as string || String(details.StoreIntegrationName || ''),
          store_order_id: orderData?.store_order_id as string || String(details.StoreOrderId || ''),
          transaction_type: tx.transaction_type as string,
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
          order_created_timestamp: shipmentData?.event_created as string || null,
          label_generation_timestamp: labelGenTimestamp,
          delivered_date: shipmentData?.event_delivered as string || String(details.DeliveredDate || '') || null,
          transit_time_days: transitDays,
          fc_name: shipmentData?.fc_name as string || tx.fulfillment_center as string,
          order_category: orderData?.order_type as string || String(details.OrderCategory || ''),
        })
      } else if (ADDITIONAL_SERVICE_FEES.includes(transactionFee)) {
        shipmentFees.push({
          id: tx.id as string,
          order_id: tx.reference_id as string,
          fee_type: transactionFee,
          amount: cost,
          transaction_date: decodeUlidTimestamp(tx.transaction_id as string) || tx.charge_date as string,
        })
      } else {
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
      const returnId = String(tx.reference_id)
      const returnData = returnDataMap.get(returnId)
      const returnTimestamp = (returnData?.insert_date || tx.charge_date) as string

      returns.push({
        id: tx.id as string,
        return_id: returnId,
        order_id: returnData?.original_shipment_id ? String(returnData.original_shipment_id) : String(details.OriginalOrderId || ''),
        tracking_id: returnData?.tracking_number as string || tx.tracking_id as string,
        amount: cost,
        transaction_type: transactionFee || tx.transaction_type as string,
        return_status: returnData?.status as string || String(details.ReturnStatus || ''),
        return_type: returnData?.return_type as string || String(details.ReturnType || ''),
        return_creation_date: returnTimestamp,
        fc_name: returnData?.fc_name as string || tx.fulfillment_center as string,
      })
    } else if (referenceType === 'WRO' && transactionFee === 'Inventory Placement Program Fee') {
      shipmentFees.push({
        id: tx.id as string,
        order_id: tx.reference_id as string,
        fee_type: transactionFee,
        amount: cost,
        transaction_date: decodeUlidTimestamp(tx.transaction_id as string) || tx.charge_date as string,
      })
    } else if (referenceType === 'WRO' || transactionFee.includes('Receiving')) {
      receiving.push({
        id: tx.id as string,
        wro_id: tx.reference_id as string,
        fee_type: transactionFee,
        amount: cost,
        transaction_type: tx.transaction_type as string || transactionFee,
        transaction_date: decodeUlidTimestamp(tx.transaction_id as string) || tx.charge_date as string,
      })
    } else if (referenceType === 'TicketNumber' && ADDITIONAL_SERVICE_FEES.includes(transactionFee)) {
      shipmentFees.push({
        id: tx.id as string,
        order_id: tx.reference_id as string,
        fee_type: transactionFee,
        amount: cost,
        transaction_date: decodeUlidTimestamp(tx.transaction_id as string) || tx.charge_date as string,
      })
    } else {
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

async function listApprovedInvoices() {
  const { data, error } = await supabase
    .from('invoices_jetpack')
    .select(`
      id, invoice_number, status, client_id, version, generated_at,
      client:clients(company_name)
    `)
    .in('status', ['approved', 'sent'])
    .order('generated_at', { ascending: false })
    .limit(20)

  if (error) {
    console.error('Error fetching invoices:', error)
    return
  }

  console.log('\n=== APPROVED/SENT INVOICES ===\n')
  data?.forEach((inv: any) => {
    console.log(`  ${inv.invoice_number} (${inv.client?.company_name}) - ${inv.status} v${inv.version}`)
    console.log(`    ID: ${inv.id}`)
    console.log(`    Generated: ${inv.generated_at}`)
    console.log('')
  })

  console.log('To regenerate files for a specific invoice:')
  console.log('  npx tsx scripts/fix-approved-invoice-files.ts <invoiceId>')
  console.log('')
  console.log('NOTE: This will ONLY regenerate files, not change any amounts.')
}

async function regenerateFilesForInvoice(invoiceId: string) {
  console.log(`\n=== Regenerating files for invoice ${invoiceId} ===\n`)

  // Get the invoice
  const { data: invoice, error: invoiceError } = await supabase
    .from('invoices_jetpack')
    .select(`
      *,
      client:clients(id, company_name, short_code, billing_email, billing_terms, merchant_id, billing_address)
    `)
    .eq('id', invoiceId)
    .single()

  if (invoiceError || !invoice) {
    console.error('Invoice not found:', invoiceError)
    return
  }

  const inv = invoice as Invoice
  const client = inv.client!

  console.log(`Invoice: ${inv.invoice_number}`)
  console.log(`Client: ${client.company_name}`)
  console.log(`Status: ${inv.status}`)
  console.log(`Amount: $${inv.total_amount.toLocaleString()}`)
  console.log(`ShipBob Invoice IDs: ${inv.shipbob_invoice_ids?.join(', ')}`)

  if (!['approved', 'sent'].includes(inv.status)) {
    console.log('\nThis invoice is not approved/sent. Use the regular regenerate endpoint instead.')
    return
  }

  const shipbobInvoiceIds = inv.shipbob_invoice_ids || []

  if (shipbobInvoiceIds.length === 0) {
    console.error('No ShipBob invoice IDs found on this invoice')
    return
  }

  console.log(`\nCollecting transactions linked to this Jetpack invoice (${inv.invoice_number})...`)

  // For approved invoices, we query by invoice NUMBER (invoice_id_jp stores number, not UUID)
  let lineItems = await collectTransactionsByJetpackInvoiceNumber(inv.invoice_number)
  console.log(`Found ${lineItems.length} transactions`)

  lineItems = await applyMarkupsToLineItems(client.id, lineItems)
  const summary = generateSummary(lineItems)

  console.log(`Summary: Subtotal=$${summary.subtotal.toFixed(2)}, Markup=$${summary.totalMarkup.toFixed(2)}, Total=$${summary.totalAmount.toFixed(2)}`)

  // Calculate storage period
  const parseDateAsLocal = (dateStr: string): Date => {
    if (dateStr.length === 10 && dateStr.includes('-')) {
      const [year, month, day] = dateStr.split('-').map(Number)
      return new Date(year, month - 1, day)
    }
    return new Date(dateStr)
  }

  const storageDates = lineItems
    .filter(item => item.lineCategory === 'Storage')
    .map(item => parseDateAsLocal(item.transactionDate))

  let storagePeriodStart: Date | undefined
  let storagePeriodEnd: Date | undefined

  if (storageDates.length > 0) {
    const minStorageDate = new Date(Math.min(...storageDates.map(d => d.getTime())))
    const maxStorageDate = new Date(Math.max(...storageDates.map(d => d.getTime())))

    const storageMonth = minStorageDate.getMonth()
    const storageYear = minStorageDate.getFullYear()
    const dayMin = minStorageDate.getDate()
    const dayMax = maxStorageDate.getDate()

    if (dayMin <= 15 && dayMax > 15) {
      storagePeriodStart = new Date(storageYear, storageMonth, 1)
      storagePeriodEnd = new Date(storageYear, storageMonth + 1, 0)
    } else if (dayMax <= 15) {
      storagePeriodStart = new Date(storageYear, storageMonth, 1)
      storagePeriodEnd = new Date(storageYear, storageMonth, 15)
    } else {
      storagePeriodStart = new Date(storageYear, storageMonth, 16)
      storagePeriodEnd = new Date(storageYear, storageMonth + 1, 0)
    }
  }

  const formatLocalDate = (d: Date): string => {
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  // Generate invoice data structure
  const invoiceData = {
    invoice: {
      ...inv,
      subtotal: summary.subtotal,
      total_markup: summary.totalMarkup,
      total_amount: summary.totalAmount,
    },
    client: {
      id: client.id,
      company_name: client.company_name,
      short_code: client.short_code,
      billing_email: client.billing_email,
      billing_terms: client.billing_terms || 'due_on_receipt',
      merchant_id: client.merchant_id || null,
    },
    lineItems,
    summary,
  }

  console.log('\nCollecting detailed data...')
  // Use the custom function that queries by invoice_id_jp instead of filtering for unbilled
  const detailedData = await collectDetailedBillingDataByJetpackInvoiceNumber(client.id, inv.invoice_number)
  console.log(`  Shipments: ${detailedData.shipments.length}`)
  console.log(`  Fees: ${detailedData.shipmentFees.length}`)
  console.log(`  Returns: ${detailedData.returns.length}`)
  console.log(`  Storage: ${detailedData.storage.length}`)
  console.log(`  Receiving: ${detailedData.receiving.length}`)
  console.log(`  Credits: ${detailedData.credits.length}`)

  console.log('\nGenerating Excel file...')
  const xlsBuffer = await generateExcelInvoice(invoiceData, detailedData)
  console.log(`Excel buffer size: ${xlsBuffer.length} bytes`)

  console.log('\nGenerating PDF file...')
  const pdfBuffer = await generatePDFViaSubprocess(invoiceData, {
    storagePeriodStart: storagePeriodStart ? formatLocalDate(storagePeriodStart) : undefined,
    storagePeriodEnd: storagePeriodEnd ? formatLocalDate(storagePeriodEnd) : undefined,
    clientAddress: client.billing_address || undefined,
  })
  console.log(`PDF buffer size: ${pdfBuffer.length} bytes`)

  console.log('\nUploading files to storage...')
  await storeInvoiceFiles(inv.id, client.id, inv.invoice_number, xlsBuffer, pdfBuffer)

  console.log('\n=== SUCCESS ===')
  console.log(`Regenerated files for ${inv.invoice_number}`)
  console.log('The Shipment ID column should now be correct.')
}

async function main() {
  const invoiceId = process.argv[2]

  if (!invoiceId) {
    await listApprovedInvoices()
  } else {
    await regenerateFilesForInvoice(invoiceId)
  }
}

main().catch(console.error)
