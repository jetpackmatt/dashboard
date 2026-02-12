'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { X, Plus } from 'lucide-react'
import { toast } from 'sonner'

interface BillingEmailManagerProps {
  emails: string[]
  clientId: string
  onUpdate: (emails: string[]) => void
}

export function BillingEmailManager({ emails, clientId, onUpdate }: BillingEmailManagerProps) {
  const [localEmails, setLocalEmails] = useState<string[]>(emails || [])
  const [newEmail, setNewEmail] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)

  // Sync local state with prop changes
  useEffect(() => {
    setLocalEmails(emails || [])
  }, [emails])

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return emailRegex.test(email)
  }

  const handleAdd = () => {
    const trimmed = newEmail.trim()

    if (!trimmed) {
      toast.error('Please enter an email address')
      return
    }

    if (!validateEmail(trimmed)) {
      toast.error('Please enter a valid email address')
      return
    }

    if (localEmails.includes(trimmed)) {
      toast.error('This email is already in the list')
      return
    }

    if (localEmails.length >= 10) {
      toast.error('Maximum 10 email addresses allowed')
      return
    }

    setLocalEmails([...localEmails, trimmed])
    setNewEmail('')
    setShowAddForm(false)
  }

  const handleRemove = (index: number) => {
    setLocalEmails(localEmails.filter((_, i) => i !== index))
  }

  const handleSave = async () => {
    if (localEmails.length === 0) {
      toast.error('At least one email address is required')
      return
    }

    setIsSaving(true)
    try {
      const response = await fetch(`/api/data/billing?clientId=${clientId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ billing_emails: localEmails }),
      })

      if (response.ok) {
        toast.success('Billing emails updated')
        onUpdate(localEmails)
      } else {
        const error = await response.json()
        toast.error(error.error || 'Failed to update emails')
      }
    } catch (error) {
      console.error('Save failed:', error)
      toast.error('Failed to update emails')
    } finally {
      setIsSaving(false)
    }
  }

  const hasChanges = JSON.stringify(localEmails) !== JSON.stringify(emails)

  return (
    <div className="space-y-2">
      {/* Current emails list */}
      {localEmails.length > 0 && (
        <div className="space-y-1.5">
          {localEmails.map((email, index) => (
            <div key={index} className="flex items-center justify-between text-sm py-1">
              <span>{email}</span>
              <button
                onClick={() => handleRemove(index)}
                disabled={localEmails.length === 1}
                className="text-muted-foreground hover:text-destructive disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add email form - only show when button clicked */}
      {showAddForm ? (
        <div className="flex items-center gap-2 pt-1">
          <Input
            type="email"
            placeholder="Add email..."
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd()
              if (e.key === 'Escape') {
                setShowAddForm(false)
                setNewEmail('')
              }
            }}
            className="h-8 text-sm flex-1"
            autoFocus
          />
          <Button
            onClick={handleAdd}
            disabled={!newEmail.trim()}
            size="sm"
            variant="ghost"
            className="h-8 px-2"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <button
          onClick={() => setShowAddForm(true)}
          disabled={localEmails.length >= 10}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed pt-1"
        >
          <Plus className="h-3.5 w-3.5" />
          Add email...
        </button>
      )}

      {/* Save button */}
      {hasChanges && (
        <Button onClick={handleSave} disabled={isSaving} size="sm" className="mt-2">
          {isSaving ? 'Saving...' : 'Save Changes'}
        </Button>
      )}
    </div>
  )
}
