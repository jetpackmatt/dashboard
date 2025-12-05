#!/usr/bin/env node
/**
 * COMPLETE Billing API Exploration
 *
 * Deep dive into EVERY aspect of the Billing API to understand:
 * 1. All transaction types and their reference_id formats
 * 2. Credits - what do they link to?
 * 3. Storage - decode the FC-InventoryID-LocationType format
 * 4. Returns - what info is available?
 * 5. WarehouseInboundFee - why 0 transactions?
 * 6. Any patterns for client/merchant association
 */
require('dotenv').config({ path: '.env.local' })

const token = process.env.SHIPBOB_API_TOKEN
const API_BASE = 'https://api.shipbob.com/2025-07'

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
  return { data: await response.json(), headers: response.headers, status: response.status }
}

async function fetchAllPages(baseUrl, maxPages = 50) {
  let allItems = []
  let cursor = null
  let page = 0

  do {
    let url = baseUrl + (baseUrl.includes('?') ? '&' : '?') + 'pageSize=250'
    if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`

    const { data } = await fetchJson(url)
    const items = data.items || []
    allItems.push(...items)
    cursor = data.next
    page++

    if (page >= maxPages) {
      console.log(`  (Stopped at ${maxPages} pages, ${allItems.length} items)`)
      break
    }
  } while (cursor)

  return allItems
}

async function main() {
  console.log('='.repeat(100))
  console.log('COMPLETE SHIPBOB BILLING API EXPLORATION')
  console.log('='.repeat(100))

  // ============================================================
  // PART 1: GET ALL FEE TYPES
  // ============================================================
  console.log('\n' + '█'.repeat(100))
  console.log('PART 1: ALL TRANSACTION FEE TYPES')
  console.log('█'.repeat(100))

  const { data: feeData } = await fetchJson(`${API_BASE}/transaction-fees`)
  const feeList = feeData.fee_list || feeData || []

  console.log(`\nTotal fee types: ${feeList.length}`)
  console.log('\nComplete list:')
  feeList.forEach((fee, i) => console.log(`  ${(i + 1).toString().padStart(2)}. ${fee}`))

  // ============================================================
  // PART 2: GET ALL INVOICES (90 days)
  // ============================================================
  console.log('\n' + '█'.repeat(100))
  console.log('PART 2: ALL INVOICES (Last 90 Days)')
  console.log('█'.repeat(100))

  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 90)

  const invoices = await fetchAllPages(
    `${API_BASE}/invoices?startDate=${startDate.toISOString().split('T')[0]}&endDate=${endDate.toISOString().split('T')[0]}`
  )

  console.log(`\nTotal invoices: ${invoices.length}`)

  // Group by type
  const invoicesByType = {}
  for (const inv of invoices) {
    if (!invoicesByType[inv.invoice_type]) {
      invoicesByType[inv.invoice_type] = []
    }
    invoicesByType[inv.invoice_type].push(inv)
  }

  console.log('\nBy invoice type:')
  for (const [type, list] of Object.entries(invoicesByType)) {
    const total = list.reduce((s, i) => s + i.amount, 0)
    console.log(`  ${type.padEnd(20)}: ${list.length.toString().padStart(3)} invoices, $${total.toFixed(2).padStart(12)}`)
  }

  // ============================================================
  // PART 3: DEEP DIVE - CREDITS
  // ============================================================
  console.log('\n' + '█'.repeat(100))
  console.log('PART 3: DEEP DIVE - CREDITS')
  console.log('█'.repeat(100))

  const creditInvoices = invoicesByType['Credits'] || []
  console.log(`\nCredit invoices: ${creditInvoices.length}`)

  let allCredits = []
  for (const inv of creditInvoices.slice(0, 5)) { // Check first 5
    const txs = await fetchAllPages(`${API_BASE}/invoices/${inv.invoice_id}/transactions`)
    allCredits.push(...txs)
  }

  console.log(`Total credit transactions fetched: ${allCredits.length}`)

  // Analyze reference_id patterns
  console.log('\n--- Credit reference_id Analysis ---')
  const creditRefPatterns = {}
  const creditReasons = {}
  const creditRefTypes = {}

  for (const tx of allCredits) {
    // Check reference_id format
    const refId = tx.reference_id
    const isNumeric = /^\d+$/.test(refId)
    const pattern = isNumeric ? 'numeric' : 'other'
    creditRefPatterns[pattern] = (creditRefPatterns[pattern] || 0) + 1

    // Check reference_type
    creditRefTypes[tx.reference_type] = (creditRefTypes[tx.reference_type] || 0) + 1

    // Check credit reasons
    const reason = tx.additional_details?.CreditReason || 'Unknown'
    creditReasons[reason] = (creditReasons[reason] || 0) + 1
  }

  console.log('\nReference ID patterns:')
  for (const [pattern, count] of Object.entries(creditRefPatterns)) {
    console.log(`  ${pattern}: ${count}`)
  }

  console.log('\nReference types:')
  for (const [type, count] of Object.entries(creditRefTypes)) {
    console.log(`  ${type}: ${count}`)
  }

  console.log('\nCredit reasons:')
  for (const [reason, count] of Object.entries(creditReasons).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason}: ${count}`)
  }

  console.log('\n--- Sample Credit Transactions ---')
  for (let i = 0; i < Math.min(5, allCredits.length); i++) {
    console.log(`\nCredit ${i + 1}:`)
    console.log(JSON.stringify(allCredits[i], null, 2))
  }

  // Try to match credit reference_ids to shipments
  console.log('\n--- Testing if Credit reference_ids are Shipment IDs ---')
  const sampleCreditRefs = allCredits.slice(0, 3).map(c => c.reference_id)
  console.log(`Testing reference_ids: ${sampleCreditRefs.join(', ')}`)

  const { data: refCheck } = await fetchJson(`${API_BASE}/transactions:query`, {
    method: 'POST',
    body: JSON.stringify({
      reference_ids: sampleCreditRefs,
      page_size: 50
    })
  })

  const refCheckItems = refCheck.items || []
  console.log(`Found ${refCheckItems.length} transactions for these reference_ids`)

  if (refCheckItems.length > 0) {
    const shipmentTxs = refCheckItems.filter(t => t.reference_type === 'Shipment')
    console.log(`  Of which ${shipmentTxs.length} are Shipment type (meaning credit ref = order/shipment ID)`)
  }

  // ============================================================
  // PART 4: DEEP DIVE - STORAGE
  // ============================================================
  console.log('\n' + '█'.repeat(100))
  console.log('PART 4: DEEP DIVE - STORAGE')
  console.log('█'.repeat(100))

  const storageInvoices = invoicesByType['WarehouseStorage'] || []
  console.log(`\nStorage invoices: ${storageInvoices.length}`)

  let allStorage = []
  for (const inv of storageInvoices.slice(0, 2)) {
    const txs = await fetchAllPages(`${API_BASE}/invoices/${inv.invoice_id}/transactions`)
    allStorage.push(...txs)
  }

  console.log(`Total storage transactions fetched: ${allStorage.length}`)

  // Analyze reference_id format: FC_ID-InventoryID-LocationType
  console.log('\n--- Storage reference_id Analysis ---')

  const storageFCs = {}
  const storageLocationTypes = {}
  const storageInventoryIds = new Set()

  for (const tx of allStorage) {
    const refId = tx.reference_id
    const parts = refId.split('-')

    if (parts.length >= 3) {
      const fcId = parts[0]
      const inventoryId = parts[1]
      const locationType = parts.slice(2).join('-') // In case location type has dashes

      storageFCs[fcId] = (storageFCs[fcId] || 0) + 1
      storageLocationTypes[locationType] = (storageLocationTypes[locationType] || 0) + 1
      storageInventoryIds.add(inventoryId)
    }
  }

  console.log('\nFulfillment Center IDs in storage:')
  for (const [fc, count] of Object.entries(storageFCs)) {
    console.log(`  ${fc}: ${count} transactions`)
  }

  console.log('\nLocation types:')
  for (const [type, count] of Object.entries(storageLocationTypes)) {
    console.log(`  ${type}: ${count}`)
  }

  console.log(`\nUnique Inventory IDs: ${storageInventoryIds.size}`)

  console.log('\n--- Sample Storage Transactions ---')
  for (let i = 0; i < Math.min(3, allStorage.length); i++) {
    console.log(`\nStorage ${i + 1}:`)
    console.log(JSON.stringify(allStorage[i], null, 2))
  }

  // Parse Comment field for more details
  console.log('\n--- Storage Comment Field Analysis ---')
  const commentPatterns = new Set()
  for (const tx of allStorage.slice(0, 10)) {
    const comment = tx.additional_details?.Comment || ''
    commentPatterns.add(comment)
  }
  console.log('Sample comments:')
  for (const comment of commentPatterns) {
    console.log(`  "${comment}"`)
  }

  // ============================================================
  // PART 5: DEEP DIVE - RETURNS
  // ============================================================
  console.log('\n' + '█'.repeat(100))
  console.log('PART 5: DEEP DIVE - RETURNS')
  console.log('█'.repeat(100))

  const returnInvoices = invoicesByType['ReturnsFee'] || []
  console.log(`\nReturn invoices: ${returnInvoices.length}`)

  let allReturns = []
  for (const inv of returnInvoices) {
    const txs = await fetchAllPages(`${API_BASE}/invoices/${inv.invoice_id}/transactions`)
    allReturns.push(...txs)
  }

  console.log(`Total return transactions fetched: ${allReturns.length}`)

  // Analyze return transactions
  console.log('\n--- Return Transaction Analysis ---')

  const returnFeeTypes = {}
  const returnRefTypes = {}

  for (const tx of allReturns) {
    returnFeeTypes[tx.transaction_fee] = (returnFeeTypes[tx.transaction_fee] || 0) + 1
    returnRefTypes[tx.reference_type] = (returnRefTypes[tx.reference_type] || 0) + 1
  }

  console.log('\nFee types:')
  for (const [fee, count] of Object.entries(returnFeeTypes)) {
    console.log(`  ${fee}: ${count}`)
  }

  console.log('\nReference types:')
  for (const [type, count] of Object.entries(returnRefTypes)) {
    console.log(`  ${type}: ${count}`)
  }

  console.log('\n--- Sample Return Transactions ---')
  for (let i = 0; i < Math.min(5, allReturns.length); i++) {
    console.log(`\nReturn ${i + 1}:`)
    console.log(JSON.stringify(allReturns[i], null, 2))
  }

  // ============================================================
  // PART 6: DEEP DIVE - WAREHOUSE INBOUND (WRO)
  // ============================================================
  console.log('\n' + '█'.repeat(100))
  console.log('PART 6: DEEP DIVE - WAREHOUSE INBOUND (WRO/Receiving)')
  console.log('█'.repeat(100))

  const inboundInvoices = invoicesByType['WarehouseInboundFee'] || []
  console.log(`\nInbound invoices: ${inboundInvoices.length}`)

  for (const inv of inboundInvoices) {
    console.log(`\nInvoice ${inv.invoice_id} (${inv.invoice_date}): $${inv.amount}`)

    const txs = await fetchAllPages(`${API_BASE}/invoices/${inv.invoice_id}/transactions`)
    console.log(`  Transactions: ${txs.length}`)

    if (txs.length > 0) {
      console.log('  Sample transaction:')
      console.log(JSON.stringify(txs[0], null, 2))
    } else {
      console.log('  ⚠️  NO TRANSACTIONS - invoice has amount but no transaction details!')
    }
  }

  // ============================================================
  // PART 7: DEEP DIVE - ADDITIONAL FEES
  // ============================================================
  console.log('\n' + '█'.repeat(100))
  console.log('PART 7: DEEP DIVE - ADDITIONAL FEES')
  console.log('█'.repeat(100))

  const addFeeInvoices = invoicesByType['AdditionalFee'] || []
  console.log(`\nAdditional Fee invoices: ${addFeeInvoices.length}`)

  let allAddFees = []
  for (const inv of addFeeInvoices.slice(0, 2)) {
    const txs = await fetchAllPages(`${API_BASE}/invoices/${inv.invoice_id}/transactions`)
    allAddFees.push(...txs)
  }

  console.log(`Total additional fee transactions fetched: ${allAddFees.length}`)

  // Analyze fee types
  const addFeeTypes = {}
  for (const tx of allAddFees) {
    addFeeTypes[tx.transaction_fee] = (addFeeTypes[tx.transaction_fee] || 0) + 1
  }

  console.log('\nFee types breakdown:')
  for (const [fee, count] of Object.entries(addFeeTypes).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${fee}: ${count}`)
  }

  console.log('\n--- Sample Additional Fee Transactions ---')
  // Show one of each fee type
  const shownFees = new Set()
  for (const tx of allAddFees) {
    if (!shownFees.has(tx.transaction_fee)) {
      console.log(`\n${tx.transaction_fee}:`)
      console.log(JSON.stringify(tx, null, 2))
      shownFees.add(tx.transaction_fee)
    }
    if (shownFees.size >= 5) break
  }

  // ============================================================
  // PART 8: PENDING TRANSACTIONS ANALYSIS
  // ============================================================
  console.log('\n' + '█'.repeat(100))
  console.log('PART 8: PENDING (UNINVOICED) TRANSACTIONS')
  console.log('█'.repeat(100))

  // Get more pending transactions
  const { data: pendingData } = await fetchJson(`${API_BASE}/transactions:query`, {
    method: 'POST',
    body: JSON.stringify({
      start_date: startDate.toISOString().split('T')[0],
      end_date: endDate.toISOString().split('T')[0],
      page_size: 1000
    })
  })

  const pendingTxs = pendingData.items || []
  console.log(`\nPending transactions (90 days): ${pendingTxs.length}`)

  // Group by invoice status
  const invoiced = pendingTxs.filter(t => t.invoiced_status)
  const pending = pendingTxs.filter(t => !t.invoiced_status)

  console.log(`  Invoiced: ${invoiced.length}`)
  console.log(`  Pending: ${pending.length}`)

  // Group pending by fee type
  const pendingByFee = {}
  let pendingTotal = 0
  for (const tx of pending) {
    pendingByFee[tx.transaction_fee] = (pendingByFee[tx.transaction_fee] || 0) + 1
    pendingTotal += tx.amount
  }

  console.log('\nPending by fee type:')
  for (const [fee, count] of Object.entries(pendingByFee).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${fee}: ${count}`)
  }
  console.log(`\nPending total: $${pendingTotal.toFixed(2)}`)

  // ============================================================
  // PART 9: QUERY BY REFERENCE_IDS TEST
  // ============================================================
  console.log('\n' + '█'.repeat(100))
  console.log('PART 9: QUERY BY REFERENCE_IDS')
  console.log('█'.repeat(100))

  // Get some shipment IDs from shipping transactions
  const shippingInvoices = invoicesByType['Shipping'] || []
  if (shippingInvoices.length > 0) {
    const shippingTxs = await fetchAllPages(`${API_BASE}/invoices/${shippingInvoices[0].invoice_id}/transactions`)

    const shipmentIds = shippingTxs.slice(0, 5).map(t => t.reference_id)
    console.log(`\nTesting query with ${shipmentIds.length} shipment IDs`)
    console.log(`IDs: ${shipmentIds.join(', ')}`)

    const { data: refQuery } = await fetchJson(`${API_BASE}/transactions:query`, {
      method: 'POST',
      body: JSON.stringify({
        reference_ids: shipmentIds,
        page_size: 100
      })
    })

    const refResults = refQuery.items || []
    console.log(`\nFound ${refResults.length} transactions for these shipments`)

    // Group by fee type
    const refByFee = {}
    for (const tx of refResults) {
      refByFee[tx.transaction_fee] = (refByFee[tx.transaction_fee] || 0) + 1
    }

    console.log('\nTransaction types per shipment:')
    for (const [fee, count] of Object.entries(refByFee)) {
      console.log(`  ${fee}: ${count}`)
    }

    console.log('\n--- All transactions for one shipment ---')
    const singleShipment = shipmentIds[0]
    const singleTxs = refResults.filter(t => t.reference_id === singleShipment)
    console.log(`Shipment ${singleShipment} has ${singleTxs.length} transactions:`)
    for (const tx of singleTxs) {
      console.log(`  ${tx.transaction_fee}: $${tx.amount} (${tx.transaction_id})`)
    }
  }

  // ============================================================
  // PART 10: ADDITIONAL DETAILS FIELD ANALYSIS
  // ============================================================
  console.log('\n' + '█'.repeat(100))
  console.log('PART 10: ADDITIONAL_DETAILS FIELD ANALYSIS')
  console.log('█'.repeat(100))

  // Collect all unique additional_details keys across all transaction types
  const allTxs = [...allCredits, ...allStorage, ...allReturns, ...allAddFees, ...pending]
  const detailKeys = {}

  for (const tx of allTxs) {
    const details = tx.additional_details || {}
    const txType = tx.invoice_type || 'Pending'

    if (!detailKeys[txType]) {
      detailKeys[txType] = {}
    }

    for (const key of Object.keys(details)) {
      if (!detailKeys[txType][key]) {
        detailKeys[txType][key] = {
          count: 0,
          samples: []
        }
      }
      detailKeys[txType][key].count++
      if (detailKeys[txType][key].samples.length < 3 && details[key]) {
        detailKeys[txType][key].samples.push(details[key])
      }
    }
  }

  console.log('\nadditional_details fields by invoice type:')
  for (const [type, keys] of Object.entries(detailKeys)) {
    console.log(`\n${type}:`)
    for (const [key, data] of Object.entries(keys)) {
      console.log(`  ${key}: ${data.count} occurrences`)
      if (data.samples.length > 0) {
        console.log(`    Samples: ${data.samples.slice(0, 2).map(s => JSON.stringify(s).slice(0, 60)).join(', ')}`)
      }
    }
  }

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log('\n' + '█'.repeat(100))
  console.log('SUMMARY: COMPLETE BILLING API CAPABILITIES')
  console.log('█'.repeat(100))

  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║ TRANSACTION TYPES AND LINKAGE                                                 ║
