#!/usr/bin/env node

/**
 * Backfill Invoice Costs from ShipBob XLSX Exports
 *
 * Uses authoritative cost data exported directly from ShipBob to calculate
 * exact costs per JP invoice by matching via ShipBob invoice IDs.
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const XLSX = require('xlsx')
const path = require('path')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const COST_HISTORY_DIR = path.join(__dirname, '../reference/cost-history')

// Invoice dates to skip (already have correct data from recent system-generated invoices)
const SKIP_INVOICE_DATES = ['120825', '121525']

// JP invoice date suffix → valid SB invoice prefix(es)
// SB invoices for each week share the same first 3 digits
const JP_DATE_TO_SB_PREFIX = {
  '032425': ['750', '747', '743'], // First invoice combined 3 weeks
  '033125': ['752'],
  '040725': ['756'],
  '041425': ['759'],
  '042125': ['762'],
  '042825': ['765'],
  '050525': ['769'],
  '051225': ['772'],
  '051925': ['775'],
  '052625': ['778'],
  '060225': ['781'],
  '060925': ['784'],
  '061625': ['788'],
  '062325': ['791'],
  '063025': ['793'],
  '070725': ['797'],
  '071425': ['799'],
  '072125': ['803'],
  '072825': ['806'],
  '080425': ['809'],
  '081125': ['812'],
  '081825': ['815'],
  '082525': ['818'],
  '090125': ['822'],
  '090225': ['822'], // Same week as 090125 - typo in original invoice date
  '090825': ['824'],
  '091525': ['827'],
  '092225': ['830'],
  '092925': ['833'],
  '100625': ['837'],
  '101325': ['840'],
  '102025': ['843'],
  '102725': ['846'],
  '110325': ['849'],
  '111025': ['852'],
  '111725': ['856'],
  '112425': ['859'],
  '120125': ['863'],
}

// Merchant name to client_id mapping
const MERCHANT_TO_CLIENT = {
  'Henson Shaving': '6b94c274-0446-4167-9d02-b998f8be59ad',
  'Methyl-Life®': 'ca33dd0e-bd81-4ff7-88d1-18a3caf81d8e',
  'Eli Health': 'e6220921-695e-41f9-9f49-af3e0cdc828a'
}

// File configurations: which column has invoice # and which has the amount
const FILE_CONFIGS = {
  'costs-shipments.xlsx': {
    invoiceColumn: 'Invoice Number',
    amountColumn: 'Original Invoice',
    merchantColumn: 'Merchant Name',
    name: 'Shipments'
  },
  'costs-additionalservices.xlsx': {
    invoiceColumn: 'Invoice Number',
    amountColumn: 'Invoice Amount',
    merchantColumn: 'Merchant Name',
    name: 'Additional Services'
  },
  'costs-returns.xlsx': {
    invoiceColumn: 'Invoice Number',
    amountColumn: 'Invoice',
    merchantColumn: 'Merchant Name',
    name: 'Returns'
  },
  'costs-receiving.xlsx': {
    invoiceColumn: 'Invoice Number',
    amountColumn: 'Invoice Amount',
    merchantColumn: 'Merchant Name',
    name: 'Receiving'
  },
  'costs-storage.xlsx': {
    invoiceColumn: 'Invoice Number',
    amountColumn: 'Invoice',
    merchantColumn: 'Merchant Name',
    name: 'Storage'
  },
  'costs-credits.xlsx': {
    invoiceColumn: 'Credit Invoice Number',
    amountColumn: 'Credit Amount',
    merchantColumn: 'Merchant Name',
    name: 'Credits'
  }
}

async function parseXlsxFiles() {
  console.log('\n📊 Parsing XLSX files...\n')

  // Two-level map: client_id -> (SB invoice ID -> total cost)
  const costByClientAndInvoice = new Map()
  // Track breakdown by type for debugging: client_id -> (SB invoice ID -> {type: amount})
  const breakdownByClientAndInvoice = new Map()

  // Initialize maps for each client
  for (const clientId of Object.values(MERCHANT_TO_CLIENT)) {
    costByClientAndInvoice.set(clientId, new Map())
    breakdownByClientAndInvoice.set(clientId, new Map())
  }

  for (const [filename, config] of Object.entries(FILE_CONFIGS)) {
    const filePath = path.join(COST_HISTORY_DIR, filename)

    try {
      const wb = XLSX.readFile(filePath)
      const sheet = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(sheet)

      const fileTotalByMerchant = {}
      let rowCount = 0

      for (const row of rows) {
        const merchantName = row[config.merchantColumn]
        const clientId = MERCHANT_TO_CLIENT[merchantName]

        if (!clientId) {
          // Skip unknown merchants
          continue
        }

        const invoiceId = String(row[config.invoiceColumn] || '').trim()
        const amount = parseFloat(row[config.amountColumn]) || 0

        if (!invoiceId || invoiceId === 'undefined' || invoiceId === 'null') continue

        // Accumulate cost by client + SB invoice
        const clientCosts = costByClientAndInvoice.get(clientId)
        const existing = clientCosts.get(invoiceId) || 0
        clientCosts.set(invoiceId, existing + amount)

        // Track breakdown
        const clientBreakdown = breakdownByClientAndInvoice.get(clientId)
        if (!clientBreakdown.has(invoiceId)) {
          clientBreakdown.set(invoiceId, {})
        }
        const breakdown = clientBreakdown.get(invoiceId)
        breakdown[config.name] = (breakdown[config.name] || 0) + amount

        fileTotalByMerchant[merchantName] = (fileTotalByMerchant[merchantName] || 0) + amount
        rowCount++
      }

      // Show totals by merchant
      const merchantSummary = Object.entries(fileTotalByMerchant)
        .map(([m, t]) => `${m}: $${t.toFixed(2)}`)
        .join(', ')
      console.log(`   ✓ ${config.name}: ${rowCount.toLocaleString()} rows`)
      console.log(`      ${merchantSummary}`)

    } catch (error) {
      console.error(`   ✗ Error reading ${filename}:`, error.message)
    }
  }

  // Count unique invoices per client
  for (const [clientId, invoiceMap] of costByClientAndInvoice) {
    const merchantName = Object.entries(MERCHANT_TO_CLIENT).find(([_, id]) => id === clientId)?.[0]
    console.log(`\n   📋 ${merchantName}: ${invoiceMap.size} unique SB invoices`)
  }

  return { costByClientAndInvoice, breakdownByClientAndInvoice }
}

async function getJpInvoicesToUpdate() {
  // Get all JP invoices that need cost backfill
  // Skip the ones with dates we should exclude
  const { data: invoices, error } = await supabase
    .from('invoices_jetpack')
    .select('id, invoice_number, client_id, invoice_date, period_start, period_end, subtotal, total_markup, total_amount, shipbob_invoice_ids')
    .in('status', ['approved', 'sent'])
    .order('invoice_date', { ascending: false })

  if (error) {
    throw new Error(`Failed to fetch invoices: ${error.message}`)
  }

  // Filter out invoices we should skip
  const filtered = invoices.filter(inv => {
    // Extract date portion from invoice_number (e.g., JPHS-0038-120825 -> 120825)
    const parts = inv.invoice_number.split('-')
    const datePart = parts[parts.length - 1]
    return !SKIP_INVOICE_DATES.includes(datePart)
  })

  console.log(`📄 Found ${filtered.length} JP invoices to process (skipping ${invoices.length - filtered.length} with dates ${SKIP_INVOICE_DATES.join(', ')})\n`)

  return filtered
}

async function backfillFromXlsx(dryRun = true) {
  console.log(`\n${dryRun ? '🔍 DRY RUN - No changes will be made' : '🚀 LIVE RUN - Updating database'}\n`)

  // Step 1: Parse all XLSX files (now filtered by merchant)
  const { costByClientAndInvoice, breakdownByClientAndInvoice } = await parseXlsxFiles()

  // Step 2: Get JP invoices to update
  const jpInvoices = await getJpInvoicesToUpdate()

  const results = {
    success: 0,
    skipped: 0,
    errors: []
  }

  // Step 3: For each JP invoice, sum costs from its linked SB invoices (filtered by client)
  for (const jpInv of jpInvoices) {
    console.log(`\n📄 ${jpInv.invoice_number}`)
    console.log(`   Period: ${jpInv.period_start?.split('T')[0]} to ${jpInv.period_end?.split('T')[0]}`)
    console.log(`   Current: subtotal=$${jpInv.subtotal}, markup=$${jpInv.total_markup}, total=$${jpInv.total_amount}`)

    const rawSbInvoiceIds = jpInv.shipbob_invoice_ids || []
    const clientId = jpInv.client_id

    if (rawSbInvoiceIds.length === 0) {
      console.log(`   ⚠️  No shipbob_invoice_ids linked - skipping`)
      results.skipped++
      continue
    }

    // Extract date suffix from invoice_number (e.g., "120125" from "JPHS-0037-120125")
    const invoiceParts = jpInv.invoice_number.split('-')
    const dateSuffix = invoiceParts[invoiceParts.length - 1]
    const validPrefixes = JP_DATE_TO_SB_PREFIX[dateSuffix]

    if (!validPrefixes) {
      console.log(`   ⚠️  No prefix mapping for date ${dateSuffix} - skipping`)
      results.skipped++
      continue
    }

    // Filter SB invoice IDs to only include those with valid prefixes for this week
    const sbInvoiceIds = rawSbInvoiceIds.filter(id => {
      const idStr = String(id)
      return validPrefixes.some(prefix => idStr.startsWith(prefix))
    })

    const filteredOut = rawSbInvoiceIds.length - sbInvoiceIds.length
    if (filteredOut > 0) {
      console.log(`   🔧 Filtered out ${filteredOut} SB invoice IDs from wrong weeks (kept ${sbInvoiceIds.length})`)
    }

    if (sbInvoiceIds.length === 0) {
      console.log(`   ⚠️  All SB invoice IDs filtered out - no valid IDs for this week - skipping`)
      results.skipped++
      continue
    }

    // Get the client-specific cost map
    const clientCostMap = costByClientAndInvoice.get(clientId)
    const clientBreakdownMap = breakdownByClientAndInvoice.get(clientId)

    if (!clientCostMap) {
      console.log(`   ⚠️  Unknown client_id ${clientId} - skipping`)
      results.skipped++
      continue
    }

    console.log(`   SB Invoice IDs: ${sbInvoiceIds.join(', ')}`)

    // Sum costs from all linked SB invoices (for THIS client only)
    let totalCost = 0
    const typeBreakdown = {}
    let missingIds = []

    for (const sbId of sbInvoiceIds) {
      const sbIdStr = String(sbId)
      const cost = clientCostMap.get(sbIdStr)

      if (cost === undefined) {
        missingIds.push(sbIdStr)
      } else {
        totalCost += cost

        // Merge breakdown
        const breakdown = clientBreakdownMap.get(sbIdStr) || {}
        for (const [type, amt] of Object.entries(breakdown)) {
          typeBreakdown[type] = (typeBreakdown[type] || 0) + amt
        }
      }
    }

    if (missingIds.length > 0) {
      console.log(`   ⚠️  No XLSX data for SB invoices: ${missingIds.join(', ')}`)
    }

    if (totalCost === 0 && missingIds.length === sbInvoiceIds.length) {
      console.log(`   ❌ No cost data found for any linked SB invoices - skipping`)
      results.skipped++
      continue
    }

    // Round to 2 decimals
    totalCost = Math.round(totalCost * 100) / 100

    // Show breakdown
    console.log(`   💰 Cost breakdown from XLSX (${Object.entries(MERCHANT_TO_CLIENT).find(([_, id]) => id === clientId)?.[0]}):`)
    for (const [type, amt] of Object.entries(typeBreakdown).sort((a, b) => b[1] - a[1])) {
      console.log(`      ${type}: $${amt.toFixed(2)}`)
    }
    console.log(`      TOTAL COST: $${totalCost.toFixed(2)}`)

    // Calculate markup
    const currentTotal = parseFloat(jpInv.total_amount) || 0

    if (currentTotal === 0) {
      console.log(`   ⏭️  Skipping: total_amount is $0 (incomplete invoice)`)
      results.skipped++
      continue
    }

    const newMarkup = Math.round((currentTotal - totalCost) * 100) / 100
    const markupPercent = totalCost > 0 ? (newMarkup / totalCost * 100) : 0

    console.log(`   📊 Calculated values:`)
    console.log(`      subtotal (cost): $${totalCost.toFixed(2)}`)
    console.log(`      total_markup (profit): $${newMarkup.toFixed(2)}`)
    console.log(`      total_amount: $${currentTotal.toFixed(2)}`)
    console.log(`      markup %: ${markupPercent.toFixed(1)}%`)

    // Sanity check
    if (newMarkup < 0) {
      console.log(`   ⚠️  Warning: Negative markup!`)
      if (markupPercent < -10) {
        console.log(`   ⏭️  Skipping: Very negative markup (< -10%) indicates data issue`)
        results.skipped++
        continue
      }
    }

    if (markupPercent > 50) {
      console.log(`   ⚠️  Warning: Very high markup (>50%) - verify this is correct`)
    }

    // Update database
    if (!dryRun) {
      const { error: updateError } = await supabase
        .from('invoices_jetpack')
        .update({
          subtotal: totalCost,
          total_markup: newMarkup
        })
        .eq('id', jpInv.id)

      if (updateError) {
        console.log(`   ❌ Update failed: ${updateError.message}`)
        results.errors.push({ invoice: jpInv.invoice_number, error: updateError.message })
      } else {
        console.log(`   ✅ Updated successfully`)
        results.success++
      }
    } else {
      console.log(`   🔍 Would update (dry run)`)
      results.success++
    }
  }

  // Summary
  console.log(`\n${'='.repeat(60)}`)
  console.log(`Summary:`)
  console.log(`  ✅ ${results.success} invoices ${dryRun ? 'would be' : ''} updated`)
  console.log(`  ⏭️  ${results.skipped} invoices skipped`)
  console.log(`  ❌ ${results.errors.length} errors`)

  if (results.errors.length > 0) {
    console.log(`\nErrors:`)
    results.errors.forEach(e => console.log(`  - ${e.invoice}: ${e.error}`))
  }

  console.log(`\n${dryRun ? 'Run with --live to apply changes' : 'Done!'}`)
}

// Parse command line args
const args = process.argv.slice(2)
const dryRun = !args.includes('--live')

backfillFromXlsx(dryRun).catch(console.error)
