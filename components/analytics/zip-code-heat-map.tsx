"use client"

import { useState } from "react"
import { ComposableMap, Geographies, Geography, Marker } from "react-simple-maps"
import { Card, CardContent } from "@/components/ui/card"
import { ZipCodeVolumeData } from "@/lib/analytics/types"

const geoUrl = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json"

interface ZipCodeHeatMapProps {
  zipCodeData: ZipCodeVolumeData[]
  onZipSelect?: (zipCode: string) => void
}

// Heat map color scale: Blue → Cyan → Green → Yellow → Orange → Red
function getHeatMapColor(normalized: number): string {
  // normalized is 0-1, where 0 is lowest volume, 1 is highest

  if (normalized < 0.2) {
    // Blue → Cyan (0-20%)
    const t = normalized / 0.2
    const hue = 240 - (t * 60) // 240 (blue) to 180 (cyan)
    return `hsl(${hue}, 100%, 50%)`
  } else if (normalized < 0.4) {
    // Cyan → Green (20-40%)
    const t = (normalized - 0.2) / 0.2
    const hue = 180 - (t * 60) // 180 (cyan) to 120 (green)
    return `hsl(${hue}, 100%, 50%)`
  } else if (normalized < 0.6) {
    // Green → Yellow (40-60%)
    const t = (normalized - 0.4) / 0.2
    const hue = 120 - (t * 60) // 120 (green) to 60 (yellow)
    return `hsl(${hue}, 100%, 50%)`
  } else if (normalized < 0.8) {
    // Yellow → Orange (60-80%)
    const t = (normalized - 0.6) / 0.2
    const hue = 60 - (t * 30) // 60 (yellow) to 30 (orange)
    return `hsl(${hue}, 100%, 50%)`
  } else {
    // Orange → Red (80-100%)
    const t = (normalized - 0.8) / 0.2
    const hue = 30 - (t * 30) // 30 (orange) to 0 (red)
    return `hsl(${hue}, 100%, 50%)`
  }
}

export function ZipCodeHeatMap({ zipCodeData, onZipSelect }: ZipCodeHeatMapProps) {
  const [hoveredZip, setHoveredZip] = useState<string | null>(null)
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 })

  // Create a map for quick lookup
  const dataMap = new Map(zipCodeData.map(d => [d.zipCode, d]))

  // Find min and max order counts for normalization
  const orderCounts = zipCodeData.map(d => d.orderCount)
  const minOrders = Math.min(...orderCounts)
  const maxOrders = Math.max(...orderCounts)

  // Calculate marker size based on order count (logarithmic scale for better visualization)
  const getMarkerSize = (orderCount: number): number => {
    const normalized = (orderCount - minOrders) / (maxOrders - minOrders)
    return 2 + (normalized * 6) // Size range: 2-8
  }

  return (
    <div className="relative" onMouseMove={(e) => setMousePosition({ x: e.clientX, y: e.clientY })}>
      <ComposableMap
        projection="geoAlbersUsa"
        className="w-full h-auto"
        style={{ maxHeight: '500px' }}
      >
        {/* State outlines (light gray) */}
        <Geographies geography={geoUrl}>
          {({ geographies }) =>
            geographies.map((geo) => (
              <Geography
                key={geo.rsmKey}
                geography={geo}
                fill="transparent"
                stroke="hsl(var(--border))"
                strokeWidth={0.5}
                style={{
                  default: { outline: 'none' },
                  hover: { outline: 'none' },
                  pressed: { outline: 'none' },
                }}
              />
            ))
          }
        </Geographies>

        {/* Zip code markers */}
        {zipCodeData.map((zip) => {
          if (!zip.coordinates) return null

          const normalized = (zip.orderCount - minOrders) / (maxOrders - minOrders)
          const color = getHeatMapColor(normalized)
          const size = getMarkerSize(zip.orderCount)

          return (
            <Marker
              key={zip.zipCode}
              coordinates={zip.coordinates}
              onMouseEnter={() => setHoveredZip(zip.zipCode)}
              onMouseLeave={() => setHoveredZip(null)}
              onClick={() => onZipSelect?.(zip.zipCode)}
              style={{ cursor: onZipSelect ? 'pointer' : 'default' }}
            >
              <circle
                r={size}
                fill={color}
                fillOpacity={0.7}
                stroke={hoveredZip === zip.zipCode ? '#000' : 'transparent'}
                strokeWidth={hoveredZip === zip.zipCode ? 1.5 : 0}
                style={{
                  transition: 'all 0.2s ease',
                  filter: hoveredZip === zip.zipCode ? 'brightness(1.2)' : 'none'
                }}
              />
            </Marker>
          )
        })}
      </ComposableMap>

      {/* Legend */}
      <Card className="absolute bottom-2 left-2 w-auto">
        <CardContent className="p-2">
          <div className="space-y-2">
            <span className="text-[10px] font-semibold whitespace-nowrap block">Order Volume:</span>
            <div className="flex items-center gap-1">
              <span className="text-[9px] whitespace-nowrap">Low</span>
              <div className="w-24 h-3 rounded-sm" style={{
                background: "linear-gradient(to right, hsl(240, 100%, 50%), hsl(180, 100%, 50%), hsl(120, 100%, 50%), hsl(60, 100%, 50%), hsl(30, 100%, 50%), hsl(0, 100%, 50%))"
              }} />
              <span className="text-[9px] whitespace-nowrap">High</span>
            </div>
            <div className="text-[9px] text-muted-foreground mt-1">
              {zipCodeData.length} zip codes
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Hover tooltip */}
      {hoveredZip && dataMap.has(hoveredZip) && (
        <Card
          className="fixed w-64 pointer-events-none z-50"
          style={{
            left: `${mousePosition.x + 20}px`,
            top: `${mousePosition.y - 20}px`
          }}
        >
          <CardContent className="p-3">
            {(() => {
              const data = dataMap.get(hoveredZip)!
              const normalized = (data.orderCount - minOrders) / (maxOrders - minOrders)
              const color = getHeatMapColor(normalized)

              return (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <div className="font-semibold">{data.zipCode}</div>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {data.city}, {data.state}
                  </div>
                  <div className="text-2xl font-bold tabular-nums">
                    {data.orderCount.toLocaleString()} orders
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {data.percent.toFixed(2)}% of total volume
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
