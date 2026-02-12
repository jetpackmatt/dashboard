'use client'

import { useState, useEffect, useCallback } from 'react'

/**
 * User Settings Hook
 *
 * Persists user preferences to Supabase user_metadata via the profile API.
 * Uses localStorage as a fast cache so the UI doesn't flash on page load.
 *
 * Flow:
 *   1. On mount: read localStorage cache instantly → set state
 *   2. Then fetch from /api/auth/profile → update state + cache
 *   3. On change: optimistic update state + cache, then PATCH to profile API
 */

const STORAGE_KEY = 'jetpack_user_settings'

export interface UserSettings {
  // 'carrier' = open carrier tracking site, 'deliveryiq' = open Delivery IQ page
  trackingMethod: 'carrier' | 'deliveryiq'
  // Default rows per page across all tables (overridden by per-table preference)
  defaultPageSize: 50 | 100 | 150 | 200
}

const DEFAULTS: UserSettings = {
  trackingMethod: 'deliveryiq',
  defaultPageSize: 50,
}

function getCachedSettings(): Partial<UserSettings> | null {
  if (typeof window === 'undefined') return null

  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) return JSON.parse(stored)
  } catch (e) {
    console.warn('Failed to load cached user settings:', e)
  }
  return null
}

function cacheSettings(settings: UserSettings) {
  if (typeof window === 'undefined') return

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch (e) {
    console.warn('Failed to cache user settings:', e)
  }
}

export function useUserSettings() {
  const [settings, setSettingsState] = useState<UserSettings>(DEFAULTS)
  const [isLoaded, setIsLoaded] = useState(false)

  // On mount: load from cache instantly, then fetch from server
  useEffect(() => {
    // Step 1: Apply cached settings immediately (no flash)
    const cached = getCachedSettings()
    if (cached) {
      setSettingsState(prev => ({ ...prev, ...cached }))
    }
    setIsLoaded(true)

    // Step 2: Fetch authoritative settings from user_metadata
    fetch('/api/auth/profile')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        const serverPrefs = data?.user?.user_metadata?.preferences
        if (serverPrefs) {
          setSettingsState(prev => {
            const merged = { ...prev, ...serverPrefs }
            cacheSettings(merged)
            return merged
          })
        }
      })
      .catch(() => {
        // Silently fall back to cache/defaults
      })
  }, [])

  const updateSetting = useCallback(<K extends keyof UserSettings>(
    key: K,
    value: UserSettings[K]
  ) => {
    setSettingsState(prev => {
      const next = { ...prev, [key]: value }
      // Optimistic: update cache immediately
      cacheSettings(next)
      // Persist to server
      fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { [key]: value } }),
      }).catch(() => {
        console.warn('Failed to persist user setting to server')
      })
      return next
    })
  }, [])

  return {
    settings,
    updateSetting,
    isLoaded,
  }
}
