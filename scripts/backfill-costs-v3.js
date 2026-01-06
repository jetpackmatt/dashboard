#!/usr/bin/env node

/**
 * Backfill Invoice Costs from ShipBob XLSX Exports - V3 (STORAGE FIX)
 *
 * KEY INSIGHT: Storage billing does NOT follow the same prefix pattern as shipping.
 * Storage is billed monthly by ShipBob, then rolled into JP invoices differently.
 *
 * This version:
 * 1. Uses prefix matching for non-storage charges (shipments, additional services, returns, receiving, credits)
 * 2. Uses EXPLICIT storage invoice ID mapping based on actual JP invoice PDFs
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

// JP invoice date suffix → valid SB invoice prefix(es) for NON-STORAGE charges
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

// ONE-TIME STORAGE OVERRIDES
// For specific invoices where prefix-based matching doesn't work due to billing corrections
// Format: 'invoice_number' → exact storage amount (or 0 to exclude)
const STORAGE_OVERRIDES = {
  // Methyl-Life Oct 2025 aberration: ShipBob billed storage late, we charged correctly ahead of time
  // Oct 6 invoice should have $1,328.87 (from 8401501, prefix 840) not $1,766.92 (from 8373859, prefix 837)
  // Oct 13 invoice should have $0 (we already charged the storage the week before)
  'JPML-0013-100625': 1328.87,
  'JPML-0014-101325': 0,

  // Henson first invoice had no storage charges
  'JPHS-0001-032425': 0,
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

// NON-STORAGE file configurations
const NON_STORAGE_FILES = {
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
  'costs-credits.xlsx': {
    invoiceColumn: 'Credit Invoice Number',
    amountColumn: 'Credit Amount',
    merchantColumn: 'Merchant Name',
    name: 'Credits'
  }
}

// Load non-storage XLSX data
function loadNonStorageData() {
  console.log('\n📊 Loading non-storage XLSX files...\n')

  // Structure: { merchantName: { invoiceId: { type: amount, ... }, ... }, ... }
  const dataByMerchant = {}

  for (const merchant of Object.keys(MERCHANT_TO_CLIENT)) {
    dataByMerchant[merchant] = {}
  }

  for (const [filename, config] of Object.entries(NON_STORAGE_FILES)) {
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

// Load storage data indexed by invoice ID
function loadStorageData() {
  console.log('\n📦 Loading storage XLSX...\n')

  // Structure: { merchantName: { invoiceId: totalAmount, ... }, ... }
  const storageByMerchant = {}

  for (const merchant of Object.keys(MERCHANT_TO_CLIENT)) {
    storageByMerchant[merchant] = {}
  }

  const filePath = path.join(COST_HISTORY_DIR, 'costs-storage.xlsx')

  try {
    const wb = XLSX.readFile(filePath)
    const sheet = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json(sheet)

    let rowCount = 0

    for (const row of rows) {
      const merchant = row['Merchant Name']
      if (!MERCHANT_TO_CLIENT[merchant]) continue

      const invoiceId = String(row['Invoice Number'] || '').trim()
      if (!invoiceId || invoiceId === 'undefined' || invoiceId === 'null') continue

      const amount = parseFloat(row['Invoice']) || 0

      storageByMerchant[merchant][invoiceId] =
        (storageByMerchant[merchant][invoiceId] || 0) + amount

      rowCount++
    }

    console.log(`   ✓ Storage: ${rowCount.toLocaleString()} rows loaded`)

    // Show storage by merchant and invoice ID
    for (const [merchant, invoices] of Object.entries(storageByMerchant)) {
      const invoiceList = Object.entries(invoices)
        .filter(([, amt]) => amt > 0)
        .sort((a, b) => parseInt(b[0]) - parseInt(a[0]))

      if (invoiceList.length > 0) {
        console.log(`   ${merchant}:`)
        for (const [id, amt] of invoiceList) {
          console.log(`      Invoice ${id}: $${amt.toFixed(2)}`)
        }
      }
    }
  } catch (error) {
    console.error(`   ✗ Error reading storage file:`, error.message)
  }

  return storageByMerchant
}

// Calculate non-storage cost for a merchant + prefix combination
function calculateNonStorageCost(dataByMerchant, merchantName, prefixes) {
  const merchantData = dataByMerchant[merchantName] || {}
  let total = 0
  const breakdown = {}
  const invoiceIds = []

  for (const [invoiceId, types] of Object.entries(merchantData)) {
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

// Get storage cost for a specific JP invoice using PREFIX-BASED matching
// with overrides for specific one-time exceptions
function getStorageCost(storageByMerchant, clientId, dateSuffix, invoiceNumber, prefixes) {
  // Check for explicit override first
  if (STORAGE_OVERRIDES.hasOwnProperty(invoiceNumber)) {
    const overrideAmount = STORAGE_OVERRIDES[invoiceNumber]
    return {
      amount: overrideAmount,
      invoiceIds: overrideAmount > 0 ? ['OVERRIDE'] : [],
      isOverride: true
    }
  }

  // Use prefix-based matching (same as non-storage charges)
  const merchantName = CLIENT_TO_MERCHANT[clientId]
  const merchantStorage = storageByMerchant[merchantName] || {}

  let total = 0
  const invoiceIds = []

  for (const [invoiceId, amount] of Object.entries(merchantStorage)) {
    if (prefixes.some(prefix => invoiceId.startsWith(prefix))) {
      total += amount
      invoiceIds.push(invoiceId)
    }
  }

  return {
    amount: Math.round(total * 100) / 100,
    invoiceIds: invoiceIds.sort(),
    isOverride: false
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

async function backfillCostsV3(dryRun = true) {
  console.log(`\n${dryRun ? '🔍 DRY RUN - No changes will be made' : '🚀 LIVE RUN - Updating database'}\n`)

  // Step 1: Load all data
  const nonStorageData = loadNonStorageData()
  const storageData = loadStorageData()

  // Step 2: Get JP invoices
  const jpInvoices = await getJpInvoicesToUpdate()

  const results = {
    success: 0,
    skipped: 0,
    errors: []
  }

  // Step 3: Calculate cost for each invoice
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

    // Calculate non-storage costs using prefix matching
    const { total: nonStorageCost, breakdown, invoiceIds: nonStorageInvoices } = calculateNonStorageCost(
      nonStorageData,
      merchantName,
      prefixes
    )

    // Get storage cost using prefix matching (with overrides for exceptions)
    const storage = getStorageCost(storageData, jpInv.client_id, dateSuffix, jpInv.invoice_number, prefixes)

    // Total cost
    const xlsxCost = Math.round((nonStorageCost + storage.amount) * 100) / 100


    if (xlsxCost === 0 && nonStorageInvoices.length === 0) {
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
    console.log(`   Non-storage SB IDs: ${nonStorageInvoices.join(', ')}`)
    if (storage.isOverride) {
      console.log(`   Storage: $${storage.amount.toFixed(2)} (MANUAL OVERRIDE)`)
    } else if (storage.invoiceIds.length > 0) {
      console.log(`   Storage SB IDs: ${storage.invoiceIds.join(', ')} ($${storage.amount.toFixed(2)})`)
    }
    console.log(`   💰 Cost breakdown:`)
    for (const [type, amt] of Object.entries(breakdown).sort((a, b) => b[1] - a[1])) {
      console.log(`      ${type}: $${amt.toFixed(2)}`)
    }
    if (storage.amount > 0) {
      console.log(`      Storage: $${storage.amount.toFixed(2)}`)
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

backfillCostsV3(dryRun).catch(console.error)
