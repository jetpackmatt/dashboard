# Sync Performance Profiling Plan

## Hypothesis: Syncs should take ~30s but are taking 120s+

### Step 1: Add Timing Logs
Add timestamps to each major operation in sync route:
- Time per client processing
- Time for ShipBob API calls
- Time for database upserts

### Step 2: Check Database Indexes
Missing indexes on:
- `shipments.timeline_checked_at WHERE event_delivered IS NULL`
- `transactions.charge_date`
- `shipments.shipment_id` (should already exist)

### Step 3: Check for N+1 Queries
Are we doing individual queries in loops instead of bulk operations?

### Step 4: ShipBob API Rate Limits
Are we hitting rate limits causing delays?

### Step 5: Parallel vs Sequential
Are we processing clients in parallel or one at a time?

## Expected Results:
- Each client should take ~10-15s max
- With 3 clients = ~45s total if parallel, ~135s if sequential
- Database queries should be <100ms each

## Action Items:
1. Add performance logging to sync routes
2. Add missing database indexes
3. Switch from sequential to parallel client processing
4. Consider caching frequently accessed data
