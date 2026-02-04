"use client"

import { Badge } from "@/components/ui/badge"

interface ClientData {
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

interface ClientBreakdownProps {
  clients: ClientData[]
}

export function ClientBreakdown({ clients }: ClientBreakdownProps) {
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

  // Calculate max shipments for relative bar widths
  const maxShipments = Math.max(...clients.map(c => c.shipments), 1)

  // Total commission for percentage calculations
  const totalCommission = clients.reduce((sum, c) => sum + c.commission, 0)

  if (clients.length === 0) {
    return (
      <div className="rounded-xl bg-card border border-border/50 p-6 shadow-sm">
        <h3 className="text-base font-medium">Brand Performance</h3>
        <p className="mt-4 text-sm text-muted-foreground">
          No brands assigned yet.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-xl bg-card border border-border/50 p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-medium">Brand Performance</h3>
        <span className="text-sm text-muted-foreground">
          {clients.length} brand{clients.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="space-y-3">
        {clients.map((client) => {
          const barWidth = (client.shipments / maxShipments) * 100
          const commissionPercent = totalCommission > 0
            ? ((client.commission / totalCommission) * 100).toFixed(0)
            : '0'

          return (
            <div key={client.clientId} className="space-y-1.5">
              {/* Header row - brand name and stats */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="font-medium truncate">{client.clientName}</span>
                  {Object.keys(client.byPartner).length > 0 && (
                    <div className="flex gap-1 flex-shrink-0">
                      {client.byPartner.shipbob !== undefined && client.byPartner.shipbob > 0 && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                          SB
                        </Badge>
                      )}
                      {client.byPartner.eshipper !== undefined && client.byPartner.eshipper > 0 && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">
                          eS
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-4 flex-shrink-0">
                  <span className="text-sm text-muted-foreground tabular-nums w-16 text-right">
                    {formatNumber(client.shipments)}
                  </span>
                  <span className="text-sm font-medium tabular-nums w-20 text-right">
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
      </div>
    </div>
  )
}
