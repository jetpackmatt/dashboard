"use client"

import { useMemo, useState, useRef } from "react"
import { ComposableMap, Geographies, Geography } from "react-simple-maps"
import type { StatePerformance } from "@/lib/analytics/types"
import type { CountryConfig } from "@/lib/analytics/geo-config"
import { CA_NORTHERN_TERRITORIES, CA_SOUTHERN_PROJECTION_CONFIG } from "@/lib/analytics/geo-config"
import { Card, CardContent } from "@/components/ui/card"

interface PerformanceMapProps {
  config: CountryConfig
  regionData: StatePerformance[]
  onRegionSelect?: (region: string | null) => void
}

export function PerformanceMap({ config, regionData, onRegionSelect }: PerformanceMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [hoveredRegion, setHoveredRegion] = useState<string | null>(null)
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null)
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 })

  const isMouseOnRightSide = () => {
    if (!containerRef.current) return false
    const rect = containerRef.current.getBoundingClientRect()
    const containerMidpoint = rect.left + rect.width / 2
    return mousePosition.x > containerMidpoint
  }

  const dataMap = new Map(regionData.map(d => [d.state, d]))

  // For Canada: hide northern territories when they have no data
  const hideNorthernTerritories = useMemo(() => {
    if (config.code !== 'CA') return false
    return CA_NORTHERN_TERRITORIES.every(code => {
      const d = dataMap.get(code)
      return !d || d.orderCount === 0
    })
  }, [config.code, regionData])

  const projectionConfig = useMemo(() => {
    if (hideNorthernTerritories) return CA_SOUTHERN_PROJECTION_CONFIG
    return config.projectionConfig
  }, [hideNorthernTerritories, config.projectionConfig])

  // Names of territories to exclude from rendering
  const hiddenGeoNames = useMemo(() => {
    if (!hideNorthernTerritories) return new Set<string>()
    const names = new Set<string>()
    for (const [name, code] of Object.entries(config.nameToCode)) {
      if (CA_NORTHERN_TERRITORIES.includes(code)) names.add(name)
    }
    return names
  }, [hideNorthernTerritories, config.nameToCode])

  const getRegionColor = (regionCode: string) => {
    const data = dataMap.get(regionCode)
    if (!data || data.orderCount === 0) {
      return "hsl(var(--muted))"
    }

    const avgDays = data.avgCarrierTransitDays
    if (avgDays <= 0) return "hsl(var(--muted))"
    if (avgDays < 3) {
      return "hsl(142 71% 45%)" // green
    } else if (avgDays < 5) {
      return "hsl(203 61% 50%)" // jetpack blue
    } else {
      return "hsl(0 72% 51%)" // red
    }
  }

  const handleRegionClick = (regionCode: string) => {
    const newRegion = selectedRegion === regionCode ? null : regionCode
    setSelectedRegion(newRegion)
    onRegionSelect?.(newRegion)
  }

  const getRegionOpacity = (regionCode: string) => {
    if (selectedRegion === regionCode) return 1
    if (hoveredRegion === regionCode) return 0.8
    if (selectedRegion && selectedRegion !== regionCode) return 0.4
    return 0.7
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <ComposableMap
        projection={config.projection as any}
        projectionConfig={projectionConfig as any}
      >
        <Geographies geography={config.geoUrl}>
          {({ geographies }) =>
            geographies
              .filter((geo) => !hiddenGeoNames.has(geo.properties.name))
              .map((geo) => {
              const geoName = geo.properties.name
              const regionCode = config.nameToCode[geoName] || ''

              return (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  fill={getRegionColor(regionCode)}
                  stroke="hsl(var(--background))"
                  strokeWidth={0.5}
                  style={{
                    default: {
                      outline: 'none',
                      opacity: getRegionOpacity(regionCode),
                    },
                    hover: {
                      outline: 'none',
                      opacity: 0.8,
                      filter: 'brightness(1.15) drop-shadow(0 0 3px rgba(0,0,0,0.3))',
                      cursor: 'pointer',
                    },
                    pressed: {
                      outline: 'none',
                      opacity: 1,
                    },
                  }}
                  onClick={() => handleRegionClick(regionCode)}
                  onMouseEnter={() => setHoveredRegion(regionCode)}
                  onMouseLeave={() => setHoveredRegion(null)}
                  onMouseMove={(event: React.MouseEvent) => {
                    setMousePosition({ x: event.clientX, y: event.clientY })
                  }}
                />
              )
            })
          }
        </Geographies>
      </ComposableMap>

      {/* Legend */}
      <Card className="absolute bottom-2 left-2 w-auto">
        <CardContent className="p-2">
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-semibold whitespace-nowrap">Final Mile:</span>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: "hsl(142 71% 45%)" }} />
              <span className="text-[10px] whitespace-nowrap">{"<3d"}</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: "hsl(203 61% 50%)" }} />
              <span className="text-[10px] whitespace-nowrap">3-5d</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: "hsl(0 72% 51%)" }} />
              <span className="text-[10px] whitespace-nowrap">{">5d"}</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-sm bg-muted" />
              <span className="text-[10px] whitespace-nowrap">No data</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Hover tooltip */}
      {hoveredRegion && dataMap.has(hoveredRegion) && (() => {
        const flipToLeft = isMouseOnRightSide()
        const data = dataMap.get(hoveredRegion)!
        return (
          <Card
            className="fixed w-64 pointer-events-none z-50"
            style={{
              left: flipToLeft ? `${mousePosition.x - 276}px` : `${mousePosition.x + 20}px`,
              top: `${mousePosition.y - 20}px`
            }}
          >
            <CardContent className="p-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">{data.stateName}</div>
                  <div className="text-xs text-muted-foreground">{data.orderCount.toLocaleString()} orders</div>
                </div>
                <div className="text-2xl font-bold tabular-nums">
                  {data.avgDeliveryTimeDays.toFixed(1)} days
                </div>
                <div className="text-xs text-muted-foreground">
                  Order to Delivery
                </div>
                <div className="grid grid-cols-3 gap-2 pt-2 border-t">
                  <div>
                    <div className="text-[10px] text-muted-foreground">Fulfillment</div>
                    <div className="font-semibold text-sm tabular-nums">{data.avgFulfillTimeHours.toFixed(1)}h</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">Regional</div>
                    <div className="font-semibold text-sm tabular-nums">{data.avgRegionalMileDays.toFixed(1)}d</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">Final Mile</div>
                    <div className="font-semibold text-sm tabular-nums">{data.avgCarrierTransitDays.toFixed(1)}d</div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )
      })()}
    </div>
  )
}
