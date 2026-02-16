"use client"

import * as React from "react"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  PlusIcon,
  SearchIcon,
  XIcon,
  CopyIcon,
  CheckIcon,
  MessageSquareIcon,
} from "lucide-react"
import { useDebouncedCallback } from "use-debounce"

import { SiteHeader } from "@/components/site-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { useClient } from "@/components/client-context"
import { ClientBadge, JETPACK_INTERNAL_ID } from "@/components/transactions/client-badge"
import { useTablePreferences } from "@/hooks/use-table-preferences"
import { TicketSearchCommand } from "@/components/misfits/ticket-search-command"
import { CreditClassifyActions } from "@/components/misfits/credit-classify-actions"

// Types
interface MisfitTransaction {
  id: string
  transactionId: string
  clientId: string | null
  clientName: string | null
  merchantId: string | null
  referenceId: string | null
  referenceType: string | null
  cost: number
  currencyCode: string
  chargeDate: string
  feeType: string
  transactionType: string | null
  fulfillmentCenter: string | null
  trackingId: string | null
  careTicketId: string | null
  comment: string | null
  creditReason: string | null
  sbTicketRef: string | null
  missingBrand: boolean
  missingTicket: boolean
  missingShipment: boolean
  // Pending credit fields
  isPendingCredit?: boolean
  creditShippingPortion?: number | null
  careTicket?: {
    id: string
    ticketNumber: number
    issueType: string | null
    compensationRequest: string | null
    reshipmentStatus: string | null
    reshipmentId: string | null
    shipmentId: string | null
  } | null
}

interface AvailableTicket {
  id: string
  ticketNumber: number
  ticketType: string
  status: string
  shipmentId: string | null
  creditAmount: number
  clientId: string | null
  clientName: string | null
  createdAt: string
}

interface TicketSuggestion {
  ticket: AvailableTicket
  confidence: 'exact' | 'probable'
  reason: string
}

// Match credits to available care tickets client-side.
// Priority: shipment ID > client+amount+date > client+amount.
// Amount-only matches are intentionally excluded (too many false positives).
// Tickets already linked to another transaction are pre-filtered by the API.
function findTicketMatch(
  tx: MisfitTransaction,
  tickets: AvailableTicket[],
  usedTicketIds: Set<string>
): TicketSuggestion | null {
  if (tx.feeType !== 'Credit' || tx.careTicketId) return null

  const absCost = Math.abs(tx.cost)
  const txDate = tx.chargeDate ? new Date(tx.chargeDate) : null

  // 1. Shipment match — credit references same shipment as ticket (strongest signal)
  if (tx.referenceId && tx.referenceType === 'Shipment') {
    const shipmentMatch = tickets.find(
      (t) => !usedTicketIds.has(t.id) && t.shipmentId === tx.referenceId
    )
    if (shipmentMatch) {
      return { ticket: shipmentMatch, confidence: 'exact', reason: 'Same shipment ID' }
    }
  }

  // 2. Client + amount + date proximity (within 30 days)
  if (tx.clientId && txDate) {
    const clientAmountDate = tickets.find((t) => {
      if (usedTicketIds.has(t.id)) return false
      if (t.clientId !== tx.clientId) return false
      if (t.creditAmount <= 0) return false
      if (Math.abs(t.creditAmount - absCost) >= 0.01) return false
      const tDate = new Date(t.createdAt)
      const daysDiff = Math.abs(txDate.getTime() - tDate.getTime()) / (1000 * 60 * 60 * 24)
      return daysDiff <= 30
    })
    if (clientAmountDate) {
      return { ticket: clientAmountDate, confidence: 'exact', reason: 'Same brand, amount, and date range' }
    }
  }

  // 3. Client + amount only (weaker — no date constraint)
  if (tx.clientId) {
    const clientAmount = tickets.find(
      (t) =>
        !usedTicketIds.has(t.id) &&
        t.clientId === tx.clientId &&
        t.creditAmount > 0 &&
        Math.abs(t.creditAmount - absCost) < 0.01
    )
    if (clientAmount) {
      return { ticket: clientAmount, confidence: 'probable', reason: 'Same brand and amount' }
    }
  }

  // No amount-only matches — too unreliable with common amounts
  return null
}

// Filter type options
const TYPE_FILTERS = [
  { value: '', label: 'All' },
  { value: 'credit', label: 'Credits' },
  { value: 'unattributed', label: 'Unattributed' },
  { value: 'pending_credits', label: 'Pending Credits' },
] as const

