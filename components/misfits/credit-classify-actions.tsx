"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { toast } from "sonner"

interface CreditClassifyActionsProps {
  transactionId: string
  cost: number // raw cost (negative)
  careTicket?: {
    issueType: string | null
    compensationRequest: string | null
    reshipmentStatus: string | null
    reshipmentId: string | null
    ticketNumber: number
  } | null
  onClassified: () => void
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount)
}

export function CreditClassifyActions({
  transactionId,
  cost,
  careTicket,
  onClassified,
}: CreditClassifyActionsProps) {
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [portionOpen, setPortionOpen] = React.useState(false)
  const [portionValue, setPortionValue] = React.useState("")
  const absCost = Math.abs(cost)

  const classify = async (action: "no_markup" | "markup_all" | "set_portion", shippingPortion?: number) => {
    setIsSubmitting(true)
    try {
      const response = await fetch("/api/data/misfits/classify-credit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionId, action, shippingPortion }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Failed to classify credit")
      }

      const data = await response.json()
      toast.success(
        action === "no_markup"
          ? "Credit classified as item-only (no markup)"
          : action === "markup_all"
          ? `Credit marked up to ${formatCurrency(Math.abs(data.billedAmount))}`
          : `Shipping portion set — billed ${formatCurrency(Math.abs(data.billedAmount))}`
      )
      setPortionOpen(false)
      onClassified()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to classify credit")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex items-center gap-1">
      {/* No Markup */}
      <button
        onClick={() => classify("no_markup")}
        disabled={isSubmitting}
        className="px-2 py-0.5 rounded text-[10px] font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50"
      >
        No Markup
      </button>

      {/* Markup All */}
      <button
        onClick={() => classify("markup_all")}
        disabled={isSubmitting}
        className="px-2 py-0.5 rounded text-[10px] font-medium bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-950/50 transition-colors disabled:opacity-50"
      >
        Markup All
      </button>

      {/* Set Shipping Portion */}
      <Popover open={portionOpen} onOpenChange={setPortionOpen}>
        <PopoverTrigger asChild>
          <button
            disabled={isSubmitting}
            className="px-2 py-0.5 rounded text-[10px] font-medium bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-950/40 transition-colors disabled:opacity-50"
          >
            Set Portion
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3" align="start" onClick={(e) => e.stopPropagation()}>
          <div className="space-y-3">
            <div className="text-[10px] font-medium text-zinc-500 uppercase tracking-wide">
              Set Shipping Portion
            </div>
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-muted-foreground">Total credit</span>
              <span className="font-mono tabular-nums">{formatCurrency(absCost)}</span>
            </div>
            {careTicket && (
              <div className="space-y-1 text-[11px] text-muted-foreground border-t pt-2">
                {careTicket.issueType && (
                  <div>Issue: <span className="text-foreground">{careTicket.issueType}</span></div>
                )}
                {careTicket.compensationRequest && (
                  <div>Compensation: <span className="text-foreground">{careTicket.compensationRequest}</span></div>
                )}
                {careTicket.reshipmentId && (
                  <div>Reshipment: <span className="text-foreground font-mono">{careTicket.reshipmentId}</span></div>
                )}
              </div>
            )}
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Shipping portion ($)</label>
              <Input
                type="number"
                step="0.01"
                min="0"
                max={absCost}
                value={portionValue}
                onChange={(e) => setPortionValue(e.target.value)}
                placeholder="e.g., 3.95"
                className="h-8 text-[13px] font-mono"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const val = parseFloat(portionValue)
                    if (!isNaN(val) && val >= 0 && val <= absCost) {
                      classify("set_portion", val)
                    }
                  }
                }}
              />
            </div>
            {portionValue && !isNaN(parseFloat(portionValue)) && (
              <div className="text-[11px] text-muted-foreground border-t pt-2">
                <div className="flex justify-between">
                  <span>Shipping (marked up)</span>
                  <span className="font-mono">{formatCurrency(parseFloat(portionValue))}</span>
                </div>
                <div className="flex justify-between">
                  <span>Item (no markup)</span>
                  <span className="font-mono">{formatCurrency(absCost - parseFloat(portionValue))}</span>
                </div>
              </div>
            )}
            <Button
              size="sm"
              className="w-full h-7 text-xs"
              onClick={() => {
                const val = parseFloat(portionValue)
                if (isNaN(val) || val < 0 || val > absCost) {
                  toast.error("Enter a valid amount between $0 and " + formatCurrency(absCost))
                  return
                }
                classify("set_portion", val)
              }}
              disabled={isSubmitting || !portionValue}
            >
              {isSubmitting ? "Applying..." : "Apply"}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
