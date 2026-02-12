/**
 * Pure utility functions for care ticket management
 * Extracted from care page for reusability and testability
 */

import * as React from "react"
import {
  FileTextIcon,
  ImageIcon,
  FileIcon,
  FileSpreadsheetIcon,
} from "lucide-react"

/**
 * Date range preset options for filtering tickets
 */
export type DateRangePreset = 'today' | '7d' | '30d' | '60d' | 'mtd' | 'ytd' | 'all' | 'custom'

/**
 * Converts a date range preset into actual from/to dates
 * Returns null for 'all' and 'custom' presets (requires custom date picker)
 */
export function getDateRangeFromPreset(preset: DateRangePreset): { from: Date; to: Date } | null {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  switch (preset) {
    case 'today':
      return { from: today, to: today }
    case '7d':
      const sevenDaysAgo = new Date(today)
      sevenDaysAgo.setDate(today.getDate() - 6)
      return { from: sevenDaysAgo, to: today }
    case '30d':
      const thirtyDaysAgo = new Date(today)
      thirtyDaysAgo.setDate(today.getDate() - 29)
      return { from: thirtyDaysAgo, to: today }
    case '60d':
      const sixtyDaysAgo = new Date(today)
      sixtyDaysAgo.setDate(today.getDate() - 59)
      return { from: sixtyDaysAgo, to: today }
    case 'mtd':
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
      return { from: monthStart, to: today }
    case 'ytd':
      const yearStart = new Date(today.getFullYear(), 0, 1)
      return { from: yearStart, to: today }
    case 'all':
      return null
    case 'custom':
      return null
    default:
      return null
  }
}

/**
 * Returns Tailwind CSS classes for status badge styling
 * @param status - Ticket status (Input Required, Under Review, etc.)
 * @param isExpanded - Whether this is for an expanded row (uses darker ring)
 */
export function getStatusColors(status: string) {
  switch (status) {
    case "Resolved":
    case "Credit Approved":
      return `bg-emerald-100 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-800`
    case "Credit Requested":
      return `bg-orange-100/70 text-orange-700/80 border border-orange-200/70 dark:bg-orange-900/35 dark:text-orange-300 dark:border-orange-800/90`
    case "Under Review":
      return `bg-blue-100 text-blue-700 border border-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:border-blue-800`
    case "Input Required":
      return `bg-red-100 text-red-700 border border-red-200 dark:bg-red-900/40 dark:text-red-300 dark:border-red-800`
    default:
      return `bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-900/40 dark:text-slate-300 dark:border-slate-800`
  }
}

/**
 * Returns a subtle background tint for the expanded header row based on ticket status.
 * Uses a light wash of the status color so the row pops against the neutral expanded panel
 * and the dimmed surrounding rows — breaking the "grey blob" effect.
 */
export function getExpandedRowTint(status: string) {
  switch (status) {
    case "Resolved":
    case "Credit Approved":
      return "bg-emerald-100/55 dark:bg-emerald-950/40"
    case "Credit Requested":
      return "bg-orange-100/55 dark:bg-orange-950/40"
    case "Under Review":
      return "bg-blue-100/55 dark:bg-blue-950/40"
    case "Input Required":
      return "bg-red-100/55 dark:bg-red-950/40"
    default:
      return "bg-slate-100/55 dark:bg-slate-800/50"
  }
}

/**
 * Status tint for the expanded panel container (35%).
 * Individual sections use white overlays to create hierarchy:
 * - Primary (no overlay): full 35% — credit, details, description
 * - Secondary (bg-white/15): softened ~25% — notes, activity, files
 * - Buttons (bg-white/50): raised interactive feel
 */
export function getExpandedPanelTint(status: string) {
  switch (status) {
    case "Resolved":
    case "Credit Approved":
      return "bg-emerald-100/40 dark:bg-emerald-950/30"
    case "Credit Requested":
      return "bg-orange-100/40 dark:bg-orange-950/30"
    case "Under Review":
      return "bg-blue-100/40 dark:bg-blue-950/30"
    case "Input Required":
      return "bg-red-100/40 dark:bg-red-950/30"
    default:
      return "bg-slate-100/40 dark:bg-slate-800/30"
  }
}

/**
 * Returns Tailwind CSS classes for ticket type badge styling
 * Claims (warm red family) vs non-claims (cool colors) for instant visual distinction
 */
