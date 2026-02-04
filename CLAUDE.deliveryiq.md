# Delivery IQ (Lookout) System

**Read this when:** Working on proactive shipment monitoring, at-risk detection, transit benchmarks, tracking timeline, AI assessments, or the Delivery Intelligence Engine.

---

## Overview

Delivery IQ (also called "Lookout") proactively identifies shipments that may be Lost in Transit BEFORE customers file claims. It uses transit benchmarks and carrier checkpoint data to detect shipments that are taking longer than expected.

**Key capabilities:**
1. **Monitoring** - Track all in-transit shipments automatically
2. **Detection** - Identify at-risk shipments before they become lost
3. **Intelligence** - AI-powered probability scoring and insights (coming soon)
4. **Claims** - Automated claim filing when shipments are likely lost

---

## System Architecture

```
ShipBob (Shipments) → Our Database → TrackingMore API → Lost-in-Transit Detection
                                           ↓                     ↓
                                    Tracking Events      Eligibility Status
                                           ↓                     ↓
                              Delivery Intelligence Engine (AI probability)
                                           ↓
                              Delivery IQ Dashboard (Lookout Page)
                                           ↓
                                  Claim Filing → Care Tickets
```

---

## Entry Criteria

Shipments enter Delivery IQ monitoring when they exceed their expected transit time:

### Dynamic Threshold (Benchmark-Based)

```
threshold = benchmark_avg × 1.30 (30% buffer above average)
```

**Domestic shipments:** Uses carrier + zone benchmarks
- Example: USPS Zone 5 avg is 5.6 days → threshold = 8 days (5.6 × 1.30 = 7.28, rounded up)

**International shipments:** Uses carrier + route benchmarks
- Example: DHL Express US→AU avg is 6.7 days → threshold = 9 days (6.7 × 1.30 = 8.71, rounded up)

### Fallback Thresholds

When no benchmark data exists:
- **Domestic:** 8 days
- **International:** 12 days

---

## Eligibility Statuses

| Status | Meaning | UI Display | Action |
|--------|---------|------------|--------|
| `at_risk` | Exceeds threshold, but < 15/21 days since last scan | Amber "At Risk" badge | Monitor |
| `eligible` | ≥ 15/21 days since last scan OR carrier admits lost | Red "Ready to File" badge | Can file claim |
| `claim_filed` | Claim has been submitted | Gray "Claim Filed" badge | Track claim status |
| `approved` | Claim was approved | Green badge | Complete |
| `denied` | Claim was denied | Red badge | Appeal or close |
| `missed_window` | Exceeded maximum claim window | Strikethrough | Too late |

### Eligibility Thresholds

| Shipment Type | Minimum Days Silent | Maximum Claim Window |
|---------------|---------------------|---------------------|
| Domestic | 15 days | 60 days |
| International | 21 days | 90 days |

### Automatic Eligibility (Lost Status Detection)

Certain carrier scan descriptions automatically trigger eligibility regardless of days silent:

```typescript
const LOST_STATUS_PATTERNS = [
  /^lost,/i,                    // TrackingMore normalized status
  /unable to locate/i,          // USPS, FedEx
  /cannot be located/i,
  /missing mail search/i,       // USPS
  /package is lost/i,
  /declared lost/i,
  /presumed lost/i,
]
```

---

## Transit Benchmarks

Benchmarks are calculated daily from the last 90 days of delivered shipments.

### Benchmark Types

| Type | Key Format | Example | Storage |
|------|------------|---------|---------|
| `carrier_service` | Carrier name | `USPS` | Zone averages (zone_1_avg through zone_10_avg) |
| `ship_option` | ShipBob ship option ID | `146` | Zone averages |
| `international_route` | `carrier:origin:destination` | `DHLExpress:US:AU` | zone_1_avg only |

### Sample Benchmarks

**Domestic (by zone):**
| Carrier | Zone 1 | Zone 2 | Zone 3 | Zone 4 | Zone 5 |
|---------|--------|--------|--------|--------|--------|
| USPS | 4.7 | 4.2 | 4.6 | 4.9 | 5.6 |
| FedEx | 2.6 | 2.6 | 2.2 | 3.6 | 3.5 |
| Amazon | 2.9 | 3.5 | 3.4 | 3.8 | 4.5 |
| OnTrac | 2.4 | 3.4 | 3.5 | 3.6 | 4.1 |

