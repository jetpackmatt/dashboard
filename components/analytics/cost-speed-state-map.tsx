"use client"

import { useMemo, useState, useRef } from "react"
import { ComposableMap, Geographies, Geography } from "react-simple-maps"
import { Card, CardContent } from "@/components/ui/card"
import { COUNTRY_CONFIGS, CA_NORTHERN_TERRITORIES } from "@/lib/analytics/geo-config"
import type { StateCostSpeedData } from "@/lib/analytics/types"

type MetricType = 'cost' | 'transit'

interface CostSpeedStateMapProps {
  data: StateCostSpeedData[]
  metric: MetricType
  title: string
  country?: string // 'US' | 'CA' — defaults to 'US'
}

export function CostSpeedStateMap({ data, metric, title, country = 'US' }: CostSpeedStateMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [hoveredState, setHoveredState] = useState<string | null>(null)
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 })

  const config = COUNTRY_CONFIGS[country] || COUNTRY_CONFIGS.US

  const safeData = Array.isArray(data) ? data : []
  const dataMap = new Map(safeData.map(d => [d.state, d]))

  // Northern territories with no data — greyed out
  const greyedOut = useMemo(() => {
    if (country !== 'CA') return new Set<string>()
    const s = new Set<string>()
    for (const code of CA_NORTHERN_TERRITORIES) {
      const d = dataMap.get(code)
      if (!d || d.orderCount === 0) s.add(code)
    }
    return s
  }, [country, safeData])

  // Get values for normalization
  const values = safeData.map(d => metric === 'cost' ? d.avgCost : d.avgTransitTime).filter(v => v > 0)
  const minValue = values.length > 0 ? Math.min(...values) : 0
  const maxValue = values.length > 0 ? Math.max(...values) : 0

  // Color scheme: Cost = blue gradient, Transit = orange/red gradient
  const getStateColor = (stateCode: string) => {
    if (greyedOut.has(stateCode)) return "hsl(0, 0%, 92%)"
    const stateData = dataMap.get(stateCode)
    if (!stateData || maxValue === minValue) {
      return "hsl(0, 0%, 92%)"
    }

    const value = metric === 'cost' ? stateData.avgCost : stateData.avgTransitTime
    if (value === 0) return "hsl(0, 0%, 92%)"

    const normalized = (value - minValue) / (maxValue - minValue)

    if (metric === 'cost') {
      const hue = 210
      const saturation = 20 + (normalized * 60)
      const lightness = 85 - (normalized * 50)
      return `hsl(${hue}, ${saturation}%, ${lightness}%)`
    } else {
      const hue = 30 - (normalized * 25)
      const saturation = 30 + (normalized * 60)
      const lightness = 85 - (normalized * 50)
      return `hsl(${hue}, ${saturation}%, ${lightness}%)`
    }
  }

  const isMouseOnRightSide = () => {
    if (!containerRef.current) return false
    const rect = containerRef.current.getBoundingClientRect()
    const containerMidpoint = rect.left + rect.width / 2
    return mousePosition.x > containerMidpoint
  }

  const formatValue = (value: number) => {
    if (metric === 'cost') {
      return `$${value.toFixed(2)}`
    }
    return `${value.toFixed(1)} days`
  }

  // Resolve geo name → region code using the config's nameToCode map
  const resolveCode = (geoName: string) => {
    // Check if it's already a code
    if (config.codeToName[geoName]) return geoName
    // Look up by name
    return config.nameToCode[geoName] || geoName
  }

  return (
    <div
      ref={containerRef}
      className="relative"
      onMouseMove={(e) => setMousePosition({ x: e.clientX, y: e.clientY })}
    >
      {title && <div className="text-sm font-medium text-center -mb-1">{title}</div>}
      <ComposableMap
        projection={config.projection as any}
        projectionConfig={config.projectionConfig as any}
        className="w-full h-auto"
      >
        <Geographies geography={config.geoUrl}>
          {({ geographies }: { geographies: any[] }) =>
            geographies.map((geo: any) => {
              const geoName = geo.properties.name || geo.properties.NAME
              const regionCode = resolveCode(geoName)
              const isGreyed = greyedOut.has(regionCode)
              const isHovered = hoveredState === regionCode

              return (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  fill={getStateColor(regionCode)}
                  stroke={isHovered ? '#000' : '#fff'}
                  strokeWidth={isHovered ? 1.5 : 0.5}
                  style={{
                    default: { outline: 'none' },
                    hover: { outline: 'none', cursor: isGreyed ? 'default' : 'pointer' },
                    pressed: { outline: 'none' },
                  }}
                  onMouseEnter={() => !isGreyed && setHoveredState(regionCode)}
                  onMouseLeave={() => setHoveredState(null)}
                />
              )
            })
          }
        </Geographies>
      </ComposableMap>

      {/* Legend */}
      <Card className="absolute bottom-1 left-0 w-auto shadow-sm">
        <CardContent className="p-1.5 px-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-muted-foreground">
              {metric === 'cost' ? `$${minValue.toFixed(0)}` : `${minValue.toFixed(1)}d`}
            </span>
            <div
              className="w-10 h-2 rounded-sm"
              style={{
                background: metric === 'cost'
                  ? "linear-gradient(to right, hsl(210, 20%, 85%), hsl(210, 50%, 60%), hsl(210, 80%, 35%))"
                  : "linear-gradient(to right, hsl(30, 30%, 85%), hsl(20, 60%, 60%), hsl(5, 90%, 35%))"
              }}
            />
            <span className="text-[9px] text-muted-foreground">
              {metric === 'cost' ? `$${maxValue.toFixed(0)}` : `${maxValue.toFixed(1)}d`}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Hover tooltip */}
      {hoveredState && dataMap.has(hoveredState) && (() => {
        const flipToLeft = isMouseOnRightSide()
        const stateData = dataMap.get(hoveredState)!
        return (
          <Card
            className="fixed w-56 pointer-events-none z-50"
            style={{
              left: flipToLeft ? `${mousePosition.x - 240}px` : `${mousePosition.x + 15}px`,
              top: `${mousePosition.y - 15}px`
            }}
          >
            <CardContent className="p-2.5">
              <div className="space-y-1.5">
                <div className="font-semibold text-sm">{stateData.stateName}</div>
                <div className="text-xl font-bold tabular-nums">
                  {formatValue(metric === 'cost' ? stateData.avgCost : stateData.avgTransitTime)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {metric === 'cost' ? 'Avg shipping cost' : 'Avg carrier transit'}
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1.5 border-t text-xs">
                  <div>
                    <div className="text-muted-foreground">Orders</div>
                    <div className="font-semibold tabular-nums">{stateData.orderCount.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">
                      {metric === 'cost' ? 'Carrier Transit' : 'Avg Cost'}
                    </div>
                    <div className="font-semibold tabular-nums">
                      {metric === 'cost'
                        ? `${stateData.avgTransitTime.toFixed(1)}d`
                        : `$${stateData.avgCost.toFixed(2)}`}
                    </div>
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
