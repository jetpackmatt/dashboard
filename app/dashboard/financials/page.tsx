"use client"

import * as React from "react"
import { SiteHeader } from "@/components/site-header"
import { useClient } from "@/components/client-context"
import { Eye, Users, TrendingUp, Activity } from "lucide-react"
import { JetpackLoader } from "@/components/jetpack-loader"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { differenceInMinutes, format } from "date-fns"

interface ClientBreakdown {
  clientId: string
  clientName: string
  shipments: number
  commission: number
  byPartner: {
    shipbob?: number
    eshipper?: number
    gofo?: number
  }
}

interface CommissionData {
  currentMonth: {
    totalShipments: number
    totalCommission: number
    byClient: ClientBreakdown[]
    periodStart: string
    periodEnd: string
    formula: {
      type: string
      C: number
      K: number
      display: string
    }
  }
  userCommission: {
    id: string
    start_date: string
    commission_type: {
      name: string
      description: string
    }
  }
  period: {
    year: number
    month: number
  }
  lastShipmentDates?: {
    shipbob: string | null
    eshipper: Date | null
  }
}

interface HistorySnapshot {
  id: string
  period_year: number
  period_month: number
  shipment_count: number
  commission_amount: number
  locked_at: string
  breakdown?: ClientBreakdown[]
}

interface CommissionUser {
  id: string
  user_id: string
  user_name: string
  user_email: string
  commission_type_name: string
}

interface SelectedMonth {
  year: number
  month: number
  shipments: number
  commission: number
  breakdown: ClientBreakdown[]
  isCurrent: boolean
}

interface UserCommissionSummary {
  userId: string
  userName: string
  userEmail: string
  totalShipments: number
  totalCommission: number
  brandCount: number
  byClient: ClientBreakdown[]
}

interface AggregateMonthData {
  year: number
  month: number
  totalCommission: number
  totalShipments: number
  isCurrent: boolean
  breakdown: ClientBreakdown[]  // Aggregated brand breakdown for this month
}

