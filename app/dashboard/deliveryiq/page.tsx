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
  BarChart,
  Bar,
  XAxis,
  YAxis,
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

// Silence buckets for the aging chart
const SILENCE_BUCKETS = [
  { label: '0-3 days', min: 0, max: 3, color: 'hsl(142, 55%, 49%)' },
  { label: '4-7 days', min: 4, max: 7, color: 'hsl(45, 85%, 55%)' },
  { label: '8-14 days', min: 8, max: 14, color: 'hsl(25, 85%, 55%)' },
  { label: '15-21 days', min: 15, max: 21, color: 'hsl(15, 80%, 48%)' },
  { label: '21+ days', min: 22, max: Infinity, color: 'hsl(0, 72%, 51%)' },
]

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

  // Panel 1: Needs Attention — shipments requiring action NOW
  const needsAttentionData = React.useMemo(() => {
    return [
      { name: 'Ready to File', value: stats.eligible, color: 'hsl(0, 72%, 51%)' },
      { name: 'On Watch', value: stats.atRisk, color: 'hsl(35, 92%, 50%)' },
      { name: 'Claims Filed', value: stats.claimFiled, color: 'hsl(215, 65%, 55%)' },
      { name: 'Returned', value: stats.returnedToSender, color: 'hsl(280, 55%, 58%)' },
    ].filter(d => d.value > 0)
  }, [stats])
  const needsAttentionTotal = stats.eligible + stats.atRisk + stats.claimFiled + stats.returnedToSender

  // Panel 2: Silence aging — horizontal bars
  const silenceData = React.useMemo(() => {
    const buckets = SILENCE_BUCKETS.map(b => ({ ...b, count: 0 }))
    shipments.forEach(s => {
      const days = s.daysSilent ?? 0
      const bucket = buckets.find(b => days >= b.min && days <= b.max)
      if (bucket) bucket.count++
    })
    return buckets
  }, [shipments])
  const avgDaysSilent = React.useMemo(() => {
    if (shipments.length === 0) return 0
    return shipments.reduce((sum, s) => sum + (s.daysSilent ?? 0), 0) / shipments.length
  }, [shipments])

  // Panel 3: Carrier exposure
  const carrierData = React.useMemo(() => {
    const counts: Record<string, number> = {}
    shipments.forEach(s => {
      const c = (s.carrier || 'Unknown').replace(/Shipping/g, '').replace('Express', 'Exp').trim()
      counts[c] = (counts[c] || 0) + 1
    })
    const colors = ['hsl(215, 65%, 55%)', 'hsl(260, 55%, 58%)', 'hsl(25, 85%, 55%)', 'hsl(340, 70%, 55%)', 'hsl(142, 55%, 49%)']
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([carrier, count], i) => ({ carrier, count, color: colors[i % colors.length] }))
  }, [shipments])
  // Panel 4: AI predicted outcomes
  const outcomeData = React.useMemo(() => {
    const outcomes = { delivered: 0, lost: 0, returned: 0, unassessed: 0 }
    shipments.forEach(s => {
      if (!s.aiPredictedOutcome) { outcomes.unassessed++; return }
      if (s.aiPredictedOutcome === 'delivered') outcomes.delivered++
      else if (s.aiPredictedOutcome === 'lost') outcomes.lost++
      else if (s.aiPredictedOutcome === 'returned') outcomes.returned++
    })
    const data = [
      { name: 'Likely Delivered', value: outcomes.delivered, color: 'hsl(142, 55%, 49%)' },
      { name: 'Likely Lost', value: outcomes.lost, color: 'hsl(0, 72%, 51%)' },
      { name: 'Returning', value: outcomes.returned, color: 'hsl(260, 55%, 58%)' },
      { name: 'Unassessed', value: outcomes.unassessed, color: 'hsl(var(--muted))' },
    ].filter(d => d.value > 0)
    return data.length > 0 ? data : [{ name: 'No Data', value: 1, color: 'hsl(var(--muted))' }]
  }, [shipments])
  const likelyLostCount = React.useMemo(() => {
    return shipments.filter(s => s.aiPredictedOutcome === 'lost').length
  }, [shipments])

  // Tooltip styles
  const tooltipStyle = { fontSize: 11, borderRadius: 8, padding: '6px 12px', border: '1px solid hsl(var(--border))' }

  return (
    <>
      <SiteHeader sectionName="Delivery IQ">
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

                {/* ── Panel 1: Needs Attention ── */}
                <div className="rounded-xl border border-border/60 bg-background overflow-hidden">
                  <div className="px-4 pt-4 pb-0">
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Needs Attention</div>
                  </div>
                  <div className="flex items-center justify-center py-3">
                    <div className="w-[120px] h-[120px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={needsAttentionData.length > 0 ? needsAttentionData : [{ name: 'None', value: 1, color: 'hsl(var(--muted))' }]}
                            cx="50%"
                            cy="50%"
                            innerRadius={36}
                            outerRadius={54}
                            paddingAngle={3}
                            dataKey="value"
                            strokeWidth={0}
                          >
                            {(needsAttentionData.length > 0 ? needsAttentionData : [{ name: 'None', value: 1, color: 'hsl(var(--muted))' }]).map((entry, index) => (
                              <Cell key={index} fill={entry.color} />
                            ))}
                            <DonutCenter line1={String(needsAttentionTotal)} line2="active" />
                          </Pie>
                          <Tooltip contentStyle={tooltipStyle} formatter={(value: number, name: string) => [value, name]} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  {/* Segmented status bar */}
                  {needsAttentionTotal > 0 && (
                    <div className="px-4 pb-4">
                      <div className="flex rounded-full overflow-hidden h-1.5">
                        {needsAttentionData.map(d => (
                          <div
                            key={d.name}
                            className="h-full"
                            style={{ width: `${(d.value / needsAttentionTotal) * 100}%`, backgroundColor: d.color }}
                            title={`${d.name}: ${d.value}`}
                          />
                        ))}
                      </div>
                      <div className="flex justify-between mt-1.5 text-[10px] text-muted-foreground">
                        {needsAttentionData.map(d => (
                          <span key={d.name}>{d.value} {d.name.replace('Ready to File', 'Ready').replace('Claims Filed', 'Filed')}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* ── Panel 2: Silence Aging ── */}
                <div className="rounded-xl border border-border/60 bg-background overflow-hidden">
                  <div className="px-4 pt-4 flex items-baseline justify-between">
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Silence Aging</div>
                    <div className="text-lg font-bold tabular-nums">{avgDaysSilent.toFixed(1)}<span className="text-[10px] font-normal text-muted-foreground ml-0.5">d avg</span></div>
                  </div>
                  <div className="px-3 pt-2 pb-4" style={{ height: 160 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={silenceData}
                        layout="vertical"
                        margin={{ left: 0, right: 16, top: 0, bottom: 0 }}
                        barCategoryGap="25%"
                      >
                        <XAxis type="number" hide />
                        <YAxis
                          type="category"
                          dataKey="label"
                          width={58}
                          tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                          tickLine={false}
                          axisLine={false}
                        />
                        <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => [value, 'Shipments']} />
                        <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={14}>
                          {silenceData.map((entry, index) => (
                            <Cell key={index} fill={entry.color} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* ── Panel 3: Carrier Exposure ── */}
                <div className="rounded-xl border border-border/60 bg-background overflow-hidden">
                  <div className="px-4 pt-4">
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Carrier Exposure</div>
                  </div>
                  <div className="px-3 pt-2 pb-4" style={{ height: 160 }}>
                    {carrierData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={carrierData}
                          layout="vertical"
                          margin={{ left: 0, right: 16, top: 0, bottom: 0 }}
                          barCategoryGap="25%"
                        >
                          <XAxis type="number" hide />
                          <YAxis
                            type="category"
                            dataKey="carrier"
                            width={58}
                            tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                            tickLine={false}
                            axisLine={false}
                          />
                          <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => [value, 'Shipments']} />
                          <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={14}>
                            {carrierData.map((entry, index) => (
                              <Cell key={index} fill={entry.color} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">No carriers in view</div>
                    )}
                  </div>
                </div>

                {/* ── Panel 4: AI Predictions ── */}
                <div className="rounded-xl border border-border/60 bg-background overflow-hidden">
                  <div className="px-4 pt-4 pb-0">
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">AI Predictions</div>
                  </div>
                  <div className="flex items-center justify-center py-3">
                    <div className="w-[120px] h-[120px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={outcomeData}
                            cx="50%"
                            cy="50%"
                            innerRadius={36}
                            outerRadius={54}
                            paddingAngle={3}
                            dataKey="value"
                            strokeWidth={0}
                          >
                            {outcomeData.map((entry, index) => (
                              <Cell key={index} fill={entry.color} />
                            ))}
                            <DonutCenter line1={String(likelyLostCount)} line2="likely lost" />
                          </Pie>
                          <Tooltip contentStyle={tooltipStyle} formatter={(value: number, name: string) => [value, name]} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  {/* Compact legend — only non-zero, no "No Data" */}
                  <div className="px-4 pb-4 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                    {outcomeData.filter(d => d.name !== 'No Data' && d.name !== 'Unassessed').map(d => (
                      <span key={d.name} className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: d.color }} />
                        {d.value} {d.name.replace('Likely ', '')}
                      </span>
                    ))}
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
              showClientColumn={canViewAllBrands}
              activeFilter={quickFilter}
              onRefresh={fetchShipments}
            />
          </div>
        </div>
      </div>
    </>
  )
}
