"use client"

import * as React from "react"
import { format } from "date-fns"
import { CalendarIcon } from "lucide-react"
import { DateRange } from "react-day-picker"

import { cn } from "@/lib/utils"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

interface InlineDateRangePickerProps {
  dateRange: DateRange | undefined
  onDateRangeChange: (range: DateRange | undefined) => void
  className?: string
  disabled?: boolean
  autoOpen?: boolean
}

export function InlineDateRangePicker({
  dateRange,
  onDateRangeChange,
  className,
  disabled = false,
  autoOpen = false,
}: InlineDateRangePickerProps) {
  const [open, setOpen] = React.useState(false)

  // Auto-open on mount when autoOpen is true
  React.useEffect(() => {
    if (autoOpen) {
      const timer = setTimeout(() => setOpen(true), 100)
      return () => clearTimeout(timer)
    }
  }, [autoOpen])
  // Track if user is in the middle of selecting a new range
  const [isSelectingNewRange, setIsSelectingNewRange] = React.useState(false)
  // Store the range when popover opens to detect new selections
  const rangeOnOpenRef = React.useRef<DateRange | undefined>(undefined)

  const formatDate = (date: Date | undefined) => {
    if (!date) return ""
    return format(date, "MMM d, yyyy")
  }

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen)
    if (newOpen) {
      // Store the current range when opening
      rangeOnOpenRef.current = dateRange
      setIsSelectingNewRange(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange} modal={true}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          className={cn(
            "h-[30px] flex items-center gap-1 px-2 rounded-md border border-input bg-background text-xs",
            "hover:bg-accent hover:text-accent-foreground transition-colors",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            disabled && "opacity-50 cursor-not-allowed",
            className
          )}
        >
          {/* Start date input */}
          <div className="flex items-center gap-1.5">
            <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
            <span className={cn(
              "min-w-[85px] text-left",
              !dateRange?.from && "text-muted-foreground"
            )}>
              {dateRange?.from ? formatDate(dateRange.from) : "Start date"}
            </span>
          </div>

          {/* Separator */}
          <span className="text-muted-foreground mx-1">–</span>

          {/* End date input */}
          <div className="flex items-center">
            <span className={cn(
              "min-w-[85px] text-left",
              !dateRange?.to && "text-muted-foreground"
            )}>
              {dateRange?.to ? formatDate(dateRange.to) : "End date"}
            </span>
          </div>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          defaultMonth={dateRange?.from}
          selected={dateRange}
          onSelect={(range) => {
            onDateRangeChange(range)

            // Detect if this is the start of a new selection
            // (user clicked a date different from the original range)
            const originalFrom = rangeOnOpenRef.current?.from?.getTime()
            const originalTo = rangeOnOpenRef.current?.to?.getTime()
            const newFrom = range?.from?.getTime()
            const newTo = range?.to?.getTime()

            if (!isSelectingNewRange) {
              // First click - check if it's different from original
              if (newFrom !== originalFrom || !range?.to) {
                setIsSelectingNewRange(true)
                return // Don't close, wait for second click
              }
            }

            // Close when both dates are selected AND we've completed a new selection
            if (range?.from && range?.to && isSelectingNewRange) {
              setOpen(false)
              setIsSelectingNewRange(false)
            }
          }}
          numberOfMonths={2}
          className="p-3"
        />
      </PopoverContent>
    </Popover>
  )
}
