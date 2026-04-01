"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { SiteHeader } from "@/components/site-header"
import { JetpackLoader } from "@/components/jetpack-loader"
import { useClient } from "@/components/client-context"
import { DeliveryIQTable } from "@/components/deliveryiq/deliveryiq-table"
import { QuickFilters, QuickFilterValue } from "@/components/deliveryiq/quick-filters"
import { InlineDateRangePicker } from "@/components/ui/inline-date-range-picker"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { DateRange } from "react-day-picker"
import { toast } from "sonner"
import { ClaimSubmissionDialog } from "@/components/claims/claim-submission-dialog"
import { AutoFileDialog } from "@/components/deliveryiq/auto-file-dialog"
import { MissionControlPanels } from "@/components/deliveryiq/mission-control-panels"
import { subDays } from "date-fns"

// Monitored shipment interface
export interface MonitoredShipment {
  id: string
  shipmentId: string
  trackingNumber: string
  carrier: string
  clientId: string
  clientName: string
  customerName: string | null
  shipDate: string
  lastScanDate: string | null
  lastScanDescription: string | null
  daysSilent: number
  daysInTransit: number
  claimEligibilityStatus: 'at_risk' | 'eligible' | 'claim_filed' | 'approved' | 'denied' | 'missed_window' | 'returned_to_sender' | null
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
  reshipmentId: string | null
  tags: string[]
}