export default function CommissionsPage() {
  const { effectiveIsAdmin } = useClient()
  const [data, setData] = React.useState<CommissionData | null>(null)
  const [history, setHistory] = React.useState<HistorySnapshot[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = React.useState<Date | null>(null)

  // Selected month state
  const [selectedMonth, setSelectedMonth] = React.useState<SelectedMonth | null>(null)

  // Admin preview state
  const [commissionUsers, setCommissionUsers] = React.useState<CommissionUser[]>([])
  const [isLoadingUsers, setIsLoadingUsers] = React.useState(true)  // Track initial user fetch
  const [previewUserId, setPreviewUserId] = React.useState<string | null>(null)
  const [isPreviewMode, setIsPreviewMode] = React.useState(false)
  const [allUsersData, setAllUsersData] = React.useState<UserCommissionSummary[]>([])
  const [isLoadingAll, setIsLoadingAll] = React.useState(false)
  const [aggregateHistory, setAggregateHistory] = React.useState<AggregateMonthData[]>([])
  const [selectedAggregateMonth, setSelectedAggregateMonth] = React.useState<AggregateMonthData | null>(null)

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

  // Fetch users with commission assignments (admin only)
  React.useEffect(() => {
    if (!effectiveIsAdmin) {
      setIsLoadingUsers(false)
      return
    }

    const fetchCommissionUsers = async () => {
      try {
        const res = await fetch('/api/admin/user-commissions')
        if (res.ok) {
          const data = await res.json()
          if (data.success && data.data) {
            const usersRes = await fetch('/api/admin/parent-users')
            const usersData = usersRes.ok ? await usersRes.json() : { data: [] }
            const parentUsers = usersData.data || []

            const users: CommissionUser[] = data.data.map((assignment: {
              id: string
              user_id: string
              commission_type?: { name: string } | null
            }) => {
              const parentUser = parentUsers.find((u: { id: string }) => u.id === assignment.user_id)
              return {
                id: assignment.id,
                user_id: assignment.user_id,
                user_name: parentUser?.full_name || '',
                user_email: parentUser?.email || assignment.user_id.slice(0, 8) + '...',
                commission_type_name: assignment.commission_type?.name || 'Unknown',
              }
            })
            setCommissionUsers(users)
          }
        }
      } catch (err) {
        console.error('Error fetching commission users:', err)
      } finally {
        setIsLoadingUsers(false)
      }
    }

    fetchCommissionUsers()
  }, [effectiveIsAdmin])

  // Fetch aggregate data for all users when "All" is selected
  React.useEffect(() => {
    if (!effectiveIsAdmin || previewUserId || isLoadingUsers) {
      return
    }

    if (commissionUsers.length === 0) {
      setIsLoadingAll(false)
      return
    }

    const fetchAllUsersData = async () => {
      setIsLoadingAll(true)
      try {
        // Fetch commission data AND history for each user in parallel
        const results = await Promise.all(
          commissionUsers.map(async (user) => {
            const [currentRes, historyRes] = await Promise.all([
              fetch(`/api/data/commissions?userId=${user.user_id}`),
              fetch(`/api/data/commissions/history?userId=${user.user_id}`),
            ])
            if (!currentRes.ok) return null
            const currentData = await currentRes.json()
            const historyData = historyRes.ok ? await historyRes.json() : { data: [] }
            if (!currentData.success || !currentData.data) return null

            return {
              current: {
                userId: user.user_id,
                userName: user.user_name,
                userEmail: user.user_email,
                totalShipments: currentData.data.currentMonth.totalShipments,
                totalCommission: currentData.data.currentMonth.totalCommission,
                brandCount: currentData.data.currentMonth.byClient.length,
                byClient: currentData.data.currentMonth.byClient,
              } as UserCommissionSummary,
              history: historyData.data || [],
            }
          })
        )

        // Filter out null results
        const validResults = results.filter((r): r is { current: UserCommissionSummary; history: HistorySnapshot[] } => r !== null)

        // Sort current month data by commission (highest first)
        const currentData = validResults.map(r => r.current)
        currentData.sort((a, b) => b.totalCommission - a.totalCommission)
        setAllUsersData(currentData)

        // Aggregate historical data by month (including breakdown)
        const historyByMonth = new Map<string, AggregateMonthData>()

        // Add current month with current data breakdown
        const now = new Date()
        const currentKey = `${now.getFullYear()}-${now.getMonth() + 1}`
        const currentBreakdown = currentData.flatMap(u => u.byClient)
        historyByMonth.set(currentKey, {
          year: now.getFullYear(),
          month: now.getMonth() + 1,
          totalCommission: currentData.reduce((sum, u) => sum + u.totalCommission, 0),
          totalShipments: currentData.reduce((sum, u) => sum + u.totalShipments, 0),
          isCurrent: true,
          breakdown: currentBreakdown.sort((a, b) => b.commission - a.commission),
        })

        // Aggregate historical snapshots (including their breakdown)
        for (const result of validResults) {
          for (const snapshot of result.history) {
            const key = `${snapshot.period_year}-${snapshot.period_month}`
            if (key === currentKey) continue // Skip current month (already added)

            const existing = historyByMonth.get(key)
            if (existing) {
              existing.totalCommission += snapshot.commission_amount
              existing.totalShipments += snapshot.shipment_count
              // Merge breakdowns from this snapshot
              if (snapshot.breakdown) {
                existing.breakdown = [...existing.breakdown, ...snapshot.breakdown]
              }
            } else {
              historyByMonth.set(key, {
                year: snapshot.period_year,
                month: snapshot.period_month,
                totalCommission: snapshot.commission_amount,
                totalShipments: snapshot.shipment_count,
                isCurrent: false,
                breakdown: snapshot.breakdown || [],
              })
            }
          }
        }

        // Sort breakdowns within each month
        for (const monthData of historyByMonth.values()) {
          monthData.breakdown.sort((a, b) => b.commission - a.commission)
        }

        // Sort by date (newest first) and set state
        const sortedHistory = Array.from(historyByMonth.values())
          .sort((a, b) => {
            if (a.year !== b.year) return b.year - a.year
            return b.month - a.month
          })
        setAggregateHistory(sortedHistory)

        // Set current month as selected by default
        const currentMonthData = sortedHistory.find(m => m.isCurrent)
        if (currentMonthData) {
          setSelectedAggregateMonth(currentMonthData)
        }
      } catch (err) {
        console.error('Error fetching all users data:', err)
      } finally {
        setIsLoadingAll(false)
      }
    }

    fetchAllUsersData()
  }, [effectiveIsAdmin, previewUserId, commissionUsers, isLoadingUsers])

  // Fetch commission data
  const fetchData = React.useCallback(async () => {
    try {
      const params = previewUserId ? `?userId=${previewUserId}` : ''
      const [currentRes, historyRes] = await Promise.all([
        fetch(`/api/data/commissions${params}`),
        fetch(`/api/data/commissions/history${params}`),
      ])

      if (!currentRes.ok) {
        throw new Error('Failed to fetch commission data')
      }

      const currentData = await currentRes.json()
      const historyData = await historyRes.json()

      if (currentData.success && currentData.data) {
        setData(currentData.data)
        setError(null)

        // Set current month as default selected
        const { currentMonth, period } = currentData.data
        setSelectedMonth({
          year: period.year,
          month: period.month,
          shipments: currentMonth.totalShipments,
          commission: currentMonth.totalCommission,
          breakdown: currentMonth.byClient,
          isCurrent: true,
        })
      } else {
        setData(null)
        setError(currentData.message || 'Unable to load commission data')
      }

      if (historyData.success) {
        setHistory(historyData.data || [])
      }

      setLastUpdated(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }, [previewUserId])

  // Initial fetch and refetch when preview user changes
  React.useEffect(() => {
    setIsLoading(true)
    fetchData()
  }, [fetchData])

  // Poll every 60 seconds for real-time updates
  React.useEffect(() => {
    const interval = setInterval(fetchData, 60000)
    return () => clearInterval(interval)
  }, [fetchData])

  // Handle preview user change
  const handlePreviewChange = (userId: string) => {
    if (userId === 'all') {
      setPreviewUserId(null)
      setIsPreviewMode(false)
    } else {
      setPreviewUserId(userId)
      setIsPreviewMode(true)
    }
  }

  // Handle month selection
  const handleSelectMonth = (year: number, month: number, shipments: number, commission: number, breakdown: ClientBreakdown[], isCurrent: boolean) => {
    setSelectedMonth({ year, month, shipments, commission, breakdown, isCurrent })
  }

  // Format currency
  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(amount)

  // Format number with commas
  const formatNumber = (num: number) =>
    new Intl.NumberFormat('en-US').format(num)

  // Get current preview user name
  const previewUserName = React.useMemo(() => {
    if (!previewUserId) return null
    const user = commissionUsers.find(u => u.user_id === previewUserId)
    return user?.user_name || user?.user_email || 'Unknown'
  }, [previewUserId, commissionUsers])

  // Check if a month is currently selected
  const isMonthSelected = (year: number, month: number) => {
    return selectedMonth?.year === year && selectedMonth?.month === month
  }

  // Filter history to exclude current month
  const filteredHistory = React.useMemo(() => {
    if (!data) return history
    return history.filter(h => !(h.period_year === data.period.year && h.period_month === data.period.month))
  }, [history, data])

  // Calculate YTD total
  const ytdTotal = React.useMemo(() => {
    if (!data) return 0
    const currentYear = new Date().getFullYear()
    const historyTotal = filteredHistory
      .filter(h => h.period_year === currentYear)
      .reduce((sum, h) => sum + h.commission_amount, 0)
    return historyTotal + data.currentMonth.totalCommission
  }, [filteredHistory, data])

  // Calculate max shipments for bar widths
  const maxShipments = React.useMemo(() => {
    if (!selectedMonth) return 1
    return Math.max(...selectedMonth.breakdown.map(c => c.shipments), 1)
  }, [selectedMonth])

  if (isLoading) {
    return (
      <>
        <SiteHeader sectionName="Financials">
          <div className="flex items-center gap-1.5 ml-[10px]">
            <JetpackLoader size="md" />
            <span className="text-xs text-muted-foreground">Loading</span>
          </div>
        </SiteHeader>
      </>
    )
  }

  // Preview selector component for the header (defined early so it can be used in error state too)
  const previewSelector = effectiveIsAdmin && commissionUsers.length > 0 ? (
    <div className="flex items-center gap-2">
      <Eye className="h-3.5 w-3.5 text-muted-foreground" />
      <Select value={previewUserId || 'self'} onValueChange={handlePreviewChange}>
        <SelectTrigger className="h-8 w-[180px] text-xs">
          <SelectValue placeholder="Preview as..." />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="self">Myself</SelectItem>
          {commissionUsers.map((user) => (
            <SelectItem key={user.user_id} value={user.user_id}>
              {user.user_name || user.user_email}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isPreviewMode && (
        <Badge variant="outline" className="text-[10px] px-1.5 py-0.5 text-orange-600 border-orange-300 dark:text-orange-400 dark:border-orange-600">
          Preview
        </Badge>
      )}
    </div>
  ) : null

  // Determine if we should show admin view (tabbed) or personal view
  const isAdminView = effectiveIsAdmin

  // For non-admins, show error if no commission data
  if ((error || !data) && !isAdminView) {
    return (
      <>
        <SiteHeader sectionName="Financials" />
        <div className="flex flex-1 flex-col items-center justify-center py-16 text-center">
          <p className="text-lg text-muted-foreground">
            {error || 'No commission assignment found'}
          </p>
        </div>
      </>
    )
  }

  // Extract data if available (may be null for admins without own commission)
  const currentMonth = data?.currentMonth
  const period = data?.period

  // Commission content - shared between admin and personal view
  const commissionContent = (
    <div className="flex flex-col gap-6">
      {/* Full-width Summary Card */}
      <div className="rounded-xl bg-card border border-border/50 p-6 shadow-sm">
        {/* Top row: Hero stat left, feature cards right */}
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
          {/* Left: Hero commission stat */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <p className="text-sm text-muted-foreground">
                {isAdminView
                  ? (selectedMonth?.isCurrent ? 'Commissions This Month' : `${monthNames[selectedMonth?.month ? selectedMonth.month - 1 : 0]} ${selectedMonth?.year}`)
                  : (selectedMonth?.isCurrent ? 'Earnings This Month' : `${monthNames[selectedMonth?.month ? selectedMonth.month - 1 : 0]} ${selectedMonth?.year}`)
                }
              </p>
              {selectedMonth?.isCurrent && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400">
                  In Progress
                </Badge>
              )}
            </div>
            <p className="text-4xl font-bold tracking-tight">
              {formatCurrency(selectedMonth?.commission || 0)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {(() => {
                if (!selectedMonth) return null

                if (selectedMonth.isCurrent) {
                  // For current month, show last month's total for context
                  const lastMonth = filteredHistory[0] // Most recent completed month
                  if (lastMonth) {
                    return `Last month: ${formatCurrency(lastMonth.commission_amount)}`
                  }
                  return selectedMonth.breakdown.length > 0
                    ? `${formatCurrency(selectedMonth.commission / selectedMonth.breakdown.length)} avg per brand`
                    : null
                } else {
                  // For past months, find previous month and show % change
                  const prevMonth = filteredHistory.find(h =>
                    (h.period_year === selectedMonth.year && h.period_month === selectedMonth.month - 1) ||
                    (h.period_month === 12 && h.period_year === selectedMonth.year - 1 && selectedMonth.month === 1)
                  )
                  if (prevMonth && prevMonth.commission_amount > 0) {
                    const change = ((selectedMonth.commission - prevMonth.commission_amount) / prevMonth.commission_amount) * 100
                    const sign = change >= 0 ? '+' : ''
                    return `${sign}${change.toFixed(0)}% vs ${monthNames[prevMonth.period_month - 1]}`
                  }
                  return `${formatCurrency(selectedMonth.commission / (selectedMonth.breakdown.length || 1))} avg per brand`
                }
              })()}
            </p>
          </div>

          {/* Right: Stats mini cards */}
          <div className="flex flex-wrap gap-3">
            {/* ShipBob */}
            <div className="rounded-lg bg-gradient-to-br from-blue-50/80 to-blue-100/50 dark:from-blue-950/40 dark:to-blue-900/20 border border-blue-200/30 dark:border-blue-800/30 px-4 py-3 min-w-[100px]">
              <p className="text-[10px] font-medium text-blue-600 dark:text-blue-400 uppercase tracking-wide">ShipBob</p>
              <p className="text-xl font-semibold tabular-nums mt-0.5">
                {formatNumber(selectedMonth?.breakdown.reduce((sum, c) => sum + (c.byPartner?.shipbob || 0), 0) || 0)}
              </p>
              {selectedMonth?.isCurrent && lastUpdated && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  updated {differenceInMinutes(new Date(), lastUpdated)} min ago
                </p>
              )}
            </div>

            {/* eShipper */}
            <div className="rounded-lg bg-gradient-to-br from-amber-50/80 to-amber-100/50 dark:from-amber-950/40 dark:to-amber-900/20 border border-amber-200/30 dark:border-amber-800/30 px-4 py-3 min-w-[100px]">
              <p className="text-[10px] font-medium text-amber-600 dark:text-amber-400 uppercase tracking-wide">eShipper</p>
              <p className="text-xl font-semibold tabular-nums mt-0.5">
                {formatNumber(selectedMonth?.breakdown.reduce((sum, c) => sum + (c.byPartner?.eshipper || 0), 0) || 0)}
              </p>
              {selectedMonth?.isCurrent && data?.lastShipmentDates?.eshipper && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  updated {differenceInMinutes(new Date(), data.lastShipmentDates.eshipper)} min ago
                </p>
              )}
            </div>

            {/* Total */}
            <div className="rounded-lg bg-gradient-to-br from-slate-50/80 to-slate-100/50 dark:from-slate-800/40 dark:to-slate-700/20 border border-slate-200/30 dark:border-slate-700/30 px-4 py-3 min-w-[100px]">
              <p className="text-[10px] font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wide">Total</p>
              <p className="text-xl font-semibold tabular-nums mt-0.5">{formatNumber(selectedMonth?.shipments || 0)}</p>
              <p className="text-[10px] text-muted-foreground mt-1">shipments</p>
            </div>

            {/* Brands */}
            <div className="rounded-lg bg-gradient-to-br from-emerald-50/80 to-emerald-100/50 dark:from-emerald-950/40 dark:to-emerald-900/20 border border-emerald-200/30 dark:border-emerald-800/30 px-4 py-3 min-w-[100px]">
              <p className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 uppercase tracking-wide">Brands</p>
              <p className="text-xl font-semibold tabular-nums mt-0.5">{selectedMonth?.breakdown.length || 0}</p>
              <p className="text-[10px] text-muted-foreground mt-1">assigned</p>
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-6">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
            <span>Month progress</span>
            <span>
              {selectedMonth?.isCurrent
                ? `${new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate() - new Date().getDate()} days remaining`
                : 'Month complete'
              }
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-500"
              style={{
                width: selectedMonth?.isCurrent
                  ? `${(new Date().getDate() / new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()) * 100}%`
                  : '100%'
              }}
            />
          </div>
        </div>
      </div>

      {/* Two-column layout below */}
      <div className="grid gap-6 lg:grid-cols-[350px_1fr]">
        {/* Left column - Month Selector */}
        <div className="rounded-xl bg-card border border-border/50 p-6 shadow-sm">
              <h3 className="text-base font-medium mb-4">{isAdminView ? 'Commission History' : 'Earnings History'}</h3>
              <div className="space-y-1">
                {/* Current month */}
                {period && currentMonth && (
                  <div
                    onClick={() => handleSelectMonth(
                      period.year,
                      period.month,
                      currentMonth.totalShipments,
                      currentMonth.totalCommission,
                      currentMonth.byClient,
                      true
                    )}
                    className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors ${
                      isMonthSelected(period.year, period.month)
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/50 dark:border-emerald-800/30'
                        : 'hover:bg-muted'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{monthNames[period.month - 1]}</p>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400">
                        In Progress
                      </Badge>
                    </div>
                    <span className="font-medium tabular-nums">{formatCurrency(currentMonth.totalCommission)}</span>
                  </div>
                )}

                {/* Historical months */}
                {filteredHistory.map((snapshot) => (
                  <div
                    key={snapshot.id}
                    onClick={() => handleSelectMonth(
                      snapshot.period_year,
                      snapshot.period_month,
                      snapshot.shipment_count,
                      snapshot.commission_amount,
                      snapshot.breakdown || [],
                      false
                    )}
                    className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors ${
                      isMonthSelected(snapshot.period_year, snapshot.period_month)
                        ? 'bg-muted'
                        : 'hover:bg-muted/50'
                    }`}
                  >
                    <div>
                      <p className="font-medium">{monthNames[snapshot.period_month - 1]}</p>
                      <p className="text-xs text-muted-foreground">{snapshot.period_year}</p>
                    </div>
                    <span className="font-medium tabular-nums">{formatCurrency(snapshot.commission_amount)}</span>
                  </div>
                ))}

                {filteredHistory.length === 0 && (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    No historical data yet
                  </p>
                )}
              </div>
        </div>

        {/* Right column - Brand Breakdown */}
        <div className="rounded-xl bg-card border border-border/50 shadow-sm flex flex-col min-h-[600px]">
            <div className="p-6 border-b border-border/50">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-medium">Brand Breakdown</h3>
                <span className="text-sm text-muted-foreground">
                  {selectedMonth?.breakdown.filter(c => c.shipments > 0).length || 0} brands
                </span>
              </div>
              {selectedMonth && (
                <p className="text-sm text-muted-foreground mt-1">
                  {monthNames[selectedMonth.month - 1]} {selectedMonth.year}
                </p>
              )}
            </div>

            <ScrollArea className="flex-1 p-6">
              <div className="space-y-4">
                {selectedMonth?.breakdown.filter(c => c.shipments > 0).map((client) => {
                  const barWidth = (client.shipments / maxShipments) * 100
                  const commissionPercent = selectedMonth.commission > 0
                    ? ((client.commission / selectedMonth.commission) * 100).toFixed(0)
                    : '0'

                  return (
                    <div key={client.clientId} className="space-y-2">
                      {/* Header row */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className="font-medium truncate">{client.clientName}</span>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {(client.byPartner?.shipbob ?? 0) > 0 && (
                              <span className="text-[10px] text-muted-foreground bg-muted px-1 rounded">SB</span>
                            )}
                            {(client.byPartner?.eshipper ?? 0) > 0 && (
                              <span className="text-[10px] text-muted-foreground bg-muted px-1 rounded">eS</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-4 flex-shrink-0 text-sm">
                          <span className="text-muted-foreground tabular-nums w-16 text-right">
                            {formatNumber(client.shipments)}
                          </span>
                          <span className="font-medium tabular-nums w-20 text-right">
                            {formatCurrency(client.commission)}
                          </span>
                          <span className="text-xs text-muted-foreground tabular-nums w-8 text-right">
                            {commissionPercent}%
                          </span>
                        </div>
                      </div>

                      {/* Progress bar */}
                      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                    </div>
                  )
                })}

                {(!selectedMonth || selectedMonth.breakdown.filter(c => c.shipments > 0).length === 0) && (
                  <div className="py-8 text-center">
                    <p className="text-sm text-muted-foreground">No brands to display</p>
                  </div>
                )}
              </div>
            </ScrollArea>
        </div>
      </div>
    </div>
  )

  // User selector for admin commissions tab
  const adminUserSelector = (
    <div className="flex items-center gap-3">
      <Users className="h-4 w-4 text-muted-foreground" />
      <Select value={previewUserId || 'all'} onValueChange={handlePreviewChange}>
        <SelectTrigger className="w-[200px]">
          <SelectValue placeholder="Select user..." />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Recipients</SelectItem>
          {commissionUsers.map((user) => (
            <SelectItem key={user.user_id} value={user.user_id}>
              {user.user_name || user.user_email}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {previewUserId && (
        <Badge variant="outline" className="text-xs">
          Viewing: {commissionUsers.find(u => u.user_id === previewUserId)?.user_name || 'User'}
        </Badge>
      )}
    </div>
  )

  // Admin view with tabs
  if (isAdminView) {
    return (
      <>
        <SiteHeader sectionName="Financials">
          {(isLoadingUsers || isLoadingAll) && (
            <div className="flex items-center gap-1.5 ml-[10px]">
              <JetpackLoader size="md" />
              <span className="text-xs text-muted-foreground">Loading</span>
            </div>
          )}
        </SiteHeader>
        <div className="flex flex-1 flex-col p-6">
          <Tabs defaultValue="commissions" className="space-y-6">
            {/* Tabs row with user selector on right */}
            <div className="flex items-center justify-between">
              <TabsList>
                <TabsTrigger value="revenue" disabled className="opacity-50">
                  <TrendingUp className="h-4 w-4 mr-2" />
                  Revenue
                </TabsTrigger>
                <TabsTrigger value="activity" disabled className="opacity-50">
                  <Activity className="h-4 w-4 mr-2" />
                  Activity
                </TabsTrigger>
                <TabsTrigger value="commissions">
                  <Users className="h-4 w-4 mr-2" />
                  Commissions
                </TabsTrigger>
              </TabsList>
              {adminUserSelector}
            </div>

            <TabsContent value="revenue">
              <div className="rounded-xl bg-card border border-border/50 p-12 text-center">
                <TrendingUp className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                <h3 className="text-lg font-medium text-muted-foreground">Revenue Dashboard</h3>
                <p className="text-sm text-muted-foreground mt-2">Coming soon</p>
              </div>
            </TabsContent>

            <TabsContent value="activity">
              <div className="rounded-xl bg-card border border-border/50 p-12 text-center">
                <Activity className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                <h3 className="text-lg font-medium text-muted-foreground">Activity Feed</h3>
                <p className="text-sm text-muted-foreground mt-2">Coming soon</p>
              </div>
            </TabsContent>

            <TabsContent value="commissions">
              {!previewUserId ? (
                // "All" view - show aggregate data
                (isLoadingUsers || isLoadingAll) ? (
                  null
                ) : (commissionUsers.length > 0 && allUsersData.length > 0) ? (
                  <div className="flex flex-col gap-6">
                    {/* Summary Card */}
                    <div className="rounded-xl bg-card border border-border/50 p-6 shadow-sm">
                      {/* Top row: Hero stat left, feature cards right */}
                      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
                        {/* Left: Hero commission stat */}
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <p className="text-sm text-muted-foreground">
                              {selectedAggregateMonth?.isCurrent
                                ? 'Total Commissions This Month'
                                : `Total Commissions - ${monthNames[(selectedAggregateMonth?.month || 1) - 1]} ${selectedAggregateMonth?.year || ''}`
                              }
                            </p>
                            {selectedAggregateMonth?.isCurrent && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400">
                                In Progress
                              </Badge>
                            )}
                          </div>
                          <p className="text-4xl font-bold tracking-tight">
                            {formatCurrency(selectedAggregateMonth?.totalCommission || 0)}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatNumber(selectedAggregateMonth?.totalShipments || 0)} total shipments across {allUsersData.length} recipients
                          </p>
                        </div>

                        {/* Right: Stats mini cards */}
                        <div className="flex flex-wrap gap-3">
                          <div className="rounded-lg bg-gradient-to-br from-slate-50/80 to-slate-100/50 dark:from-slate-800/40 dark:to-slate-700/20 border border-slate-200/30 dark:border-slate-700/30 px-4 py-3 min-w-[100px]">
                            <p className="text-[10px] font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wide">Recipients</p>
                            <p className="text-xl font-semibold tabular-nums mt-0.5">{allUsersData.length}</p>
                          </div>
                          <div className="rounded-lg bg-gradient-to-br from-blue-50/80 to-blue-100/50 dark:from-blue-950/40 dark:to-blue-900/20 border border-blue-200/30 dark:border-blue-800/30 px-4 py-3 min-w-[100px]">
                            <p className="text-[10px] font-medium text-blue-600 dark:text-blue-400 uppercase tracking-wide">Total Shipments</p>
                            <p className="text-xl font-semibold tabular-nums mt-0.5">{formatNumber(selectedAggregateMonth?.totalShipments || 0)}</p>
                          </div>
                          <div className="rounded-lg bg-gradient-to-br from-emerald-50/80 to-emerald-100/50 dark:from-emerald-950/40 dark:to-emerald-900/20 border border-emerald-200/30 dark:border-emerald-800/30 px-4 py-3 min-w-[100px]">
                            <p className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 uppercase tracking-wide">Total Brands</p>
                            <p className="text-xl font-semibold tabular-nums mt-0.5">{selectedAggregateMonth?.breakdown.length || 0}</p>
                          </div>
                        </div>
                      </div>

                      {/* Progress bar */}
                      <div className="mt-6">
                        <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
                          <span>Month progress</span>
                          <span>
                            {selectedAggregateMonth?.isCurrent
                              ? `${new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate() - new Date().getDate()} days remaining`
                              : 'Month complete'
                            }
                          </span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                            style={{
                              width: selectedAggregateMonth?.isCurrent
                                ? `${(new Date().getDate() / new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()) * 100}%`
                                : '100%'
                            }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Three-column layout */}
                    <div className="grid gap-6 lg:grid-cols-[280px_280px_1fr]">
                      {/* Left column - Commission History */}
                      <div className="rounded-xl bg-card border border-border/50 p-6 shadow-sm">
                        <h3 className="text-base font-medium mb-4">Commission History</h3>
                        <div className="space-y-1">
                          {aggregateHistory.map((monthData) => (
                            <div
                              key={`${monthData.year}-${monthData.month}`}
                              onClick={() => setSelectedAggregateMonth(monthData)}
                              className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors ${
                                selectedAggregateMonth?.year === monthData.year && selectedAggregateMonth?.month === monthData.month
                                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/50 dark:border-emerald-800/30'
                                  : 'hover:bg-muted'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <p className="font-medium">{monthNames[monthData.month - 1]}</p>
                                {monthData.isCurrent && (
                                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400">
                                    In Progress
                                  </Badge>
                                )}
                              </div>
                              <span className="font-medium tabular-nums">{formatCurrency(monthData.totalCommission)}</span>
                            </div>
                          ))}
                          {aggregateHistory.length === 0 && (
                            <p className="py-4 text-center text-sm text-muted-foreground">
                              No historical data yet
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Middle column - By Recipient */}
                      <div className="rounded-xl bg-card border border-border/50 p-6 shadow-sm">
                        <h3 className="text-base font-medium mb-4">By Recipient</h3>
                        <div className="space-y-1">
                          {allUsersData.map((user) => {
                            const percent = allUsersData.reduce((sum, u) => sum + u.totalCommission, 0) > 0
                              ? ((user.totalCommission / allUsersData.reduce((sum, u) => sum + u.totalCommission, 0)) * 100).toFixed(0)
                              : '0'

                            return (
                              <div
                                key={user.userId}
                                className="flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors hover:bg-muted"
                                onClick={() => handlePreviewChange(user.userId)}
                              >
                                <div>
                                  <p className="font-medium">{user.userName || user.userEmail}</p>
                                  <p className="text-xs text-muted-foreground">{user.brandCount} brands · {formatNumber(user.totalShipments)} shipments</p>
                                </div>
                                <div className="text-right">
                                  <span className="font-medium tabular-nums">{formatCurrency(user.totalCommission)}</span>
                                  <p className="text-xs text-muted-foreground">{percent}%</p>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>

                      {/* Right column - Brand Breakdown */}
                      <div className="rounded-xl bg-card border border-border/50 shadow-sm flex flex-col min-h-[400px]">
                        <div className="p-6 border-b border-border/50">
                          <div className="flex items-center justify-between">
                            <h3 className="text-base font-medium">Brand Breakdown</h3>
                            <span className="text-sm text-muted-foreground">
                              {selectedAggregateMonth?.breakdown.filter(c => c.shipments > 0).length || 0} brands
                            </span>
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">
                            {monthNames[(selectedAggregateMonth?.month || new Date().getMonth() + 1) - 1]} {selectedAggregateMonth?.year || new Date().getFullYear()}
                          </p>
                        </div>

                        <ScrollArea className="flex-1 p-6">
                          <div className="space-y-4">
                            {(() => {
                              // Use the selected month's breakdown (from snapshots for historical, current data for this month)
                              // Filter out clients with 0 shipments
                              const sortedBrands = (selectedAggregateMonth?.breakdown || []).filter(c => c.shipments > 0)
                              const maxShipmentsAll = Math.max(...sortedBrands.map(c => c.shipments), 1)
                              const totalCommissionAll = sortedBrands.reduce((sum, c) => sum + c.commission, 0)

                              return sortedBrands.map((client, index) => {
                                const barWidth = (client.shipments / maxShipmentsAll) * 100
                                const commissionPercent = totalCommissionAll > 0
                                  ? ((client.commission / totalCommissionAll) * 100).toFixed(0)
                                  : '0'

                                return (
                                  <div key={`${client.clientId}-${index}`} className="space-y-2">
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="flex items-center gap-2 min-w-0 flex-1">
                                        <span className="font-medium truncate">{client.clientName}</span>
                                        <div className="flex items-center gap-1 flex-shrink-0">
                                          {(client.byPartner?.shipbob ?? 0) > 0 && (
                                            <span className="text-[10px] text-muted-foreground bg-muted px-1 rounded">SB</span>
                                          )}
                                          {(client.byPartner?.eshipper ?? 0) > 0 && (
                                            <span className="text-[10px] text-muted-foreground bg-muted px-1 rounded">eS</span>
                                          )}
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-4 flex-shrink-0 text-sm">
                                        <span className="text-muted-foreground tabular-nums w-16 text-right">
                                          {formatNumber(client.shipments)}
                                        </span>
                                        <span className="font-medium tabular-nums w-20 text-right">
                                          {formatCurrency(client.commission)}
                                        </span>
                                        <span className="text-xs text-muted-foreground tabular-nums w-8 text-right">
                                          {commissionPercent}%
                                        </span>
                                      </div>
                                    </div>
                                    <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                                      <div
                                        className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                                        style={{ width: `${barWidth}%` }}
                                      />
                                    </div>
                                  </div>
                                )
                              })
                            })()}

                            {(!selectedAggregateMonth?.breakdown || selectedAggregateMonth.breakdown.filter(c => c.shipments > 0).length === 0) && (
                              <div className="py-8 text-center">
                                <p className="text-sm text-muted-foreground">No brands to display</p>
                              </div>
                            )}
                          </div>
                        </ScrollArea>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl bg-card border border-border/50 p-12 text-center">
                    <Users className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                    <h3 className="text-lg font-medium text-muted-foreground">No Commission Recipients</h3>
                    <p className="text-sm text-muted-foreground mt-2">
                      No users have been assigned commissions yet.
                    </p>
                  </div>
                )
              ) : data ? commissionContent : (
                <div className="rounded-xl bg-card border border-border/50 p-12 text-center">
                  <Users className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
                  <h3 className="text-lg font-medium text-muted-foreground">
                    No commission assignment for {previewUserName}
                  </h3>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </>
    )
  }

  // Personal view for commission recipients (non-admins)
  return (
    <>
      <SiteHeader sectionName="Financials" />
      <div className="flex flex-1 flex-col p-6">
        {commissionContent}
      </div>
    </>
  )
}
