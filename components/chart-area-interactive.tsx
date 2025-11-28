"use client"

import * as React from "react"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"

import { useIsMobile } from "@/hooks/use-mobile"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group"
const chartData = [
  { date: "2024-04-01", orders: 372 },
  { date: "2024-04-02", orders: 277 },
  { date: "2024-04-03", orders: 287 },
  { date: "2024-04-04", orders: 502 },
  { date: "2024-04-05", orders: 663 },
  { date: "2024-04-06", orders: 641 },
  { date: "2024-04-07", orders: 425 },
  { date: "2024-04-08", orders: 729 },
  { date: "2024-04-09", orders: 169 },
  { date: "2024-04-10", orders: 451 },
  { date: "2024-04-11", orders: 677 },
  { date: "2024-04-12", orders: 502 },
  { date: "2024-04-13", orders: 722 },
  { date: "2024-04-14", orders: 357 },
  { date: "2024-04-15", orders: 290 },
  { date: "2024-04-16", orders: 328 },
  { date: "2024-04-17", orders: 806 },
  { date: "2024-04-18", orders: 774 },
  { date: "2024-04-19", orders: 423 },
  { date: "2024-04-20", orders: 239 },
  { date: "2024-04-21", orders: 337 },
  { date: "2024-04-22", orders: 394 },
  { date: "2024-04-23", orders: 368 },
  { date: "2024-04-24", orders: 677 },
  { date: "2024-04-25", orders: 465 },
  { date: "2024-04-26", orders: 205 },
  { date: "2024-04-27", orders: 803 },
  { date: "2024-04-28", orders: 302 },
  { date: "2024-04-29", orders: 555 },
  { date: "2024-04-30", orders: 834 },
  { date: "2024-05-01", orders: 385 },
  { date: "2024-05-02", orders: 603 },
  { date: "2024-05-03", orders: 437 },
  { date: "2024-05-04", orders: 805 },
  { date: "2024-05-05", orders: 871 },
  { date: "2024-05-06", orders: 1018 },
  { date: "2024-05-07", orders: 688 },
  { date: "2024-05-08", orders: 359 },
  { date: "2024-05-09", orders: 407 },
  { date: "2024-05-10", orders: 623 },
  { date: "2024-05-11", orders: 605 },
  { date: "2024-05-12", orders: 437 },
  { date: "2024-05-13", orders: 357 },
  { date: "2024-05-14", orders: 938 },
  { date: "2024-05-15", orders: 853 },
  { date: "2024-05-16", orders: 738 },
  { date: "2024-05-17", orders: 919 },
  { date: "2024-05-18", orders: 665 },
  { date: "2024-05-19", orders: 415 },
  { date: "2024-05-20", orders: 407 },
  { date: "2024-05-21", orders: 222 },
  { date: "2024-05-22", orders: 201 },
  { date: "2024-05-23", orders: 542 },
  { date: "2024-05-24", orders: 514 },
  { date: "2024-05-25", orders: 451 },
  { date: "2024-05-26", orders: 383 },
  { date: "2024-05-27", orders: 880 },
  { date: "2024-05-28", orders: 423 },
  { date: "2024-05-29", orders: 208 },
  { date: "2024-05-30", orders: 620 },
  { date: "2024-05-31", orders: 408 },
  { date: "2024-06-01", orders: 378 },
  { date: "2024-06-02", orders: 880 },
  { date: "2024-06-03", orders: 263 },
  { date: "2024-06-04", orders: 819 },
  { date: "2024-06-05", orders: 228 },
  { date: "2024-06-06", orders: 544 },
  { date: "2024-06-07", orders: 693 },
  { date: "2024-06-08", orders: 705 },
  { date: "2024-06-09", orders: 918 },
  { date: "2024-06-10", orders: 355 },
  { date: "2024-06-11", orders: 242 },
  { date: "2024-06-12", orders: 912 },
  { date: "2024-06-13", orders: 211 },
  { date: "2024-06-14", orders: 806 },
  { date: "2024-06-15", orders: 657 },
  { date: "2024-06-16", orders: 681 },
  { date: "2024-06-17", orders: 995 },
  { date: "2024-06-18", orders: 277 },
  { date: "2024-06-19", orders: 631 },
  { date: "2024-06-20", orders: 858 },
  { date: "2024-06-21", orders: 379 },
  { date: "2024-06-22", orders: 587 },
  { date: "2024-06-23", orders: 1010 },
  { date: "2024-06-24", orders: 312 },
  { date: "2024-06-25", orders: 331 },
  { date: "2024-06-26", orders: 814 },
  { date: "2024-06-27", orders: 938 },
  { date: "2024-06-28", orders: 349 },
  { date: "2024-06-29", orders: 263 },
  { date: "2024-06-30", orders: 846 },
]

const chartConfig = {
  orders: {
    label: "Orders",
    color: "hsl(25 80% 64%)",
  },
} satisfies ChartConfig

export function ChartAreaInteractive() {
  const isMobile = useIsMobile()
  const [timeRange, setTimeRange] = React.useState("30d")

  React.useEffect(() => {
    if (isMobile) {
      setTimeRange("7d")
    }
  }, [isMobile])

  const filteredData = chartData.filter((item) => {
    const date = new Date(item.date)
    const referenceDate = new Date("2024-06-30")
    let daysToSubtract = 90
    if (timeRange === "30d") {
      daysToSubtract = 30
    } else if (timeRange === "7d") {
      daysToSubtract = 7
    }
    const startDate = new Date(referenceDate)
    startDate.setDate(startDate.getDate() - daysToSubtract)
    return date >= startDate
  })

  return (
    <Card className="@container/card">
      <CardHeader className="relative">
        <CardTitle>Order Volume</CardTitle>
        <CardDescription>
          <span className="@[540px]/card:block hidden">
            Total for the last 3 months
          </span>
          <span className="@[540px]/card:hidden">Last 3 months</span>
        </CardDescription>
        <div className="absolute right-4 top-4">
          <ToggleGroup
            type="single"
            value={timeRange}
            onValueChange={setTimeRange}
            variant="outline"
            className="@[767px]/card:flex hidden"
          >
            <ToggleGroupItem value="90d" className="h-8 px-2.5">
              Last 3 months
            </ToggleGroupItem>
            <ToggleGroupItem value="30d" className="h-8 px-2.5">
              Last 30 days
            </ToggleGroupItem>
            <ToggleGroupItem value="7d" className="h-8 px-2.5">
              Last 7 days
            </ToggleGroupItem>
          </ToggleGroup>
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger
              className="@[767px]/card:hidden flex w-40"
              aria-label="Select a value"
            >
              <SelectValue placeholder="Last 3 months" />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="90d" className="rounded-lg">
                Last 3 months
              </SelectItem>
              <SelectItem value="30d" className="rounded-lg">
                Last 30 days
              </SelectItem>
              <SelectItem value="7d" className="rounded-lg">
                Last 7 days
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        <ChartContainer
          config={chartConfig}
          className="aspect-auto h-[250px] w-full"
        >
          <AreaChart data={filteredData} margin={{ top: 20, right: 0, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="fillOrders" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-orders)"
                  stopOpacity={0.5}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-orders)"
                  stopOpacity={0.1}
                />
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
                const date = new Date(value)
                return date.toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })
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
                    return new Date(value).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })
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
      </CardContent>
    </Card>
  )
}
