#!/usr/bin/env node
/**
 * Investigate why Eli Health didn't get a draft invoice created
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  console.log('=== Investigating Eli Health Invoice Issue ===\n')

  // 1. Find Eli Health client
  const { data: clients, error: clientError } = await supabase
    .from('clients')
    .select('id, company_name, short_code')

  if (clientError) {
    console.error('Error fetching clients:', clientError)
    return
  }

  console.log('All clients:')
  clients.forEach(c => {
    console.log(`  - ${c.company_name} (${c.short_code}): ${c.id}`)
  })

  const eliHealth = clients.find(c => c.company_name.toLowerCase().includes('eli'))
  if (!eliHealth) {
    console.log('\nNo client found with "Eli" in name')
    return
  }

  console.log(`\n=== Eli Health Client ===`)
  console.log(`ID: ${eliHealth.id}`)
  console.log(`Short Code: ${eliHealth.short_code}`)

  // 2. Check for ShipBob invoices for this client
  console.log('\n=== ShipBob Invoices (invoices_sb) for Eli Health ===')
  const { data: sbInvoices, error: sbError } = await supabase
    .from('invoices_sb')
    .select('*')
    .eq('client_id', eliHealth.id)
    .order('invoice_date', { ascending: false })

  if (sbError) {
    console.error('Error fetching SB invoices:', sbError)
  } else if (sbInvoices.length === 0) {
    console.log('No ShipBob invoices found for Eli Health')
  } else {
    console.log(`Found ${sbInvoices.length} ShipBob invoices:`)
    sbInvoices.forEach(inv => {
      console.log(`  - #${inv.shipbob_invoice_id}: ${inv.invoice_date} - $${inv.total_amount} (${inv.invoice_type}) - JP: ${inv.jetpack_invoice_id || 'null'}`)
    })
  }

  // 3. Check for Jetpack invoices for this client
  console.log('\n=== Jetpack Invoices (invoices_jetpack) for Eli Health ===')
  const { data: jpInvoices, error: jpError } = await supabase
    .from('invoices_jetpack')
    .select('*')
    .eq('client_id', eliHealth.id)
    .order('created_at', { ascending: false })

  if (jpError) {
    console.error('Error fetching JP invoices:', jpError)
  } else if (jpInvoices.length === 0) {
    console.log('No Jetpack invoices found for Eli Health')
  } else {
    console.log(`Found ${jpInvoices.length} Jetpack invoices:`)
    jpInvoices.forEach(inv => {
      console.log(`  - ${inv.invoice_number}: ${inv.status} - $${inv.total_amount}`)
    })
  }

  // 4. Check for transactions for this client
  console.log('\n=== Transaction Count for Eli Health ===')
  const { count: txCount, error: txError } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', eliHealth.id)

  if (txError) {
    console.error('Error counting transactions:', txError)
  } else {
    console.log(`Total transactions: ${txCount}`)
  }

  // 5. Check for uninvoiced transactions
  console.log('\n=== Uninvoiced Transactions for Eli Health ===')
  const { count: uninvoicedCount, error: uninvError } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', eliHealth.id)
    .is('invoiced_status_jp', null)

  if (uninvError) {
    console.error('Error counting uninvoiced:', uninvError)
  } else {
    console.log(`Uninvoiced transactions: ${uninvoicedCount}`)
  }

  // 6. Check all pending ShipBob invoices (not yet processed)
  console.log('\n=== All Pending ShipBob Invoices (jetpack_invoice_id IS NULL, type != Payment) ===')
  const { data: pendingInvoices, error: pendingError } = await supabase
    .from('invoices_sb')
    .select('shipbob_invoice_id, client_id, invoice_date, total_amount, invoice_type')
    .is('jetpack_invoice_id', null)
    .neq('invoice_type', 'Payment')
    .order('invoice_date', { ascending: false })

  if (pendingError) {
    console.error('Error fetching pending invoices:', pendingError)
  } else {
    console.log(`Found ${pendingInvoices.length} pending ShipBob invoices:`)
    for (const inv of pendingInvoices) {
      const clientName = clients.find(c => c.id === inv.client_id)?.company_name || 'Unknown'
      console.log(`  - #${inv.shipbob_invoice_id}: ${clientName} - ${inv.invoice_date} - $${inv.total_amount} (${inv.invoice_type})`)
    }
  }

  // 7. Check markup rules for Eli Health
  console.log('\n=== Markup Rules for Eli Health ===')
  const { data: markupRules, error: markupError } = await supabase
    .from('markup_rules')
    .select('*')
    .eq('client_id', eliHealth.id)

  if (markupError) {
    console.error('Error fetching markup rules:', markupError)
  } else if (markupRules.length === 0) {
    console.log('No markup rules found for Eli Health - THIS COULD BE THE PROBLEM!')
  } else {
    console.log(`Found ${markupRules.length} markup rules`)
    markupRules.forEach(r => {
      console.log(`  - ${r.billing_table}: ${r.percentage}%`)
    })
  }
}

main().catch(console.error)
