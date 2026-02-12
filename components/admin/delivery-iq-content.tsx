"use client"

import * as React from "react"
import { RefreshCwIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

// Flat card with no shadow - matching shadcn demo exactly
function FlatCard({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-xl border border-gray-200/60 bg-white",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

// Types for API response
interface DeliveryIQStats {
  overview: {
    totalTrainingRecords: number
    deliveryRate: string
    lossRate: string
    totalCurves: number
    highConfidenceCurves: number
    mediumConfidenceCurves: number
    lowConfidenceCurves: number
    carriersTracked: number
    avgMedianTransit: string | null
    lastCurveComputation: string | null
    deliveredCount: number
    lostCount: number
    censoredCount: number
  }
  outcomes: {
    delivered: number
    lost_claim: number
    lost_exception: number
    lost_timeout: number
    lost_tracking: number
    censored: number
  }
  curveConfidence: Record<string, number>
  carriers: Array<{
    carrier: string
    total: number
    deliveryRate: string
    lossRate: string
  }>
  confidenceHeatmap: Record<string, Record<string, { confidence: string; sampleSize: number }>>
  checkpoints: {
    totalCheckpoints: number
    normalized: number
    unnormalized: number
  }
}

// Clean stat card - flat design, no shadows
function StatCard({
  title,
  value,
  subtitle,
}: {
  title: string
  value: string | number
  subtitle?: string
}) {
  return (
    <FlatCard className="p-6">
      <p className="text-sm text-gray-500">{title}</p>
      <p className="mt-3 text-3xl font-semibold text-gray-900">{value}</p>
      {subtitle && (
        <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
      )}
    </FlatCard>
  )
}

// Outcome distribution - clean minimal design
function OutcomeChart({ outcomes }: { outcomes: DeliveryIQStats['outcomes'] }) {
  const total = Object.values(outcomes).reduce((a, b) => a + b, 0)
  const items = [
    { key: 'delivered', label: 'Delivered', color: 'bg-emerald-500', dotColor: 'bg-emerald-500', count: outcomes.delivered },
    { key: 'censored', label: 'In Transit', color: 'bg-blue-500', dotColor: 'bg-blue-500', count: outcomes.censored },
    { key: 'lost_claim', label: 'Lost (Claim)', color: 'bg-red-500', dotColor: 'bg-red-500', count: outcomes.lost_claim },
    { key: 'lost_exception', label: 'Lost (Exception)', color: 'bg-orange-500', dotColor: 'bg-orange-500', count: outcomes.lost_exception },
    { key: 'lost_timeout', label: 'Lost (Timeout)', color: 'bg-amber-500', dotColor: 'bg-amber-500', count: outcomes.lost_timeout },
  ].filter(i => i.count > 0)

  return (
    <div className="space-y-6">
      {/* Stacked bar */}
      <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-100">
        {items.map((item) => (
          <div
            key={item.key}
            className={cn(item.color)}
            style={{ width: `${(item.count / total) * 100}%` }}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
        {items.map((item) => (
          <div key={item.key}>
            <div className="flex items-center gap-2 mb-1">
              <div className={cn('w-2 h-2 rounded-full', item.dotColor)} />
              <span className="text-sm text-gray-500">{item.label}</span>
            </div>
            <p className="text-xl font-semibold text-gray-900">{item.count.toLocaleString()}</p>
            <p className="text-sm text-gray-400">
              {((item.count / total) * 100).toFixed(1)}%
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

// Carrier performance table - minimal borders
function CarrierTable({ carriers }: { carriers: DeliveryIQStats['carriers'] }) {
  return (
    <div className="overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-100">
            <th className="text-left py-3 text-sm font-medium text-gray-500">Carrier</th>
            <th className="text-right py-3 text-sm font-medium text-gray-500">Shipments</th>
            <th className="text-right py-3 text-sm font-medium text-gray-500">Delivery Rate</th>
            <th className="text-right py-3 text-sm font-medium text-gray-500">Loss Rate</th>
          </tr>
        </thead>
        <tbody>
          {carriers.map((carrier) => (
            <tr key={carrier.carrier} className="border-b border-gray-50 last:border-0">
              <td className="py-3 text-sm font-medium text-gray-900">{carrier.carrier}</td>
              <td className="py-3 text-sm text-right tabular-nums text-gray-600">{carrier.total.toLocaleString()}</td>
              <td className="py-3 text-sm text-right">
                <span className={cn(
                  "tabular-nums font-medium",
                  parseFloat(carrier.deliveryRate) >= 99 ? 'text-emerald-600' :
                  parseFloat(carrier.deliveryRate) >= 97 ? 'text-amber-600' :
                  'text-red-600'
                )}>
                  {carrier.deliveryRate}%
                </span>
              </td>
              <td className="py-3 text-sm text-right">
                <span className={cn(
                  "tabular-nums",
                  parseFloat(carrier.lossRate) <= 0.5 ? 'text-gray-400' :
                  parseFloat(carrier.lossRate) <= 1 ? 'text-amber-600' :
                  'text-red-600'
                )}>
                  {carrier.lossRate}%
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Confidence heatmap - flat chips
// Uses individual zones (zone_1 through zone_10, international) for accuracy
function ConfidenceHeatmap({ heatmap }: { heatmap: DeliveryIQStats['confidenceHeatmap'] }) {
  // Sort carriers by total sample size (most data first), not alphabetically
  const carriers = Object.keys(heatmap).sort((a, b) => {
    const aSamples = Object.values(heatmap[a] || {}).reduce((sum, cell) => sum + (cell?.sampleSize || 0), 0)
    const bSamples = Object.values(heatmap[b] || {}).reduce((sum, cell) => sum + (cell?.sampleSize || 0), 0)
    return bSamples - aSamples
  })
  // Individual zones for accuracy - zone_1 through zone_10 plus international
  const zones = ['zone_1', 'zone_2', 'zone_3', 'zone_4', 'zone_5', 'zone_6', 'zone_7', 'zone_8', 'zone_9', 'zone_10', 'international']
  const zoneLabels: Record<string, string> = {
    zone_1: '1',
    zone_2: '2',
    zone_3: '3',
    zone_4: '4',
    zone_5: '5',
    zone_6: '6',
    zone_7: '7',
    zone_8: '8',
    zone_9: '9',
    zone_10: '10',
    international: 'Intl',
  }

  const getStyles = (confidence: string | undefined, hasData: boolean) => {
    if (!hasData) return 'bg-white text-gray-200' // No data - very faint
    switch (confidence) {
      case 'high': return 'bg-emerald-50 text-emerald-600'
      case 'medium': return 'bg-amber-50 text-amber-600'
      case 'low': return 'bg-orange-50 text-orange-600'
      default: return 'bg-red-50 text-red-400' // insufficient but has data
    }
  }

  const getLabel = (confidence: string | undefined, hasData: boolean) => {
    if (!hasData) return '·' // Dot for no data
    switch (confidence) {
      case 'high': return 'H'
      case 'medium': return 'M'
      case 'low': return 'L'
      default: return '!' // Exclamation for insufficient
    }
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left py-3 pr-4 text-sm font-medium text-gray-500 w-40">Carrier</th>
              {zones.map(zone => (
                <th key={zone} className="text-center py-3 px-1 text-sm font-medium text-gray-500">
                  {zoneLabels[zone]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {carriers.slice(0, 15).map((carrier) => (
              <tr key={carrier} className="border-b border-gray-50 last:border-0">
                <td className="py-3 pr-4 text-sm font-medium text-gray-900">{carrier}</td>
                {zones.map((zone) => {
                  const cell = heatmap[carrier]?.[zone]
                  const hasData = !!cell
                  return (
                    <td key={zone} className="py-2 px-1 text-center">
                      <span
                        className={cn(
                          'inline-block w-6 h-6 rounded text-[10px] font-medium leading-6',
                          getStyles(cell?.confidence, hasData)
                        )}
                        title={cell ? `Zone ${zoneLabels[zone]}: ${cell.confidence} (${cell.sampleSize.toLocaleString()} samples)` : `Zone ${zoneLabels[zone]}: No data`}
                      >
                        {getLabel(cell?.confidence, hasData)}
                      </span>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-6 text-sm pt-2">
        <div className="flex items-center gap-2">
          <span className="inline-block w-6 h-6 rounded text-[10px] font-medium leading-6 text-center bg-emerald-50 text-emerald-600">H</span>
          <span className="text-gray-400">High (500+)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block w-6 h-6 rounded text-[10px] font-medium leading-6 text-center bg-amber-50 text-amber-600">M</span>
          <span className="text-gray-400">Medium (100-499)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block w-6 h-6 rounded text-[10px] font-medium leading-6 text-center bg-orange-50 text-orange-600">L</span>
          <span className="text-gray-400">Low (50-99)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block w-6 h-6 rounded text-[10px] font-medium leading-6 text-center bg-red-50 text-red-400">!</span>
          <span className="text-gray-400">Insufficient (&lt;50)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block w-6 h-6 rounded text-[10px] font-medium leading-6 text-center bg-white text-gray-200">·</span>
          <span className="text-gray-400">No data</span>
        </div>
      </div>
    </div>
  )
}

// Checkpoint stats - inline display
function CheckpointStats({ checkpoints }: { checkpoints: DeliveryIQStats['checkpoints'] }) {
  const normalizationRate = checkpoints.totalCheckpoints > 0
    ? ((checkpoints.normalized / checkpoints.totalCheckpoints) * 100).toFixed(1)
    : '0'

  return (
    <div className="grid gap-6 md:grid-cols-3">
      <div>
        <p className="text-sm text-gray-500 mb-1">Total Checkpoints</p>
        <p className="text-2xl font-semibold text-gray-900">{checkpoints.totalCheckpoints.toLocaleString()}</p>
        <p className="text-sm text-gray-400">Stored from TrackingMore</p>
      </div>
      <div>
        <p className="text-sm text-gray-500 mb-1">AI Normalized</p>
        <p className="text-2xl font-semibold text-gray-900">{checkpoints.normalized.toLocaleString()}</p>
        <p className="text-sm text-emerald-600">{normalizationRate}% complete</p>
      </div>
      <div>
        <p className="text-sm text-gray-500 mb-1">Pending</p>
        <p className="text-2xl font-semibold text-gray-900">{checkpoints.unnormalized.toLocaleString()}</p>
        <p className="text-sm text-gray-400">Awaiting normalization</p>
      </div>
    </div>
  )
}

export function DeliveryIQContent() {
  const [stats, setStats] = React.useState<DeliveryIQStats | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = React.useState(false)

  const fetchStats = React.useCallback(async () => {
    try {
      const response = await fetch('/api/admin/delivery-iq/stats')
      if (!response.ok) throw new Error('Failed to fetch stats')
      const data = await response.json()
      setStats(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  React.useEffect(() => {
    fetchStats()
  }, [fetchStats])

  const handleRefresh = () => {
    setIsRefreshing(true)
    fetchStats()
  }

  const handleRecomputeCurves = async () => {
    setIsRefreshing(true)
    try {
      await fetch('/api/cron/compute-survival-curves', { method: 'POST' })
      await fetchStats()
    } catch {
      setError('Failed to recompute curves')
    }
    setIsRefreshing(false)
  }

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center py-20">
        <RefreshCwIcon className="h-5 w-5 animate-spin text-gray-400" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 py-20">
        <p className="text-sm text-gray-500">{error}</p>
        <Button variant="outline" size="sm" onClick={handleRefresh} className="bg-white">
          Try again
        </Button>
      </div>
    )
  }

  if (!stats) return null

  return (
    <div className="bg-gray-50/50 p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Delivery Intelligence</h1>
            <p className="text-sm text-gray-500 mt-1">
              Scout survival analysis engine
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing} className="bg-white">
              <RefreshCwIcon className={cn("h-4 w-4 mr-2", isRefreshing && "animate-spin")} />
              Refresh
            </Button>
            <Button size="sm" onClick={handleRecomputeCurves} disabled={isRefreshing}>
              Recompute Curves
            </Button>
          </div>
        </div>

        {/* Overview Stats */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Training Records"
            value={stats.overview.totalTrainingRecords.toLocaleString()}
            subtitle={`${stats.overview.deliveredCount.toLocaleString()} delivered, ${stats.overview.lostCount.toLocaleString()} lost`}
          />
          <StatCard
            title="Delivery Rate"
            value={`${stats.overview.deliveryRate}%`}
            subtitle={`${stats.overview.lossRate}% loss rate`}
          />
          <StatCard
            title="Usable Curves"
            value={`${stats.overview.highConfidenceCurves + stats.overview.mediumConfidenceCurves}/${stats.overview.totalCurves}`}
            subtitle={`${stats.overview.highConfidenceCurves} high confidence, ${stats.overview.mediumConfidenceCurves} medium`}
          />
          <StatCard
            title="Avg Transit Time"
            value={stats.overview.avgMedianTransit ? `${stats.overview.avgMedianTransit} days` : '—'}
            subtitle={`${stats.overview.carriersTracked} carriers tracked`}
          />
        </div>

        {/* Last computation */}
        {stats.overview.lastCurveComputation && (
          <p className="text-sm text-gray-400">
            Last curve computation: {new Date(stats.overview.lastCurveComputation).toLocaleString()}
          </p>
        )}

        {/* Tabs for detailed views */}
        <Tabs defaultValue="outcomes" className="space-y-6">
          <div className="inline-flex h-10 items-center justify-center rounded-lg bg-white border border-gray-200/60 p-1">
            <TabsList className="bg-transparent h-auto p-0 gap-1">
              <TabsTrigger value="outcomes" className="rounded-md px-3 py-1.5 text-sm font-medium data-[state=active]:bg-gray-100 data-[state=active]:shadow-none data-[state=inactive]:text-gray-500">Outcomes</TabsTrigger>
              <TabsTrigger value="carriers" className="rounded-md px-3 py-1.5 text-sm font-medium data-[state=active]:bg-gray-100 data-[state=active]:shadow-none data-[state=inactive]:text-gray-500">Carriers</TabsTrigger>
              <TabsTrigger value="confidence" className="rounded-md px-3 py-1.5 text-sm font-medium data-[state=active]:bg-gray-100 data-[state=active]:shadow-none data-[state=inactive]:text-gray-500">Confidence</TabsTrigger>
              <TabsTrigger value="checkpoints" className="rounded-md px-3 py-1.5 text-sm font-medium data-[state=active]:bg-gray-100 data-[state=active]:shadow-none data-[state=inactive]:text-gray-500">Checkpoints</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="outcomes">
            <FlatCard className="p-6">
              <div className="mb-6">
                <h3 className="text-base font-medium text-gray-900">Shipment Outcomes</h3>
                <p className="text-sm text-gray-500">
                  Distribution across {stats.overview.totalTrainingRecords.toLocaleString()} shipments
                </p>
              </div>
              <OutcomeChart outcomes={stats.outcomes} />
            </FlatCard>
          </TabsContent>

          <TabsContent value="carriers">
            <FlatCard className="p-6">
              <div className="mb-6">
                <h3 className="text-base font-medium text-gray-900">Carrier Performance</h3>
                <p className="text-sm text-gray-500">Delivery and loss rates by carrier</p>
              </div>
              <CarrierTable carriers={stats.carriers} />
            </FlatCard>
          </TabsContent>

          <TabsContent value="confidence">
            <FlatCard className="p-6">
              <div className="mb-6">
                <h3 className="text-base font-medium text-gray-900">Confidence Matrix</h3>
                <p className="text-sm text-gray-500">Sample size confidence by carrier and zone</p>
              </div>
              <ConfidenceHeatmap heatmap={stats.confidenceHeatmap} />
            </FlatCard>
          </TabsContent>

          <TabsContent value="checkpoints">
            <FlatCard className="p-6">
              <div className="mb-6">
                <h3 className="text-base font-medium text-gray-900">Checkpoint Storage</h3>
                <p className="text-sm text-gray-500">TrackingMore data for Tier 2 survival analysis</p>
              </div>
              <CheckpointStats checkpoints={stats.checkpoints} />
            </FlatCard>
          </TabsContent>
        </Tabs>

        {/* Curve Confidence Distribution */}
        <FlatCard className="p-6">
          <div className="mb-6">
            <h3 className="text-base font-medium text-gray-900">Curve Distribution</h3>
            <p className="text-sm text-gray-500">{stats.overview.totalCurves} survival curves by confidence level</p>
          </div>
          <div className="flex flex-wrap items-center gap-6">
            {Object.entries(stats.curveConfidence).map(([level, count]) => (
              <div key={level} className="flex items-center gap-3">
                <span className={cn(
                  "inline-block px-3 py-1 rounded-md text-xs font-medium",
                  level === 'high' && "bg-emerald-50 text-emerald-600",
                  level === 'medium' && "bg-amber-50 text-amber-600",
                  level === 'low' && "bg-orange-50 text-orange-600",
                  level === 'insufficient' && "bg-red-50 text-red-500"
                )}>
                  {level}
                </span>
                <span className="text-xl font-semibold tabular-nums text-gray-900">{count}</span>
              </div>
            ))}
          </div>
        </FlatCard>
      </div>
    </div>
  )
}
