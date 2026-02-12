"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { JetpackLoader } from "@/components/jetpack-loader"
import type { Ticket } from "@/lib/care/types"

interface DeleteTicketDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  ticket: Ticket | null
  onDelete: () => Promise<void>
}

export function DeleteTicketDialog({
  open,
  onOpenChange,
  ticket,
  onDelete,
}: DeleteTicketDialogProps) {
  const [isDeleting, setIsDeleting] = React.useState(false)
  const [deleteType, setDeleteType] = React.useState<'archive' | 'permanent'>('archive')

  // Reset delete type when dialog closes
  React.useEffect(() => {
    if (!open) {
      setDeleteType('archive')
    }
  }, [open])

  const handleDelete = async () => {
    if (!ticket) return

    setIsDeleting(true)
    try {
      const url = deleteType === 'permanent'
        ? `/api/data/care-tickets/${ticket.id}?permanent=true`
        : `/api/data/care-tickets/${ticket.id}`

      const response = await fetch(url, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete ticket')
      }

      // Call parent's onDelete to refresh and reset state
      await onDelete()
      onOpenChange(false)
    } catch (err) {
      console.error('Failed to delete ticket:', err)
      throw err
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete Ticket</DialogTitle>
          <DialogDescription>
            Choose how you want to delete this ticket.
          </DialogDescription>
        </DialogHeader>
        {ticket && (
          <div className="py-4 space-y-4">
            {/* Ticket info */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  Ticket #{ticket.ticketNumber}
                </span>
                <Badge variant="outline">
                  {ticket.ticketType}
                </Badge>
              </div>
              {ticket.description && (
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {ticket.description}
                </p>
              )}
            </div>

            {/* Delete type selection */}
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setDeleteType('archive')}
                className={`w-full text-left p-3 rounded-lg border-2 transition-colors ${
                  deleteType === 'archive'
                    ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20'
                    : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                    deleteType === 'archive' ? 'border-amber-500' : 'border-slate-400'
                  }`}>
                    {deleteType === 'archive' && (
                      <div className="w-2 h-2 rounded-full bg-amber-500" />
                    )}
                  </div>
                  <div>
                    <p className="font-medium text-sm">Archive</p>
                    <p className="text-xs text-muted-foreground">
                      Hide from view but keep data. Can be recovered later.
                    </p>
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setDeleteType('permanent')}
                className={`w-full text-left p-3 rounded-lg border-2 transition-colors ${
                  deleteType === 'permanent'
                    ? 'border-red-500 bg-red-50 dark:bg-red-900/20'
                    : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                    deleteType === 'permanent' ? 'border-red-500' : 'border-slate-400'
                  }`}>
                    {deleteType === 'permanent' && (
                      <div className="w-2 h-2 rounded-full bg-red-500" />
                    )}
                  </div>
                  <div>
                    <p className="font-medium text-sm text-red-600 dark:text-red-400">Permanently Delete</p>
                    <p className="text-xs text-muted-foreground">
                      Remove ticket and all attached files forever. Cannot be undone.
                    </p>
                  </div>
                </div>
              </button>
            </div>
          </div>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={deleteType === 'permanent' ? 'destructive' : 'default'}
            onClick={handleDelete}
            disabled={isDeleting}
            className={deleteType === 'archive' ? 'bg-amber-600 hover:bg-amber-700 text-white' : ''}
          >
            {isDeleting ? (
              <>
                <JetpackLoader className="h-4 w-4 mr-2 animate-spin" />
                {deleteType === 'permanent' ? 'Deleting...' : 'Archiving...'}
              </>
            ) : (
              deleteType === 'permanent' ? 'Permanently Delete' : 'Archive Ticket'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
