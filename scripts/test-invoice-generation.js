#!/usr/bin/env node
/**
 * Test Invoice Generation - Creates XLS matching reference format
 *
 * Generates INVOICE-DETAILS-JPHS-XXXX-XXXXXX.xlsx for Henson Shaving
 * with 6 tabs: Shipments, Additional Services, Returns, Receiving, Storage, Credits
 *
 * Uses transactions table as source of truth with markup rules applied.
 * Uses ship_option_id lookup from shipments table for carrier-specific markup rules.
 */

const { createClient } = require('@supabase/supabase-js')
const ExcelJS = require('exceljs')
const fs = require('fs')
const path = require('path')
require('dotenv').config({ path: '.env.local' })

// ULID alphabet for decoding timestamps
const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/**
 * Decode ULID timestamp to ISO string
 * ULID format: First 10 chars encode 48-bit millisecond timestamp
 */
function decodeUlidTimestamp(ulid) {
  if (!ulid || ulid.length < 10) return null
  const timeChars = ulid.substring(0, 10).toUpperCase()
  let timestamp = 0
  for (const char of timeChars) {
    const idx = ULID_ALPHABET.indexOf(char)
    if (idx === -1) return null
    timestamp = timestamp * 32 + idx
  }
  return new Date(timestamp).toISOString()
}

/**
 * Convert date/timestamp to Excel serial date number
 * Excel dates: days since Dec 30, 1899 (with time as decimal fraction)
 */
