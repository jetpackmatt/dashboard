"use client"

import { formatDistanceToNow } from "date-fns"

interface CommissionTallyProps {
  totalCommission: number
  totalShipments: number
  formula: string
  commissionTypeName: string
  lastUpdated: Date | null
}

export function CommissionTally({
  totalCommission,
  totalShipments,
  formula,
  commissionTypeName,
  lastUpdated,
}: CommissionTallyProps) {
  // Format commission as currency
  const formattedCommission = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(totalCommission)

  // Format shipments with commas
  const formattedShipments = new Intl.NumberFormat('en-US').format(totalShipments)

  // Calculate days remaining in month
  const now = new Date()
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const daysRemaining = lastDay - now.getDate()
  const monthProgress = (now.getDate() / lastDay) * 100

  return (
    <div className="rounded-xl bg-card border border-border/50 p-6 shadow-sm">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
        {/* Left: Earnings */}
        <div>
          <p className="text-sm text-muted-foreground">
            Earnings This Month
          </p>
          <p className="mt-1 text-4xl font-bold tracking-tight">
            {formattedCommission}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {commissionTypeName} commission
          </p>
        </div>

        {/* Right: Stats */}
        <div className="flex gap-12">
          <div>
            <p className="text-sm text-muted-foreground">Shipments</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{formattedShipments}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Formula</p>
            <p className="mt-1 text-2xl font-semibold font-mono">{formula}</p>
          </div>
        </div>
      </div>

      {/* Progress indicator */}
      <div className="mt-6">
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
          <span>Month progress</span>
          <span>{daysRemaining} days remaining</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-500"
            style={{ width: `${monthProgress}%` }}
          />
        </div>
      </div>

      {/* Last updated */}
      {lastUpdated && (
        <p className="mt-4 text-xs text-muted-foreground">
          Updated {formatDistanceToNow(lastUpdated, { addSuffix: true })}
        </p>
      )}
    </div>
  )
}
