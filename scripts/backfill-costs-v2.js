#!/usr/bin/env node

/**
 * Backfill Invoice Costs from ShipBob XLSX Exports - V2 (FIXED)
 *
 * CRITICAL FIX: Uses SB invoice PREFIX matching instead of shipbob_invoice_ids array.
 * The shipbob_invoice_ids array is INCOMPLETE - it's missing Storage invoice IDs!
 *
 * For each JP invoice:
 * 1. Get the SB invoice prefix for that billing week (e.g., 837 for Oct 6)
 * 2. Sum ALL XLSX transactions where merchant matches AND invoice ID starts with prefix
 * 3. Update subtotal (cost) and recalculate markup
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

// Reverse mapping: client_id -> merchant name
const CLIENT_TO_MERCHANT = Object.fromEntries(
  Object.entries(MERCHANT_TO_CLIENT).map(([k, v]) => [v, k])
)

// File configurations
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

// Load all XLSX data into memory, indexed by merchant + invoice prefix
function loadXlsxData() {
  console.log('\n📊 Loading XLSX files...\n')

  // Structure: { merchantName: { invoiceId: { type: amount, ... }, ... }, ... }
  const dataByMerchant = {}

  for (const merchant of Object.keys(MERCHANT_TO_CLIENT)) {
    dataByMerchant[merchant] = {}
  }

  for (const [filename, config] of Object.entries(FILE_CONFIGS)) {
    const filePath = path.join(COST_HISTORY_DIR, filename)

    try {
      const wb = XLSX.readFile(filePath)
      const sheet = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(sheet)

      let rowCount = 0

      for (const row of rows) {
        const merchant = row[config.merchantColumn]
        if (!MERCHANT_TO_CLIENT[merchant]) continue

        const invoiceId = String(row[config.invoiceColumn] || '').trim()
        if (!invoiceId || invoiceId === 'undefined' || invoiceId === 'null') continue

        const amount = parseFloat(row[config.amountColumn]) || 0

        if (!dataByMerchant[merchant][invoiceId]) {
          dataByMerchant[merchant][invoiceId] = {}
        }
        dataByMerchant[merchant][invoiceId][config.name] =
          (dataByMerchant[merchant][invoiceId][config.name] || 0) + amount

        rowCount++
      }

      console.log(`   ✓ ${config.name}: ${rowCount.toLocaleString()} rows loaded`)
    } catch (error) {
      console.error(`   ✗ Error reading ${filename}:`, error.message)
    }
  }

  return dataByMerchant
}

// Calculate cost for a merchant + prefix combination
function calculateCostForPrefix(dataByMerchant, merchantName, prefixes) {
  const merchantData = dataByMerchant[merchantName] || {}
  let total = 0
  const breakdown = {}
  const invoiceIds = []

  for (const [invoiceId, types] of Object.entries(merchantData)) {
    // Check if this invoice ID matches any of the valid prefixes
    if (prefixes.some(prefix => invoiceId.startsWith(prefix))) {
      invoiceIds.push(invoiceId)
      for (const [type, amount] of Object.entries(types)) {
        total += amount
        breakdown[type] = (breakdown[type] || 0) + amount
      }
    }
  }

  return {
    total: Math.round(total * 100) / 100,
    breakdown,
    invoiceIds: invoiceIds.sort()
  }
}

async function getJpInvoicesToUpdate() {
  const { data: invoices, error } = await supabase
    .from('invoices_jetpack')
    .select('id, invoice_number, client_id, subtotal, total_markup, total_amount')
    .in('status', ['approved', 'sent'])
    .order('invoice_number', { ascending: true })

  if (error) {
    throw new Error(`Failed to fetch invoices: ${error.message}`)
  }

  // Filter out invoices we should skip
  const filtered = invoices.filter(inv => {
    const parts = inv.invoice_number.split('-')
    const datePart = parts[parts.length - 1]
    return !SKIP_INVOICE_DATES.includes(datePart)
  })

  console.log(`\n📄 Found ${filtered.length} JP invoices to process (skipping ${invoices.length - filtered.length} recent ones)\n`)

  return filtered
}

async function backfillCostsV2(dryRun = true) {
  console.log(`\n${dryRun ? '🔍 DRY RUN - No changes will be made' : '🚀 LIVE RUN - Updating database'}\n`)

  // Step 1: Load all XLSX data
  const dataByMerchant = loadXlsxData()

  // Step 2: Get JP invoices
  const jpInvoices = await getJpInvoicesToUpdate()

  const results = {
    success: 0,
    skipped: 0,
    errors: []
  }

  // Step 3: Calculate cost for each invoice using prefix matching
  for (const jpInv of jpInvoices) {
    // Extract date suffix from invoice_number
    const parts = jpInv.invoice_number.split('-')
    const dateSuffix = parts[parts.length - 1]
    const prefixes = JP_DATE_TO_SB_PREFIX[dateSuffix]

    if (!prefixes) {
      console.log(`⚠️  ${jpInv.invoice_number}: No prefix mapping for date ${dateSuffix} - skipping`)
      results.skipped++
      continue
    }

    const merchantName = CLIENT_TO_MERCHANT[jpInv.client_id]
    if (!merchantName) {
      console.log(`⚠️  ${jpInv.invoice_number}: Unknown client_id ${jpInv.client_id} - skipping`)
      results.skipped++
      continue
    }

    // Calculate cost from XLSX using prefix matching
    const { total: xlsxCost, breakdown, invoiceIds } = calculateCostForPrefix(
      dataByMerchant,
      merchantName,
      prefixes
    )

    if (xlsxCost === 0 && invoiceIds.length === 0) {
      console.log(`⚠️  ${jpInv.invoice_number}: No XLSX data for prefix ${prefixes.join('/')} - skipping`)
      results.skipped++
      continue
    }

    const currentTotal = parseFloat(jpInv.total_amount) || 0
    const currentSubtotal = parseFloat(jpInv.subtotal) || 0
    const newMarkup = Math.round((currentTotal - xlsxCost) * 100) / 100
    const markupPercent = xlsxCost > 0 ? (newMarkup / xlsxCost * 100) : 0

    // Check if update is needed
    const costDiff = Math.abs(xlsxCost - currentSubtotal)
    if (costDiff < 0.01) {
      // Already correct
      continue
    }

    console.log(`\n📄 ${jpInv.invoice_number} (${merchantName})`)
    console.log(`   SB Invoice IDs: ${invoiceIds.join(', ')}`)
    console.log(`   💰 XLSX Cost breakdown:`)
    for (const [type, amt] of Object.entries(breakdown).sort((a, b) => b[1] - a[1])) {
      console.log(`      ${type}: $${amt.toFixed(2)}`)
    }
    console.log(`   Current: subtotal=$${currentSubtotal.toFixed(2)}, total=$${currentTotal.toFixed(2)}`)
    console.log(`   New:     subtotal=$${xlsxCost.toFixed(2)}, markup=$${newMarkup.toFixed(2)} (${markupPercent.toFixed(1)}%)`)
    console.log(`   Diff:    $${(xlsxCost - currentSubtotal).toFixed(2)}`)

    if (!dryRun) {
      const { error: updateError } = await supabase
        .from('invoices_jetpack')
        .update({
          subtotal: xlsxCost,
          total_markup: newMarkup
        })
        .eq('id', jpInv.id)

      if (updateError) {
        console.log(`   ❌ Update failed: ${updateError.message}`)
        results.errors.push({ invoice: jpInv.invoice_number, error: updateError.message })
      } else {
        console.log(`   ✅ Updated`)
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

backfillCostsV2(dryRun).catch(console.error)
