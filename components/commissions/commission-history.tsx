"use client"

import * as React from "react"
import { Badge } from "@/components/ui/badge"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { ChevronRight } from "lucide-react"

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

interface HistorySnapshot {
  id: string
  period_year: number
  period_month: number
  shipment_count: number
  commission_amount: number
  locked_at: string
  breakdown?: ClientBreakdown[]
}

interface CurrentMonth {
  year: number
  month: number
  shipments: number
  commission: number
  breakdown?: ClientBreakdown[]
}

interface CommissionHistoryProps {
  history: HistorySnapshot[]
  currentMonth: CurrentMonth
}

export function CommissionHistory({ history, currentMonth }: CommissionHistoryProps) {
  const [selectedMonth, setSelectedMonth] = React.useState<{
    year: number
    month: number
    shipments: number
    commission: number
    breakdown: ClientBreakdown[]
    isCurrent: boolean
  } | null>(null)

  // Month names
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

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

  // Check if a snapshot matches current month
  const isCurrentMonth = (year: number, month: number) =>
    year === currentMonth.year && month === currentMonth.month

  // Filter out current month from history
  const filteredHistory = history.filter(h => !isCurrentMonth(h.period_year, h.period_month))

  // Calculate YTD total
  const currentYear = new Date().getFullYear()
  const ytdTotal = filteredHistory
    .filter(h => h.period_year === currentYear)
    .reduce((sum, h) => sum + h.commission_amount, 0) + currentMonth.commission

  // Handle clicking on current month
  const handleCurrentMonthClick = () => {
    if (currentMonth.breakdown && currentMonth.breakdown.length > 0) {
      setSelectedMonth({
        year: currentMonth.year,
        month: currentMonth.month,
        shipments: currentMonth.shipments,
        commission: currentMonth.commission,
        breakdown: currentMonth.breakdown,
        isCurrent: true,
      })
    }
  }

  // Handle clicking on historical month
  const handleHistoryClick = (snapshot: HistorySnapshot) => {
    if (snapshot.breakdown && snapshot.breakdown.length > 0) {
      setSelectedMonth({
        year: snapshot.period_year,
        month: snapshot.period_month,
        shipments: snapshot.shipment_count,
        commission: snapshot.commission_amount,
        breakdown: snapshot.breakdown,
        isCurrent: false,
      })
    }
  }

  // Calculate max shipments for relative bar widths in detail view
  const maxShipments = selectedMonth
    ? Math.max(...selectedMonth.breakdown.map(c => c.shipments), 1)
    : 1

  return (
    <>
      <div className="rounded-xl bg-card border border-border/50 p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-medium">Earnings History</h3>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">YTD Total</p>
            <p className="text-sm font-semibold">{formatCurrency(ytdTotal)}</p>
          </div>
        </div>
        <div className="space-y-1">
          {/* Current month */}
          <div
            onClick={handleCurrentMonthClick}
            className="flex items-center justify-between p-3 rounded-lg bg-emerald-50/80 dark:bg-emerald-950/40 border border-emerald-200/50 dark:border-emerald-800/30 cursor-pointer hover:bg-emerald-100 dark:hover:bg-emerald-950/60 transition-colors"
          >
            <div>
              <div className="flex items-center gap-2">
                <p className="font-medium">{monthNames[currentMonth.month - 1]}</p>
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400">
                  In Progress
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">{currentMonth.year}</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-4 text-sm">
                <span className="text-muted-foreground tabular-nums">
                  {formatNumber(currentMonth.shipments)}
                </span>
                <span className="font-medium tabular-nums min-w-[80px] text-right">
                  {formatCurrency(currentMonth.commission)}
                </span>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>

          {/* Historical months */}
          {filteredHistory.length > 0 ? (
            <div className="space-y-1 pt-2">
              {filteredHistory.map((snapshot) => (
                <div
                  key={snapshot.id}
                  onClick={() => handleHistoryClick(snapshot)}
                  className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors cursor-pointer"
                >
                  <div>
                    <p className="font-medium">{monthNames[snapshot.period_month - 1]}</p>
                    <p className="text-xs text-muted-foreground">{snapshot.period_year}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-4 text-sm">
                      <span className="text-muted-foreground tabular-nums">
                        {formatNumber(snapshot.shipment_count)}
                      </span>
                      <span className="font-medium tabular-nums min-w-[80px] text-right">
                        {formatCurrency(snapshot.commission_amount)}
                      </span>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center">
              <p className="text-sm text-muted-foreground">
                No historical data yet
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Monthly totals lock on the 1st
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Month Detail Sheet */}
      <Sheet open={!!selectedMonth} onOpenChange={(open) => !open && setSelectedMonth(null)}>
        <SheetContent className="sm:max-w-lg">
          {selectedMonth && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  {monthNames[selectedMonth.month - 1]} {selectedMonth.year}
                  {selectedMonth.isCurrent && (
                    <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400">
                      In Progress
                    </Badge>
                  )}
                </SheetTitle>
              </SheetHeader>

              {/* Summary Stats */}
              <div className="mt-6 grid grid-cols-2 gap-4">
                <div className="rounded-lg bg-muted p-4">
                  <p className="text-xs text-muted-foreground">Total Shipments</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums">{formatNumber(selectedMonth.shipments)}</p>
                </div>
                <div className="rounded-lg bg-muted p-4">
                  <p className="text-xs text-muted-foreground">Commission</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums">{formatCurrency(selectedMonth.commission)}</p>
                </div>
              </div>

              {/* Brand Breakdown */}
              <div className="mt-6">
                <h3 className="font-medium mb-4">Brand Breakdown</h3>
                <div className="space-y-3">
                  {selectedMonth.breakdown.map((client) => {
                    const barWidth = (client.shipments / maxShipments) * 100
                    const commissionPercent = selectedMonth.commission > 0
                      ? ((client.commission / selectedMonth.commission) * 100).toFixed(0)
                      : '0'

                    return (
                      <div key={client.clientId} className="space-y-1.5">
                        {/* Header row */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <span className="font-medium text-sm truncate">{client.clientName}</span>
                            <div className="flex gap-1 flex-shrink-0">
                              {client.byPartner.shipbob !== undefined && client.byPartner.shipbob > 0 && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                                  SB {formatNumber(client.byPartner.shipbob)}
                                </Badge>
                              )}
                              {client.byPartner.eshipper !== undefined && client.byPartner.eshipper > 0 && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                                  eS {formatNumber(client.byPartner.eshipper)}
                                </Badge>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-3 flex-shrink-0 text-sm">
                            <span className="text-muted-foreground tabular-nums">
                              {formatNumber(client.shipments)}
                            </span>
                            <span className="font-medium tabular-nums w-16 text-right">
                              {formatCurrency(client.commission)}
                            </span>
                            <span className="text-xs text-muted-foreground tabular-nums w-8 text-right">
                              {commissionPercent}%
                            </span>
                          </div>
                        </div>

                        {/* Progress bar */}
                        <div className="h-1 w-full overflow-hidden rounded-full bg-border">
                          <div
                            className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                            style={{ width: `${barWidth}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Formula explanation */}
              <div className="mt-8 p-4 rounded-lg bg-muted">
                <p className="text-xs text-muted-foreground">
                  Commission is calculated per brand using the formula <span className="font-mono">$2.50 × √shipments</span>, then summed for the total.
                </p>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}
