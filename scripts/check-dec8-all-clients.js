#!/usr/bin/env node
/**
 * Check ALL transactions on Dec 8 invoices, grouped by client
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

// Dec 8 invoice IDs
const invoiceIds = [8661966, 8661967, 8661968, 8661969]

async function main() {
  console.log('CHECKING ALL DEC 8 INVOICE TRANSACTIONS')
  console.log('Invoice IDs:', invoiceIds.join(', '))
  console.log('='.repeat(80))

  // Get all clients
  const { data: clients } = await supabase
    .from('clients')
    .select('id, name')

  const clientMap = new Map(clients?.map(c => [c.id, c.name]) || [])

  // Get ALL transactions on these invoices (paginated)
  const allTx = []
  let offset = 0
  const PAGE_SIZE = 1000

  while (true) {
    const { data: batch } = await supabase
      .from('transactions')
      .select('client_id, fee_type, reference_type, invoice_id_sb')
      .in('invoice_id_sb', invoiceIds)
      .range(offset, offset + PAGE_SIZE - 1)

    if (!batch || batch.length === 0) break
    allTx.push(...batch)
    if (batch.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  console.log(`\nTotal transactions on Dec 8 invoices: ${allTx.length}`)

  // Group by client
  const byClient = {}
  allTx.forEach(tx => {
    const clientName = clientMap.get(tx.client_id) || tx.client_id || 'NULL'
    if (!byClient[clientName]) byClient[clientName] = { total: 0, shipping: 0, byFeeType: {} }
    byClient[clientName].total++
    if (tx.fee_type === 'Shipping') byClient[clientName].shipping++
    byClient[clientName].byFeeType[tx.fee_type] = (byClient[clientName].byFeeType[tx.fee_type] || 0) + 1
  })

  console.log('\nBy client:')
  for (const [client, data] of Object.entries(byClient)) {
    console.log(`\n  ${client}:`)
    console.log(`    Total: ${data.total} | Shipping: ${data.shipping}`)
    console.log(`    By fee_type:`)
    for (const [type, count] of Object.entries(data.byFeeType)) {
      console.log(`      - ${type}: ${count}`)
    }
  }

  // Group by invoice
  const byInvoice = {}
  allTx.forEach(tx => {
    byInvoice[tx.invoice_id_sb] = (byInvoice[tx.invoice_id_sb] || 0) + 1
  })

  console.log('\n' + '='.repeat(80))
  console.log('By invoice_id_sb:')
  for (const [inv, count] of Object.entries(byInvoice).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    console.log(`  - ${inv}: ${count} transactions`)
  }

  // Check what other invoices exist for the Dec 8 period
  console.log('\n' + '='.repeat(80))
  console.log('All invoices_sb around Dec 8:')

  const { data: nearbyInvoices } = await supabase
    .from('invoices_sb')
    .select('shipbob_invoice_id, invoice_type, invoice_date, base_amount')
    .gte('invoice_date', '2025-12-01')
    .lte('invoice_date', '2025-12-15')
    .order('invoice_date')
    .order('shipbob_invoice_id')

  nearbyInvoices?.forEach(i => {
    const marker = invoiceIds.includes(i.shipbob_invoice_id) ? '  <-- Dec 8' : ''
    console.log(`  ${i.invoice_date} | ${i.shipbob_invoice_id} | ${i.invoice_type} | $${i.base_amount}${marker}`)
  })

  // Check clients table
  console.log('\n' + '='.repeat(80))
  console.log('All clients in database:')
  clients?.forEach(c => {
    console.log(`  - ${c.name} | ${c.id}`)
  })
}

main().catch(console.error)
