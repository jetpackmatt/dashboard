#!/usr/bin/env node
/**
 * Fix FC (Storage) transaction attribution using products.variants lookup
 *
 * This script corrects the misattributed FC transactions that were incorrectly
 * assigned via the broken invoice-based fallback (which assumed single-client invoices,
 * but storage invoices are shared across multiple clients).
 *
 * The correct attribution comes from products.variants[].inventory.inventory_id
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  console.log('='.repeat(70))
  console.log('FIX FC TRANSACTION ATTRIBUTION')
  console.log('='.repeat(70))

  // Step 1: Build inventory_id -> client_id lookup from products.variants
  console.log('\n--- Step 1: Building inventory lookup from products.variants ---')
  const inventoryLookup = {}
  const clientInfoLookup = {}
  let productLastId = null
  const pageSize = 500

  while (true) {
    let query = supabase
      .from('products')
      .select('id, client_id, variants')
      .order('id', { ascending: true })
      .limit(pageSize)

    if (productLastId) {
      query = query.gt('id', productLastId)
    }

    const { data, error } = await query

    if (error) {
      console.error('Error fetching products:', error.message)
      break
    }

    if (!data || data.length === 0) break

    for (const p of data) {
      if (p.client_id && Array.isArray(p.variants)) {
        for (const variant of p.variants) {
          const invId = variant?.inventory?.inventory_id
          if (invId) {
            inventoryLookup[String(invId)] = p.client_id
          }
        }
      }
      productLastId = p.id
    }

    if (data.length < pageSize) break
  }
  console.log(`Built inventory lookup with ${Object.keys(inventoryLookup).length} inventory IDs`)

  // Step 2: Build client_id -> merchant_id lookup
  console.log('\n--- Step 2: Building client lookup ---')
  const { data: clients } = await supabase
    .from('clients')
    .select('id, company_name, merchant_id')

  for (const c of clients || []) {
    clientInfoLookup[c.id] = { merchant_id: c.merchant_id, name: c.company_name }
  }
  console.log(`Built client lookup with ${Object.keys(clientInfoLookup).length} clients`)

  // Step 3: Get all FC transactions
  console.log('\n--- Step 3: Fetching all FC transactions ---')
  const fcTransactions = []
  let fcOffset = 0

  while (true) {
    const { data, error } = await supabase
      .from('transactions')
      .select('id, reference_id, client_id, merchant_id, additional_details')
      .eq('reference_type', 'FC')
      .order('id')
      .range(fcOffset, fcOffset + 999)

    if (error) {
      console.error('Error fetching FC transactions:', error.message)
      break
    }

    if (!data || data.length === 0) break
    fcTransactions.push(...data)
    fcOffset += data.length
    if (data.length < 1000) break
  }
  console.log(`Found ${fcTransactions.length} FC transactions`)

  // Step 4: Check each FC transaction and fix if needed
  console.log('\n--- Step 4: Checking and fixing attributions ---')
  const stats = {
    correct: 0,
    fixed: 0,
    unattributable: 0,
    errors: 0
  }
  const fixes = []

  for (const tx of fcTransactions) {
    // Parse inventory ID from reference_id (format: {FC_ID}-{InventoryId}-{LocationType})
    const parts = tx.reference_id.split('-')
    let invId = null
    if (parts.length >= 2) {
      invId = parts[1]
    }
    if (!invId && tx.additional_details?.InventoryId) {
      invId = String(tx.additional_details.InventoryId)
    }

    if (!invId) {
      stats.unattributable++
      continue
    }

    const correctClientId = inventoryLookup[invId]
    if (!correctClientId) {
      stats.unattributable++
      continue
    }

    // Check if current attribution is correct
    if (tx.client_id === correctClientId) {
      stats.correct++
    } else {
      // Need to fix
      const clientInfo = clientInfoLookup[correctClientId]
      fixes.push({
        id: tx.id,
        oldClientId: tx.client_id,
        newClientId: correctClientId,
        newMerchantId: clientInfo?.merchant_id || null,
        inventoryId: invId
      })
    }
  }

  console.log(`\nAttribution check results:`)
  console.log(`  Already correct: ${stats.correct}`)
  console.log(`  Needs fixing: ${fixes.length}`)
  console.log(`  Unattributable (no inventory match): ${stats.unattributable}`)

  if (fixes.length === 0) {
    console.log('\n✓ All FC transactions are correctly attributed!')
    return
  }

  // Show sample fixes
  console.log('\n--- Sample fixes ---')
  for (const fix of fixes.slice(0, 10)) {
    const oldName = fix.oldClientId ? clientInfoLookup[fix.oldClientId]?.name || 'Unknown' : 'NULL'
    const newName = clientInfoLookup[fix.newClientId]?.name || 'Unknown'
    console.log(`  Inventory ${fix.inventoryId}: ${oldName} -> ${newName}`)
  }
  if (fixes.length > 10) {
    console.log(`  ... and ${fixes.length - 10} more`)
  }

  // Step 5: Apply fixes
  console.log('\n--- Step 5: Applying fixes ---')
  let fixed = 0
  for (const fix of fixes) {
    const { error } = await supabase
      .from('transactions')
      .update({
        client_id: fix.newClientId,
        merchant_id: fix.newMerchantId
      })
      .eq('id', fix.id)

    if (error) {
      console.error(`Error fixing ${fix.id}:`, error.message)
      stats.errors++
    } else {
      fixed++
      if (fixed % 100 === 0) {
        process.stdout.write(`\r  Fixed ${fixed}/${fixes.length}...`)
      }
    }
  }
  console.log(`\r  Fixed ${fixed}/${fixes.length} transactions`)

  // Final summary
  console.log('\n' + '='.repeat(70))
  console.log('SUMMARY')
  console.log('='.repeat(70))
  console.log(`Total FC transactions: ${fcTransactions.length}`)
  console.log(`Already correct: ${stats.correct}`)
  console.log(`Fixed: ${fixed}`)
  console.log(`Unattributable: ${stats.unattributable}`)
  console.log(`Errors: ${stats.errors}`)
  console.log('='.repeat(70))
}

main().catch(console.error)
