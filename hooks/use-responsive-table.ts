"use client"

import * as React from "react"
import {
  TableConfig,
  ColumnConfig,
  getCurrentBreakpoint,
  getRedistributedWidths,
} from "@/lib/table-config"

interface UseResponsiveTableOptions {
  config: TableConfig
  userColumnVisibility?: Record<string, boolean>  // From column selector
}

interface UseResponsiveTableReturn {
  visibleColumns: ColumnConfig[]
  columnWidths: Record<string, string>
  currentBreakpoint: string
  maxPriority: number
  hiddenByResponsive: string[]  // Columns hidden due to screen size (not user choice)
}

/**
 * Hook to manage responsive table columns
 * Handles the intersection of user column preferences and responsive hiding
 */
export function useResponsiveTable({
  config,
  userColumnVisibility = {},
}: UseResponsiveTableOptions): UseResponsiveTableReturn {
  const [windowWidth, setWindowWidth] = React.useState<number>(
    typeof window !== "undefined" ? window.innerWidth : 1280
  )

  // Track window resize
  React.useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth)
    }

    // Set initial width
    setWindowWidth(window.innerWidth)

    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [])

  // Calculate current breakpoint and max priority
  const currentBreakpoint = getCurrentBreakpoint(windowWidth)
  const maxPriority = config.breakpoints[currentBreakpoint]

  // Determine visible columns
  const visibleColumns = React.useMemo(() => {
    return config.columns.filter(col => {
      // Check if user has explicitly set visibility
      const userSetting = userColumnVisibility[col.id]

      // If user explicitly disabled, hide regardless of priority
      if (userSetting === false) {
        return false
      }

      // If user explicitly enabled, show regardless of priority (bypass responsive)
      const isUserEnabled = userSetting === true
      if (isUserEnabled) {
        return true
      }

      // Default visible columns still respect responsive priority
      const isDefaultVisible = col.defaultVisible !== false
      if (isDefaultVisible) {
        return col.priority <= maxPriority
      }

      return false
    })
  }, [config.columns, userColumnVisibility, maxPriority])

  // Calculate which columns are hidden due to responsive (not user choice)
  // Only default-visible columns can be hidden by responsive - user-enabled columns bypass it
  const hiddenByResponsive = React.useMemo(() => {
    return config.columns
      .filter(col => {
        const userSetting = userColumnVisibility[col.id]
        const isDefaultVisible = col.defaultVisible !== false

        // User-enabled columns bypass responsive, so they can't be "hidden by responsive"
        if (userSetting === true) return false

        // Column is default visible but hidden due to priority
        return userSetting !== false && isDefaultVisible && col.priority > maxPriority
      })
      .map(col => col.id)
  }, [config.columns, userColumnVisibility, maxPriority])

  // Calculate redistributed widths for visible columns
  const columnWidths = React.useMemo(() => {
    const redistributed = getRedistributedWidths(visibleColumns)
    const widths: Record<string, string> = {}
    for (const [id, width] of Object.entries(redistributed)) {
      widths[id] = `${width}%`
    }
    return widths
  }, [visibleColumns])

  return {
    visibleColumns,
    columnWidths,
    currentBreakpoint,
    maxPriority,
    hiddenByResponsive,
  }
}

/**
 * Get column display order based on a custom order array or default to config order
 */
export function useColumnOrder(
  config: TableConfig,
  visibleColumns: ColumnConfig[],
  customOrder?: string[]
): ColumnConfig[] {
  return React.useMemo(() => {
    if (customOrder && customOrder.length > 0) {
      // Use custom order, filtering to only visible columns
      const visibleIds = new Set(visibleColumns.map(c => c.id))
      return customOrder
        .filter(id => visibleIds.has(id))
        .map(id => visibleColumns.find(c => c.id === id)!)
        .filter(Boolean)
    }
    // Default: return in config order (which is already priority-sorted in our configs)
    return visibleColumns
  }, [visibleColumns, customOrder, config])
}
