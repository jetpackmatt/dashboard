#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' })

async function check() {
  const token = process.env.SHIPBOB_API_TOKEN

  // Query for INVOICED transactions (older date range that should be invoiced)
  console.log('Checking invoiced transactions (Nov 10-17)...\n')

  const response1 = await fetch('https://api.shipbob.com/2025-07/transactions:query', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      start_date: '2025-11-10',
      end_date: '2025-11-17'
    })
  })

  const data1 = await response1.json()
  console.log(`Found ${data1.items?.length || 0} transactions from Nov 10-17`)

  // Group by charge_date and invoiced_status
  const stats = {}
  for (const tx of data1.items || []) {
    const key = tx.charge_date + '|' + (tx.invoiced_status ? 'invoiced' : 'pending')
    if (!stats[key]) {
      stats[key] = { date: tx.charge_date, invoiced: tx.invoiced_status, count: 0 }
    }
    stats[key].count++
  }

  console.log('\nBy date and invoice status:')
  console.log('─'.repeat(50))
  Object.values(stats)
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach(s => {
      const status = s.invoiced ? '✓ INVOICED' : '○ pending'
      console.log(`  ${s.date}: ${s.count.toString().padStart(4)} tx ${status}`)
    })

  // Now check recent (should be uninvoiced)
  console.log('\n\nChecking recent transactions (Nov 24-26)...\n')

  const response2 = await fetch('https://api.shipbob.com/2025-07/transactions:query', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      start_date: '2025-11-24',
      end_date: '2025-11-26'
    })
  })

  const data2 = await response2.json()
  console.log(`Found ${data2.items?.length || 0} transactions from Nov 24-26`)

  const stats2 = {}
  for (const tx of data2.items || []) {
    const key = tx.charge_date + '|' + (tx.invoiced_status ? 'invoiced' : 'pending')
    if (!stats2[key]) {
      stats2[key] = { date: tx.charge_date, invoiced: tx.invoiced_status, count: 0 }
    }
    stats2[key].count++
  }

  console.log('\nBy date and invoice status:')
  console.log('─'.repeat(50))
  Object.values(stats2)
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach(s => {
      const status = s.invoiced ? '✓ INVOICED' : '○ pending'
      console.log(`  ${s.date}: ${s.count.toString().padStart(4)} tx ${status}`)
    })
}

check()