const FEE_TYPE_OPTIONS = ['Shipping', 'Storage', 'Credit', 'Return', 'Pick and Pack', 'Receiving', 'Other'] as const

function formatDateFixed(dateStr: string): string {
  if (!dateStr) return '-'
  const datePart = dateStr.split('T')[0]
  const [year, month, day] = datePart.split('-')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[parseInt(month) - 1]} ${parseInt(day)}, ${year}`
}

function formatCurrency(amount: number): string {
  const abs = Math.abs(amount)
  const formatted = `$${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  return amount < 0 ? `-${formatted}` : formatted
}

export default function MisfitsPage() {
  const { effectiveIsAdmin, effectiveIsCareAdmin, clients } = useClient()
  const canEdit = effectiveIsAdmin || effectiveIsCareAdmin

  // Data state
  const [misfits, setMisfits] = React.useState<MisfitTransaction[]>([])
  const [availableTickets, setAvailableTickets] = React.useState<AvailableTicket[]>([])
  const [totalCount, setTotalCount] = React.useState(0)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  // Search state
  const [searchInput, setSearchInput] = React.useState('')
  const [searchQuery, setSearchQuery] = React.useState('')
  const debouncedSearch = useDebouncedCallback((value: string) => {
    setSearchQuery(value)
    setCurrentPage(1)
  }, 300)

  // Filter state
  const [typeFilter, setTypeFilter] = React.useState('')
  const [feeTypeFilter, setFeeTypeFilter] = React.useState('')

  // Bulk selection state
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())
  const [bulkClientId, setBulkClientId] = React.useState('')
  const [isBulkLinking, setIsBulkLinking] = React.useState(false)

  // Pagination
  const [currentPage, setCurrentPage] = React.useState(1)
  const misfitsPrefs = useTablePreferences('misfits', 50)
  const totalPages = Math.ceil(totalCount / misfitsPrefs.pageSize)

  // Connect states
  const [ticketPopoverId, setTicketPopoverId] = React.useState<string | null>(null)
  const [reviewPopoverId, setReviewPopoverId] = React.useState<string | null>(null)
  const [newTicketPopoverId, setNewTicketPopoverId] = React.useState<string | null>(null)
  const [newTicketShipmentId, setNewTicketShipmentId] = React.useState('')
  const [newTicketDescription, setNewTicketDescription] = React.useState('')
  const [isConnecting, setIsConnecting] = React.useState(false)

  // Brand attribution state
  const [confirmAttribution, setConfirmAttribution] = React.useState<{transactionId: string, clientId: string, clientName: string} | null>(null)
  const [isAttributing, setIsAttributing] = React.useState(false)

  // Copy state
  const [copiedId, setCopiedId] = React.useState<string | null>(null)

  // Fetch misfits
  const fetchMisfits = React.useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams()
      if (typeFilter) params.set('type', typeFilter)
      if (feeTypeFilter) params.set('feeType', feeTypeFilter)
      if (searchQuery) params.set('search', searchQuery)
      params.set('limit', misfitsPrefs.pageSize.toString())
      params.set('offset', ((currentPage - 1) * misfitsPrefs.pageSize).toString())

      const response = await fetch(`/api/data/misfits?${params}`)
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to fetch' }))
        throw new Error(errorData.error || `HTTP ${response.status}`)
      }

      const data = await response.json()
      setMisfits(data.data || [])
      setAvailableTickets(data.availableTickets || [])
      setTotalCount(data.totalCount || 0)
      setSelectedIds(new Set()) // Clear selection on data change
    } catch (err) {
      console.error('Error fetching misfits:', err)
      setError(err instanceof Error ? err.message : 'Failed to load misfits')
      setMisfits([])
      setTotalCount(0)
    } finally {
      setIsLoading(false)
    }
  }, [typeFilter, feeTypeFilter, searchQuery, currentPage, misfitsPrefs.pageSize])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(() => { fetchMisfits() }, [fetchMisfits])

  // Compute ticket suggestions for each credit misfit
  const suggestionMap = React.useMemo(() => {
    const map = new Map<string, TicketSuggestion>()
    const usedTicketIds = new Set<string>()

    // Process credits in order — first match wins (prevents double-assigning)
    for (const tx of misfits) {
      const match = findTicketMatch(tx, availableTickets, usedTicketIds)
      if (match) {
        map.set(tx.transactionId, match)
        usedTicketIds.add(match.ticket.id)
      }
    }
    return map
  }, [misfits, availableTickets])

  // Handle create new ticket from credit
  async function handleCreateTicket(transactionId: string) {
    setIsConnecting(true)
    try {
      const res = await fetch('/api/data/misfits/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionId,
          action: 'create_ticket',
          shipmentId: newTicketShipmentId.trim() || undefined,
          description: newTicketDescription.trim() || undefined,
        }),
      })
      if (res.ok) {
        const result = await res.json()
        const msg = result.autoResolved
          ? `Created ticket #${result.ticketNumber} (auto-resolved — already invoiced)`
          : `Created ticket #${result.ticketNumber} and linked`
        toast.success(msg)
        fetchMisfits()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to create ticket')
      }
    } catch {
      toast.error('Failed to create ticket')
    }
    setIsConnecting(false)
    setNewTicketPopoverId(null)
  }

  // Handle connect to ticket
  async function handleConnectTicket(transactionId: string, careTicketId: string, ticketNumber: number) {
    setIsConnecting(true)
    try {
      const res = await fetch('/api/data/misfits/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionId,
          action: 'connect_ticket',
          careTicketId,
        }),
      })
      if (res.ok) {
        const result = await res.json()
        const resolved = []
        if (result.resolved.brand) resolved.push('Brand')
        if (result.resolved.shipment) resolved.push('Shipment')
        if (result.resolved.ticket) resolved.push('Ticket')
        toast.success(`Connected to ticket #${ticketNumber}: ${resolved.join(', ')}`)
        fetchMisfits()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to connect ticket')
      }
    } catch {
      toast.error('Failed to connect ticket')
    }
    setIsConnecting(false)
    setTicketPopoverId(null)
  }

  // Handle brand attribution
  async function handleAttributeBrand(transactionId: string, clientId: string, clientName: string) {
    setIsAttributing(true)
    try {
      const res = await fetch('/api/data/misfits/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionId,
          action: 'set_brand',
          clientId,
        }),
      })
      if (res.ok) {
        toast.success(`Attributed to ${clientName}`)
        fetchMisfits()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to attribute brand')
      }
    } catch {
      toast.error('Failed to attribute brand')
    }
    setIsAttributing(false)
    setConfirmAttribution(null)
  }

  // Selection helpers
  function toggleSelected(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selectedIds.size === misfits.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(misfits.map(t => t.transactionId)))
    }
  }

  // Bulk attribute to brand
  async function handleBulkAttribute() {
    if (!bulkClientId || selectedIds.size === 0) return
    setIsBulkLinking(true)
    try {
      const promises = Array.from(selectedIds).map(transactionId =>
        fetch(`/api/admin/transactions/${transactionId}/link`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId: bulkClientId }),
        })
      )
      await Promise.all(promises)
      toast.success(`Attributed ${selectedIds.size} transaction(s)`)
      setBulkClientId('')
      fetchMisfits()
    } catch {
      toast.error('Failed to attribute transactions')
    }
    setIsBulkLinking(false)
  }

  // Bulk dispute (move to disputes workflow)
  async function handleBulkDispute() {
    if (selectedIds.size === 0) return
    setIsBulkLinking(true)
    try {
      const promises = Array.from(selectedIds).map(transactionId =>
        fetch(`/api/admin/transactions/${transactionId}/dispute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      )
      await Promise.all(promises)
      toast.success(`Moved ${selectedIds.size} transaction(s) to Disputes`)
      fetchMisfits()
    } catch {
      toast.error('Failed to dispute transactions')
    }
    setIsBulkLinking(false)
  }

  // Copy to clipboard
  function handleCopy(text: string) {
    navigator.clipboard.writeText(text)
    setCopiedId(text)
    setTimeout(() => setCopiedId(null), 2000)
  }

  // Access check - render gate (admin + care admin only, not care team or brands)
  if (!effectiveIsAdmin && !effectiveIsCareAdmin) {
    return (
      <>
        <SiteHeader sectionName="Misfits" />
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          You don&apos;t have access to this page.
        </div>
      </>
    )
  }

  return (
    <>
      <SiteHeader sectionName="Misfits" />

      <div className="flex flex-1 flex-col overflow-x-hidden bg-background rounded-t-xl">
        <div className="flex flex-col w-full h-[calc(100vh-64px)] px-4 lg:px-6">

          {/* Error State */}
          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/30 px-4 py-3 mb-3 text-sm text-destructive">
              {error}
              <button onClick={fetchMisfits} className="ml-2 underline">Retry</button>
            </div>
          )}

          {/* Filter bar — opaque, sticks above table */}
          <div className="sticky top-0 z-20 -mx-4 lg:-mx-6 bg-muted dark:bg-zinc-900 rounded-t-xl font-roboto">
            <div className="px-4 lg:px-6 h-[52px] flex items-center justify-between gap-4">
              {/* LEFT: Search + dropdown filters */}
              <div className="flex items-center gap-2">
                <div className="relative w-44 2xl:w-56">
                  <SearchIcon className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search reference, tracking..."
                    value={searchInput}
                    onChange={(e) => {
                      setSearchInput(e.target.value)
                      debouncedSearch(e.target.value)
                    }}
                    className="h-7 pl-8 text-xs bg-background border-border text-muted-foreground placeholder:text-muted-foreground/50"
                  />
                  {searchInput && (
                    <button
                      onClick={() => { setSearchInput(""); setSearchQuery(""); setCurrentPage(1) }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <XIcon className="h-3 w-3" />
                    </button>
                  )}
                </div>

                <Select value={feeTypeFilter} onValueChange={(v) => { setFeeTypeFilter(v === '__all__' ? '' : v); setCurrentPage(1) }}>
                  <SelectTrigger className="h-7 w-auto gap-1.5 text-xs bg-background border-border">
                    <SelectValue placeholder="Fee Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__" className="text-xs">All Fee Types</SelectItem>
                    {FEE_TYPE_OPTIONS.map(ft => (
                      <SelectItem key={ft} value={ft} className="text-xs">{ft}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {feeTypeFilter && (
                  <button
                    onClick={() => { setFeeTypeFilter(''); setCurrentPage(1) }}
                    className="inline-flex items-center gap-1 h-[22px] px-1.5 rounded text-[11px] text-muted-foreground hover:text-foreground bg-muted/50 hover:bg-background transition-colors"
                  >
                    <XIcon className="h-3 w-3" />
                    Clear
                  </button>
                )}
              </div>

              {/* RIGHT: Type filter segmented control */}
              <div className="inline-flex items-center h-7 rounded-md bg-background p-0.5 border border-border">
                {TYPE_FILTERS.map((f) => (
                  <button
                    key={f.value}
                    onClick={() => { setTypeFilter(f.value); setCurrentPage(1) }}
                    className={cn(
                      "inline-flex items-center gap-1.5 px-2.5 h-6 rounded text-xs font-medium transition-all",
                      typeFilter === f.value
                        ? "bg-muted text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Bulk action bar */}
            {selectedIds.size > 0 && canEdit && (
              <div className="px-4 lg:px-6 pb-2 flex items-center gap-2">
                <span className="text-xs font-medium tabular-nums text-blue-600 dark:text-blue-400">
                  {selectedIds.size} selected
                </span>

                <Select value={bulkClientId} onValueChange={setBulkClientId}>
                  <SelectTrigger className="h-7 w-auto gap-1.5 text-xs bg-background border-border">
                    <SelectValue placeholder="Attribute to..." />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.filter(c => c.merchant_id).map(c => (
                      <SelectItem key={c.id} value={c.id} className="text-xs">{c.company_name}</SelectItem>
                    ))}
                    <SelectItem value="__jetpack_parent__" className="text-xs font-medium text-orange-600">
                      Jetpack (Parent)
                    </SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  className="h-7 px-3 text-xs"
                  onClick={handleBulkAttribute}
                  disabled={!bulkClientId || isBulkLinking}
                >
                  {isBulkLinking ? '...' : 'Apply'}
                </Button>

                <div className="h-4 w-px bg-border" />

                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-3 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                  onClick={handleBulkDispute}
                  disabled={isBulkLinking}
                >
                  Dispute
                </Button>

                <button
                  onClick={() => setSelectedIds(new Set())}
                  className="text-muted-foreground hover:text-foreground ml-auto"
                >
                  <XIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Table */}
          <div className="relative flex flex-col flex-1 min-h-0 overflow-y-auto overflow-x-hidden -mx-4 lg:-mx-6">
            <table className="w-full text-[13px] font-roboto" style={{ tableLayout: 'auto' }}>
              <thead className="sticky top-0 z-10 bg-muted dark:bg-zinc-900">
                <tr className="h-[45px]">
                  <th className="w-px whitespace-nowrap align-middle pl-4 lg:pl-6 pr-3 text-[10px] font-medium text-zinc-500 uppercase tracking-wide"></th>
                  {canEdit && (
                    <th className="w-px whitespace-nowrap align-middle px-3">
                      <Checkbox
                        checked={selectedIds.size === misfits.length && misfits.length > 0}
                        onCheckedChange={toggleSelectAll}
                      />
                    </th>
                  )}
                  <th className="px-2 text-left align-middle text-[10px] font-medium text-zinc-500 uppercase tracking-wide whitespace-nowrap">Date</th>
                  <th className="px-2 text-left align-middle text-[10px] font-medium text-zinc-500 uppercase tracking-wide whitespace-nowrap">Reference ID</th>
                  <th className="px-2 text-left align-middle text-[10px] font-medium text-zinc-500 uppercase tracking-wide whitespace-nowrap">Ref Type</th>
                  <th className="px-2 text-left align-middle text-[10px] font-medium text-zinc-500 uppercase tracking-wide whitespace-nowrap">Amount</th>
                  <th className="px-2 text-left align-middle text-[10px] font-medium text-zinc-500 uppercase tracking-wide whitespace-nowrap">Fee Type</th>
                  <th className="px-2 text-left align-middle text-[10px] font-medium text-zinc-500 uppercase tracking-wide whitespace-nowrap">Detail</th>
                  <th className="px-2 text-left align-middle text-[10px] font-medium text-zinc-500 uppercase tracking-wide whitespace-nowrap">SB Ticket</th>
                  <th className="px-3 pr-4 lg:pr-6 text-left align-middle text-[10px] font-medium text-zinc-500 uppercase tracking-wide whitespace-nowrap border-l border-border/40">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <tr key={i} className="h-[45px] border-b border-border/30">
                      {Array.from({ length: canEdit ? 10 : 9 }).map((_, j) => (
                        <td key={j} className={cn("px-2 align-middle", j === 0 && "pl-4 lg:pl-6")}>
                          <div className="h-3 w-16 bg-muted/40 rounded animate-pulse" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : misfits.length === 0 ? (
                  <tr>
                    <td colSpan={canEdit ? 10 : 9} className="h-32 text-center align-middle text-muted-foreground">
                      {searchQuery || typeFilter || feeTypeFilter ? 'No misfits match your filters' : 'No misfits found — everything is attributed!'}
                    </td>
                  </tr>
                ) : (
                  misfits.map((tx) => (
                    <tr
                      key={tx.id}
                      className={cn(
                        "h-[45px] border-b border-border/50 dark:bg-[hsl(220,8%,8%)] dark:hover:bg-[hsl(220,8%,10%)] hover:bg-muted/30 transition-colors",
                        selectedIds.has(tx.transactionId) && "bg-blue-50/50 dark:bg-blue-950/20"
                      )}
                    >
                      {/* Brand badge */}
                      <td className="w-px whitespace-nowrap align-middle pl-4 lg:pl-6 pr-3">

                        {tx.clientId ? (
                          <ClientBadge clientId={tx.clientId} />
                        ) : canEdit ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                className="inline-flex items-center justify-center w-6 h-5 text-[10px] rounded bg-zinc-200/60 dark:bg-zinc-700/60 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-300/80 dark:hover:bg-zinc-600/80 transition-colors"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <PlusIcon className="h-3 w-3" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
                              <DropdownMenuLabel>Attribute to Brand</DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              {clients.filter(c => c.merchant_id).map(client => (
                                <DropdownMenuItem
                                  key={client.id}
                                  onClick={() => setConfirmAttribution({ transactionId: tx.transactionId, clientId: client.id, clientName: client.company_name })}
                                >
                                  {client.company_name}
                                </DropdownMenuItem>
                              ))}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => setConfirmAttribution({ transactionId: tx.transactionId, clientId: JETPACK_INTERNAL_ID, clientName: 'Jetpack (Parent)' })}
                              >
                                <span className="text-orange-600 dark:text-orange-400 font-medium">Jetpack (Parent)</span>
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </td>

                      {/* Checkbox */}
                      {canEdit && (
                        <td className="w-px whitespace-nowrap align-middle px-3">
                          <Checkbox
                            checked={selectedIds.has(tx.transactionId)}
                            onCheckedChange={() => toggleSelected(tx.transactionId)}
                          />
                        </td>
                      )}

                      {/* Date */}
                      <td className="px-2 align-middle text-muted-foreground whitespace-nowrap">
                        {formatDateFixed(tx.chargeDate)}
                      </td>

                      {/* Reference ID */}
                      <td className="px-2 align-middle text-muted-foreground whitespace-nowrap">
                        <div className="group/cell flex items-center gap-1.5">
                          <span className="font-mono text-muted-foreground">
                            {tx.referenceId && tx.referenceId !== '0' ? tx.referenceId : <span className="text-muted-foreground/30">—</span>}
                          </span>
                          {tx.referenceId && tx.referenceId !== '0' && (
                            <button
                              onClick={() => handleCopy(tx.referenceId!)}
                              className="flex-shrink-0 opacity-0 group-hover/cell:opacity-100 text-muted-foreground/50 hover:text-muted-foreground transition-all"
                            >
                              {copiedId === tx.referenceId ? (
                                <CheckIcon className="h-3 w-3 text-emerald-500" />
                              ) : (
                                <CopyIcon className="h-3 w-3" />
                              )}
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Reference Type */}
                      <td className="px-2 align-middle text-muted-foreground whitespace-nowrap">
                        {tx.referenceType && tx.referenceType !== 'Default' ? tx.referenceType : <span className="text-muted-foreground/30">—</span>}
                      </td>

                      {/* Amount */}
                      <td className="px-2 align-middle whitespace-nowrap font-mono tabular-nums">
                        <span className={tx.cost < 0 ? 'text-emerald-600 dark:text-emerald-500' : 'text-muted-foreground'}>
                          {formatCurrency(tx.cost)}
                        </span>
                      </td>

                      {/* Fee Type */}
                      <td className="px-2 align-middle text-muted-foreground whitespace-nowrap">
                        {tx.feeType}
                      </td>

                      {/* Detail — Credit Reason for credits, Comment icon for non-credits */}
                      <td className="px-2 align-middle text-muted-foreground whitespace-nowrap">
                        {tx.isPendingCredit && tx.careTicket ? (
                          <span className="text-[11px]">
                            {tx.careTicket.issueType || 'Unknown'}
                            {tx.careTicket.reshipmentId && <span className="text-muted-foreground/50"> · Reship</span>}
                          </span>
                        ) : tx.isPendingCredit && !tx.careTicketId ? (
                          <span className="text-amber-600 dark:text-amber-400 text-[11px]">No ticket</span>
                        ) : tx.creditReason ? (
                          tx.creditReason
                        ) : tx.comment ? (
                          <TooltipProvider delayDuration={200}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex items-center justify-center w-6 h-5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 cursor-default">
                                  <MessageSquareIcon className="h-3 w-3" />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs text-xs">
                                {tx.comment}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          <span className="text-muted-foreground/30">—</span>
                        )}
                      </td>

                      {/* SB Ticket */}
                      <td className="px-2 align-middle text-muted-foreground whitespace-nowrap font-mono">
                        {tx.sbTicketRef || <span className="text-muted-foreground/30">—</span>}
                      </td>

                      {/* Actions */}
                      <td className="px-3 pr-4 lg:pr-6 align-middle whitespace-nowrap border-l border-border/40">
                        {tx.isPendingCredit && canEdit ? (
                          <CreditClassifyActions
                            transactionId={tx.id}
                            cost={tx.cost}
                            careTicket={tx.careTicket}
                            onClassified={() => fetchMisfits()}
                          />
                        ) : tx.feeType === 'Credit' && tx.missingTicket && canEdit ? (() => {
                          const suggestion = suggestionMap.get(tx.transactionId)

                          // New Ticket popover (shared between both states)
                          const newTicketBtn = (
                            <Popover
                              open={newTicketPopoverId === tx.transactionId}
                              onOpenChange={(open) => {
                                if (open) {
                                  setNewTicketPopoverId(tx.transactionId)
                                  setNewTicketShipmentId(tx.referenceId && tx.referenceType === 'Shipment' ? tx.referenceId : '')
                                  setNewTicketDescription(tx.comment || '')
                                } else {
                                  setNewTicketPopoverId(null)
                                }
                              }}
                            >
                              <PopoverTrigger asChild>
                                <button
                                  onClick={(e) => e.stopPropagation()}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                                >
                                  <PlusIcon className="h-3.5 w-3.5" />
                                  New Ticket
                                </button>
                              </PopoverTrigger>
                              <PopoverContent className="w-72 p-3" align="start" onClick={(e) => e.stopPropagation()}>
                                <div className="space-y-3">
                                  <div className="text-[10px] font-medium text-zinc-500 uppercase tracking-wide">
                                    New Ticket from Credit
                                  </div>
                                  <div className="flex items-center justify-between text-[13px]">
                                    <span className="text-muted-foreground">Amount</span>
                                    <span className="font-mono tabular-nums text-emerald-600 dark:text-emerald-500">
                                      {formatCurrency(Math.abs(tx.cost))}
                                    </span>
                                  </div>
                                  {tx.clientName && (
                                    <div className="flex items-center justify-between text-[13px]">
                                      <span className="text-muted-foreground">Brand</span>
                                      <span>{tx.clientName}</span>
                                    </div>
                                  )}
                                  <div className="space-y-1.5">
                                    <Input
                                      value={newTicketShipmentId}
                                      onChange={(e) => setNewTicketShipmentId(e.target.value)}
                                      placeholder="Shipment ID (optional)"
                                      className="h-8 text-[13px] font-mono"
                                    />
                                    <Input
                                      value={newTicketDescription}
                                      onChange={(e) => setNewTicketDescription(e.target.value)}
                                      placeholder="Description (optional)"
                                      className="h-8 text-[13px]"
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleCreateTicket(tx.transactionId)
                                      }}
                                    />
                                  </div>
                                  <Button
                                    size="sm"
                                    className="w-full h-8 text-xs"
                                    onClick={() => handleCreateTicket(tx.transactionId)}
                                    disabled={isConnecting}
                                  >
                                    {isConnecting ? 'Creating...' : 'Create Ticket'}
                                  </Button>
                                </div>
                              </PopoverContent>
                            </Popover>
                          )

                          return (
                            <div className="flex items-center gap-1.5">
                              {suggestion ? (
                                // Suggested match — single popover with review/search modes
                                <Popover
                                  open={reviewPopoverId === tx.transactionId}
                                  onOpenChange={(open) => {
                                    if (open) {
                                      setReviewPopoverId(tx.transactionId)
                                      setTicketPopoverId(null) // Reset to review mode
                                    } else {
                                      setReviewPopoverId(null)
                                      setTicketPopoverId(null)
                                    }
                                  }}
                                >
                                  <PopoverTrigger asChild>
                                    <button
                                      onClick={(e) => e.stopPropagation()}
                                      className={cn(
                                        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors",
                                        suggestion.confidence === 'exact'
                                          ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-950/50"
                                          : "bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-950/40"
                                      )}
                                    >
                                      Match #{suggestion.ticket.ticketNumber}
                                      {suggestion.confidence === 'probable' && (
                                        <span className="text-[9px]">?</span>
                                      )}
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent
                                    className={cn(ticketPopoverId === tx.transactionId ? "w-[380px] p-0" : "w-80 p-0")}
                                    align="start"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {ticketPopoverId === tx.transactionId ? (
                                      // Search mode — user clicked "Search Other"
                                      <TicketSearchCommand
                                        onSelect={(ticketId, ticketNumber) => {
                                          handleConnectTicket(tx.transactionId, ticketId, ticketNumber)
                                          setReviewPopoverId(null)
                                          setTicketPopoverId(null)
                                        }}
                                        clientId={tx.clientId}
                                        creditAmount={Math.abs(tx.cost)}
                                      />
                                    ) : (
                                      // Review mode — show ticket details
                                      <div className="p-3 space-y-3">
                                        <div className="text-[10px] font-medium text-zinc-500 uppercase tracking-wide">
                                          Review Suggested Match
                                        </div>
                                        <div className="space-y-1.5 text-[13px]">
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">Ticket</span>
                                            <span className="font-mono font-medium">#{suggestion.ticket.ticketNumber}</span>
                                          </div>
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">Created</span>
                                            <span>{formatDateFixed(suggestion.ticket.createdAt)}</span>
                                          </div>
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">Type</span>
                                            <span>{suggestion.ticket.ticketType}</span>
                                          </div>
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">Status</span>
                                            <span>{suggestion.ticket.status}</span>
                                          </div>
                                          {suggestion.ticket.clientName && (
                                            <div className="flex justify-between">
                                              <span className="text-muted-foreground">Brand</span>
                                              <span>{suggestion.ticket.clientName}</span>
                                            </div>
                                          )}
                                          <div className="flex justify-between">
                                            <span className="text-muted-foreground">Credit</span>
                                            <span className="font-mono tabular-nums">{formatCurrency(suggestion.ticket.creditAmount)}</span>
                                          </div>
                                          {suggestion.ticket.shipmentId && (
                                            <div className="flex justify-between">
                                              <span className="text-muted-foreground">Shipment</span>
                                              <span className="font-mono">{suggestion.ticket.shipmentId}</span>
                                            </div>
                                          )}
                                        </div>
                                        <div className="text-[11px] text-muted-foreground/80 italic">
                                          {suggestion.reason}
                                        </div>
                                        <div className="flex gap-2 pt-1">
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            className="flex-1 h-8 text-xs"
                                            onClick={() => setTicketPopoverId(tx.transactionId)}
                                          >
                                            Search Other
                                          </Button>
                                          <Button
                                            size="sm"
                                            className="flex-1 h-8 text-xs"
                                            onClick={() => {
                                              handleConnectTicket(tx.transactionId, suggestion.ticket.id, suggestion.ticket.ticketNumber)
                                              setReviewPopoverId(null)
                                            }}
                                            disabled={isConnecting}
                                          >
                                            {isConnecting ? 'Linking...' : 'Link Ticket'}
                                          </Button>
                                        </div>
                                      </div>
                                    )}
                                  </PopoverContent>
                                </Popover>
                              ) : (
                                // No suggestion — manual search
                                <Popover
                                  open={ticketPopoverId === tx.transactionId}
                                  onOpenChange={(open) => {
                                    if (open) setTicketPopoverId(tx.transactionId)
                                    else setTicketPopoverId(null)
                                  }}
                                >
                                  <PopoverTrigger asChild>
                                    <button
                                      onClick={(e) => e.stopPropagation()}
                                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-950/50 transition-colors"
                                    >
                                      <SearchIcon className="h-3.5 w-3.5" />
                                      Find Ticket
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-[380px] p-0" align="start" onClick={(e) => e.stopPropagation()}>
                                    <TicketSearchCommand
                                      onSelect={(ticketId, ticketNumber) => handleConnectTicket(tx.transactionId, ticketId, ticketNumber)}
                                      clientId={tx.clientId}
                                      creditAmount={Math.abs(tx.cost)}
                                    />
                                  </PopoverContent>
                                </Popover>
                              )}

                              <div className="h-4 w-px bg-border/40" />

                              {newTicketBtn}
                            </div>
                          )
                        })() : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            {/* Pagination */}
            <div className="flex-shrink-0 sticky bottom-0 bg-background -mx-4 px-4 lg:-mx-6 lg:px-6 py-3 flex items-center justify-between border-t border-border/40">
              <div className="flex items-center gap-4">
                <span className="text-sm text-muted-foreground">
                  {totalCount.toLocaleString()} misfit{totalCount !== 1 ? 's' : ''}
                </span>
                <div className="hidden items-center gap-2 lg:flex">
                  <span className="text-sm text-muted-foreground">Rows</span>
                  <Select
                    value={`${misfitsPrefs.pageSize}`}
                    onValueChange={(value) => {
                      misfitsPrefs.setPageSize(Number(value))
                      setCurrentPage(1)
                    }}
                  >
                    <SelectTrigger className="h-7 w-[70px]">
                      <SelectValue placeholder={misfitsPrefs.pageSize} />
                    </SelectTrigger>
                    <SelectContent side="top">
                      {[30, 50, 100, 200].map((pageSize) => (
                        <SelectItem key={pageSize} value={`${pageSize}`}>
                          {pageSize}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  Page {currentPage} of {totalPages || 1}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    className="hidden h-7 w-7 lg:flex"
                    onClick={() => setCurrentPage(1)}
                    disabled={currentPage === 1}
                  >
                    <span className="sr-only">Go to first page</span>
                    <ChevronsLeftIcon />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setCurrentPage(currentPage - 1)}
                    disabled={currentPage === 1}
                  >
                    <span className="sr-only">Go to previous page</span>
                    <ChevronLeftIcon />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setCurrentPage(currentPage + 1)}
                    disabled={currentPage >= totalPages}
                  >
                    <span className="sr-only">Go to next page</span>
                    <ChevronRightIcon />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="hidden h-7 w-7 lg:flex"
                    onClick={() => setCurrentPage(totalPages)}
                    disabled={currentPage >= totalPages}
                  >
                    <span className="sr-only">Go to last page</span>
                    <ChevronsRightIcon />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Brand Attribution Confirmation Dialog */}
      <AlertDialog open={!!confirmAttribution} onOpenChange={(open) => { if (!open) setConfirmAttribution(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Attribute Transaction</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to attribute this transaction to <strong>{confirmAttribution?.clientName}</strong>?
              {confirmAttribution?.clientId === JETPACK_INTERNAL_ID &&
                " This will mark it as a parent-level transaction — a cost Jetpack absorbed."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isAttributing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isAttributing}
              onClick={() => {
                if (confirmAttribution) {
                  handleAttributeBrand(confirmAttribution.transactionId, confirmAttribution.clientId, confirmAttribution.clientName)
                }
              }}
            >
              {isAttributing ? 'Attributing...' : 'Attribute'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
