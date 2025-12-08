/**
 * Reset wrongly generated invoices (JPHS-0038 and JPML-0022)
 *
 * This script:
 * 1. Deletes the invoice records
 * 2. Deletes associated files from storage
 * 3. Resets next_invoice_number on clients
 * 4. Clears invoice_id from any marked transactions
 *
 * Usage: node scripts/reset-wrong-invoices.js
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const WRONG_INVOICES = [
  { id: '09d63b6e-6f36-4cd5-9ae3-d16b5c3f1590', number: 'JPML-0022-120825', clientId: 'ca33dd0e-bd81-4ff7-88d1-18a3caf81d8e', resetTo: 22 },
  { id: '8669e0cf-40d6-453f-be5e-b5405ca3e238', number: 'JPHS-0038-120825', clientId: '6b94c274-0446-4167-9d02-b998f8be59ad', resetTo: 38 },
]

async function main() {
  console.log('='.repeat(60))
  console.log('RESET: Deleting wrongly generated invoices')
  console.log('='.repeat(60))

  for (const inv of WRONG_INVOICES) {
    console.log(`\nProcessing ${inv.number}...`)

    // 1. Clear invoice_id from transactions that were marked
    console.log('  1. Clearing invoice_id from transactions...')
    const { data: txUpdated, error: txError } = await supabase
      .from('transactions')
      .update({ invoice_id: null })
      .eq('invoice_id', inv.id)
      .select('id')

    if (txError) {
      console.log(`     Error: ${txError.message}`)
    } else {
      console.log(`     Cleared ${txUpdated?.length || 0} transactions`)
    }

    // 2. Delete files from storage
    console.log('  2. Deleting files from storage...')
    const filePatterns = [
      `invoices/${inv.clientId}/${inv.number}.xlsx`,
      `invoices/${inv.clientId}/${inv.number}.pdf`,
    ]
    for (const filePath of filePatterns) {
      const { error: storageError } = await supabase.storage
        .from('billing')
        .remove([filePath])
      if (storageError) {
        console.log(`     Could not delete ${filePath}: ${storageError.message}`)
      } else {
        console.log(`     Deleted ${filePath}`)
      }
    }

    // 3. Delete invoice record
    console.log('  3. Deleting invoice record...')
    const { error: delError } = await supabase
      .from('invoices_jetpack')
      .delete()
      .eq('id', inv.id)

    if (delError) {
      console.log(`     Error: ${delError.message}`)
    } else {
      console.log(`     Deleted invoice ${inv.number}`)
    }

    // 4. Reset next_invoice_number
    console.log(`  4. Resetting next_invoice_number to ${inv.resetTo}...`)
    const { error: resetError } = await supabase
      .from('clients')
      .update({ next_invoice_number: inv.resetTo })
      .eq('id', inv.clientId)

    if (resetError) {
      console.log(`     Error: ${resetError.message}`)
    } else {
      console.log(`     Reset complete`)
    }
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log('COMPLETE')
  console.log('='.repeat(60))
}

main().catch(console.error)
