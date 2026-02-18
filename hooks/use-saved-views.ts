'use client'

import { useState, useEffect, useCallback } from 'react'

/**
 * Saved Views Hook
 *
 * Persists named filter combinations to localStorage per tab.
 * Follows the same pattern as use-table-preferences.ts.
 */

const STORAGE_KEY_PREFIX = 'jetpack_saved_views_'
const MAX_VIEWS = 10

export interface SavedView {
  id: string
  name: string
  filters: Record<string, unknown>
  createdAt: string
}

interface UseSavedViewsReturn {
  views: SavedView[]
  activeViewId: string | null
  isModified: boolean
  saveView: (name: string, filters: Record<string, unknown>) => void
  loadView: (id: string) => SavedView | null
  deleteView: (id: string) => void
  updateView: (id: string, filters: Record<string, unknown>) => void
  setActiveViewId: (id: string | null) => void
  checkIfModified: (currentFilters: Record<string, unknown>) => void
}

function getStoredViews(tabId: string): SavedView[] {
  if (typeof window === 'undefined') return []

  try {
    const stored = localStorage.getItem(`${STORAGE_KEY_PREFIX}${tabId}`)
    if (stored) {
      return JSON.parse(stored)
    }
  } catch (e) {
    console.warn(`Failed to load saved views for ${tabId}:`, e)
  }
  return []
}

function storeViews(tabId: string, views: SavedView[]) {
  if (typeof window === 'undefined') return

  try {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${tabId}`, JSON.stringify(views))
  } catch (e) {
    console.warn(`Failed to save views for ${tabId}:`, e)
  }
}

/**
 * Deep-compare two filter objects for equality.
 * Handles arrays (order-insensitive) and nested objects.
 */
function filtersEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keysA = Object.keys(a)
  const keysB = Object.keys(b)

  // Get union of all keys
  const allKeys = new Set([...keysA, ...keysB])

  for (const key of allKeys) {
    const valA = a[key]
    const valB = b[key]

    // Treat missing key as empty array
    const normA = valA ?? []
    const normB = valB ?? []

    if (Array.isArray(normA) && Array.isArray(normB)) {
      if (normA.length !== normB.length) return false
      const sortedA = [...normA].sort()
      const sortedB = [...normB].sort()
      for (let i = 0; i < sortedA.length; i++) {
        if (sortedA[i] !== sortedB[i]) return false
      }
    } else if (typeof normA === 'object' && normA !== null && typeof normB === 'object' && normB !== null) {
      if (JSON.stringify(normA) !== JSON.stringify(normB)) return false
    } else {
      if (normA !== normB) return false
    }
  }

  return true
}

export function useSavedViews(tabId: string): UseSavedViewsReturn {
  const [views, setViews] = useState<SavedView[]>([])
  const [activeViewId, setActiveViewId] = useState<string | null>(null)
  const [isModified, setIsModified] = useState(false)

  // Load views on mount
  useEffect(() => {
    setViews(getStoredViews(tabId))
  }, [tabId])

  const saveView = useCallback((name: string, filters: Record<string, unknown>) => {
    setViews(prev => {
      const newView: SavedView = {
        id: crypto.randomUUID(),
        name,
        filters,
        createdAt: new Date().toISOString(),
      }
      const updated = [...prev, newView].slice(-MAX_VIEWS)
      storeViews(tabId, updated)
      setActiveViewId(newView.id)
      setIsModified(false)
      return updated
    })
  }, [tabId])

  const loadView = useCallback((id: string): SavedView | null => {
    const view = views.find(v => v.id === id) ?? null
    if (view) {
      setActiveViewId(id)
      setIsModified(false)
    }
    return view
  }, [views])

  const deleteView = useCallback((id: string) => {
    setViews(prev => {
      const updated = prev.filter(v => v.id !== id)
      storeViews(tabId, updated)
      return updated
    })
    if (activeViewId === id) {
      setActiveViewId(null)
      setIsModified(false)
    }
  }, [tabId, activeViewId])

  const updateView = useCallback((id: string, filters: Record<string, unknown>) => {
    setViews(prev => {
      const updated = prev.map(v => v.id === id ? { ...v, filters } : v)
      storeViews(tabId, updated)
      return updated
    })
    setIsModified(false)
  }, [tabId])

  const checkIfModified = useCallback((currentFilters: Record<string, unknown>) => {
    if (!activeViewId) {
      setIsModified(false)
      return
    }
    const activeView = views.find(v => v.id === activeViewId)
    if (!activeView) {
      setIsModified(false)
      return
    }
    setIsModified(!filtersEqual(activeView.filters, currentFilters))
  }, [activeViewId, views])

  return {
    views,
    activeViewId,
    isModified,
    saveView,
    loadView,
    deleteView,
    updateView,
    setActiveViewId,
    checkIfModified,
  }
}
