'use client'

import { useState, useEffect, useCallback } from 'react'

/**
 * Table Preferences Hook
 *
 * Persists user preferences for tables to localStorage:
 * - Column visibility per table
 * - Page size per table
 *
 * Uses localStorage for persistence across sessions.
 * Handles SSR by only loading preferences after mount.
 */

const STORAGE_KEY_PREFIX = 'jetpack_table_'
const DEFAULT_PAGE_SIZE = 50

interface TablePreferences {
  columnVisibility: Record<string, boolean>
  columnOrder: string[]
  pageSize: number
}

interface UseTablePreferencesReturn {
  columnVisibility: Record<string, boolean>
  columnOrder: string[]
  pageSize: number
  setColumnVisibility: (visibility: Record<string, boolean>) => void
  setColumnOrder: (order: string[]) => void
  setPageSize: (size: number) => void
  resetPreferences: () => void
  isLoaded: boolean
}

/**
 * Get stored preferences from localStorage
 */
function getStoredPreferences(tableId: string): Partial<TablePreferences> | null {
  if (typeof window === 'undefined') return null

  try {
    const stored = localStorage.getItem(`${STORAGE_KEY_PREFIX}${tableId}`)
    if (stored) {
      return JSON.parse(stored)
    }
  } catch (e) {
    console.warn(`Failed to load table preferences for ${tableId}:`, e)
  }
  return null
}

/**
 * Save preferences to localStorage
 */
function savePreferences(tableId: string, prefs: Partial<TablePreferences>) {
  if (typeof window === 'undefined') return

  try {
    const existing = getStoredPreferences(tableId) || {}
    const merged = { ...existing, ...prefs }
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${tableId}`, JSON.stringify(merged))
  } catch (e) {
    console.warn(`Failed to save table preferences for ${tableId}:`, e)
  }
}

/**
 * Clear preferences from localStorage
 */
function clearPreferences(tableId: string) {
  if (typeof window === 'undefined') return

  try {
    localStorage.removeItem(`${STORAGE_KEY_PREFIX}${tableId}`)
  } catch (e) {
    console.warn(`Failed to clear table preferences for ${tableId}:`, e)
  }
}

/**
 * Hook to manage table preferences with localStorage persistence
 *
 * @param tableId - Unique identifier for the table (e.g., 'shipments', 'returns')
 * @param defaultPageSize - Default page size if none stored (default: 50)
 */
export function useTablePreferences(
  tableId: string,
  defaultPageSize: number = DEFAULT_PAGE_SIZE
): UseTablePreferencesReturn {
  const [isLoaded, setIsLoaded] = useState(false)
  const [columnVisibility, setColumnVisibilityState] = useState<Record<string, boolean>>({})
  const [columnOrder, setColumnOrderState] = useState<string[]>([])
  const [pageSize, setPageSizeState] = useState<number>(defaultPageSize)

  // Load preferences on mount (client-side only)
  useEffect(() => {
    const stored = getStoredPreferences(tableId)
    if (stored) {
      if (stored.columnVisibility) {
        setColumnVisibilityState(stored.columnVisibility)
      }
      if (stored.columnOrder) {
        setColumnOrderState(stored.columnOrder)
      }
      if (stored.pageSize) {
        setPageSizeState(stored.pageSize)
      }
    }
    setIsLoaded(true)
  }, [tableId])

  // Save column visibility when it changes
  const setColumnVisibility = useCallback((visibility: Record<string, boolean>) => {
    setColumnVisibilityState(visibility)
    if (Object.keys(visibility).length > 0) {
      savePreferences(tableId, { columnVisibility: visibility })
    }
  }, [tableId])

  // Save column order when it changes
  const setColumnOrder = useCallback((order: string[]) => {
    setColumnOrderState(order)
    if (order.length > 0) {
      savePreferences(tableId, { columnOrder: order })
    }
  }, [tableId])

  // Save page size when it changes
  const setPageSize = useCallback((size: number) => {
    setPageSizeState(size)
    savePreferences(tableId, { pageSize: size })
  }, [tableId])

  // Reset all preferences for this table
  const resetPreferences = useCallback(() => {
    clearPreferences(tableId)
    setColumnVisibilityState({})
    setColumnOrderState([])
    setPageSizeState(defaultPageSize)
  }, [tableId, defaultPageSize])

  return {
    columnVisibility,
    columnOrder,
    pageSize,
    setColumnVisibility,
    setColumnOrder,
    setPageSize,
    resetPreferences,
    isLoaded,
  }
}

/**
 * Get page size preference directly (for initial state)
 * Returns default if not found or on server
 */
export function getStoredPageSize(tableId: string, defaultSize: number = DEFAULT_PAGE_SIZE): number {
  const stored = getStoredPreferences(tableId)
  return stored?.pageSize ?? defaultSize
}

/**
 * Get column visibility preference directly (for initial state)
 * Returns empty object if not found or on server
 */
export function getStoredColumnVisibility(tableId: string): Record<string, boolean> {
  const stored = getStoredPreferences(tableId)
  return stored?.columnVisibility ?? {}
}
