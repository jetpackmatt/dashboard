"use client"

import type { StatePerformance } from "@/lib/analytics/types"
// Card removed — rendered inside parent grid cell
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"

interface CityData {
  city: string
  state: string
  orderCount: number
  delayCount?: number
  percent: number
}

interface DelayImpact {
  affectedShipments: number
  affectedPercent: number
}

interface StateDetailsPanelProps {
  stateData: StatePerformance
  cityData?: CityData[]
  delayImpact?: DelayImpact | null
  includeDelayed?: boolean
  onToggleDelayed?: (value: boolean) => void
}

export function StateDetailsPanel({ stateData, cityData, delayImpact, includeDelayed, onToggleDelayed }: StateDetailsPanelProps) {
  // Top 5 cities by volume for this state (subtract delays when toggle is off)
  const topCities = (cityData || [])
    .filter(c => c.state === stateData.state && c.orderCount > 0)
    .map(c => ({
      ...c,
      displayCount: includeDelayed ? c.orderCount : c.orderCount - (c.delayCount || 0),
    }))
    .filter(c => c.displayCount > 0)
    .sort((a, b) => b.displayCount - a.displayCount)
    .slice(0, 5)

  // Pick clean or with-delayed values based on toggle
  const fulfillTime = includeDelayed
    ? (stateData.avgFulfillTimeHoursWithDelayed ?? stateData.avgFulfillTimeHours)
    : stateData.avgFulfillTimeHours
  const deliveryTime = includeDelayed
    ? (stateData.avgDeliveryTimeDaysWithDelayed ?? stateData.avgDeliveryTimeDays)
    : stateData.avgDeliveryTimeDays
  const regionalMile = deliveryTime > 0
    ? Math.max(0, deliveryTime - fulfillTime / 24 - stateData.avgCarrierTransitDays)
    : stateData.avgRegionalMileDays

  // Transit vs benchmark
  const transitDelta = stateData.transitVsBenchmark || 0
  const benchmarkAvg = stateData.benchmarkAvgTransit || 0
  const transitDeltaPct = benchmarkAvg > 0 ? Math.abs(transitDelta) / benchmarkAvg * 100 : 0
  const hasBenchmarkData = benchmarkAvg > 0

  return (
    <div className="h-full overflow-hidden flex flex-col">
      <div className="flex-shrink-0 border-b border-border px-5 py-4">
        <div className="flex items-center gap-2">
          <div className="text-sm font-semibold">{stateData.stateName}</div>
          <Badge variant="secondary" className="tabular-nums text-xs font-medium ml-auto">{stateData.orderCount.toLocaleString()} orders</Badge>
        </div>
      </div>

      {/* Time Metrics — full-bleed grid */}
      <div className="flex-shrink-0">
        {/* Primary row: Carrier Transit | Middle Mile | Fulfill Time */}
        <div className="grid grid-cols-3">
          <div className="text-center px-3 py-4 border-r border-border bg-sky-50/50 dark:bg-sky-950/20">
            <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">Last Mile</div>
            <div className="text-2xl font-bold tabular-nums">{stateData.avgCarrierTransitDays.toFixed(1)}</div>
            <div className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-0.5">calendar days</div>
          </div>
          <div className="text-center px-3 py-4 border-r border-border bg-emerald-50/50 dark:bg-emerald-950/20">
            <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">Middle Mile</div>
            <div className="text-2xl font-bold tabular-nums">{regionalMile.toFixed(1)}</div>
            <div className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-0.5">calendar days</div>
          </div>
          <div className="text-center px-3 py-4 bg-amber-50/40 dark:bg-amber-950/15">
            <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">Fulfill Time</div>
            <div className="text-2xl font-bold tabular-nums">{fulfillTime.toFixed(1)}</div>
            <div className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-0.5">operating hours</div>
          </div>
        </div>
        {/* Secondary row: Order-to-Delivery | vs Benchmark */}
        <div className="grid grid-cols-2 border-t border-border">
          <div className="text-center px-3 py-4 border-r border-border bg-indigo-50/40 dark:bg-indigo-950/15">
            <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">Order-to-Delivery</div>
            <div className="text-lg font-bold tabular-nums">{deliveryTime.toFixed(1)}</div>
            <div className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-0.5">calendar days</div>
          </div>
          <div className={`text-center px-3 py-4 ${hasBenchmarkData && transitDelta <= 0 ? 'bg-emerald-50/50 dark:bg-emerald-950/20' : hasBenchmarkData ? 'bg-red-50/50 dark:bg-red-950/20' : 'bg-blue-50/50 dark:bg-blue-950/20'}`}>
            <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">vs Benchmark</div>
            {hasBenchmarkData ? (
              <>
                <div className={`text-lg font-bold tabular-nums ${transitDelta <= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                  {transitDeltaPct.toFixed(0)}% {transitDelta <= 0 ? 'faster' : 'slower'}
                </div>
                <div className="text-[10px] text-zinc-400 dark:text-zinc-500">
                  {stateData.avgCarrierTransitDays.toFixed(1)} actual vs {benchmarkAvg.toFixed(1)} expected
                </div>
              </>
            ) : (
              <>
                <div className="text-lg font-bold tabular-nums">—</div>
                <div className="text-[10px] text-zinc-400 dark:text-zinc-500">no data yet</div>
              </>
            )}
          </div>
        </div>
        {/* Delay Toggle row */}
        {delayImpact && delayImpact.affectedShipments > 0 && onToggleDelayed && (
          <div className="flex items-center gap-2 px-4 py-4 border-t border-border bg-orange-50/30 dark:bg-orange-950/10">
            <Switch
              id="delay-toggle-state"
              checked={includeDelayed ?? false}
              onCheckedChange={onToggleDelayed}
            />
            <Label htmlFor="delay-toggle-state" className="text-xs font-medium cursor-pointer whitespace-nowrap">
              Include Inventory Delays
            </Label>
            <span className="text-[10px] text-muted-foreground ml-auto whitespace-nowrap">
              {delayImpact.affectedShipments.toLocaleString()} ({delayImpact.affectedPercent.toFixed(1)}%) orders
            </span>
          </div>
        )}

        {/* Top 5 Cities — full-bleed */}
        <div className="border-t border-border">
          <div className="px-5 pt-5 pb-3">
            <h4 className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
              Top 5 Cities
            </h4>
          </div>
          {topCities.length > 0 ? (
            <div>
              {topCities.map((city, index) => (
                <div key={city.city} className="flex items-center px-5 py-3 border-t border-border hover:bg-muted/30 transition-colors">
                  <span className="text-xs text-muted-foreground w-5 tabular-nums">{index + 1}</span>
                  <span className="text-xs font-medium flex-1">{city.city}</span>
                  <span className="text-xs font-medium tabular-nums">{city.displayCount.toLocaleString()}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-5 text-muted-foreground text-xs border-t border-border">
              Not enough data
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
