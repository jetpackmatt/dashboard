"use client"

import * as React from "react"
import { ChartAreaInteractive } from "@/components/chart-area-interactive"
import { SectionCards, type DailyTrends } from "@/components/section-cards"
import { MissionControlPanels, type MissionControlStats, type MissionControlShipment } from "@/components/deliveryiq/mission-control-panels"
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
  const { selectedClientId, isLoading: isClientLoading } = useClient()
  const [datePreset, setDatePreset] = React.useState('90d')

  // KPI + Volume data
  const [kpiData, setKpiData] = React.useState<any>(null)
  const [dailyVolume, setDailyVolume] = React.useState<{ date: string; orders: number }[]>([])
  const [dailyTrends, setDailyTrends] = React.useState<DailyTrends | null>(null)
  const [isKpiLoading, setIsKpiLoading] = React.useState(true)

  // Delivery IQ data
  const [diqStats, setDiqStats] = React.useState<MissionControlStats>({
    atRisk: 0, eligible: 0, claimFiled: 0, returnedToSender: 0, totalActiveShipments: 0,
  })
  const [diqShipments, setDiqShipments] = React.useState<MissionControlShipment[]>([])
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

  // Fetch Delivery IQ stats + shipments
  React.useEffect(() => {
    if (isClientLoading) return
    let cancelled = false
    setIsDiqLoading(true)

    const statsParams = new URLSearchParams()
    if (effectiveClientId) statsParams.set('clientId', effectiveClientId)

    const shipmentParams = new URLSearchParams()
    if (effectiveClientId) shipmentParams.set('clientId', effectiveClientId)
    shipmentParams.set('filter', 'all')

    Promise.all([
      fetch(`/api/data/monitoring/stats?${statsParams}`).then(r => r.ok ? r.json() : null),
      fetch(`/api/data/monitoring/shipments?${shipmentParams}`).then(r => r.ok ? r.json() : null),
    ])
      .then(([stats, shipmentsData]) => {
        if (cancelled) return
        if (stats) setDiqStats(stats)
        if (shipmentsData?.data) {
          setDiqShipments(shipmentsData.data.map((s: any) => ({
            claimEligibilityStatus: s.claimEligibilityStatus,
            daysSilent: s.daysSilent ?? 0,
            watchReason: s.watchReason,
          })))
        }
      })
      .catch(err => console.error('[Dashboard] DIQ fetch error:', err))
      .finally(() => { if (!cancelled) setIsDiqLoading(false) })

    return () => { cancelled = true }
  }, [effectiveClientId, isClientLoading])

  const isAnyLoading = isKpiLoading || isDiqLoading || isClientLoading

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
    {isAnyLoading ? (
      <div className="flex flex-1 items-center justify-center py-20">
        <JetpackLoader size="lg" />
      </div>
    ) : (
      <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6 w-full">
        {/* Big Picture */}
        <div className="flex flex-col gap-[11px]">
          <SectionHeader title="Big Picture" datePreset={datePreset} onDatePresetChange={setDatePreset} />
          <SectionCards data={kpiData} isLoading={false} trends={dailyTrends} />
        </div>

        {/* Delivery IQ Flagged Shipments */}
        <div className="flex flex-col gap-[11px]">
          <SectionHeader title="Delivery IQ Flagged Shipments" datePreset={datePreset} onDatePresetChange={setDatePreset} />
          <div className="px-2 md:px-4 lg:px-6">
            <MissionControlPanels stats={diqStats} shipments={diqShipments} panelClassName="rounded-xl border border-border bg-card text-card-foreground shadow overflow-hidden flex flex-col" />
          </div>
        </div>

        {/* Order Volume */}
        <div className="flex flex-col gap-[11px]">
          <SectionHeader title="Order Volume" datePreset={datePreset} onDatePresetChange={setDatePreset} />
          <div className="px-2 md:px-4 lg:px-6">
            <ChartAreaInteractive
              data={dailyVolume}
              isLoading={false}
            />
          </div>
        </div>
      </div>
    )}
        </div>
      </div>
    </>
  )
}
