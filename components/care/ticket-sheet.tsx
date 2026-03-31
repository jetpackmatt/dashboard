"use client"

import * as React from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { formatCurrency } from "@/lib/format"
import {
  getStatusColors,
  getStatusDotColor,
  getStatusTextColor,
  displayStatus,
} from "@/lib/care/helpers"
import { XIcon } from "lucide-react"

// ─── Types ───────────────────────────────────────────────────────

interface TicketEvent {
  status: string
  note: string
  createdAt: string
  createdBy: string
}

interface TicketData {
  id: string
  ticketNumber: number
  clientName: string
  ticketType: string
  issueType: string | null
  status: string
  description: string | null
  creditAmount: number
  compensationRequest: string | null
  carrier: string | null
  trackingNumber: string | null
  shipmentId: string | null
  orderId: string | null
  events: TicketEvent[]
  createdAt: string
  resolvedAt: string | null
}

// ─── Context ─────────────────────────────────────────────────────

interface CareTicketSheetContextValue {
  openTicket: (ticketId: string, ticketNumber?: number) => void
  /** Prefetch ticket data in the background so opens are instant. */
  prefetchTickets: (ticketIds: string[]) => void
}

const CareTicketSheetContext = React.createContext<CareTicketSheetContextValue>({
  openTicket: () => {},
  prefetchTickets: () => {},
})

export function useCareTicketSheet() {
  return React.useContext(CareTicketSheetContext)
}

// ─── Provider ────────────────────────────────────────────────────

