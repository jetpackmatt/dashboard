#!/usr/bin/env npx tsx
/**
 * Search for WRO 872067 in ShipBob's transaction API
 * Uses the /transactions:query endpoint directly (same as sync-transactions cron)
 */

import 'dotenv/config'

const SHIPBOB_API_BASE = 'https://api.shipbob.com/2025-07'

async function main() {
  console.log('='.repeat(60))
  console.log('Searching ShipBob for WRO 872067')
  console.log('='.repeat(60))

  const parentToken = process.env.SHIPBOB_API_TOKEN
  if (!parentToken) {
    console.error('SHIPBOB_API_TOKEN not set')
    process.exit(1)
  }

  try {
    // Search last 30 days
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - 30)

    console.log(`\nFetching transactions from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}...`)

    const allTx: any[] = []
    let cursor: string | null = null
    let page = 0

    do {
      page++
      let url = `${SHIPBOB_API_BASE}/transactions:query`
      if (cursor) url += `?Cursor=${encodeURIComponent(cursor)}`

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${parentToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from_date: startDate.toISOString(),
          to_date: endDate.toISOString(),
          page_size: 1000,
        }),
      })

      if (!response.ok) {
        if (response.status === 429) {
          console.log('Rate limited, waiting 60s...')
          await new Promise((r) => setTimeout(r, 60000))
          continue
        }
        throw new Error(`API error: ${response.status} ${response.statusText}`)
      }

      const data = await response.json()
      allTx.push(...(data.items || []))
      cursor = data.next

      if (page % 5 === 0) {
        console.log(`  Page ${page}: ${allTx.length} total transactions`)
      }
    } while (cursor)

    console.log(`\nTotal transactions fetched: ${allTx.length}`)

    // Search for WRO 872067
    const matches = allTx.filter(tx =>
      tx.reference_id?.toString() === '872067' ||
      tx.reference_id?.toString().includes('872067')
    )

    if (matches.length > 0) {
      console.log(`\n✅ Found ${matches.length} transaction(s) for WRO 872067:`)
      for (const tx of matches) {
        console.log(JSON.stringify(tx, null, 2))
      }
    } else {
      console.log('\n❌ WRO 872067 NOT FOUND in any ShipBob transactions!')
      console.log('\nThis means ShipBob has NOT yet created a transaction for this WRO.')
      console.log('It will likely appear on next week\'s invoice.')
    }

    // Find all WRO (Receiving) transactions to see which ones exist
    const wroTx = allTx.filter(tx => tx.reference_type === 'WRO')
    console.log(`\n\nAll WRO (Receiving) transactions in last 30 days: ${wroTx.length}`)

    // Group by invoice_id to see what's on each invoice
    const byInvoice: Record<number, any[]> = {}
    for (const tx of wroTx) {
      const invId = tx.invoice_id || 0
      if (!byInvoice[invId]) byInvoice[invId] = []
      byInvoice[invId].push(tx)
    }

    console.log('\nWROs by invoice:')
    for (const [invId, txs] of Object.entries(byInvoice).slice(-5)) {
      console.log(`  Invoice ${invId}: ${txs.length} WROs`)
      for (const tx of txs.slice(0, 5)) {
        console.log(`    - WRO ${tx.reference_id}: ${tx.transaction_fee} $${tx.amount}`)
      }
      if (txs.length > 5) console.log(`    ... and ${txs.length - 5} more`)
    }

  } catch (err) {
    console.error('Error:', err)
  }
}

main()
