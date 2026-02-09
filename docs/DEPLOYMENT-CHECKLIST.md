# Database Health Fix - Deployment Checklist

**Date**: February 9, 2026
**Issue**: Database connection pool exhaustion from overlapping cron jobs

---

## ✅ Changes Applied

### 1. Created Distributed Locking System
- ✅ `lib/cron-lock.ts` - Locking mechanism
- ✅ `scripts/migrate-cron-locks.sql` - Database migration

### 2. Updated Cron Jobs with Locks
- ✅ `app/api/cron/sync-timelines/route.ts` - Added 330s lock
- ✅ `app/api/cron/sync-transactions/route.ts` - Added 330s lock
- ✅ `app/api/cron/sync/route.ts` - Added 150s lock
- ✅ `app/api/cron/sync-reconcile/route.ts` - Added 330s lock

### 3. Reduced Cron Frequencies
- ✅ `sync-timelines`: Every 1 min → **Every 3 min** (vercel.json)
- ✅ `sync-transactions`: Every 1 min → **Every 2 min** (vercel.json)
- ⚪ `sync`: Kept at every 1 min (but now locked to prevent overlaps)

---

## 📋 Deployment Steps

### Step 1: Run Database Migration (REQUIRED)

**Via Supabase Dashboard** (recommended):
1. Go to https://supabase.com/dashboard/project/xhehiuanvcowiktcsmjr/sql/new
2. Copy/paste contents of `scripts/migrate-cron-locks.sql`
3. Click "Run"

**Via psql** (alternative):
```bash
psql "postgresql://postgres:[PASSWORD]@db.xhehiuanvcowiktcsmjr.supabase.co:5432/postgres" \
  -f scripts/migrate-cron-locks.sql
```

### Step 2: Commit and Deploy

```bash
git add .
git commit -m "Fix: Prevent database connection pool exhaustion

- Add distributed locking to prevent overlapping cron executions
- Reduce sync-timelines frequency (1min → 3min)
- Reduce sync-transactions frequency (1min → 2min)
- Add cron_locks table for database-backed locking

This fixes the recurring 'database unhealthy' issue caused by
concurrent cron jobs exhausting Supabase's connection pool.

Locks added to:
- sync-timelines (330s)
- sync-transactions (330s)
- sync (150s)
- sync-reconcile (330s)"

git push
```

Vercel will automatically deploy (watch at https://vercel.com/dashboard)

### Step 3: Monitor Deployment

After deployment (5-10 minutes):

1. **Check Vercel Function Logs**:
   - Go to https://vercel.com/dashboard → Functions → Logs
   - Look for: `"Another instance is already running, skipping"`
   - This confirms locks are working

2. **Check Supabase Health**:
   - Go to https://supabase.com/dashboard/project/xhehiuanvcowiktcsmjr/database
   - Monitor "Active Connections" metric
   - Should stay below 50% (was hitting 100% before)

3. **Verify No Timeouts**:
   - Watch for 10-15 minutes
   - Should see no more 504 Gateway Timeout errors
   - All cron jobs should complete successfully

---

## 🎯 Expected Results

### Before Fix
- ❌ Database becomes "unhealthy" every few hours
- ❌ Connection pool exhausted (60-100+ concurrent connections)
- ❌ Cron jobs timing out after 300s
- ❌ Users can't log in (database unreachable)
- ❌ Manual Supabase project restart required

### After Fix
- ✅ Database stays healthy 24/7
- ✅ Connection pool usage stays below 50%
- ✅ Cron jobs complete successfully (no timeouts)
- ✅ Users can always log in
- ✅ No manual intervention needed

---

## 🔍 How to Verify It's Working

### 1. Check Cron Locks Table

After first cron execution:
```sql
SELECT * FROM cron_locks;
```

Should show active locks during execution, empty when idle.

### 2. Check Vercel Logs

Look for these patterns:

**Good (lock working)**:
```
[Cron Timeline] Another instance is already running, skipping this execution
```

**Good (lock released)**:
```
[CronLock] Lock released for sync-timelines
```

**Bad (would indicate lock failure)**:
```
Multiple concurrent "Starting timeline sync..." messages with same timestamp
```

### 3. Monitor Connection Pool

Supabase Dashboard → Database → Monitoring → Active Connections:
- **Before**: Spikes to 100% → database unhealthy
- **After**: Steady at 20-40% → healthy

---

## 🚨 Emergency Procedures

### If Database Still Becomes Unhealthy

**First: Check for expired locks**
```sql
-- View expired locks
SELECT * FROM cron_locks WHERE expires_at < NOW();

-- Clean up expired locks
DELETE FROM cron_locks WHERE expires_at < NOW();
```

**Second: Temporarily disable heavy crons**
1. Go to Vercel Dashboard → Settings → Cron Jobs
2. Pause `sync-timelines` and `sync-transactions`
3. Wait 5 minutes for active executions to complete
4. Re-enable one at a time

**Last Resort: Restart Supabase**
- Only if nothing else works
- Supabase Dashboard → Project Settings → Restart Project
- Causes ~2 minutes of downtime

---

## 📊 Connection Math

### Before Fix (Overlapping Executions)
- `sync-timelines`: 5 concurrent × 5 connections = 25
- `sync-transactions`: 5 concurrent × 5 connections = 25
- `sync`: 2 concurrent × 5 connections = 10
- **Total: 60+ connections** → Pool exhausted!

### After Fix (Locked Executions)
- `sync-timelines`: 1 instance × 5 connections = 5
- `sync-transactions`: 1 instance × 5 connections = 5
- `sync`: 1 instance × 5 connections = 5
- **Total: ~15 connections** → Healthy!

---

## 📝 Next Steps (Optional Improvements)

1. **Add lock cleanup cron** (prevents stale locks):
   - See `docs/DATABASE-HEALTH-FIX.md` for implementation

2. **Add database indexes** (speed up heavy queries):
   ```sql
   CREATE INDEX idx_shipments_undelivered_timeline_check
     ON shipments(timeline_checked_at)
     WHERE event_delivered IS NULL;
   ```

3. **Monitor connection pool usage**:
   - Set up Supabase alerts for >70% connection usage

---

## ✅ Success Criteria

After 24 hours of deployment:
- ✅ Zero "database unhealthy" incidents
- ✅ Zero cron timeout errors (504)
- ✅ Connection pool never exceeds 50%
- ✅ All cron jobs execute on schedule
- ✅ Users report no login issues

---

**Status**: Ready to deploy! Run migration, commit, push. 🚀
