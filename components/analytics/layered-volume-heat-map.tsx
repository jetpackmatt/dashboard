"use client"

import { useState, useMemo, useRef, useCallback } from "react"
import React from "react"
import { ComposableMap, Geographies, Geography, Marker } from "react-simple-maps"
import { Card, CardContent } from "@/components/ui/card"
import { StateVolumeData, ZipCodeVolumeData } from "@/lib/analytics/types"
import { COUNTRY_CONFIGS } from "@/lib/analytics/geo-config"

// Error boundary to catch react-simple-maps projection crashes (e.g. geoAlbersUsa returns null for out-of-bounds coords)
class MarkerErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  render() { return this.state.hasError ? null : this.props.children }
}

interface LayeredVolumeHeatMapProps {
  stateData: StateVolumeData[]
  zipCodeData: ZipCodeVolumeData[]
  onStateSelect: (stateCode: string) => void
  country?: string
}

export function LayeredVolumeHeatMap({ stateData, zipCodeData, onStateSelect, country = 'US' }: LayeredVolumeHeatMapProps) {
  const config = COUNTRY_CONFIGS[country] || COUNTRY_CONFIGS['US']
  const containerRef = useRef<HTMLDivElement>(null)
  const mouseRef = useRef({ x: 0, y: 0 })
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [hoveredState, setHoveredState] = useState<string | null>(null)
  const [hoveredZip, setHoveredZip] = useState<string | null>(null)
  const [selectedState, setSelectedState] = useState<string | null>(null)

  // Safety checks for data arrays
  const safeStateData = Array.isArray(stateData) ? stateData : []
  const safeZipCodeData = Array.isArray(zipCodeData) ? zipCodeData : []

  // Limit to top 200 cities for performance (fewer DOM nodes = faster mount/unmount)
  const limitedZipCodeData = useMemo(() => {
    return safeZipCodeData.slice(0, 200)
  }, [safeZipCodeData])

  // Update tooltip position via ref (no re-renders)
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    mouseRef.current = { x: e.clientX, y: e.clientY }
    if (tooltipRef.current) {
      const flipToLeft = containerRef.current
        ? e.clientX > containerRef.current.getBoundingClientRect().left + containerRef.current.getBoundingClientRect().width / 2
        : false
      tooltipRef.current.style.left = flipToLeft ? `${e.clientX - 276}px` : `${e.clientX + 20}px`
      tooltipRef.current.style.top = `${e.clientY - 20}px`
    }
  }, [])

  // Pre-compute marker data with stable coordinate arrays
  // Filter to coordinates valid for the current country's bounding box
  const markerData = useMemo(() => {
    return limitedZipCodeData.map((zip) => {
      const lon = typeof zip.lon === 'number' && isFinite(zip.lon) ? zip.lon : null
      const lat = typeof zip.lat === 'number' && isFinite(zip.lat) ? zip.lat : null

      if (lon === null || lat === null) {
        if (!Array.isArray(zip.coordinates) || zip.coordinates.length < 2) return null
        return {
          city: zip.city,
          state: zip.state,
          orderCount: zip.orderCount,
          cityKey: `${zip.city}|${zip.state}`,
          coordinates: [zip.coordinates[0], zip.coordinates[1]] as [number, number],
        }
      }

      // geoAlbersUsa crashes on coordinates outside US bounds — filter by country bbox
      if (country === 'US' && (lat < 24 || lat > 72 || lon < -180 || lon > -60)) return null
      if (country === 'CA' && (lat < 41 || lat > 84 || lon < -141 || lon > -52)) return null

      return {
        city: zip.city,
        state: zip.state,
        orderCount: zip.orderCount,
        cityKey: `${zip.city}|${zip.state}`,
        coordinates: [lon, lat] as [number, number],
      }
    }).filter(Boolean)
  }, [limitedZipCodeData, country])

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

  // Zip code dot coloring: percentile-based 3-tier system (blue, orange, red)
  // Using percentiles instead of linear min/max so the tiers are evenly populated
  const { p60Threshold, p85Threshold, minZipOrders, maxZipOrders } = useMemo(() => {
    const counts = limitedZipCodeData.map(d => d.orderCount).filter(c => typeof c === 'number').sort((a, b) => a - b)
    if (counts.length === 0) return { p60Threshold: 0, p85Threshold: 0, minZipOrders: 0, maxZipOrders: 0 }
    return {
      p60Threshold: counts[Math.floor(counts.length * 0.60)] || 0,
      p85Threshold: counts[Math.floor(counts.length * 0.85)] || 0,
      minZipOrders: counts[0],
      maxZipOrders: counts[counts.length - 1],
    }
  }, [limitedZipCodeData])

  const getZipDotColor = (orderCount: number): string => {
    if (orderCount >= p85Threshold) return 'hsl(0, 100%, 50%)'    // Red (top 15%)
    if (orderCount >= p60Threshold) return 'hsl(30, 100%, 50%)'   // Orange (middle 25%)
    return 'hsl(240, 100%, 50%)'                                   // Blue (bottom 60%)
  }

  const getZipDotSize = (orderCount: number): number => {
    if (maxZipOrders === minZipOrders) return 4
    // Log scale so small cities aren't invisible
    const logNorm = Math.log(1 + orderCount - minZipOrders) / Math.log(1 + maxZipOrders - minZipOrders)
    return 2 + (logNorm * 4) // 2-6px
  }

  const handleStateClick = (stateCode: string) => {
    setSelectedState(stateCode)
    onStateSelect(stateCode)
  }

  return (
    <div ref={containerRef} className="relative -mt-7 -mb-4" onMouseMove={handleMouseMove}>
      <ComposableMap
        projection={config.projection as any}
        projectionConfig={config.projectionConfig as any}
        className="w-full h-auto"
        style={{ maxHeight: '580px' }}
      >
        {/* Base layer: State/Province fills with white-to-green gradient */}
        <Geographies geography={config.geoUrl}>
          {({ geographies }) =>
            geographies.map((geo) => {
              const regionName = geo.properties.name
              const stateCode = config.nameToCode[regionName]
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
            <MarkerErrorBoundary key={marker.cityKey}>
              <Marker
                coordinates={marker.coordinates}
              >
                <circle
                  r={isHovered ? size + 1 : size}
                  fill={color}
                  fillOpacity={isHovered ? 1 : 0.8}
                  stroke={isHovered ? '#000' : 'transparent'}
                  strokeWidth={isHovered ? 1 : 0}
                  onMouseEnter={() => {
                    setHoveredZip(marker.cityKey)
                    setHoveredState(null)
                  }}
                  onMouseLeave={() => setHoveredZip(null)}
                  style={{ cursor: 'pointer' }}
                />
              </Marker>
            </MarkerErrorBoundary>
          )
        })}
      </ComposableMap>

      {/* Combined Legend */}
      <div className="pl-10 -mt-9 relative z-[2]">
        <div className="flex items-center gap-4">
          {/* State gradient legend */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold text-muted-foreground">States:</span>
            <span className="text-[9px] text-muted-foreground">Low Volume</span>
            <div className="w-12 h-2.5 rounded-sm" style={{
              background: "linear-gradient(to right, hsl(142, 8%, 90%), hsl(142, 44%, 62%), hsl(142, 80%, 35%))"
            }} />
            <span className="text-[9px] text-muted-foreground">High Volume</span>
          </div>
          {/* City dots legend */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold text-muted-foreground">Cities:</span>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: 'hsl(240, 100%, 50%)' }} />
              <span className="text-[9px] text-muted-foreground">Low Volume</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: 'hsl(30, 100%, 50%)' }} />
              <span className="text-[9px] text-muted-foreground">Medium Volume</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: 'hsl(0, 100%, 50%)' }} />
              <span className="text-[9px] text-muted-foreground">High Volume</span>
            </div>
          </div>
        </div>
      </div>

      {/* Hover tooltip (shared ref for positioning) */}
      {hoveredState && !hoveredZip && stateDataMap.has(hoveredState) && (() => {
        const data = stateDataMap.get(hoveredState)!
        return (
          <Card ref={tooltipRef} className="fixed w-64 pointer-events-none z-50">
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

      {hoveredZip && zipDataMap.has(hoveredZip) && (() => {
        const data = zipDataMap.get(hoveredZip)!
        const color = getZipDotColor(data.orderCount)
        return (
          <Card ref={tooltipRef} className="fixed w-64 pointer-events-none z-50">
            <CardContent className="p-3">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                  <div className="font-semibold">{data.city}</div>
                </div>
                <div className="text-sm text-muted-foreground">{data.state}</div>
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
