/**
 * Migration: Update user_clients.role constraint from 'admin' to 'owner'
 *
 * Run with: npx tsx scripts/migrate-role-constraint.ts
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

// Load environment variables
dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing environment variables:')
  console.error('- NEXT_PUBLIC_SUPABASE_URL:', supabaseUrl ? '✓' : '✗')
  console.error('- SUPABASE_SERVICE_ROLE_KEY:', serviceRoleKey ? '✓' : '✗')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})

async function runMigration() {
  console.log('🚀 Starting migration: user_clients.role constraint update\n')

  // Step 1: Check current state
  console.log('Step 1: Checking current user_clients data...')
  const { data: currentData, error: fetchError } = await supabase
    .from('user_clients')
    .select('id, user_id, role')

  if (fetchError) {
    console.error('Failed to fetch user_clients:', fetchError.message)
    process.exit(1)
  }

  console.log(`Found ${currentData?.length || 0} user_client records`)

  if (currentData && currentData.length > 0) {
    const roleCounts = currentData.reduce((acc, row) => {
      acc[row.role] = (acc[row.role] || 0) + 1
      return acc
    }, {} as Record<string, number>)
    console.log('Current role distribution:', roleCounts)
  }

  // Step 2: Update any 'admin' roles to 'owner'
  const adminRecords = currentData?.filter(r => r.role === 'admin') || []

  if (adminRecords.length > 0) {
    console.log(`\nStep 2: Updating ${adminRecords.length} 'admin' records to 'owner'...`)

    const { error: updateError } = await supabase
      .from('user_clients')
      .update({ role: 'owner' })
      .eq('role', 'admin')

    if (updateError) {
      console.error('Failed to update roles:', updateError.message)
      process.exit(1)
    }
    console.log('✓ Role updates complete')
  } else {
    console.log('\nStep 2: No admin roles to update (skipping)')
  }

  // Step 3: The constraint update needs to be done via Supabase SQL Editor
  // because RPC calls for DDL aren't available via the JS client
  console.log('\n' + '='.repeat(60))
  console.log('⚠️  MANUAL STEP REQUIRED')
  console.log('='.repeat(60))
  console.log('\nThe CHECK constraint must be updated via the Supabase SQL Editor.')
  console.log('Go to: https://supabase.com/dashboard → SQL Editor → Run:\n')
  console.log(`
-- Drop existing constraint (if any)
ALTER TABLE user_clients DROP CONSTRAINT IF EXISTS user_clients_role_check;

-- Add new constraint with correct values
ALTER TABLE user_clients ADD CONSTRAINT user_clients_role_check
  CHECK (role IN ('owner', 'editor', 'viewer'));
`.trim())
  console.log('\n' + '='.repeat(60))

  // Step 4: Verify final state
  console.log('\nStep 4: Verifying final state...')
  const { data: finalData, error: finalError } = await supabase
    .from('user_clients')
    .select('id, user_id, role')

  if (finalError) {
    console.error('Failed to verify:', finalError.message)
    process.exit(1)
  }

  if (finalData && finalData.length > 0) {
    const finalRoleCounts = finalData.reduce((acc, row) => {
      acc[row.role] = (acc[row.role] || 0) + 1
      return acc
    }, {} as Record<string, number>)
    console.log('Final role distribution:', finalRoleCounts)

    const hasAdmin = finalData.some(r => r.role === 'admin')
    if (!hasAdmin) {
      console.log('✓ No more "admin" roles - data migration complete!')
    } else {
      console.error('✗ Some records still have "admin" role')
    }
  } else {
    console.log('No user_clients records exist yet')
  }

  console.log('\n✅ Migration script complete')
}

runMigration().catch(console.error)
