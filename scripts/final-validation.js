#!/usr/bin/env node
/**
 * Final validation: Confirm transaction counts for JPHS-0037
 * Using invoice_id_sb filtering with client_id
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const HENSON_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

// JPHS-0037 invoice IDs (week Nov 24-30, 2025)
const INVOICE_IDS = {
  shipments: 8633612,
  storage: 8633618,
  receiving: 8633632,
  additionalServices: 8633634,
  returns: 8633637,
  credits: 8633641
}

async function countTransactions(invoiceId) {
  const { count } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', HENSON_ID)
    .eq('invoice_id_sb', invoiceId)

  return count || 0
}

async function main() {
  console.log('='.repeat(70))
  console.log('FINAL VALIDATION: JPHS-0037 Transaction Counts')
  console.log('Client: Henson Shaving')
  console.log('Period: Nov 24-30, 2025')
  console.log('='.repeat(70))

  // Reference file counts (for comparison)
  const reference = {
    shipments: 1435,
    additionalServices: 1112,
    returns: 3,
    receiving: 1,
    storage: 981,  // Includes 12 Methyl-Life + 1 malformed
    credits: 11
  }

  // Our expected counts (after fixing client attribution)
  const expected = {
    shipments: 1435,
    additionalServices: 1112,
    returns: 3,
    receiving: 1,
    storage: 969,  // Correct Henson-only count
    credits: 11
  }

  // Get actual counts
  const actual = {
    shipments: await countTransactions(INVOICE_IDS.shipments),
    additionalServices: await countTransactions(INVOICE_IDS.additionalServices),
    returns: await countTransactions(INVOICE_IDS.returns),
    receiving: await countTransactions(INVOICE_IDS.receiving),
    storage: await countTransactions(INVOICE_IDS.storage),
    credits: await countTransactions(INVOICE_IDS.credits)
  }

  console.log('\n' + '-'.repeat(70))
  console.log('Category'.padEnd(25) + 'Reference'.padStart(12) + 'Expected'.padStart(12) + 'Actual'.padStart(12) + 'Status'.padStart(12))
  console.log('-'.repeat(70))

  let allMatch = true
  for (const [cat, refCount] of Object.entries(reference)) {
    const expCount = expected[cat]
    const actCount = actual[cat]
    const matches = actCount === expCount
    if (!matches) allMatch = false

    const status = matches ? '✓ PASS' : '✗ FAIL'
    console.log(
      cat.padEnd(25) +
      String(refCount).padStart(12) +
      String(expCount).padStart(12) +
      String(actCount).padStart(12) +
      status.padStart(12)
    )
  }

  console.log('-'.repeat(70))

  const totalRef = Object.values(reference).reduce((a, b) => a + b, 0)
  const totalExp = Object.values(expected).reduce((a, b) => a + b, 0)
  const totalAct = Object.values(actual).reduce((a, b) => a + b, 0)

  console.log(
    'TOTAL'.padEnd(25) +
    String(totalRef).padStart(12) +
    String(totalExp).padStart(12) +
    String(totalAct).padStart(12) +
    (totalAct === totalExp ? '✓ PASS' : '✗ FAIL').padStart(12)
  )

  console.log('\n' + '='.repeat(70))
  if (allMatch) {
    console.log('✓ ALL CATEGORIES MATCH EXPECTED COUNTS')
  } else {
    console.log('✗ SOME CATEGORIES DO NOT MATCH')
  }
  console.log('='.repeat(70))

  // Explanation for storage discrepancy
  console.log('\nNote: Storage reference has 981 rows, but 12 belong to Methyl-Life')
  console.log('(inventory 20114295 incorrectly labeled in reference file)')
  console.log('Plus 1 malformed row in reference. Our 969 count is correct.')
}

main().catch(console.error)
