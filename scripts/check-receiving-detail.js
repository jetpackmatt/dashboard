#!/usr/bin/env node
/**
 * Check receiving (WRO) transactions in detail
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

// Client IDs
const HENSON_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'
const METHYL_ID = 'ca33dd0e-bd81-4ff7-88d1-18a3caf81d8e'

// Dec 8 invoice IDs
const invoiceIds = [8661966, 8661967, 8661968, 8661969]

async function main() {
  console.log('CHECKING RECEIVING (WRO) TRANSACTIONS')
  console.log('Invoice IDs:', invoiceIds.join(', '))
  console.log('='.repeat(80))

  // Get ALL WRO transactions on these invoices
  const { data: allWro } = await supabase
    .from('transactions')
    .select('*')
    .eq('reference_type', 'WRO')
    .in('invoice_id_sb', invoiceIds)

  console.log(`\nTotal WRO transactions: ${allWro?.length || 0}`)

  // Group by client
  const byClient = {}
  allWro?.forEach(tx => {
    const cid = tx.client_id || 'NULL'
    if (!byClient[cid]) byClient[cid] = []
    byClient[cid].push(tx)
  })

  for (const [cid, txs] of Object.entries(byClient)) {
    const clientName = cid === HENSON_ID ? 'Henson' : cid === METHYL_ID ? 'Methyl-Life' : cid
    console.log(`\n${clientName}:`)
    console.log(`  Count: ${txs.length}`)
    console.log(`  Detail:`)
    txs.forEach(tx => {
      console.log(`    - WRO ${tx.reference_id} | ${tx.fee_type} | $${tx.cost} | invoice: ${tx.invoice_id_sb}`)
    })
  }

  // Group by invoice_id_sb
  console.log('\n' + '='.repeat(80))
  console.log('WRO by invoice_id_sb:')

  const { data: dec8Invoices } = await supabase
    .from('invoices_sb')
    .select('shipbob_invoice_id, invoice_type')
    .in('shipbob_invoice_id', invoiceIds)

  const invoiceTypeMap = new Map(dec8Invoices?.map(i => [i.shipbob_invoice_id, i.invoice_type]) || [])

  const byInvoice = {}
  allWro?.forEach(tx => {
    const inv = tx.invoice_id_sb
    if (!byInvoice[inv]) byInvoice[inv] = []
    byInvoice[inv].push(tx)
  })

  for (const [inv, txs] of Object.entries(byInvoice)) {
    const invType = invoiceTypeMap.get(Number(inv)) || 'UNKNOWN'
    console.log(`\n  Invoice ${inv} (${invType}):`)
    console.log(`    Count: ${txs.length}`)
    txs.forEach(tx => {
      console.log(`      - WRO ${tx.reference_id} | ${tx.fee_type} | $${tx.cost}`)
    })
  }

  // Check preflight's query for receiving (uses reference_type='WRO')
  console.log('\n' + '='.repeat(80))
  console.log('Checking preflight receiving query for Henson:')

  const { data: hensonReceiving } = await supabase
    .from('transactions')
    .select('id, reference_id, fee_type, transaction_type, charge_date')
    .eq('client_id', HENSON_ID)
    .eq('reference_type', 'WRO')
    .in('invoice_id_sb', invoiceIds)

  console.log(`  Henson WRO count (preflight query): ${hensonReceiving?.length || 0}`)
  hensonReceiving?.forEach(tx => {
    console.log(`    - ${tx.reference_id} | ${tx.fee_type} | ${tx.transaction_type || 'N/A'}`)
  })

  // Note: Maybe the issue is that "Inventory Placement Program Fee" shouldn't be on receiving sheet?
  console.log('\n' + '='.repeat(80))
  console.log('FEE TYPE ANALYSIS:')
  console.log('  - "WRO Receiving Fee" = Actual receiving fees → should go on Receiving sheet')
  console.log('  - "Inventory Placement Program Fee" = Different fee type → goes on Additional Services?')

  // Check Henson specifically
  const wroReceiving = hensonReceiving?.filter(tx => tx.fee_type === 'WRO Receiving Fee')
  const ippFee = hensonReceiving?.filter(tx => tx.fee_type === 'Inventory Placement Program Fee')

  console.log(`\n  Henson breakdown:`)
  console.log(`    - WRO Receiving Fee: ${wroReceiving?.length || 0}`)
  console.log(`    - Inventory Placement Program Fee: ${ippFee?.length || 0}`)

  if (ippFee?.length) {
    console.log('\n  ISSUE: Inventory Placement Program Fee has reference_type=WRO but is NOT a receiving fee!')
    console.log('  This fee appears on the AdditionalFee invoice (8661968), not WarehouseInboundFee invoice.')
  }
}

main().catch(console.error)
