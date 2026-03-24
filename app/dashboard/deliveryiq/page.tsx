"use client"

import * as React from "react"
import { SiteHeader } from "@/components/site-header"
import { JetpackLoader } from "@/components/jetpack-loader"
import { useClient } from "@/components/client-context"
import { DeliveryIQTable } from "@/components/deliveryiq/deliveryiq-table"
import { QuickFilters, AiFilterDropdown, QuickFilterValue } from "@/components/deliveryiq/quick-filters"
import { InlineDateRangePicker } from "@/components/ui/inline-date-range-picker"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DateRange } from "react-day-picker"
import { subDays } from "date-fns"
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from "recharts"

// Monitored shipment interface
export interface MonitoredShipment {
  id: string
  shipmentId: string
  trackingNumber: string
  carrier: string
  clientId: string
  clientName: string
  shipDate: string
  lastScanDate: string | null
  daysSilent: number
  daysInTransit: number
  claimEligibilityStatus: 'at_risk' | 'eligible' | 'claim_filed' | 'approved' | 'denied' | 'missed_window' | null
  careTicketStatus: string | null
  watchReason: 'SLOW' | 'STALLED' | 'CUSTOMS' | 'PICKUP' | 'DELIVERY ISSUE' | 'NEEDS ACTION' | 'STUCK' | 'NO SCANS' | 'RETURNING' | null
  aiStatusBadge: 'MOVING' | 'DELAYED' | 'WATCHLIST' | 'STALLED' | 'STUCK' | 'RETURNING' | 'LOST' | null
  aiRiskLevel: 'low' | 'medium' | 'high' | 'critical' | null
  aiReshipmentUrgency: number | null
  aiCustomerAnxiety: number | null
  aiPredictedOutcome: 'delivered' | 'lost' | 'returned' | null
  aiAssessment: {
    statusBadge: string
    riskLevel: string
    customerSentiment: string
    merchantAction: string
    reshipmentUrgency: number
    keyInsight: string
    nextMilestone: string
    confidence: number
  } | null
  aiAssessedAt: string | null
  firstCarrierScanAt: string | null
  stuckAtFacility: string | null
  stuckDurationDays: number | null
}

// Stats interface for filter counts
interface DeliveryIQStats {
  atRisk: number
  eligible: number
  claimFiled: number
  returnedToSender: number
  total: number
  archived: number
  reshipNow: number
  considerReship: number
  customerAnxious: number
  stuck: number
  returning: number
  lost: number
}

// Date range presets matching other dashboard sections
type DateRangePreset = '7d' | '30d' | '60d' | '90d' | 'all' | 'custom'

const DATE_RANGE_PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: '60d', label: '60D' },
  { value: '90d', label: '90D' },
  { value: 'all', label: 'All' },
  { value: 'custom', label: 'Custom' },
]

function getDateRangeFromPreset(preset: DateRangePreset): { from: Date; to: Date } | null {
  const today = new Date()
  switch (preset) {
    case '7d': return { from: subDays(today, 6), to: today }
    case '30d': return { from: subDays(today, 29), to: today }
    case '60d': return { from: subDays(today, 59), to: today }
    case '90d': return { from: subDays(today, 89), to: today }
    case 'all': return null
    case 'custom': return null
    default: return { from: subDays(today, 59), to: today }
  }
}

// Donut center text
function DonutCenter({ viewBox, line1, line2 }: { viewBox?: { cx: number; cy: number }; line1: string; line2: string }) {
  if (!viewBox) return null
  const { cx, cy } = viewBox
  return (
    <g>
      <text x={cx} y={cy - 2} textAnchor="middle" className="fill-foreground" style={{ fontFamily: 'Roboto, sans-serif', fontSize: 18, fontWeight: 700 }}>
        {line1}
      </text>
      <text x={cx} y={cy + 11} textAnchor="middle" className="fill-muted-foreground" style={{ fontFamily: 'Roboto, sans-serif', fontSize: 9, fontWeight: 500 }}>
        {line2}
      </text>
    </g>
  )
}

