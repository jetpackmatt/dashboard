#!/usr/bin/env node
/**
 * Cleanup: Remove orphaned/legacy shipment records for Henson
 * - Legacy records (NULL shipment_id) from old sync format
 * - Stale records (shipments no longer exist in ShipBob API)
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const HENSON_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

async function cleanup() {
  console.log('=== HENSON SHIPMENT CLEANUP ===\n')

  // Step 1: Count before cleanup
  const { count: beforeCount } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', HENSON_ID)

  const { count: nullCarrierBefore } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', HENSON_ID)
    .is('carrier_service', null)

  console.log('BEFORE CLEANUP:')
  console.log(`  Total shipments: ${beforeCount}`)
  console.log(`  NULL carrier_service: ${nullCarrierBefore}`)

  // Step 2: Delete legacy records (NULL shipment_id)
  console.log('\n--- Deleting legacy records (NULL shipment_id) ---')
  const { count: legacyDeleted } = await supabase
    .from('shipments')
    .delete({ count: 'exact' })
    .eq('client_id', HENSON_ID)
    .is('shipment_id', null)

  console.log(`Deleted: ${legacyDeleted} legacy records`)

  // Step 3: Delete stale records (NULL carrier_service but HAS shipment_id)
  // These are shipments that no longer exist in ShipBob
  console.log('\n--- Deleting stale records (NULL carrier_service with shipment_id) ---')
  const { count: staleDeleted } = await supabase
    .from('shipments')
    .delete({ count: 'exact' })
    .eq('client_id', HENSON_ID)
    .is('carrier_service', null)
    .not('shipment_id', 'is', null)

  console.log(`Deleted: ${staleDeleted} stale records`)

  // Step 4: Count after cleanup
  const { count: afterCount } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', HENSON_ID)

  const { count: nullCarrierAfter } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', HENSON_ID)
    .is('carrier_service', null)

  console.log('\nAFTER CLEANUP:')
  console.log(`  Total shipments: ${afterCount}`)
  console.log(`  NULL carrier_service: ${nullCarrierAfter}`)
  console.log(`  Total deleted: ${beforeCount - afterCount}`)

  console.log('\n=== CLEANUP COMPLETE ===')
  console.log('Run sync-henson-test.js to re-sync with proper data.')
}

cleanup().catch(console.error)
