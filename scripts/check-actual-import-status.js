/**
 * Check ACTUAL import status by counting all unique invoice_id_jp values
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function check() {
  console.log('=== ACTUAL IMPORT STATUS ===\n')

  // Get ALL unique invoice_id_jp values with counts
  // Use RPC or manual pagination
  let allInvoiceIds = new Set()
  let offset = 0
  const batchSize = 1000

  console.log('Fetching all unique invoice_id_jp values...')

  while (true) {
    const { data, error } = await supabase
      .from('transactions')
      .select('invoice_id_jp')
      .not('invoice_id_jp', 'is', null)
      .range(offset, offset + batchSize - 1)

    if (error) {
      console.log('Error:', error)
      break
    }

    if (!data || data.length === 0) break

    data.forEach(r => allInvoiceIds.add(r.invoice_id_jp))
    offset += batchSize

    if (offset % 10000 === 0) {
      console.log(`  Processed ${offset} rows, ${allInvoiceIds.size} unique invoice IDs so far`)
    }
  }

  console.log(`\nTotal unique invoice_id_jp values: ${allInvoiceIds.size}`)

  // Get total count of transactions with invoice_id_jp
  const { count: totalMatched } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .not('invoice_id_jp', 'is', null)

  console.log(`Total transactions with invoice_id_jp: ${totalMatched}`)

  // Get total transactions
  const { count: total } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })

  console.log(`Total transactions: ${total}`)
  console.log(`Match rate: ${Math.round(totalMatched / total * 100)}%`)

  // Now count per invoice
  console.log('\n=== TRANSACTIONS PER INVOICE ===')

  // Get all invoices from invoices_jetpack
  const { data: invoices } = await supabase
    .from('invoices_jetpack')
    .select('id, invoice_number')
    .order('invoice_number')

  for (const inv of invoices || []) {
    const { count } = await supabase
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('invoice_id_jp', inv.id)

    if (count > 0) {
      console.log(`  ${inv.invoice_number}: ${count} transactions`)
    }
  }

  // Also check transactions with invoice_id_jp that DON'T match any invoice
  console.log('\n=== ORPHANED invoice_id_jp VALUES ===')
  const invoiceIds = new Set((invoices || []).map(i => i.id))
  const orphanedIds = [...allInvoiceIds].filter(id => !invoiceIds.has(id))

  if (orphanedIds.length > 0) {
    console.log(`Found ${orphanedIds.length} orphaned invoice IDs:`)
    orphanedIds.slice(0, 10).forEach(id => console.log(`  ${id}`))
  } else {
    console.log('No orphaned invoice IDs found')
  }
}

check().catch(console.error)
