"use client"

import { useState } from "react"
import { ComposableMap, Geographies, Geography } from "react-simple-maps"
import { Card, CardContent } from "@/components/ui/card"
import { StateVolumeData } from "@/lib/analytics/types"

const geoUrl = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json"

interface StateVolumeHeatMapProps {
  stateData: StateVolumeData[]
  onStateSelect: (stateCode: string) => void
}

// State name to abbreviation mapping
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

export function StateVolumeHeatMap({ stateData, onStateSelect }: StateVolumeHeatMapProps) {
  const [hoveredState, setHoveredState] = useState<string | null>(null)
  const [selectedState, setSelectedState] = useState<string | null>(null)
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 })

  // Create a map for quick lookup by state code
  const dataMap = new Map(stateData.map(d => [d.state, d]))

  // Find min and max order counts for color scaling
  const orderCounts = stateData.map(d => d.orderCount)
  const minOrders = Math.min(...orderCounts)
  const maxOrders = Math.max(...orderCounts)

  const getStateColor = (stateCode: string) => {
    const data = dataMap.get(stateCode)

    if (!data || data.orderCount === 0) {
      return "hsl(var(--muted))"
    }

    // Calculate normalized value (0-1) for color interpolation
    const normalized = (data.orderCount - minOrders) / (maxOrders - minOrders)

    // White to green gradient
    // White: hsl(0, 0%, 100%)
    // Green: hsl(142, 71%, 45%)

    // Interpolate from white to green
    const hue = 142
    const saturation = normalized * 71 // 0% to 71%
    const lightness = 100 - (normalized * 55) // 100% to 45%

    return `hsl(${hue}, ${saturation}%, ${lightness}%)`
  }

  const handleStateClick = (stateCode: string) => {
    setSelectedState(stateCode)
    onStateSelect(stateCode)
  }

  return (
    <div className="relative">
      <ComposableMap
        projection="geoAlbersUsa"
        className="w-full h-auto"
        style={{ maxHeight: '500px' }}
      >
        <Geographies geography={geoUrl}>
          {({ geographies }) =>
            geographies.map((geo) => {
              const stateName = geo.properties.name
              const stateCode = stateNameToCode[stateName]
              const isSelected = selectedState === stateCode
              const isHovered = hoveredState === stateCode

              return (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  fill={getStateColor(stateCode)}
                  stroke={isSelected ? '#328bcb' : isHovered ? '#000' : '#fff'}
                  strokeWidth={isSelected ? 2 : isHovered ? 1.5 : 0.5}
                  style={{
                    default: {
                      outline: 'none',
                      opacity: isSelected ? 1 : 0.9,
                    },
                    hover: {
                      outline: 'none',
                      opacity: 1,
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
          <div className="space-y-2">
            <span className="text-[10px] font-semibold whitespace-nowrap block">Order Volume:</span>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: "hsl(142, 0%, 100%)" }} />
                <span className="text-[10px] whitespace-nowrap">Low</span>
              </div>
              <div className="w-16 h-3 rounded-sm" style={{
                background: "linear-gradient(to right, hsl(142, 0%, 100%), hsl(142, 35%, 72%), hsl(142, 71%, 45%))"
              }} />
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: "hsl(142, 71%, 45%)" }} />
                <span className="text-[10px] whitespace-nowrap">High</span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded-sm bg-muted" />
              <span className="text-[10px] whitespace-nowrap">No data</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Hover tooltip */}
      {hoveredState && dataMap.has(hoveredState) && (
        <Card
          className="fixed w-64 pointer-events-none z-50"
          style={{
            left: `${mousePosition.x + 20}px`,
            top: `${mousePosition.y - 20}px`
          }}
        >
          <CardContent className="p-3">
            {(() => {
              const data = dataMap.get(hoveredState)!
              return (
                <div className="space-y-2">
                  <div className="font-semibold">{data.stateName}</div>
                  <div className="text-2xl font-bold tabular-nums">
                    {data.orderCount.toLocaleString()} orders
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <div className="text-muted-foreground">% of Total</div>
                      <div className="font-semibold tabular-nums">{data.percent.toFixed(1)}%</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Avg/Day</div>
                      <div className="font-semibold tabular-nums">{data.avgOrdersPerDay.toFixed(1)}</div>
                    </div>
                  </div>
                </div>
              )
            })()}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
