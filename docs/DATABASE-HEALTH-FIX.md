# Database Health Crisis - Root Cause & Fix Plan

**Date**: February 9, 2026
**Status**: CRITICAL - Database repeatedly becoming unhealthy
**Root Cause**: Connection pool exhaustion from overlapping cron executions

---

## The Problem

Your Supabase database becomes "unhealthy" because **concurrent cron jobs exhaust the connection pool**.

### How It Happens

1. **Overlapping Cron Jobs**: Cron jobs run every **1 minute** but take **2-5 minutes** to complete:
   - `sync-timelines`: 300s max, runs every 60s → **up to 5 concurrent instances**
   - `sync-transactions`: 300s max, runs every 60s → **up to 5 concurrent instances**
   - `sync`: 120s max, runs every 60s → **up to 2 concurrent instances**

2. **Connection Pool Limits**:
   - Supabase connection pool: **~60-200 connections** (depending on plan/pooler)
   - Your usage during peak: **30-100+ concurrent connections** (3-4 crons × 2-5 instances × 3-5 connections each)
   - **Result**: Pool exhausted → all queries fail → database appears "unhealthy"

3. **Evidence from Logs** (Feb 9, 14:45-14:52):
   - Multiple timeout errors across all cron jobs
   - 504 Gateway Timeout after 300 seconds
   - Cascading failures (once pool exhausted, everything fails)

---

## Immediate Fixes (DO THESE NOW)

### 1. Run Database Migration (1 minute)

Create the `cron_locks` table to enable distributed locking:

```bash
# Connect to your Supabase SQL Editor and run:
cat scripts/migrate-cron-locks.sql
```

Or via Supabase CLI:
```bash
supabase db push
```

### 2. Apply Lock to Remaining Cron Jobs (10 minutes)

I've already updated `sync-timelines` as an example. Apply the same pattern to:

- ✅ `sync-timelines` (DONE)
- ⬜ `sync-transactions`
- ⬜ `sync`
- ⬜ `sync-reconcile`
- ⬜ `sync-older-nightly`
- ⬜ `sync-backfill-items`

**Pattern to apply**:

```typescript
import { acquireCronLock, releaseCronLock } from '@/lib/cron-lock'

export async function GET(request: NextRequest) {
  // ... auth check ...

  // CRITICAL: Prevent overlapping executions
  const lockAcquired = await acquireCronLock('CRON_NAME', DURATION_SECONDS)
  if (!lockAcquired) {
    console.log('[Cron] Another instance is already running, skipping')
    return NextResponse.json({
      success: true,
      skipped: true,
      reason: 'Another instance is already running',
    })
  }

  try {
    // ... do work ...
    await releaseCronLock('CRON_NAME')
    return NextResponse.json({ success: true })
  } catch (error) {
    await releaseCronLock('CRON_NAME')  // Release even on error
    throw error
  }
}
```

**Lock durations by cron**:
- `sync-timelines`: 330s (5.5 min - allows 300s max + buffer)
- `sync-transactions`: 330s
- `sync`: 150s (2.5 min - allows 120s max + buffer)
- `sync-reconcile`: 330s
- `sync-older-nightly`: 330s
- `sync-backfill-items`: 330s

### 3. Deploy to Vercel (2 minutes)

Once you've applied locks to all heavy cron jobs:

```bash
git add .
git commit -m "Fix: Add distributed locking to prevent overlapping cron executions

- Prevents connection pool exhaustion from concurrent cron instances
- Adds cron_locks table for database-backed locking
- Applied to sync-timelines, sync-transactions, sync, etc."
git push
```

Vercel will auto-deploy. Monitor the logs to ensure no more overlaps.

---

## Medium-Term Improvements (DO WITHIN 1 WEEK)

### 1. Add Lock Cleanup Cron

Expired locks should be cleaned up automatically. Add a new cron:

**File**: `app/api/cron/cleanup-locks/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { cleanupExpiredLocks } from '@/lib/cron-lock'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cleaned = await cleanupExpiredLocks()

  return NextResponse.json({
    success: true,
    locksDeleted: cleaned,
  })
}

export async function POST(request: NextRequest) {
  return GET(request)
}
```

**Add to vercel.json**:
```json
{
  "path": "/api/cron/cleanup-locks",
  "schedule": "0 */6 * * *"  // Every 6 hours
}
```

### 2. Reduce Cron Frequencies

Some cron jobs may not need to run **every minute**. Consider:

| Cron | Current | Recommended | Reasoning |
|------|---------|-------------|-----------|
| `sync-timelines` | Every 1 min | **Every 5 min** | Timeline events don't update that frequently |
| `sync-transactions` | Every 1 min | **Every 2 min** | 3-min lookback window allows 2-min frequency |
| `sync` | Every 1 min | Keep | Orders/shipments need near-real-time updates |
| `advance-claims` | Every 5 min | Keep | Already reasonable |

