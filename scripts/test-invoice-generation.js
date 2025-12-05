#!/usr/bin/env node
/**
 * Test Invoice Generation End-to-End
 *
 * This script tests invoice generation for a specific period
 * without creating database records. Useful for validating
 * markup calculations and file generation.
 */

const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')
require('dotenv').config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing environment variables')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function main() {
  console.log('=== Invoice Generation Test ===\n')

  // Get period dates (previous week)
  const periodEnd = new Date('2025-12-01') // Dec 1, 2025 (Sunday)
  const periodStart = new Date(periodEnd)
  periodStart.setDate(periodEnd.getDate() - 6) // Nov 25 - Dec 1

  console.log(`Testing period: ${periodStart.toISOString().split('T')[0]} to ${periodEnd.toISOString().split('T')[0]}\n`)

  // Get active clients
  const { data: clients, error: clientsError } = await supabase
    .from('clients')
    .select('id, company_name, short_code, next_invoice_number, billing_terms')
    .eq('is_active', true)

  if (clientsError) {
    console.error('Error fetching clients:', clientsError)
    process.exit(1)
  }

  console.log(`Found ${clients.length} active clients\n`)

  for (const client of clients) {
    console.log(`\n--- Client: ${client.company_name} (${client.short_code}) ---`)

    if (!client.short_code) {
      console.log('  [SKIP] No short code configured')
      continue
    }

    // Get transaction counts for the period
    const startStr = periodStart.toISOString().split('T')[0]
    const endStr = periodEnd.toISOString().split('T')[0]

    // Count shipments
    const { count: shipmentsCount } = await supabase
      .from('billing_shipments')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', client.id)
      .gte('transaction_date', startStr)
      .lte('transaction_date', endStr)

    // Count fees
    const { count: feesCount } = await supabase
      .from('billing_shipment_fees')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', client.id)
      .gte('transaction_date', startStr)
      .lte('transaction_date', endStr)

    // Count storage
    const { count: storageCount } = await supabase
      .from('billing_storage')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', client.id)
      .gte('charge_start_date', startStr)
      .lte('charge_start_date', endStr)

    // Count credits
    const { count: creditsCount } = await supabase
      .from('billing_credits')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', client.id)
      .gte('transaction_date', startStr)
      .lte('transaction_date', endStr)

    // Count returns
    const { count: returnsCount } = await supabase
      .from('billing_returns')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', client.id)
      .gte('return_creation_date', startStr)
      .lte('return_creation_date', endStr)

    // Count receiving
    const { count: receivingCount } = await supabase
      .from('billing_receiving')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', client.id)
      .gte('transaction_date', startStr)
      .lte('transaction_date', endStr)

    console.log('  Transaction counts:')
    console.log(`    Shipments: ${shipmentsCount || 0}`)
    console.log(`    Fees: ${feesCount || 0}`)
    console.log(`    Storage: ${storageCount || 0}`)
    console.log(`    Credits: ${creditsCount || 0}`)
    console.log(`    Returns: ${returnsCount || 0}`)
    console.log(`    Receiving: ${receivingCount || 0}`)

    const totalTx = (shipmentsCount || 0) + (feesCount || 0) + (storageCount || 0) +
                    (creditsCount || 0) + (returnsCount || 0) + (receivingCount || 0)

    console.log(`  Total: ${totalTx} transactions`)

    if (totalTx === 0) {
      console.log('  [SKIP] No transactions for this period')
      continue
    }

    // Get sum of shipments
    const { data: shipmentSums } = await supabase
      .from('billing_shipments')
      .select('total_amount')
      .eq('client_id', client.id)
      .gte('transaction_date', startStr)
      .lte('transaction_date', endStr)

    const shipmentsTotal = (shipmentSums || []).reduce((sum, s) => sum + (parseFloat(s.total_amount) || 0), 0)
    console.log(`\n  Base amounts (ShipBob costs):`)
    console.log(`    Shipments: $${shipmentsTotal.toFixed(2)}`)

    // Get sum of fees
    const { data: feeSums } = await supabase
      .from('billing_shipment_fees')
      .select('amount')
      .eq('client_id', client.id)
      .gte('transaction_date', startStr)
      .lte('transaction_date', endStr)

    const feesTotal = (feeSums || []).reduce((sum, f) => sum + (parseFloat(f.amount) || 0), 0)
    console.log(`    Fees: $${feesTotal.toFixed(2)}`)

    // Check markup rules
    const { data: rules } = await supabase
      .from('markup_rules')
      .select('*')
      .eq('is_active', true)
      .or(`client_id.is.null,client_id.eq.${client.id}`)

    console.log(`\n  Active markup rules: ${rules?.length || 0}`)
    if (rules && rules.length > 0) {
      for (const rule of rules.slice(0, 5)) {
        console.log(`    - ${rule.name}: ${rule.markup_type === 'percentage' ? rule.markup_value + '%' : '$' + rule.markup_value}`)
      }
      if (rules.length > 5) {
        console.log(`    ... and ${rules.length - 5} more`)
      }
    }
  }

  console.log('\n\n=== Summary ===')
  console.log('To generate actual invoices, run: POST /api/admin/invoices/generate')
  console.log('Or manually trigger the cron: GET /api/cron/generate-invoices')
}

main().catch(console.error)