**International (by carrier + route):**
| Carrier | Route | Avg Days |
|---------|-------|----------|
| DHLExpress | US → AU | 6.7 |
| DHLExpress | US → GB | 5.3 |
| DHLExpress | US → MX | 5.1 |
| DHLExpress | US → ZA | 8.8 |
| Passport | US → CA | 6.6 |

---

## Cron Jobs

| Path | Schedule | Purpose | Cost |
|------|----------|---------|------|
| `/api/cron/calculate-benchmarks` | Daily 4 AM UTC | Recalculates transit benchmarks | FREE |
| `/api/cron/monitoring-entry` | Hourly | Adds new shipments that exceed thresholds | $0.04/shipment (TrackingMore) |
| `/api/cron/sync-at-risk` | Daily 3 AM UTC | Finds old undelivered shipments | $0.04/shipment |
| `/api/cron/recheck-at-risk` | Hourly | Recheck existing tracked shipments | FREE |
| `/api/cron/advance-claims` | Every 5 min | Advance claim workflow | FREE |
| `/api/cron/ai-reassess` | Every 15 min | AI reassessment of at-risk shipments | Haiku tokens |

---

## TrackingMore Integration

### Cost Structure
- **Create tracking (POST):** $0.04 per shipment (one-time)
- **Get tracking (GET):** FREE (unlimited)

### Carrier Code Mapping

| ShipBob Carrier | TrackingMore Code |
|-----------------|-------------------|
| USPS | usps |
| FedEx | fedex |
| UPS | ups |
| DHL Express / DHLExpress | dhl |
| Amazon Shipping | amazon |
| OnTrac | ontrac |
| OSMWorldwide | osmworldwide |
| UniUni | uniuni |
| Passport | passportshipping |

---

## Delivery Intelligence Engine (Scout)

### Overview

The Delivery Intelligence Engine ("Scout") uses **survival analysis**—mathematical modeling of time-to-event data—to predict delivery probability. Instead of simple heuristics, it calculates the actual likelihood a package will be delivered based on patterns from a full year of historical outcomes.

### Two-Tier Data Strategy

| Tier | Data Source | Availability | Granularity |
|------|-------------|--------------|-------------|
| **Tier 1** | ShipBob `event_*` fields | Always (11 months) | 5-6 state transitions |
| **Tier 2** | TrackingMore checkpoints (`tracking_checkpoints` table) | **Permanently** stored | 10-30 granular scans |

**When to use each tier:**
- **Tier 2 (preferred):** Use TrackingMore checkpoints whenever available - this is the granular, per-facility timing data
- **Tier 1 (fallback only):** For shipments without checkpoint data (older shipments before we started storing, or shipments that were never flagged as at-risk)

### The Core Insight: Time-in-State Analysis

The key innovation is focusing on **how long** a package has been in its current state, not just what state it's in:

- A package at a hub for 2 days → Probably fine
- The same package at the same hub for 8 days → Something's wrong

For every (carrier, state, season, route) combination, we compute survival curves showing:
- "What % of packages in this state for N days eventually delivered?"
- "At what duration does delivery probability drop below 50%?"

### Mathematical Foundation

#### Kaplan-Meier Survival Curves

For each segment, we compute a survival function S(t):

```
S(t) = P(package delivers | time_in_state > t)

S(t) = ∏(i: tᵢ ≤ t) [(nᵢ - dᵢ) / nᵢ]

Where:
  tᵢ = distinct time points where events occurred
  nᵢ = number of packages still "at risk" at time tᵢ
  dᵢ = number of packages that were lost at time tᵢ
```

#### Cox Proportional Hazards Model

Base survival is adjusted by multiplicative hazard factors:

```
h(t | X) = h₀(t) × exp(β₁X₁ + β₂X₂ + ... + βₙXₙ)

Where:
  h₀(t) = baseline hazard function
  Xᵢ = risk factors
  βᵢ = learned coefficients
```

### Hazard Factors (Risk Adjustments)

| Factor | Expected Effect | Description |
|--------|-----------------|-------------|
| Peak Season | +15-30% hazard | Weeks 46-52 and 1-3 (Nov-Jan) |
| Exception Scan | +40% hazard | "Unable to locate", "Address issue", etc. |
| Backward Movement | +50% hazard per occurrence | Package moved away from destination |
| Facility Revisit | +30% hazard | Package returned to same facility |
| Failed Delivery Attempt | +25% hazard per attempt | Couldn't deliver, will retry |
| Address Issue | +60% hazard | Incorrect/incomplete address |
| Accelerating Silence | Variable | Scan frequency decreasing |

