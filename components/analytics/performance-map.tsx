"use client"

import { useMemo, useState, useRef } from "react"
import { ComposableMap, Geographies, Geography } from "react-simple-maps"
import type { StatePerformance } from "@/lib/analytics/types"
import type { CountryConfig } from "@/lib/analytics/geo-config"
import { CA_NORTHERN_TERRITORIES } from "@/lib/analytics/geo-config"
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

  // Northern territories with no data — render greyed out, non-interactive
  const greyedOutCodes = useMemo(() => {
    if (config.code !== 'CA') return new Set<string>()
    const greyed = new Set<string>()
    for (const code of CA_NORTHERN_TERRITORIES) {
      const d = dataMap.get(code)
      if (!d || d.orderCount === 0) greyed.add(code)
    }
    return greyed
  }, [config.code, regionData])

  const getRegionColor = (regionCode: string) => {
    const data = dataMap.get(regionCode)
    if (!data || data.orderCount === 0) {
      return "hsl(var(--border))"
    }

    const avgDays = data.avgCarrierTransitDays
    if (avgDays <= 0) return "hsl(var(--border))"
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
        projectionConfig={config.projectionConfig as any}
      >
        <Geographies geography={config.geoUrl}>
          {({ geographies }) =>
            geographies.map((geo) => {
              const geoName = geo.properties.name
              const regionCode = config.nameToCode[geoName] || ''
              const isGreyedOut = greyedOutCodes.has(regionCode)

              return (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  fill={isGreyedOut ? "hsl(var(--border))" : getRegionColor(regionCode)}
                  stroke="hsl(var(--muted))"
                  strokeWidth={0.5}
                  style={{
                    default: {
                      outline: 'none',
                      opacity: isGreyedOut ? 0.85 : getRegionOpacity(regionCode),
                    },
                    hover: isGreyedOut ? {
                      outline: 'none',
                      opacity: 0.85,
                    } : {
                      outline: 'none',
                      opacity: 0.8,
                      filter: 'brightness(1.15) drop-shadow(0 0 3px rgba(0,0,0,0.3))',
                      cursor: 'pointer',
                    },
                    pressed: {
                      outline: 'none',
                      opacity: isGreyedOut ? 0.85 : 1,
                    },
                  }}
                  onClick={() => !isGreyedOut && handleRegionClick(regionCode)}
                  onMouseEnter={() => !isGreyedOut && setHoveredRegion(regionCode)}
                  onMouseLeave={() => !isGreyedOut && setHoveredRegion(null)}
                  onMouseMove={(event: React.MouseEvent) => {
                    if (!isGreyedOut) setMousePosition({ x: event.clientX, y: event.clientY })
                  }}
                />
              )
            })
          }
        </Geographies>
      </ComposableMap>

      {/* Legend */}
      <Card className={`absolute left-2 w-auto z-10 ${config.code === 'CA' ? 'bottom-[70px]' : '-bottom-5'}`}>
        <CardContent className="p-2">
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-semibold whitespace-nowrap">Carrier Transit:</span>
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
                    <div className="text-[10px] text-muted-foreground">Middle Mile</div>
                    <div className="font-semibold text-sm tabular-nums">{data.avgRegionalMileDays.toFixed(1)}d</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">Carrier Transit</div>
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
