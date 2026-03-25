"use client"

import * as React from "react"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"

import {
  Card,
  CardContent,
} from "@/components/ui/card"
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"

const chartConfig = {
  orders: {
    label: "Orders",
    color: "hsl(25 80% 64%)",
  },
} satisfies ChartConfig

interface DailyVolume {
  date: string
  orders: number
}

interface ChartAreaInteractiveProps {
  data: DailyVolume[]
  isLoading: boolean
}

export function ChartAreaInteractive({ data, isLoading }: ChartAreaInteractiveProps) {
  return (
    <Card>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        {isLoading ? (
          <div className="h-[250px] flex items-center justify-center">
            <div className="text-sm text-muted-foreground">Loading...</div>
          </div>
        ) : data.length === 0 ? (
          <div className="h-[250px] flex items-center justify-center">
            <div className="text-sm text-muted-foreground">No order volume data</div>
          </div>
        ) : (
          <ChartContainer
            config={chartConfig}
            className="aspect-auto h-[250px] w-full"
          >
            <AreaChart data={data} margin={{ top: 20, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="fillOrders" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-orders)" stopOpacity={0.5} />
                  <stop offset="95%" stopColor="var(--color-orders)" stopOpacity={0.1} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={32}
                tickFormatter={(value) => {
                  const date = new Date(value + 'T00:00:00')
                  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
                }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => value === 0 ? '' : value}
                mirror={true}
                tick={{
                  fill: 'hsl(var(--muted-foreground))',
                  opacity: 0.5,
                  fontSize: 12,
                  dx: -8,
                  dy: -10,
                  textAnchor: 'start'
                }}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) => {
                      return new Date(value + 'T00:00:00').toLocaleDateString("en-US", { month: "short", day: "numeric" })
                    }}
                    indicator="dot"
                  />
                }
              />
              <Area
                dataKey="orders"
                type="natural"
                fill="url(#fillOrders)"
                stroke="var(--color-orders)"
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
