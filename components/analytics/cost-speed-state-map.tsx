"use client"

import { useState, useRef } from "react"
import { ComposableMap, Geographies, Geography } from "react-simple-maps"
import { Card, CardContent } from "@/components/ui/card"
import type { StateCostSpeedData } from "@/lib/analytics/types"

const geoUrl = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json"

type MetricType = 'cost' | 'transit'

interface CostSpeedStateMapProps {
  data: StateCostSpeedData[]
  metric: MetricType
  title: string
}

const stateNameToCode: Record<string, string> = {
  'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR',
  'California': 'CA', 'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE',
  'Florida': 'FL', 'Georgia': 'GA', 'Hawaii': 'HI', 'Idaho': 'ID',
  'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA', 'Kansas': 'KS',
  'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
  'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS',
  'Missouri': 'MO', 'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH', 'Oklahoma': 'OK',
  'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT',
  'Vermont': 'VT', 'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV',
  'Wisconsin': 'WI', 'Wyoming': 'WY'
}

export function CostSpeedStateMap({ data, metric, title }: CostSpeedStateMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [hoveredState, setHoveredState] = useState<string | null>(null)
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 })

  const safeData = Array.isArray(data) ? data : []
  const dataMap = new Map(safeData.map(d => [d.state, d]))

  // Get values for normalization
  const values = safeData.map(d => metric === 'cost' ? d.avgCost : d.avgTransitTime).filter(v => v > 0)
  const minValue = values.length > 0 ? Math.min(...values) : 0
  const maxValue = values.length > 0 ? Math.max(...values) : 0

  // Color scheme: Cost = blue gradient, Transit = orange/red gradient
  // Higher values = darker/more intense
  const getStateColor = (stateCode: string) => {
    const stateData = dataMap.get(stateCode)
    if (!stateData || maxValue === minValue) {
      return "hsl(0, 0%, 92%)" // Light grey for no data
    }

    const value = metric === 'cost' ? stateData.avgCost : stateData.avgTransitTime
    if (value === 0) return "hsl(0, 0%, 92%)"

    const normalized = (value - minValue) / (maxValue - minValue)

    if (metric === 'cost') {
      // Blue gradient: light blue to dark blue (higher cost = darker)
      const hue = 210
      const saturation = 20 + (normalized * 60) // 20% to 80%
      const lightness = 85 - (normalized * 50) // 85% to 35%
      return `hsl(${hue}, ${saturation}%, ${lightness}%)`
    } else {
      // Orange/red gradient: light orange to dark red (longer transit = darker/redder)
      const hue = 30 - (normalized * 25) // 30 (orange) to 5 (red)
      const saturation = 30 + (normalized * 60) // 30% to 90%
      const lightness = 85 - (normalized * 50) // 85% to 35%
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

  return (
    <div
      ref={containerRef}
      className="relative"
      onMouseMove={(e) => setMousePosition({ x: e.clientX, y: e.clientY })}
    >
      <div className="text-sm font-medium text-center mb-1">{title}</div>
      <ComposableMap
        projection="geoAlbersUsa"
        className="w-full h-auto"
        style={{ maxHeight: '340px' }}
      >
        <Geographies geography={geoUrl}>
          {({ geographies }: { geographies: any[] }) =>
            geographies.map((geo: any) => {
              const stateName = geo.properties.name
              const stateCode = stateNameToCode[stateName]
              const isHovered = hoveredState === stateCode

              return (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  fill={getStateColor(stateCode)}
                  stroke={isHovered ? '#000' : '#fff'}
                  strokeWidth={isHovered ? 1.5 : 0.5}
                  style={{
                    default: { outline: 'none' },
                    hover: { outline: 'none', cursor: 'pointer' },
                    pressed: { outline: 'none' },
                  }}
                  onMouseEnter={() => setHoveredState(stateCode)}
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
                  {metric === 'cost' ? 'Avg shipping cost' : 'Avg transit time'}
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1.5 border-t text-xs">
                  <div>
                    <div className="text-muted-foreground">Orders</div>
                    <div className="font-semibold tabular-nums">{stateData.orderCount.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">
                      {metric === 'cost' ? 'Avg Transit' : 'Avg Cost'}
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
