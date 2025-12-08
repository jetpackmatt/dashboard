/**
 * Count unique invoice IDs in transactions
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  console.log('Counting invoice IDs in transactions...\n')

  // Paginated fetch of all invoice_id_sb values
  const uniqueIds = new Set()
  let withId = 0
  let withoutId = 0
  let offset = 0
  const batchSize = 10000

  while (true) {
    const { data, error } = await supabase
      .from('transactions')
      .select('invoice_id_sb')
      .range(offset, offset + batchSize - 1)

    if (error) {
      console.error('Error:', error)
      break
    }
    if (!data || data.length === 0) break

    for (const row of data) {
      if (row.invoice_id_sb) {
        uniqueIds.add(row.invoice_id_sb)
        withId++
      } else {
        withoutId++
      }
    }

    offset += data.length
    process.stdout.write(`\rProcessed ${offset} transactions...`)

    if (data.length < batchSize) break
  }

  console.log('\n')
  console.log('Total transactions:', withId + withoutId)
  console.log('With invoice_id_sb:', withId)
  console.log('Without invoice_id_sb:', withoutId)
  console.log('Unique invoice IDs:', uniqueIds.size)

  // Get invoices from invoices_sb
  const { data: invoices } = await supabase
    .from('invoices_sb')
    .select('shipbob_invoice_id, invoice_type, invoice_date, base_amount')
    .order('invoice_date', { ascending: false })

  console.log('\nInvoices in invoices_sb:', invoices?.length)

  // Check which invoices have transactions
  const invoiceIds = new Set(invoices?.map(i => i.shipbob_invoice_id) || [])

  let matched = 0
  let unmatched = 0
  const unmatchedList = []

  for (const inv of invoices || []) {
    if (uniqueIds.has(inv.shipbob_invoice_id)) {
      matched++
    } else {
      unmatched++
      if (unmatchedList.length < 30) {
        unmatchedList.push(inv)
      }
    }
  }

  console.log('\nInvoices WITH transactions linked:', matched)
  console.log('Invoices WITHOUT transactions linked:', unmatched)

  if (unmatchedList.length > 0) {
    console.log('\nSample unmatched invoices:')
    for (const inv of unmatchedList) {
      console.log(`  ${inv.shipbob_invoice_id} | ${inv.invoice_type.padEnd(20)} | ${inv.invoice_date} | $${Number(inv.base_amount).toFixed(2)}`)
    }
  }

  // Show transaction invoice_ids that are NOT in invoices_sb
  const txInvoiceIds = [...uniqueIds]
  const orphanIds = txInvoiceIds.filter(id => !invoiceIds.has(id))

  if (orphanIds.length > 0) {
    console.log('\nTransaction invoice_ids NOT in invoices_sb:', orphanIds.length)
    console.log('  Sample:', orphanIds.slice(0, 10).join(', '))
  }
}

main().catch(console.error)
