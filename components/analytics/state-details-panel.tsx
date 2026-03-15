"use client"

import type { StatePerformance } from "@/lib/analytics/types"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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

  const fulfillToDelivery = stateData.avgRegionalMileDays + stateData.avgCarrierTransitDays

  return (
    <Card className="h-full overflow-hidden flex flex-col bg-gradient-to-b from-zinc-100 to-white dark:from-zinc-800 dark:to-zinc-950">
      <CardHeader className="flex-shrink-0 border-b border-border">
        <div className="flex items-center gap-2">
          <CardTitle className="text-lg">{stateData.stateName}</CardTitle>
          <Badge variant="secondary" className="tabular-nums text-xs font-medium ml-auto">{stateData.orderCount.toLocaleString()} orders</Badge>
        </div>
      </CardHeader>

      {/* Time Metrics — full-bleed grid */}
      <div className="flex-shrink-0">
        {/* Primary row: Order to Delivery | Ship to Delivery */}
        <div className="grid grid-cols-2">
          <div className="text-center px-3 py-4 border-r border-border bg-blue-50/50 dark:bg-blue-950/20">
            <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">Order to Delivery</div>
            <div className="text-2xl font-bold tabular-nums">{stateData.avgDeliveryTimeDays.toFixed(1)}</div>
            <div className="text-[10px] text-zinc-400 dark:text-zinc-500">calendar days</div>
          </div>
          <div className="text-center px-3 py-4 bg-indigo-50/50 dark:bg-indigo-950/20">
            <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">Ship to Delivery</div>
            <div className="text-2xl font-bold tabular-nums">{fulfillToDelivery.toFixed(1)}</div>
            <div className="text-[10px] text-zinc-400 dark:text-zinc-500">calendar days</div>
          </div>
        </div>
        {/* Breakdown: Fulfill | Regional Mile | Final Mile */}
        <div className="grid grid-cols-3 border-t border-border">
          <div className="text-center px-2 py-3 border-r border-border bg-amber-50/40 dark:bg-amber-950/15">
            <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">Fulfillment</div>
            <div className="text-lg font-bold tabular-nums">{stateData.avgFulfillTimeHours.toFixed(1)}</div>
            <div className="text-[10px] text-zinc-400 dark:text-zinc-500">op. hours</div>
          </div>
          <div className="text-center px-2 py-3 border-r border-border bg-emerald-50/40 dark:bg-emerald-950/15">
            <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">Regional Mile</div>
            <div className="text-lg font-bold tabular-nums">{stateData.avgRegionalMileDays.toFixed(1)}</div>
            <div className="text-[10px] text-zinc-400 dark:text-zinc-500">days</div>
          </div>
          <div className="text-center px-2 py-3 bg-sky-50/40 dark:bg-sky-950/15">
            <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">Final Mile</div>
            <div className="text-lg font-bold tabular-nums">{stateData.avgCarrierTransitDays.toFixed(1)}</div>
            <div className="text-[10px] text-zinc-400 dark:text-zinc-500">days</div>
          </div>
        </div>
        {/* Delay Toggle row */}
        {delayImpact && delayImpact.affectedShipments > 0 && onToggleDelayed && (
          <div className="flex items-center gap-2 px-3 py-3.5 border-t border-border bg-orange-50/30 dark:bg-orange-950/10">
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
          <div className="px-4 pt-4 pb-2">
            <h4 className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
              Top 5 Cities
            </h4>
          </div>
          {topCities.length > 0 ? (
            <div>
              {topCities.map((city, index) => (
                <div key={city.city} className="flex items-center px-4 py-2 border-t border-border hover:bg-muted/30 transition-colors">
                  <span className="text-xs text-muted-foreground w-5 tabular-nums">{index + 1}</span>
                  <span className="text-xs font-medium flex-1">{city.city}</span>
                  <span className="text-xs font-medium tabular-nums">{city.displayCount.toLocaleString()}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-4 text-muted-foreground text-xs border-t border-border">
              Not enough data
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
