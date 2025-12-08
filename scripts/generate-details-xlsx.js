/**
 * Generate INVOICE-DETAILS XLS for Henson to compare against the manual invoice
 * This will help identify where amounts differ
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const ExcelJS = require('exceljs')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Dec 1 invoice IDs (Nov 24-30, 2025 period)
const INVOICE_IDS = [8633641, 8633637, 8633634, 8633632, 8633618, 8633612]

// Fee to category mapping
const FEE_TO_CATEGORY = {
  'Shipping': 'shipments',
  'Delivery Area Surcharge': 'shipments',
  'Residential Surcharge': 'shipments',
  'Fuel Surcharge': 'shipments',
  'Oversized Surcharge': 'shipments',
  'Extended Area Surcharge': 'shipments',
  'Additional Handling Surcharge': 'shipments',

  'Per Pick Fee': 'additional_services',
  'B2B - Each Pick Fee': 'additional_services',
  'B2B - Case Pick Fee': 'additional_services',
  'B2B - Label Fee': 'additional_services',
  'Inventory Placement Program Fee': 'additional_services',

  'Warehousing Fee': 'storage',

  'Credit': 'credits',

  'Return to sender - Processing Fees': 'returns',
  'Return Processed by Operations Fee': 'returns',

  'WRO Receiving Fee': 'receiving',
}

async function fetchAllTransactions(clientId, invoiceIds) {
  let allTx = []
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('client_id', clientId)
      .in('invoice_id_sb', invoiceIds)
      .range(offset, offset + 999)
      .order('charge_date', { ascending: true })

    if (error) {
      console.log('Error:', error)
      break
    }
    if (!data || data.length === 0) break
    allTx.push(...data)
    offset += data.length
    if (data.length < 1000) break
  }

  return allTx
}

async function fetchShipmentsForTransactions(shipmentIds) {
  const shipments = {}

  for (let i = 0; i < shipmentIds.length; i += 100) {
    const batch = shipmentIds.slice(i, i + 100)
    const { data } = await supabase
      .from('shipments')
      .select('*')
      .in('shipment_id', batch)

    for (const s of data || []) {
      shipments[s.shipment_id] = s
    }
  }

  return shipments
}

async function main() {
  console.log('='.repeat(70))
  console.log('GENERATE DETAILS XLSX FOR HENSON')
  console.log('='.repeat(70))

  // Get Henson client
  const { data: henson } = await supabase
    .from('clients')
    .select('id, company_name, merchant_id')
    .ilike('company_name', '%henson%')
    .single()

  console.log('\nClient:', henson.company_name)
  console.log('Client ID:', henson.id)

  // Fetch all transactions
  console.log('\nFetching transactions...')
  const allTx = await fetchAllTransactions(henson.id, INVOICE_IDS)
  console.log('Total transactions:', allTx.length)

  // Get shipment IDs for Shipment-type transactions
  const shipmentIds = [...new Set(
    allTx
      .filter(t => t.reference_type === 'Shipment' && t.reference_id)
      .map(t => Number(t.reference_id))
  )]
  console.log('Unique shipment IDs:', shipmentIds.length)

  // Fetch shipment details
  console.log('Fetching shipment details...')
  const shipments = await fetchShipmentsForTransactions(shipmentIds)
  console.log('Shipments loaded:', Object.keys(shipments).length)

  // Group transactions by category
  const byCategory = {
    shipments: [],
    additional_services: [],
    returns: [],
    receiving: [],
    storage: [],
    credits: [],
    other: []
  }

  for (const tx of allTx) {
    const cat = FEE_TO_CATEGORY[tx.transaction_fee] || 'other'
    byCategory[cat].push(tx)
  }

  // Print summary
  console.log('\n' + '='.repeat(70))
  console.log('SUMMARY BY CATEGORY:')
  console.log('='.repeat(70))
  for (const [cat, txs] of Object.entries(byCategory)) {
    if (txs.length > 0) {
      const total = txs.reduce((sum, t) => sum + Number(t.amount), 0)
      console.log(`  ${cat.padEnd(20)}: ${txs.length} tx, $${total.toFixed(2)}`)
    }
  }

  // Create Excel workbook
  const workbook = new ExcelJS.Workbook()

  // ============ SHIPMENTS SHEET ============
  const shipmentSheet = workbook.addWorksheet('Shipments')
  shipmentSheet.columns = [
    { header: 'User ID', key: 'user_id', width: 12 },
    { header: 'Merchant Name', key: 'merchant_name', width: 20 },
    { header: 'Customer Name', key: 'customer_name', width: 20 },
    { header: 'StoreIntegrationName', key: 'store', width: 15 },
    { header: 'OrderID', key: 'order_id', width: 12 },
    { header: 'Transaction Type', key: 'tx_type', width: 15 },
    { header: 'Transaction Date', key: 'tx_date', width: 25 },
    { header: 'Store OrderID', key: 'store_order_id', width: 15 },
    { header: 'TrackingId', key: 'tracking_id', width: 25 },
    { header: 'Fulfillment without Surcharge', key: 'base_amount', width: 25 },
    { header: 'Surcharge Applied', key: 'surcharge', width: 18 },
    { header: 'Original Invoice', key: 'total', width: 15 },
    { header: 'Fee Type', key: 'fee_type', width: 25 },
    { header: 'Ship Option ID', key: 'ship_option_id', width: 15 },
    { header: 'Carrier', key: 'carrier', width: 15 },
    { header: 'Carrier Service', key: 'carrier_service', width: 20 },
    { header: 'Zone Used', key: 'zone', width: 10 },
    { header: 'Actual Weight (Oz)', key: 'weight', width: 18 },
    { header: 'State', key: 'state', width: 8 },
    { header: 'Destination Country', key: 'country', width: 18 },
  ]

  // Group shipment transactions by shipment_id to consolidate base + surcharges
  const shipmentGroups = {}
  for (const tx of byCategory.shipments) {
    const shipId = tx.reference_id
    if (!shipmentGroups[shipId]) {
      shipmentGroups[shipId] = { base: 0, surcharges: 0, tx: tx, allTx: [] }
    }
    shipmentGroups[shipId].allTx.push(tx)
    if (tx.transaction_fee === 'Shipping') {
      shipmentGroups[shipId].base += Number(tx.amount)
    } else {
      shipmentGroups[shipId].surcharges += Number(tx.amount)
    }
  }

  let shipmentTotal = 0
  for (const [shipId, group] of Object.entries(shipmentGroups)) {
    const shipment = shipments[shipId] || {}
    const tx = group.tx
    const total = group.base + group.surcharges
    shipmentTotal += total

    shipmentSheet.addRow({
      user_id: henson.merchant_id,
      merchant_name: henson.company_name,
      customer_name: shipment.recipient_name || '',
      store: '',
      order_id: shipment.order_id || tx.reference_id,
      tx_type: 'Charge',
      tx_date: tx.charge_date,
      store_order_id: '',
      tracking_id: shipment.tracking_number || '',
      base_amount: group.base,
      surcharge: group.surcharges,
      total: total,
      fee_type: group.allTx.map(t => t.transaction_fee).join(', '),
      ship_option_id: shipment.ship_option_id || '',
      carrier: shipment.carrier || '',
      carrier_service: shipment.carrier_service || '',
      zone: '',
      weight: shipment.actual_weight_oz || '',
      state: shipment.recipient_state || '',
      country: shipment.recipient_country || ''
    })
  }

  // Add total row
  shipmentSheet.addRow({
    merchant_name: 'TOTAL',
    total: shipmentTotal
  })

  // ============ ADDITIONAL SERVICES SHEET ============
  const addlSheet = workbook.addWorksheet('Additional Services')
  addlSheet.columns = [
    { header: 'User ID', key: 'user_id', width: 12 },
    { header: 'Merchant Name', key: 'merchant_name', width: 20 },
    { header: 'Reference ID', key: 'reference_id', width: 15 },
    { header: 'Fee Type', key: 'fee_type', width: 30 },
    { header: 'Invoice Amount', key: 'amount', width: 15 },
    { header: 'Transaction Date', key: 'tx_date', width: 25 },
  ]

  let addlTotal = 0
  for (const tx of byCategory.additional_services) {
    addlTotal += Number(tx.amount)
    addlSheet.addRow({
      user_id: henson.merchant_id,
      merchant_name: henson.company_name,
      reference_id: tx.reference_id,
      fee_type: tx.transaction_fee,
      amount: Number(tx.amount),
      tx_date: tx.charge_date
    })
  }
  addlSheet.addRow({ merchant_name: 'TOTAL', amount: addlTotal })

  // ============ RETURNS SHEET ============
  const returnsSheet = workbook.addWorksheet('Returns')
  returnsSheet.columns = [
    { header: 'User ID', key: 'user_id', width: 12 },
    { header: 'Merchant Name', key: 'merchant_name', width: 20 },
    { header: 'Return ID', key: 'reference_id', width: 15 },
    { header: 'Invoice', key: 'amount', width: 12 },
    { header: 'Transaction Type', key: 'fee_type', width: 35 },
    { header: 'Transaction Date', key: 'tx_date', width: 25 },
  ]

  let returnsTotal = 0
  for (const tx of byCategory.returns) {
    returnsTotal += Number(tx.amount)
    returnsSheet.addRow({
      user_id: henson.merchant_id,
      merchant_name: henson.company_name,
      reference_id: tx.reference_id,
      amount: Number(tx.amount),
      fee_type: tx.transaction_fee,
      tx_date: tx.charge_date
    })
  }
  returnsSheet.addRow({ merchant_name: 'TOTAL', amount: returnsTotal })

  // ============ RECEIVING SHEET ============
  const receivingSheet = workbook.addWorksheet('Receiving')
  receivingSheet.columns = [
    { header: 'User ID', key: 'user_id', width: 12 },
    { header: 'Merchant Name', key: 'merchant_name', width: 20 },
    { header: 'Reference ID', key: 'reference_id', width: 15 },
    { header: 'Fee Type', key: 'fee_type', width: 20 },
    { header: 'Invoice Amount', key: 'amount', width: 15 },
    { header: 'Transaction Type', key: 'tx_type', width: 15 },
    { header: 'Transaction Date', key: 'tx_date', width: 25 },
  ]

  let receivingTotal = 0
  for (const tx of byCategory.receiving) {
    receivingTotal += Number(tx.amount)
    receivingSheet.addRow({
      user_id: henson.merchant_id,
      merchant_name: henson.company_name,
      reference_id: tx.reference_id,
      fee_type: tx.transaction_fee,
      amount: Number(tx.amount),
      tx_type: 'Charge',
      tx_date: tx.charge_date
    })
  }
  receivingSheet.addRow({ merchant_name: 'TOTAL', amount: receivingTotal })

  // ============ STORAGE SHEET ============
  const storageSheet = workbook.addWorksheet('Storage')
  storageSheet.columns = [
    { header: 'Merchant Name', key: 'merchant_name', width: 20 },
    { header: 'ChargeStartdate', key: 'charge_date', width: 25 },
    { header: 'Reference ID', key: 'reference_id', width: 15 },
    { header: 'Fee Type', key: 'fee_type', width: 20 },
    { header: 'Invoice', key: 'amount', width: 12 },
    { header: 'Additional Details', key: 'details', width: 50 },
  ]

  let storageTotal = 0
  for (const tx of byCategory.storage) {
    storageTotal += Number(tx.amount)
    storageSheet.addRow({
      merchant_name: henson.company_name,
      charge_date: tx.charge_date,
      reference_id: tx.reference_id,
      fee_type: tx.transaction_fee,
      amount: Number(tx.amount),
      details: JSON.stringify(tx.additional_details || {})
    })
  }
  storageSheet.addRow({ merchant_name: 'TOTAL', amount: storageTotal })

  // ============ CREDITS SHEET ============
  const creditsSheet = workbook.addWorksheet('Credits')
  creditsSheet.columns = [
    { header: 'User ID', key: 'user_id', width: 12 },
    { header: 'Merchant Name', key: 'merchant_name', width: 20 },
    { header: 'Reference ID', key: 'reference_id', width: 15 },
    { header: 'Transaction Date', key: 'tx_date', width: 25 },
    { header: 'Credit Reason', key: 'reason', width: 25 },
    { header: 'Credit Amount', key: 'amount', width: 15 },
  ]

  let creditsTotal = 0
  for (const tx of byCategory.credits) {
    creditsTotal += Number(tx.amount)
    creditsSheet.addRow({
      user_id: henson.merchant_id,
      merchant_name: henson.company_name,
      reference_id: tx.reference_id,
      tx_date: tx.charge_date,
      reason: tx.additional_details?.credit_reason || '',
      amount: Number(tx.amount)
    })
  }
  creditsSheet.addRow({ merchant_name: 'TOTAL', amount: creditsTotal })

  // Save workbook
  const outputPath = 'scripts/output/INVOICE-DETAILS-HENSON-DB.xlsx'
  await workbook.xlsx.writeFile(outputPath)
  console.log('\n' + '='.repeat(70))
  console.log('OUTPUT SAVED TO:', outputPath)
  console.log('='.repeat(70))

  // Print comparison summary
  console.log('\n' + '='.repeat(70))
  console.log('COMPARISON: OUR DB vs EXPECTED (from manual invoice)')
  console.log('='.repeat(70))

  const expected = {
    shipments: 9715.24,
    additional_services: 765.95,
    returns: 14.79,
    receiving: 35.00,
    storage: 997.94,
    credits: -686.12
  }

  const ours = {
    shipments: shipmentTotal,
    additional_services: addlTotal,
    returns: returnsTotal,
    receiving: receivingTotal,
    storage: storageTotal,
    credits: creditsTotal
  }

  let totalOurs = 0
  let totalExpected = 0

  for (const cat of Object.keys(expected)) {
    const ourVal = ours[cat] || 0
    const expVal = expected[cat]
    const diff = ourVal - expVal
    const status = Math.abs(diff) < 0.01 ? '✓' : `DIFF: $${diff.toFixed(2)}`
    console.log(`  ${cat.padEnd(20)}: $${ourVal.toFixed(2).padStart(10)} vs $${expVal.toFixed(2).padStart(10)} ${status}`)
    totalOurs += ourVal
    totalExpected += expVal
  }

  console.log('')
  console.log(`  ${'TOTAL'.padEnd(20)}: $${totalOurs.toFixed(2).padStart(10)} vs $${totalExpected.toFixed(2).padStart(10)} DIFF: $${(totalOurs - totalExpected).toFixed(2)}`)

  // Also check "other" category
  if (byCategory.other.length > 0) {
    console.log('\n' + '='.repeat(70))
    console.log('UNCATEGORIZED TRANSACTIONS (other):')
    console.log('='.repeat(70))
    const otherTotal = byCategory.other.reduce((s, t) => s + Number(t.amount), 0)
    console.log(`  Count: ${byCategory.other.length}, Total: $${otherTotal.toFixed(2)}`)
    const feeTypes = {}
    for (const tx of byCategory.other) {
      feeTypes[tx.transaction_fee] = (feeTypes[tx.transaction_fee] || 0) + 1
    }
    console.log('  Fee types:', feeTypes)
  }
}

main().catch(console.error)
