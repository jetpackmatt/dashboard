/**
 * Check which invoices have linked transactions
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function check() {
  // Get all distinct invoice_id_jp with counts
  const { data: txWithInv } = await supabase
    .from('transactions')
    .select('invoice_id_jp')
    .not('invoice_id_jp', 'is', null)
    .limit(200000)

  const invCounts = {}
  txWithInv?.forEach(t => {
    invCounts[t.invoice_id_jp] = (invCounts[t.invoice_id_jp] || 0) + 1
  })

  console.log('Invoices with transactions:', Object.keys(invCounts).length)

  // Look up invoice numbers
  const invIds = Object.keys(invCounts)
  const { data: invoices } = await supabase
    .from('invoices_jetpack')
    .select('id, invoice_number')
    .in('id', invIds)

  const invMap = {}
  invoices?.forEach(i => invMap[i.id] = i.invoice_number)

  console.log('\nInvoices with linked transactions:')
  Object.entries(invCounts)
    .sort((a,b) => b[1] - a[1])
    .forEach(([id, count]) => {
      console.log(`  ${invMap[id] || id}: ${count} transactions`)
    })

  // Check which invoices DON'T have transactions
  const { data: allInvoices } = await supabase
    .from('invoices_jetpack')
    .select('id, invoice_number')
    .order('invoice_number')

  const withoutTx = allInvoices?.filter(i => !invCounts[i.id])
  console.log('\nInvoices WITHOUT linked transactions:', withoutTx?.length)
  withoutTx?.slice(0, 50).forEach(i => console.log(`  ${i.invoice_number}`))
}

check().catch(console.error)
