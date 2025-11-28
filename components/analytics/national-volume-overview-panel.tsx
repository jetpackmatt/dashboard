"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { GlobeIcon, MapPinIcon, MousePointerClickIcon } from "lucide-react"
import { StateVolumeData, ZipCodeVolumeData } from "@/lib/analytics/types"

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
    <Card className="h-full overflow-hidden flex flex-col">
      <CardHeader className="flex-shrink-0 border-b">
        <div className="flex items-center gap-2">
          <GlobeIcon className="w-4 h-4 text-muted-foreground" />
          <CardTitle className="text-lg">National Overview</CardTitle>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* National Stats */}
        <div>
          <h4 className="text-xs font-semibold mb-2">National Volume Metrics</h4>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-0.5">
              <div className="text-[10px] text-muted-foreground">Total Orders</div>
              <div className="text-xl font-bold tabular-nums">{totalOrders.toLocaleString()}</div>
            </div>
            <div className="space-y-0.5">
              <div className="text-[10px] text-muted-foreground">Avg Orders/Day</div>
              <div className="text-xl font-bold tabular-nums">{totalAvgPerDay.toFixed(1)}</div>
            </div>
          </div>
          <div className="mt-2 text-[10px] text-muted-foreground">
            Across {statesWithOrders} states
          </div>
        </div>

        {/* Top 10 Cities */}
        <div>
          <h4 className="text-xs font-semibold mb-2 flex items-center gap-2">
            <MapPinIcon className="w-3 h-3" />
            Top 10 Cities Nationwide
          </h4>
          {topCities.length > 0 ? (
            <div className="border rounded-lg overflow-hidden">
              <Table className="text-xs">
                <TableHeader>
                  <TableRow className="h-8">
                    <TableHead className="w-6 py-1 px-2">#</TableHead>
                    <TableHead className="py-1 px-2">City</TableHead>
                    <TableHead className="py-1 px-2">State</TableHead>
                    <TableHead className="text-right py-1 px-2">Orders</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topCities.map((city, index) => (
                    <TableRow key={`${city.city}-${city.state}-${index}`} className="h-7">
                      <TableCell className="font-medium text-muted-foreground py-1 px-2">
                        {index + 1}
                      </TableCell>
                      <TableCell className="font-medium py-1 px-2">{capitalizeCity(city.city)}</TableCell>
                      <TableCell className="text-muted-foreground py-1 px-2">
                        {city.state}
                      </TableCell>
                      <TableCell className="text-right tabular-nums py-1 px-2">
                        {city.orderCount.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-4 text-muted-foreground text-xs">
              No city data available
            </div>
          )}
        </div>

        {/* Click hint */}
        <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground">
          <MousePointerClickIcon className="w-4 h-4 flex-shrink-0" />
          <span>Click a state on the map to view state-specific volume and top cities</span>
        </div>
      </CardContent>
    </Card>
  )
}
