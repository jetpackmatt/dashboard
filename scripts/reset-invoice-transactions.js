#!/usr/bin/env node
/**
 * Reset invoiced_status_jp for a specific invoice so it can be regenerated
 *
 * Usage: node scripts/reset-invoice-transactions.js JPEH-0005-011226
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  const invoiceNumber = process.argv[2] || 'JPEH-0005-011226'

  console.log(`Resetting transactions for invoice: ${invoiceNumber}`)

  // First, find the invoice to get client_id and verify it exists
  const { data: invoice, error: invoiceError } = await supabase
    .from('invoices_jetpack')
    .select('id, invoice_number, client_id, status, shipbob_invoice_ids')
    .eq('invoice_number', invoiceNumber)
    .single()

  if (invoiceError || !invoice) {
    console.error('Invoice not found:', invoiceError?.message)
    process.exit(1)
  }

  console.log('Found invoice:', invoice)

  if (invoice.status !== 'draft') {
    console.error(`Invoice is ${invoice.status}, not draft. Please reset status first.`)
    process.exit(1)
  }

  // Count transactions that will be affected
  const { count, error: countError } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', invoice.client_id)
    .eq('invoice_id_jp', invoiceNumber)

  if (countError) {
    console.error('Error counting transactions:', countError.message)
    process.exit(1)
  }

  console.log(`Will reset ${count} transactions linked to ${invoiceNumber}`)

  // Reset the transactions
  const { data, error } = await supabase
    .from('transactions')
    .update({
      invoiced_status_jp: false,
      invoice_id_jp: null
    })
    .eq('client_id', invoice.client_id)
    .eq('invoice_id_jp', invoiceNumber)
    .select('transaction_id')

  if (error) {
    console.error('Error resetting transactions:', error.message)
    process.exit(1)
  }

  console.log(`Successfully reset ${data.length} transactions`)
  console.log('Invoice can now be regenerated via the dashboard')
}

main().catch(console.error)
