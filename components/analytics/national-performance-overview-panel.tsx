"use client"

import { Card, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import type { StatePerformance } from "@/lib/analytics/types"
import { COUNTRY_CONFIGS } from "@/lib/analytics/geo-config"

interface DelayImpact {
  affectedShipments: number
  affectedPercent: number
  avgDeliveryDaysClean: number
  avgDeliveryDaysWithDelayed: number
  avgFulfillHoursClean: number
  avgFulfillHoursWithDelayed: number
}

interface NationalPerformanceOverviewPanelProps {
  stateData: StatePerformance[]
  country?: string             // "US", "CA", "AU"
  regionLabel?: string         // "State" or "Province"
  regionLabelPlural?: string   // "States" or "Provinces"
  delayImpact?: DelayImpact | null
  includeDelayed?: boolean
  onToggleDelayed?: (value: boolean) => void
}

export function NationalPerformanceOverviewPanel({ stateData, country = 'US', regionLabel = 'State', regionLabelPlural = 'States', delayImpact, includeDelayed, onToggleDelayed }: NationalPerformanceOverviewPanelProps) {
  // Filter to only known states/provinces (excludes territories, military codes, junk)
  const knownCodes = new Set(Object.keys(COUNTRY_CONFIGS[country]?.codeToName || {}))
  const filteredData = stateData.filter(s => knownCodes.has(s.state))

  // Calculate national totals from filtered data only
  const totalOrders = filteredData.reduce((sum, s) => sum + s.orderCount, 0)
  const totalShipped = filteredData.reduce((sum, s) => sum + s.shippedCount, 0)
  const totalDelivered = filteredData.reduce((sum, s) => sum + s.deliveredCount, 0)
  const regionsWithOrders = filteredData.filter(s => s.orderCount > 0).length

  // Calculate weighted averages for all 3 time metrics (weight by relevant count)
  const totalWeightedDays = filteredData.reduce((sum, s) => sum + (s.avgDeliveryTimeDays * s.deliveredCount), 0)
  const avgDeliveryTime = totalDelivered > 0 ? totalWeightedDays / totalDelivered : 0

  const totalWeightedFulfill = filteredData.reduce((sum, s) => sum + (s.avgFulfillTimeHours * s.shippedCount), 0)
  const avgFulfillTime = totalShipped > 0 ? totalWeightedFulfill / totalShipped : 0

  const totalWeightedRegionalMile = filteredData.reduce((sum, s) => sum + (s.avgRegionalMileDays * s.deliveredCount), 0)
  const avgRegionalMile = totalDelivered > 0 ? totalWeightedRegionalMile / totalDelivered : 0

  const totalWeightedTransit = filteredData.reduce((sum, s) => sum + (s.avgCarrierTransitDays * s.deliveredCount), 0)
  const avgCarrierTransit = totalDelivered > 0 ? totalWeightedTransit / totalDelivered : 0

  // Get top 5 fastest — min 10 delivered, relax to 1 if fewer than 3 qualify
  const eligibleStates = filteredData.filter(s => s.avgDeliveryTimeDays > 0)
  const strict = eligibleStates.filter(s => s.deliveredCount >= 10)
  const fastestStates = (strict.length >= 3 ? strict : eligibleStates.filter(s => s.deliveredCount >= 1))
    .sort((a, b) => a.avgDeliveryTimeDays - b.avgDeliveryTimeDays)
    .slice(0, 5)

  const getPerformanceBadge = (avgDays: number) => {
    if (avgDays < 3) {
      return <Badge className="bg-green-500 text-[10px] px-1.5 py-0">Fast</Badge>
    } else if (avgDays < 5) {
      return <Badge className="bg-[hsl(203,61%,50%)] text-[10px] px-1.5 py-0">Good</Badge>
    } else {
      return <Badge className="bg-orange-500 text-[10px] px-1.5 py-0">Slow</Badge>
    }
  }

  const countryLabel = country === 'US' ? 'USA' : COUNTRY_CONFIGS[country]?.label || 'National'

  return (
    <Card className="h-full overflow-hidden flex flex-col bg-gradient-to-b from-zinc-100 to-white dark:from-zinc-800 dark:to-zinc-950">
      <CardHeader className="flex-shrink-0 border-b border-border">
        <div className="flex items-center gap-2">
          <CardTitle className="text-lg">{countryLabel} Overview</CardTitle>
          <div className="ml-auto flex flex-col items-center">
            <Badge variant="secondary" className="tabular-nums text-xs font-medium">{totalOrders.toLocaleString()} orders</Badge>
            <div className="text-[10px] text-muted-foreground mt-0.5">across {regionsWithOrders} {regionLabelPlural.toLowerCase()}</div>
          </div>
        </div>
      </CardHeader>

      {/* Time Metrics — full-bleed grid */}
      <div className="flex-shrink-0">
        {/* Primary row: Order to Delivery | Ship to Delivery */}
        <div className="grid grid-cols-2">
          <div className="text-center px-3 py-4 border-r border-border bg-blue-50/50 dark:bg-blue-950/20">
            <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">Order to Delivery</div>
            <div className="text-2xl font-bold tabular-nums">{avgDeliveryTime.toFixed(1)}</div>
            <div className="text-[10px] text-zinc-400 dark:text-zinc-500">calendar days</div>
          </div>
          <div className="text-center px-3 py-4 bg-indigo-50/50 dark:bg-indigo-950/20">
            <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">Ship to Delivery</div>
            <div className="text-2xl font-bold tabular-nums">{(avgRegionalMile + avgCarrierTransit).toFixed(1)}</div>
            <div className="text-[10px] text-zinc-400 dark:text-zinc-500">calendar days</div>
          </div>
        </div>
        {/* Breakdown: Fulfill | Regional Mile | Final Mile */}
        <div className="grid grid-cols-3 border-t border-border">
          <div className="text-center px-2 py-3 border-r border-border bg-amber-50/40 dark:bg-amber-950/15">
            <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">Fulfillment</div>
            <div className="text-lg font-bold tabular-nums">{avgFulfillTime.toFixed(1)}</div>
            <div className="text-[10px] text-zinc-400 dark:text-zinc-500">op. hours</div>
          </div>
          <div className="text-center px-2 py-3 border-r border-border bg-emerald-50/40 dark:bg-emerald-950/15">
            <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">Regional Mile</div>
            <div className="text-lg font-bold tabular-nums">{avgRegionalMile.toFixed(1)}</div>
            <div className="text-[10px] text-zinc-400 dark:text-zinc-500">days</div>
          </div>
          <div className="text-center px-2 py-3 bg-sky-50/40 dark:bg-sky-950/15">
            <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">Final Mile</div>
            <div className="text-lg font-bold tabular-nums">{avgCarrierTransit.toFixed(1)}</div>
            <div className="text-[10px] text-zinc-400 dark:text-zinc-500">days</div>
          </div>
        </div>
        {/* Delay Toggle row */}
        {delayImpact && delayImpact.affectedShipments > 0 && onToggleDelayed && (
          <div className="flex items-center gap-2 px-3 py-3.5 border-t border-border bg-orange-50/30 dark:bg-orange-950/10">
            <Switch
              id="delay-toggle-panel"
              checked={includeDelayed ?? false}
              onCheckedChange={onToggleDelayed}
            />
            <Label htmlFor="delay-toggle-panel" className="text-xs font-medium cursor-pointer whitespace-nowrap">
              Include Inventory Delays
            </Label>
            <span className="text-[10px] text-muted-foreground ml-auto whitespace-nowrap">
              {delayImpact.affectedShipments.toLocaleString()} ({delayImpact.affectedPercent.toFixed(1)}%) orders
            </span>
          </div>
        )}

        {/* Top 5 Fastest States — full-bleed */}
        <div className="border-t border-border">
          <div className="px-4 pt-4 pb-2">
            <h4 className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
              Top 5 Fastest {regionLabelPlural}
            </h4>
          </div>
          {fastestStates.length > 0 ? (
            <div>
              {fastestStates.map((state, index) => (
                <div key={state.state} className="flex items-center px-4 py-2 border-t border-border hover:bg-muted/30 transition-colors">
                  <span className="text-xs text-muted-foreground w-5 tabular-nums">{index + 1}</span>
                  <span className="text-xs font-medium flex-1">{state.stateName}</span>
                  <span className="text-xs font-medium tabular-nums mr-2">{state.avgDeliveryTimeDays.toFixed(1)}d</span>
                  {getPerformanceBadge(state.avgDeliveryTimeDays)}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-4 text-muted-foreground text-xs border-t border-border">
              Not enough data
            </div>
          )}
        </div>

        {/* Click hint */}
        <div className="px-4 py-3 border-t border-border text-xs text-muted-foreground bg-muted/30">
          Click a {regionLabel.toLowerCase()} on the map to view detailed metrics
        </div>
      </div>
    </Card>
  )
}
