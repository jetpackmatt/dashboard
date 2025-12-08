#!/usr/bin/env node
/**
 * Query ShipBob API for invoice transactions to compare with DB
 */

require('dotenv').config({ path: '.env.local' })

async function main() {
  const invoiceIds = [8633612, 8633618, 8633632, 8633634, 8633637, 8633641]

  console.log('Querying ShipBob API for invoice transactions...')
  console.log('')

  // Query transactions with the invoice_id_sb values
  const resp = await fetch('https://api.shipbob.com/2025-07/transactions:query', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + process.env.SHIPBOB_API_TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from_date: '2025-11-23T00:00:00Z',
      to_date: '2025-12-02T00:00:00Z',
      page_size: 1000
    })
  })

  const data = await resp.json()
  let allItems = data.items || []
  let cursor = data.next

  // Paginate
  while (cursor) {
    const nextResp = await fetch('https://api.shipbob.com/2025-07/transactions:query?Cursor=' + encodeURIComponent(cursor), {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.SHIPBOB_API_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from_date: '2025-11-23T00:00:00Z',
        to_date: '2025-12-02T00:00:00Z',
        page_size: 1000
      })
    })
    const nextData = await nextResp.json()
    allItems.push(...(nextData.items || []))
    cursor = nextData.next
    process.stdout.write('\r  Fetched ' + allItems.length + ' transactions...')
    if (allItems.length > 10000) break // safety limit
  }

  console.log('\rTotal transactions from API: ' + allItems.length)

  // Filter by invoice_id
  const matching = allItems.filter(t => invoiceIds.includes(t.invoice_id))
  console.log('With 8633xxx invoice IDs: ' + matching.length)

  // Group by invoice ID and transaction_fee
  const byInvoice = {}
  for (const t of matching) {
    if (!byInvoice[t.invoice_id]) byInvoice[t.invoice_id] = { total: 0, fees: {} }
    byInvoice[t.invoice_id].total++
    if (!byInvoice[t.invoice_id].fees[t.transaction_fee]) {
      byInvoice[t.invoice_id].fees[t.transaction_fee] = 0
    }
    byInvoice[t.invoice_id].fees[t.transaction_fee]++
  }

  console.log('')
  console.log('='.repeat(60))
  console.log('API RESULTS BY INVOICE ID')
  console.log('='.repeat(60))

  // Sort by invoice ID
  const sortedInvoices = Object.entries(byInvoice).sort((a, b) => Number(a[0]) - Number(b[0]))

  for (const [inv, info] of sortedInvoices) {
    console.log('\nInvoice ' + inv + ': ' + info.total + ' transactions')
    const sortedFees = Object.entries(info.fees).sort((a, b) => b[1] - a[1])
    for (const [fee, cnt] of sortedFees) {
      console.log('  ' + fee + ': ' + cnt)
    }
  }

  // Summary comparison
  console.log('')
  console.log('='.repeat(60))
  console.log('COMPARISON WITH DATABASE')
  console.log('='.repeat(60))

  // DB counts (from earlier query)
  const dbCounts = {
    8633612: { total: 1435, desc: 'Shipments' },
    8633618: { total: 969, desc: 'Storage' },
    8633632: { total: 1, desc: 'Receiving' },
    8633634: { total: 1112, desc: 'Additional Services' },
    8633637: { total: 3, desc: 'Returns' },
    8633641: { total: 11, desc: 'Credits' }
  }

  let totalApi = 0
  let totalDb = 0

  for (const inv of invoiceIds) {
    const apiCount = byInvoice[inv]?.total || 0
    const dbCount = dbCounts[inv]?.total || 0
    const diff = apiCount - dbCount
    totalApi += apiCount
    totalDb += dbCount

    const status = diff === 0 ? '✓' : (diff > 0 ? '+' + diff : '' + diff)
    console.log('Invoice ' + inv + ' (' + dbCounts[inv]?.desc + '): API=' + apiCount + ', DB=' + dbCount + ' ' + status)
  }

  console.log('')
  console.log('TOTAL: API=' + totalApi + ', DB=' + totalDb + ' (diff=' + (totalApi - totalDb) + ')')
}

main().catch(console.error)
