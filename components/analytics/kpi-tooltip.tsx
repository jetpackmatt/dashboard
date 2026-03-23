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
  orderToDelivery: "Calendar days from order import to delivery, shown as median, mean, and percentile breakdowns to capture the full range of customer experience.",
  vsBenchmark: "Your last mile transit time vs. the network average for the same carrier, zone, and time period",
  includeDelays: "Include orders delayed by out-of-stock inventory. Excluded by default to avoid inflating averages.",
  // Financials tab
  totalCost: "Total fulfillment charges across all fee categories (shipping, pick & pack, storage, surcharges, etc.) for the selected period.",
  orders: "Number of orders shipped during the selected period. Does not include cancelled or unshipped orders.",
  costPerOrder: "Total fulfillment cost divided by the number of orders shipped. Includes all fee categories — shipping, picks, storage, surcharges, and other charges.",
  costPerItem: "Total fulfillment cost divided by the total number of items shipped.",
  itemsPerOrder: "Average number of individual items (units) per order.",
  pctOfRevenue: "Total fulfillment cost as a percentage of gross revenue. Only orders with available order values are used in this calculation, as not all sales channels provide them.",
  revPerOrder: "Average gross revenue per order, calculated from your store's order totals. Only orders with available order values are used in this calculation, as not all sales channels provide them.",
  surcharges: "Carrier surcharges (fuel, residential, oversize, peak, etc.) as a percentage of total fulfillment cost. These are fees added on top of base shipping rates.",
  credits: "Total credits and refunds paid during the selected period for operational errors, adjustments, and claim payouts.",
} as const
