/**
 * Care Tickets - Type Definitions
 *
 * Shared types for the Jetpack Care system (tickets, claims, work orders)
 */

// Event interface for ticket timeline
export interface TicketEvent {
  status: string
  note: string
  createdAt: string
  createdBy: string
}

// Internal note interface (for admin-only internal notes)
export interface InternalNote {
  note: string
  createdAt: string
  createdBy: string
}

// File attachment interface
export interface FileAttachment {
  name: string
  url: string
  type: string // file extension or MIME type
  uploadedAt: string
}

// Partner type for tickets (warehouse partner)
export type Partner = 'shipbob' | 'eshipper'

// Main ticket interface (API response format)
export interface Ticket {
  // Identity
  id: string
  ticketNumber: number
  clientId: string | null
  clientName: string
  partner: Partner

  // Classification
  ticketType: string
  issueType: string | null
  status: string
  manager: string | null

  // Order/shipment details
  orderId: string | null
  shipmentId: string | null
  shipDate: string | null
  carrier: string | null
  trackingNumber: string | null

  // Claim-specific fields
  reshipmentStatus: string | null
  whatToReship: string | null
  reshipmentId: string | null
  compensationRequest: string | null

  // Financial
  creditAmount: number
  currency: string

  // Work order fields
  workOrderId: string | null
  inventoryId: string | null

  // Notes and attachments
  description: string | null
  internalNotes: InternalNote[] | null
  attachments: FileAttachment[] | null

  // Events timeline
  events: TicketEvent[]
  latestNote: string | null
  lastUpdated: string | null

  // Timestamps
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
}

// Date range presets for filtering
export type DateRangePreset = 'today' | '7d' | '30d' | '60d' | 'mtd' | 'ytd' | 'all' | 'custom'