### Seasonality Model

```
season_factor(week) = 1 + A × sin(2π × (week - φ) / 52)

Where:
  A = amplitude (~0.15-0.25)
  φ = phase shift (peak around week 50 = mid-December)
```

Captures:
- **Peak stress:** Weeks 46-52 (mid-Nov through Dec)
- **Post-holiday surge:** Weeks 1-3 (January)
- **Summer lull:** Weeks 24-32 (lowest hazard)
- **Back-to-school bump:** Weeks 33-36

### Segmentation Strategy

**Primary segmentation:** `(carrier, carrier_service, zone_bucket, season)`

**CRITICAL: No carrier bucketing.** Each carrier has unique behavior - we model them individually, not grouped into "Other".

**Service-based segmentation using `carrier_service` (NOT `ship_option_name`):**
| Column | What it is | Example |
|--------|------------|---------|
| `ship_option_name` | ShipBob's merchant-facing grouping | "Ground", "ShipBob Economy", "ShipBob2Day" |
| `carrier_service` | **Actual carrier's service level** | USPS "Ground Advantage", FedEx "2Day®" |

**Service Buckets:**
```typescript
function getServiceBucket(carrier_service: string): string {
  const service = carrier_service?.toLowerCase() || '';
  if (service.includes('overnight') || service.includes('next day')) return 'express';
  if (service.includes('2day') || service.includes('2 day')) return '2day';
  if (service.includes('ground') || service.includes('parcel') || service.includes('standard') ||
      service.includes('economy') || service.includes('advantage')) return 'ground';
  if (service.includes('premium')) return 'premium';
  return 'ground';  // Default to ground
}
```

**Zone Buckets:**
| Zone | Bucket | Description |
|------|--------|-------------|
| 1-2 | `local` | Same metro/state |
| 3-5 | `regional` | Regional delivery |
| 6-8 | `long_haul` | Cross-country |
| 9-10 | `extreme` | AK, HI, remote |
| 11+ | `international` | All international |

**Season Buckets:**
- `peak`: November - January (holiday + Q4)
- `normal`: February - October

### Hierarchical Fallback (Service-Preserving)

**CRITICAL:** Never fall back in a way that mixes Express with Ground - they have vastly different expectations.

1. **carrier + service + zone + season** (most specific)
2. **carrier + service + zone** (ignore season)
3. **carrier + service_bucket + zone** (broaden service within same tier)
4. **service_bucket + zone** (all carriers in same service tier)
5. **zone only** (last resort, same service tier only)

### Geographic Reference

| Zone Bucket | Typical Transit | Silence Tolerance |
|-------------|-----------------|-------------------|
| local | 2-3 days | 1 day concerning |
| regional | 3-5 days | 2 days acceptable |
| long_haul | 5-8 days | 3-4 days normal |
| extreme | 7-14 days | 5-7 days normal |
| international | 14-30+ days | 7-10 days normal |

### Confidence Thresholds

| Sample Size | Confidence | Display Behavior |
|-------------|------------|------------------|
| < 50 | `insufficient_data` | Don't show probability |
| 50-99 | `low` | Show with "limited data" note |
| 100-499 | `medium` | Show normally |
| 500+ | `high` | Show with confidence |

### UI Display

```
┌──────────────────────────────────────────────────────────────────┐
│  Package Intelligence                                            │
│                                                                  │
│  ┌──────────┐                                                    │
│  │   87%    │  Your package is at the Chicago distribution       │
│  │  likely  │  center and has an 87% chance of delivery based    │
│  │to deliver│  on 2,400 similar USPS shipments. It's been at     │
│  └──────────┘  this facility for 2 days, which is typical for    │
│                cross-country routes in January.                  │
│                                                                  │
│  Expected delivery: 2-3 more days                                │
└──────────────────────────────────────────────────────────────────┘
```

### New Database Tables (for Intelligence Engine)

