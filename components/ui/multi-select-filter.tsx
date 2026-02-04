"use client"

import * as React from "react"
import { CheckIcon, ChevronDownIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export interface FilterOption {
  value: string
  label: string
}

interface MultiSelectFilterProps {
  options: FilterOption[]
  selected: string[]
  onSelectionChange: (selected: string[]) => void
  placeholder: string
  className?: string
}

export function MultiSelectFilter({
  options,
  selected,
  onSelectionChange,
  placeholder,
  className,
}: MultiSelectFilterProps) {
  const [open, setOpen] = React.useState(false)

  const handleToggle = (value: string) => {
    if (selected.includes(value)) {
      onSelectionChange(selected.filter((v) => v !== value))
    } else {
      onSelectionChange([...selected, value])
    }
  }

  const handleSelectAll = () => {
    if (selected.length === options.length) {
      onSelectionChange([])
    } else {
      onSelectionChange(options.map((o) => o.value))
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "h-[30px] justify-between text-sm font-normal text-muted-foreground whitespace-nowrap",
            selected.length > 0 && "text-foreground",
            className
          )}
        >
          <span>{placeholder}</span>
          {selected.length > 0 && (
            <span className="ml-1.5 inline-flex items-center justify-center h-5 min-w-[20px] px-1.5 text-xs font-medium rounded-full bg-primary/15 text-primary">
              {selected.length}
            </span>
          )}
          <ChevronDownIcon className="ml-1.5 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[200px] p-0"
        align="start"
        onInteractOutside={() => setOpen(false)}
      >
        <div className="p-1">
          {/* Select All option */}
          <button
            onClick={handleSelectAll}
            className={cn(
              "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
            )}
          >
            <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
              {selected.length === options.length && <CheckIcon className="h-4 w-4" />}
            </span>
            <span className="font-medium">
              {selected.length === options.length ? "Deselect All" : "Select All"}
            </span>
          </button>

          <div className="-mx-1 my-1 h-px bg-muted" />

          {/* Individual options */}
          {options.map((option) => {
            const isSelected = selected.includes(option.value)
            return (
              <button
                key={option.value}
                onClick={() => handleToggle(option.value)}
                className={cn(
                  "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                )}
              >
                <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                  {isSelected && <CheckIcon className="h-4 w-4" />}
                </span>
                <span>{option.label}</span>
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