export function CareTicketSheetProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)
  const [ticketId, setTicketId] = React.useState<string | null>(null)
  const [ticketNumber, setTicketNumber] = React.useState<number | null>(null)
  const [ticket, setTicket] = React.useState<TicketData | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)

  // Cache: ticketId → TicketData (persists across opens within the same session)
  const cacheRef = React.useRef<Map<string, TicketData>>(new Map())
  // Track in-flight fetches to avoid duplicate requests
  const inflightRef = React.useRef<Set<string>>(new Set())

  const fetchAndCache = React.useCallback(async (id: string): Promise<TicketData | null> => {
    if (cacheRef.current.has(id)) return cacheRef.current.get(id)!
    if (inflightRef.current.has(id)) return null // already fetching
    inflightRef.current.add(id)
    try {
      const res = await fetch(`/api/data/care-tickets/${id}`)
      if (!res.ok) return null
      const data = await res.json()
      if (data.data) {
        cacheRef.current.set(id, data.data)
        return data.data
      }
    } catch {
      // silently fail
    } finally {
      inflightRef.current.delete(id)
    }
    return null
  }, [])

  const prefetchTickets = React.useCallback((ticketIds: string[]) => {
    const uncached = ticketIds.filter(id => !cacheRef.current.has(id) && !inflightRef.current.has(id))
    // Fetch in small batches to avoid flooding
    for (const id of uncached.slice(0, 20)) {
      fetchAndCache(id)
    }
  }, [fetchAndCache])

  const openTicket = React.useCallback((id: string, num?: number) => {
    setTicketId(id)
    setTicketNumber(num ?? null)
    setOpen(true)
    // Check cache immediately — if hit, show instantly with no loading state
    const cached = cacheRef.current.get(id)
    if (cached) {
      setTicket(cached)
      setIsLoading(false)
    } else {
      setTicket(null)
      setIsLoading(true)
    }
  }, [])

  // Fetch ticket data when opened (only if not already cached)
  React.useEffect(() => {
    if (!open || !ticketId) return
    if (ticket) return // already have data from cache

    let cancelled = false

    fetchAndCache(ticketId).then(data => {
      if (!cancelled && data) {
        setTicket(data)
      }
      if (!cancelled) setIsLoading(false)
    })

    return () => { cancelled = true }
  }, [open, ticketId, ticket, fetchAndCache])

  // Close on Escape
  React.useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  const contextValue = React.useMemo(() => ({ openTicket, prefetchTickets }), [openTicket, prefetchTickets])

  return (
    <CareTicketSheetContext.Provider value={contextValue}>
      <div className="relative flex flex-col flex-1 min-h-0 overflow-hidden">
        {children}

        <AnimatePresence>
          {open && (
            <>
              {/* Scrim — only within the content area */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="absolute inset-0 z-40 bg-black/40"
                onClick={() => setOpen(false)}
              />

              {/* Slide-up panel */}
              <motion.div
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%" }}
                transition={{ type: "spring", damping: 30, stiffness: 300 }}
                className="absolute bottom-0 left-0 right-0 z-50 flex flex-col bg-white dark:bg-zinc-900 rounded-t-xl shadow-2xl border-t border-border/50 overflow-hidden"
                style={{ height: "min(65vh, 560px)" }}
              >
                {/* Close button */}
                <button
                  onClick={() => setOpen(false)}
                  className="absolute right-4 top-3.5 z-10 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                >
                  <XIcon className="h-4 w-4" />
                </button>

                {isLoading ? (
                  <TicketSkeleton />
                ) : ticket ? (
                  <TicketContent ticket={ticket} />
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                    Ticket #{ticketNumber || ''} not found
                  </div>
                )}
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    </CareTicketSheetContext.Provider>
  )
}

// ─── Status background for sections ─────────────────────────────

function getStatusBg(status: string): string {
  switch (status) {
    case "Resolved":
    case "Credit Approved":
      return "bg-emerald-50 dark:bg-emerald-950/30"
    case "Credit Requested":
      return "bg-orange-50 dark:bg-orange-950/30"
    case "Credit Not Approved":
      return "bg-red-50 dark:bg-red-950/30"
    case "Under Review":
      return "bg-blue-50 dark:bg-blue-950/30"
    case "Closed":
      return "bg-zinc-50 dark:bg-zinc-800/50"
    default:
      return "bg-zinc-50 dark:bg-zinc-800/50"
  }
}

// ─── Ticket Content ──────────────────────────────────────────────

function TicketContent({ ticket }: { ticket: TicketData }) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className={cn("flex items-center gap-3 px-6 py-3.5 border-b border-border/40 shrink-0", getStatusBg(ticket.status))}>
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-base font-semibold text-foreground">#{ticket.ticketNumber}</span>
          <Badge
            variant="outline"
            className={cn("text-[11px] px-1.5 whitespace-nowrap", getStatusColors(ticket.status))}
          >
            {displayStatus(ticket.status)}
          </Badge>
        </div>
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <span>{ticket.clientName}</span>
          {ticket.issueType && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span>{ticket.issueType}</span>
            </>
          )}
          {ticket.ticketType !== 'Claim' && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span>{ticket.ticketType}</span>
            </>
          )}
        </div>
      </div>

      {/* Body — two columns */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Left: Credit + Details */}
        <div className="w-[200px] shrink-0 border-r border-border/40 flex flex-col overflow-y-auto bg-white dark:bg-zinc-900">
          {/* Credit card */}
          {(ticket.compensationRequest || ticket.creditAmount > 0 ||
            ticket.status === 'Credit Requested' || ticket.status === 'Credit Approved' || ticket.status === 'Credit Not Approved') && (
            <div className="px-5 py-4 border-b border-border/40">
              <div className={cn(
                "text-[9px] font-medium uppercase tracking-wider mb-0.5",
                ticket.status === 'Resolved' || ticket.status === 'Credit Approved'
                  ? "text-emerald-600 dark:text-emerald-400"
                  : ticket.status === 'Credit Not Approved'
                    ? "text-red-600 dark:text-red-400"
                    : ticket.status === 'Credit Requested'
                      ? "text-orange-700 dark:text-orange-300"
                      : "text-muted-foreground"
              )}>
                {ticket.status === 'Credit Approved' ? 'Credit Approved'
                  : ticket.status === 'Credit Not Approved' ? 'Credit Not Approved'
                  : ticket.status === 'Credit Requested' ? 'Credit Requested'
                  : 'Credit'}
              </div>
              <div className={cn(
                "text-lg font-semibold",
                ticket.status === 'Resolved' || ticket.status === 'Credit Approved'
                  ? "text-emerald-700 dark:text-emerald-300"
                  : ticket.status === 'Credit Not Approved'
                    ? "text-red-700 dark:text-red-300 line-through"
                    : "text-foreground"
              )}>
                {ticket.creditAmount > 0 ? formatCurrency(ticket.creditAmount) : 'TBD'}
              </div>
            </div>
          )}

          {/* Detail rows */}
          <div className="px-5 py-4 space-y-3">
            {ticket.shipmentId && (
              <DetailRow label="Shipment" value={ticket.shipmentId} mono />
            )}
            {ticket.orderId && (
              <DetailRow label="Order" value={ticket.orderId} mono />
            )}
            {ticket.carrier && (
              <DetailRow label="Carrier" value={ticket.carrier} />
            )}
            {ticket.trackingNumber && (
              <DetailRow label="Tracking" value={ticket.trackingNumber} mono />
            )}
            <DetailRow
              label="Opened"
              value={new Date(ticket.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            />
            {ticket.resolvedAt && (
              <DetailRow
                label="Resolved"
                value={new Date(ticket.resolvedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              />
            )}
          </div>
        </div>

        {/* Right: Description + Activity timeline */}
        <div className="flex-1 flex flex-col overflow-y-auto min-w-0 bg-white dark:bg-zinc-900">
          {/* Description */}
          {ticket.description && (
            <div className="px-6 py-4 border-b border-border/40 bg-zinc-50/80 dark:bg-zinc-800/40">
              <div className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider mb-1.5">Description</div>
              <p className="text-[13px] text-foreground whitespace-pre-wrap break-words leading-relaxed">
                {ticket.description}
              </p>
            </div>
          )}

          {/* Activity timeline */}
          {ticket.events && ticket.events.length > 0 && (
            <div className="px-6 py-5 flex-1">
              <div className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider mb-3.5">Activity</div>
              <div className="relative">
                <div className="absolute left-[5px] top-2 bottom-2 w-px bg-border/60" />

                <div className="space-y-5">
                  {ticket.events.map((event, idx) => (
                    <div key={idx} className="relative flex gap-4 pl-6">
                      <div className={cn(
                        "absolute left-0 top-0.5 w-[11px] h-[11px] rounded-full border-2",
                        idx === 0
                          ? getStatusDotColor(event.status)
                          : "bg-white dark:bg-zinc-900 border-border"
                      )} />

                      <div className="flex-1 min-w-0 pb-1">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className={cn(
                            "text-sm font-semibold",
                            getStatusTextColor(event.status)
                          )}>
                            {displayStatus(event.status)}
                          </span>
                          <span className="text-[10px] text-muted-foreground/60 tabular-nums shrink-0">
                            {formatEventDateTime(event.createdAt, event.createdBy)}
                          </span>
                        </div>
                        {event.note && (
                          <p className={cn(
                            "text-[13px] leading-relaxed",
                            idx === 0 ? "text-muted-foreground" : "text-muted-foreground/60"
                          )}>
                            {event.note}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Detail Row ──────────────────────────────────────────────────

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] text-muted-foreground/70 uppercase tracking-wider mb-0.5">{label}</div>
      <span className={cn("text-[11px] text-foreground", mono && "font-mono")}>{value}</span>
    </div>
  )
}

// ─── Skeleton ────────────────────────────────────────────────────

function TicketSkeleton() {
  return (
    <div className="flex flex-col h-full animate-pulse bg-white dark:bg-zinc-900">
      <div className="px-6 py-3.5 border-b border-border/30 flex items-center gap-3 bg-zinc-50 dark:bg-zinc-800/50">
        <div className="h-5 w-16 bg-zinc-200 dark:bg-zinc-700 rounded" />
        <div className="h-5 w-24 bg-zinc-200 dark:bg-zinc-700 rounded" />
        <div className="h-4 w-32 bg-zinc-200 dark:bg-zinc-700 rounded" />
      </div>
      <div className="flex flex-1">
        <div className="w-[200px] border-r border-border/30 p-5 space-y-4">
          <div className="h-3 w-20 bg-zinc-200 dark:bg-zinc-700 rounded" />
          <div className="h-6 w-24 bg-zinc-200 dark:bg-zinc-700 rounded" />
          <div className="h-3 w-16 bg-zinc-200 dark:bg-zinc-700 rounded mt-6" />
          <div className="h-4 w-28 bg-zinc-200 dark:bg-zinc-700 rounded" />
        </div>
        <div className="flex-1 p-6 space-y-4">
          <div className="h-3 w-16 bg-zinc-200 dark:bg-zinc-700 rounded" />
          {[1, 2, 3].map(i => (
            <div key={i} className="flex gap-4 pl-6">
              <div className="h-4 w-24 bg-zinc-200 dark:bg-zinc-700 rounded" />
              <div className="h-3 w-48 bg-zinc-200 dark:bg-zinc-700 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────

function formatEventDateTime(dateStr: string, createdBy: string): string {
  if (!dateStr) return createdBy || ''
  const date = new Date(dateStr)
  const formatted = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
  if (createdBy && createdBy !== 'System') {
    return `${createdBy} · ${formatted}`
  }
  return formatted
}
