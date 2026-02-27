"use client"

import * as React from "react"
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, MinusIcon, SearchIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import type { DestinationOption } from "@/lib/destination-data"
import { getStateLabel } from "@/lib/destination-data"

interface DestinationFilterProps {
  options: DestinationOption[]
  selected: string[]
  onSelectionChange: (selected: string[]) => void
  placeholder?: string
  className?: string
}

export function DestinationFilter({
  options,
  selected,
  onSelectionChange,
  placeholder = "Destination",
  className,
}: DestinationFilterProps) {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState("")
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set())

  // Reset search when popover closes
  React.useEffect(() => {
    if (!open) setSearch("")
  }, [open])

  const searchLower = search.toLowerCase()

  // Filter options based on search
  const filteredOptions = React.useMemo(() => {
    if (!search) return options

    return options
      .map(opt => {
        const countryMatches = opt.countryName.toLowerCase().includes(searchLower)
        const matchingStates = opt.states?.filter(s =>
          s.name.toLowerCase().includes(searchLower) ||
          s.code.toLowerCase().includes(searchLower)
        )

        if (countryMatches) return opt // Country matches — show all states
        if (matchingStates?.length) {
          return { ...opt, states: matchingStates } // Only matching states
        }
        return null
      })
      .filter(Boolean) as DestinationOption[]
  }, [options, search, searchLower])

  // Auto-expand countries when searching
  React.useEffect(() => {
    if (search) {
      const toExpand = new Set<string>()
      for (const opt of filteredOptions) {
        if (opt.states?.length) toExpand.add(opt.countryCode)
      }
      setExpanded(toExpand)
    }
  }, [search, filteredOptions])

  // Helpers: check selection state for a country
  const getCountryState = (country: DestinationOption): 'checked' | 'indeterminate' | 'unchecked' => {
    // Country-level selection
    if (selected.includes(country.countryCode)) return 'checked'

    if (!country.states?.length) return 'unchecked'

    // Check if any states are selected
    const selectedStates = country.states.filter(s =>
      selected.includes(`${country.countryCode}:${s.code}`)
    )
    if (selectedStates.length === 0) return 'unchecked'
    if (selectedStates.length === country.states.length) return 'checked'
    return 'indeterminate'
  }

  const isStateSelected = (countryCode: string, stateCode: string): boolean => {
    return selected.includes(`${countryCode}:${stateCode}`) || selected.includes(countryCode)
  }

  // Toggle a country (country-level)
  const toggleCountry = (country: DestinationOption) => {
    const state = getCountryState(country)
    const countryCode = country.countryCode

    // Remove all entries for this country first
    let next = selected.filter(s => s !== countryCode && !s.startsWith(`${countryCode}:`))

    if (state === 'unchecked') {
      // Select at country level
      next.push(countryCode)
    }
    // checked or indeterminate → deselect all

    onSelectionChange(next)
  }

  // Toggle a single state
  const toggleState = (countryCode: string, stateCode: string, country: DestinationOption) => {
    const entry = `${countryCode}:${stateCode}`
    let next = [...selected]

    // If country-level is selected, expand to individual states minus this one
    if (next.includes(countryCode)) {
      next = next.filter(s => s !== countryCode)
      if (country.states) {
        for (const s of country.states) {
          if (s.code !== stateCode) {
            next.push(`${countryCode}:${s.code}`)
          }
        }
      }
    } else if (next.includes(entry)) {
      // Deselect this state
      next = next.filter(s => s !== entry)
    } else {
      // Select this state
      next.push(entry)

      // If all states now selected, collapse to country-level
      if (country.states) {
        const allSelected = country.states.every(s =>
          s.code === stateCode || next.includes(`${countryCode}:${s.code}`)
        )
        if (allSelected) {
          next = next.filter(s => !s.startsWith(`${countryCode}:`))
          next.push(countryCode)
        }
      }
    }

    onSelectionChange(next)
  }

  // Toggle expand/collapse
  const toggleExpand = (countryCode: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(countryCode)) next.delete(countryCode)
      else next.add(countryCode)
      return next
    })
  }

  // Select all / deselect all
  const handleSelectAll = () => {
    if (selected.length > 0) {
      onSelectionChange([])
    } else {
      onSelectionChange(options.map(o => o.countryCode))
    }
  }

  // Count total selections for badge
  const selectionCount = selected.length

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "h-[30px] justify-between text-xs font-normal text-foreground whitespace-nowrap",
            className
          )}
        >
          <span>{placeholder}</span>
          {selectionCount > 0 && (
            <span className="ml-1.5 inline-flex items-center justify-center h-5 min-w-[20px] px-1.5 text-xs font-medium rounded-full bg-primary/15 text-primary">
              {selectionCount}
            </span>
          )}
          <ChevronDownIcon className="ml-1.5 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[260px] p-0 font-roboto text-xs"
        align="start"
        onInteractOutside={() => setOpen(false)}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 px-3 py-2 border-b">
          <SearchIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search countries or states..."
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            autoFocus
          />
        </div>

        <div className="p-1 max-h-[350px] overflow-y-auto">
          {/* Select All */}
          <button
            onClick={handleSelectAll}
            className="relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-xs outline-none transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
              {selected.length > 0 && options.length > 0 && <CheckIcon className="h-4 w-4" />}
            </span>
            <span className="font-medium">
              {selected.length > 0 ? "Deselect All" : "Select All"}
            </span>
          </button>

          <div className="-mx-1 my-1 h-px bg-muted" />

          {/* Country list */}
          {filteredOptions.map((country) => {
            const countryState = getCountryState(country)
            const hasStates = country.states && country.states.length > 0
            const isExpanded = expanded.has(country.countryCode)

            return (
              <div key={country.countryCode}>
                {/* Country row */}
                <button
                  onClick={() => toggleCountry(country)}
                  className="relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-xs outline-none transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  {/* Checkbox area */}
                  <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                    {countryState === 'checked' && <CheckIcon className="h-4 w-4" />}
                    {countryState === 'indeterminate' && <MinusIcon className="h-3.5 w-3.5" />}
                  </span>
                  <span className="flex-1 text-left">{country.countryName}</span>
                  {/* Expand chevron */}
                  {hasStates && (
                    <span
                      onClick={(e) => toggleExpand(country.countryCode, e)}
                      className="p-0.5 rounded hover:bg-muted-foreground/10"
                    >
                      {isExpanded
                        ? <ChevronDownIcon className="h-3.5 w-3.5 text-muted-foreground" />
                        : <ChevronRightIcon className="h-3.5 w-3.5 text-muted-foreground" />
                      }
                    </span>
                  )}
                </button>

                {/* State list (expanded) */}
                {hasStates && isExpanded && country.states!.map((state) => {
                  const stateChecked = isStateSelected(country.countryCode, state.code)
                  return (
                    <button
                      key={`${country.countryCode}:${state.code}`}
                      onClick={() => toggleState(country.countryCode, state.code, country)}
                      className="relative flex w-full cursor-default select-none items-center rounded-sm py-1 pl-12 pr-2 text-xs outline-none transition-colors hover:bg-accent hover:text-accent-foreground text-muted-foreground"
                    >
                      <span className="absolute left-6 flex h-3.5 w-3.5 items-center justify-center">
                        {stateChecked && <CheckIcon className="h-3.5 w-3.5" />}
                      </span>
                      <span>{getStateLabel(country.countryCode, state)}</span>
                    </button>
                  )
                })}
              </div>
            )
          })}

          {filteredOptions.length === 0 && (
            <div className="py-4 text-center text-muted-foreground text-xs">
              No destinations found
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
