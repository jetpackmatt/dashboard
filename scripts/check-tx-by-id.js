#!/usr/bin/env node
/**
 * Query ShipBob transactions:query by transaction_ids
 */

require('dotenv').config({ path: '.env.local' })

async function main() {
  const token = process.env.SHIPBOB_API_TOKEN

  // Sample transaction IDs from the 220 we linked
  const sampleTxIds = [
    '01KCH7BWPNM12AMXZJG2CHR8VV',
    '01KCH3F0T8AN1E3GQWVRXY23NX',
    '01KCHAQGD1A5CJKABZDFERB3CV',
    '01KCH77ZN48F7Q8970QARJ6NXA',
    '01KCH5QP359WAHD96M05RWFCPF'
  ]

  console.log('Querying by transaction_ids:', sampleTxIds)

  const response = await fetch('https://api.shipbob.com/2025-07/transactions:query', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      transaction_ids: sampleTxIds,
      page_size: 50
    })
  })

  console.log('Status:', response.status)

  if (response.status === 200) {
    const data = await response.json()
    const items = data.items || data || []
    console.log('Returned:', items.length, 'transactions')

    if (items.length === 0) {
      console.log('\n>>> ShipBob does NOT have these transaction IDs!')
      console.log('>>> These transactions may have been DELETED or VOIDED in ShipBob.')
    }

    for (const tx of items) {
      console.log('\nTransaction:')
      console.log('  id:', tx.transaction_id)
      console.log('  ref:', tx.reference_id, tx.reference_type)
      console.log('  fee:', tx.transaction_fee)
      console.log('  invoice:', tx.invoice_id, 'date:', tx.invoice_date)
      console.log('  invoiced:', tx.invoiced_status)
    }
  } else {
    console.log('Error:', await response.text())
  }

  // Also try querying by date range to see what ShipBob has for Dec 15
  console.log('\n\n=== Querying all transactions for Dec 15 ===')

  const dateResponse = await fetch('https://api.shipbob.com/2025-07/transactions:query', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      start_date: '2025-12-15',
      end_date: '2025-12-15',
      transaction_types: ['Charge'],
      page_size: 1000
    })
  })

  if (dateResponse.status === 200) {
    const dateData = await dateResponse.json()
    const items = dateData.items || dateData || []
    console.log('Transactions for Dec 15:', items.length)
    console.log('Has next:', !!dateData.next)

    // Group by invoice_id and fee_type
    const byInvoiceFee = {}
    for (const tx of items) {
      const key = (tx.invoice_id || 'NULL') + ' / ' + tx.transaction_fee
      byInvoiceFee[key] = (byInvoiceFee[key] || 0) + 1
    }

    console.log('\nBy invoice_id / fee_type:')
    for (const [key, c] of Object.entries(byInvoiceFee).sort((a, b) => b[1] - a[1]).slice(0, 20)) {
      console.log('  ', key, ':', c)
    }
  }
}

main().catch(console.error)
