#!/usr/bin/env node
/**
 * Check database schema for invoice migration
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  console.log('=== Checking Database Schema ===\n')

  // 1. Check invoice tables
  console.log('1. Invoice Tables:')
  const invoiceTables = ['invoices', 'invoices_sb', 'invoices_shipbob', 'invoices_jetpack', 'invoices_jetpack_line_items']
  for (const table of invoiceTables) {
    const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true })
    if (!error) {
      console.log(`   - ${table}: ${count} rows`)
    }
  }

  // 2. Check clients table columns
  console.log('\n2. Clients Table - Billing Columns:')
  const { data: client } = await supabase.from('clients').select('*').limit(1).single()
  if (client) {
    const billingCols = ['short_code', 'billing_period', 'billing_terms', 'next_invoice_number', 'billing_email', 'invoice_email_note']
    for (const col of billingCols) {
      console.log(`   - ${col}: ${client[col] !== undefined ? `exists (value: ${client[col]})` : 'MISSING'}`)
    }
  }

  // 3. Check billing_shipments columns
  console.log('\n3. billing_shipments - Markup Columns:')
  const { data: shipment } = await supabase.from('billing_shipments').select('*').limit(1).single()
  if (shipment) {
    const markupCols = ['billed_amount', 'markup_rule_id', 'markup_percentage']
    for (const col of markupCols) {
      console.log(`   - ${col}: ${shipment[col] !== undefined ? 'exists' : 'MISSING'}`)
    }
  }

  // 4. Check invoices_sb structure
  console.log('\n4. invoices_sb Sample (first row):')
  const { data: sbInvoice } = await supabase.from('invoices_sb').select('*').limit(1).single()
  if (sbInvoice) {
    console.log('   Columns:', Object.keys(sbInvoice).join(', '))
    console.log('   Sample:', JSON.stringify(sbInvoice, null, 2).substring(0, 500))
  }

  // 5. Check invoices_shipbob if different
  console.log('\n5. invoices_shipbob Sample (first row):')
  const { data: shipbobInvoice, error: shipbobErr } = await supabase.from('invoices_shipbob').select('*').limit(1).single()
  if (shipbobErr) {
    console.log('   Table does not exist or is empty')
  } else if (shipbobInvoice) {
    console.log('   Columns:', Object.keys(shipbobInvoice).join(', '))
  }

  // 6. Check markup_rules and markup_rule_history
  console.log('\n6. Markup Tables:')
  const { count: rulesCount } = await supabase.from('markup_rules').select('*', { count: 'exact', head: true })
  const { count: historyCount, error: histErr } = await supabase.from('markup_rule_history').select('*', { count: 'exact', head: true })
  console.log(`   - markup_rules: ${rulesCount} rows`)
  console.log(`   - markup_rule_history: ${histErr ? 'MISSING' : `${historyCount} rows`}`)

  // 7. Check Supabase Storage buckets
  console.log('\n7. Storage Buckets:')
  const { data: buckets } = await supabase.storage.listBuckets()
  if (buckets) {
    buckets.forEach(b => console.log(`   - ${b.name}`))
    if (!buckets.find(b => b.name === 'invoices')) {
      console.log('   NOTE: "invoices" bucket does NOT exist')
    }
  }

  // 8. Check invoice numbers on billing tables
  console.log('\n8. Sample Invoice Numbers (billing_shipments):')
  const { data: invoiceNums } = await supabase
    .from('billing_shipments')
    .select('invoice_number')
    .not('invoice_number', 'is', null)
    .limit(5)
  if (invoiceNums) {
    console.log('   Recent invoice numbers:', invoiceNums.map(r => r.invoice_number).join(', '))
  }
}

main().catch(console.error)
