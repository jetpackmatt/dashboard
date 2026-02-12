'use client'

import * as React from 'react'
import { useUserSettings } from '@/hooks/use-user-settings'
import { getTrackingUrl } from '@/components/transactions/cell-renderers'
import { TrackingTimelineDrawer } from '@/components/lookout/tracking-timeline-drawer'

// ============================================
// CONTEXT - Shared single drawer instance
// ============================================

interface TrackingDrawerContextValue {
  openDrawer: (trackingNumber: string, carrier: string) => void
}

const TrackingDrawerContext = React.createContext<TrackingDrawerContextValue | null>(null)

/**
 * Provides a shared TrackingTimelineDrawer instance for all TrackingLink
 * components in the tree. Add this to the dashboard layout.
 */
export function TrackingDrawerProvider({ children }: { children: React.ReactNode }) {
  const [tracking, setTracking] = React.useState<{ number: string; carrier: string } | null>(null)
  const [open, setOpen] = React.useState(false)

  const openDrawer = React.useCallback((trackingNumber: string, carrier: string) => {
    setTracking({ number: trackingNumber, carrier })
    setOpen(true)
  }, [])

  return (
    <TrackingDrawerContext.Provider value={{ openDrawer }}>
      {children}
      <TrackingTimelineDrawer
        trackingNumber={tracking?.number || null}
        carrier={tracking?.carrier || null}
        open={open}
        onOpenChange={setOpen}
      />
    </TrackingDrawerContext.Provider>
  )
}

export function useTrackingDrawer() {
  return React.useContext(TrackingDrawerContext)
}

// ============================================
// TRACKING LINK COMPONENT
// ============================================

interface TrackingLinkProps {
  trackingNumber: string
  carrier: string
  className?: string
  children: React.ReactNode
}

/**
 * Renders a tracking link that respects the user's tracking method preference.
 *
 * - "carrier" mode: opens carrier tracking site in new tab
 * - "deliveryiq" mode: opens TrackingTimelineDrawer via shared context
 *
 * Falls back to carrier mode if no drawer context is available.
 */
export function TrackingLink({ trackingNumber, carrier, className, children }: TrackingLinkProps) {
  const { settings } = useUserSettings()
  const drawerCtx = React.useContext(TrackingDrawerContext)

  const carrierUrl = getTrackingUrl(carrier, trackingNumber)

  // Delivery IQ mode: open the drawer
  if (settings.trackingMethod === 'deliveryiq' && drawerCtx) {
    return (
      <button
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          drawerCtx.openDrawer(trackingNumber, carrier)
        }}
        className={className}
      >
        {children}
      </button>
    )
  }

  // Carrier mode (or fallback): open carrier site
  if (carrierUrl) {
    return (
      <a
        href={carrierUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className={className}
      >
        {children}
      </a>
    )
  }

  // No carrier URL available
  return <span className={className}>{children}</span>
}
