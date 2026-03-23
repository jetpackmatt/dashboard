"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu"
import { ChevronDownIcon, SparklesIcon } from "lucide-react"

// Quick filter values
export type QuickFilterValue =
  | 'at_risk'
  | 'eligible'
  | 'claim_filed'
  | 'returned_to_sender'
  | 'all'
  | 'archived'
  // AI-driven filters
  | 'reship_now'
  | 'consider_reship'
  | 'customer_anxious'
  | 'stuck'
  | 'returning'
  | 'lost'

// Stats interface for counts
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

interface QuickFiltersProps {
  value: QuickFilterValue
  onChange: (value: QuickFilterValue) => void
  stats: DeliveryIQStats
}

// Primary filter buttons (claim lifecycle)
const PRIMARY_FILTERS: { value: QuickFilterValue; label: string; activeColor: string }[] = [
  { value: 'at_risk', label: 'On Watch', activeColor: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200' },
  { value: 'eligible', label: 'Time to File', activeColor: 'bg-red-50 text-red-800 ring-1 ring-red-200' },
  { value: 'claim_filed', label: 'Claim Filed', activeColor: 'bg-blue-50 text-blue-800 ring-1 ring-blue-200' },
  { value: 'returned_to_sender', label: 'Returned', activeColor: 'bg-purple-50 text-purple-800 ring-1 ring-purple-200' },
  { value: 'all', label: 'All', activeColor: 'bg-background text-foreground shadow-sm' },
  { value: 'archived', label: 'Archived', activeColor: 'bg-background text-foreground shadow-sm' },
]

// AI-driven filter options (in dropdown)
const AI_FILTERS: { value: QuickFilterValue; label: string; color: string }[] = [
  { value: 'reship_now', label: 'Reship Now', color: 'text-red-600' },
  { value: 'consider_reship', label: 'Consider Reship', color: 'text-orange-600' },
  { value: 'customer_anxious', label: 'Customer Anxious', color: 'text-purple-600' },
  { value: 'stuck', label: 'Stuck', color: 'text-orange-600' },
  { value: 'returning', label: 'Returning', color: 'text-purple-600' },
  { value: 'lost', label: 'Lost', color: 'text-red-600' },
]

// Helper to get count for a filter value
function getCount(filterValue: QuickFilterValue, stats: DeliveryIQStats): number {
  switch (filterValue) {
    case 'at_risk': return stats.atRisk
    case 'eligible': return stats.eligible
    case 'claim_filed': return stats.claimFiled
    case 'returned_to_sender': return stats.returnedToSender
    case 'all': return stats.total
    case 'archived': return stats.archived
    case 'reship_now': return stats.reshipNow
    case 'consider_reship': return stats.considerReship
    case 'customer_anxious': return stats.customerAnxious
    case 'stuck': return stats.stuck
    case 'returning': return stats.returning
    case 'lost': return stats.lost
    default: return 0
  }
}

export function QuickFilters({ value, onChange, stats }: QuickFiltersProps) {
  return (
    <div className="inline-flex items-center rounded-lg border border-border/60 bg-muted/40 p-0.5 flex-nowrap">
      {PRIMARY_FILTERS.map((filter) => {
        const count = getCount(filter.value, stats)
        const isActive = value === filter.value

        return (
          <button
            key={filter.value}
            onClick={() => onChange(filter.value)}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-all whitespace-nowrap",
              "focus:outline-none focus-visible:outline-none",
              isActive
                ? filter.activeColor
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
            )}
          >
            {filter.label}
            <span
              className={cn(
                "inline-flex items-center justify-center min-w-[16px] h-[16px] px-0.5 rounded text-[10px] font-medium tabular-nums leading-none",
                isActive ? "opacity-70" : "text-muted-foreground/60"
              )}
            >
              {count}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// Separate AI filter dropdown — placed next to date picker
export function AiFilterDropdown({ value, onChange, stats }: QuickFiltersProps) {
  const isAiFilterActive = AI_FILTERS.some(f => f.value === value)
  const activeAiFilter = AI_FILTERS.find(f => f.value === value)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-[30px] px-2.5 gap-1 text-xs whitespace-nowrap",
            isAiFilterActive
              ? "bg-indigo-50 text-indigo-700 border-indigo-200"
              : "text-muted-foreground"
          )}
        >
          <SparklesIcon className="h-3 w-3" />
          {isAiFilterActive ? activeAiFilter?.label : "AI"}
          <ChevronDownIcon className="h-3 w-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          AI-Driven Filters
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {AI_FILTERS.map((filter) => {
          const count = getCount(filter.value, stats)
          return (
            <DropdownMenuCheckboxItem
              key={filter.value}
              checked={value === filter.value}
              onCheckedChange={(checked) => {
                if (checked) {
                  onChange(filter.value)
                } else {
                  onChange('at_risk')
                }
              }}
              className="justify-between"
            >
              <span className={filter.color}>{filter.label}</span>
              <Badge variant="secondary" className="h-4 min-w-4 px-1 text-[10px] font-medium tabular-nums">
                {count}
              </Badge>
            </DropdownMenuCheckboxItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
