/**
 * Check how many transactions have invoice_id_jp set after import
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function check() {
  console.log('=== TRANSACTION INVOICE MATCHING STATUS ===\n')

  // Count by transaction_fee type - with and without invoice_id_jp
  const types = [
    'Shipping',
    'Shipping Zone',
    'Dimensional Shipping Upgrade',
    'Per Pick Fee',
    'Kitting Fee',
    'Box Fee',
    'Storage Removal Fee',
    'Returns',
    'Receiving',
    'Storage',
    'Credit',
    'Credit Card Processing Fee'
  ]

  const results = []

  for (const fee of types) {
    const { count: total } = await supabase
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('transaction_fee', fee)

    if (total > 0) {
      const { count: matched } = await supabase
        .from('transactions')
        .select('*', { count: 'exact', head: true })
        .eq('transaction_fee', fee)
        .not('invoice_id_jp', 'is', null)

      results.push({
        type: fee,
        total,
        matched: matched || 0,
        pct: Math.round((matched || 0) / total * 100)
      })
    }
  }

  // Display results
  console.log('Type'.padEnd(30) + 'Matched'.padStart(10) + 'Total'.padStart(10) + 'Pct'.padStart(8))
  console.log('-'.repeat(58))
  for (const r of results) {
    console.log(r.type.padEnd(30) + String(r.matched).padStart(10) + String(r.total).padStart(10) + (r.pct + '%').padStart(8))
  }

  // Check which invoice_id_jp values exist
  console.log('\n=== UNIQUE invoice_id_jp VALUES ===')
  const { data: invoiceIds } = await supabase
    .from('transactions')
    .select('invoice_id_jp')
    .not('invoice_id_jp', 'is', null)
    .limit(1000)

  const unique = [...new Set(invoiceIds?.map(r => r.invoice_id_jp) || [])]
  console.log('Count:', unique.length)
  console.log('Sample:', unique.slice(0, 20))

  // Check invoices_sb for jetpack invoice IDs
  console.log('\n=== INVOICES_SB with Jetpack IDs ===')
  const { data: invoices } = await supabase
    .from('invoices_sb')
    .select('jetpack_invoice_id, period_start, period_end, invoice_type')
    .like('jetpack_invoice_id', 'JP%')
    .order('period_start')
    .limit(20)

  if (invoices) {
    console.log('Count:', invoices.length)
    invoices.forEach(inv => {
      console.log(`  ${inv.jetpack_invoice_id}: ${inv.period_start?.slice(0,10)} to ${inv.period_end?.slice(0,10)} (${inv.invoice_type})`)
    })
  }
}

check().catch(console.error)
