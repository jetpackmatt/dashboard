/**
 * Emergency script to clean up stale cron locks
 * Run this when database is unhealthy due to stuck locks
 */

const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function cleanupStaleLocks() {
  console.log('[Cleanup] Checking for stale locks...')

  // Delete all expired locks
  const { data: expiredLocks, error: selectError } = await supabase
    .from('cron_locks')
    .select('*')
    .lt('expires_at', new Date().toISOString())

  if (selectError) {
    console.error('[Cleanup] Error selecting locks:', selectError)
    return
  }

  console.log(`[Cleanup] Found ${expiredLocks?.length || 0} expired locks`)

  if (expiredLocks && expiredLocks.length > 0) {
    const { error: deleteError } = await supabase
      .from('cron_locks')
      .delete()
      .lt('expires_at', new Date().toISOString())

    if (deleteError) {
      console.error('[Cleanup] Error deleting expired locks:', deleteError)
    } else {
      console.log(`[Cleanup] Deleted ${expiredLocks.length} expired locks`)
    }
  }

  // Show remaining locks
  const { data: remainingLocks } = await supabase
    .from('cron_locks')
    .select('*')

  console.log(`[Cleanup] Remaining locks: ${remainingLocks?.length || 0}`)
  if (remainingLocks && remainingLocks.length > 0) {
    console.table(remainingLocks)
  }
}

cleanupStaleLocks()
  .then(() => {
    console.log('[Cleanup] Done')
    process.exit(0)
  })
  .catch((err) => {
    console.error('[Cleanup] Fatal error:', err)
    process.exit(1)
  })
