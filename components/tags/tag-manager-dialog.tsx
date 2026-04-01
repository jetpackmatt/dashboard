"use client"

import * as React from "react"
import { PlusIcon, TrashIcon, LoaderIcon, TagIcon, AlertTriangleIcon } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useClient } from "@/components/client-context"
import { toast } from "sonner"

interface ClientTag {
  id: string
  name: string
}

interface TagManagerDialogProps {
  open: boolean
  onClose: (refreshedTags?: ClientTag[]) => void
}

export function TagManagerDialog({ open, onClose }: TagManagerDialogProps) {
  const { selectedClientId } = useClient()
  const [tags, setTags] = React.useState<ClientTag[]>([])
  const [isLoading, setIsLoading] = React.useState(false)
  const [newTagName, setNewTagName] = React.useState("")
  const [isCreating, setIsCreating] = React.useState(false)
  const [deletingId, setDeletingId] = React.useState<string | null>(null)
  const [confirmTag, setConfirmTag] = React.useState<ClientTag | null>(null)
  const [confirmCount, setConfirmCount] = React.useState<number | null>(null)
  const [isCountLoading, setIsCountLoading] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  // Fetch tags on open
  React.useEffect(() => {
    if (!open || !selectedClientId) return
    setIsLoading(true)
    fetch(`/api/data/tags?clientId=${selectedClientId}`)
      .then(r => r.json())
      .then(result => setTags(result.data || []))
      .catch(() => {})
      .finally(() => setIsLoading(false))
  }, [open, selectedClientId])

  // Reset confirmation when dialog closes
  React.useEffect(() => {
    if (!open) {
      setConfirmTag(null)
      setConfirmCount(null)
    }
  }, [open])

  const handleCreate = async () => {
    const name = newTagName.trim()
    if (!name || !selectedClientId) return

    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      toast.error("Tags must be a single word (letters, numbers, dashes, underscores)")
      return
    }

    setIsCreating(true)
    try {
      const res = await fetch(`/api/data/tags?clientId=${selectedClientId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })

      if (res.status === 409) {
        toast.error("Tag already exists (names are case-insensitive)")
        return
      }

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to create tag')
      }

      const result = await res.json()
      setTags(prev => [...prev, result.data].sort((a, b) => a.name.localeCompare(b.name)))
      setNewTagName("")
      inputRef.current?.focus()
      toast.success(`Tag "${name}" created`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create tag')
    } finally {
      setIsCreating(false)
    }
  }

  const handleDeleteClick = async (tag: ClientTag) => {
    if (!selectedClientId) return
    setConfirmTag(tag)
    setConfirmCount(null)
    setIsCountLoading(true)

    try {
      const res = await fetch(`/api/data/tags/count?clientId=${selectedClientId}&tagName=${encodeURIComponent(tag.name)}`)
      if (res.ok) {
        const result = await res.json()
        setConfirmCount(result.count)
      } else {
        setConfirmCount(0)
      }
    } catch {
      setConfirmCount(0)
    } finally {
      setIsCountLoading(false)
    }
  }

  const handleDeleteConfirm = async () => {
    if (!confirmTag || !selectedClientId) return
    const tag = confirmTag
    setConfirmTag(null)
    setConfirmCount(null)
    setDeletingId(tag.id)
    try {
      const res = await fetch(`/api/data/tags?clientId=${selectedClientId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tagId: tag.id }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to delete tag')
      }

      setTags(prev => prev.filter(t => t.id !== tag.id))
      toast.success(`Tag "${tag.name}" deleted`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete tag')
    } finally {
      setDeletingId(null)
    }
  }

  const handleClose = () => {
    onClose(tags)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose() }}>
      <DialogContent className="sm:max-w-[380px]" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle className="text-base">Manage Tags</DialogTitle>
          <DialogDescription className="text-[12px]">
            Create and delete tags for this brand. Tags can be applied to shipments for filtering and organization.
          </DialogDescription>
        </DialogHeader>

        {/* Create new tag */}
        <div className="flex items-center gap-2">
          <Input
            ref={inputRef}
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
            placeholder="New tag name..."
            className="h-8 text-[13px]"
            disabled={isCreating}
          />
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={!newTagName.trim() || isCreating}
            className="h-8 px-3 shrink-0"
          >
            {isCreating ? <LoaderIcon className="h-3.5 w-3.5 animate-spin" /> : <PlusIcon className="h-3.5 w-3.5" />}
          </Button>
        </div>

        {/* Delete confirmation */}
        {confirmTag && (
          <div className="border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 rounded-md p-3 space-y-2">
            <div className="flex items-start gap-2">
              <AlertTriangleIcon className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
              <div className="text-[13px]">
                <p className="font-medium text-red-700 dark:text-red-400">
                  Delete &quot;{confirmTag.name}&quot;?
                </p>
                <p className="text-red-600/80 dark:text-red-400/70 text-[12px] mt-0.5">
                  {isCountLoading ? (
                    "Checking usage..."
                  ) : confirmCount && confirmCount > 0 ? (
                    <>This tag is used on <strong>{confirmCount}</strong> shipment{confirmCount !== 1 ? 's' : ''}. It will be removed from all of them.</>
                  ) : (
                    "This tag is not currently used on any shipments."
                  )}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { setConfirmTag(null); setConfirmCount(null) }}
                className="h-7 px-3 text-[12px]"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={handleDeleteConfirm}
                disabled={isCountLoading}
                className="h-7 px-3 text-[12px]"
              >
                Delete Tag
              </Button>
            </div>
          </div>
        )}

        {/* Tag list */}
        <div className="max-h-[280px] overflow-y-auto -mx-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <LoaderIcon className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : tags.length === 0 ? (
            <div className="text-center py-8 text-[12px] text-muted-foreground">
              No tags yet. Create one above.
            </div>
          ) : (
            <div className="space-y-0.5">
              {tags.map(tag => (
                <div
                  key={tag.id}
                  className="flex items-center justify-between gap-2 px-2 py-1.5 rounded hover:bg-accent/50 group"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <TagIcon className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                    <span className="text-[13px] truncate">{tag.name}</span>
                  </div>
                  <button
                    onClick={() => handleDeleteClick(tag)}
                    disabled={deletingId === tag.id || confirmTag?.id === tag.id}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-muted-foreground hover:text-red-600 dark:hover:text-red-400 transition-all shrink-0"
                    title={`Delete "${tag.name}"`}
                  >
                    {deletingId === tag.id
                      ? <LoaderIcon className="h-3.5 w-3.5 animate-spin" />
                      : <TrashIcon className="h-3.5 w-3.5" />
                    }
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