╠══════════════════════════════════════════════════════════════════════════════╣
║ Type              │ reference_type │ reference_id links to                    ║
╠═══════════════════╪════════════════╪══════════════════════════════════════════╣
║ Shipping          │ Shipment       │ shipment_id → JOIN to shipments table    ║
║ Per Pick Fee      │ Shipment       │ shipment_id → JOIN to shipments table    ║
║ Other Add. Fees   │ Shipment       │ shipment_id → JOIN to shipments table    ║
║ Credits           │ Default        │ order_id (appears to be) → needs lookup  ║
║ Returns           │ Return         │ return_id → needs Returns API sync       ║
║ Storage           │ FC             │ {FC_ID}-{InventoryID}-{LocationType}     ║
║ Inbound/WRO       │ ???            │ NO TRANSACTIONS RETURNED!                ║
╚══════════════════════════════════════════════════════════════════════════════╝

╔══════════════════════════════════════════════════════════════════════════════╗
║ ADDITIONAL_DETAILS FIELDS                                                     ║
╠══════════════════════════════════════════════════════════════════════════════╣
║ Shipping:     TrackingId, Comment                                             ║
║ Pick Fees:    TrackingId, Comment (with fee breakdown)                        ║
║ Credits:      CreditReason, TicketReference                                   ║
║ Returns:      TrackingId, Comment (with Order ID in text)                     ║
║ Storage:      InventoryId (empty!), LocationType (empty!), Comment (parsed)   ║
╚══════════════════════════════════════════════════════════════════════════════╝

╔══════════════════════════════════════════════════════════════════════════════╗
║ CLIENT/MERCHANT ASSOCIATION STRATEGY                                          ║
╠══════════════════════════════════════════════════════════════════════════════╣
║ 1. Shipping/Fees: reference_id = shipment_id → shipments.client_id            ║
║ 2. Credits: reference_id may be order_id → orders.client_id (verify!)         ║
║ 3. Returns: Need Returns API to get return→order→client mapping               ║
║ 4. Storage: Parse InventoryId from reference_id → Inventory API for client    ║
║ 5. Inbound: No transaction data available! Must use invoice amount only       ║
╚══════════════════════════════════════════════════════════════════════════════╝
`)
}

main().catch(console.error)
