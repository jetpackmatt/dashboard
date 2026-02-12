"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { JetpackLoader } from "@/components/jetpack-loader"
import { CARRIER_OPTIONS } from "@/lib/care/constants"
import { cn } from "@/lib/utils"
import type { Ticket } from "@/lib/care/types"

interface EditTicketDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  ticket: Ticket | null
  onUpdate: () => Promise<void>
}

interface EditForm {
  ticketType: string
  issueType: string
  status: string
  manager: string
  orderId: string
  shipmentId: string
  shipDate: string
  carrier: string
  trackingNumber: string
  description: string
  internalNote: string
  reshipmentStatus: string
  whatToReship: string
  reshipmentId: string
  compensationRequest: string
  creditAmount: string
  currency: string
  workOrderId: string
  inventoryId: string
}

const labelClass = "text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider"

export function EditTicketDialog({
  open,
  onOpenChange,
  ticket,
  onUpdate,
}: EditTicketDialogProps) {
  const [editForm, setEditForm] = React.useState<EditForm>({
    ticketType: '',
    issueType: '',
    status: '',
    manager: '',
    orderId: '',
    shipmentId: '',
    shipDate: '',
    carrier: '',
    trackingNumber: '',
    description: '',
    internalNote: '',
    reshipmentStatus: '',
    whatToReship: '',
    reshipmentId: '',
    compensationRequest: '',
    creditAmount: '',
    currency: 'USD',
    workOrderId: '',
    inventoryId: '',
  })
  const [isUpdating, setIsUpdating] = React.useState(false)

  // Initialize form when ticket changes
  React.useEffect(() => {
    if (ticket && open) {
      setEditForm({
        ticketType: ticket.ticketType || '',
        issueType: ticket.issueType || '',
        status: ticket.status || '',
        manager: ticket.manager || '',
        orderId: ticket.orderId || '',
        shipmentId: ticket.shipmentId || '',
        shipDate: ticket.shipDate ? ticket.shipDate.split('T')[0] : '',
        carrier: ticket.carrier || '',
        trackingNumber: ticket.trackingNumber || '',
        description: ticket.description || '',
        internalNote: '', // Start empty - user adds a NEW note
        reshipmentStatus: ticket.reshipmentStatus || '',
        whatToReship: ticket.whatToReship || '',
        reshipmentId: ticket.reshipmentId || '',
        compensationRequest: ticket.compensationRequest || '',
        creditAmount: ticket.creditAmount?.toString() || '',
        currency: ticket.currency || 'USD',
        workOrderId: ticket.workOrderId || '',
        inventoryId: ticket.inventoryId || '',
      })
    }
  }, [ticket, open])

  // Derived booleans for conditional field display
  const isClaim = editForm.ticketType === 'Claim'
  const isShipmentInquiry = editForm.ticketType === 'Shipment Inquiry'
  const isRequest = editForm.ticketType === 'Request'
  const hasShipmentFields = isClaim || isShipmentInquiry
  const hasIssueType = isClaim

  const handleUpdate = async () => {
    if (!ticket) return

    setIsUpdating(true)
    try {
      const response = await fetch(`/api/data/care-tickets/${ticket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketType: editForm.ticketType || null,
          issueType: editForm.issueType || null,
          status: editForm.status || null,
          manager: editForm.manager || null,
          orderId: editForm.orderId || null,
          shipmentId: editForm.shipmentId || null,
          shipDate: editForm.shipDate || null,
          carrier: editForm.carrier || null,
          trackingNumber: editForm.trackingNumber || null,
          description: editForm.description || null,
          internalNote: editForm.internalNote || null,
          reshipmentStatus: editForm.reshipmentStatus || null,
          whatToReship: editForm.whatToReship || null,
          reshipmentId: editForm.reshipmentId || null,
          compensationRequest: editForm.compensationRequest || null,
          creditAmount: editForm.creditAmount ? parseFloat(editForm.creditAmount) : 0,
          currency: editForm.currency,
          workOrderId: editForm.workOrderId || null,
          inventoryId: editForm.inventoryId || null,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update ticket')
      }

      // Call parent's onUpdate to refresh and close
      await onUpdate()
      onOpenChange(false)
    } catch (err) {
      console.error('Failed to update ticket:', err)
      throw err
    } finally {
      setIsUpdating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Ticket #{ticket?.ticketNumber}</DialogTitle>
          <DialogDescription>
            Update the ticket details below.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          {/* Row 1: Status + Type + Issue Type (Claims only) */}
          <div className={cn("grid gap-4", hasIssueType ? "grid-cols-3" : "grid-cols-2")}>
            <div className="space-y-1.5">
              <Label htmlFor="edit-status" className={labelClass}>
                Status <span className="text-red-500">*</span>
              </Label>
              <Select
                value={editForm.status}
                onValueChange={(value) => setEditForm({ ...editForm, status: value })}
              >
                <SelectTrigger id="edit-status" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Input Required">Input Required</SelectItem>
                  <SelectItem value="Under Review">Under Review</SelectItem>
                  <SelectItem value="Credit Requested">Credit Requested</SelectItem>
                  <SelectItem value="Credit Approved">Credit Approved</SelectItem>
                  <SelectItem value="Credit Denied">Credit Denied</SelectItem>
                  <SelectItem value="Resolved">Resolved</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-ticketType" className={labelClass}>
                Ticket Type <span className="text-red-500">*</span>
              </Label>
              <Select
                value={editForm.ticketType}
                onValueChange={(value) => setEditForm({ ...editForm, ticketType: value })}
              >
                <SelectTrigger id="edit-ticketType" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Claim">Claim</SelectItem>
                  <SelectItem value="Shipment Inquiry">Shipment Inquiry</SelectItem>
                  <SelectItem value="Request">Request</SelectItem>
                  <SelectItem value="Technical">Technical</SelectItem>
                  <SelectItem value="Inquiry">Inquiry</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {hasIssueType && (
              <div className="space-y-1.5">
                <Label htmlFor="edit-issueType" className={labelClass}>Issue Type</Label>
                <Select
                  value={editForm.issueType}
                  onValueChange={(value) => setEditForm({ ...editForm, issueType: value })}
                >
                  <SelectTrigger id="edit-issueType" className={cn("h-9", editForm.issueType ? "text-foreground" : "text-muted-foreground/40")}>
                    <SelectValue placeholder="Select issue type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Loss">Loss</SelectItem>
                    <SelectItem value="Damage">Damage</SelectItem>
                    <SelectItem value="Pick Error">Pick Error</SelectItem>
                    <SelectItem value="Short Ship">Short Ship</SelectItem>
                    <SelectItem value="Incorrect Delivery">Incorrect Delivery</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Manager */}
          <div className="space-y-1.5">
            <Label htmlFor="edit-manager" className={labelClass}>Assigned Manager</Label>
            <Input
              id="edit-manager"
              value={editForm.manager}
              onChange={(e) => setEditForm({ ...editForm, manager: e.target.value })}
              placeholder="Manager name"
              className="h-9 placeholder:text-muted-foreground/40"
            />
          </div>

          {/* Order/Shipment Details - Claim + Shipment Inquiry */}
          {hasShipmentFields && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-shipmentId" className={labelClass}>Shipment ID</Label>
                  <Input
                    id="edit-shipmentId"
                    value={editForm.shipmentId}
                    onChange={(e) => setEditForm({ ...editForm, shipmentId: e.target.value })}
                    placeholder="e.g., 330867617"
                    className="h-9 placeholder:text-muted-foreground/40"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-orderId" className={labelClass}>Order ID</Label>
                  <Input
                    id="edit-orderId"
                    value={editForm.orderId}
                    onChange={(e) => setEditForm({ ...editForm, orderId: e.target.value })}
                    placeholder="e.g., 1847362"
                    className="h-9 placeholder:text-muted-foreground/40"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-carrier" className={labelClass}>Carrier</Label>
                  <Select
                    value={editForm.carrier}
                    onValueChange={(value) => setEditForm({ ...editForm, carrier: value })}
                  >
                    <SelectTrigger id="edit-carrier" className={cn("h-9", editForm.carrier ? "text-foreground" : "text-muted-foreground/40")}>
                      <SelectValue placeholder="Select carrier..." />
                    </SelectTrigger>
                    <SelectContent>
                      {CARRIER_OPTIONS.map((carrier) => (
                        <SelectItem key={carrier} value={carrier}>
                          {carrier}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-trackingNumber" className={labelClass}>Tracking Number</Label>
                  <Input
                    id="edit-trackingNumber"
                    value={editForm.trackingNumber}
                    onChange={(e) => setEditForm({ ...editForm, trackingNumber: e.target.value })}
                    placeholder="e.g., 773892456821"
                    className="h-9 placeholder:text-muted-foreground/40"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-shipDate" className={labelClass}>Ship Date</Label>
                  <Input
                    id="edit-shipDate"
                    type="date"
                    value={editForm.shipDate}
                    onChange={(e) => setEditForm({ ...editForm, shipDate: e.target.value })}
                    className="h-9"
                  />
                </div>
              </div>
            </>
          )}

          {/* Claim-specific fields */}
          {isClaim && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-reshipmentStatus" className={labelClass}>Reshipment Status</Label>
                  <Select
                    value={editForm.reshipmentStatus}
                    onValueChange={(value) => setEditForm({ ...editForm, reshipmentStatus: value })}
                  >
                    <SelectTrigger id="edit-reshipmentStatus" className={cn("h-9", editForm.reshipmentStatus ? "text-foreground" : "text-muted-foreground/40")}>
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Please reship for me">Please reship for me</SelectItem>
                      <SelectItem value="I've already reshipped">I&apos;ve already reshipped</SelectItem>
                      <SelectItem value="Don't reship">Don&apos;t reship</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-compensationRequest" className={labelClass}>Compensation Request</Label>
                  <Select
                    value={editForm.compensationRequest}
                    onValueChange={(value) => setEditForm({ ...editForm, compensationRequest: value })}
                  >
                    <SelectTrigger id="edit-compensationRequest" className={cn("h-9", editForm.compensationRequest ? "text-foreground" : "text-muted-foreground/40")}>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Credit me the item's manufacturing cost">Credit to account</SelectItem>
                      <SelectItem value="Create a return label for me">Return label</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-whatToReship" className={labelClass}>What to Reship</Label>
                  <Input
                    id="edit-whatToReship"
                    value={editForm.whatToReship}
                    onChange={(e) => setEditForm({ ...editForm, whatToReship: e.target.value })}
                    placeholder="e.g., 2x Vitamin D3 5000IU"
                    className="h-9 placeholder:text-muted-foreground/40"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-reshipmentId" className={labelClass}>Reshipment ID</Label>
                  <Input
                    id="edit-reshipmentId"
                    value={editForm.reshipmentId}
                    onChange={(e) => setEditForm({ ...editForm, reshipmentId: e.target.value })}
                    placeholder="e.g., 12345"
                    className="h-9 placeholder:text-muted-foreground/40"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-creditAmount" className={labelClass}>Credit Amount</Label>
                  <Input
                    id="edit-creditAmount"
                    type="number"
                    step="0.01"
                    value={editForm.creditAmount}
                    onChange={(e) => setEditForm({ ...editForm, creditAmount: e.target.value })}
                    placeholder="0.00"
                    className="h-9 placeholder:text-muted-foreground/40"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-currency" className={labelClass}>Currency</Label>
                  <Select
                    value={editForm.currency}
                    onValueChange={(value) => setEditForm({ ...editForm, currency: value })}
                  >
                    <SelectTrigger id="edit-currency" className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="CAD">CAD</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </>
          )}

          {/* Request-specific fields */}
          {isRequest && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="edit-workOrderId" className={labelClass}>Work Order ID</Label>
                <Input
                  id="edit-workOrderId"
                  value={editForm.workOrderId}
                  onChange={(e) => setEditForm({ ...editForm, workOrderId: e.target.value })}
                  placeholder="e.g., WO-12345"
                  className="h-9 placeholder:text-muted-foreground/40"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-inventoryId" className={labelClass}>Inventory ID</Label>
                <Input
                  id="edit-inventoryId"
                  value={editForm.inventoryId}
                  onChange={(e) => setEditForm({ ...editForm, inventoryId: e.target.value })}
                  placeholder="e.g., INV-67890"
                  className="h-9 placeholder:text-muted-foreground/40"
                />
              </div>
            </div>
          )}

          {/* Description - always shown */}
          <div className="space-y-1.5">
            <Label htmlFor="edit-description" className={labelClass}>Description</Label>
            <Textarea
              id="edit-description"
              value={editForm.description}
              onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              placeholder="Describe the issue..."
              rows={3}
              className="placeholder:text-muted-foreground/40"
            />
          </div>

          {/* Add Internal Note - always shown */}
          <div className="space-y-1.5">
            <Label htmlFor="edit-internalNote" className={labelClass}>
              Add Internal Note <span className="text-muted-foreground/60 font-normal normal-case tracking-normal">(admin/care only)</span>
            </Label>
            <Textarea
              id="edit-internalNote"
              value={editForm.internalNote}
              onChange={(e) => setEditForm({ ...editForm, internalNote: e.target.value })}
              placeholder="Add a new internal note..."
              rows={2}
              className="placeholder:text-muted-foreground/40"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleUpdate} disabled={isUpdating}>
            {isUpdating ? (
              <>
                <JetpackLoader className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              'Save Changes'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
