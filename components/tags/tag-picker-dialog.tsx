"use client"

import * as React from "react"
import { CheckIcon, SettingsIcon, TagIcon, LoaderIcon } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { useClient } from "@/components/client-context"
import { TagManagerDialog } from "./tag-manager-dialog"
import { toast } from "sonner"

interface ClientTag {
  id: string
  name: string
}

interface TagPickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Shipment ID to tag */
  shipmentId: string | null
  /** Current tags on the shipment */
  currentTags: string[]
  /** Called after tags are successfully saved, with the new tags array */
  onTagsSaved: (shipmentId: string, tags: string[]) => void
}

export function TagPickerDialog({
  open,
  onOpenChange,
  shipmentId,
  currentTags,
  onTagsSaved,
}: TagPickerDialogProps) {
  const [managerOpen, setManagerOpen] = React.useState(false)
  const [clientTags, setClientTags] = React.useState<ClientTag[]>([])
  const [isLoading, setIsLoading] = React.useState(false)
  const [localTags, setLocalTags] = React.useState<string[]>([])
  const [savingTag, setSavingTag] = React.useState<string | null>(null)
  const { selectedClientId } = useClient()

  // Sync local state when dialog opens or currentTags change
  React.useEffect(() => {
    if (open) {
      setLocalTags(currentTags)
    }
  }, [open, currentTags])

  // Fetch available tags when dialog opens
  React.useEffect(() => {
    if (!open || !selectedClientId) return
    setIsLoading(true)
    fetch(`/api/data/tags?clientId=${selectedClientId}`)
      .then(r => r.json())
      .then(result => setClientTags(result.data || []))
      .catch(() => {})
      .finally(() => setIsLoading(false))
  }, [open, selectedClientId])

  const handleToggle = async (tagName: string) => {
    if (!shipmentId) return
    setSavingTag(tagName)

    const next = localTags.includes(tagName)
      ? localTags.filter(t => t !== tagName)
      : [...localTags, tagName]

    try {
      const res = await fetch(`/api/data/shipments/${shipmentId}/tags`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: next }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to update tags')
      }

      setLocalTags(next)
      onTagsSaved(shipmentId, next)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update tags')
    } finally {
      setSavingTag(null)
    }
  }

  const handleManagerClose = (refreshTags?: ClientTag[]) => {
    setManagerOpen(false)
    if (refreshTags) {
      setClientTags(refreshTags)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[280px] p-0 gap-0">
          <DialogHeader className="px-4 pt-4 pb-2">
            <DialogTitle className="text-sm font-medium">
              Tags{shipmentId ? ` — ${shipmentId}` : ''}
            </DialogTitle>
          </DialogHeader>

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <LoaderIcon className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : clientTags.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <p className="text-[12px] text-muted-foreground mb-2">No tags yet</p>
              <button
                onClick={() => setManagerOpen(true)}
                className="text-[12px] text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
              >
                Create your first tag
              </button>
            </div>
          ) : (
            <>
              <div className="max-h-[280px] overflow-y-auto py-1">
                {clientTags.map(tag => {
                  const isActive = localTags.includes(tag.name)
                  const isSaving = savingTag === tag.name
                  return (
                    <button
                      key={tag.id}
                      onClick={() => handleToggle(tag.name)}
                      disabled={isSaving}
                      className={cn(
                        "flex items-center gap-2 w-full px-4 py-2 text-left text-[13px] hover:bg-accent transition-colors",
                        isActive && "font-medium",
                        isSaving && "opacity-60"
                      )}
                    >
                      <span className={cn(
                        "flex items-center justify-center w-4 h-4 rounded border shrink-0",
                        isActive
                          ? "bg-primary border-primary text-primary-foreground"
                          : "border-muted-foreground/30"
                      )}>
                        {isSaving
                          ? <LoaderIcon className="h-2.5 w-2.5 animate-spin" />
                          : isActive && <CheckIcon className="h-3 w-3" />
                        }
                      </span>
                      <TagIcon className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                      <span className="truncate">{tag.name}</span>
                    </button>
                  )
                })}
              </div>
              <div className="border-t px-4 py-2.5">
                <button
                  onClick={() => setManagerOpen(true)}
                  className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  <SettingsIcon className="h-3 w-3" />
                  Manage Tags
                </button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <TagManagerDialog
        open={managerOpen}
        onClose={handleManagerClose}
      />
    </>
  )
}
