#!/usr/bin/env node
/**
 * List all invoices with their details to understand the structure
 */

require('dotenv').config({ path: '.env.local' })

const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN
const BASE_URL = 'https://api.shipbob.com'

async function main() {
  console.log('Listing all invoices from Nov 2025\n')

  // Get all invoices for November-December
  const response = await fetch(
    `${BASE_URL}/2025-07/invoices?FromDate=2025-11-01&ToDate=2025-12-05&PageSize=50`,
    { headers: { 'Authorization': `Bearer ${SHIPBOB_TOKEN}` } }
  )

  if (!response.ok) {
    console.log(`Error: ${response.status}`)
    return
  }

  const data = await response.json()
  const invoices = data.items || []

  console.log(`Found ${invoices.length} invoices\n`)
  console.log('─'.repeat(80))

  for (const inv of invoices) {
    console.log(`Invoice #${inv.invoice_id}`)
    console.log(`  Date: ${inv.invoice_date}`)
    console.log(`  Type: ${inv.invoice_type}`)
    console.log(`  Amount: $${inv.amount?.toFixed(2) || 'N/A'}`)
    console.log(`  Balance: $${inv.running_balance?.toFixed(2) || 'N/A'}`)
    console.log('─'.repeat(80))
  }

  // Now test transactions for each invoice
  console.log('\nTesting transaction availability for each invoice:\n')

  for (const inv of invoices.slice(0, 15)) { // First 15
    const txResponse = await fetch(
      `${BASE_URL}/2025-07/invoices/${inv.invoice_id}/transactions?PageSize=1`,
      { headers: { 'Authorization': `Bearer ${SHIPBOB_TOKEN}` } }
    )

    if (txResponse.ok) {
      const txData = await txResponse.json()
      const count = txData.items?.length || 0
      const hasMore = !!txData.next
      console.log(`Invoice #${inv.invoice_id} (${inv.invoice_date}, ${inv.invoice_type}): ${count > 0 ? (hasMore ? 'Has transactions' : `${count} transaction(s)`) : 'No transactions'}`)
    } else {
      console.log(`Invoice #${inv.invoice_id} (${inv.invoice_date}, ${inv.invoice_type}): ERROR ${txResponse.status}`)
    }
  }

  // Sample invoice structure
  console.log('\n\nSample invoice structure:')
  console.log(JSON.stringify(invoices[0], null, 2))
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
