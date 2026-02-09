/**
 * Distributed Cron Lock
 *
 * Prevents overlapping cron executions by using a database-backed lock.
 * If a cron job is still running when the next instance starts, the new instance exits immediately.
 */

import { createAdminClient } from '@/lib/supabase/admin'

interface CronLock {
  job_name: string
  locked_at: string
  locked_by: string
  expires_at: string
}

/**
 * Acquire a lock for a cron job
 *
 * @param jobName - Unique name for the cron job (e.g., 'sync-timelines')
 * @param lockDurationSeconds - How long the lock should last (default: 330s = 5.5 min)
 * @returns true if lock acquired, false if already locked
 */
export async function acquireCronLock(
  jobName: string,
  lockDurationSeconds: number = 330
): Promise<boolean> {
  const supabase = createAdminClient()

  // Create a unique instance ID for this execution
  const instanceId = `${jobName}-${Date.now()}-${Math.random().toString(36).substring(7)}`
  const expiresAt = new Date(Date.now() + lockDurationSeconds * 1000).toISOString()

  try {
    // Try to insert a lock
    const { data, error } = await supabase
      .from('cron_locks')
      .insert({
        job_name: jobName,
        locked_at: new Date().toISOString(),
        locked_by: instanceId,
        expires_at: expiresAt,
      })
      .select()
      .single()

    if (error) {
      // Check if it's a unique constraint violation (job already locked)
      if (error.code === '23505') {
        // Lock exists - check if it's expired
        const { data: existingLock } = await supabase
          .from('cron_locks')
          .select('expires_at')
          .eq('job_name', jobName)
          .single()

        if (existingLock) {
          const expiresAt = new Date(existingLock.expires_at)
          const now = new Date()

          if (expiresAt < now) {
            // Lock is expired - delete it and try again
            await supabase.from('cron_locks').delete().eq('job_name', jobName)

            // Retry insert
            const { error: retryError } = await supabase
              .from('cron_locks')
              .insert({
                job_name: jobName,
                locked_at: new Date().toISOString(),
                locked_by: instanceId,
                expires_at: expiresAt,
              })

            return !retryError
          }
        }

        // Lock is still valid - another instance is running
        console.log(`[CronLock] ${jobName} is already running, skipping this execution`)
        return false
      }

      // Other error - log and fail safe (allow execution)
      console.error(`[CronLock] Error acquiring lock for ${jobName}:`, error)
      return true
    }

    console.log(`[CronLock] Lock acquired for ${jobName} by ${instanceId}`)
    return true
  } catch (err) {
    console.error(`[CronLock] Exception acquiring lock for ${jobName}:`, err)
    // Fail safe - allow execution if locking fails
    return true
  }
}

/**
 * Release a lock for a cron job
 *
 * @param jobName - Unique name for the cron job
 */
export async function releaseCronLock(jobName: string): Promise<void> {
  const supabase = createAdminClient()

  try {
    await supabase.from('cron_locks').delete().eq('job_name', jobName)
    console.log(`[CronLock] Lock released for ${jobName}`)
  } catch (err) {
    console.error(`[CronLock] Error releasing lock for ${jobName}:`, err)
  }
}

/**
 * Clean up expired locks (should run periodically)
 */
export async function cleanupExpiredLocks(): Promise<number> {
  const supabase = createAdminClient()

  try {
    const { data, error } = await supabase
      .from('cron_locks')
      .delete()
      .lt('expires_at', new Date().toISOString())
      .select()

    if (error) {
      console.error('[CronLock] Error cleaning up expired locks:', error)
      return 0
    }

    const count = data?.length || 0
    if (count > 0) {
      console.log(`[CronLock] Cleaned up ${count} expired lock(s)`)
    }

    return count
  } catch (err) {
    console.error('[CronLock] Exception cleaning up expired locks:', err)
    return 0
  }
}
