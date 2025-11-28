"use client"

import { TrendingDownIcon, TrendingUpIcon } from "lucide-react"
import { Area, AreaChart, ResponsiveContainer } from "recharts"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

interface KPICardProps {
  title: string
  value: string | number
  change?: number // percentage change
  format?: 'currency' | 'number' | 'percent' | 'duration'
}

export function KPICard({
  title,
  value,
  change,
  format = 'number',
}: KPICardProps) {
  // Format the value based on type
  const formattedValue = formatValue(value, format)

  // Generate trend data based on value and change
  const trendData = generateTrendData(value, change)

  // Determine if change is positive or negative
  const isPositiveChange = change !== undefined && change > 0
  const isNegativeChange = change !== undefined && change < 0

  return (
    <Card className="@container/card overflow-hidden min-w-0">
      <CardHeader className="relative pb-2">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="@[250px]/card:text-3xl text-2xl font-semibold tabular-nums">
          {formattedValue}
        </CardTitle>
        {change !== undefined && (
          <div className="absolute right-4 top-4">
            <Badge variant="outline" className="flex gap-1 rounded-lg text-xs">
              {isPositiveChange && <TrendingUpIcon className="size-3" />}
              {isNegativeChange && <TrendingDownIcon className="size-3" />}
              {isPositiveChange ? '+' : ''}{change.toFixed(1)}%
            </Badge>
          </div>
        )}
      </CardHeader>
      <CardContent className="p-0">
        <ResponsiveContainer width="100%" height={80}>
          <AreaChart data={trendData} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
            <Area
              type="monotone"
              dataKey="value"
              stroke="hsl(204 61% 50%)"
              fill="hsl(204 61% 50%)"
              fillOpacity={0.1}
              strokeWidth={2}
              dot={{
                fill: "#ffffff",
                fillOpacity: 1,
                stroke: "hsl(204 61% 50%)",
                strokeWidth: 2,
                r: 3,
              }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}

function formatValue(value: string | number, format: string): string {
  if (typeof value === 'string') return value

  switch (format) {
    case 'currency':
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(value)
    case 'percent':
      return `${value.toFixed(1)}%`
    case 'duration':
      return `${value.toFixed(1)} days`
    case 'number':
    default:
      return new Intl.NumberFormat('en-US').format(value)
  }
}

function generateTrendData(value: string | number, change?: number): Array<{ value: number }> {
  const numValue = typeof value === 'string' ? parseFloat(value) : value
  const changePercent = change || 0

  // Generate 6 data points showing a trend
  const points = 6
  const data: Array<{ value: number }> = []

  // Calculate the starting value based on the change percentage
  // If change is +10%, then start value is current / 1.10
  const startValue = changePercent !== 0
    ? numValue / (1 + changePercent / 100)
    : numValue

  for (let i = 0; i < points; i++) {
    // Create a smooth progression from start to current value
    const progress = i / (points - 1)
    const trendValue = startValue + (numValue - startValue) * progress

    // Add some realistic variance (±3%)
    const variance = (Math.random() - 0.5) * 0.06 * trendValue
    data.push({
      value: trendValue + variance
    })
  }

  // Ensure the last point is exactly the current value
  data[points - 1].value = numValue

  return data
}
