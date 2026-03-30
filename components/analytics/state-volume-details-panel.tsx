"use client"

import { MapPinIcon } from "lucide-react"
import { StateVolumeData, CityVolumeData } from "@/lib/analytics/types"
import { AnimatedNumber } from "@/components/analytics/animated-number"

interface StateVolumeDetailsPanelProps {
  stateData: StateVolumeData
  cityData: CityVolumeData[]
  onClose: () => void
}

// Helper to properly capitalize city names (e.g., "BARRY" -> "Barry", "NEW YORK" -> "New York")
function capitalizeCity(name: string): string {
  return name
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export function StateVolumeDetailsPanel({ stateData, cityData, onClose }: StateVolumeDetailsPanelProps) {
  return (
    <div className="h-full overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-border px-5 py-4 h-[68px] flex items-center justify-between">
        <div className="text-sm font-semibold">{stateData.stateName}</div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors text-lg"
          aria-label="Close panel"
        >
          ×
        </button>
      </div>

      {/* Volume metrics — colored cells like Performance tab */}
      <div className="flex-shrink-0">
        <div className="grid grid-cols-3">
          <div className="text-center px-3 py-4 border-r border-border bg-sky-50/50 dark:bg-sky-950/20">
            <div className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">Total Orders</div>
            <div className="text-2xl font-bold tabular-nums"><AnimatedNumber value={stateData.orderCount} locale /></div>
          </div>
          <div className="text-center px-3 py-4 border-r border-border bg-emerald-50/40 dark:bg-emerald-950/15">
            <div className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">% of Total</div>
            <div className="text-2xl font-bold tabular-nums"><AnimatedNumber value={stateData.percent} decimals={1} suffix="%" /></div>
          </div>
          <div className="text-center px-3 py-4 bg-amber-50/30 dark:bg-amber-950/10">
            <div className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">Avg/Day</div>
            <div className="text-2xl font-bold tabular-nums"><AnimatedNumber value={stateData.avgOrdersPerDay} decimals={1} /></div>
          </div>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Top 10 Cities */}
        <div className="border-t border-border">
          <div className="px-5 pt-5 pb-3">
            <h4 className="text-[10px] font-medium uppercase tracking-wider flex items-center gap-2">
              <MapPinIcon className="w-3 h-3" />
              Top 10 Cities by Volume
            </h4>
          </div>
          {cityData.slice(0, 10).length > 0 ? (
            <div>
              {cityData.slice(0, 10).map((city, index) => {
                const percentOfState = stateData.orderCount > 0
                  ? (city.orderCount / stateData.orderCount * 100)
                  : 0
                return (
                  <div key={`${city.city}-${city.state}-${index}`} className="flex items-center px-5 py-3 border-t border-border hover:bg-muted/30">
                    <span className="text-xs text-muted-foreground w-5 tabular-nums">{index + 1}</span>
                    <span className="text-xs font-medium flex-1">{capitalizeCity(city.city)}</span>
                    <span className="text-xs font-medium tabular-nums">{city.orderCount.toLocaleString()}</span>
                    <span className="text-xs text-muted-foreground tabular-nums ml-3 w-12 text-right">{percentOfState.toFixed(1)}%</span>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-center py-5 text-muted-foreground text-xs border-t border-border">
              No city data available for this state
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
