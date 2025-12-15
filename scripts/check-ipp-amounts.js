#!/usr/bin/env node
/**
 * Check IPP transaction amounts to verify the invoice discrepancy
 */
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const HENSON_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

async function main() {
  // Get unprocessed invoice IDs
  const { data: invoices } = await supabase
    .from('invoices_sb')
    .select('shipbob_invoice_id')
    .is('jetpack_invoice_id', null)
    .neq('invoice_type', 'Payment')

  const invoiceIds = invoices
    .map(i => parseInt(i.shipbob_invoice_id, 10))
    .filter(id => Number.isFinite(id))

  console.log('Unprocessed ShipBob invoice IDs:', invoiceIds.join(', '))

  // Get IPP transactions for Henson in unprocessed invoices
  const { data: ippTx } = await supabase
    .from('transactions')
    .select('transaction_id, fee_type, reference_type, cost, billed_amount, invoice_id_sb, invoiced_status_jp')
    .eq('client_id', HENSON_ID)
    .eq('fee_type', 'Inventory Placement Program Fee')
    .in('invoice_id_sb', invoiceIds)

  console.log('\nIPP Transactions for Henson in unprocessed invoices:')
  let totalCost = 0
  for (const tx of ippTx || []) {
    console.log(`  ${tx.transaction_id}: cost=$${tx.cost}, invoice_id_sb=${tx.invoice_id_sb}, invoiced_jp=${tx.invoiced_status_jp}`)
    totalCost += tx.cost || 0
  }

  console.log(`\nTotal IPP cost: $${totalCost.toFixed(2)}`)

  // These transactions currently get 0% markup (in Receiving category)
  // They SHOULD get 10% markup (in Additional Services category)
  const missingMarkup = totalCost * 0.10
  console.log(`Missing 10% markup would add: $${missingMarkup.toFixed(2)}`)

  // Calculate expected vs actual
  const expected = 17751.94
  const actual = 17693.57
  const difference = expected - actual

  console.log(`\nExpected total: $${expected.toFixed(2)}`)
  console.log(`Actual generated: $${actual.toFixed(2)}`)
  console.log(`Difference: $${difference.toFixed(2)}`)

  // Does the missing markup explain the difference?
  const explained = Math.abs(missingMarkup - difference) < 1
  console.log(`\nDoes missing IPP markup explain difference? ${explained ? 'YES' : 'NO'}`)

  if (!explained) {
    console.log(`Gap: $${Math.abs(missingMarkup - difference).toFixed(2)}`)
  }

  // Now let's also look at other transactions missing markup
  console.log('\n\n--- Looking for other transactions with reference_type=WRO ---')
  const { data: wroTx } = await supabase
    .from('transactions')
    .select('transaction_id, fee_type, reference_type, cost, billed_amount, markup_percentage')
    .eq('client_id', HENSON_ID)
    .eq('reference_type', 'WRO')
    .in('invoice_id_sb', invoiceIds)

  console.log(`Found ${(wroTx || []).length} WRO transactions:`)
  for (const tx of wroTx || []) {
    console.log(`  ${tx.fee_type}: cost=$${tx.cost}, markup=${tx.markup_percentage}%`)
  }
}

main().catch(console.error)
