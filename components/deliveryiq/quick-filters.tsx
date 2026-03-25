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
  | 'needs_action'
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
}

interface QuickFiltersProps {
  value: QuickFilterValue
  onChange: (value: QuickFilterValue) => void
  stats: DeliveryIQStats
  autoFileEnabled?: boolean
}

// Primary filter buttons (claim lifecycle)
// Colors match statusData in deliveryiq/page.tsx — these double as the waffle chart legend
const PRIMARY_FILTERS: { value: QuickFilterValue; label: string; color?: string }[] = [
  { value: 'at_risk', label: 'On Watch', color: 'hsl(35, 92%, 50%)' },
  { value: 'needs_action', label: 'Needs Action', color: 'hsl(24, 95%, 53%)' },
  { value: 'eligible', label: 'Ready to File', color: 'hsl(0, 72%, 51%)' },
  { value: 'claim_filed', label: 'Claim Filed', color: 'hsl(152, 55%, 45%)' },
  { value: 'returned_to_sender', label: 'Returned', color: 'hsl(215, 65%, 55%)' },
  { value: 'all', label: 'All' },
  { value: 'archived', label: 'Archived' },
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
    case 'needs_action': return stats.needsAction
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

export function QuickFilters({ value, onChange, stats, autoFileEnabled }: QuickFiltersProps) {
  const filters = autoFileEnabled
    ? PRIMARY_FILTERS.filter(f => f.value !== 'eligible')
    : PRIMARY_FILTERS

  return (
    <div className="flex items-stretch -mb-px">
      {filters.map((filter) => {
        const count = getCount(filter.value, stats)
        const isActive = value === filter.value

        return (
          <button
            key={filter.value}
            onClick={() => onChange(filter.value)}
            className={cn(
              "inline-flex items-center gap-1.5 px-4 py-3 text-[13px] font-medium transition-colors whitespace-nowrap border-b-2",
              "focus:outline-none focus-visible:outline-none",
              isActive
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
            )}
          >
            {filter.color && (
              <span
                className="w-[9px] h-[9px] rounded-[2px] shrink-0"
                style={{ backgroundColor: filter.color }}
              />
            )}
            {filter.label}
            <span
              className={cn(
                "tabular-nums text-[11px] leading-[13px]",
                isActive ? "text-foreground/60" : "text-muted-foreground/50"
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
