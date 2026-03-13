'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'

const STORAGE_KEY = 'jetpack_watchlist_v2'
const SYNC_EVENT = 'jetpack_watchlist_sync'

interface WatchEntry {
  id: string       // shipment_id
  clientId: string // which client this shipment belongs to
}

interface UseWatchlistReturn {
  watchedIds: string[]
  isWatched: (id: string) => boolean
  toggleWatch: (id: string, clientId: string) => void
  clearWatchlist: () => void
  count: number
}

function getAllStored(): WatchEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) return JSON.parse(stored)
  } catch {
    // ignore
  }
  return []
}

function persist(entries: WatchEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
    window.dispatchEvent(new Event(SYNC_EVENT))
  } catch {
    // ignore
  }
}

export function useWatchlist(filterClientId?: string): UseWatchlistReturn {
  const [allEntries, setAllEntries] = useState<WatchEntry[]>([])

  useEffect(() => {
    setAllEntries(getAllStored())

    const handleSync = () => setAllEntries(getAllStored())
    window.addEventListener(SYNC_EVENT, handleSync)
    return () => window.removeEventListener(SYNC_EVENT, handleSync)
  }, [])

  // Filter to current client (or show all if no filter / admin viewing "all")
  const filtered = useMemo(() => {
    if (!filterClientId || filterClientId === 'all') return allEntries
    return allEntries.filter(e => e.clientId === filterClientId)
  }, [allEntries, filterClientId])

  const watchedIds = useMemo(() => filtered.map(e => e.id), [filtered])

  const isWatched = useCallback(
    (id: string) => filtered.some(e => e.id === id),
    [filtered]
  )

  const toggleWatch = useCallback((id: string, clientId: string) => {
    const current = getAllStored()
    const exists = current.some(e => e.id === id)
    const next = exists
      ? current.filter(e => e.id !== id)
      : [...current, { id, clientId }]
    persist(next)
  }, [])

  const clearWatchlist = useCallback(() => {
    if (!filterClientId || filterClientId === 'all') {
      persist([])
    } else {
      // Only clear entries for the current client
      const current = getAllStored()
      persist(current.filter(e => e.clientId !== filterClientId))
    }
  }, [filterClientId])

  return { watchedIds, isWatched, toggleWatch, clearWatchlist, count: watchedIds.length }
}
