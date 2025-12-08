/**
 * Check what merchant_id comes from ShipBob API for invoice 8633612 transactions
 */
require('dotenv').config({ path: '.env.local' })

async function main() {
  console.log('Fetching transactions for invoice 8633612 from ShipBob API...\n')

  // Query transactions for this specific invoice
  let allTx = []
  let cursor = null
  let page = 0

  do {
    page++
    let url = 'https://api.shipbob.com/2025-07/transactions:query'
    if (cursor) url += '?Cursor=' + encodeURIComponent(cursor)

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.SHIPBOB_API_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        invoice_ids: ['8633612'],
        page_size: 1000
      })
    })

    const data = await resp.json()
    if (!data.items) {
      console.log('API Response:', data)
      break
    }
    allTx.push(...data.items)
    cursor = data.next
    process.stderr.write(`Page ${page} (${allTx.length} tx)...`)
  } while (cursor && page < 100)

  console.log(`\n\nTotal transactions from API: ${allTx.length}`)

  // Group by merchant_id
  const byMerchant = {}
  for (const tx of allTx) {
    const mid = tx.merchant_id || 'null'
    if (!byMerchant[mid]) byMerchant[mid] = { count: 0, total: 0, samples: [] }
    byMerchant[mid].count++
    byMerchant[mid].total += Number(tx.amount)
    if (byMerchant[mid].samples.length < 3) {
      byMerchant[mid].samples.push(tx)
    }
  }

  console.log('\n' + '='.repeat(70))
  console.log('BY MERCHANT_ID FROM API:')
  console.log('='.repeat(70))
  for (const [mid, stats] of Object.entries(byMerchant).sort((a, b) => b[1].total - a[1].total)) {
    console.log(`  merchant_id ${mid}: ${stats.count} tx, $${stats.total.toFixed(2)}`)
  }

  // Now let's check: which merchant_id should Henson have?
  // Henson's merchant_id is 386350 (from clients table)
  const hensonMerchant = 386350
  const hensonTx = allTx.filter(t => t.merchant_id === hensonMerchant)
  const nonHensonTx = allTx.filter(t => t.merchant_id !== hensonMerchant)

  console.log('\n' + '='.repeat(70))
  console.log(`HENSON (merchant_id=${hensonMerchant}) vs OTHER:`)
  console.log('='.repeat(70))
  console.log(`  Henson: ${hensonTx.length} tx, $${hensonTx.reduce((s, t) => s + Number(t.amount), 0).toFixed(2)}`)
  console.log(`  Other: ${nonHensonTx.length} tx, $${nonHensonTx.reduce((s, t) => s + Number(t.amount), 0).toFixed(2)}`)

  // What are the "Other" merchant_ids?
  const otherMerchants = new Set(nonHensonTx.map(t => t.merchant_id))
  console.log(`  Other merchant_ids: ${[...otherMerchants].join(', ')}`)

  // The expected Henson shipping total is $9,715.24
  // Our DB shows Henson has $8,329.54 for shipping
  // So we're missing $1,385.70
  console.log('\n' + '='.repeat(70))
  console.log('EXPECTED VS API TOTALS:')
  console.log('='.repeat(70))
  console.log('  Expected Henson Shipping: $9,715.24')
  console.log(`  API Henson Shipping:      $${hensonTx.reduce((s, t) => s + Number(t.amount), 0).toFixed(2)}`)
  console.log('')
  console.log('  If API shows the same as our DB, the issue is in the API data itself.')
  console.log('  If API shows the correct amount, the issue is in our sync process.')
}

main().catch(console.error)
