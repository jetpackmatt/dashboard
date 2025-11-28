"use client"

import type { StatePerformance } from "@/lib/analytics/types"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { CheckCircle2Icon, PackageIcon, TruckIcon } from "lucide-react"

interface StateDetailsPanelProps {
  stateData: StatePerformance
}

export function StateDetailsPanel({ stateData }: StateDetailsPanelProps) {
  const getPerformanceBadge = (avgDays: number) => {
    if (avgDays < 3) {
      return <Badge className="bg-green-500">Excellent</Badge>
    } else if (avgDays < 5) {
      return <Badge className="bg-[hsl(203,61%,50%)]">Good</Badge>
    } else {
      return <Badge className="bg-red-500">Needs Attention</Badge>
    }
  }

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-2xl">{stateData.stateName}</CardTitle>
            <CardDescription className="mt-1">Delivery Performance Metrics</CardDescription>
          </div>
          {getPerformanceBadge(stateData.avgDeliveryTimeDays)}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Average Delivery Time - Prominent Display */}
        <div className="text-center py-6 px-4 bg-muted/50 rounded-lg">
          <div className="text-sm text-muted-foreground mb-2">Average Delivery Time</div>
          <div className="text-5xl font-bold tabular-nums">
            {stateData.avgDeliveryTimeDays.toFixed(1)}
          </div>
          <div className="text-sm text-muted-foreground mt-1">days</div>
        </div>

        {/* Delivery Pipeline */}
        <div>
          <h4 className="text-sm font-semibold mb-4">Delivery Pipeline</h4>
          <div className="space-y-4">
            {/* Step 1: Ordered */}
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: '#328bcb15' }}>
                <PackageIcon className="w-5 h-5" style={{ color: '#328bcb' }} />
              </div>
              <div className="flex-1 pt-1">
                <div className="flex items-center justify-between mb-1">
                  <div className="font-medium text-sm">Ordered</div>
                  <div className="text-lg font-semibold tabular-nums">{stateData.orderCount}</div>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div className="h-full transition-all" style={{ width: '100%', backgroundColor: '#328bcb' }} />
                </div>
              </div>
            </div>

            {/* Step 2: Shipped */}
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: '#ec955915' }}>
                <TruckIcon className="w-5 h-5" style={{ color: '#ec9559' }} />
              </div>
              <div className="flex-1 pt-1">
                <div className="flex items-center justify-between mb-1">
                  <div className="font-medium text-sm">Shipped</div>
                  <div className="flex items-center gap-2">
                    <div className="text-lg font-semibold tabular-nums">{stateData.shippedCount}</div>
                    <Badge variant="outline" className="text-xs">
                      {stateData.shippedPercent.toFixed(1)}%
                    </Badge>
                  </div>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full transition-all"
                    style={{ width: `${stateData.shippedPercent}%`, backgroundColor: '#ec9559' }}
                  />
                </div>
              </div>
            </div>

            {/* Step 3: Delivered */}
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center">
                <CheckCircle2Icon className="w-5 h-5 text-green-500" />
              </div>
              <div className="flex-1 pt-1">
                <div className="flex items-center justify-between mb-1">
                  <div className="font-medium text-sm">Delivered</div>
                  <div className="flex items-center gap-2">
                    <div className="text-lg font-semibold tabular-nums">{stateData.deliveredCount}</div>
                    <Badge variant="outline" className="text-xs">
                      {stateData.deliveredPercent.toFixed(1)}%
                    </Badge>
                  </div>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500 transition-all"
                    style={{ width: `${stateData.deliveredPercent}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Summary Stats Grid */}
        <div className="grid grid-cols-2 gap-4 pt-4 border-t">
          <div className="text-center p-3 bg-muted/30 rounded-lg">
            <div className="text-xs text-muted-foreground mb-1">In Transit</div>
            <div className="text-xl font-bold tabular-nums">
              {stateData.shippedCount - stateData.deliveredCount}
            </div>
          </div>
          <div className="text-center p-3 bg-muted/30 rounded-lg">
            <div className="text-xs text-muted-foreground mb-1">Completion Rate</div>
            <div className="text-xl font-bold tabular-nums">
              {stateData.deliveredPercent.toFixed(0)}%
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
