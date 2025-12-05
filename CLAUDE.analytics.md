# Jetpack Dashboard - Analytics Section

**Reference for:** Analytics section work, charts, reports, performance patterns
**Parent:** [CLAUDE.md](CLAUDE.md)
**Status:** Phase 1 Complete - 7 tabs, 34 charts, 40K sample shipments

---

## Mission Statement

Create a robust, highly visual analytics section that consolidates 5 legacy reports (Billing Summary, Business Performance Report, Fulfillment Cost and Speed, Fulfillment SLA, Undelivered Shipments) into a unified, interactive dashboard experience.

---

## Architecture

### Single Page with Tabs
**Route**: `/app/dashboard/analytics/page.tsx`

**Rationale:**
- Unified navigation - all analytics accessible from one location
- Shared global date range filtering across all report types
- Consistent design language matching existing Shipments page pattern
- Better state management with shared context
- Faster UX (no page navigation delays)

### Layout Structure
```
┌─────────────────────────────────────────────────┐
│ SiteHeader - "Analytics"                        │
├─────────────────────────────────────────────────┤
│ Global Filters:                                 │
│ [Date Range: 7d|30d|90d|1yr|Custom] [Export All]│
├─────────────────────────────────────────────────┤
│ KPI Cards (6 metrics in grid)                   │
├─────────────────────────────────────────────────┤
│ Tab Navigation:                                 │
│ [Shipments][Cost&Speed][Performance][SLA]       │
│ [Geographic][Carriers][Timeline]                │
├─────────────────────────────────────────────────┤
│ Tab Content: Charts + Data Tables               │
└─────────────────────────────────────────────────┘
```

---

## Data Schema

### Shipments Tab (35 columns)
Primary transaction data - one row per shipment/order

| Column | Type | Description |
|--------|------|-------------|
| User ID | string | Customer identifier |
| Merchant Name | string | Customer business name |
| OrderID | string | Internal order identifier |
| TrackingId | string | Carrier tracking number |
| Fulfillment without Surcharge | number | Base fulfillment cost |
| Surcharge Applied | number | Additional surcharge |
| Original Invoice | number | Total invoice amount |
| Carrier | string | USPS, UPS, FedEx, etc. |
| Carrier Service | string | Specific service level |
| Zone Used | string | Shipping zone (1-8) |
| Actual Weight (Oz) | number | Physical weight |
| Dim Weight (Oz) | number | Dimensional weight |
| Billable Weight (Oz) | number | Weight used for billing |
| City / State / Zip | string | Destination |
| Order Insert Timestamp | datetime | When order entered system |
| Label Generation Timestamp | datetime | When label created |
| Delivered Date | datetime | When delivered |
| Transit Time (Days) | number | Days from label to delivery |
| FC Name | string | Fulfillment center |

**Key Derived Metrics:**
- **SLA Time to Ship**: Label Generation - Order Insert
- **SLA On-Time Delivery**: Delivered Date vs expected
- **Cost per Order**: Original Invoice / Total Quantity

### Additional Services Tab (6 columns)
| Column | Type |
|--------|------|
| User ID | string |
| Merchant Name | string |
| Reference ID | string |
| Fee Type | string (Pick Fee, B2B Fee, etc.) |
| Invoice Amount | number |
| Transaction Date | date |

### Returns Tab (11 columns)
| Column | Type |
|--------|------|
| Return ID | string |
| Original Order ID | string |
| Tracking ID | string |
| Invoice | number |
| Return Status | string |
| Return Type | string |
| Return Creation Date | date |
| FC Name | string |

### Storage Tab (7 columns)
| Column | Type |
|--------|------|
| Merchant Name | string |
| ChargeStartdate | date |
| FC Name | string |
| Inventory ID | string |
| Location Type | string |
| Invoice | number |

### Credits Tab (6 columns)
| Column | Type |
|--------|------|
| Reference ID | string |
| Transaction Date | date |
| Credit Reason | string |
| Credit Amount | number |

---

## KPI Cards (Global - All Tabs)

Six metric cards in responsive grid:

1. **Total Cost** - Sum of all invoices, % change vs previous period
2. **Order Count** - Total shipments, % change
3. **Avg Transit Time** - Days from label to delivery (down = good)
4. **SLA On-Time %** - % on-time deliveries (green >95%, yellow 90-95%, red <90%)
5. **Late Orders** - Breached SLA count (down = good)
6. **Undelivered** - Still in transit count

---

## Tab Specifications

### Tab 1: Shipments
- Order volume by date (bar chart)
- Cost breakdown (stacked area)
- Data table with all shipment records

### Tab 2: Cost & Speed Analysis
- Cost vs Transit scatter plot (bubble size = volume, color = carrier)
- Cost by ship option (grouped bar)
- Transit time distribution
- Dual-axis cost/speed trends

### Tab 3: Performance
- Monthly invoice trend (line)
- Fee breakdown over time (stacked area)
- Ship option performance (grouped bar)
- Zone distribution

### Tab 4: SLA Performance
- On-time delivery gauge (radial - hero metric)
- On-time trend (line with 95% target)
- Breaches by carrier (stacked bar)
- On-time vs late volume (stacked area)

### Tab 5: Geographic
- State-level heatmap/choropleth
- Top destinations bar chart
- Regional performance comparison