**tracking_checkpoints** - Permanent checkpoint storage (Phase 0 - CRITICAL)
```sql
CREATE TABLE tracking_checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id TEXT NOT NULL REFERENCES shipments(shipment_id),
  tracking_number TEXT NOT NULL,
  carrier TEXT NOT NULL,
  carrier_code TEXT,  -- TrackingMore carrier code

  -- RAW CHECKPOINT DATA (from TrackingMore)
  checkpoint_date TIMESTAMP NOT NULL,
  raw_description TEXT NOT NULL,
  raw_location TEXT,
  raw_status TEXT,  -- checkpoint_delivery_status
  raw_substatus TEXT,  -- checkpoint_delivery_substatus

  -- AI-NORMALIZED FIELDS
  normalized_type TEXT,  -- 12 types: LABEL, PICKUP, INTRANSIT, HUB, LOCAL, OFD, DELIVERED, ATTEMPT, EXCEPTION, RETURN, CUSTOMS, HOLD
  display_title TEXT,  -- Clean, human-readable title
  sentiment TEXT,  -- positive, neutral, concerning, critical

  -- DEDUPLICATION
  content_hash TEXT UNIQUE,  -- SHA256(carrier + date + description + location)

  -- METADATA
  source TEXT DEFAULT 'trackingmore',
  fetched_at TIMESTAMP DEFAULT NOW(),
  normalized_at TIMESTAMP
);
```
**Key insight:** Store ALL checkpoints permanently. TrackingMore data expires after ~4 months, but we keep our stored data forever.

**delivery_outcomes** - Training data from completed shipments (full year)
- Outcome (delivered/lost_claim/lost_tracking/lost_exception/lost_timeout)
- Zone-based features (zone_used, zone_bucket)
- Carrier and carrier_service for segmentation
- Seasonality (transit_start_date from `event_intransit`, season_bucket)
- Time-in-state (total_transit_days, days_to_out_for_delivery, days_last_mile)
- Risk factors (has_exception, has_delivery_attempt_failed, event_count)

**survival_curves** - Pre-computed Kaplan-Meier curves
- Keyed by (carrier, carrier_service, zone_bucket, season_bucket)
- Curve data points (days → survival probability)
- Sample size and confidence level (high/medium/low/insufficient)
- Median survival time

**hazard_factors** - Learned risk coefficients
- Per-carrier coefficients for each risk factor
- Hazard ratios (exp(coefficient))
- Sample size

**formatted_tracking_events** - Permanent AI event cache
- Content-addressed (hash of carrier + date + location + description)
- AI-formatted display title and body
- Normalized scan type (12 types)
- Sentiment classification

**package_intelligence_cache** - Summary cache
- Keyed by (tracking_number, events_fingerprint)
- Probability and confidence
- State analysis (current state, time-in-state, percentile)
- AI-generated summary text

---

## AI Event Formatting

Tracking events are formatted by AI with permanent caching for consistency.

### Cache Key

```typescript
event_hash = SHA256(carrier + checkpoint_date + location + raw_description)
```

### Processing Flow

```
1. Fetch fresh tracking from TrackingMore
2. For each checkpoint:
   a. Compute event_hash
   b. Check formatted_tracking_events for cached version
   c. If NOT cached: collect for batch AI processing
3. If any uncached events:
   a. Call Gemini Flash with batch
   b. Store formatted results permanently (IMMUTABLE)
4. Return timeline with AI-formatted events
```

### Normalized Scan Types (12 Types)

AI (Gemini) normalizes raw carrier scan descriptions into standard types:

| Type | Meaning | Example Descriptions |
|------|---------|---------------------|
| `LABEL` | Label created | "Shipping label created", "Order information received" |
| `PICKUP` | Carrier picked up | "Picked up", "Origin scan", "Accepted at facility" |
| `INTRANSIT` | Moving between facilities | "In transit", "Departed facility", "En route" |
| `HUB` | Arrived at sorting/distribution facility | "Arrived at distribution center", "Processed through hub" |
| `LOCAL` | At local delivery facility | "Arrived at local facility", "At destination sort" |
| `OFD` | Out for delivery | "Out for delivery", "With delivery courier" |
| `DELIVERED` | Delivered | "Delivered", "Left with neighbor", "Handed to resident" |
| `ATTEMPT` | Delivery attempt failed | "Delivery attempted", "No access", "Business closed" |
| `EXCEPTION` | Problem occurred | "Unable to locate", "Address issue", "Damaged" |
| `RETURN` | Being returned | "Returning to sender", "Return initiated" |
| `CUSTOMS` | International customs | "Customs clearance", "Import scan" |
| `HOLD` | Held for pickup/action | "Held at facility", "Available for pickup" |

