"use client"

import * as React from "react"
import { useDebouncedCallback } from "use-debounce"
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
import { FileUpload } from "@/components/claims/file-upload"
import { getCarrierDisplayName } from "@/components/transactions/cell-renderers"
import { CARRIER_OPTIONS } from "@/lib/care/constants"
import { cn } from "@/lib/utils"
import { XIcon } from "lucide-react"

interface CreateTicketDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => Promise<void>
  selectedClientId: string | null
  clients: { id: string; company_name: string; merchant_id: string | null }[]
  isAdmin: boolean
}

interface CreateForm {
  ticketType: string
  shipmentId: string
  clientId: string
  carrier: string
  trackingNumber: string
  description: string
  attachments: { name: string; url: string; size: number; type: string }[]
}

export function CreateTicketDialog({
  open,
  onOpenChange,
  onCreated,
  selectedClientId,
  clients,
  isAdmin,
}: CreateTicketDialogProps) {
  const [createForm, setCreateForm] = React.useState<CreateForm>({
    ticketType: 'Track',
    shipmentId: '',
    clientId: '',
    carrier: '',
    trackingNumber: '',
    description: '',
    attachments: [],
  })
  const [isCreating, setIsCreating] = React.useState(false)
  const [createDialogError, setCreateDialogError] = React.useState<string | null>(null)
  const [isLookingUpShipment, setIsLookingUpShipment] = React.useState(false)
  const [shipmentLookupError, setShipmentLookupError] = React.useState<string | null>(null)

  // Reset form when dialog closes
  React.useEffect(() => {
    if (!open) {
      setCreateForm({
        ticketType: 'Track',
        shipmentId: '',
        clientId: '',
        carrier: '',
        trackingNumber: '',
        description: '',
        attachments: [],
      })
      setCreateDialogError(null)
      setShipmentLookupError(null)
    }
  }, [open])

  // Debounced shipment lookup to auto-populate carrier, tracking, and client
  const lookupShipment = useDebouncedCallback(async (shipmentId: string) => {
    if (!shipmentId || shipmentId.length < 5) {
      return
    }

    setIsLookingUpShipment(true)
    setShipmentLookupError(null)

    try {
      const response = await fetch(`/api/data/shipments/${shipmentId}`)
      if (response.ok) {
        const data = await response.json()
        if (data.shipment) {
          setCreateForm(prev => ({
            ...prev,
            carrier: data.shipment.carrier ? getCarrierDisplayName(data.shipment.carrier) : '',
            trackingNumber: data.shipment.tracking_id || '',
            // Auto-populate client if shipment has one
            clientId: data.shipment.client_id || prev.clientId,
          }))
        }
      } else if (response.status === 404) {
        // Shipment not found - that's okay, user might be typing a new one
        setShipmentLookupError(null)
      } else {
        setShipmentLookupError('Failed to lookup shipment')
      }
    } catch {
      setShipmentLookupError('Failed to lookup shipment')
    } finally {
      setIsLookingUpShipment(false)
    }
  }, 500)

  const handleCreate = async () => {
    // Determine the effective client ID
    const effectiveClientId = (selectedClientId && selectedClientId !== 'all')
      ? selectedClientId
      : createForm.clientId

    if (!effectiveClientId) {
      setCreateDialogError('Please select a brand.')
      return
    }

    // Validate required fields
    if (!createForm.description.trim()) {
      setCreateDialogError('Description is required.')
      return
    }

    // For Track type, shipment fields are required
    if (createForm.ticketType === 'Track') {
      if (!createForm.shipmentId.trim()) {
        setCreateDialogError('Shipment ID is required for Track tickets.')
        return
      }
      if (!createForm.carrier.trim()) {
        setCreateDialogError('Carrier is required for Track tickets.')
        return
      }
      if (!createForm.trackingNumber.trim()) {
        setCreateDialogError('Tracking Number is required for Track tickets.')
        return
      }
    }

    setCreateDialogError(null)
    setIsCreating(true)
    try {
      const response = await fetch('/api/data/care-tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: effectiveClientId,
          ticketType: createForm.ticketType,
          shipmentId: createForm.shipmentId || null,
          carrier: createForm.carrier || null,
          trackingNumber: createForm.trackingNumber || null,
          description: createForm.description || null,
          attachments: createForm.attachments.length > 0 ? createForm.attachments : null,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create ticket')
      }

      // Call parent's onCreated to refresh and close
      await onCreated()
      onOpenChange(false)
    } catch (err) {
      setCreateDialogError(err instanceof Error ? err.message : 'Failed to create ticket')
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader className="space-y-2">
          <DialogTitle>Create New Ticket</DialogTitle>
          <DialogDescription>
            Create a support ticket for tracking, work orders, technical issues, or general inquiries.
          </DialogDescription>
        </DialogHeader>

        {/* Error messages */}
        {createDialogError && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300 flex items-center justify-between">
            <span>{createDialogError}</span>
            <button
              type="button"
              onClick={() => setCreateDialogError(null)}
              className="text-red-500 hover:text-red-700"
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>
        )}

        {shipmentLookupError && (
          <div className="p-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded text-xs text-amber-700 dark:text-amber-300">
            {shipmentLookupError}
          </div>
        )}

        <div className="space-y-4">
          {/* Row 1: Type + Shipment ID */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="ticketType" className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                Type <span className="text-red-500">*</span>
              </Label>
              <Select
                value={createForm.ticketType}
                onValueChange={(value) => {
                  setCreateForm({ ...createForm, ticketType: value })
                  setCreateDialogError(null)
                }}
              >
                <SelectTrigger id="ticketType" className={cn("h-9", createForm.ticketType ? "text-foreground" : "text-muted-foreground/40")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Track">Track</SelectItem>
                  <SelectItem value="Work Order">Request</SelectItem>
                  <SelectItem value="Technical">Technical</SelectItem>
                  <SelectItem value="Inquiry">Inquiry</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="shipmentId" className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                Shipment ID {createForm.ticketType === 'Track' && <span className="text-red-500">*</span>}
              </Label>
              <div className="relative">
                <Input
                  id="shipmentId"
                  value={createForm.shipmentId}
                  onChange={(e) => {
                    const value = e.target.value
                    setCreateForm({ ...createForm, shipmentId: value })
                    lookupShipment(value)
                  }}
                  placeholder="e.g., 330867617"
                  className="h-9 pr-8 placeholder:text-muted-foreground/40"
                />
                {isLookingUpShipment && (
                  <JetpackLoader size="sm" className="absolute right-3 top-2.5" />
                )}
              </div>
            </div>
          </div>

          {/* Row 2: Brand (for admins) + Carrier + Tracking */}
          <div className={`grid gap-4 ${isAdmin && (!selectedClientId || selectedClientId === 'all') ? 'grid-cols-3' : 'grid-cols-2'}`}>
            {/* Brand selector - only shown for admins when no specific client is selected */}
            {isAdmin && (!selectedClientId || selectedClientId === 'all') && (
              <div className="space-y-1.5">
                <Label htmlFor="clientId" className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                  Brand <span className="text-red-500">*</span>
                </Label>
                <Select
                  value={createForm.clientId}
                  onValueChange={(value) => setCreateForm({ ...createForm, clientId: value })}
                >
                  <SelectTrigger id="clientId" className={cn("h-9", createForm.clientId ? "text-foreground" : "text-muted-foreground/40")}>
                    <SelectValue placeholder="Select brand..." />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.filter(client => client.merchant_id).map((client) => (
                      <SelectItem key={client.id} value={client.id}>
                        {client.company_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="carrier" className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                Carrier {createForm.ticketType === 'Track' && <span className="text-red-500">*</span>}
              </Label>
              <Select
                value={createForm.carrier}
                onValueChange={(value) => setCreateForm({ ...createForm, carrier: value })}
              >
                <SelectTrigger id="carrier" className={cn("h-9", createForm.carrier ? "text-foreground" : "text-muted-foreground/40")}>
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
              <Label htmlFor="trackingNumber" className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                Tracking # {createForm.ticketType === 'Track' && <span className="text-red-500">*</span>}
              </Label>
              <Input
                id="trackingNumber"
                value={createForm.trackingNumber}
                onChange={(e) => setCreateForm({ ...createForm, trackingNumber: e.target.value })}
                placeholder="e.g., 1Z999AA10123456784"
                className="h-9 placeholder:text-muted-foreground/40"
              />
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="description" className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
              Description <span className="text-red-500">*</span>
            </Label>
            <Textarea
              id="description"
              value={createForm.description}
              onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
              placeholder="Describe the issue or request..."
              rows={3}
              className="placeholder:text-muted-foreground/40"
            />
          </div>

          {/* File Attachments */}
          <div className="space-y-1.5">
            <Label className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
              Attachments (optional)
            </Label>
            <FileUpload
              value={createForm.attachments}
              onChange={(files) => {
                setCreateForm(prev => ({
                  ...prev,
                  attachments: files
                }))
              }}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={isCreating}
          >
            {isCreating ? (
              <>
                <JetpackLoader className="h-4 w-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              'Create Ticket'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
