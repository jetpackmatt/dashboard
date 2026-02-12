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
import { Textarea } from "@/components/ui/textarea"
import { JetpackLoader } from "@/components/jetpack-loader"
import type { Ticket } from "@/lib/care/types"

interface StatusUpdateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  ticket: Ticket | null
  onUpdate: () => Promise<void>
}

export function StatusUpdateDialog({
  open,
  onOpenChange,
  ticket,
  onUpdate,
}: StatusUpdateDialogProps) {
  const [newStatus, setNewStatus] = React.useState('')
  const [statusNote, setStatusNote] = React.useState('')
  const [isUpdating, setIsUpdating] = React.useState(false)

  // Initialize status when ticket changes
  React.useEffect(() => {
    if (ticket && open) {
      setNewStatus(ticket.status)
      setStatusNote('')
    }
  }, [ticket, open])

  const handleUpdate = async () => {
    if (!ticket || !newStatus) return

    setIsUpdating(true)
    try {
      const response = await fetch(`/api/data/care-tickets/${ticket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: newStatus,
          eventNote: statusNote || undefined,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update status')
      }

      // Call parent's onUpdate to refresh
      await onUpdate()
      onOpenChange(false)
      setNewStatus('')
      setStatusNote('')
    } catch (err) {
      console.error('Failed to update status:', err)
      throw err
    } finally {
      setIsUpdating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Update Status</DialogTitle>
          <DialogDescription>
            Change the status of ticket #{ticket?.ticketNumber}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="status-select">New Status</Label>
            <Select value={newStatus} onValueChange={setNewStatus}>
              <SelectTrigger id="status-select">
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Input Required">Input Required</SelectItem>
                <SelectItem value="Under Review">Under Review</SelectItem>
                <SelectItem value="Credit Requested">Credit Requested</SelectItem>
                <SelectItem value="Credit Approved">Credit Approved</SelectItem>
                <SelectItem value="Resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="status-note">Note (optional)</Label>
            <Textarea
              id="status-note"
              value={statusNote}
              onChange={(e) => setStatusNote(e.target.value)}
              placeholder="Add a note about this status change..."
              rows={3}
            />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleUpdate}
            disabled={isUpdating || newStatus === ticket?.status}
          >
            {isUpdating ? (
              <>
                <JetpackLoader className="h-4 w-4 mr-2 animate-spin" />
                Updating...
              </>
            ) : (
              'Update Status'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
