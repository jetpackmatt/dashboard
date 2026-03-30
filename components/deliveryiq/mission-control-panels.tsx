"use client"

import * as React from "react"
import {
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  XAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts"

// Same interface as MonitoredShipment on the DeliveryIQ page (subset needed for panels)
export interface MissionControlShipment {
  claimEligibilityStatus: string | null
  daysSilent: number
  watchReason: string | null
}

export interface MissionControlStats {
  atRisk: number
  eligible: number
  claimFiled: number
  returnedToSender: number
  totalActiveShipments?: number
}

export interface WatchBreakdownItem {
  reason: string
  count: number
}

export interface DaysSilentData {
  avg: number
  histogram: { day: string; count: number }[]
}

interface MissionControlPanelsProps {
  stats: MissionControlStats
  shipments?: MissionControlShipment[]
  /** Pre-computed watch reason breakdown (from stats API). Skips client-side computation when provided. */
  precomputedWatchBreakdown?: WatchBreakdownItem[]
  /** Pre-computed days-silent data (from stats API). Skips client-side computation when provided. */
  precomputedDaysSilent?: DaysSilentData
  panelClassName?: string
}

const WATCH_REASON_CONFIG: Record<string, { label: string; color: string; order: number }> = {
  'SLOW': { label: 'Slow', color: '#94a3b8', order: 0 },
  'STALLED': { label: 'Stalled', color: '#fbbf24', order: 1 },
  'CUSTOMS': { label: 'Customs', color: '#60a5fa', order: 2 },
  'PICKUP': { label: 'Pickup', color: '#2dd4bf', order: 3 },
  'DELIVERY ISSUE': { label: 'Delivery Issue', color: '#fb7185', order: 4 },
  'NEEDS ACTION': { label: 'Needs Action', color: '#fb923c', order: 5 },
  'STUCK': { label: 'Stuck', color: '#f87171', order: 6 },
  'NO SCANS': { label: 'No Scans', color: '#f87171', order: 7 },
  'RETURNING': { label: 'Returning', color: '#c084fc', order: 8 },
}

const tooltipStyle = { fontSize: 11, borderRadius: 8, padding: '6px 12px', border: '1px solid hsl(var(--border))' }

export function MissionControlPanels({ stats, shipments, precomputedWatchBreakdown, precomputedDaysSilent, panelClassName }: MissionControlPanelsProps) {
  const panelCls = panelClassName ?? "rounded-xl border border-border/60 bg-background overflow-hidden flex flex-col"
  // Panel 1: Status
  const statusData = React.useMemo(() => {
    return [
      { name: 'On Watch', value: stats.atRisk, color: 'hsl(35, 92%, 50%)' },
      { name: 'Ready to File', value: stats.eligible, color: 'hsl(0, 72%, 51%)' },
      { name: 'Claim Filed', value: stats.claimFiled, color: 'hsl(152, 55%, 45%)' },
      { name: 'Returned', value: stats.returnedToSender, color: 'hsl(215, 65%, 55%)' },
    ].filter(d => d.value > 0)
  }, [stats])
  const statusTotal = stats.eligible + stats.atRisk + stats.claimFiled + stats.returnedToSender

  // Panel 2: Watch Breakdown — use pre-computed data if available, otherwise compute from shipments
  const watchBreakdown = React.useMemo(() => {
    if (precomputedWatchBreakdown) {
      const all = precomputedWatchBreakdown
        .map(({ reason, count }) => ({
          badge: reason.replace(/\s+/g, '_'),
          count,
          ...(WATCH_REASON_CONFIG[reason] || { label: reason, color: '#94a3b8', order: 99 }),
        }))
        .sort((a, b) => b.count - a.count)
      if (all.length <= 6) return all
      const top = all.slice(0, 5)
      const otherCount = all.slice(5).reduce((s, b) => s + b.count, 0)
      if (otherCount > 0) {
        top.push({ badge: 'OTHER', count: otherCount, label: 'Other', color: '#94a3b8', order: 99 })
      }
      return top
    }
    const counts: Record<string, number> = {}
    ;(shipments || [])
      .filter(s => s.claimEligibilityStatus === 'at_risk')
      .forEach(s => {
        const reason = s.watchReason || 'STALLED'
        counts[reason] = (counts[reason] || 0) + 1
      })
    const all = Object.entries(counts)
      .map(([reason, count]) => ({
        badge: reason.replace(/\s+/g, '_'),
        count,
        ...(WATCH_REASON_CONFIG[reason] || { label: reason, color: '#94a3b8', order: 99 }),
      }))
      .sort((a, b) => b.count - a.count)
    if (all.length <= 6) return all
    const top = all.slice(0, 5)
    const otherCount = all.slice(5).reduce((s, b) => s + b.count, 0)
    if (otherCount > 0) {
      top.push({ badge: 'OTHER', count: otherCount, label: 'Other', color: '#94a3b8', order: 99 })
    }
    return top
  }, [precomputedWatchBreakdown, shipments])
  const watchTotal = watchBreakdown.reduce((sum, b) => sum + b.count, 0)

  // Panel 3: Days Silent — use pre-computed data if available, otherwise compute from shipments
  const avgDaysSilent = React.useMemo(() => {
    if (precomputedDaysSilent) return precomputedDaysSilent.avg
    const onWatch = (shipments || []).filter(s => s.claimEligibilityStatus === 'at_risk')
    if (onWatch.length === 0) return 0
    return onWatch.reduce((sum, s) => sum + (s.daysSilent ?? 0), 0) / onWatch.length
  }, [precomputedDaysSilent, shipments])

  const silenceHistogram = React.useMemo(() => {
    if (precomputedDaysSilent) return precomputedDaysSilent.histogram
    const onWatch = (shipments || []).filter(s => s.claimEligibilityStatus === 'at_risk')
    const maxDay = 15
    const buckets: { day: string; count: number }[] = []
    for (let i = 0; i <= maxDay; i++) {
      buckets.push({ day: i < maxDay ? String(i) : `${maxDay}+`, count: 0 })
    }
    onWatch.forEach(s => {
      const d = Math.max(0, Math.min(s.daysSilent ?? 0, maxDay))
      if (buckets[d]) buckets[d].count++
    })
    return buckets
  }, [precomputedDaysSilent, shipments])

  const hasData = precomputedDaysSilent ? precomputedDaysSilent.histogram.some(b => b.count > 0) : (shipments || []).length > 0

  // Panel 4: Active Orders
  const totalActive = stats.totalActiveShipments ?? 0
  const activeSegments = React.useMemo(() => {
    const onWatch = stats.atRisk
    const filing = stats.eligible
    const returned = stats.returnedToSender
    const smooth = Math.max(0, totalActive - onWatch - filing - returned)
    const segments = [
      { key: 'smooth', label: 'Smooth', count: smooth, color: 'hsl(152, 55%, 45%)' },
      { key: 'onWatch', label: 'Watch', count: onWatch, color: 'hsl(35, 92%, 50%)' },
      { key: 'filing', label: 'Filing', count: filing, color: 'hsl(0, 72%, 51%)' },
      { key: 'returned', label: 'Returned', count: returned, color: 'hsl(215, 65%, 55%)' },
    ]
    return segments.filter(s => s.count > 0)
  }, [stats, totalActive])

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
      {/* Panel 1: Status */}
      <div className={panelCls}>
        <div className="px-7 pt-6 flex items-baseline justify-between">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Status</div>
          <div className="text-lg font-bold tabular-nums">{statusTotal}<span className="text-[10px] font-normal text-muted-foreground ml-0.5">flagged</span></div>
        </div>
        {statusTotal > 0 && statusTotal < 8 ? (
          <>
            <div className="flex-1 flex flex-col items-center justify-end pb-2">
              <ResponsiveContainer width="100%" aspect={2.5} style={{ marginTop: 10 }}>
                <PieChart>
                  <Pie
                    data={statusData}
                    cx="50%"
                    cy="50%"
                    innerRadius="45%"
                    outerRadius="85%"
                    paddingAngle={2}
                    dataKey="value"
                    strokeWidth={0}
                  >
                    {statusData.map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} formatter={(value: number, name: string) => [value, name]} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="px-5 pb-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[10px]">
              {statusData.map(d => (
                <span key={d.name} className="flex items-center gap-1">
                  <span className="w-[7px] h-[7px] rounded-[2px] shrink-0" style={{ backgroundColor: d.color }} />
                  <span className="text-muted-foreground">{d.name}</span>
                  <span className="font-semibold tabular-nums text-foreground">{d.value}</span>
                </span>
              ))}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col justify-end px-7 pb-[24px] pt-4 gap-3">
            {(() => {
              if (statusTotal === 0) return null
              const gridSize = Math.min(statusTotal, 100)
              const usePercent = statusTotal > 100
              const squares: string[] = []
              statusData.forEach(d => {
                const count = usePercent ? Math.round((d.value / statusTotal) * gridSize) : d.value
                for (let i = 0; i < count; i++) squares.push(d.color)
              })
              while (squares.length < gridSize) squares.push(statusData[statusData.length - 1]?.color ?? 'hsl(var(--muted))')
              while (squares.length > gridSize) squares.pop()
              const cols = Math.ceil(Math.sqrt(squares.length * 1.8))
              const remainder = squares.length % cols
              if (remainder > 0) {
                const lastColor = squares[squares.length - 1]
                for (let i = 0; i < cols - remainder; i++) squares.push(lastColor)
              }
              return (
                <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
                  {squares.map((color, i) => (
                    <div
                      key={i}
                      className="aspect-square rounded-[3px] transition-all duration-500 shadow-[inset_0_1px_1px_rgba(255,255,255,0.15)]"
                      style={{ background: `linear-gradient(135deg, color-mix(in srgb, ${color} 85%, white) 0%, ${color} 100%)`, opacity: 0.85 }}
                    />
                  ))}
                </div>
              )
            })()}
          </div>
        )}
      </div>

      {/* Panel 2: Watch Breakdown */}
      <div className={panelCls}>
        <div className="px-7 pt-6 flex items-baseline justify-between">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Watch Breakdown</div>
          <div className="text-lg font-bold tabular-nums">{watchTotal}<span className="text-[10px] font-normal text-muted-foreground ml-0.5">on watch</span></div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-end pb-2">
          {watchBreakdown.length > 0 ? (
            <ResponsiveContainer width="100%" aspect={2.5} style={{ marginTop: 10 }}>
              <PieChart>
                <Pie
                  data={watchBreakdown}
                  cx="50%"
                  cy="50%"
                  innerRadius="45%"
                  outerRadius="85%"
                  paddingAngle={2}
                  dataKey="count"
                  nameKey="label"
                  strokeWidth={0}
                >
                  {watchBreakdown.map(b => (
                    <Cell key={b.badge} fill={b.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} formatter={(value: number, name: string) => [value, name]} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="py-8" />
          )}
        </div>
        <div className="px-5 pb-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[10px]">
          {watchBreakdown.map(b => (
            <span key={b.badge} className="flex items-center gap-1">
              <span className="w-[7px] h-[7px] rounded-[2px] shrink-0" style={{ backgroundColor: b.color }} />
              <span className="text-muted-foreground">{b.label}</span>
              <span className="font-semibold tabular-nums text-foreground">{b.count}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Panel 3: Days Silent */}
      <div className={panelCls}>
        <div className="px-7 pt-6 flex items-baseline justify-between">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Days Silent</div>
          <div className="text-lg font-bold tabular-nums">{avgDaysSilent.toFixed(1)}<span className="text-[10px] font-normal text-muted-foreground ml-0.5">days avg</span></div>
        </div>
        <div className="flex-1 flex flex-col justify-end px-2 pb-[8px] pt-1">
          {hasData ? (
            <ResponsiveContainer width="100%" height={110}>
              <AreaChart data={silenceHistogram} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id="silenceGradientHome" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="hsl(142, 55%, 49%)" />
                    <stop offset="40%" stopColor="hsl(45, 85%, 55%)" />
                    <stop offset="70%" stopColor="hsl(25, 85%, 50%)" />
                    <stop offset="100%" stopColor="hsl(0, 72%, 51%)" />
                  </linearGradient>
                  <linearGradient id="silenceFillHome" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="hsl(142, 55%, 49%)" stopOpacity={0.15} />
                    <stop offset="40%" stopColor="hsl(45, 85%, 55%)" stopOpacity={0.15} />
                    <stop offset="70%" stopColor="hsl(25, 85%, 50%)" stopOpacity={0.15} />
                    <stop offset="100%" stopColor="hsl(0, 72%, 51%)" stopOpacity={0.15} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="day"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
                  interval={2}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(value: number) => [`${value} shipments`, 'Count']}
                  labelFormatter={(label) => `${label} days silent`}
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="url(#silenceGradientHome)"
                  strokeWidth={2.5}
                  fill="url(#silenceFillHome)"
                  dot={false}
                  activeDot={{ r: 3, strokeWidth: 0, fill: 'hsl(var(--foreground))' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div />
          )}
        </div>
      </div>

      {/* Panel 4: Active Orders */}
      <div className={panelCls}>
        <div className="px-7 pt-6 flex items-baseline justify-between">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Active Orders</div>
          <div className="text-lg font-bold tabular-nums">{totalActive.toLocaleString()}<span className="text-[10px] font-normal text-muted-foreground ml-0.5">active</span></div>
        </div>
        <div className="flex-1 flex flex-col px-5 pb-[20px]">
          <div className="flex-1 min-h-[12px]" />
          <div className="grid grid-cols-2 gap-3">
            {activeSegments.map((seg) => {
              const pct = totalActive > 0 ? (seg.count / totalActive) * 100 : 0
              return (
                <div
                  key={seg.key}
                  className="rounded-lg px-2.5 py-2 transition-all duration-500"
                  style={{ backgroundColor: `color-mix(in srgb, ${seg.color} 10%, transparent)` }}
                >
                  <div className="text-[9px] text-muted-foreground mb-0.5 flex items-center gap-1">
                    <span className="w-[6px] h-[6px] rounded-[2px]" style={{ backgroundColor: seg.color, opacity: 0.85 }} />
                    {seg.label}
                  </div>
                  <div className="text-[15px] font-bold tabular-nums leading-tight" style={{ color: seg.color }}>
                    {seg.count.toLocaleString()}
                  </div>
                  <div className="text-[9px] tabular-nums text-muted-foreground/70">{pct.toFixed(1)}%</div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
