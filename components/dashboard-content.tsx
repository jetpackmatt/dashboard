"use client"

import * as React from "react"
import { ChartAreaInteractive } from "@/components/chart-area-interactive"
import { SectionCards, type DailyTrends } from "@/components/section-cards"
import { MissionControlPanels, type MissionControlStats, type WatchBreakdownItem, type DaysSilentData } from "@/components/deliveryiq/mission-control-panels"
import { SiteHeader } from "@/components/site-header"
import { JetpackLoader } from "@/components/jetpack-loader"
import { useClient } from "@/components/client-context"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const DATE_PRESETS = [
  { value: '7d', label: '7 Days' },
  { value: '14d', label: '14 Days' },
  { value: '30d', label: '30 Days' },
  { value: '60d', label: '60 Days' },
  { value: '90d', label: '90 Days' },
  { value: '6mo', label: '6 Months' },
  { value: '1yr', label: '1 Year' },
  { value: 'all', label: 'All Time' },
]

function DatePresetPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[130px] h-8 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="rounded-xl">
        {DATE_PRESETS.map(p => (
          <SelectItem key={p.value} value={p.value} className="rounded-lg text-xs">
            {p.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function SectionHeader({ title, datePreset, onDatePresetChange }: { title: string; datePreset: string; onDatePresetChange: (v: string) => void }) {
  return (
    <div className="flex items-center justify-between px-2 md:px-4 lg:px-6">
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      <DatePresetPicker value={datePreset} onChange={onDatePresetChange} />
    </div>
  )
}

export function DashboardContent({ displayName }: { displayName: string }) {
  const { selectedClientId, isLoading: isClientLoading, effectiveIsAdmin, effectiveIsCareUser, brandRole } = useClient()
  const isBrandUser = !effectiveIsAdmin && !effectiveIsCareUser
  const canSeeDiq = effectiveIsAdmin || effectiveIsCareUser || brandRole === 'brand_owner'
  const [datePreset, setDatePreset] = React.useState('90d')

  // KPI + Volume data
  const [kpiData, setKpiData] = React.useState<any>(null)
  const [dailyVolume, setDailyVolume] = React.useState<{ date: string; orders: number }[]>([])
  const [dailyTrends, setDailyTrends] = React.useState<DailyTrends | null>(null)
  const [isKpiLoading, setIsKpiLoading] = React.useState(true)

  // Delivery IQ data (stats only — no full shipment fetch needed for homepage)
  // Lock section order after first load to prevent layout shift
  const diqOrderRef = React.useRef<'diq' | 'volume' | null>(null)
  const [diqStats, setDiqStats] = React.useState<MissionControlStats>({
    atRisk: 0, eligible: 0, claimFiled: 0, returnedToSender: 0, totalActiveShipments: 0,
  })
  const [diqWatchBreakdown, setDiqWatchBreakdown] = React.useState<WatchBreakdownItem[]>([])
  const [diqDaysSilent, setDiqDaysSilent] = React.useState<DaysSilentData>({ avg: 0, histogram: [] })
  const [isDiqLoading, setIsDiqLoading] = React.useState(true)

  const effectiveClientId = selectedClientId || 'all'

  // Fetch KPI + volume data
  React.useEffect(() => {
    if (isClientLoading) return
    let cancelled = false
    setIsKpiLoading(true)

    const params = new URLSearchParams({
      clientId: effectiveClientId,
      datePreset,
    })

    fetch(`/api/data/dashboard/kpis?${params}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!cancelled && data) {
          setKpiData(data.kpis)
          setDailyVolume(data.dailyVolume || [])
          setDailyTrends(data.dailyTrends || null)
        }
      })
      .catch(err => console.error('[Dashboard] KPI fetch error:', err))
      .finally(() => { if (!cancelled) setIsKpiLoading(false) })

    return () => { cancelled = true }
  }, [effectiveClientId, datePreset, isClientLoading])

  // Fetch Delivery IQ stats (lightweight — no full shipment list needed)
  React.useEffect(() => {
    if (isClientLoading || !canSeeDiq) {
      if (!canSeeDiq) setIsDiqLoading(false)
      return
    }
    let cancelled = false
    setIsDiqLoading(true)

    const statsParams = new URLSearchParams()
    if (effectiveClientId) statsParams.set('clientId', effectiveClientId)

    fetch(`/api/data/monitoring/stats?${statsParams}`)
      .then(r => r.ok ? r.json() : null)
      .then(stats => {
        if (cancelled || !stats) return
        setDiqStats(stats)
        // Lock section order on first load (persists across re-renders)
        if (diqOrderRef.current === null) {
          diqOrderRef.current = (stats.totalActiveShipments || 0) >= 10 ? 'diq' : 'volume'
        }
        if (stats.watchBreakdown) setDiqWatchBreakdown(stats.watchBreakdown)
        if (stats.daysSilentHistogram) {
          setDiqDaysSilent({ avg: stats.daysSilentAvg || 0, histogram: stats.daysSilentHistogram })
        }
      })
      .catch(err => console.error('[Dashboard] DIQ fetch error:', err))
      .finally(() => { if (!cancelled) setIsDiqLoading(false) })

    return () => { cancelled = true }
  }, [effectiveClientId, isClientLoading, isBrandUser])

  // Don't block the entire page on DIQ stats — the DIQ section has its own skeleton
  const isAnyLoading = isKpiLoading || isClientLoading

  return (
    <>
      <SiteHeader sectionName={`Welcome Back, ${displayName}`}>
        {isAnyLoading && (
          <div className="flex items-center gap-1.5 ml-[10px]">
            <JetpackLoader size="md" />
            <span className="text-xs text-muted-foreground">Loading</span>
          </div>
        )}
      </SiteHeader>
      <div className="flex flex-1 flex-col overflow-x-hidden bg-background rounded-t-xl">
        <div className="@container/main flex flex-1 flex-col gap-2 w-full">
        <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6 w-full">
          {/* Big Picture — SectionCards shows its own skeleton when loading */}
          <div className="flex flex-col gap-[11px]">
            <SectionHeader title="Big Picture" datePreset={datePreset} onDatePresetChange={setDatePreset} />
            <SectionCards data={kpiData} isLoading={isKpiLoading || isClientLoading} trends={dailyTrends} />
          </div>

          {/* Delivery IQ Flagged Shipments & Order Volume — order swaps based on flagged count */}
          {(() => {
            // Use locked order from first load; default to volume-first while loading
            const diqFirst = diqOrderRef.current === 'diq'

            const diqSection = (
              <div className="flex flex-col gap-[11px]">
                <SectionHeader title="Delivery IQ Flagged Shipments" datePreset={datePreset} onDatePresetChange={setDatePreset} />
                <div className="px-2 md:px-4 lg:px-6">
                  {isDiqLoading || isClientLoading ? (
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
                      {[1,2,3,4].map(i => (
                        <div key={i} className="rounded-xl border border-border bg-card shadow overflow-hidden h-[200px] animate-pulse" />
                      ))}
                    </div>
                  ) : (
                    <MissionControlPanels
                      stats={diqStats}
                      precomputedWatchBreakdown={diqWatchBreakdown}
                      precomputedDaysSilent={diqDaysSilent}
                      panelClassName="rounded-xl border border-border bg-card text-card-foreground shadow overflow-hidden flex flex-col"
                    />
                  )}
                </div>
              </div>
            )

            const volumeSection = (
              <div className="flex flex-col gap-[11px]">
                <SectionHeader title="Order Volume" datePreset={datePreset} onDatePresetChange={setDatePreset} />
                <div className="px-2 md:px-4 lg:px-6">
                  <ChartAreaInteractive
                    data={dailyVolume}
                    isLoading={isKpiLoading || isClientLoading}
                  />
                </div>
              </div>
            )

            // Hide DIQ section from users without access
            if (!canSeeDiq) return volumeSection
            return diqFirst ? <>{diqSection}{volumeSection}</> : <>{volumeSection}{diqSection}</>
          })()}
        </div>
        </div>
      </div>
    </>
  )
}
