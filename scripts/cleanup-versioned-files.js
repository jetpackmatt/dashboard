#!/usr/bin/env node

/**
 * Remove the versioned files I created and ensure DB points to correct non-versioned files
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  console.log('=== Cleaning up versioned files ===\n')

  // Delete versioned Henson files
  const hensonVersionedFiles = [
    '6b94c274-0446-4167-9d02-b998f8be59ad/JPHS-0042-010526/JPHS-0042-010526-v3.pdf',
    '6b94c274-0446-4167-9d02-b998f8be59ad/JPHS-0042-010526/JPHS-0042-010526-v3-details.xlsx'
  ]

  console.log('Deleting Henson versioned files...')
  const { error: hensonError } = await supabase.storage
    .from('invoices')
    .remove(hensonVersionedFiles)

  if (hensonError) {
    console.error('Error deleting Henson versioned files:', hensonError.message)
  } else {
    console.log('  Deleted versioned Henson files')
  }

  // Delete versioned Eli Health files
  const eliVersionedFiles = [
    'e6220921-695e-41f9-9f49-af3e0cdc828a/JPEH-0004-010526/JPEH-0004-010526-v2.pdf',
    'e6220921-695e-41f9-9f49-af3e0cdc828a/JPEH-0004-010526/JPEH-0004-010526-v2-details.xlsx'
  ]

  console.log('Deleting Eli Health versioned files...')
  const { error: eliError } = await supabase.storage
    .from('invoices')
    .remove(eliVersionedFiles)

  if (eliError) {
    console.error('Error deleting Eli Health versioned files:', eliError.message)
  } else {
    console.log('  Deleted versioned Eli Health files')
  }

  // List what's left in each folder to confirm
  console.log('\n=== Verifying cleanup ===\n')

  const { data: hensonFiles } = await supabase.storage
    .from('invoices')
    .list('6b94c274-0446-4167-9d02-b998f8be59ad/JPHS-0042-010526')

  console.log('Henson folder contents:')
  for (const f of hensonFiles || []) {
    console.log('  ', f.name)
  }

  const { data: eliFiles } = await supabase.storage
    .from('invoices')
    .list('e6220921-695e-41f9-9f49-af3e0cdc828a/JPEH-0004-010526')

  console.log('\nEli Health folder contents:')
  for (const f of eliFiles || []) {
    console.log('  ', f.name)
  }

  console.log('\n✅ Cleanup complete')
}

main().catch(console.error)