// Stats interface for filter counts
interface DeliveryIQStats {
  atRisk: number
  needsAction: number
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
  totalActiveShipments?: number
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

export default function DeliveryIQPage() {
  const router = useRouter()
  const { selectedClientId, effectiveIsAdmin, effectiveIsCareUser, brandRole, isLoading: isClientLoading } = useClient()

  // Delivery IQ is admin/care only at launch — redirect all brand users
  React.useEffect(() => {
    if (!isClientLoading && !effectiveIsAdmin && !effectiveIsCareUser) {
      router.replace('/dashboard')
    }
  }, [isClientLoading, effectiveIsAdmin, effectiveIsCareUser, router])

  const [quickFilter, setQuickFilter] = React.useState<QuickFilterValue>('at_risk')
  const [datePreset, setDatePreset] = React.useState<DateRangePreset>('all')
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
    atRisk: 0, needsAction: 0, eligible: 0, claimFiled: 0, returnedToSender: 0, total: 0, archived: 0,
    reshipNow: 0, considerReship: 0, customerAnxious: 0, stuck: 0, returning: 0, lost: 0,
  })
  const [isLoading, setIsLoading] = React.useState(true)
  const [isStatsLoading, setIsStatsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [autoFileClaims, setAutoFileClaims] = React.useState(false)
  const [autoFileLoading, setAutoFileLoading] = React.useState(false)

  const canViewAllBrands = effectiveIsAdmin || effectiveIsCareUser
  const effectiveClientId = canViewAllBrands ? (selectedClientId || 'all') : null

  // Resolve which single client is active (null if viewing "all")
  const activeClientId = canViewAllBrands ? selectedClientId : selectedClientId
  const showAutoFileToggle = activeClientId && activeClientId !== 'all'

  // Fetch auto-file preference for the active client
  React.useEffect(() => {
    if (!showAutoFileToggle) {
      setAutoFileClaims(false)
      return
    }
    let cancelled = false
    const params = activeClientId ? `?clientId=${activeClientId}` : ''
    fetch(`/api/data/client-preferences${params}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!cancelled && data) setAutoFileClaims(data.autoFileClaims ?? false)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [activeClientId, showAutoFileToggle])

  // Eligible shipments for auto-file batch
  const eligibleShipments = React.useMemo(() =>
    shipments
      .filter(s => s.claimEligibilityStatus === 'eligible')
      .map(s => ({ shipmentId: s.shipmentId, trackingNumber: s.trackingNumber })),
    [shipments]
  )

  const handleAutoFileToggle = async (checked: boolean) => {
    if (!activeClientId || activeClientId === 'all') return

    if (checked) {
      // Toggling ON — save preference first
      setAutoFileLoading(true)
      try {
        const res = await fetch('/api/data/client-preferences', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId: activeClientId, autoFileClaims: true }),
        })
        if (!res.ok) {
          toast.error('Failed to enable auto-file')
          return
        }
        setAutoFileClaims(true)

        // If currently on "eligible" tab, switch to "at_risk" since it will be hidden
        if (quickFilter === 'eligible') {
          setQuickFilter('at_risk')
        }

        // Open dialog if there are eligible shipments, otherwise just toast
        if (eligibleShipments.length > 0) {
          setAutoFileDialogOpen(true)
        } else {
          toast.success('Auto-file enabled. New eligible claims will be filed automatically.')
        }
      } catch {
        toast.error('Failed to enable auto-file')
      } finally {
        setAutoFileLoading(false)
      }
    } else {
      // Toggling OFF
      setAutoFileLoading(true)
      try {
        const res = await fetch('/api/data/client-preferences', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId: activeClientId, autoFileClaims: false }),
        })
        if (!res.ok) {
          toast.error('Failed to disable auto-file')
          return
        }
        setAutoFileClaims(false)
        toast('Auto-file disabled')
      } catch {
        toast.error('Failed to disable auto-file')
      } finally {
        setAutoFileLoading(false)
      }
    }
  }

  const handleAutoFileComplete = () => {
    // Refresh data after batch filing completes
    fetchShipments()
    fetchStats()
  }

  // Claim dialog state — opens the same ClaimSubmissionDialog used in the shipment drawer
  const [claimDialogShipmentId, setClaimDialogShipmentId] = React.useState<string | undefined>()
  const [claimDialogOpen, setClaimDialogOpen] = React.useState(false)

  // Auto-file dialog state
  const [autoFileDialogOpen, setAutoFileDialogOpen] = React.useState(false)

  const handleFileClaim = (shipment: MonitoredShipment) => {
    setClaimDialogShipmentId(shipment.shipmentId)
    setClaimDialogOpen(true)
  }

  const handleClaimDialogClose = (open: boolean) => {
    setClaimDialogOpen(open)
    if (!open) setClaimDialogShipmentId(undefined)
  }

  const handleClaimSuccess = () => {
    toast.success('Claim filed successfully')
    fetchShipments()
  }

  const fetchShipments = React.useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (effectiveClientId) params.set('clientId', effectiveClientId)
      params.set('filter', 'everything')
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
  }, [effectiveClientId, dateRange])

  const fetchStats = React.useCallback(async () => {
    setIsStatsLoading(true)
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
    } finally {
      setIsStatsLoading(false)
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

  // ── Client-side filter for table ──────────────────────────
  const filteredShipments = React.useMemo(() => {
    switch (quickFilter) {
      case 'at_risk': return shipments.filter(s => s.claimEligibilityStatus === 'at_risk' && s.watchReason !== 'NEEDS ACTION')
      case 'needs_action': return shipments.filter(s => s.claimEligibilityStatus === 'at_risk' && s.watchReason === 'NEEDS ACTION')
      case 'eligible': return shipments.filter(s => s.claimEligibilityStatus === 'eligible')
      case 'claim_filed': return shipments.filter(s => s.claimEligibilityStatus === 'claim_filed')
      case 'returned_to_sender': return shipments.filter(s => s.claimEligibilityStatus === 'returned_to_sender')
      case 'all': return shipments.filter(s => ['at_risk', 'eligible', 'claim_filed'].includes(s.claimEligibilityStatus ?? ''))
      case 'archived': return shipments.filter(s => ['approved', 'denied', 'missed_window'].includes(s.claimEligibilityStatus ?? ''))
      case 'reship_now': return shipments.filter(s => (s.aiReshipmentUrgency ?? 0) >= 80)
      case 'consider_reship': return shipments.filter(s => (s.aiReshipmentUrgency ?? 0) >= 60 && (s.aiReshipmentUrgency ?? 0) < 80)
      case 'customer_anxious': return shipments.filter(s => (s.aiCustomerAnxiety ?? 0) >= 70)
      case 'stuck': return shipments.filter(s => s.aiStatusBadge === 'STALLED' || s.aiStatusBadge === 'STUCK')
      case 'returning': return shipments.filter(s => s.aiStatusBadge === 'RETURNING')
      case 'lost': return shipments.filter(s => s.aiStatusBadge === 'LOST')
      default: return shipments
    }
  }, [shipments, quickFilter])

  return (
    <>
      <SiteHeader sectionName="Delivery IQ" badge={<span className="text-[8px] font-semibold uppercase tracking-wide px-[4px] py-0.5 rounded-sm bg-blue-500/15 text-blue-600 dark:bg-blue-400/15 dark:text-blue-400">Beta</span>}>
        {(isLoading || isStatsLoading || isClientLoading) && (
          <div className="flex items-center gap-1.5 ml-[10px]">
            <JetpackLoader size="md" />
            <span className="text-xs text-muted-foreground">Loading</span>
          </div>
        )}
      </SiteHeader>
      <div className="flex flex-1 flex-col overflow-hidden bg-background rounded-t-xl">
        <div className="flex flex-col h-[calc(100vh-64px)] overflow-y-auto font-roboto">

          {/* Mission Control KPI Panels — wait for both stats + shipments before showing */}
          <div className="flex-shrink-0 bg-muted/50 dark:bg-zinc-900">
            <div className="px-6 lg:px-8 pt-7 pb-7">
              {isLoading || isStatsLoading || isClientLoading ? (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
                  {[1,2,3,4].map(i => (
                    <div key={i} className="rounded-xl border border-border/60 bg-background overflow-hidden h-[200px] animate-pulse" />
                  ))}
                </div>
              ) : (
                <MissionControlPanels stats={stats} shipments={shipments} />
              )}
            </div>
          </div>

          {/* Tab bar + Table */}
          <div className="flex flex-col">
            <div className="sticky top-0 z-20 flex items-center justify-between px-6 lg:px-8 pt-[20px] -mt-[20px] pb-[10px] border-b border-border/60 [background:color-mix(in_srgb,hsl(var(--muted))_50%,hsl(var(--background)))] dark:bg-zinc-900">
              <QuickFilters
                value={quickFilter}
                onChange={handleQuickFilterChange}
                stats={stats}
                autoFileEnabled={autoFileClaims}
              />
              <div className="flex items-center gap-3 flex-shrink-0">
                {/* Auto-file claims toggle — only show when a specific client is selected */}
                {showAutoFileToggle && (
                  <div className="flex items-center gap-2">
                    <Switch
                      id="auto-file"
                      checked={autoFileClaims}
                      onCheckedChange={handleAutoFileToggle}
                      disabled={autoFileLoading}
                      className="scale-[0.9]"
                    />
                    <Label htmlFor="auto-file" className="text-[12px] text-muted-foreground cursor-pointer whitespace-nowrap">
                      Auto-file
                    </Label>
                  </div>
                )}
                {/* AI filter dropdown — hidden for now, reintroduce later */}
                {/* <AiFilterDropdown
                  value={quickFilter}
                  onChange={handleQuickFilterChange}
                  stats={stats}
                /> */}
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
            <DeliveryIQTable
              data={filteredShipments}
              isLoading={isLoading}
              error={error}
              showClientColumn={canViewAllBrands && !selectedClientId}
              activeFilter={quickFilter}
              onRefresh={fetchShipments}
              onFileClaim={handleFileClaim}
              filingClaimId={null}
            />
          </div>
        </div>
      </div>

      {/* Claim Submission Dialog — same flow as shipment drawer */}
      <ClaimSubmissionDialog
        open={claimDialogOpen}
        onOpenChange={handleClaimDialogClose}
        shipmentId={claimDialogShipmentId}
        preselectedClaimType="lostInTransit"
        onSuccess={handleClaimSuccess}
      />

      {/* Auto-File Dialog — confirmation + progress for batch claim filing */}
      {activeClientId && activeClientId !== 'all' && (
        <AutoFileDialog
          open={autoFileDialogOpen}
          onOpenChange={setAutoFileDialogOpen}
          eligibleShipments={eligibleShipments}
          clientId={activeClientId}
          onComplete={handleAutoFileComplete}
        />
      )}
    </>
  )
}