function toExcelDate(dateStr) {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return dateStr
  const excelEpoch = new Date(Date.UTC(1899, 11, 30))
  const msPerDay = 24 * 60 * 60 * 1000
  return (date.getTime() - excelEpoch.getTime()) / msPerDay
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Invoice period: JPHS-0037 (Nov 24 - Nov 30, 2025)
// Use invoice_id_sb values instead of date range to avoid timezone issues
const INVOICE_IDS = [8633612, 8633618, 8633632, 8633634, 8633637, 8633641]
const PERIOD_LABEL = 'Nov 24 - Nov 30, 2025'

// Reference values from JPHS-0037 - VERIFIED row counts (excluding header and Total row)
// See CLAUDE.billingtesting.md for validation details
const REFERENCE = {
  shipments: { count: 1435, total: 9715.24 },
  additionalServices: { count: 1112, total: 765.95 },
  returns: { count: 3, total: 14.79 },
  receiving: { count: 1, total: 35.00 },
  storage: { count: 981, total: 997.94 },
  credits: { count: 11, total: -686.12 },
}
const REF_GRAND_TOTAL = REFERENCE.shipments.total + REFERENCE.additionalServices.total +
  REFERENCE.returns.total + REFERENCE.receiving.total +
  REFERENCE.storage.total + REFERENCE.credits.total

// Fee type to billing category mapping
const FEE_TYPE_TO_CATEGORY = {
  'Shipping': 'shipments',
  'Per Pick Fee': 'shipment_fees',
  'Address Correction': 'shipment_fees',
  'Kitting Fee': 'shipment_fees',
  'Inventory Placement Program Fee': 'shipment_fees',
  'URO Storage Fee': 'shipment_fees',
  'VAS - Paid Requests': 'shipment_fees',
  'B2B - Case Pick Fee': 'shipment_fees',
  'B2B - Each Pick Fee': 'shipment_fees',
  'B2B - Label Fee': 'shipment_fees',
  'B2B - Order Fee': 'shipment_fees',
  'B2B - Pallet Material Charge': 'shipment_fees',
  'B2B - Pallet Pack Fee': 'shipment_fees',
  'B2B - ShipBob Freight Fee': 'shipment_fees',
  'B2B - Supplies': 'shipment_fees',
  'Credit': 'credits',
  'Return Processed by Operations Fee': 'returns',
  'Return to sender - Processing Fees': 'returns',
  'Return Label': 'returns',
  'Charge': 'receiving',
}

// Fetch all transactions for a client by invoice IDs
async function fetchTransactionsByInvoiceIds(clientId, invoiceIds) {
  const allData = []

  for (const invoiceId of invoiceIds) {
    let offset = 0
    const limit = 1000

    while (true) {
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('client_id', clientId)
        .eq('invoice_id_sb', invoiceId)
        .order('charge_date', { ascending: true })
        .range(offset, offset + limit - 1)

      if (error) throw new Error(`Failed to fetch transactions: ${error.message}`)
      if (!data || data.length === 0) break

      allData.push(...data)
      if (data.length < limit) break
      offset += limit
    }

    process.stdout.write(`\r  Invoice ${invoiceId}: ${allData.length} total...`)
  }

  console.log(`\r  Fetched ${allData.length} transactions from ${invoiceIds.length} invoices`)
  return allData
}

// Fetch full shipment and order data for filling empty columns
// Returns Map of shipment_id -> { shipment data + order data }
async function fetchShipmentData(shipmentIds) {
  const dataMap = new Map()
  if (shipmentIds.length === 0) return dataMap

  // Fetch shipment data in batches
  const shipmentDataMap = new Map()
  for (let i = 0; i < shipmentIds.length; i += 500) {
    const batch = shipmentIds.slice(i, i + 500)
    const { data: shipments, error } = await supabase
      .from('shipments')
      .select(`
        shipment_id, ship_option_id, order_id, carrier, carrier_service,
        zone_used, actual_weight_oz, dim_weight_oz, billable_weight_oz,
        length, width, height, fc_name, event_labeled, delivered_date
      `)
      .in('shipment_id', batch)

    if (error) {
      console.error('Error fetching shipment data:', error.message)
      continue
    }

    for (const s of shipments || []) {
      shipmentDataMap.set(String(s.shipment_id), s)
    }
  }

  // Collect unique order IDs
  const orderIds = [...new Set([...shipmentDataMap.values()].map(s => s.order_id).filter(Boolean))]

  // Fetch order data in batches
  const orderDataMap = new Map()
  for (let i = 0; i < orderIds.length; i += 500) {
    const batch = orderIds.slice(i, i + 500)
    const { data: orders, error } = await supabase
      .from('orders')
      .select(`
        id, customer_name, channel_name, application_name,
        store_order_id, zip_code, city, state, country, order_import_date, order_type
      `)
      .in('id', batch)

    if (error) {
      console.error('Error fetching order data:', error.message)
      continue
    }

    for (const o of orders || []) {
      orderDataMap.set(String(o.id), o)
    }
  }

  // Merge shipment and order data
  for (const [shipmentId, shipment] of shipmentDataMap) {
    const order = shipment.order_id ? orderDataMap.get(String(shipment.order_id)) : null
    dataMap.set(shipmentId, {
      ...shipment,
      customer_name: order?.customer_name || '',
      store_integration: order?.application_name || order?.channel_name || '',
      store_order_id: order?.store_order_id || '',
      zip_code: order?.zip_code || '',
      city: order?.city || '',
      state: order?.state || '',
      country: order?.country || '',
      order_insert_timestamp: order?.order_import_date || '',
      order_category: order?.order_type || '',
    })
  }

  return dataMap
}

// Fetch return data for filling empty columns
// Returns Map of return_id -> { return data }
async function fetchReturnsData(returnIds) {
  const dataMap = new Map()
  if (returnIds.length === 0) return dataMap

  // Fetch returns data in batches
  for (let i = 0; i < returnIds.length; i += 500) {
    const batch = returnIds.slice(i, i + 500)
    const { data: returns, error } = await supabase
      .from('returns')
      .select(`
        shipbob_return_id, reference_id, status, return_type,
        tracking_number, original_shipment_id, store_order_id,
        customer_name, fc_name, insert_date, arrived_date,
        completed_date, cancelled_date
      `)
      .in('shipbob_return_id', batch)

    if (error) {
      console.error('Error fetching returns data:', error.message)
      continue
    }

    for (const r of returns || []) {
      dataMap.set(String(r.shipbob_return_id), r)
    }
  }

  return dataMap
}

// Find best matching markup rule (most conditions wins)
// CRITICAL: Must check ship_option_id filter, not just count it!
function findMatchingRule(rules, context) {
  const matching = rules.filter(rule => {
    // Client match: global (null) or specific client
    if (rule.client_id !== null && rule.client_id !== context.clientId) return false

    // Billing category must match
    if (rule.billing_category && rule.billing_category !== context.billingCategory) return false

    // Fee type match (if specified)
    if (rule.fee_type && rule.fee_type !== context.feeType) return false

    // Order category match (if specified)
    if (rule.order_category !== null && rule.order_category !== context.orderCategory) return false

    // ship_option_id match (if specified) - CRITICAL: must FILTER not just count!
    if (rule.ship_option_id && rule.ship_option_id !== context.shipOptionId) return false

    return true
  })

  if (matching.length === 0) return null

  // Sort by condition count (most conditions wins)
  matching.sort((a, b) => {
    const countA = (a.client_id ? 1 : 0) + (a.fee_type ? 1 : 0) + (a.order_category !== null ? 1 : 0) + (a.ship_option_id ? 1 : 0)
    const countB = (b.client_id ? 1 : 0) + (b.fee_type ? 1 : 0) + (b.order_category !== null ? 1 : 0) + (b.ship_option_id ? 1 : 0)
    return countB - countA
  })

  return matching[0]
}

// Apply markup to base cost
function applyMarkup(baseCost, rule) {
  if (!rule || baseCost === 0) return { charge: baseCost, markupPercent: 0 }

  let markup = 0
  if (rule.markup_type === 'percentage') {
    markup = baseCost * (rule.markup_value / 100)
  } else {
    markup = rule.markup_value
  }

  return {
    charge: Math.round((baseCost + markup) * 100) / 100,
    markupPercent: rule.markup_type === 'percentage' ? rule.markup_value : null,
    markupAmount: rule.markup_type === 'fixed' ? rule.markup_value : null,
    ruleName: rule.name
  }
}

async function main() {
  console.log('='.repeat(70))
  console.log('TEST INVOICE GENERATION')
  console.log(`Period: ${PERIOD_LABEL}`)
  console.log(`Invoice IDs: ${INVOICE_IDS.join(', ')}`)
  console.log('='.repeat(70))

  // Get Henson client
  const { data: client, error: clientError } = await supabase
    .from('clients')
    .select('id, company_name, merchant_id, short_code')
    .ilike('company_name', '%henson%')
    .single()

  if (clientError) throw new Error(`Failed to get client: ${clientError.message}`)
  console.log(`\nClient: ${client.company_name} (${client.short_code})`)

  // Get markup rules
  const { data: rules, error: rulesError } = await supabase
    .from('markup_rules')
    .select('*')
    .or(`client_id.is.null,client_id.eq.${client.id}`)
    .eq('is_active', true)
    .order('priority', { ascending: false })

  if (rulesError) throw new Error(`Failed to get markup rules: ${rulesError.message}`)
  console.log(`\nMarkup Rules: ${rules.length}`)
  for (const r of rules) {
    console.log(`  - ${r.name}: ${r.billing_category}/${r.fee_type || 'any'} = ${r.markup_type === 'percentage' ? r.markup_value + '%' : '$' + r.markup_value}`)
  }

  // Fetch all transactions by invoice IDs
  console.log('\nFetching transactions by invoice IDs...')
  const allTx = await fetchTransactionsByInvoiceIds(client.id, INVOICE_IDS)

  // Group transactions by type
  const shipments = []
  const additionalServices = []
  const returns = []
  const receiving = []
  const storage = []
  const credits = []

  for (const tx of allTx) {
    const feeType = tx.transaction_fee
    const category = FEE_TYPE_TO_CATEGORY[feeType]

    if (feeType === 'Shipping') {
      shipments.push(tx)
    } else if (category === 'shipment_fees') {
      additionalServices.push(tx)
    } else if (category === 'returns' || tx.reference_type === 'Return') {
      returns.push(tx)
    } else if (category === 'receiving' || tx.reference_type === 'WRO') {
      receiving.push(tx)
    } else if (tx.reference_type === 'FC' || feeType === 'Warehousing Fee' || feeType?.includes('Storage')) {
      storage.push(tx)
    } else if (category === 'credits' || tx.reference_type === 'Default') {
      credits.push(tx)
    } else {
      // Unmapped - put in additional services
      additionalServices.push(tx)
    }
  }

  console.log(`\nGrouped transactions:`)
  console.log(`  Shipments: ${shipments.length}`)
  console.log(`  Additional Services: ${additionalServices.length}`)
  console.log(`  Returns: ${returns.length}`)
  console.log(`  Receiving: ${receiving.length}`)
  console.log(`  Storage: ${storage.length}`)
  console.log(`  Credits: ${credits.length}`)

  // Fetch full shipment + order data from shipments/orders tables
  // CRITICAL: Many fields are NOT in additional_details - must join with shipments/orders tables!
  console.log('\nFetching shipment and order data from database...')
  const shipmentIds = shipments
    .map(tx => Number(tx.reference_id))
    .filter(id => id > 0)
  const shipmentDataMap = await fetchShipmentData(shipmentIds)
  console.log(`  Found data for ${shipmentDataMap.size} of ${shipmentIds.length} shipments`)

  // Count rules that will be applied (based on ship_option_id)
  const ship146Count = Array.from(shipmentDataMap.values()).filter(s => s.ship_option_id === 146).length
  console.log(`  Ship option 146 (USPS Priority, 18%): ${ship146Count} shipments`)
  console.log(`  Other ship options (14%): ${shipments.length - ship146Count} shipments`)

  // Fetch returns data from returns table
  console.log('\nFetching returns data from database...')
  const returnIds = returns
    .map(tx => Number(tx.reference_id))
    .filter(id => id > 0)
  const returnsDataMap = await fetchReturnsData(returnIds)
  console.log(`  Found data for ${returnsDataMap.size} of ${returnIds.length} returns`)

  // Create workbook
  const workbook = new ExcelJS.Workbook()

  // === SHIPMENTS SHEET ===
  console.log('\nBuilding Shipments sheet...')
  const shipmentsSheet = workbook.addWorksheet('Shipments')

  shipmentsSheet.columns = [
    { header: 'User ID', key: 'user_id', width: 12 },
    { header: 'Merchant Name', key: 'merchant_name', width: 20 },
    { header: 'Customer Name', key: 'customer_name', width: 25 },
    { header: 'StoreIntegrationName', key: 'store_integration', width: 20 },
    { header: 'OrderID', key: 'order_id', width: 12 },
    { header: 'Transaction Type', key: 'transaction_type', width: 15 },
    { header: 'Transaction Date', key: 'transaction_date', width: 15 },
    { header: 'Store OrderID', key: 'store_order_id', width: 20 },
    { header: 'TrackingId', key: 'tracking_id', width: 25 },
    { header: 'Fulfillment without Surcharge', key: 'base_charge', width: 25 },
    { header: 'Surcharge Applied', key: 'surcharge', width: 18 },
    { header: 'Original Invoice', key: 'total_charge', width: 15 },
    { header: 'Insurance Amount', key: 'insurance', width: 15 },
    { header: 'Products Sold', key: 'products', width: 30 },
    { header: 'Total Quantity', key: 'quantity', width: 12 },
    { header: 'Ship Option ID', key: 'ship_option_id', width: 12 },
    { header: 'Carrier', key: 'carrier', width: 15 },
    { header: 'Carrier Service', key: 'carrier_service', width: 20 },
    { header: 'Zone Used', key: 'zone', width: 10 },
    { header: 'Actual Weight (Oz)', key: 'actual_weight', width: 15 },
    { header: 'Dim Weight(Oz)', key: 'dim_weight', width: 12 },
    { header: 'Billable Weight(Oz)', key: 'billable_weight', width: 15 },
    { header: 'Length', key: 'length', width: 8 },
    { header: 'Width', key: 'width', width: 8 },
    { header: 'Height', key: 'height', width: 8 },
    { header: 'Zip Code', key: 'zip', width: 10 },
    { header: 'City', key: 'city', width: 15 },
    { header: 'State', key: 'state', width: 8 },
    { header: 'Destination Country', key: 'country', width: 15 },
    { header: 'Order Insert Timestamp', key: 'order_timestamp', width: 20 },
    { header: 'Label Generation Timestamp', key: 'label_timestamp', width: 22 },
    { header: 'Delivered Date', key: 'delivered_date', width: 15 },
    { header: 'Transit Time (Days)', key: 'transit_days', width: 15 },
    { header: 'FC Name', key: 'fc_name', width: 15 },
    { header: 'Order Category', key: 'order_category', width: 15 },
  ]

  let shipmentTotals = { base: 0, surcharge: 0, total: 0, insurance: 0 }

  // Pre-process shipments with joined data and sort by label timestamp descending (newest first)
  const shipmentsWithData = shipments.map(tx => {
    const details = tx.additional_details || {}
    const shipData = shipmentDataMap.get(String(tx.reference_id)) || {}

    // Use joined data from shipments/orders table, fall back to additional_details
    const labelTimestamp = shipData.event_labeled || details.shipped_at || tx.charge_date

    return {
      tx,
      details,
      shipData,
      labelTimestamp,
      excelLabelDate: toExcelDate(labelTimestamp),
      excelOrderDate: toExcelDate(shipData.order_insert_timestamp || details.order_created_at),
      excelDeliveredDate: toExcelDate(shipData.delivered_date || details.delivered_at),
    }
  }).sort((a, b) => {
    // Sort by label timestamp descending (newest first)
    const dateA = a.labelTimestamp ? new Date(a.labelTimestamp).getTime() : 0
    const dateB = b.labelTimestamp ? new Date(b.labelTimestamp).getTime() : 0
    return dateB - dateA
  })

  for (const { tx, details, shipData, excelLabelDate, excelOrderDate, excelDeliveredDate } of shipmentsWithData) {
    const orderCategory = shipData.order_category || details.order_category || null
    const feeType = orderCategory || 'Standard'

    // Look up ship_option_id from the joined data
    const shipOptionId = shipData.ship_option_id ? String(shipData.ship_option_id) : null

    // Find markup rule - MUST pass shipOptionId for carrier-specific rules
    const rule = findMatchingRule(rules, {
      clientId: client.id,
      billingCategory: 'shipments',
      feeType: feeType,
      orderCategory: orderCategory,
      shipOptionId: shipOptionId
    })

    // Calculate marked-up amounts
    const baseCost = tx.base_cost || tx.cost || 0
    const surcharge = tx.surcharge || 0
    const insuranceCost = tx.insurance_cost || 0

    const { charge: baseCharge } = applyMarkup(baseCost, rule)
    const totalCharge = Math.round((baseCharge + surcharge) * 100) / 100

    // Insurance markup
    const insuranceRule = findMatchingRule(rules, {
      clientId: client.id,
      billingCategory: 'insurance',
      feeType: 'Shipment Insurance'
    })
    const { charge: insuranceCharge } = applyMarkup(insuranceCost, insuranceRule)

    shipmentTotals.base += baseCharge
    shipmentTotals.surcharge += surcharge
    shipmentTotals.total += totalCharge
    shipmentTotals.insurance += insuranceCharge

    // Calculate transit time if we have both dates
    let transitDays = ''
    if (shipData.delivered_date && shipData.event_labeled) {
      const labelDate = new Date(shipData.event_labeled)
      const deliveredDate = new Date(shipData.delivered_date)
      if (!isNaN(labelDate.getTime()) && !isNaN(deliveredDate.getTime())) {
        transitDays = Math.round((deliveredDate.getTime() - labelDate.getTime()) / (1000 * 60 * 60 * 24))
      }
    }

    shipmentsSheet.addRow({
      user_id: client.merchant_id,
      merchant_name: client.company_name,
      // Use joined order data, fall back to additional_details
      customer_name: shipData.customer_name || details.recipient_name || '',
      store_integration: shipData.store_integration || details.channel || '',
      order_id: tx.reference_id || '',
      transaction_type: tx.transaction_fee || 'Shipping',
      transaction_date: excelLabelDate,  // Use label timestamp as transaction date
      store_order_id: shipData.store_order_id || details.store_order_id || '',
      tracking_id: details.TrackingId || tx.tracking_id || '',
      base_charge: baseCharge,
      surcharge: surcharge,
      total_charge: totalCharge,
      insurance: insuranceCharge,
      products: details.products || '',
      quantity: details.quantity || '',
      // Use joined shipment data
      ship_option_id: shipData.ship_option_id || details.ship_option_id || '',
      carrier: shipData.carrier || details.carrier || '',
      carrier_service: shipData.carrier_service || details.carrier_service || '',
      zone: shipData.zone_used || details.zone || '',
      actual_weight: shipData.actual_weight_oz || details.actual_weight_oz || '',
      dim_weight: shipData.dim_weight_oz || details.dim_weight_oz || '',
      billable_weight: shipData.billable_weight_oz || details.billable_weight_oz || '',
      length: shipData.length || details.length || '',
      width: shipData.width || details.width || '',
      height: shipData.height || details.height || '',
      zip: shipData.zip_code || details.zip_code || '',
      city: shipData.city || details.city || '',
      state: shipData.state || details.state || '',
      country: shipData.country || details.country || 'US',
      order_timestamp: excelOrderDate,
      label_timestamp: excelLabelDate,
      delivered_date: excelDeliveredDate,
      transit_days: transitDays,
      fc_name: shipData.fc_name || tx.fulfillment_center || '',
      order_category: shipData.order_category || orderCategory || '',
    })
  }

  console.log(`  Shipments: ${shipments.length} rows, Base $${shipmentTotals.base.toFixed(2)}, Surcharge $${shipmentTotals.surcharge.toFixed(2)}, Total $${shipmentTotals.total.toFixed(2)}`)

  // === ADDITIONAL SERVICES SHEET ===
  console.log('Building Additional Services sheet...')
  const addServSheet = workbook.addWorksheet('Additional Services')

  addServSheet.columns = [
    { header: 'User ID', key: 'user_id', width: 12 },
    { header: 'Merchant Name', key: 'merchant_name', width: 20 },
    { header: 'Reference ID', key: 'reference_id', width: 15 },
    { header: 'Fee Type', key: 'fee_type', width: 25 },
    { header: 'Invoice Amount', key: 'amount', width: 15 },
    { header: 'Transaction Date', key: 'transaction_date', width: 15 },
  ]

  // Pre-compute timestamps and sort by date descending (newest first)
  const addServWithTimestamps = additionalServices.map(tx => {
    const fullTimestamp = decodeUlidTimestamp(tx.transaction_id) || tx.charge_date
    return { tx, timestamp: fullTimestamp, excelDate: toExcelDate(fullTimestamp) }
  }).sort((a, b) => {
    const dateA = a.timestamp ? new Date(a.timestamp).getTime() : 0
    const dateB = b.timestamp ? new Date(b.timestamp).getTime() : 0
    return dateB - dateA // descending
  })

  let addServTotal = 0
  for (const { tx, excelDate } of addServWithTimestamps) {
    const rule = findMatchingRule(rules, {
      clientId: client.id,
      billingCategory: 'shipment_fees',
      feeType: tx.transaction_fee
    })

    const { charge } = applyMarkup(tx.cost || 0, rule)
    addServTotal += charge

    addServSheet.addRow({
      user_id: client.merchant_id,
      merchant_name: client.company_name,
      reference_id: tx.reference_id || '',
      fee_type: tx.transaction_fee || '',
      amount: charge,
      transaction_date: excelDate,
    })
  }

  console.log(`  Additional Services: ${additionalServices.length} rows, $${addServTotal.toFixed(2)}`)

  // === RETURNS SHEET ===
  console.log('Building Returns sheet...')
  const returnsSheet = workbook.addWorksheet('Returns')

  returnsSheet.columns = [
    { header: 'User ID', key: 'user_id', width: 12 },
    { header: 'Merchant Name', key: 'merchant_name', width: 20 },
    { header: 'Return ID', key: 'return_id', width: 12 },
    { header: 'Original Order ID', key: 'order_id', width: 15 },
    { header: 'Tracking ID', key: 'tracking_id', width: 25 },
    { header: 'Invoice', key: 'amount', width: 12 },
    { header: 'Transaction Type', key: 'transaction_type', width: 20 },
    { header: 'Return Status', key: 'status', width: 15 },
    { header: 'Return Type', key: 'type', width: 15 },
    { header: 'Return Creation Date', key: 'created_date', width: 18 },
    { header: 'FC Name', key: 'fc_name', width: 15 },
  ]

  // Pre-process returns with joined data and sort by insert_date descending
  const returnsWithData = returns.map(tx => {
    const details = tx.additional_details || {}
    const returnData = returnsDataMap.get(String(tx.reference_id)) || {}

    // Use insert_date from returns table (has full timestamp), fall back to charge_date
    const createdTimestamp = returnData.insert_date || tx.charge_date

    return {
      tx,
      details,
      returnData,
      createdTimestamp,
      excelCreatedDate: toExcelDate(createdTimestamp),
    }
  }).sort((a, b) => {
    // Sort by created timestamp descending (newest first)
    const dateA = a.createdTimestamp ? new Date(a.createdTimestamp).getTime() : 0
    const dateB = b.createdTimestamp ? new Date(b.createdTimestamp).getTime() : 0
    return dateB - dateA
  })

  let returnsTotal = 0
  for (const { tx, details, returnData, excelCreatedDate } of returnsWithData) {
    const rule = findMatchingRule(rules, {
      clientId: client.id,
      billingCategory: 'returns',
      feeType: tx.transaction_fee
    })

    const { charge } = applyMarkup(tx.cost || 0, rule)
    returnsTotal += charge

    returnsSheet.addRow({
      user_id: client.merchant_id,
      merchant_name: client.company_name,
      return_id: tx.reference_id || '',
      // Use joined returns data, fall back to additional_details
      order_id: returnData.original_shipment_id || details.order_id || '',
      tracking_id: returnData.tracking_number || details.TrackingId || tx.tracking_id || '',
      amount: charge,
      transaction_type: tx.transaction_fee || '',
      status: returnData.status || details.status || '',
      type: returnData.return_type || details.return_type || '',
      created_date: excelCreatedDate,
      fc_name: returnData.fc_name || tx.fulfillment_center || '',
    })
  }

  console.log(`  Returns: ${returns.length} rows, $${returnsTotal.toFixed(2)}`)

  // === RECEIVING SHEET ===
  console.log('Building Receiving sheet...')
  const receivingSheet = workbook.addWorksheet('Receiving')

  receivingSheet.columns = [
    { header: 'User ID', key: 'user_id', width: 12 },
    { header: 'Merchant Name', key: 'merchant_name', width: 20 },
    { header: 'Reference ID', key: 'reference_id', width: 15 },
    { header: 'Fee Type', key: 'fee_type', width: 20 },
    { header: 'Invoice Amount', key: 'amount', width: 15 },
    { header: 'Transaction Type', key: 'transaction_type', width: 18 },
    { header: 'Transaction Date', key: 'transaction_date', width: 15 },
  ]

  // Pre-process receiving with ULID timestamps and sort descending
  const receivingWithTimestamps = receiving.map(tx => {
    const fullTimestamp = decodeUlidTimestamp(tx.transaction_id) || tx.charge_date
    return { tx, timestamp: fullTimestamp, excelDate: toExcelDate(fullTimestamp) }
  }).sort((a, b) => {
    const dateA = a.timestamp ? new Date(a.timestamp).getTime() : 0
    const dateB = b.timestamp ? new Date(b.timestamp).getTime() : 0
    return dateB - dateA // descending
  })

  let receivingTotal = 0
  for (const { tx, excelDate } of receivingWithTimestamps) {
    const rule = findMatchingRule(rules, {
      clientId: client.id,
      billingCategory: 'receiving',
      feeType: tx.transaction_fee
    })

    const { charge } = applyMarkup(tx.cost || 0, rule)
    receivingTotal += charge

    receivingSheet.addRow({
      user_id: client.merchant_id,
      merchant_name: client.company_name,
      reference_id: tx.reference_id || '',
      fee_type: tx.transaction_fee || '',
      amount: charge,
      transaction_type: tx.transaction_fee || '',
      transaction_date: excelDate,
    })
  }

  console.log(`  Receiving: ${receiving.length} rows, $${receivingTotal.toFixed(2)}`)

  // === STORAGE SHEET ===
  console.log('Building Storage sheet...')
  const storageSheet = workbook.addWorksheet('Storage')

  storageSheet.columns = [
    { header: 'Merchant Name', key: 'merchant_name', width: 20 },
    { header: 'ChargeStartdate', key: 'charge_date', width: 15 },
    { header: 'FC Name', key: 'fc_name', width: 15 },
    { header: 'Inventory ID', key: 'inventory_id', width: 12 },
    { header: 'Location Type', key: 'location_type', width: 15 },
    { header: 'Comment', key: 'comment', width: 30 },
    { header: 'Invoice', key: 'amount', width: 12 },
  ]

  // Pre-process storage and sort by charge_date descending
  const storageWithDates = storage.map(tx => {
    const chargeDate = tx.charge_date || ''
    return { tx, chargeDate, excelDate: toExcelDate(chargeDate) }
  }).sort((a, b) => {
    const dateA = a.chargeDate ? new Date(a.chargeDate).getTime() : 0
    const dateB = b.chargeDate ? new Date(b.chargeDate).getTime() : 0
    return dateB - dateA // descending
  })

  let storageTotal = 0
  for (const { tx, excelDate } of storageWithDates) {
    const rule = findMatchingRule(rules, {
      clientId: client.id,
      billingCategory: 'storage',
      feeType: tx.transaction_fee
    })

    const { charge } = applyMarkup(tx.cost || 0, rule)
    storageTotal += charge

    const details = tx.additional_details || {}
    storageSheet.addRow({
      merchant_name: client.company_name,
      charge_date: excelDate,
      fc_name: tx.fulfillment_center || '',
      inventory_id: details.inventory_id || tx.reference_id || '',
      location_type: details.location_type || tx.transaction_fee || '',
      comment: details.Comment || '',
      amount: charge,
    })
  }

  console.log(`  Storage: ${storage.length} rows, $${storageTotal.toFixed(2)}`)

  // === CREDITS SHEET ===
  console.log('Building Credits sheet...')
  const creditsSheet = workbook.addWorksheet('Credits')

  creditsSheet.columns = [
    { header: 'User ID', key: 'user_id', width: 12 },
    { header: 'Merchant Name', key: 'merchant_name', width: 20 },
    { header: 'Reference ID', key: 'reference_id', width: 15 },
    { header: 'Transaction Date', key: 'transaction_date', width: 15 },
    { header: 'Credit Reason', key: 'reason', width: 25 },
    { header: 'Credit Amount', key: 'amount', width: 15 },
  ]

  // Pre-process credits with ULID timestamps and sort descending
  const creditsWithTimestamps = credits.map(tx => {
    const fullTimestamp = decodeUlidTimestamp(tx.transaction_id) || tx.charge_date
    return { tx, timestamp: fullTimestamp, excelDate: toExcelDate(fullTimestamp) }
  }).sort((a, b) => {
    const dateA = a.timestamp ? new Date(a.timestamp).getTime() : 0
    const dateB = b.timestamp ? new Date(b.timestamp).getTime() : 0
    return dateB - dateA // descending
  })

  let creditsTotal = 0
  for (const { tx, excelDate } of creditsWithTimestamps) {
    // Credits are typically not marked up, but check for rule
    const rule = findMatchingRule(rules, {
      clientId: client.id,
      billingCategory: 'credits',
      feeType: tx.transaction_fee
    })

    // Credits are negative amounts
    const cost = tx.cost || 0
    const { charge } = rule ? applyMarkup(Math.abs(cost), rule) : { charge: Math.abs(cost) }
    const creditAmount = cost < 0 ? -charge : (cost > 0 ? charge : -charge) // Credits should be negative
    creditsTotal += creditAmount

    const details = tx.additional_details || {}

    creditsSheet.addRow({
      user_id: client.merchant_id,
      merchant_name: client.company_name,
      reference_id: tx.reference_id || '',
      transaction_date: excelDate,
      reason: details.Comment || tx.transaction_fee || '',
      amount: creditAmount,
    })
  }

  console.log(`  Credits: ${credits.length} rows, $${creditsTotal.toFixed(2)}`)

  // Apply Excel formatting to all sheets
  console.log('\nApplying Excel formatting...')
  const currencyFormat = '#,##0.00'
  const dateTimeFormat = 'yyyy-mm-dd hh:mm:ss'

  // Shipments formatting
  shipmentsSheet.getColumn('transaction_date').numFmt = dateTimeFormat
  shipmentsSheet.getColumn('base_charge').numFmt = currencyFormat
  shipmentsSheet.getColumn('surcharge').numFmt = currencyFormat
  shipmentsSheet.getColumn('total_charge').numFmt = currencyFormat
  shipmentsSheet.getColumn('insurance').numFmt = currencyFormat
  shipmentsSheet.getColumn('order_timestamp').numFmt = dateTimeFormat
  shipmentsSheet.getColumn('label_timestamp').numFmt = dateTimeFormat
  shipmentsSheet.getColumn('delivered_date').numFmt = dateTimeFormat

  // Additional Services formatting
  addServSheet.getColumn('transaction_date').numFmt = dateTimeFormat
  addServSheet.getColumn('amount').numFmt = currencyFormat

  // Returns formatting
  returnsSheet.getColumn('created_date').numFmt = dateTimeFormat
  returnsSheet.getColumn('amount').numFmt = currencyFormat

  // Receiving formatting
  receivingSheet.getColumn('transaction_date').numFmt = dateTimeFormat
  receivingSheet.getColumn('amount').numFmt = currencyFormat

  // Storage formatting
  storageSheet.getColumn('charge_date').numFmt = dateTimeFormat
  storageSheet.getColumn('amount').numFmt = currencyFormat

  // Credits formatting
  creditsSheet.getColumn('transaction_date').numFmt = dateTimeFormat
  creditsSheet.getColumn('amount').numFmt = currencyFormat

  // Write file
  const outputDir = path.join(__dirname, 'output')
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  const outputPath = path.join(outputDir, 'INVOICE-DETAILS-JPHS-0037-TEST.xlsx')
  await workbook.xlsx.writeFile(outputPath)

  // Summary
  console.log('\n' + '='.repeat(70))
  console.log('SUMMARY')
  console.log('='.repeat(70))
  console.log(`Output: ${outputPath}`)

  // Compare with reference values (from CLAUDE.billingtesting.md)
  console.log('\nRow counts (Generated vs Reference):')
  const countMatch = (gen, ref) => gen === ref ? '✓' : `⚠️  diff: ${gen - ref}`
  console.log(`  Shipments: ${shipments.length} (ref: ${REFERENCE.shipments.count}) ${countMatch(shipments.length, REFERENCE.shipments.count)}`)
  console.log(`  Additional Services: ${additionalServices.length} (ref: ${REFERENCE.additionalServices.count}) ${countMatch(additionalServices.length, REFERENCE.additionalServices.count)}`)
  console.log(`  Returns: ${returns.length} (ref: ${REFERENCE.returns.count}) ${countMatch(returns.length, REFERENCE.returns.count)}`)
  console.log(`  Receiving: ${receiving.length} (ref: ${REFERENCE.receiving.count}) ${countMatch(receiving.length, REFERENCE.receiving.count)}`)
  console.log(`  Storage: ${storage.length} (ref: ${REFERENCE.storage.count}) ${countMatch(storage.length, REFERENCE.storage.count)}`)
  console.log(`  Credits: ${credits.length} (ref: ${REFERENCE.credits.count}) ${countMatch(credits.length, REFERENCE.credits.count)}`)

  console.log('\nTotals (Generated vs Reference):')
  const totalMatch = (gen, ref) => {
    const diff = gen - ref
    if (Math.abs(diff) < 1) return `✓ (diff: $${diff.toFixed(2)})`
    return `⚠️  diff: $${diff.toFixed(2)}`
  }
  console.log(`  Shipments: $${shipmentTotals.total.toFixed(2)} (ref: $${REFERENCE.shipments.total.toFixed(2)}) ${totalMatch(shipmentTotals.total, REFERENCE.shipments.total)}`)
  console.log(`  Additional Services: $${addServTotal.toFixed(2)} (ref: $${REFERENCE.additionalServices.total.toFixed(2)}) ${totalMatch(addServTotal, REFERENCE.additionalServices.total)}`)
  console.log(`  Returns: $${returnsTotal.toFixed(2)} (ref: $${REFERENCE.returns.total.toFixed(2)}) ${totalMatch(returnsTotal, REFERENCE.returns.total)}`)
  console.log(`  Receiving: $${receivingTotal.toFixed(2)} (ref: $${REFERENCE.receiving.total.toFixed(2)}) ${totalMatch(receivingTotal, REFERENCE.receiving.total)}`)
  console.log(`  Storage: $${storageTotal.toFixed(2)} (ref: $${REFERENCE.storage.total.toFixed(2)}) ${totalMatch(storageTotal, REFERENCE.storage.total)}`)
  console.log(`  Credits: $${creditsTotal.toFixed(2)} (ref: $${REFERENCE.credits.total.toFixed(2)}) ${totalMatch(creditsTotal, REFERENCE.credits.total)}`)

  const grandTotal = shipmentTotals.total + shipmentTotals.insurance + addServTotal + returnsTotal + receivingTotal + storageTotal + creditsTotal
  console.log(`\n  GRAND TOTAL: $${grandTotal.toFixed(2)} (ref: $${REF_GRAND_TOTAL.toFixed(2)}) ${totalMatch(grandTotal, REF_GRAND_TOTAL)}`)

  // Final status
  const allCountsMatch = shipments.length === REFERENCE.shipments.count &&
    additionalServices.length === REFERENCE.additionalServices.count &&
    returns.length === REFERENCE.returns.count &&
    receiving.length === REFERENCE.receiving.count &&
    storage.length === REFERENCE.storage.count &&
    credits.length === REFERENCE.credits.count
  const totalDiff = Math.abs(grandTotal - REF_GRAND_TOTAL)

  console.log('\n' + '='.repeat(70))
  if (allCountsMatch && totalDiff < 1) {
    console.log('✅ VALIDATION PASSED - All counts match, total within $1 tolerance')
  } else if (allCountsMatch) {
    console.log(`⚠️  COUNTS MATCH but total differs by $${totalDiff.toFixed(2)} (expected small rounding variance)`)
  } else {
    console.log('❌ VALIDATION FAILED - Check row counts and totals above')
  }
}

main().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