export default function DeliveryIQPage() {
  const { selectedClientId, effectiveIsAdmin, effectiveIsCareUser, isLoading: isClientLoading } = useClient()

  const [quickFilter, setQuickFilter] = React.useState<QuickFilterValue>('at_risk')
  const [datePreset, setDatePreset] = React.useState<DateRangePreset>('60d')
  const [customDateRange, setCustomDateRange] = React.useState<{ from: Date | undefined; to: Date | undefined }>({ from: undefined, to: undefined })

  // Compute effective date range from preset or custom
  const dateRange = React.useMemo<DateRange | undefined>(() => {
    if (datePreset === 'custom' && customDateRange.from && customDateRange.to) {
      return { from: customDateRange.from, to: customDateRange.to }
    }
    const range = getDateRangeFromPreset(datePreset)
    return range ? { from: range.from, to: range.to } : undefined
  }, [datePreset, customDateRange])
  const [shipments, setShipments] = React.useState<MonitoredShipment[]>([])
  const [stats, setStats] = React.useState<DeliveryIQStats>({
    atRisk: 0, eligible: 0, claimFiled: 0, returnedToSender: 0, total: 0, archived: 0,
    reshipNow: 0, considerReship: 0, customerAnxious: 0, stuck: 0, returning: 0, lost: 0,
  })
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const canViewAllBrands = effectiveIsAdmin || effectiveIsCareUser
  const effectiveClientId = canViewAllBrands ? (selectedClientId || 'all') : null

  const fetchShipments = React.useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (effectiveClientId) params.set('clientId', effectiveClientId)
      if (quickFilter) params.set('filter', quickFilter)
      if (dateRange?.from) params.set('startDate', dateRange.from.toISOString().split('T')[0])
      if (dateRange?.to) params.set('endDate', dateRange.to.toISOString().split('T')[0])
      const response = await fetch(`/api/data/monitoring/shipments?${params.toString()}`)
      if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`)
      const result = await response.json()
      setShipments(result.data || [])
    } catch (err) {
      console.error('Error fetching monitored shipments:', err)
      setError(err instanceof Error ? err.message : 'Failed to load data')
      setShipments([])
    } finally {
      setIsLoading(false)
    }
  }, [effectiveClientId, quickFilter, dateRange])

  const fetchStats = React.useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (effectiveClientId) params.set('clientId', effectiveClientId)
      if (dateRange?.from) params.set('startDate', dateRange.from.toISOString().split('T')[0])
      if (dateRange?.to) params.set('endDate', dateRange.to.toISOString().split('T')[0])
      const response = await fetch(`/api/data/monitoring/stats?${params.toString()}`)
      if (!response.ok) throw new Error(`Failed to fetch stats: ${response.status}`)
      setStats(await response.json())
    } catch (err) {
      console.error('Error fetching stats:', err)
    }
  }, [effectiveClientId, dateRange])

  React.useEffect(() => {
    if (!isClientLoading) { fetchShipments(); fetchStats() }
  }, [isClientLoading, fetchShipments, fetchStats])

  const handleQuickFilterChange = (filter: QuickFilterValue) => setQuickFilter(filter)
  const handleDatePresetChange = (value: string) => {
    const preset = value as DateRangePreset
    setDatePreset(preset)
    if (preset !== 'custom') {
      setCustomDateRange({ from: undefined, to: undefined })
    }
  }

  // ── Computed KPI data ──────────────────────────────────────

  // Panel 1: Status — claim lifecycle breakdown
  const statusData = React.useMemo(() => {
    return [
      { name: 'On Watch', value: stats.atRisk, color: 'hsl(35, 92%, 50%)' },
      { name: 'Ready to File', value: stats.eligible, color: 'hsl(0, 72%, 51%)' },
      { name: 'Claim Filed', value: stats.claimFiled, color: 'hsl(215, 65%, 55%)' },
      { name: 'Returned', value: stats.returnedToSender, color: 'hsl(280, 55%, 58%)' },
    ].filter(d => d.value > 0)
  }, [stats])
  const statusTotal = stats.eligible + stats.atRisk + stats.claimFiled + stats.returnedToSender

  // Panel 2: Days Silent — spectrum distribution
  const avgDaysSilent = React.useMemo(() => {
    if (shipments.length === 0) return 0
    return shipments.reduce((sum, s) => sum + (s.daysSilent ?? 0), 0) / shipments.length
  }, [shipments])
  const silenceSpectrum = React.useMemo(() => {
    const bands = [
      { label: '0–3d', min: 0, max: 3, color: 'hsl(142, 55%, 49%)', count: 0 },
      { label: '4–7d', min: 4, max: 7, color: 'hsl(65, 70%, 45%)', count: 0 },
      { label: '8–14d', min: 8, max: 14, color: 'hsl(35, 85%, 50%)', count: 0 },
      { label: '15–21d', min: 15, max: 21, color: 'hsl(15, 80%, 48%)', count: 0 },
      { label: '21d+', min: 22, max: Infinity, color: 'hsl(0, 72%, 51%)', count: 0 },
    ]
    shipments.forEach(s => {
      const d = s.daysSilent ?? 0
      const band = bands.find(b => d >= b.min && d <= b.max)
      if (band) band.count++
    })
    return bands
  }, [shipments])

  // Panel 3: Delivery Forecast — AI predicted outcomes
  const forecastData = React.useMemo(() => {
    const outcomes = { delivered: 0, lost: 0, returned: 0, unassessed: 0 }
    shipments.forEach(s => {
      if (!s.aiPredictedOutcome) { outcomes.unassessed++; return }
      if (s.aiPredictedOutcome === 'delivered') outcomes.delivered++
      else if (s.aiPredictedOutcome === 'lost') outcomes.lost++
      else if (s.aiPredictedOutcome === 'returned') outcomes.returned++
    })
    return [
      { name: 'Will Deliver', value: outcomes.delivered, color: 'hsl(142, 55%, 49%)' },
      { name: 'Likely Lost', value: outcomes.lost, color: 'hsl(0, 72%, 51%)' },
      { name: 'Returning', value: outcomes.returned, color: 'hsl(280, 55%, 58%)' },
      { name: 'Pending', value: outcomes.unassessed, color: 'hsl(var(--muted))' },
    ].filter(d => d.value > 0)
  }, [shipments])
  const forecastTotal = shipments.length

  // Panel 4: Packages Moving — % with recent carrier activity
  const movingData = React.useMemo(() => {
    if (shipments.length === 0) return { moving: 0, silent: 0, total: 0, pct: 0 }
    const moving = shipments.filter(s => (s.daysSilent ?? 99) <= 2).length
    return { moving, silent: shipments.length - moving, total: shipments.length, pct: Math.round((moving / shipments.length) * 100) }
  }, [shipments])

  // Tooltip styles
  const tooltipStyle = { fontSize: 11, borderRadius: 8, padding: '6px 12px', border: '1px solid hsl(var(--border))' }

  return (
    <>
      <SiteHeader sectionName="Delivery IQ" badge={<span className="text-[8px] font-semibold uppercase tracking-wide px-[4px] py-0.5 rounded-sm bg-blue-500/15 text-blue-600 dark:bg-blue-400/15 dark:text-blue-400">Beta</span>}>
        {(isLoading || isClientLoading) && (
          <div className="flex items-center gap-1.5 ml-[10px]">
            <JetpackLoader size="md" />
            <span className="text-xs text-muted-foreground">Loading</span>
          </div>
        )}
      </SiteHeader>
      <div className="flex flex-1 flex-col overflow-hidden bg-background rounded-t-xl">
        <div className="flex flex-col h-[calc(100vh-64px)] overflow-y-auto font-roboto">

          {/* Mission Control KPI Panels */}
          <div className="flex-shrink-0 bg-muted/50 dark:bg-zinc-900">
            <div className="px-6 lg:px-8 pt-5 pb-4">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">

                {/* ── Panel 1: Status ── */}
                <div className="rounded-xl border border-border/60 bg-background overflow-hidden flex flex-col">
                  <div className="px-4 pt-4 pb-0">
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Status</div>
                  </div>
                  <div className="flex-1 flex items-center justify-center py-2">
                    <div className="w-[110px] h-[110px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={statusData.length > 0 ? statusData : [{ name: 'None', value: 1, color: 'hsl(var(--muted))' }]}
                            cx="50%"
                            cy="50%"
                            innerRadius={33}
                            outerRadius={50}
                            paddingAngle={3}
                            dataKey="value"
                            strokeWidth={0}
                          >
                            {(statusData.length > 0 ? statusData : [{ name: 'None', value: 1, color: 'hsl(var(--muted))' }]).map((entry, index) => (
                              <Cell key={index} fill={entry.color} />
                            ))}
                            <DonutCenter line1={String(statusTotal)} line2="active" />
                          </Pie>
                          <Tooltip contentStyle={tooltipStyle} formatter={(value: number, name: string) => [value, name]} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  <div className="px-4 pb-3 grid grid-cols-2 gap-x-3 gap-y-1">
                    {statusData.map(d => (
                      <span key={d.name} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                        <span className="tabular-nums font-medium text-foreground">{d.value}</span>
                        {d.name}
                      </span>
                    ))}
                  </div>
                </div>

                {/* ── Panel 2: Days Silent ── */}
                <div className="rounded-xl border border-border/60 bg-background overflow-hidden flex flex-col">
                  <div className="px-4 pt-4 flex items-baseline justify-between">
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Days Silent</div>
                    <div className="text-lg font-bold tabular-nums">{avgDaysSilent.toFixed(1)}<span className="text-[10px] font-normal text-muted-foreground ml-0.5">d avg</span></div>
                  </div>
                  <div className="flex-1 flex flex-col justify-center px-4 py-3 gap-3">
                    {/* Spectrum bar */}
                    {shipments.length > 0 ? (
                      <>
                        <div className="flex rounded-full overflow-hidden h-5">
                          {silenceSpectrum.map((band, i) => {
                            const pct = shipments.length > 0 ? (band.count / shipments.length) * 100 : 0
                            if (pct === 0) return null
                            return (
                              <div
                                key={i}
                                className="h-full flex items-center justify-center text-[9px] font-bold text-white/90 transition-all"
                                style={{ width: `${pct}%`, backgroundColor: band.color, minWidth: band.count > 0 ? 16 : 0 }}
                                title={`${band.label}: ${band.count} shipments`}
                              >
                                {pct >= 12 ? band.count : ''}
                              </div>
                            )
                          })}
                        </div>
                        <div className="flex justify-between text-[9px] text-muted-foreground">
                          {silenceSpectrum.map((band, i) => (
                            <span key={i} className="flex flex-col items-center">
                              <span style={{ color: band.color }} className="font-medium">{band.count}</span>
                              <span>{band.label}</span>
                            </span>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div className="text-xs text-muted-foreground text-center">No data</div>
                    )}
                  </div>
                </div>

                {/* ── Panel 3: Delivery Forecast ── */}
                <div className="rounded-xl border border-border/60 bg-background overflow-hidden flex flex-col">
                  <div className="px-4 pt-4 pb-0">
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Delivery Forecast</div>
                  </div>
                  <div className="flex-1 flex items-center justify-center py-2">
                    <div className="w-[110px] h-[110px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={forecastData.length > 0 ? forecastData : [{ name: 'No Data', value: 1, color: 'hsl(var(--muted))' }]}
                            cx="50%"
                            cy="50%"
                            innerRadius={33}
                            outerRadius={50}
                            paddingAngle={3}
                            dataKey="value"
                            strokeWidth={0}
                          >
                            {(forecastData.length > 0 ? forecastData : [{ name: 'No Data', value: 1, color: 'hsl(var(--muted))' }]).map((entry, index) => (
                              <Cell key={index} fill={entry.color} />
                            ))}
                            <DonutCenter line1={forecastTotal > 0 ? `${Math.round((forecastData.find(d => d.name === 'Will Deliver')?.value ?? 0) / forecastTotal * 100)}%` : '—'} line2="on track" />
                          </Pie>
                          <Tooltip contentStyle={tooltipStyle} formatter={(value: number, name: string) => [value, name]} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  <div className="px-4 pb-3 grid grid-cols-2 gap-x-3 gap-y-1">
                    {forecastData.filter(d => d.name !== 'No Data').map(d => (
                      <span key={d.name} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                        <span className="tabular-nums font-medium text-foreground">{d.value}</span>
                        {d.name}
                      </span>
                    ))}
                  </div>
                </div>

                {/* ── Panel 4: Packages Moving ── */}
                <div className="rounded-xl border border-border/60 bg-background overflow-hidden flex flex-col">
                  <div className="px-4 pt-4 pb-0">
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Packages Moving</div>
                  </div>
                  <div className="flex-1 flex flex-col items-center justify-center py-2 gap-1">
                    {/* Ring progress */}
                    <div className="relative w-[110px] h-[110px]">
                      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                        <circle cx="50" cy="50" r="42" fill="none" stroke="hsl(var(--muted))" strokeWidth="8" opacity="0.3" />
                        <circle
                          cx="50" cy="50" r="42" fill="none"
                          stroke={movingData.pct >= 70 ? 'hsl(142, 55%, 49%)' : movingData.pct >= 40 ? 'hsl(35, 92%, 50%)' : 'hsl(0, 72%, 51%)'}
                          strokeWidth="8"
                          strokeLinecap="round"
                          strokeDasharray={`${movingData.pct * 2.64} 264`}
                          className="transition-all duration-700"
                        />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-2xl font-bold tabular-nums leading-none">{movingData.pct}%</span>
                        <span className="text-[9px] text-muted-foreground mt-0.5">moving</span>
                      </div>
                    </div>
                  </div>
                  <div className="px-4 pb-3 flex justify-between text-[10px]">
                    <span className="text-muted-foreground"><span className="tabular-nums font-medium text-green-600">{movingData.moving}</span> active scans</span>
                    <span className="text-muted-foreground"><span className="tabular-nums font-medium text-amber-600">{movingData.silent}</span> gone quiet</span>
                  </div>
                </div>

              </div>
            </div>

            {/* Filter bar */}
            <div className="flex items-center justify-between gap-3 px-6 lg:px-8 pb-4">
              <QuickFilters
                value={quickFilter}
                onChange={handleQuickFilterChange}
                stats={stats}
              />
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <AiFilterDropdown
                  value={quickFilter}
                  onChange={handleQuickFilterChange}
                  stats={stats}
                />
                <Select value={datePreset} onValueChange={handleDatePresetChange}>
                  <SelectTrigger className="h-[30px] w-auto gap-1.5 text-xs text-foreground bg-background">
                    <SelectValue>
                      {DATE_RANGE_PRESETS.find(p => p.value === datePreset)?.label || '60D'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent align="end" className="font-roboto text-xs">
                    {DATE_RANGE_PRESETS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {datePreset === 'custom' && (
                  <InlineDateRangePicker
                    dateRange={customDateRange.from && customDateRange.to ? { from: customDateRange.from, to: customDateRange.to } : undefined}
                    onDateRangeChange={(range) => {
                      if (range?.from && range?.to) {
                        setCustomDateRange({ from: range.from, to: range.to })
                      }
                    }}
                    autoOpen
                  />
                )}
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="flex flex-col flex-1 min-h-0">
            <DeliveryIQTable
              data={shipments}
              isLoading={isLoading}
              error={error}
              showClientColumn={canViewAllBrands && !selectedClientId}
              activeFilter={quickFilter}
              onRefresh={fetchShipments}
            />
          </div>
        </div>
      </div>
    </>
  )
}
