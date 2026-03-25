"use client"

import { TrendingDownIcon, TrendingUpIcon } from "lucide-react"
import { Area, AreaChart, ResponsiveContainer } from "recharts"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardHeader,
  CardDescription,
  CardTitle,
} from "@/components/ui/card"

interface KPIData {
  avgCostPerOrder: number
  avgTransitTime: number
  slaPercent: number
  orderCount: number
  periodChange: {
    avgCostPerOrder: number
    avgTransitTime: number
    slaPercent: number
    orderCount: number
  }
}

export interface DailyTrends {
  cost: { value: number }[]
  transit: { value: number }[]
  sla: { value: number }[]
  orders: { value: number }[]
}

interface SectionCardsProps {
  data: KPIData | null
  isLoading: boolean
  trends: DailyTrends | null
}

function ChangeBadge({ value, invertColor }: { value: number; invertColor?: boolean }) {
  if (value === 0) return null
  const isPositive = value > 0
  // For transit time, down is good (invertColor)
  const isGood = invertColor ? !isPositive : isPositive
  const Icon = isPositive ? TrendingUpIcon : TrendingDownIcon
  return (
    <Badge variant="outline" className={`flex gap-1 rounded-lg text-xs ${isGood ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
      <Icon className="size-3" />
      {isPositive ? '+' : ''}{value.toFixed(1)}%
    </Badge>
  )
}

// Downsample to ~12 points max so sparklines stay smooth regardless of date range
function downsample(data: { value: number }[], maxPoints = 12): { value: number }[] {
  if (data.length <= maxPoints) return data
  const step = data.length / maxPoints
  const result: { value: number }[] = []
  for (let i = 0; i < maxPoints; i++) {
    const start = Math.floor(i * step)
    const end = Math.floor((i + 1) * step)
    const slice = data.slice(start, end)
    const avg = slice.reduce((s, d) => s + d.value, 0) / slice.length
    result.push({ value: avg })
  }
  return result
}

function Sparkline({ data, color = "hsl(204 61% 50%)" }: { data: { value: number }[]; color?: string }) {
  if (!data || data.length < 2) return null
  const smoothed = downsample(data)
  return (
    <ResponsiveContainer width="100%" height={120}>
      <AreaChart data={smoothed} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
        <Area
          type="natural"
          dataKey="value"
          stroke={color}
          fill={color}
          fillOpacity={0.1}
          strokeWidth={2}
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function SkeletonValue() {
  return <div className="h-8 w-24 bg-muted animate-pulse rounded" />
}

function SkeletonChart() {
  return <div className="h-[120px] w-full bg-muted/50 animate-pulse" />
}

export function SectionCards({ data, isLoading, trends }: SectionCardsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 md:gap-4 px-2 md:px-4 lg:px-6 w-full max-w-full">
      {/* Avg. Cost/Order */}
      <Card className="@container/card overflow-hidden min-w-0">
        <CardHeader className="relative">
          <CardDescription>Avg. Cost/Order</CardDescription>
          <CardTitle className="@[250px]/card:text-3xl text-2xl font-semibold tabular-nums">
            {isLoading ? <SkeletonValue /> : `$${(data?.avgCostPerOrder ?? 0).toFixed(2)}`}
          </CardTitle>
          {!isLoading && data && (
            <div className="absolute right-4 top-4">
              <ChangeBadge value={data.periodChange.avgCostPerOrder} invertColor />
            </div>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? <SkeletonChart /> : <Sparkline data={trends?.cost ?? []} />}
        </CardContent>
      </Card>

      {/* Avg. Transit Time */}
      <Card className="@container/card overflow-hidden min-w-0">
        <CardHeader className="relative">
          <CardDescription>Avg. Transit Time</CardDescription>
          <CardTitle className="@[250px]/card:text-3xl text-2xl font-semibold tabular-nums">
            {isLoading ? <SkeletonValue /> : `${(data?.avgTransitTime ?? 0).toFixed(1)} days`}
          </CardTitle>
          {!isLoading && data && (
            <div className="absolute right-4 top-4">
              <ChangeBadge value={data.periodChange.avgTransitTime} invertColor />
            </div>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? <SkeletonChart /> : <Sparkline data={trends?.transit ?? []} />}
        </CardContent>
      </Card>

      {/* Fulfilled On Time */}
      <Card className="@container/card overflow-hidden min-w-0">
        <CardHeader className="relative">
          <CardDescription>Fulfilled On Time</CardDescription>
          <CardTitle className="@[250px]/card:text-3xl text-2xl font-semibold tabular-nums">
            {isLoading ? <SkeletonValue /> : `${(data?.slaPercent ?? 0).toFixed(1)}%`}
          </CardTitle>
          {!isLoading && data && (
            <div className="absolute right-4 top-4">
              <ChangeBadge value={data.periodChange.slaPercent} />
            </div>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? <SkeletonChart /> : <Sparkline data={trends?.sla ?? []} />}
        </CardContent>
      </Card>

      {/* Order Count */}
      <Card className="@container/card overflow-hidden min-w-0">
        <CardHeader className="relative">
          <CardDescription>Orders</CardDescription>
          <CardTitle className="@[250px]/card:text-3xl text-2xl font-semibold tabular-nums">
            {isLoading ? <SkeletonValue /> : (data?.orderCount ?? 0).toLocaleString()}
          </CardTitle>
          {!isLoading && data && (
            <div className="absolute right-4 top-4">
              <ChangeBadge value={data.periodChange.orderCount} />
            </div>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? <SkeletonChart /> : <Sparkline data={trends?.orders ?? []} />}
        </CardContent>
      </Card>
    </div>
  )
}
