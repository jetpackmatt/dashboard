"use client"

import { useRef, lazy, Suspense } from "react"

// Shared import function — same reference for both preload and React.lazy
const importInner = () => import("./shipment-details-drawer-inner")

// Preload the heavy chunk as soon as any page imports this wrapper.
// setTimeout(0) yields to let the page render first, then loads in background.
if (typeof window !== "undefined") {
  setTimeout(importInner, 0)
}

const LazyDrawer = lazy(importInner)

interface ShipmentDetailsDrawerProps {
  shipmentId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onNotesChanged?: (shipmentId: string, delta: number) => void
}

export function ShipmentDetailsDrawer(props: ShipmentDetailsDrawerProps) {
  const hasOpened = useRef(false)
  if (props.open) hasOpened.current = true

  if (!hasOpened.current) return null

  return (
    <Suspense fallback={null}>
      <LazyDrawer {...props} />
    </Suspense>
  )
}
