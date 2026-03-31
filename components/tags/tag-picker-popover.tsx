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

interface TagPickerPopoverProps {
  /** Currently applied tags on the shipment */
  currentTags: string[]
  /** Called when tags are toggled — receives the full updated array */
  onTagsChange: (tags: string[]) => void
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
  currentTags,
  onTagsChange,
  children,
  side = "bottom",
  align = "start",
}: TagPickerPopoverProps) {
  const [open, setOpen] = React.useState(false)
  const [managerOpen, setManagerOpen] = React.useState(false)
  const [clientTags, setClientTags] = React.useState<ClientTag[]>([])
  const [isLoading, setIsLoading] = React.useState(false)
  const { selectedClientId } = useClient()

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

  const handleToggle = (tagName: string) => {
    const next = currentTags.includes(tagName)
      ? currentTags.filter(t => t !== tagName)
      : [...currentTags, tagName]
    onTagsChange(next)
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
                  const isActive = currentTags.includes(tag.name)
                  return (
                    <button
                      key={tag.id}
                      onClick={() => handleToggle(tag.name)}
                      className={cn(
                        "flex items-center gap-2 w-full px-3 py-1.5 text-left text-[13px] hover:bg-accent transition-colors",
                        isActive && "font-medium"
                      )}
                    >
                      <span className={cn(
                        "flex items-center justify-center w-4 h-4 rounded border",
                        isActive
                          ? "bg-primary border-primary text-primary-foreground"
                          : "border-muted-foreground/30"
                      )}>
                        {isActive && <CheckIcon className="h-3 w-3" />}
                      </span>
                      <TagIcon className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                      <span className="truncate">{tag.name}</span>
                    </button>
                  )
                })}
              </div>
              <div className="border-t px-3 py-2">
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
        </PopoverContent>
      </Popover>

      <TagManagerDialog
        open={managerOpen}
        onClose={handleManagerClose}
      />
    </>
  )
}
