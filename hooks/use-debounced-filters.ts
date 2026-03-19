"use client"

import * as React from "react"
import { DateRange } from "react-day-picker"

// Debounce delay for filter changes (ms)
const FILTER_DEBOUNCE_MS = 400

/**
 * Hook to debounce multiple filter values together
 * UI updates immediately, but debounced values only update after user stops changing filters
 */
export function useDebouncedFilters<T extends Record<string, unknown>>(
  filters: T,
  delay: number = FILTER_DEBOUNCE_MS
): T {
  const [debouncedFilters, setDebouncedFilters] = React.useState(filters)
  const timeoutRef = React.useRef<NodeJS.Timeout | null>(null)

  React.useEffect(() => {
    // Clear any pending timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    // Set new timeout
    timeoutRef.current = setTimeout(() => {
      setDebouncedFilters(filters)
    }, delay)

    // Cleanup on unmount or when filters change
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [filters, delay])

  return debouncedFilters
}

/**
 * Specialized hook for shipments tab filters
 */
export interface ShipmentsFilters {
  statusFilter: string[]
  ageFilter: string[]
  typeFilter: string[]
  channelFilter: string[]
  carrierFilter: string[]
  destinationFilter: string[]
  fcFilter: string[]
  dateRange: DateRange | undefined
}

export function useDebouncedShipmentsFilters(
  filters: ShipmentsFilters,
  delay: number = FILTER_DEBOUNCE_MS,
  active: boolean = true
): ShipmentsFilters {
  const [debouncedFilters, setDebouncedFilters] = React.useState(filters)
  const timeoutRef = React.useRef<NodeJS.Timeout | null>(null)

  React.useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    // When tab is not active, cancel pending debounce — don't schedule new one
    if (!active) return
    timeoutRef.current = setTimeout(() => {
      setDebouncedFilters(filters)
    }, delay)
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [filters, delay, active])

  return debouncedFilters
}

/**
 * Specialized hook for unfulfilled tab filters
 */
export interface UnfulfilledFilters {
  statusFilter: string[]
  ageFilter: string[]
  typeFilter: string[]
  channelFilter: string[]
  destinationFilter: string[]
  dateRange: DateRange | undefined
}

export function useDebouncedUnfulfilledFilters(
  filters: UnfulfilledFilters,
  delay: number = FILTER_DEBOUNCE_MS,
  active: boolean = true
): UnfulfilledFilters {
  const [debouncedFilters, setDebouncedFilters] = React.useState(filters)
  const timeoutRef = React.useRef<NodeJS.Timeout | null>(null)

  React.useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    // When tab is not active, cancel pending debounce — don't schedule new one
    if (!active) return
    timeoutRef.current = setTimeout(() => {
      setDebouncedFilters(filters)
    }, delay)
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [filters, delay, active])

  return debouncedFilters
}
