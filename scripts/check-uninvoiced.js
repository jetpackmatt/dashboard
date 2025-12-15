#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  console.log('=== Checking uninvoiced transactions by client ===\n')

  const clients = [
    { id: '6b94c274-0446-4167-9d02-b998f8be59ad', name: 'Henson' },
    { id: 'ca33dd0e-bd81-4ff7-88d1-18a3caf81d8e', name: 'Methyl-Life' },
    { id: 'e6220921-695e-41f9-9f49-af3e0cdc828a', name: 'Eli Health' },
  ]

  for (const client of clients) {
    // Get COUNT of uninvoiced transactions
    const { count: uninvoicedCount, error } = await supabase
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', client.id)
      .eq('invoiced_status_jp', false)

    // Get COUNT of invoiced transactions
    const { count: invoicedCount } = await supabase
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', client.id)
      .eq('invoiced_status_jp', true)

    console.log(`${client.name}:`)
    console.log(`  Uninvoiced (invoiced_status_jp=false): ${uninvoicedCount}`)
    console.log(`  Invoiced (invoiced_status_jp=true): ${invoicedCount}`)
    console.log()
  }

  // Eli Health transaction details
  console.log('=== Eli Health transaction details ===')
  const { data: eliTxs } = await supabase
    .from('transactions')
    .select('transaction_id, fee_type, invoice_id_sb, invoiced_status_jp, invoice_id_jp')
    .eq('client_id', 'e6220921-695e-41f9-9f49-af3e0cdc828a')

  if (eliTxs) {
    eliTxs.forEach(tx => {
      console.log(`${tx.transaction_id}: ${tx.fee_type}`)
      console.log(`  invoice_id_sb: ${tx.invoice_id_sb}, invoiced_status_jp: ${tx.invoiced_status_jp}, invoice_id_jp: ${tx.invoice_id_jp}`)
    })
  }
}

main().catch(console.error)