---

## Current AI Assessment (Haiku-based)

Shipments in monitoring can be assessed by AI to predict outcomes.

### AI Fields (`lost_in_transit_checks`)

| Column | Type | Purpose |
|--------|------|---------|
| `ai_assessment` | jsonb | Full AI analysis response |
| `ai_assessed_at` | timestamp | When last assessed |
| `ai_next_check_at` | timestamp | When to reassess |
| `ai_status_badge` | text | MOVING, DELAYED, WATCHLIST, STALLED, STUCK, RETURNING, LOST |
| `ai_risk_level` | text | low, medium, high, critical |
| `ai_reshipment_urgency` | integer | 1-10 scale |
| `ai_customer_anxiety` | integer | 1-10 scale |
| `ai_predicted_outcome` | text | delivered, lost, returned |

---

## Database Tables

### lost_in_transit_checks

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `client_id` | uuid | FK to clients |
| `shipment_id` | text | FK to shipments.shipment_id |
| `tracking_number` | text | |
| `carrier` | text | |
| `is_international` | boolean | origin_country ≠ destination_country |
| `days_in_transit` | integer | Days since label created |
| `days_since_last_update` | integer | Days since last carrier scan |
| `eligible_after` | date | When claim becomes eligible |
| `claim_eligibility_status` | text | at_risk, eligible, claim_filed, approved, denied, missed_window |
| `trackingmore_tracking_id` | text | TrackingMore's internal ID |
| `first_checked_at` | timestamp | When first added to monitoring |
| `last_recheck_at` | timestamp | Last TrackingMore fetch |
| `last_scan_date` | timestamp | Most recent carrier checkpoint |
| `last_scan_description` | text | Checkpoint description |
| `last_scan_location` | text | Checkpoint location |
| AI columns | various | See AI Assessment section |

### transit_benchmarks

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `benchmark_type` | text | carrier_service, ship_option, international_route |
| `benchmark_key` | text | Carrier name, ship option ID, or "carrier:origin:dest" |
| `display_name` | text | Human-readable name |
| `zone_1_avg` through `zone_10_avg` | decimal | Average transit days per zone |
| `zone_1_count` through `zone_10_count` | integer | Sample size per zone |
| `last_calculated_at` | timestamp | When last updated |

**Unique constraint:** `(benchmark_type, benchmark_key)`

---

## UI Components

### Lookout Dashboard (`/dashboard/lookout`)

**Quick Filters:**
- At Risk - Shipments exceeding threshold but not claim-eligible
- Ready to File - Can file a claim now
- Claims Filed - Claim in progress
- Archived - Resolved or closed

**AI-Powered Filters:**
- Reship Now - High urgency reshipment recommended
- Consider Reship - Moderate urgency
- Customer Anxious - High customer anxiety score
- Stuck - Packages stuck at facility
- Returning - Packages being returned
- Likely Lost - AI predicts loss

**Click Behaviors:**
- **Tracking Number** → Opens Tracking Timeline drawer
- **Shipment ID** → Opens Shipment Details drawer
- **File Claim button** → Opens Claim Submission dialog

### Tracking Timeline Drawer

Shows combined timeline:
1. **ShipBob warehouse events** (Picked, Packed, Labeled, Carrier Pickup)
2. **TrackingMore carrier checkpoints** (In Transit, Out for Delivery, Delivered)
3. **Claim events** (Filed, Updated, Resolved)

**Package Intelligence Panel** (coming soon):
- Delivery probability percentage
- AI-generated summary
- Risk factors present
- Expected delivery window

---

## Key Files

### Pages and Components

| File | Purpose |
|------|---------|
| `app/dashboard/lookout/page.tsx` | Lookout dashboard page |
| `components/lookout/lookout-table.tsx` | At-risk shipments table |
| `components/lookout/quick-filters.tsx` | Filter tabs |
| `components/lookout/tracking-timeline-drawer.tsx` | Tracking timeline slideout |
| `components/claims/claim-submission-dialog.tsx` | Claim filing modal |

### API Routes

| File | Purpose |
|------|---------|
| `app/api/data/monitoring/shipments/route.ts` | Fetch monitored shipments |
| `app/api/data/monitoring/stats/route.ts` | Fetch filter counts |
| `app/api/data/tracking/[trackingNumber]/timeline/route.ts` | Fetch tracking timeline |

