'use client'

import * as React from 'react'
import { PlusIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { SavedView } from '@/hooks/use-saved-views'

interface SavedViewsBarProps {
  views: SavedView[]
  activeViewId: string | null
  isModified: boolean
  onLoad: (id: string) => void
  onSave: (name: string) => void
  onUpdate: (id: string) => void
  onDelete: (id: string) => void
  onDeselect: () => void
}

export function SavedViewsBar({
  views,
  activeViewId,
  isModified,
  onLoad,
  onSave,
  onUpdate,
  onDelete,
  onDeselect,
}: SavedViewsBarProps) {
  const [saveOpen, setSaveOpen] = React.useState(false)
  const [viewName, setViewName] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)

  // Focus input when popover opens
  React.useEffect(() => {
    if (saveOpen) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [saveOpen])

  const handleSave = () => {
    const name = viewName.trim()
    if (!name) return
    onSave(name)
    setViewName('')
    setSaveOpen(false)
  }

  const handleUpdate = () => {
    if (activeViewId) {
      onUpdate(activeViewId)
      setSaveOpen(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave()
    }
  }

  const activeView = activeViewId ? views.find(v => v.id === activeViewId) : null

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      {/* Saved preset pills */}
      {views.map((view) => {
        const isActive = view.id === activeViewId
        return (
          <div
            key={view.id}
            className={cn(
              'group flex items-center h-[30px] rounded-md border text-xs font-normal whitespace-nowrap transition-colors',
              isActive
                ? 'bg-primary/10 text-primary border-primary/30'
                : 'bg-background text-muted-foreground border-border hover:bg-accent hover:text-accent-foreground'
            )}
          >
            <button
              onClick={() => isActive ? onDeselect() : onLoad(view.id)}
              className="px-3 h-full"
            >
              <span>{view.name}</span>
              {isActive && isModified && (
                <span className="ml-1 text-primary/60">*</span>
              )}
            </button>
            {/* Inline X on hover */}
            <button
              onClick={() => onDelete(view.id)}
              className="h-full pr-2 -ml-1 hidden group-hover:flex items-center opacity-40 hover:opacity-100 hover:text-destructive transition-opacity"
            >
              <XIcon className="h-3 w-3" />
            </button>
          </div>
        )
      })}

      {/* Save / Update / Delete popover */}
      <Popover open={saveOpen} onOpenChange={setSaveOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-[30px] px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
          >
            <PlusIcon className="h-3.5 w-3.5" />
            {views.length === 0 ? 'Save Preset' : 'Save'}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[220px] p-3" align="start">
          <div className="space-y-2">
            {/* Update existing preset option */}
            {activeViewId && isModified && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full h-[30px] text-xs justify-start"
                  onClick={handleUpdate}
                >
                  Update &ldquo;{activeView?.name}&rdquo;
                </Button>
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs">
                    <span className="bg-popover px-2 text-muted-foreground">or save new preset</span>
                  </div>
                </div>
              </>
            )}
            <Input
              ref={inputRef}
              value={viewName}
              onChange={(e) => setViewName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Preset name..."
              className="h-[30px] text-xs"
              maxLength={30}
            />
            <Button
              size="sm"
              className="w-full h-[30px] text-xs"
              onClick={handleSave}
              disabled={!viewName.trim() || views.length >= 10}
            >
              {views.length >= 10 ? 'Max 10 presets' : 'Save Preset'}
            </Button>

          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