**Example change in vercel.json**:
```json
{
  "path": "/api/cron/sync-timelines",
  "schedule": "*/5 * * * *"  // Every 5 minutes instead of 1
}
```

### 3. Optimize Heavy Queries

Add indexes to speed up common queries. Examples:

```sql
-- Speed up timeline sync (filters by event_delivered and timeline_checked_at)
CREATE INDEX IF NOT EXISTS idx_shipments_undelivered_timeline_check
  ON shipments(timeline_checked_at)
  WHERE event_delivered IS NULL AND deleted_at IS NULL;

-- Speed up transaction sync (filters by client_id null)
CREATE INDEX IF NOT EXISTS idx_transactions_unattributed
  ON transactions(reference_type, client_id)
  WHERE client_id IS NULL;
```

---

## Long-Term Optimizations (DO WITHIN 1 MONTH)

### 1. Upgrade Supabase Plan

If connection limits are still tight after fixes:

- **Current**: Likely Micro/Pro plan (~60-200 connections)
- **Upgrade to**: Team plan (300+ connections)
- **Cost**: Check Supabase pricing (likely $25-99/month increase)

### 2. Implement Query Result Caching

Reduce database load by caching frequently-accessed data:

```typescript
// Example: Cache client tokens for 5 minutes
import { unstable_cache } from 'next/cache'

export const getClientTokenCached = unstable_cache(
  async (clientId: string) => {
    return await getClientToken(clientId)
  },
  ['client-token'],
  { revalidate: 300 } // 5 minutes
)
```

### 3. Move Heavy Analytics to Background Jobs

Some dashboard queries could run as background jobs instead of on-demand:

- Transit benchmarks calculation (already daily cron ✅)
- Commission calculations (already monthly cron ✅)
- Delivery IQ risk assessment (already every 15 min ✅)

---

## Monitoring & Prevention

### 1. Add Connection Pool Monitoring

Track connection usage in Supabase:

1. Go to **Supabase Dashboard** → **Database** → **Monitoring**
2. Watch **Active Connections** metric
3. Set alert if connections > 80% of limit

### 2. Add Cron Lock Metrics

Monitor lock acquisition failures:

```typescript
// Add to each cron route
if (!lockAcquired) {
  console.warn(`[Cron ${jobName}] Lock acquisition failed - previous instance still running`)
  // Could send to monitoring service (Sentry, Datadog, etc.)
}
```

### 3. Vercel Function Logs

After deploying fixes, verify in Vercel logs:

- ✅ Should see: "Another instance is already running, skipping"
- ❌ Should NOT see: Multiple concurrent executions with same timestamp

---

## Success Criteria

After implementing these fixes, you should see:

1. ✅ **No more "database unhealthy" alerts**
2. ✅ **Cron logs show "skipped" messages** when overlaps would have occurred
3. ✅ **Connection pool usage stays below 70%**
4. ✅ **All cron jobs complete successfully** (no more 504 timeouts)
5. ✅ **Users can log in consistently** (no more "unhealthy" errors)

---

## Emergency Procedure (If Database Becomes Unhealthy Again)

**Before you had to restart Supabase project. Now:**

1. **Check Supabase Dashboard** → Database → Monitoring → Active Connections
2. **If connections are maxed out**:
   - Go to SQL Editor
   - Run: `SELECT * FROM cron_locks WHERE expires_at < NOW();`
   - Delete expired locks: `DELETE FROM cron_locks WHERE expires_at < NOW();`
3. **If that doesn't help**:
   - Temporarily disable heavy crons in Vercel dashboard
   - Wait 5 minutes for existing executions to complete
   - Re-enable crons one at a time

**Only restart Supabase project as last resort** (kills all connections but causes downtime).

---

## Files Changed

- ✅ Created: `lib/cron-lock.ts` - Distributed locking mechanism
- ✅ Created: `scripts/migrate-cron-locks.sql` - Database migration
- ✅ Updated: `app/api/cron/sync-timelines/route.ts` - Added locking
- ⬜ TODO: Update remaining cron routes (sync-transactions, sync, etc.)
- ⬜ TODO: Add cleanup-locks cron
- ⬜ TODO: Adjust cron frequencies in vercel.json (optional)

---

## Questions?

- **Why not use Redis for locks?** - Database-backed locks are simpler, no new infrastructure needed
- **What if a job crashes before releasing lock?** - Locks expire automatically after `lockDurationSeconds`
- **Will this slow down syncing?** - No, it prevents overlaps but jobs still run on schedule
- **Can I manually trigger a locked cron?** - Yes, POST to the endpoint - it will skip if locked

---

**Next Steps**:
1. Run the migration (1 min)
2. Apply locks to remaining crons (10 min)
3. Deploy and monitor (2 min)
4. Celebrate fixing a critical production issue! 🎉
