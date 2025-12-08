/**
 * Fix invoice_id_jp to use human-readable invoice numbers
 *
 * Currently: invoice_id_jp = UUID (e.g., "23e99fe1-2af7-4022-a2a0-4fe9071b3151")
 * Should be: invoice_id_jp = invoice_number (e.g., "JPHS-0001-032425")
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const DRY_RUN = process.argv.includes('--dry-run')
const BATCH_SIZE = 1000

async function fix() {
  console.log('=== FIX invoice_id_jp TO HUMAN-READABLE ===')
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}\n`)

  // Step 1: Build UUID → invoice_number map
  console.log('Step 1: Building UUID → invoice_number map...')
  const { data: invoices } = await supabase
    .from('invoices_jetpack')
    .select('id, invoice_number')

  const uuidToNumber = new Map()
  invoices?.forEach(inv => {
    uuidToNumber.set(inv.id, inv.invoice_number)
  })

  console.log(`Found ${uuidToNumber.size} invoices`)

  // Step 2: Get all unique invoice_id_jp UUIDs from transactions (with pagination)
  console.log('\nStep 2: Getting unique invoice_id_jp values from transactions...')

  let allIds = []
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from('transactions')
      .select('invoice_id_jp')
      .not('invoice_id_jp', 'is', null)
      .range(offset, offset + BATCH_SIZE - 1)

    if (error) {
      console.log('Error fetching:', error.message)
      break
    }
    if (!data || data.length === 0) break

    allIds = allIds.concat(data)
    offset += BATCH_SIZE
    if (data.length < BATCH_SIZE) break
  }

  console.log(`Fetched ${allIds.length} transactions with invoice_id_jp`)

  // Get unique UUIDs that are actually UUIDs (36 char format)
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const uniqueUuids = [...new Set(allIds.map(r => r.invoice_id_jp))]
    .filter(id => uuidPattern.test(id))

  console.log(`Found ${uniqueUuids.length} unique UUID-format invoice_id_jp values`)

  // Check if any are already invoice numbers (not UUIDs)
  const alreadyReadable = [...new Set(allIds.map(r => r.invoice_id_jp))]
    .filter(id => !uuidPattern.test(id))

  if (alreadyReadable.length > 0) {
    console.log(`Note: ${alreadyReadable.length} already have readable format:`, alreadyReadable.slice(0, 5))
  }

  // Step 3: Update transactions for each UUID
  console.log('\nStep 3: Updating transactions...')

  let totalUpdated = 0
  let totalFailed = 0

  for (const uuid of uniqueUuids) {
    const invoiceNumber = uuidToNumber.get(uuid)

    if (!invoiceNumber) {
      console.log(`  WARNING: No invoice_number found for UUID ${uuid}`)
      totalFailed++
      continue
    }

    if (DRY_RUN) {
      console.log(`  Would update: ${uuid} → ${invoiceNumber}`)
      continue
    }

    // Update all transactions with this UUID
    const { data, error, count } = await supabase
      .from('transactions')
      .update({ invoice_id_jp: invoiceNumber })
      .eq('invoice_id_jp', uuid)
      .select('id')

    if (error) {
      console.log(`  ERROR updating ${uuid}: ${error.message}`)
      totalFailed++
    } else {
      const updatedCount = data?.length || 0
      totalUpdated += updatedCount
      console.log(`  ${uuid} → ${invoiceNumber}: ${updatedCount} transactions`)
    }
  }

  console.log('\n=== SUMMARY ===')
  console.log(`Total UUIDs processed: ${uniqueUuids.length}`)
  console.log(`Total transactions updated: ${totalUpdated}`)
  console.log(`Failed/skipped: ${totalFailed}`)

  if (DRY_RUN) {
    console.log('\n[DRY RUN] No changes made')
  }

  console.log('\n=== COMPLETE ===')
}

fix().catch(console.error)
