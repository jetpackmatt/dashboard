"use client"

import * as React from "react"
import { useDebouncedCallback } from "use-debounce"
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command"

interface TicketResult {
  id: string
  ticketNumber: number
  ticketType: string
  issueType: string | null
  status: string
  shipmentId: string | null
  trackingNumber: string | null
  clientId: string | null
  clientName: string | null
  description: string | null
  creditAmount?: number
}

interface TicketSearchCommandProps {
  onSelect: (ticketId: string, ticketNumber: number) => void
  /** Pre-filter to tickets for this client */
  clientId?: string | null
  /** Highlight tickets matching this amount */
  creditAmount?: number
}

const STATUS_COLORS: Record<string, string> = {
  'Under Review': 'bg-yellow-500',
  'Credit Requested': 'bg-blue-500',
  'Credit Approved': 'bg-emerald-500',
  'Resolved': 'bg-zinc-400',
  'Credit Denied': 'bg-red-500',
}

export function TicketSearchCommand({ onSelect, clientId, creditAmount }: TicketSearchCommandProps) {
  const [tickets, setTickets] = React.useState<TicketResult[]>([])
  const [isLoading, setIsLoading] = React.useState(false)
  const [hasSearched, setHasSearched] = React.useState(false)

  const fetchTickets = React.useCallback(async (query: string) => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams()
      if (query.trim()) params.set('q', query.trim())
      if (clientId) params.set('clientId', clientId)
      // Only show tickets likely to need linking
      params.set('status', 'Credit Requested,Credit Approved')

      const res = await fetch(`/api/data/misfits/search-tickets?${params}`)
      if (res.ok) {
        const data = await res.json()
        let results: TicketResult[] = data.data || []

        // Sort: exact amount matches first, then by recency
        if (creditAmount) {
          results = results.sort((a, b) => {
            const aMatch = a.creditAmount !== undefined && Math.abs(a.creditAmount - creditAmount) < 0.01
            const bMatch = b.creditAmount !== undefined && Math.abs(b.creditAmount - creditAmount) < 0.01
            if (aMatch && !bMatch) return -1
            if (!aMatch && bMatch) return 1
            return 0
          })
        }

        setTickets(results)
      }
    } catch {
      // silently fail
    }
    setIsLoading(false)
    setHasSearched(true)
  }, [clientId, creditAmount])

  const debouncedSearch = useDebouncedCallback((query: string) => {
    fetchTickets(query)
  }, 250)

  // Load on mount
  React.useEffect(() => {
    fetchTickets('')
  }, [fetchTickets])

  return (
    <Command shouldFilter={false} className="w-full">
      <CommandInput
        placeholder="Search by ticket #, shipment ID, tracking..."
        onValueChange={(value) => debouncedSearch(value)}
        className="text-[13px]"
      />
      <CommandList>
        {isLoading ? (
          <div className="py-4 text-center text-[12px] text-muted-foreground">
            Searching...
          </div>
        ) : hasSearched && tickets.length === 0 ? (
          <CommandEmpty>No tickets found.</CommandEmpty>
        ) : (
          <CommandGroup>
            {tickets.map((ticket) => {
              const isAmountMatch = creditAmount !== undefined &&
                ticket.creditAmount !== undefined &&
                Math.abs(ticket.creditAmount - creditAmount) < 0.01

              return (
                <CommandItem
                  key={ticket.id}
                  value={ticket.id}
                  onSelect={() => onSelect(ticket.id, ticket.ticketNumber)}
                  className="flex items-center justify-between gap-2 py-2 cursor-pointer"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-[11px] font-medium shrink-0">
                      #{ticket.ticketNumber}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      <span
                        className={`inline-block w-1.5 h-1.5 rounded-full ${STATUS_COLORS[ticket.status] || 'bg-zinc-400'}`}
                      />
                      <span className="text-[10px] text-muted-foreground">
                        {ticket.status}
                      </span>
                    </div>
                    {ticket.creditAmount !== undefined && ticket.creditAmount > 0 && (
                      <span className={`font-mono text-[10px] ${isAmountMatch ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-muted-foreground/60'}`}>
                        ${ticket.creditAmount.toFixed(2)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {isAmountMatch && (
                      <span className="text-[9px] font-medium uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                        Match
                      </span>
                    )}
                    {ticket.clientName && (
                      <span className="text-[10px] text-muted-foreground">
                        {ticket.clientName}
                      </span>
                    )}
                    {ticket.shipmentId && (
                      <span className="font-mono text-[10px] text-muted-foreground/60">
                        {ticket.shipmentId}
                      </span>
                    )}
                  </div>
                </CommandItem>
              )
            })}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  )
}
