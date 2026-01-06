#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' })

async function test() {
  const token = process.env.SHIPBOB_API_TOKEN

  // Get list of invoices first
  console.log('Fetching invoices...')

  // Note: URL is /{version}/endpoint, not /2.0/endpoint with version header
  const invResponse = await fetch('https://api.shipbob.com/2025-07/invoices?StartDate=2025-12-01&PageSize=20', {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  })

  if (invResponse.status !== 200) {
    console.log('Invoice list error:', invResponse.status)
    return
  }

  const invData = await invResponse.json()
  console.log('Invoices found:', invData.items?.length || invData.length)

  const invoices = invData.items || invData
  for (const inv of invoices.slice(0, 15)) {
    console.log('  ', inv.invoice_id, inv.invoice_type, inv.invoice_date, '$' + inv.amount)
  }

  // Find invoice 8730385 specifically
  const target = invoices.find(i => i.invoice_id === 8730385)
  console.log('\nLooking for invoice 8730385:', target ? 'FOUND' : 'NOT FOUND')

  // Try to get transactions for the Shipping invoice (should be 8730385)
  const shippingInvoice = invoices.find(i => i.invoice_type === 'Shipping')
  if (shippingInvoice) {
    console.log('\nTrying Shipping invoice:', shippingInvoice.invoice_id)

    const txResponse = await fetch(`https://api.shipbob.com/2025-07/invoices/${shippingInvoice.invoice_id}/transactions?PageSize=100`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    })

    console.log('Status:', txResponse.status)
    if (txResponse.status === 200) {
      const txData = await txResponse.json()
      const items = txData.items || txData
      console.log('Transactions:', items.length)
      if (items.length > 0) {
        console.log('Sample:', JSON.stringify(items[0], null, 2).substring(0, 500))
      }
    } else {
      console.log('Error:', await txResponse.text())
    }
  }
}

test().catch(console.error)
