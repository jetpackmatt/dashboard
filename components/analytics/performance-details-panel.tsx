"use client"

import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import type { OtdPercentiles } from "@/lib/analytics/types"
import { KpiTooltip, KPI_TOOLTIPS } from "@/components/analytics/kpi-tooltip"
import { AnimatedNumber } from "@/components/analytics/animated-number"

interface DelayImpact {
  affectedShipments: number
  affectedPercent: number
}

interface ListItem {
  key: string
  label: string
  value: string
  badge?: React.ReactNode
}

interface PerformanceDetailsPanelProps {
  // Header
  title: string
  orderCount?: number | null  // shown as badge when provided

  // OTD percentiles (all 6 tiles)
  otdPercentiles?: OtdPercentiles | null

  // Delivery stages
  fulfillTime: number
  middleMile: number
  lastMile: number

  // Delay toggle
  delayImpact?: DelayImpact | null
  includeDelayed?: boolean
  onToggleDelayed?: (value: boolean) => void

  // Bottom list (top 5 states or cities)
  listTitle: string
  listItems: ListItem[]

  // Click hint (national view only)
  clickHint?: string
}

export function PerformanceDetailsPanel({
  title,
  orderCount,
  otdPercentiles,
  fulfillTime,
  middleMile,
  lastMile,
  delayImpact,
  includeDelayed,
  onToggleDelayed,
  listTitle,
  listItems,
  clickHint,
}: PerformanceDetailsPanelProps) {
  return (
    <div className="h-full overflow-hidden flex flex-col">
      <div className="flex-shrink-0 border-b border-border px-5 h-[68px] flex items-center">
        <div className="text-sm font-semibold">{title}</div>
        {orderCount != null && (
          <Badge variant="secondary" className="tabular-nums text-xs font-medium ml-auto">{orderCount.toLocaleString()} orders</Badge>
        )}
      </div>

      {/* Time Metrics — interconnected grid */}
      <div className="flex-shrink-0">
        <div>
          {/* Row 1: Order-to-Delivery percentiles */}
          <div className="grid grid-cols-3 border-b border-border">
            <div className="col-span-3 px-4 py-3 border-b border-border text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
              Order-to-Delivery <KpiTooltip text={KPI_TOOLTIPS.orderToDelivery} />
            </div>
            <div className="flex flex-col items-center justify-center px-3 py-3.5 border-r border-border bg-gradient-to-b from-white/60 to-emerald-100/50 dark:from-emerald-950/5 dark:to-emerald-950/20">
              <div className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-1">Fastest 20%</div>
              <div className="text-2xl font-bold tabular-nums"><AnimatedNumber value={otdPercentiles?.otd_p20 ?? 0} decimals={1} /></div>
              <div className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-0.5">calendar days</div>
            </div>
            <div className="flex flex-col items-center justify-center px-3 py-3.5 border-r border-border bg-gradient-to-b from-white/60 to-indigo-100/50 dark:from-indigo-950/5 dark:to-indigo-950/20">
              <div className="text-[10px] font-medium text-indigo-600 dark:text-indigo-400 uppercase tracking-wider mb-1">Median</div>
              <div className="text-2xl font-bold tabular-nums"><AnimatedNumber value={otdPercentiles?.otd_p50 ?? 0} decimals={1} /></div>
              <div className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-0.5">calendar days</div>
            </div>
            <div className="flex flex-col items-center justify-center px-3 py-3.5 bg-gradient-to-b from-white/60 to-amber-100/50 dark:from-amber-950/5 dark:to-amber-950/20">
              <div className="text-[10px] font-medium text-amber-600 dark:text-amber-400 uppercase tracking-wider mb-1">Slowest 20%</div>
              <div className="text-2xl font-bold tabular-nums"><AnimatedNumber value={otdPercentiles?.otd_p80 ?? 0} decimals={1} /></div>
              <div className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-0.5">calendar days</div>
            </div>
          </div>
          {/* Row 1b: Extremes + weighted average (half-height spectrum row) */}
          <div className="grid grid-cols-3 border-b border-border">
            <div className="flex flex-col items-center justify-center px-2 py-2 border-r border-border bg-gradient-to-b from-white/40 to-emerald-50/30 dark:from-emerald-950/5 dark:to-emerald-950/10">
              <div className="text-[9px] font-medium text-emerald-600/70 dark:text-emerald-400/70 uppercase tracking-wider mb-0.5">Top 5%</div>
              <div className="text-sm font-semibold tabular-nums"><AnimatedNumber value={otdPercentiles?.otd_p5 ?? 0} decimals={1} /></div>
              <div className="text-[9px] text-zinc-400 dark:text-zinc-500">calendar days</div>
            </div>
            <div className="flex flex-col items-center justify-center px-2 py-2 border-r border-border bg-gradient-to-b from-white/40 to-indigo-50/30 dark:from-indigo-950/5 dark:to-indigo-950/10">
              <div className="text-[9px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-0.5">Average</div>
              <div className="text-sm font-semibold tabular-nums"><AnimatedNumber value={otdPercentiles?.otd_mean ?? 0} decimals={1} /></div>
              <div className="text-[9px] text-zinc-400 dark:text-zinc-500">calendar days</div>
            </div>
            <div className="flex flex-col items-center justify-center px-2 py-2 bg-gradient-to-b from-white/40 to-amber-50/30 dark:from-amber-950/5 dark:to-amber-950/10">
              <div className="text-[9px] font-medium text-amber-600/70 dark:text-amber-400/70 uppercase tracking-wider mb-0.5">Bottom 5%</div>
              <div className="text-sm font-semibold tabular-nums"><AnimatedNumber value={otdPercentiles?.otd_p95 ?? 0} decimals={1} /></div>
              <div className="text-[9px] text-zinc-400 dark:text-zinc-500">calendar days</div>
            </div>
          </div>
          {/* Row 2: Delivery stages breakdown */}
          <div className="grid grid-cols-3">
            <div className="col-span-3 px-4 py-3 border-b border-border text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
              Delivery Stages
            </div>
            <div className="flex flex-col items-center justify-center px-3 py-3.5 border-r border-border bg-gradient-to-b from-white/50 to-emerald-100/40 dark:from-emerald-950/5 dark:to-emerald-950/15">
              <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">Fulfillment <KpiTooltip text={KPI_TOOLTIPS.fulfillTime} /></div>
              <div className="text-2xl font-bold tabular-nums"><AnimatedNumber value={fulfillTime} decimals={1} /></div>
              <div className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-0.5">operating hours</div>
            </div>
            <div className="flex flex-col items-center justify-center px-3 py-3.5 border-r border-border bg-gradient-to-b from-white/50 to-indigo-100/40 dark:from-indigo-950/5 dark:to-indigo-950/15">
              <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">Middle Mile <KpiTooltip text={KPI_TOOLTIPS.middleMile} /></div>
              <div className="text-2xl font-bold tabular-nums"><AnimatedNumber value={middleMile} decimals={1} /></div>
              <div className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-0.5">calendar days</div>
            </div>
            <div className="flex flex-col items-center justify-center px-3 py-3.5 bg-gradient-to-b from-white/50 to-amber-100/40 dark:from-amber-950/5 dark:to-amber-950/15">
              <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-1">Last Mile <KpiTooltip text={KPI_TOOLTIPS.lastMile} /></div>
              <div className="text-2xl font-bold tabular-nums"><AnimatedNumber value={lastMile} decimals={1} /></div>
              <div className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-0.5">calendar days</div>
            </div>
          </div>
        </div>
        {/* Delay Toggle row */}
        {delayImpact && delayImpact.affectedShipments > 0 && onToggleDelayed && (
          <div className="flex items-center gap-2 px-4 py-4 border-t border-border bg-orange-50/30 dark:bg-orange-950/10">
            <Switch
              id="delay-toggle-panel"
              checked={includeDelayed ?? false}
              onCheckedChange={onToggleDelayed}
            />
            <Label htmlFor="delay-toggle-panel" className="text-xs font-medium cursor-pointer whitespace-nowrap">
              Include Inventory Delays <KpiTooltip text={KPI_TOOLTIPS.includeDelays} />
            </Label>
            <span className="text-[10px] text-muted-foreground ml-auto whitespace-nowrap">
              {delayImpact.affectedShipments.toLocaleString()} ({delayImpact.affectedPercent.toFixed(1)}%) orders
            </span>
          </div>
        )}

        {/* Bottom list (top 5 states or cities) */}
        <div className="border-t border-border">
          <div className="px-5 pt-5 pb-3">
            <h4 className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
              {listTitle}
            </h4>
          </div>
          {listItems.length > 0 ? (
            <div>
              {listItems.map((item, index) => (
                <div key={item.key} className="flex items-center px-5 py-3 border-t border-border hover:bg-muted/30 transition-colors">
                  <span className="text-xs text-muted-foreground w-5 tabular-nums">{index + 1}</span>
                  <span className="text-xs font-medium flex-1">{item.label}</span>
                  <span className="text-xs font-medium tabular-nums mr-2">{item.value}</span>
                  {item.badge}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-5 text-muted-foreground text-xs border-t border-border">
              Not enough data
            </div>
          )}
        </div>

        {/* Click hint */}
        {clickHint && (
          <div className="px-5 py-4 border-t border-border text-xs text-muted-foreground bg-muted/30">
            {clickHint}
          </div>
        )}
      </div>
    </div>
  )
}
