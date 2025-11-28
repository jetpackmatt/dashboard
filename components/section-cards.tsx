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

const costData = [
  { value: 38 },
  { value: 42 },
  { value: 40 },
  { value: 45 },
  { value: 43 },
  { value: 42.5 },
]

const transitData = [
  { value: 3.5 },
  { value: 3.8 },
  { value: 3.2 },
  { value: 3.6 },
  { value: 3.1 },
  { value: 3.2 },
]

const fulfillmentData = [
  { value: 92 },
  { value: 93 },
  { value: 94 },
  { value: 93.5 },
  { value: 94.2 },
  { value: 94.5 },
]

const growthData = [
  { value: 8 },
  { value: 9.5 },
  { value: 10.2 },
  { value: 11 },
  { value: 11.8 },
  { value: 12.3 },
]

export function SectionCards() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 md:gap-4 px-2 md:px-4 lg:px-6 w-full max-w-full">
      {/* Avg. Cost/Order */}
      <Card className="@container/card overflow-hidden min-w-0">
        <CardHeader className="relative">
          <CardDescription>Avg. Cost/Order</CardDescription>
          <CardTitle className="@[250px]/card:text-3xl text-2xl font-semibold tabular-nums">
            $8.29
          </CardTitle>
          <div className="absolute right-4 top-4">
            <Badge variant="outline" className="flex gap-1 rounded-lg text-xs">
              <TrendingUpIcon className="size-3" />
              +5.2%
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ResponsiveContainer width="100%" height={120}>
            <AreaChart data={costData} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
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
                  r: 4,
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Avg. Transit Time */}
      <Card className="@container/card overflow-hidden min-w-0">
        <CardHeader className="relative">
          <CardDescription>Avg. Transit Time</CardDescription>
          <CardTitle className="@[250px]/card:text-3xl text-2xl font-semibold tabular-nums">
            3.2 days
          </CardTitle>
          <div className="absolute right-4 top-4">
            <Badge variant="outline" className="flex gap-1 rounded-lg text-xs">
              <TrendingDownIcon className="size-3" />
              -8.6%
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ResponsiveContainer width="100%" height={120}>
            <AreaChart data={transitData} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
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
                  r: 4,
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Fulfilled On Time */}
      <Card className="@container/card overflow-hidden min-w-0">
        <CardHeader className="relative">
          <CardDescription>Fulfilled On Time</CardDescription>
          <CardTitle className="@[250px]/card:text-3xl text-2xl font-semibold tabular-nums">
            99.4%
          </CardTitle>
          <div className="absolute right-4 top-4">
            <Badge variant="outline" className="flex gap-1 rounded-lg text-xs">
              <TrendingUpIcon className="size-3" />
              +2.4%
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ResponsiveContainer width="100%" height={120}>
            <AreaChart data={fulfillmentData} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
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
                  r: 4,
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Monthly Growth Rate */}
      <Card className="@container/card overflow-hidden min-w-0">
        <CardHeader className="relative">
          <CardDescription>Monthly Growth Rate</CardDescription>
          <CardTitle className="@[250px]/card:text-3xl text-2xl font-semibold tabular-nums">
            +12.3%
          </CardTitle>
          <div className="absolute right-4 top-4">
            <Badge variant="outline" className="flex gap-1 rounded-lg text-xs">
              <TrendingUpIcon className="size-3" />
              +12.3%
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ResponsiveContainer width="100%" height={120}>
            <AreaChart data={growthData} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
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
                  r: 4,
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  )
}
