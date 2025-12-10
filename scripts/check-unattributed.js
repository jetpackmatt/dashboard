require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function main() {
  // First just get count
  const { count: nullCount } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .is('merchant_id', null)

  console.log('Transactions with merchant_id IS NULL:', nullCount)

  // Then get actual data - use * to see all columns
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .is('merchant_id', null)
    .order('charge_date', { ascending: false })
    .limit(60)

  if (error) {
    console.log('Error:', error)
    return
  }

  console.log('Returned rows:', data?.length)

  if (data && data.length > 0) {
    // Show what columns exist
    console.log('\nColumns in first row:', Object.keys(data[0]).join(', '))
  }
  console.log('')

  // Group by reference_type and fee_type (or whatever columns exist)
  const byType = {}
  for (const t of data || []) {
    const feeType = t.fee_type || t.transaction_fee || 'unknown'
    const key = t.reference_type + ' / ' + feeType
    if (!byType[key]) byType[key] = { count: 0, cost: 0, merchantIds: new Set() }
    byType[key].count++
    byType[key].cost += parseFloat(t.cost || 0)
    if (t.shipbob_merchant_id) byType[key].merchantIds.add(t.shipbob_merchant_id)
  }

  console.log('By type:')
  for (const [key, info] of Object.entries(byType).sort((a,b) => b[1].count - a[1].count)) {
    console.log('  ' + key + ': ' + info.count + ' (total: $' + info.cost.toFixed(2) + ')')
    if (info.merchantIds.size > 0) {
      console.log('    shipbob_merchant_ids: ' + [...info.merchantIds].join(', '))
    }
  }

  console.log('')
  console.log('Sample transactions:')
  for (const t of (data || []).slice(0, 20)) {
    const feeType = t.fee_type || t.transaction_fee || 'unknown'
    console.log('  ' + t.transaction_id + ' | ' + t.reference_type + ' | ' + feeType + ' | $' + t.cost + ' | sb_merchant:' + t.shipbob_merchant_id + ' | invoice:' + t.invoice_id_sb)
  }

  // Check if these merchants exist in clients table
  const merchantIds = [...new Set((data || []).map(t => t.shipbob_merchant_id).filter(Boolean))]
  if (merchantIds.length > 0) {
    console.log('\n\nChecking if these merchants exist in clients table...')
    const { data: clients } = await supabase
      .from('clients')
      .select('id, company_name, merchant_id')
      .in('merchant_id', merchantIds)

    console.log('Found clients:', clients?.length || 0)
    for (const c of clients || []) {
      console.log('  ' + c.merchant_id + ' -> ' + c.company_name)
    }

    const foundIds = new Set((clients || []).map(c => c.merchant_id))
    const missing = merchantIds.filter(id => !foundIds.has(id))
    if (missing.length > 0) {
      console.log('\nMerchants NOT in clients table:', missing.join(', '))
    }
  }
}
main().catch(console.error)