export function getTicketTypeColors(ticketType: string, issueType?: string) {
  if (ticketType === 'Claim') {
    return `bg-[#eb9458]/20 text-[#c06520] border border-[#eb9458]/35 dark:bg-[#eb9458]/25 dark:text-[#f0a868] dark:border-[#eb9458]/30`
  }
  // All non-claim types use the same blue as the "New Ticket" button
  return `bg-[#328bcb]/15 text-[#1a5f96] border border-[#328bcb]/30 dark:bg-[#328bcb]/20 dark:text-[#5aa8dc] dark:border-[#328bcb]/40`
}

/**
 * Returns user-friendly display label for ticket type column
 * Claims show their issue type, non-claims show their ticket type
 * @param ticketType - Type of ticket (Claim, Track, Work Order, etc.)
 * @param issueType - Issue type for claims (Loss, Damage, etc.)
 */
export function getTicketTypeLabel(ticketType: string, issueType?: string) {
  if (ticketType === 'Claim') {
    // Map database issue types to user-friendly labels
    switch (issueType) {
      case 'Loss':
        return 'Lost in Transit'
      case 'Incorrect Delivery':
        return 'Incorrect Delivery'
      case 'Short Ship':
        return 'Incorrect Quantity'
      case 'Pick Error':
        return 'Incorrect Items'
      default:
        return issueType || 'Claim'
    }
  }
  return ticketType === 'Work Order' ? 'Request' : ticketType
}

/**
 * Returns text color class for status timeline entries
 * Only "Input Required" gets colored text (red) to draw customer attention
 * @param status - Ticket status
 */
export function getStatusTextColor(status: string) {
  switch (status) {
    case "Input Required":
      return "text-red-600 dark:text-red-400"
    default:
      return "text-foreground"
  }
}

/**
 * Returns background color class for status timeline dot (filled circle indicator)
 * @param status - Ticket status
 */
export function getStatusDotColor(status: string) {
  switch (status) {
    case "Resolved":
      return "bg-emerald-500 border-emerald-500 shadow-sm shadow-emerald-500/30"
    case "Credit Approved":
      return "bg-emerald-500 border-emerald-500 shadow-sm shadow-emerald-500/30"
    case "Credit Requested":
      return "bg-orange-400 border-orange-400 shadow-sm shadow-orange-400/30"
    case "Under Review":
      return "bg-blue-500 border-blue-500 shadow-sm shadow-blue-500/30"
    case "Input Required":
      return "bg-red-500 border-red-500 shadow-sm shadow-red-500/30"
    default:
      return "bg-slate-400 border-slate-400 shadow-sm shadow-slate-400/30"
  }
}

/**
 * Returns appropriate icon component for file type based on MIME type or extension
 * Supports PDF, images, spreadsheets, documents, and fallback for unknown types
 * @param fileType - MIME type or file extension
 * @param fileName - Optional filename to fallback to extension detection
 */
export function getFileIcon(fileType: string, fileName?: string) {
  const type = fileType.toLowerCase()

  // Check MIME types first
  if (type === 'application/pdf' || type === 'pdf') {
    return <FileTextIcon className="h-4 w-4 text-red-500 shrink-0" />
  } else if (type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(type)) {
    return <ImageIcon className="h-4 w-4 text-blue-500 shrink-0" />
  } else if (
    type === 'application/vnd.ms-excel' ||
    type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    type === 'text/csv' ||
    ['xls', 'xlsx', 'csv'].includes(type)
  ) {
    return <FileSpreadsheetIcon className="h-4 w-4 text-green-600 shrink-0" />
  } else if (
    type === 'application/msword' ||
    type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ['doc', 'docx'].includes(type)
  ) {
    return <FileTextIcon className="h-4 w-4 text-blue-600 shrink-0" />
  } else {
    // Fallback: try to detect from filename extension
    if (fileName) {
      const ext = fileName.split('.').pop()?.toLowerCase()
      if (ext === 'pdf') return <FileTextIcon className="h-4 w-4 text-red-500 shrink-0" />
      if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext || '')) return <ImageIcon className="h-4 w-4 text-blue-500 shrink-0" />
      if (['xls', 'xlsx', 'csv'].includes(ext || '')) return <FileSpreadsheetIcon className="h-4 w-4 text-green-600 shrink-0" />
      if (['doc', 'docx'].includes(ext || '')) return <FileTextIcon className="h-4 w-4 text-blue-600 shrink-0" />
    }
    return <FileIcon className="h-4 w-4 text-slate-500 shrink-0" />
  }
}
