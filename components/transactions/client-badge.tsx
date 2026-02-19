"use client"

import * as React from "react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useClient } from "@/components/client-context"

interface ClientBadgeProps {
  clientId: string | null | undefined
}

/**
 * ClientBadge - Shows a small 2-letter client identifier badge for admins
 *
 * Only visible when:
 * - User is admin
 * - Viewing "All Brands" (not filtered to a single client)
 * - Row has a clientId
 *
 * Hover reveals full client name via tooltip.
 */
// Jetpack internal client (parent account) - not in the normal clients list
const JETPACK_INTERNAL_ID = '4e5a1e9e-35a3-41ab-bbb0-22cc0ac99fe4'

export { JETPACK_INTERNAL_ID }

export function ClientBadge({ clientId }: ClientBadgeProps) {
  const { isAdmin, isCareUser, effectiveIsAdmin, effectiveIsCareUser, selectedClientId, clients } = useClient()

  // Show for admins and care users viewing all clients (not filtered)
  const canSeeAllBrands = isAdmin || isCareUser || effectiveIsAdmin || effectiveIsCareUser
  if (!canSeeAllBrands || selectedClientId || !clientId) {
    return null
  }

  // Special handling for Jetpack parent account (not in the normal clients list)
  if (clientId === JETPACK_INTERNAL_ID) {
    return (
      <TooltipProvider delayDuration={100}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="inline-flex items-center justify-center w-6 h-5 text-[10px] font-semibold rounded bg-orange-500/15 text-orange-700 dark:text-orange-400 cursor-default shrink-0"
            >
              JP
            </span>
          </TooltipTrigger>
          <TooltipContent side="right" className="font-medium bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300 border-orange-200 dark:border-orange-800">
            Jetpack (Parent)
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  // Look up client info and position in the clients list
  const clientIndex = clients.findIndex(c => c.id === clientId)
  if (clientIndex === -1) {
    return null
  }
  const client = clients[clientIndex]

  // Use short_code if available, otherwise first 2 letters of company name
  const shortCode = client.short_code || client.company_name.substring(0, 2).toUpperCase()

  // Visually distinct color schemes - ordered for maximum contrast between adjacent clients
  // Badge uses transparency, tooltip uses solid colors (to avoid see-through issues)
  const colorSchemes = [
    { badge: "bg-blue-500/15 text-blue-700 dark:text-blue-400", tooltip: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 border-blue-200 dark:border-blue-800" },
    { badge: "bg-amber-500/15 text-amber-700 dark:text-amber-400", tooltip: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300 border-amber-200 dark:border-amber-800" },
    { badge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400", tooltip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800" },
    { badge: "bg-rose-500/15 text-rose-700 dark:text-rose-400", tooltip: "bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-300 border-rose-200 dark:border-rose-800" },
    { badge: "bg-purple-500/15 text-purple-700 dark:text-purple-400", tooltip: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300 border-purple-200 dark:border-purple-800" },
    { badge: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400", tooltip: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300 border-cyan-200 dark:border-cyan-800" },
    { badge: "bg-orange-500/15 text-orange-700 dark:text-orange-400", tooltip: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300 border-orange-200 dark:border-orange-800" },
    { badge: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400", tooltip: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800" },
  ]

  // Use client's position in the list - guarantees different colors for first 8 clients
  const colorIndex = clientIndex % colorSchemes.length
  const { badge: badgeClass, tooltip: tooltipClass } = colorSchemes[colorIndex]

  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={`inline-flex items-center justify-center w-6 h-5 text-[10px] font-semibold rounded ${badgeClass} cursor-default shrink-0`}
          >
            {shortCode}
          </span>
        </TooltipTrigger>
        <TooltipContent side="right" className={`font-medium ${tooltipClass}`}>
          {client.company_name}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