### Tab 6: Carriers
- Carrier volume comparison
- Carrier cost comparison
- Carrier speed comparison
- Carrier reliability metrics

### Tab 7: Timeline
- Order volume over time
- Seasonal patterns
- Day-of-week analysis

---

## Performance Optimization Pattern

### Problem
With 40K shipments and city coordinate lookups, date range changes caused 1-2 second UI freezes.

### Solution: React 18 startTransition + Event Loop Deferral

```typescript
// 1. Loading state
const [isDataLoading, setIsDataLoading] = React.useState(false)

// 2. Minimum display time
React.useEffect(() => {
  setIsDataLoading(true)
  const timer = setTimeout(() => setIsDataLoading(false), 500)
  return () => clearTimeout(timer)
}, [dateRange, customDateRange])

// 3. Date range handlers (all 7 tabs)
onClick={() => {
  setIsDataLoading(true)  // Immediate loading state

  // 50ms allows 3-4 animation frames before heavy work
  setTimeout(() => {
    startTransition(() => {
      setDateRange(option.value)
      setCustomDateRange({ from: undefined, to: undefined })
    })
  }, 50)
}

// 4. Visual indicator
{isDataLoading && (
  <div className="flex items-center gap-2 text-sm text-muted-foreground">
    <Loader2 className="h-4 w-4 animate-spin" />
    <span>Refreshing Data</span>
  </div>
)}
```

### Why Both setTimeout AND startTransition?
- `setTimeout` alone: Indicator appears but can freeze during computation
- `startTransition` alone: Doesn't guarantee animation starts before computation
- **Combined**: Indicator appears immediately AND animates smoothly

### Performance Results
- Before: 1-1.5s delay, frozen animation
- After: <50ms indicator, smooth 60fps throughout

---

## Chart Implementation Pattern

```typescript
<ChartContainer config={chartConfig}>
  <ResponsiveContainer width="100%" height={350}>
    <AreaChart data={aggregatedData}>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey="month" />
      <YAxis />
      <ChartTooltip content={<CustomTooltip />} />
      <Area
        type="monotone"
        dataKey="fulfillment"
        stackId="1"
        fill="var(--color-fulfillment)"
      />
    </AreaChart>
  </ResponsiveContainer>
</ChartContainer>
```

---

## Type Definitions

Location: `/lib/analytics/types.ts`

```typescript
interface ShipmentData {
  userId: string
  merchantName: string
  orderId: string
  trackingId: string
  fulfillmentWithoutSurcharge: number
  surchargeApplied: number
  originalInvoice: number
  carrier: string
  carrierService: string
  zoneUsed: string
  city: string
  state: string
  zipCode: string
  orderInsertTimestamp: Date
  labelGenerationTimestamp: Date
  deliveredDate: Date | null
  transitTimeDays: number | null
  // ... all 35 fields
}

interface KPIMetrics {
  totalCost: number
  orderCount: number
  avgTransitTime: number
  slaPercent: number
  lateOrders: number
  undelivered: number
  periodChange: {
    totalCost: number
    orderCount: number
    avgTransitTime: number
    slaPercent: number
    lateOrders: number
    undelivered: number
  }
}
```

---

## File Locations

```
/app/dashboard/analytics/page.tsx   # Main analytics page (7 tabs)
/lib/analytics/
  types.ts                          # TypeScript interfaces
  aggregators.ts                    # Data transformation utilities
  sample-data.ts                    # 40K sample shipments
  us-cities-coords.json             # City coordinates for geo viz
  build-city-coords.js              # Build script for city data
```

---

## Sample Data Characteristics

- **Volume:** 40,000 shipments across 12 months
- **States:** All 50 US states with weighted distribution
- **Cities:** Population-weighted (50% major, 25% medium, 25% small)
- **Carriers:** 8 carriers with realistic distribution
- **Coordinates:** From `all-the-cities` package (20K+ US cities)

---

## Export Capabilities

### Global Export
- Comprehensive Excel workbook
- Summary KPIs sheet
- Each report's data as separate sheet
- Applied filters documented
- Date range in filename

### Per-Tab Export
- CSV for simple exports
- Excel for formatted exports
- PDF option for formatted reports

### Libraries
- `exceljs` for Excel generation
- `react-csv` for CSV export
- `jsPDF` + `html2canvas` for PDF

---

## Interactive Features

- **Drill-Down:** Click chart elements to filter data table
- **Tooltips:** Rich tooltips with multiple metrics
- **Animations:** Framer Motion for tab transitions, chart animations on load
- **Responsive:** Mobile simplified, tablet hybrid, desktop full experience

---

## Future Enhancements (Phase 2+)

- Real-time data updates
- Saved filter presets
- Custom report builder
- Email scheduled reports
- Comparative analysis (multiple date ranges)
- Forecasting/predictive analytics
- Custom SLA thresholds per customer
- Alert notifications for SLA breaches

---

## Design Consistency

### Colors
- Primary: `hsl(var(--primary))`
- Chart colors: `--chart-1` through `--chart-5`
- Dark mode: All charts adapt to theme

### Styling
- Match DataTable from Shipments page
- shadcn Table components
- Zebra striping for readability

---

*This file contains analytics section details. Update when implementing new charts, reports, or performance patterns.*
