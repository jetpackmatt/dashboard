"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { MapPinIcon, TrendingUpIcon } from "lucide-react"
import { StateVolumeData, CityVolumeData } from "@/lib/analytics/types"

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
    <Card className="h-full overflow-hidden flex flex-col">
      <CardHeader className="flex-shrink-0 border-b">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">{stateData.stateName}</CardTitle>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close panel"
          >
            ×
          </button>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* State Overview */}
        <div>
          <h4 className="text-xs font-semibold mb-2">State Volume Metrics</h4>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-0.5">
              <div className="text-[10px] text-muted-foreground">Total Orders</div>
              <div className="text-xl font-bold tabular-nums">{stateData.orderCount.toLocaleString()}</div>
            </div>
            <div className="space-y-0.5">
              <div className="text-[10px] text-muted-foreground">% of Total Volume</div>
              <div className="text-xl font-bold tabular-nums">{stateData.percent.toFixed(1)}%</div>
            </div>
          </div>
        </div>

        {/* Average Orders Per Day */}
        <div className="flex items-center justify-between p-3 rounded-lg border">
          <div className="flex items-center gap-2">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center">
              <TrendingUpIcon className="w-4 h-4 text-green-600" />
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground">Avg Orders/Day</div>
              <div className="text-base font-semibold tabular-nums">
                {stateData.avgOrdersPerDay.toFixed(1)}
              </div>
            </div>
          </div>
        </div>

        {/* Top 10 Cities */}
        <div>
          <h4 className="text-xs font-semibold mb-2 flex items-center gap-2">
            <MapPinIcon className="w-3 h-3" />
            Top 10 Cities by Volume
          </h4>
          {cityData.slice(0, 10).length > 0 ? (
            <div className="border rounded-lg overflow-hidden">
              <Table className="text-xs">
                <TableHeader>
                  <TableRow className="h-8">
                    <TableHead className="w-6 py-1 px-2">#</TableHead>
                    <TableHead className="py-1 px-2">City</TableHead>
                    <TableHead className="text-right py-1 px-2">Orders</TableHead>
                    <TableHead className="text-right py-1 px-2">% State</TableHead>
                    <TableHead className="text-right py-1 px-2">% USA</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cityData.slice(0, 10).map((city, index) => {
                    const percentOfState = stateData.orderCount > 0
                      ? (city.orderCount / stateData.orderCount * 100)
                      : 0
                    return (
                      <TableRow key={`${city.city}-${city.state}-${index}`} className="h-7">
                        <TableCell className="font-medium text-muted-foreground py-1 px-2">
                          {index + 1}
                        </TableCell>
                        <TableCell className="font-medium py-1 px-2">{capitalizeCity(city.city)}</TableCell>
                        <TableCell className="text-right tabular-nums py-1 px-2">
                          {city.orderCount.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right py-1 px-2">
                          <span className="tabular-nums text-muted-foreground">
                            {percentOfState.toFixed(1)}%
                          </span>
                        </TableCell>
                        <TableCell className="text-right py-1 px-2">
                          <span className="tabular-nums text-muted-foreground">
                            {city.percent.toFixed(2)}%
                          </span>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-4 text-muted-foreground text-xs">
              No city data available for this state
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
