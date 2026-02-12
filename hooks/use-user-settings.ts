'use client'

import { useSyncExternalStore, useCallback } from 'react'

/**
 * User Settings Hook (module-level singleton)
 *
 * Uses a shared module-level store so ALL hook instances share one fetch.
 * This is critical because TrackingLink renders per-row in tables — without
 * deduplication, 50 rows = 50 concurrent /api/auth/profile calls.
 *
 * Flow:
 *   1. First subscriber triggers a single fetch to /api/auth/profile
 *   2. All hook instances read from the shared store via useSyncExternalStore
 *   3. Updates are optimistic (localStorage + state) then persisted to server
 */

const STORAGE_KEY = 'jetpack_user_settings'

export interface UserSettings {
  // 'carrier' = open carrier tracking site, 'deliveryiq' = open Delivery IQ page
  trackingMethod: 'carrier' | 'deliveryiq'
  // Default rows per page across all tables (overridden by per-table preference)
  defaultPageSize: 50 | 100 | 150 | 200
  // When true, resolved tickets are hidden from the Care section
  hideResolvedTickets: boolean
}

const DEFAULTS: UserSettings = {
  trackingMethod: 'deliveryiq',
  defaultPageSize: 50,
  hideResolvedTickets: false,
}

// ---------------------------------------------------------------------------
// Module-level store — shared across all hook instances
// ---------------------------------------------------------------------------

interface SettingsState {
  settings: UserSettings
  isLoaded: boolean
}

function loadCached(): UserSettings {
  if (typeof window === 'undefined') return DEFAULTS
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) return { ...DEFAULTS, ...JSON.parse(stored) }
  } catch {
    // fall through
  }
  return DEFAULTS
}

function cacheSettings(settings: UserSettings) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // ignore
  }
}

// Initialize from localStorage synchronously (no flash)
let state: SettingsState = {
  settings: typeof window !== 'undefined' ? loadCached() : DEFAULTS,
  isLoaded: false,
}

const listeners = new Set<() => void>()

function getSnapshot(): SettingsState {
  return state
}

const SERVER_SNAPSHOT: SettingsState = { settings: DEFAULTS, isLoaded: false }

function getServerSnapshot(): SettingsState {
  return SERVER_SNAPSHOT
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  // Trigger the one-time server fetch on first subscriber
  triggerFetch()
  return () => { listeners.delete(listener) }
}

function setState(patch: Partial<SettingsState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

// ---------------------------------------------------------------------------
// One-time fetch — only runs once, no matter how many hook instances exist
// ---------------------------------------------------------------------------

let fetchTriggered = false

function triggerFetch() {
  if (fetchTriggered) return
  fetchTriggered = true

  // Mark as loaded immediately (cache is already applied)
  setState({ isLoaded: true })

  // Fetch authoritative settings from server
  fetch('/api/auth/profile')
    .then(res => res.ok ? res.json() : null)
    .then(data => {
      const serverPrefs = data?.user?.user_metadata?.preferences
      if (serverPrefs) {
        const merged = { ...state.settings, ...serverPrefs }
        cacheSettings(merged)
        setState({ settings: merged })
      }
    })
    .catch(() => {
      // Silently fall back to cache/defaults
    })
}

// ---------------------------------------------------------------------------
// React hook — all instances share the module-level store
// ---------------------------------------------------------------------------

export function useUserSettings() {
  const currentState = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const updateSetting = useCallback(<K extends keyof UserSettings>(
    key: K,
    value: UserSettings[K]
  ) => {
    const next = { ...state.settings, [key]: value }
    // Optimistic: update store + cache immediately
    cacheSettings(next)
    setState({ settings: next })
    // Persist to server
    fetch('/api/auth/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferences: { [key]: value } }),
    }).catch(() => {
      console.warn('Failed to persist user setting to server')
    })
  }, [])

  return {
    settings: currentState.settings,
    updateSetting,
    isLoaded: currentState.isLoaded,
  }
}
