"use client"

import { PerformanceMap } from "@/components/analytics/performance-map"
import { COUNTRY_CONFIGS } from "@/lib/analytics/geo-config"
import type { StatePerformance } from "@/lib/analytics/types"

interface USStateMapProps {
  stateData: StatePerformance[]
  onStateSelect?: (state: string | null) => void
}

export function USStateMap({ stateData, onStateSelect }: USStateMapProps) {
  return (
    <PerformanceMap
      config={COUNTRY_CONFIGS.US}
      regionData={stateData}
      onRegionSelect={onStateSelect}
    />
  )
}
