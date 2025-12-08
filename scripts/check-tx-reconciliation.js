/**
 * Check transaction data for reconciliation with invoices
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  // Check total transaction count in DB
  const { count: totalCount } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })

  console.log('Total transactions in entire DB:', totalCount)

  // Check date range of transactions we have
  const { data: oldest } = await supabase
    .from('transactions')
    .select('charge_date')
    .order('charge_date', { ascending: true })
    .limit(1)

  const { data: newest } = await supabase
    .from('transactions')
    .select('charge_date')
    .order('charge_date', { ascending: false })
    .limit(1)

  console.log('Date range:', oldest?.[0]?.charge_date, 'to', newest?.[0]?.charge_date)

  // Check transactions for Nov 24-30 period
  const periodStart = '2025-11-24'
  const periodEnd = '2025-11-30'

  const { data: periodTx, count: periodCount } = await supabase
    .from('transactions')
    .select('*', { count: 'exact' })
    .gte('charge_date', periodStart)
    .lte('charge_date', periodEnd)

  console.log('\n\nTransactions in period', periodStart, 'to', periodEnd + ':', periodCount)

  if (periodTx && periodTx.length > 0) {
    console.log('\nSample transaction:')
    console.log(JSON.stringify(periodTx[0], null, 2))

    // Group by transaction_fee
    const byFee = {}
    for (const tx of periodTx) {
      const fee = tx.transaction_fee || 'NULL'
      if (!byFee[fee]) byFee[fee] = { count: 0, total: 0 }
      byFee[fee].count++
      byFee[fee].total += Number(tx.amount || 0)
    }

    console.log('\nBy transaction_fee:')
    const sorted = Object.entries(byFee).sort((a, b) => b[1].total - a[1].total)
    for (const [fee, data] of sorted) {
      console.log('  ' + fee.padEnd(35) + ' ' + String(data.count).padStart(5) + ' tx  $' + data.total.toFixed(2))
    }
  }

  // Check which tables have billing data
  console.log('\n\n' + '='.repeat(70))
  console.log('CHECKING OTHER BILLING TABLES')
  console.log('='.repeat(70))

  // Check billing_storage
  const { count: storageCount } = await supabase
    .from('billing_storage')
    .select('*', { count: 'exact', head: true })
  console.log('\nbilling_storage records:', storageCount)

  // Check billing_receiving
  const { count: receivingCount } = await supabase
    .from('billing_receiving')
    .select('*', { count: 'exact', head: true })
  console.log('billing_receiving records:', receivingCount)

  // Check shipments (with shipping costs)
  const { count: shipmentsCount } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
  console.log('shipments records:', shipmentsCount)

  // Check shipments for period
  const { data: periodShip, count: periodShipCount } = await supabase
    .from('shipments')
    .select('id, ship_date, shipping_method, cost_total, carrier_name', { count: 'exact' })
    .gte('ship_date', periodStart)
    .lte('ship_date', periodEnd)
    .limit(10)

  console.log('\nShipments in period:', periodShipCount)

  if (periodShip && periodShip.length > 0) {
    // Sum costs
    const { data: allPeriodShip } = await supabase
      .from('shipments')
      .select('cost_total')
      .gte('ship_date', periodStart)
      .lte('ship_date', periodEnd)

    const shipTotal = (allPeriodShip || []).reduce((s, sh) => s + Number(sh.cost_total || 0), 0)
    console.log('Total shipping cost in period: $' + shipTotal.toFixed(2))

    console.log('\nSample shipments:')
    for (const sh of periodShip.slice(0, 5)) {
      console.log('  ' + sh.ship_date + ' | ' + (sh.carrier_name || 'N/A').padEnd(15) + ' | $' + Number(sh.cost_total || 0).toFixed(2))
    }
  }

  // Check what columns shipments has for costs
  const { data: shipSample } = await supabase
    .from('shipments')
    .select('*')
    .not('cost_total', 'is', null)
    .limit(1)

  if (shipSample && shipSample[0]) {
    const cols = Object.keys(shipSample[0]).filter(k => k.includes('cost') || k.includes('price'))
    console.log('\nShipment cost columns:', cols.join(', '))
  }
}

main().catch(console.error)
