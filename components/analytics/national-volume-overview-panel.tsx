"use client"

import { MapPinIcon } from "lucide-react"
import { StateVolumeData, ZipCodeVolumeData } from "@/lib/analytics/types"
import { AnimatedNumber } from "@/components/analytics/animated-number"

interface NationalVolumeOverviewPanelProps {
  stateData: StateVolumeData[]
  cityData: ZipCodeVolumeData[]
}

// Helper to properly capitalize city names (e.g., "BARRY" -> "Barry", "NEW YORK" -> "New York")
function capitalizeCity(name: string): string {
  return name
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export function NationalVolumeOverviewPanel({ stateData, cityData }: NationalVolumeOverviewPanelProps) {
  // Calculate national totals
  const totalOrders = stateData.reduce((sum, s) => sum + s.orderCount, 0)
  const totalAvgPerDay = stateData.reduce((sum, s) => sum + s.avgOrdersPerDay, 0)
  const statesWithOrders = stateData.filter(s => s.orderCount > 0).length

  // Get top 10 cities nationally (data should already be sorted)
  const topCities = cityData.slice(0, 10)

  return (
    <div className="h-full overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-border px-5 py-4 h-[68px] flex items-center">
        <div className="text-sm font-semibold">National Overview</div>
      </div>

      {/* Volume metrics — colored cells like Performance tab */}
      <div className="flex-shrink-0">
        <div className="grid grid-cols-2">
          <div className="text-center px-3 py-4 border-r border-border bg-sky-50/50 dark:bg-sky-950/20">
            <div className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">Total Orders</div>
            <div className="text-2xl font-bold tabular-nums"><AnimatedNumber value={totalOrders} locale /></div>
          </div>
          <div className="text-center px-3 py-4 bg-emerald-50/40 dark:bg-emerald-950/15">
            <div className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">Avg Orders/Day</div>
            <div className="text-2xl font-bold tabular-nums"><AnimatedNumber value={totalAvgPerDay} decimals={1} /></div>
          </div>
        </div>
        <div className="text-[10px] text-muted-foreground px-5 py-2 border-t border-border bg-indigo-50/30 dark:bg-indigo-950/10">
          Across {statesWithOrders} states
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Top 10 Cities */}
        <div className="border-t border-border">
          <div className="px-5 pt-5 pb-3">
            <h4 className="text-[10px] font-medium uppercase tracking-wider flex items-center gap-2">
              <MapPinIcon className="w-3 h-3" />
              Top 10 Cities Nationwide
            </h4>
          </div>
          {topCities.length > 0 ? (
            <div>
              {topCities.map((city, index) => (
                <div key={`${city.city}-${city.state}-${index}`} className="flex items-center px-5 py-3 border-t border-border hover:bg-muted/30">
                  <span className="text-xs text-muted-foreground w-5 tabular-nums">{index + 1}</span>
                  <span className="text-xs font-medium flex-1 min-w-0 truncate">{capitalizeCity(city.city)}</span>
                  <span className="text-xs text-muted-foreground whitespace-nowrap ml-3">{city.state}</span>
                  <span className="text-xs font-medium tabular-nums ml-3 whitespace-nowrap">{city.orderCount.toLocaleString()}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-5 text-muted-foreground text-xs border-t border-border">
              No city data available
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
