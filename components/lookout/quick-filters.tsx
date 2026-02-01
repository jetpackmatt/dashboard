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
import { ChevronDownIcon } from "lucide-react"

// Quick filter values
export type QuickFilterValue =
  | 'at_risk'
  | 'eligible'
  | 'claim_filed'
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
interface LookoutStats {
  atRisk: number
  eligible: number
  claimFiled: number
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
  stats: LookoutStats
}

// Primary filter buttons (claim lifecycle)
const PRIMARY_FILTERS: { value: QuickFilterValue; label: string; color: string }[] = [
  { value: 'at_risk', label: 'At Risk', color: 'bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-200/50' },
  { value: 'eligible', label: 'Ready to File', color: 'bg-red-100 text-red-700 border-red-200 hover:bg-red-200/50' },
  { value: 'claim_filed', label: 'Claim Filed', color: 'bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-200/50' },
  { value: 'all', label: 'All Active', color: 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200/50' },
  { value: 'archived', label: 'Archived', color: 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200/50' },
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

export function QuickFilters({ value, onChange, stats }: QuickFiltersProps) {
  // Get count for a filter value
  const getCount = (filterValue: QuickFilterValue): number => {
    switch (filterValue) {
      case 'at_risk': return stats.atRisk
      case 'eligible': return stats.eligible
      case 'claim_filed': return stats.claimFiled
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

  // Check if an AI filter is active
  const isAiFilterActive = AI_FILTERS.some(f => f.value === value)
  const activeAiFilter = AI_FILTERS.find(f => f.value === value)

  return (
    <div className="flex items-center gap-3">
      {/* Primary filter buttons - segmented control style */}
      <div className="inline-flex rounded-lg bg-gray-100 p-0.5">
        {PRIMARY_FILTERS.map((filter) => {
          const count = getCount(filter.value)
          const isActive = value === filter.value

          return (
            <button
              key={filter.value}
              onClick={() => onChange(filter.value)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all",
                "focus:outline-none focus-visible:outline-none",
                isActive
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-600 hover:text-gray-900"
              )}
            >
              {filter.label}
              <span
                className={cn(
                  "inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded text-[10px] font-medium tabular-nums",
                  isActive ? "bg-gray-100 text-gray-700" : "bg-gray-200/60 text-gray-500"
                )}
              >
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* AI-driven filters dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "h-8 px-3 gap-1.5",
              isAiFilterActive && "bg-indigo-100 text-indigo-700 border-indigo-200 ring-1 ring-offset-1"
            )}
          >
            {isAiFilterActive ? activeAiFilter?.label : "AI Filters"}
            <ChevronDownIcon className="h-4 w-4 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            AI-Driven Filters
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {AI_FILTERS.map((filter) => {
            const count = getCount(filter.value)
            return (
              <DropdownMenuCheckboxItem
                key={filter.value}
                checked={value === filter.value}
                onCheckedChange={(checked) => {
                  if (checked) {
                    onChange(filter.value)
                  } else {
                    onChange('at_risk') // Reset to default
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
    </div>
  )
}
