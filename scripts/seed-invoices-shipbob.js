/**
 * Seed invoices_shipbob table from transactions
 * Creates one record per unique invoice_id_sb found in transactions
 *
 * Usage: node scripts/seed-invoices-shipbob.js
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  console.log('Analyzing transactions to seed invoices_shipbob...\n')

  // Get all transactions with invoice IDs
  const { data: transactions, error: txError } = await supabase
    .from('transactions')
    .select('invoice_id_sb, reference_type, transaction_fee, cost, charge_date, client_id')
    .not('invoice_id_sb', 'is', null)

  if (txError) {
    console.error('Error fetching transactions:', txError)
    process.exit(1)
  }

  // Group by invoice_id_sb to determine type and totals
  const invoiceMap = {}
  for (const tx of transactions) {
    const id = tx.invoice_id_sb
    if (!invoiceMap[id]) {
      invoiceMap[id] = {
        shipbob_invoice_id: String(id),
        totalCost: 0,
        txCount: 0,
        types: new Set(),
        minDate: tx.charge_date,
        client_id: tx.client_id, // Use first client_id found (historical)
      }
    }
    invoiceMap[id].totalCost += Number(tx.cost) || 0
    invoiceMap[id].txCount++

    // Determine invoice type from transaction types
    if (tx.reference_type === 'FC') {
      invoiceMap[id].types.add('Storage')
    } else if (tx.reference_type === 'Shipment') {
      if (tx.transaction_fee === 'Shipping') {
        invoiceMap[id].types.add('Shipping')
      } else {
        invoiceMap[id].types.add('Additional Services')
      }
    } else if (tx.reference_type === 'Return') {
      invoiceMap[id].types.add('Returns')
    } else if (tx.reference_type === 'WRO') {
      invoiceMap[id].types.add('Receiving')
    } else if (tx.transaction_fee === 'Credit') {
      invoiceMap[id].types.add('Credits')
    }

    if (tx.charge_date < invoiceMap[id].minDate) {
      invoiceMap[id].minDate = tx.charge_date
    }
  }

  // Convert to records for insert
  const records = Object.values(invoiceMap).map(inv => {
    // Determine primary invoice type
    const types = [...inv.types]
    let invoiceType = 'Shipping' // default
    if (types.includes('Storage') && types.length === 1) invoiceType = 'Storage'
    else if (types.includes('Returns') && types.length === 1) invoiceType = 'Returns'
    else if (types.includes('Receiving')) invoiceType = 'Receiving'
    else if (types.includes('Credits') && types.length === 1) invoiceType = 'Credits'
    else if (types.length > 1) invoiceType = 'Mixed'

    return {
      invoice_id: parseInt(inv.shipbob_invoice_id, 10), // INTEGER column (matches transactions.invoice_id_sb)
      client_id: inv.client_id,
      invoice_type: invoiceType,
      invoice_date: inv.minDate.split('T')[0],
      amount: Math.round(inv.totalCost * 100) / 100,
      // jetpack_invoice_id defaults to NULL (unprocessed)
    }
  })

  console.log(`Found ${records.length} unique invoice IDs in transactions:\n`)
  records.forEach(r => {
    console.log(`  ${r.invoice_id}: ${r.invoice_type}, ${r.invoice_date}, $${r.amount}`)
  })

  // Check existing records
  const { data: existing } = await supabase
    .from('invoices_shipbob')
    .select('invoice_id')

  const existingIds = new Set((existing || []).map(e => e.invoice_id))
  const newRecords = records.filter(r => !existingIds.has(r.invoice_id))

  if (newRecords.length === 0) {
    console.log('\nAll invoice IDs already exist in invoices_shipbob. Nothing to insert.')
    return
  }

  console.log(`\nInserting ${newRecords.length} new records...`)

  const { error: insertError } = await supabase
    .from('invoices_shipbob')
    .insert(newRecords)

  if (insertError) {
    console.error('Insert error:', insertError)
    process.exit(1)
  }

  console.log('Done! invoices_shipbob now has records for all transaction invoice IDs.')
}

main().catch(console.error)
