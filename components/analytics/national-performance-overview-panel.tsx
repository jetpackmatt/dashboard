"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { GlobeIcon, TrophyIcon, MousePointerClickIcon, CheckCircle2Icon, TruckIcon, PackageIcon } from "lucide-react"
import type { StatePerformance } from "@/lib/analytics/types"

interface NationalPerformanceOverviewPanelProps {
  stateData: StatePerformance[]
}

export function NationalPerformanceOverviewPanel({ stateData }: NationalPerformanceOverviewPanelProps) {
  // Calculate national totals
  const totalOrders = stateData.reduce((sum, s) => sum + s.orderCount, 0)
  const totalShipped = stateData.reduce((sum, s) => sum + s.shippedCount, 0)
  const totalDelivered = stateData.reduce((sum, s) => sum + s.deliveredCount, 0)
  const statesWithOrders = stateData.filter(s => s.orderCount > 0).length

  // Calculate weighted average delivery time (weight by delivered count)
  const totalWeightedDays = stateData.reduce((sum, s) => sum + (s.avgDeliveryTimeDays * s.deliveredCount), 0)
  const avgDeliveryTime = totalDelivered > 0 ? totalWeightedDays / totalDelivered : 0

  // Get top 5 fastest states (by avg delivery time, min 10 orders)
  const fastestStates = [...stateData]
    .filter(s => s.deliveredCount >= 10)
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

  return (
    <Card className="h-full overflow-hidden flex flex-col">
      <CardHeader className="flex-shrink-0 border-b">
        <div className="flex items-center gap-2">
          <GlobeIcon className="w-4 h-4 text-muted-foreground" />
          <CardTitle className="text-lg">National Overview</CardTitle>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* National Performance Summary */}
        <div>
          <h4 className="text-xs font-semibold mb-2">National Performance</h4>
          <div className="text-center py-4 px-4 bg-muted/50 rounded-lg mb-3">
            <div className="text-[10px] text-muted-foreground mb-1">Avg Delivery Time</div>
            <div className="text-3xl font-bold tabular-nums">
              {avgDeliveryTime.toFixed(1)}
            </div>
            <div className="text-[10px] text-muted-foreground">days</div>
          </div>
          <div className="text-[10px] text-muted-foreground text-center">
            Across {statesWithOrders} states
          </div>
        </div>

        {/* Delivery Pipeline Summary */}
        <div className="space-y-2">
          <h4 className="text-xs font-semibold">Delivery Pipeline</h4>
          <div className="flex items-center gap-2 p-2 bg-muted/30 rounded-lg">
            <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center" style={{ backgroundColor: '#328bcb15' }}>
              <PackageIcon className="w-3.5 h-3.5" style={{ color: '#328bcb' }} />
            </div>
            <div className="flex-1">
              <div className="text-[10px] text-muted-foreground">Ordered</div>
              <div className="text-sm font-semibold tabular-nums">{totalOrders.toLocaleString()}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 p-2 bg-muted/30 rounded-lg">
            <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center" style={{ backgroundColor: '#ec955915' }}>
              <TruckIcon className="w-3.5 h-3.5" style={{ color: '#ec9559' }} />
            </div>
            <div className="flex-1">
              <div className="text-[10px] text-muted-foreground">Shipped</div>
              <div className="text-sm font-semibold tabular-nums">
                {totalShipped.toLocaleString()}
                <span className="text-[10px] text-muted-foreground ml-1">
                  ({totalOrders > 0 ? ((totalShipped / totalOrders) * 100).toFixed(0) : 0}%)
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 p-2 bg-muted/30 rounded-lg">
            <div className="flex-shrink-0 w-7 h-7 rounded-full bg-green-500/10 flex items-center justify-center">
              <CheckCircle2Icon className="w-3.5 h-3.5 text-green-500" />
            </div>
            <div className="flex-1">
              <div className="text-[10px] text-muted-foreground">Delivered</div>
              <div className="text-sm font-semibold tabular-nums">
                {totalDelivered.toLocaleString()}
                <span className="text-[10px] text-muted-foreground ml-1">
                  ({totalOrders > 0 ? ((totalDelivered / totalOrders) * 100).toFixed(0) : 0}%)
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Top 5 Fastest States */}
        <div>
          <h4 className="text-xs font-semibold mb-2 flex items-center gap-2">
            <TrophyIcon className="w-3 h-3" />
            Top 5 Fastest States
          </h4>
          {fastestStates.length > 0 ? (
            <div className="border rounded-lg overflow-hidden">
              <Table className="text-xs">
                <TableHeader>
                  <TableRow className="h-8">
                    <TableHead className="w-6 py-1 px-2">#</TableHead>
                    <TableHead className="py-1 px-2">State</TableHead>
                    <TableHead className="text-right py-1 px-2">Avg Days</TableHead>
                    <TableHead className="text-right py-1 px-2"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fastestStates.map((state, index) => (
                    <TableRow key={state.state} className="h-7">
                      <TableCell className="font-medium text-muted-foreground py-1 px-2">
                        {index + 1}
                      </TableCell>
                      <TableCell className="font-medium py-1 px-2">{state.stateName}</TableCell>
                      <TableCell className="text-right tabular-nums py-1 px-2">
                        {state.avgDeliveryTimeDays.toFixed(1)}
                      </TableCell>
                      <TableCell className="text-right py-1 px-2">
                        {getPerformanceBadge(state.avgDeliveryTimeDays)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-center py-4 text-muted-foreground text-xs">
              Not enough data
            </div>
          )}
        </div>

        {/* Click hint */}
        <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground">
          <MousePointerClickIcon className="w-4 h-4 flex-shrink-0" />
          <span>Click a state on the map to view detailed performance metrics</span>
        </div>
      </CardContent>
    </Card>
  )
}
