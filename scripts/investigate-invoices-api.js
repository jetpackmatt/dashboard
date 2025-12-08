/**
 * Exhaustive investigation of ShipBob Invoices API
 * Goal: Find ALL historical invoices, not just recent ones
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  const token = process.env.SHIPBOB_API_TOKEN

  console.log('='.repeat(70))
  console.log('EXHAUSTIVE INVOICES API INVESTIGATION')
  console.log('='.repeat(70))

  // Get all client channels
  const { data: clients } = await supabase
    .from('clients')
    .select('id, company_name, shipbob_channel_id, client_api_credentials(api_token, provider)')

  console.log('\n1. Testing with master token + different channel IDs...')

  for (const client of clients || []) {
    if (!client.shipbob_channel_id) continue

    const res = await fetch('https://api.shipbob.com/1.0/invoices?PageSize=100', {
      headers: {
        Authorization: `Bearer ${token}`,
        'shipbob-channel-id': String(client.shipbob_channel_id)
      }
    })

    if (res.ok) {
      const data = await res.json()
      console.log(`  ${client.company_name} (channel ${client.shipbob_channel_id}): ${data.length || 0} invoices`)
    } else {
      console.log(`  ${client.company_name} (channel ${client.shipbob_channel_id}): HTTP ${res.status}`)
    }
  }

  // Test specific date ranges
  console.log('\n2. Testing specific date ranges with master token...')

  const dateRanges = [
    { from: '2024-01-01', to: '2024-03-31', label: '2024 Q1' },
    { from: '2024-04-01', to: '2024-06-30', label: '2024 Q2' },
    { from: '2024-07-01', to: '2024-09-30', label: '2024 Q3' },
    { from: '2024-10-01', to: '2024-12-31', label: '2024 Q4' },
    { from: '2025-01-01', to: '2025-03-31', label: '2025 Q1' },
    { from: '2025-04-01', to: '2025-06-30', label: '2025 Q2' },
    { from: '2025-07-01', to: '2025-09-30', label: '2025 Q3' },
    { from: '2025-10-01', to: '2025-12-31', label: '2025 Q4' },
  ]

  for (const range of dateRanges) {
    const res = await fetch(
      `https://api.shipbob.com/1.0/invoices?PageSize=100&StartDate=${range.from}&EndDate=${range.to}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )

    if (res.ok) {
      const data = await res.json()
      console.log(`  ${range.label}: ${data.length || 0} invoices`)
    } else {
      console.log(`  ${range.label}: HTTP ${res.status}`)
    }
  }

  // Test without any date filter
  console.log('\n3. Testing WITHOUT any date filters (raw endpoint)...')

  const rawRes = await fetch('https://api.shipbob.com/1.0/invoices?PageSize=1000', {
    headers: { Authorization: `Bearer ${token}` }
  })

  if (rawRes.ok) {
    const data = await rawRes.json()
    console.log(`  Raw endpoint: ${data.length} invoices`)

    if (data.length > 0) {
      // Sort by date to see range
      const sorted = data.sort((a, b) => new Date(a.invoice_date) - new Date(b.invoice_date))
      console.log(`  Oldest: ${sorted[0].invoice_date} (${sorted[0].invoice_type})`)
      console.log(`  Newest: ${sorted[sorted.length - 1].invoice_date} (${sorted[sorted.length - 1].invoice_type})`)
    }
  }

  // Test API versions
  console.log('\n4. Testing different API versions...')

  const versions = ['1.0', '2025-07']

  for (const version of versions) {
    const res = await fetch(`https://api.shipbob.com/${version}/invoices?PageSize=100`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    console.log(`  v${version}: HTTP ${res.status}`)

    if (res.ok) {
      const data = await res.json()
      console.log(`    → ${data.length || 0} invoices`)
    }
  }

  // Test billing-related endpoints
  console.log('\n5. Testing alternative billing endpoints...')

  const endpoints = [
    '/billing/summary',
    '/billing/transactions',
    '/billing/charges',
    '/billing/statements',
    '/account/billing',
    '/account/invoices',
  ]

  for (const endpoint of endpoints) {
    const res = await fetch(`https://api.shipbob.com/1.0${endpoint}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    console.log(`  ${endpoint}: HTTP ${res.status}`)

    if (res.ok) {
      const text = await res.text()
      console.log(`    → ${text.substring(0, 100)}...`)
    }
  }

  // Look at what invoices we actually have
  console.log('\n6. Analyzing the 28 invoices we found...')

  const allRes = await fetch('https://api.shipbob.com/1.0/invoices?PageSize=100', {
    headers: { Authorization: `Bearer ${token}` }
  })

  if (allRes.ok) {
    const invoices = await allRes.json()

    // Group by type
    const byType = {}
    const byPeriod = {}

    for (const inv of invoices) {
      byType[inv.invoice_type] = (byType[inv.invoice_type] || 0) + 1

      // Group by period_start (billing week)
      const period = inv.period_start?.substring(0, 10) || 'unknown'
      byPeriod[period] = (byPeriod[period] || 0) + 1
    }

    console.log('\n  By Type:')
    for (const [type, count] of Object.entries(byType)) {
      console.log(`    ${type}: ${count}`)
    }

    console.log('\n  By Period Start:')
    const periods = Object.entries(byPeriod).sort((a, b) => a[0].localeCompare(b[0]))
    for (const [period, count] of periods) {
      console.log(`    ${period}: ${count} invoices`)
    }
  }

  console.log('\n' + '='.repeat(70))
  console.log('CONCLUSION')
  console.log('='.repeat(70))
  console.log('If we only get ~28 invoices and they\'re all from Nov-Dec 2025,')
  console.log('the ShipBob API may have a retention limit or this is a new account.')
  console.log('')
  console.log('Options for historical data:')
  console.log('1. Contact ShipBob support about historical invoice access')
  console.log('2. Export invoices manually from ShipBob web portal')
  console.log('3. Use the XLSX files you have for historical data import')
}

main().catch(console.error)
