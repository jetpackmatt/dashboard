# Sync Infrastructure Optimization TODO

**Status**: Database exhaustion issue temporarily mitigated by reducing cron frequency to every 3 minutes. Root cause: sync operations taking 120+ seconds when they should take ~30-40s.

**Priority**: High - Need to optimize to restore every-1-minute sync frequency

---

## Phase 1: Diagnostics (1-2 hours)

### 1.1 Add Performance Logging
- [ ] Add timing logs to `lib/shipbob/sync.ts` - `syncAll()` function
  - Time per client processing
  - Time for ShipBob API calls (per endpoint)
  - Time for database upserts
  - Time for attribution logic
- [ ] Add timing logs to `syncAllTransactions()`
- [ ] Add timing logs to `syncAllUndeliveredTimelines()`
- [ ] Deploy and monitor Vercel logs for one sync cycle
- [ ] **Expected findings**: Identify which operation(s) are taking >60s

### 1.2 Check Database Performance
- [ ] Run query analysis during a sync:
  ```sql
  SELECT pid, now() - query_start as duration, state, query
  FROM pg_stat_activity
  WHERE state != 'idle' AND query NOT LIKE '%pg_stat_activity%'
  ORDER BY duration DESC;
  ```
- [ ] Check for missing indexes:
  ```sql
  -- Undelivered shipments query (used by timeline sync)
  EXPLAIN ANALYZE
  SELECT shipment_id FROM shipments
  WHERE event_delivered IS NULL
  ORDER BY timeline_checked_at ASC NULLS FIRST
  LIMIT 100;

  -- Transaction attribution query
  EXPLAIN ANALYZE
  SELECT * FROM transactions
  WHERE client_id IS NULL AND reference_type = 'Shipment'
  LIMIT 1000;
  ```
- [ ] **Expected findings**: Slow sequential scans, missing indexes

### 1.3 Profile ShipBob API Performance
- [ ] Check if we're hitting rate limits (look for 429 responses)
- [ ] Measure average API response time per endpoint
- [ ] Check if we're making redundant API calls
- [ ] **Expected findings**: API calls taking 5-10s each, possible rate limiting

---

## Phase 2: Quick Wins (2-3 hours)

### 2.1 Add Database Indexes
Based on common queries in sync operations:

```sql
-- Timeline sync: Find undelivered shipments to check
CREATE INDEX CONCURRENTLY idx_shipments_undelivered_timeline_check
  ON shipments(timeline_checked_at)
  WHERE event_delivered IS NULL;

-- Transaction attribution: Find unattributed transactions
CREATE INDEX CONCURRENTLY idx_transactions_unattributed
  ON transactions(reference_type, client_id)
  WHERE client_id IS NULL;

-- Charge date filtering (used in transaction sync)
CREATE INDEX CONCURRENTLY idx_transactions_charge_date
  ON transactions(charge_date DESC);
```

- [ ] Run these CREATE INDEX statements in Supabase SQL editor
- [ ] Monitor index creation progress (can take 5-10 min)
- [ ] Test sync performance after indexes are created
- [ ] **Expected improvement**: 30-50% faster database queries

### 2.2 Add Connection Pooling
Currently we're not using Supabase's transaction pooling mode:

- [ ] Update `lib/supabase/admin.ts` to use pooling
- [ ] Test that connections work correctly
- [ ] Monitor connection pool usage in Supabase dashboard
- [ ] **Expected improvement**: 50-70% reduction in connection usage

### 2.3 Fix Stale Lock Cleanup
When Vercel times out a function, the lock cleanup might not run:

- [ ] Add a scheduled cleanup cron (every 5 min)
- [ ] Add to vercel.json
- [ ] **Expected improvement**: Prevents stuck locks from blocking future syncs

---

## Phase 3: Architecture Improvements (4-6 hours)

### 3.1 Parallel Client Processing
**Current**: syncAll() processes clients sequentially (3 clients × 40s = 120s)
**Target**: Process clients in parallel (3 clients in parallel = 40s max)

- [ ] Review `lib/shipbob/sync.ts` - `syncAll()` function
- [ ] Check if clients are processed with `for...of` loop (sequential) or `Promise.all()` (parallel)
- [ ] If sequential, refactor to parallel
- [ ] Test with multiple clients
- [ ] **Expected improvement**: 3x faster (120s → 40s for 3 clients)

### 3.2 Batch Database Operations
Check for N+1 query patterns:

- [ ] Review upsert operations - are we doing individual inserts in loops?
- [ ] Batch upserts into chunks of 500-1000 records
- [ ] Apply batching to all sync operations
- [ ] **Expected improvement**: 50% faster database operations

### 3.3 Optimize Timeline Sync
Timeline sync checks 100 shipments per client every 3 minutes:

- [ ] Review tiered polling logic - is it working correctly?
- [ ] Consider reducing batch size from 100 to 50 per client
- [ ] Add early exit if no shipments need checking
- [ ] **Expected improvement**: 30% faster timeline sync

---

## Phase 4: Long-term Optimization (Optional - 8+ hours)

### 4.1 Implement Webhook Alternative
- [ ] Research ShipBob webhook capabilities
- [ ] Set up webhook endpoint for order/shipment updates
- [ ] Add webhook signature verification
- [ ] Keep cron as backup for missed webhooks
- [ ] **Expected improvement**: Eliminate most polling, near-instant updates

### 4.2 Add Caching Layer
- [ ] Cache client credentials (currently queried every sync)
- [ ] Cache product inventory IDs for attribution
- [ ] Use Redis or Vercel KV for caching
- [ ] **Expected improvement**: 20-30% faster sync by reducing DB queries

### 4.3 Optimize Transaction Attribution
- [ ] Pre-build attribution lookup tables (shipment_id → client_id)
- [ ] Update lookup tables incrementally instead of full scan
- [ ] Consider materialized view for attribution
- [ ] **Expected improvement**: 40% faster transaction attribution

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Sync duration | 120s | 30-40s |
| Cron frequency | Every 3 min | Every 1 min |
| Connection pool usage | 100% (exhausted) | <50% |
| Database health | Unhealthy (2x/day) | Healthy 24/7 |
| Lock timeouts | 10-20/day | 0/day |

---

## Deployment Checklist

After implementing fixes:
- [ ] Test in development with `npm run dev`
- [ ] Monitor connection pool usage in Supabase dashboard
- [ ] Deploy to Vercel and monitor cron logs for 1 hour
- [ ] Check for "Another instance is already running" messages (locks working)
- [ ] Check for timeout errors (should be gone)
- [ ] Verify all syncs complete in <60s
- [ ] Gradually reduce cron frequency back to every 1 minute
- [ ] Monitor database health for 24 hours

---

## Emergency Rollback

If database becomes unhealthy again:
1. Run `node scripts/cleanup-stale-locks.js` to clear stuck locks
2. Restart Supabase project (Settings → Restart)
3. Increase cron frequencies back to every 3 minutes
4. Review Vercel logs for errors
5. Check connection pool usage in Supabase dashboard

---

**Note**: Start with Phase 1 (Diagnostics) to identify the bottleneck before implementing fixes. Don't optimize blindly - measure first, then optimize the slowest part.

**Supabase Plan Info**: Currently on Pro ($25/mo, 200 connections). Team plan ($599/mo, 400 connections) or Enterprise (custom, unlimited) available but should optimize before upgrading.
