"use client"

import { useState, useMemo, useRef } from "react"
import { ComposableMap, Geographies, Geography, Marker } from "react-simple-maps"
import { Card, CardContent } from "@/components/ui/card"
import { StateVolumeData, ZipCodeVolumeData } from "@/lib/analytics/types"

const geoUrl = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json"

interface LayeredVolumeHeatMapProps {
  stateData: StateVolumeData[]
  zipCodeData: ZipCodeVolumeData[]
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

export function LayeredVolumeHeatMap({ stateData, zipCodeData, onStateSelect }: LayeredVolumeHeatMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [hoveredState, setHoveredState] = useState<string | null>(null)
  const [hoveredZip, setHoveredZip] = useState<string | null>(null)
  const [selectedState, setSelectedState] = useState<string | null>(null)
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 })

  // Safety checks for data arrays
  const safeStateData = Array.isArray(stateData) ? stateData : []
  const safeZipCodeData = Array.isArray(zipCodeData) ? zipCodeData : []

  // Debug logging to understand the data structure
  console.log('LayeredVolumeHeatMap render - city data count:', safeZipCodeData.length)

  // Limit to top 500 cities to prevent overwhelming the map component
  // Data is already sorted by orderCount descending from aggregator
  const limitedZipCodeData = useMemo(() => {
    const limit = 500
    const limited = safeZipCodeData.slice(0, limit)
    if (safeZipCodeData.length > limit) {
      console.log(`Limited cities from ${safeZipCodeData.length} to ${limit} for performance`)
    }
    return limited
  }, [safeZipCodeData])

  // Pre-compute marker data with stable coordinate arrays
  const markerData = useMemo(() => {
    return limitedZipCodeData.map((zip) => {
      const hasCoords = zip.lon !== undefined && zip.lat !== undefined
      const hasOldCoords = zip.coordinates !== undefined

      if (!hasCoords && !hasOldCoords) {
        return null
      }

      // Create a plain array without type annotation to avoid any TypeScript/React issues
      const coords: [number, number] = hasCoords
        ? [zip.lon!, zip.lat!]
        : zip.coordinates!

      return {
        city: zip.city,
        state: zip.state,
        orderCount: zip.orderCount,
        cityKey: `${zip.city}|${zip.state}`,
        coordinates: coords
      }
    }).filter(Boolean)
  }, [limitedZipCodeData])

  // Check ALL cities for invalid coordinates
  const invalidZips = limitedZipCodeData.filter((zip, index) => {
    if (!zip || typeof zip.lon !== 'number' || typeof zip.lat !== 'number') {
      console.error(`Invalid city at index ${index}:`, zip)
      return true
    }
    if (isNaN(zip.lon) || isNaN(zip.lat) || !isFinite(zip.lon) || !isFinite(zip.lat)) {
      console.error(`Invalid coordinates at index ${index}:`, { city: zip.city, state: zip.state, lon: zip.lon, lat: zip.lat })
      return true
    }
    return false
  })

  console.log(`Found ${invalidZips.length} invalid cities out of ${limitedZipCodeData.length}`)

  // Create maps for quick lookup
  const stateDataMap = new Map(safeStateData.map(d => [d.state, d]))
  // Use city+state as key since cities can have same name in different states
  const zipDataMap = new Map(safeZipCodeData.map(d => [`${d.city}|${d.state}`, d]))

  // State coloring: white-to-green gradient based on state average
  const stateOrderCounts = safeStateData.map(d => d.orderCount).filter(count => typeof count === 'number')
  const minStateOrders = stateOrderCounts.length > 0 ? Math.min(...stateOrderCounts) : 0
  const maxStateOrders = stateOrderCounts.length > 0 ? Math.max(...stateOrderCounts) : 0

  const getStateColor = (stateCode: string) => {
    const data = stateDataMap.get(stateCode)
    if (!data || data.orderCount === 0 || maxStateOrders === minStateOrders) {
      // Light grey so empty states like Alaska are still visible
      return "hsl(142, 5%, 92%)"
    }

    // Grey-to-darker-green gradient (state averages)
    const normalized = (data.orderCount - minStateOrders) / (maxStateOrders - minStateOrders)
    const hue = 142
    const saturation = 8 + (normalized * 72) // 8% to 80% (starts with slight color)
    const lightness = 90 - (normalized * 55) // 90% to 35% (darker range)

    return `hsl(${hue}, ${saturation}%, ${lightness}%)`
  }

  // Zip code dot coloring: 3-tier system (blue, orange, red)
  const zipOrderCounts = limitedZipCodeData.map(d => d.orderCount).filter(count => typeof count === 'number')
  const minZipOrders = zipOrderCounts.length > 0 ? Math.min(...zipOrderCounts) : 0
  const maxZipOrders = zipOrderCounts.length > 0 ? Math.max(...zipOrderCounts) : 0

  const getZipDotColor = (orderCount: number): string => {
    if (maxZipOrders === minZipOrders) {
      return 'hsl(30, 100%, 50%)' // Default to orange if all values are the same
    }

    const normalized = (orderCount - minZipOrders) / (maxZipOrders - minZipOrders)

    if (normalized < 0.33) {
      return 'hsl(240, 100%, 50%)' // Blue (low)
    } else if (normalized < 0.67) {
      return 'hsl(30, 100%, 50%)' // Orange (medium)
    } else {
      return 'hsl(0, 100%, 50%)' // Red (high)
    }
  }

  const getZipDotSize = (orderCount: number): number => {
    if (maxZipOrders === minZipOrders) {
      return 4 // Default medium size if all values are the same
    }
    const normalized = (orderCount - minZipOrders) / (maxZipOrders - minZipOrders)
    return 2 + (normalized * 4) // Size range: 2-6px
  }

  const handleStateClick = (stateCode: string) => {
    setSelectedState(stateCode)
    onStateSelect(stateCode)
  }

  // Helper to check if mouse is on right half of container
  const isMouseOnRightSide = () => {
    if (!containerRef.current) return false
    const rect = containerRef.current.getBoundingClientRect()
    const containerMidpoint = rect.left + rect.width / 2
    return mousePosition.x > containerMidpoint
  }

  return (
    <div ref={containerRef} className="relative -mt-7 -mb-4" onMouseMove={(e) => setMousePosition({ x: e.clientX, y: e.clientY })}>
      <ComposableMap
        projection="geoAlbersUsa"
        className="w-full h-auto"
        style={{ maxHeight: '580px' }}
      >
        {/* Base layer: State fills with white-to-green gradient */}
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
                />
              )
            })
          }
        </Geographies>

        {/* Top layer: City dots (blue/orange/red) */}
        {markerData.map((marker) => {
          if (!marker) return null

          const color = getZipDotColor(marker.orderCount)
          const size = getZipDotSize(marker.orderCount)
          const isHovered = hoveredZip === marker.cityKey

          return (
            <Marker
              key={marker.cityKey}
              coordinates={marker.coordinates}
            >
              <circle
                r={size}
                fill={color}
                fillOpacity={0.8}
                stroke={isHovered ? '#000' : 'transparent'}
                strokeWidth={isHovered ? 1 : 0}
                onMouseEnter={() => {
                  setHoveredZip(marker.cityKey)
                  setHoveredState(null)
                }}
                onMouseLeave={() => setHoveredZip(null)}
                style={{
                  transition: 'all 0.2s ease',
                  filter: isHovered ? 'brightness(1.2)' : 'none',
                  cursor: 'pointer'
                }}
              />
            </Marker>
          )
        })}
      </ComposableMap>

      {/* Combined Legend */}
      <Card className="absolute bottom-1.5 w-auto shadow-md" style={{ left: '-15px' }}>
        <CardContent className="p-2 px-3">
          <div className="flex items-center gap-4">
            {/* State gradient legend */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold text-muted-foreground">States:</span>
              <span className="text-[9px] text-muted-foreground">Low</span>
              <div className="w-12 h-2.5 rounded-sm" style={{
                background: "linear-gradient(to right, hsl(142, 8%, 90%), hsl(142, 44%, 62%), hsl(142, 80%, 35%))"
              }} />
              <span className="text-[9px] text-muted-foreground">High</span>
            </div>
            {/* City dots legend */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold text-muted-foreground">Cities:</span>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: 'hsl(240, 100%, 50%)' }} />
                <span className="text-[9px] text-muted-foreground">Low</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: 'hsl(30, 100%, 50%)' }} />
                <span className="text-[9px] text-muted-foreground">Med</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: 'hsl(0, 100%, 50%)' }} />
                <span className="text-[9px] text-muted-foreground">High</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* State hover tooltip */}
      {hoveredState && !hoveredZip && stateDataMap.has(hoveredState) && (() => {
        const flipToLeft = isMouseOnRightSide()
        const data = stateDataMap.get(hoveredState)!
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
                <div className="text-xs text-muted-foreground">State Total:</div>
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
                <div className="text-xs text-muted-foreground italic pt-1 border-t">
                  Click to see top cities
                </div>
              </div>
            </CardContent>
          </Card>
        )
      })()}

      {/* City hover tooltip */}
      {hoveredZip && zipDataMap.has(hoveredZip) && (() => {
        const flipToLeft = isMouseOnRightSide()
        const data = zipDataMap.get(hoveredZip)!
        const color = getZipDotColor(data.orderCount)
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
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <div className="font-semibold">{data.city}</div>
                </div>
                <div className="text-sm text-muted-foreground">
                  {data.state}
                </div>
                <div className="text-2xl font-bold tabular-nums">
                  {data.orderCount.toLocaleString()} orders
                </div>
                <div className="text-xs text-muted-foreground">
                  {data.percent.toFixed(2)}% of total volume
                </div>
              </div>
            </CardContent>
          </Card>
        )
      })()}
    </div>
  )
}
