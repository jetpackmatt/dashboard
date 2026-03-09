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
import { cn } from "@/lib/utils"
import { CheckCircle2, XIcon } from "lucide-react"

interface CreateTicketDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => Promise<void>
  selectedClientId: string | null
  clients: { id: string; company_name: string; merchant_id: string | null }[]
  isAdmin: boolean
  isBrandUser?: boolean
}

interface CreateForm {
  ticketType: string
  shipmentId: string
  clientId: string
  carrier: string
  trackingNumber: string
  description: string
  initialNote: string
  attachments: { name: string; url: string; size: number; type: string }[]
  // Address Change fields
  newAddressName: string
  newAddressLine1: string
  newAddressLine2: string
  newAddressCity: string
  newAddressState: string
  newAddressZip: string
  newAddressCountry: string
  returnToWarehouse: boolean
}

export function CreateTicketDialog({
  open,
  onOpenChange,
  onCreated,
  selectedClientId,
  clients,
  isAdmin,
  isBrandUser = false,
}: CreateTicketDialogProps) {
  const defaultTicketType = isBrandUser ? 'Address Change' : 'Shipment Inquiry'
  const [createForm, setCreateForm] = React.useState<CreateForm>({
    ticketType: defaultTicketType,
    shipmentId: '',
    clientId: '',
    carrier: '',
    trackingNumber: '',
    description: '',
    initialNote: '',
    attachments: [],
    newAddressName: '',
    newAddressLine1: '',
    newAddressLine2: '',
    newAddressCity: '',
    newAddressState: '',
    newAddressZip: '',
    newAddressCountry: '',
    returnToWarehouse: false,
  })
  const [isCreating, setIsCreating] = React.useState(false)
  const [createDialogError, setCreateDialogError] = React.useState<string | null>(null)
  const [isLookingUpShipment, setIsLookingUpShipment] = React.useState(false)
  const [shipmentLookupError, setShipmentLookupError] = React.useState<string | null>(null)
  const [shipmentVerified, setShipmentVerified] = React.useState(false)
  const [verifiedShipmentData, setVerifiedShipmentData] = React.useState<{
    carrier: string
    trackingId: string
    status: string
    currentAddress: {
      name: string | null
      line1: string | null
      line2: string | null
      city: string | null
      state: string | null
      zipCode: string | null
      country: string | null
    } | null
  } | null>(null)

  // Reset form when dialog closes
  React.useEffect(() => {
    if (!open) {
      setCreateForm({
        ticketType: defaultTicketType,
        shipmentId: '',
        clientId: '',
        carrier: '',
        trackingNumber: '',
        description: '',
        initialNote: '',
        attachments: [],
        newAddressName: '',
        newAddressLine1: '',
        newAddressLine2: '',
        newAddressCity: '',
        newAddressState: '',
        newAddressZip: '',
        newAddressCountry: '',
        returnToWarehouse: false,
      })
      setCreateDialogError(null)
      setShipmentLookupError(null)
      setShipmentVerified(false)
      setVerifiedShipmentData(null)
    }
  }, [open])

  // Debounced shipment lookup to verify shipment and auto-populate data
  const lookupShipment = useDebouncedCallback(async (shipmentId: string) => {
    if (!shipmentId || shipmentId.length < 5) {
      setShipmentVerified(false)
      setVerifiedShipmentData(null)
      return
    }

    setIsLookingUpShipment(true)
    setShipmentLookupError(null)
    setShipmentVerified(false)
    setVerifiedShipmentData(null)

    try {
      const response = await fetch(`/api/data/shipments/${shipmentId}`)
      if (response.ok) {
        const data = await response.json()
        if (data.shipmentId) {
          const carrier = data.shipping?.carrier ? getCarrierDisplayName(data.shipping.carrier) : ''
          const trackingId = data.trackingId || ''
          setShipmentVerified(true)
          setVerifiedShipmentData({
            carrier,
            trackingId,
            status: data.status || '',
            currentAddress: data.customer?.address ? {
              name: data.customer.name || null,
              line1: data.customer.address.line1 || null,
              line2: data.customer.address.line2 || null,
              city: data.customer.address.city || null,
              state: data.customer.address.state || null,
              zipCode: data.customer.address.zipCode || null,
              country: data.customer.address.country || null,
            } : null,
          })
          setCreateForm(prev => ({
            ...prev,
            carrier,
            trackingNumber: trackingId,
            clientId: data.clientId || prev.clientId,
          }))
        }
      } else if (response.status === 404) {
        setShipmentLookupError('Shipment not found')
      } else {
        setShipmentLookupError('Failed to verify shipment')
      }
    } catch {
      setShipmentLookupError('Failed to verify shipment')
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

    // For Address Change: validate new address fields instead of description
    if (createForm.ticketType === 'Address Change') {
      if (!createForm.shipmentId.trim()) {
        setCreateDialogError('Shipment ID is required for Address Change tickets.')
        return
      }
      if (!createForm.newAddressLine1.trim() || !createForm.newAddressCity.trim() ||
          !createForm.newAddressState.trim() || !createForm.newAddressZip.trim()) {
        setCreateDialogError('New address fields (Line 1, City, State, Zip) are required.')
        return
      }
    } else {
      // All other types require description
      if (!createForm.description.trim()) {
        setCreateDialogError('Description is required.')
        return
      }
      // Shipment Inquiry also requires a verified shipment ID
      if (createForm.ticketType === 'Shipment Inquiry' && !createForm.shipmentId.trim()) {
        setCreateDialogError('Shipment ID is required for Shipment Inquiry tickets.')
        return
      }
    }

    setCreateDialogError(null)
    setIsCreating(true)

    // For Address Change: compose description from new address fields
    let submittedDescription = createForm.description || null
    let submittedStatus: string | undefined = undefined
    if (createForm.ticketType === 'Address Change') {
      const newAddrLines = [
        createForm.newAddressName,
        createForm.newAddressLine1,
        createForm.newAddressLine2,
        [createForm.newAddressCity, createForm.newAddressState, createForm.newAddressZip].filter(Boolean).join(', '),
        createForm.newAddressCountry,
      ].filter(Boolean).join('\n')
      let originalAddrSection = ''
      if (verifiedShipmentData?.currentAddress) {
        const addr = verifiedShipmentData.currentAddress
        const origLines = [
          addr.name, addr.line1, addr.line2,
          [addr.city, addr.state, addr.zipCode].filter(Boolean).join(', '),
          addr.country,
        ].filter(Boolean).join('\n')
        if (origLines) originalAddrSection = `Original Address:\n${origLines}\n\n`
      }
      submittedDescription = `${originalAddrSection}New Address:\n${newAddrLines}${createForm.returnToWarehouse ? '\n\nReturn to warehouse if too late.' : ''}`
      submittedStatus = 'Ticket Created'
    }

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
          description: submittedDescription,
          initialNote: createForm.initialNote.trim() || null,
          attachments: createForm.attachments.length > 0 ? createForm.attachments : null,
          ...(submittedStatus ? { status: submittedStatus } : {}),
          ...(isBrandUser ? { isBrandSubmission: true } : {}),
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
          <DialogTitle>{isBrandUser ? 'Request an Address Change' : 'Create New Ticket'}</DialogTitle>
          <DialogDescription>
            {isBrandUser
              ? 'Address change requests are not guaranteed. Each carrier will attempt to accommodate at their discretion.'
              : 'Create a support ticket for shipment inquiries, requests, technical issues, or general inquiries.'
            }
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

        <div className="space-y-5">
          {/* Row 1: Type + Shipment ID (or just Shipment ID full-width for brand users) */}
          {(() => {
            const isShipmentType = createForm.ticketType === 'Shipment Inquiry' || createForm.ticketType === 'Address Change'
            const showBrand = isAdmin && (!selectedClientId || selectedClientId === 'all')
            const shipmentIdField = (
              <div className="space-y-1.5">
                <Label htmlFor="shipmentId" className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                  Shipment ID <span className="text-red-500">*</span>
                </Label>
                <div className="relative">
                  <Input
                    id="shipmentId"
                    value={createForm.shipmentId}
                    onChange={(e) => {
                      const value = e.target.value
                      setCreateForm({ ...createForm, shipmentId: value })
                      if (!value) {
                        setShipmentVerified(false)
                        setVerifiedShipmentData(null)
                        setShipmentLookupError(null)
                      }
                      lookupShipment(value)
                    }}
                    placeholder="e.g., 330867617"
                    className="h-9 pr-8 placeholder:text-muted-foreground/40"
                  />
                  {isLookingUpShipment && (
                    <JetpackLoader size="sm" className="absolute right-3 top-2.5" />
                  )}
                  {!isLookingUpShipment && shipmentVerified && (
                    <CheckCircle2 className="absolute right-2.5 top-2.5 h-4 w-4 text-green-500" />
                  )}
                </div>
              </div>
            )

            // Brand users: always Address Change, no type picker, shipment ID full-width
            if (isBrandUser) {
              return shipmentIdField
            }

            return (
              <div className={cn("grid gap-4", isShipmentType || showBrand ? "grid-cols-2" : "grid-cols-1")}>
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
                      <SelectItem value="Shipment Inquiry">Shipment Inquiry</SelectItem>
                      <SelectItem value="Address Change">Address Change</SelectItem>
                      <SelectItem value="Request">Request</SelectItem>
                      <SelectItem value="Technical">Technical</SelectItem>
                      <SelectItem value="Inquiry">Inquiry</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {isShipmentType ? shipmentIdField : showBrand ? (
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
                ) : null}
              </div>
            )
          })()}

          {/* Shipment Inquiry / Address Change: verified info panel */}
          {(createForm.ticketType === 'Shipment Inquiry' || createForm.ticketType === 'Address Change') && (
            <>
              {/* Shipment Inquiry: green verified info card */}
              {createForm.ticketType === 'Shipment Inquiry' && shipmentVerified && verifiedShipmentData && (
                <div className="rounded-lg border border-green-200 dark:border-green-700 bg-green-50 dark:bg-green-900/20 px-4 py-3">
                  <div className="flex items-center gap-2 mb-3">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                    <span className="text-[11px] font-medium text-green-700 dark:text-green-400 uppercase tracking-wider">Shipment Verified</span>
                  </div>
                  <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-xs">
                    {createForm.clientId && clients.find(c => c.id === createForm.clientId) && (
                      <div><div className="text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-0.5">Brand</div><div className="text-zinc-700 dark:text-zinc-300 font-medium">{clients.find(c => c.id === createForm.clientId)!.company_name}</div></div>
                    )}
                    {verifiedShipmentData.carrier && (
                      <div><div className="text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-0.5">Carrier</div><div className="text-zinc-700 dark:text-zinc-300 font-medium">{verifiedShipmentData.carrier}</div></div>
                    )}
                    {verifiedShipmentData.trackingId && (
                      <div><div className="text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-0.5">Tracking</div><div className="text-zinc-700 dark:text-zinc-300 font-medium font-mono">{verifiedShipmentData.trackingId}</div></div>
                    )}
                    {verifiedShipmentData.status && (
                      <div><div className="text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-0.5">Status</div><div className="text-zinc-700 dark:text-zinc-300 font-medium">{verifiedShipmentData.status}</div></div>
                    )}
                  </div>
                </div>
              )}

              {/* Address Change: yellow current-address card */}
              {createForm.ticketType === 'Address Change' && shipmentVerified && verifiedShipmentData && (
                <div className="rounded-lg border border-green-200 dark:border-green-700 bg-green-50 dark:bg-green-900/20 px-4 py-3">
                  <div className="flex items-center gap-2 mb-3">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                    <span className="text-[11px] font-medium text-green-700 dark:text-green-400 uppercase tracking-wider">Current Shipment Details</span>
                  </div>
                  <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-xs">
                    {createForm.clientId && clients.find(c => c.id === createForm.clientId) && (
                      <div><div className="text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-0.5">Brand</div><div className="text-zinc-700 dark:text-zinc-300 font-medium">{clients.find(c => c.id === createForm.clientId)!.company_name}</div></div>
                    )}
                    {verifiedShipmentData.carrier && (
                      <div><div className="text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-0.5">Carrier</div><div className="text-zinc-700 dark:text-zinc-300 font-medium">{verifiedShipmentData.carrier}</div></div>
                    )}
                    {verifiedShipmentData.trackingId && (
                      <div><div className="text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-0.5">Tracking</div><div className="text-zinc-700 dark:text-zinc-300 font-medium font-mono">{verifiedShipmentData.trackingId}</div></div>
                    )}
                    {verifiedShipmentData.status && (
                      <div><div className="text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-0.5">Status</div><div className="text-zinc-700 dark:text-zinc-300 font-medium">{verifiedShipmentData.status}</div></div>
                    )}
                  </div>
                  {verifiedShipmentData.currentAddress && (
                    <div className="mt-2.5 pt-2.5 border-t border-green-200 dark:border-green-700 text-xs">
                      <span className="text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Current address</span>{' '}
                      <span className="text-zinc-700 dark:text-zinc-300">
                        {[
                          verifiedShipmentData.currentAddress.name,
                          verifiedShipmentData.currentAddress.line1,
                          verifiedShipmentData.currentAddress.line2,
                          [verifiedShipmentData.currentAddress.city, verifiedShipmentData.currentAddress.state, verifiedShipmentData.currentAddress.zipCode].filter(Boolean).join(', '),
                          verifiedShipmentData.currentAddress.country,
                        ].filter(Boolean).join(' · ')}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Address Change: new address fields */}
              {createForm.ticketType === 'Address Change' && (
                <div className="space-y-2">
                  <div>
                    <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">New Address <span className="text-red-500">*</span></span>
                  </div>
                  <div className="space-y-1.5">
                    <Input
                      value={createForm.newAddressName}
                      onChange={(e) => setCreateForm({ ...createForm, newAddressName: e.target.value })}
                      placeholder="Full name"
                      className="h-8 placeholder:text-muted-foreground/40"
                    />
                    <div className="grid grid-cols-2 gap-1.5">
                      <Input
                        value={createForm.newAddressLine1}
                        onChange={(e) => setCreateForm({ ...createForm, newAddressLine1: e.target.value })}
                        placeholder="Address line 1"
                        className="h-8 placeholder:text-muted-foreground/40"
                      />
                      <Input
                        value={createForm.newAddressLine2}
                        onChange={(e) => setCreateForm({ ...createForm, newAddressLine2: e.target.value })}
                        placeholder="Address line 2 (optional)"
                        className="h-8 placeholder:text-muted-foreground/40"
                      />
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                      <Input
                        value={createForm.newAddressCity}
                        onChange={(e) => setCreateForm({ ...createForm, newAddressCity: e.target.value })}
                        placeholder="City"
                        className="h-8 col-span-2 placeholder:text-muted-foreground/40"
                      />
                      <Input
                        value={createForm.newAddressState}
                        onChange={(e) => setCreateForm({ ...createForm, newAddressState: e.target.value })}
                        placeholder="State"
                        className="h-8 placeholder:text-muted-foreground/40"
                      />
                      <Input
                        value={createForm.newAddressZip}
                        onChange={(e) => setCreateForm({ ...createForm, newAddressZip: e.target.value })}
                        placeholder="Zip"
                        className="h-8 placeholder:text-muted-foreground/40"
                      />
                    </div>
                    <Input
                      value={createForm.newAddressCountry}
                      onChange={(e) => setCreateForm({ ...createForm, newAddressCountry: e.target.value })}
                      placeholder="Country"
                      className="h-8 placeholder:text-muted-foreground/40"
                    />
                  </div>
                  <label className="flex items-center gap-2.5 cursor-pointer select-none pt-1">
                    <input
                      type="checkbox"
                      checked={createForm.returnToWarehouse}
                      onChange={(e) => setCreateForm({ ...createForm, returnToWarehouse: e.target.checked })}
                      className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-600 accent-zinc-800 dark:accent-zinc-200 cursor-pointer"
                    />
                    <span className="text-sm text-zinc-700 dark:text-zinc-300">If too late for address change, request a return to warehouse</span>
                  </label>
                </div>
              )}
            </>
          )}

          {/* Description - hidden for Address Change (address fields replace it) */}
          {createForm.ticketType !== 'Address Change' && (
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
          )}

          {/* Internal Note - admin/care only */}
          {!isBrandUser && (
            <div className="space-y-1.5">
              <Label htmlFor="initialNote" className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                Internal Note (optional)
              </Label>
              <Input
                id="initialNote"
                value={createForm.initialNote}
                onChange={(e) => setCreateForm({ ...createForm, initialNote: e.target.value })}
                placeholder="Add a note to this ticket..."
                className="h-9 placeholder:text-muted-foreground/40"
              />
            </div>
          )}

          {/* File Attachments - hidden for Address Change */}
          {createForm.ticketType !== 'Address Change' && (
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
          )}
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