### Cron Jobs

| File | Purpose |
|------|---------|
| `app/api/cron/calculate-benchmarks/route.ts` | Daily benchmark calculation |
| `app/api/cron/monitoring-entry/route.ts` | Hourly entry (adds to monitoring) |
| `app/api/cron/sync-at-risk/route.ts` | Daily at-risk sync |
| `app/api/cron/recheck-at-risk/route.ts` | Hourly recheck and promotion |
| `app/api/cron/advance-claims/route.ts` | Claim workflow advancement |
| `app/api/cron/ai-reassess/route.ts` | AI reassessment |

### Libraries

| File | Purpose |
|------|---------|
| `lib/trackingmore/client.ts` | TrackingMore API client |
| `lib/trackingmore/at-risk.ts` | At-risk detection logic |
| `lib/ai/client.ts` | Current AI assessment (Haiku) |

### Intelligence Engine Files

| File | Purpose |
|------|---------|
| `lib/trackingmore/checkpoint-storage.ts` | Store/retrieve checkpoints permanently |
| `lib/ai/normalize-checkpoint.ts` | Gemini normalization for scan types |
| `lib/delivery-intelligence/feature-extraction.ts` | Extract features from shipments |
| `lib/delivery-intelligence/survival-analysis.ts` | Kaplan-Meier, Cox model |
| `lib/delivery-intelligence/probability.ts` | Real-time probability lookup |
| `lib/ai/gemini-client.ts` | Gemini API wrapper |
| `lib/ai/format-tracking-events.ts` | AI event formatting |
| `lib/ai/delivery-summary.ts` | AI summary generation |
| `app/api/cron/compute-survival-curves/route.ts` | Daily curve recomputation |
| `components/lookout/scout-insight-card.tsx` | UI component for Scout |

---

## Relationship to Claims

When a shipment in Delivery IQ becomes `eligible`:
1. User clicks "File Claim" button
2. ClaimSubmissionDialog opens pre-filled with shipment data
3. On submit:
   - Creates `care_tickets` record with `ticket_type = 'Claim'`
   - Updates `lost_in_transit_checks.claim_eligibility_status` to `claim_filed`
   - Adds timeline event to care ticket

See [CLAUDE.claims.md](CLAUDE.claims.md) for claim lifecycle details.

---

## Configuration

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `TRACKINGMORE_API_KEY` | TrackingMore API authentication |
| `CRON_SECRET` | Auth header for cron endpoints |
| `GOOGLE_AI_API_KEY` | Gemini API key (for Intelligence Engine) |

### Vercel Cron (vercel.json)

```json
{
  "path": "/api/cron/calculate-benchmarks",
  "schedule": "0 4 * * *"
},
{
  "path": "/api/cron/monitoring-entry",
  "schedule": "0 * * * *"
},
{
  "path": "/api/cron/sync-at-risk",
  "schedule": "0 3 * * *"
},
{
  "path": "/api/cron/recheck-at-risk",
  "schedule": "0 * * * *"
},
{
  "path": "/api/cron/advance-claims",
  "schedule": "*/5 * * * *"
},
{
  "path": "/api/cron/ai-reassess",
  "schedule": "*/15 * * * *"
}
```

---

## History & Evolution

**Original Design (Dec 2025):**
- Fixed thresholds: 15 days domestic, 20 days international
- Simple at-risk → eligible status flow

**Current Design (Jan 2026):**
- Dynamic thresholds based on carrier + zone/route benchmarks
- 30% buffer above historical average
- Hourly recheck with automatic eligibility promotion
- Lost status detection (carrier admission)
- AI-powered assessment (Haiku-based)
- Integrated with claims lifecycle

**In Progress (Feb 2026):**
- **Phase 0:** Checkpoint Storage Infrastructure - Store ALL TrackingMore checkpoints permanently in `tracking_checkpoints` table
- **Phase 1:** Data Foundation - `delivery_outcomes`, `survival_curves`, `hazard_factors` tables
- **Phase 2:** Survival Analysis Engine - Kaplan-Meier curves with service-preserving fallback
- **Phase 3:** AI Integration - Gemini event formatting and summary generation
- **Phase 4:** UI Integration - Scout insight card with probability + AI summary
