/**
 * Care Tickets - Constants
 *
 * Static configuration data for the Jetpack Care system
 */

import type { FilterOption } from '@/components/ui/multi-select-filter'
import type { DateRangePreset } from './types'

// Carrier options for the dropdown (consolidated display names)
export const CARRIER_OPTIONS = [
  'Amazon',
  'APC',
  'BetterTrucks',
  'Canada Post',
  'Cirro',
  'DHL Ecom',
  'DHL Express',
  'FedEx',
  'GoFo Express',
  'LaserShip',
  'OnTrac',
  'OSM',
  'Passport',
  'Prepaid',
  'ShipBob',
  'TForce',
  'UniUni',
  'UPS',
  'UPS MI',
  'USPS',
  'Veho',
]

// Date range presets for filtering
export const DATE_RANGE_PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: '60d', label: '60D' },
  { value: 'mtd', label: 'MTD' },
  { value: 'ytd', label: 'YTD' },
  { value: 'all', label: 'All' },
  { value: 'custom', label: 'Custom' },
]

// Status filter options for multi-select
export const STATUS_OPTIONS: FilterOption[] = [
  { value: 'Ticket Created', label: 'Ticket Created' },
  { value: 'Input Required', label: 'Input Required' },
  { value: 'Under Review', label: 'Under Review' },
  { value: 'In Process', label: 'In Process' },
  { value: 'Credit Requested', label: 'Credit Requested' },
  { value: 'Credit Approved', label: 'Credit Approved' },
  { value: 'Credit Denied', label: 'Credit Denied' },
  { value: 'Resolved', label: 'Resolved' },
]

// Ticket type filter options - non-claim types first, then claim issues
export const ISSUE_TYPE_OPTIONS: FilterOption[] = [
  { value: 'type:Shipment Inquiry', label: 'Shipment Inquiry' },
  { value: 'type:Request', label: 'Request' },
  { value: 'type:Technical', label: 'Technical' },
  { value: 'type:Inquiry', label: 'Inquiry' },
  { value: 'issue:Loss', label: 'Lost in Transit' },
  { value: 'issue:Incorrect Delivery', label: 'Incorrect Delivery' },
  { value: 'issue:Damage', label: 'Damage' },
  { value: 'issue:Pick Error', label: 'Incorrect Items' },
  { value: 'issue:Short Ship', label: 'Incorrect Quantity' },
  { value: 'issue:Other', label: 'Other' },
]

// All possible ticket statuses
export const ALL_STATUSES = [
  'Ticket Created',
  'Input Required',
  'Under Review',
  'In Process',
  'Credit Requested',
  'Credit Approved',
  'Credit Denied',
  'Resolved',
]

// Default statuses to show when no filter is active (excludes Resolved)
export const DEFAULT_STATUSES = ALL_STATUSES.filter((s) => s !== 'Resolved')
