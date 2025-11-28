"use client"

import { useState, useRef } from "react"
import { ComposableMap, Geographies, Geography } from "react-simple-maps"
import type { StatePerformance } from "@/lib/analytics/types"
import { Card, CardContent } from "@/components/ui/card"

interface USStateMapProps {
  stateData: StatePerformance[]
  onStateSelect?: (state: string | null) => void
}

const geoUrl = "/us-states.json"

// Map state names to their abbreviations for matching with our data
const STATE_NAME_TO_CODE: Record<string, string> = {
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

export function USStateMap({ stateData, onStateSelect }: USStateMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [hoveredState, setHoveredState] = useState<string | null>(null)
  const [selectedState, setSelectedState] = useState<string | null>(null)
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 })

  // Helper to check if mouse is on right half of container
  const isMouseOnRightSide = () => {
    if (!containerRef.current) return false
    const rect = containerRef.current.getBoundingClientRect()
    const containerMidpoint = rect.left + rect.width / 2
    return mousePosition.x > containerMidpoint
  }

  // Create a map for quick lookup by state code
  const dataMap = new Map(stateData.map(d => [d.state, d]))

  const getStateColor = (stateCode: string) => {
    const data = dataMap.get(stateCode)
    if (!data || data.orderCount === 0) {
      return "hsl(var(--muted))"
    }

    const avgDays = data.avgDeliveryTimeDays
    // Color coding: green < 3 days, blue 3-5 days, red > 5 days
    if (avgDays < 3) {
      return "hsl(142 71% 45%)" // green
    } else if (avgDays < 5) {
      return "hsl(203 61% 50%)" // jetpack blue
    } else {
      return "hsl(0 72% 51%)" // red
    }
  }

  const handleStateClick = (stateCode: string) => {
    const newState = selectedState === stateCode ? null : stateCode
    setSelectedState(newState)
    onStateSelect?.(newState)
  }

  const getStateOpacity = (stateCode: string) => {
    if (selectedState === stateCode) return 1
    if (hoveredState === stateCode) return 0.8
    if (selectedState && selectedState !== stateCode) return 0.4
    return 0.7
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <ComposableMap projection="geoAlbersUsa">
        <Geographies geography={geoUrl}>
          {({ geographies }) =>
            geographies.map((geo) => {
              const stateName = geo.properties.name
              const stateCode = STATE_NAME_TO_CODE[stateName] || ''
              const data = dataMap.get(stateCode)

              return (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  fill={getStateColor(stateCode)}
                  stroke="hsl(var(--background))"
                  strokeWidth={0.5}
                  style={{
                    default: {
                      outline: 'none',
                      opacity: getStateOpacity(stateCode),
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
                  onClick={() => handleStateClick(stateCode)}
                  onMouseEnter={() => setHoveredState(stateCode)}
                  onMouseLeave={() => setHoveredState(null)}
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
            <span className="text-[10px] font-semibold whitespace-nowrap">Avg Delivery:</span>
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
      {hoveredState && dataMap.has(hoveredState) && (() => {
        const flipToLeft = isMouseOnRightSide()
        const data = dataMap.get(hoveredState)!
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
                <div className="font-semibold">{data.stateName}</div>
                <div className="text-2xl font-bold tabular-nums">
                  {data.avgDeliveryTimeDays.toFixed(1)} days
                </div>
                <div className="text-xs text-muted-foreground">
                  Average delivery time
                </div>
                <div className="grid grid-cols-3 gap-2 pt-2 border-t">
                  <div>
                    <div className="text-xs text-muted-foreground">Orders</div>
                    <div className="font-semibold">{data.orderCount}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Shipped</div>
                    <div className="font-semibold">{data.shippedPercent.toFixed(0)}%</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Delivered</div>
                    <div className="font-semibold">{data.deliveredPercent.toFixed(0)}%</div>
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
