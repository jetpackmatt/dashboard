/**
 * Check invoice metadata to see if we have billing period dates
 * that could be used to derive per-day storage dates
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  // Storage invoice ID from JPHS-0037
  const storageInvoiceId = 8633618

  console.log('='.repeat(70))
  console.log('CHECKING STORAGE INVOICE BILLING PERIOD')
  console.log('='.repeat(70))

  // Check invoices_sb table
  const { data: invoiceSb, error: err1 } = await supabase
    .from('invoices_sb')
    .select('*')
    .eq('shipbob_invoice_id', String(storageInvoiceId))
    .single()

  if (invoiceSb) {
    console.log('\n--- invoices_sb record ---')
    console.log(JSON.stringify(invoiceSb, null, 2))
  } else {
    console.log('\nNot found in invoices_sb:', err1?.message)
  }

  // Also check if there's period info on transactions
  const { data: sampleTx } = await supabase
    .from('transactions')
    .select('*')
    .eq('invoice_id_sb', storageInvoiceId)
    .eq('reference_type', 'FC')
    .limit(1)
    .single()

  if (sampleTx) {
    console.log('\n--- Sample storage transaction ---')
    console.log('transaction_id:', sampleTx.transaction_id)
    console.log('charge_date:', sampleTx.charge_date)
    console.log('invoice_date:', sampleTx.invoice_date)
    console.log('additional_details:', JSON.stringify(sampleTx.additional_details, null, 2))

    // Check all columns
    console.log('\n--- All transaction columns with values ---')
    for (const [key, val] of Object.entries(sampleTx)) {
      if (val !== null && val !== undefined) {
        console.log(`  ${key}: ${typeof val === 'object' ? JSON.stringify(val) : val}`)
      }
    }
  }

  // Check the API directly for period info
  const token = process.env.SHIPBOB_API_TOKEN
  if (!token) {
    console.log('\nNo SHIPBOB_API_TOKEN to check API')
    return
  }

  console.log('\n--- Checking ShipBob Invoice API ---')
  const response = await fetch(`https://api.shipbob.com/2025-07/invoices/${storageInvoiceId}`, {
    headers: { Authorization: `Bearer ${token}` }
  })

  if (response.ok) {
    const invoice = await response.json()
    console.log('Invoice from API:')
    console.log(JSON.stringify(invoice, null, 2))
  } else {
    console.log(`API Error: ${response.status}`)
  }
}

main().catch(console.error)
