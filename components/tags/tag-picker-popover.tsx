"use client"

import * as React from "react"
import { CheckIcon, SettingsIcon, TagIcon, LoaderIcon } from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { useClient } from "@/components/client-context"
import { TagManagerDialog } from "./tag-manager-dialog"
import { toast } from "sonner"

interface TagPickerPopoverProps {
  /** Shipment ID to tag */
  shipmentId: string
  /** Currently applied tags on the shipment */
  currentTags: string[]
  /** Called after tags are saved — receives shipmentId and new tags array */
  onTagsSaved: (shipmentId: string, tags: string[]) => void
  children: React.ReactNode
  /** Side of the popover */
  side?: "top" | "bottom" | "left" | "right"
  align?: "start" | "center" | "end"
}

interface ClientTag {
  id: string
  name: string
}

export function TagPickerPopover({
  shipmentId,
  currentTags,
  onTagsSaved,
  children,
  side = "bottom",
  align = "start",
}: TagPickerPopoverProps) {
  const [open, setOpen] = React.useState(false)
  const [managerOpen, setManagerOpen] = React.useState(false)
  const [clientTags, setClientTags] = React.useState<ClientTag[]>([])
  const [isLoading, setIsLoading] = React.useState(false)
  const [localTags, setLocalTags] = React.useState<string[]>([])
  const [savingTag, setSavingTag] = React.useState<string | null>(null)
  const { selectedClientId } = useClient()

  // Sync local state when popover opens
  React.useEffect(() => {
    if (open) {
      setLocalTags(currentTags)
    }
  }, [open, currentTags])

  // Fetch available tags when popover opens
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
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          {children}
        </PopoverTrigger>
        <PopoverContent
          side={side}
          align={align}
          className="w-[200px] p-0"
          onClick={(e) => e.stopPropagation()}
        >
          {isLoading ? (
            <div className="flex items-center justify-center py-6">
              <LoaderIcon className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : clientTags.length === 0 ? (
            <div className="px-3 py-4 text-center">
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
              <div className="max-h-[240px] overflow-y-auto py-1">
                {clientTags.map(tag => {
                  const isActive = localTags.includes(tag.name)
                  const isThisSaving = savingTag === tag.name
                  return (
                    <button
                      key={tag.id}
                      onClick={() => handleToggle(tag.name)}
                      disabled={savingTag !== null}
                      className={cn(
                        "flex items-center gap-2 w-full px-3 py-1.5 text-left text-[13px] hover:bg-accent transition-colors",
                        isActive && "font-medium",
                        savingTag !== null && "opacity-60"
                      )}
                    >
                      <span className={cn(
                        "flex items-center justify-center w-4 h-4 rounded border shrink-0",
                        isActive
                          ? "bg-primary border-primary text-primary-foreground"
                          : "border-muted-foreground/30"
                      )}>
                        {isThisSaving
                          ? <LoaderIcon className="h-2.5 w-2.5 animate-spin" />
                          : isActive && <CheckIcon className="h-3 w-3" />
                        }
                      </span>
                      <TagIcon className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                      <span className="truncate">{tag.name}</span>
                    </button>
                  )
                })}
              </div>
              <div className="border-t px-3 py-2 flex items-center justify-between">
                <button
                  onClick={() => setManagerOpen(true)}
                  className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  <SettingsIcon className="h-3 w-3" />
                  Manage Tags
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="text-[11px] font-medium text-primary hover:text-primary/80 transition-colors"
                >
                  Done
                </button>
              </div>
            </>
          )}
        </PopoverContent>
      </Popover>

      <TagManagerDialog
        open={managerOpen}
        onClose={handleManagerClose}
      />
    </>
  )
}
