#!/usr/bin/env node
/**
 * Check what invoices Methyl-Life transactions are on
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://xhehiuanvcowiktcsmjr.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseServiceKey) {
  console.error('SUPABASE_SERVICE_ROLE_KEY not found')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

const METHYL_ID = 'a08be540-b912-4f74-a857-958b9f8e2cc5'

async function main() {
  console.log('CHECKING METHYL-LIFE INVOICES')
  console.log('='.repeat(80))

  // Check all Methyl-Life shipping transactions for Dec 1-14
  const { data: txns, error } = await supabase
    .from('transactions')
    .select('invoice_id_sb, charge_date, reference_id')
    .eq('client_id', METHYL_ID)
    .eq('fee_type', 'Shipping')
    .gte('charge_date', '2025-12-01')
    .lte('charge_date', '2025-12-14')
    .order('charge_date', { ascending: false })
    .limit(100)

  console.log(`\nMethyl-Life shipping transactions (Dec 1-14):`)
  console.log(`  Total found: ${txns?.length || 0}`)

  if (txns && txns.length > 0) {
    // Group by invoice_id_sb
    const byInvoice = {}
    txns.forEach(t => {
      const inv = t.invoice_id_sb || 'NULL'
      byInvoice[inv] = (byInvoice[inv] || 0) + 1
    })

    console.log('\n  By invoice_id_sb:')
    for (const [inv, count] of Object.entries(byInvoice)) {
      console.log(`    - ${inv}: ${count} transactions`)
    }

    // Get invoice details for these
    const invoiceIds = [...new Set(txns.filter(t => t.invoice_id_sb).map(t => t.invoice_id_sb))]
    if (invoiceIds.length > 0) {
      const { data: invoices } = await supabase
        .from('invoices_sb')
        .select('shipbob_invoice_id, invoice_date, invoice_type')
        .in('shipbob_invoice_id', invoiceIds)

      console.log('\n  Invoice details:')
      invoices?.forEach(i => {
        console.log(`    - ${i.shipbob_invoice_id} | ${i.invoice_date} | ${i.invoice_type}`)
      })
    }
  }

  // Also check what invoices are in invoices_sb for Dec 8
  console.log('\n' + '='.repeat(80))
  console.log('All invoices_sb for Dec 8, 2025:')

  const { data: dec8Invoices } = await supabase
    .from('invoices_sb')
    .select('shipbob_invoice_id, invoice_type, invoice_date, base_amount')
    .eq('invoice_date', '2025-12-08')
    .order('shipbob_invoice_id')

  dec8Invoices?.forEach(i => {
    console.log(`  - ${i.shipbob_invoice_id} | ${i.invoice_type} | $${i.base_amount}`)
  })

  // Check what the Dec 8 invoice IDs are for Methyl-Life
  console.log('\n' + '='.repeat(80))
  console.log('Methyl-Life transactions by invoice_id_sb (all time):')

  const { data: allMethylTx } = await supabase
    .from('transactions')
    .select('invoice_id_sb')
    .eq('client_id', METHYL_ID)
    .eq('fee_type', 'Shipping')
    .not('invoice_id_sb', 'is', null)

  const methylInvoices = {}
  allMethylTx?.forEach(t => {
    methylInvoices[t.invoice_id_sb] = (methylInvoices[t.invoice_id_sb] || 0) + 1
  })

  // Get details for these invoices
  const methylInvoiceIds = Object.keys(methylInvoices).map(Number)
  if (methylInvoiceIds.length > 0) {
    const { data: invoiceDetails } = await supabase
      .from('invoices_sb')
      .select('shipbob_invoice_id, invoice_date, invoice_type')
      .in('shipbob_invoice_id', methylInvoiceIds)
      .order('invoice_date', { ascending: false })
      .limit(10)

    console.log('  Recent invoices:')
    invoiceDetails?.forEach(i => {
      console.log(`    - ${i.shipbob_invoice_id} | ${i.invoice_date} | ${i.invoice_type} | ${methylInvoices[i.shipbob_invoice_id]} txns`)
    })
  }

  // Check total unprocessed Methyl-Life shipments (for upcoming invoice)
  console.log('\n' + '='.repeat(80))
  console.log('Methyl-Life unprocessed shipping transactions (no Jetpack invoice):')

  const { data: unprocessed } = await supabase
    .from('transactions')
    .select('transaction_id, invoice_id_sb, charge_date')
    .eq('client_id', METHYL_ID)
    .eq('fee_type', 'Shipping')
    .is('jetpack_invoice_id', null)
    .order('charge_date', { ascending: false })
    .limit(50)

  console.log(`  Total unprocessed: ${unprocessed?.length || 0}`)
  if (unprocessed && unprocessed.length > 0) {
    // Group by invoice_id_sb
    const byInv = {}
    unprocessed.forEach(t => {
      const inv = t.invoice_id_sb || 'NULL'
      byInv[inv] = (byInv[inv] || 0) + 1
    })

    console.log('  By invoice_id_sb:')
    for (const [inv, count] of Object.entries(byInv)) {
      console.log(`    - ${inv}: ${count} transactions`)
    }
  }
}

main().catch(console.error)
