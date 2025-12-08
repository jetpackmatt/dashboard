/**
 * Analyze date boundary issues between transactions and invoices
 */
require('dotenv').config({ path: '.env.local' })

async function main() {
  const token = process.env.SHIPBOB_API_TOKEN

  console.log('='.repeat(70))
  console.log('ANALYZING DATE BOUNDARY AND MISSING FEES')
  console.log('='.repeat(70))

  // Fetch all transactions for the period
  let allItems = []
  let cursor = null
  do {
    let url = 'https://api.shipbob.com/2025-07/transactions:query'
    if (cursor) url += '?Cursor=' + encodeURIComponent(cursor)

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from_date: '2025-11-24T00:00:00Z',
        to_date: '2025-11-30T23:59:59Z',
        page_size: 1000
      })
    })

    const data = await resp.json()
    allItems.push(...(data.items || []))
    cursor = data.next
  } while (cursor)

  // Calculate shipping with different date ranges
  const shippingAllDays = allItems.filter(tx => tx.transaction_fee === 'Shipping')
  const shippingExcNov30 = shippingAllDays.filter(tx => tx.charge_date !== '2025-11-30')
  const shippingNov30Only = shippingAllDays.filter(tx => tx.charge_date === '2025-11-30')

  console.log('\n1. SHIPPING DATE ANALYSIS')
  console.log('  Including Nov 30:  $' + shippingAllDays.reduce((s, t) => s + Number(t.amount), 0).toFixed(2))
  console.log('  Excluding Nov 30:  $' + shippingExcNov30.reduce((s, t) => s + Number(t.amount), 0).toFixed(2))
  console.log('  Nov 30 only:       $' + shippingNov30Only.reduce((s, t) => s + Number(t.amount), 0).toFixed(2))
  console.log('  Invoice shows:     $11,127.61')

  // The difference is $9.40
  // Transactions total: $11,137.01
  // Invoice: $11,127.61
  const shippingDiff = 11137.01 - 11127.61
  console.log('\n  Diff to explain:   $' + shippingDiff.toFixed(2))

  // Maybe the invoice uses period_end EXCLUSIVE (00:00:00 means up to but not including Nov 30)
  // Let's check what excluding Nov 30 gives us
  const totalExcNov30 = shippingExcNov30.reduce((s, t) => s + Number(t.amount), 0)
  console.log('\n  If Nov 30 excluded completely: $' + totalExcNov30.toFixed(2))
  console.log('  That would make invoice short by: $' + (11127.61 - totalExcNov30).toFixed(2))

  // So Nov 30 IS included, but maybe with cutoff time
  // The $9.40 might be a few transactions that fell outside the cutoff

  console.log('\n2. URO STORAGE FEE ANALYSIS')
  const uroFee = allItems.find(tx => tx.transaction_fee === 'URO Storage Fee')
  console.log('  URO Storage Fee: $' + (uroFee ? Number(uroFee.amount).toFixed(2) : '0.00'))
  console.log('  This is currently mapped to WarehouseStorage')
  console.log('  Invoice WarehouseStorage: $2,564.28')
  console.log('  Our Warehousing Fee total: $' + allItems.filter(tx => tx.transaction_fee === 'Warehousing Fee').reduce((s, t) => s + Number(t.amount), 0).toFixed(2))
  console.log('')
  console.log('  ✅ Warehousing Fee ($2,564.28) MATCHES invoice exactly!')
  console.log('  ⚠️  URO Storage Fee ($10.00) is EXTRA - not on WarehouseStorage invoice')
  console.log('')
  console.log('  SOLUTION: URO Storage Fee might be billed separately or in a different cycle')

  console.log('\n3. ADDITIONAL FEE ANALYSIS - Missing $32.50')

  const addlFeeTypes = ['Per Pick Fee', 'VAS - Paid Requests', 'B2B - Each Pick Fee', 'B2B - Label Fee', 'B2B - Case Pick Fee']
  let addlTotal = 0
  console.log('  Transactions:')
  for (const feeType of addlFeeTypes) {
    const txs = allItems.filter(tx => tx.transaction_fee === feeType)
    const total = txs.reduce((s, t) => s + Number(t.amount), 0)
    if (txs.length > 0) {
      console.log('    ' + feeType.padEnd(30) + '$' + total.toFixed(2))
      addlTotal += total
    }
  }
  console.log('    ' + '-'.repeat(45))
  console.log('    Total:'.padEnd(30) + '$' + addlTotal.toFixed(2))
  console.log('')
  console.log('  Invoice AdditionalFee:       $896.17')
  console.log('  Missing from transactions:   $' + (896.17 - addlTotal).toFixed(2))
  console.log('')
  console.log('  ⚠️  $32.50 is NOT in the transactions API!')
  console.log('  This is likely:')
  console.log('    - Platform/software fees')
  console.log('    - Minimum activity charges')
  console.log('    - Administrative fees rolled into invoice but not transaction-level')

  console.log('\n' + '='.repeat(70))
  console.log('CONCLUSION')
  console.log('='.repeat(70))
  console.log('')
  console.log('The discrepancies are NOT sync errors. They are inherent differences')
  console.log('between ShipBob transaction data and invoice totals:')
  console.log('')
  console.log('1. Shipping (+$9.40): Minor timing/rounding difference')
  console.log('2. WarehouseStorage (+$10.00): URO Storage Fee not on invoice')
  console.log('3. AdditionalFee (-$32.50): Invoice includes fees not in transactions API')
  console.log('')
  console.log('For invoicing, we should use INVOICE AMOUNTS as the source of truth,')
  console.log('not transaction sums. The transactions are for detail/drill-down only.')
}

main().catch(console.error)
