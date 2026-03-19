"use client"

import { Info } from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export function KpiTooltip({ text }: { text: string }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Info className="w-2.5 h-2.5 inline-block ml-0.5 -mt-px text-zinc-400 hover:text-zinc-500 dark:hover:text-zinc-300 cursor-help" />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[220px] text-[11px] leading-snug bg-slate-700 dark:bg-slate-700 text-white">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export const KPI_TOOLTIPS = {
  lastMile: "Time from first carrier truck or sort center scan through to customer delivery",
  middleMile: "Sortation, consolidation, and trucking to sort centers closer to your end customer",
  fulfillTime: "Warehouse business hours from order import until package is picked, packed, labelled, and ready for transport",
  orderToDelivery: "Total calendar days from order import to delivery",
  vsBenchmark: "Your last mile transit time vs. the network average for the same carrier, zone, and time period",
  includeDelays: "Include orders delayed by out-of-stock inventory. Excluded by default to avoid inflating averages.",
} as const
