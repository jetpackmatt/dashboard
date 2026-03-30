'use client'

import * as React from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  type BrandPermissions,
  type PermissionKey,
  PERMISSION_SECTIONS,
  DEFAULT_PERMISSIONS,
} from '@/lib/permissions'

interface PermissionEditorProps {
  permissions: BrandPermissions
  onChange: (permissions: BrandPermissions) => void
  disabled?: boolean
}

export function PermissionEditor({ permissions, onChange, disabled }: PermissionEditorProps) {
  const handleSectionToggle = (sectionKey: string, checked: boolean) => {
    const updated = { ...permissions }
    // Toggle top-level key
    ;(updated as Record<string, boolean>)[sectionKey] = checked
    // Toggle all children
    const section = PERMISSION_SECTIONS.find(s => s.key === sectionKey)
    if (section) {
      for (const child of section.children) {
        updated[child.key] = checked
      }
    }
    onChange(updated)
  }

  const handleChildToggle = (sectionKey: string, childKey: PermissionKey, checked: boolean) => {
    const updated = { ...permissions }
    updated[childKey] = checked

    // If unchecking the last child, uncheck the parent too
    // If checking any child, ensure parent is checked
    const section = PERMISSION_SECTIONS.find(s => s.key === sectionKey)
    if (section && section.children.length > 0) {
      const anyChecked = section.children.some(c =>
        c.key === childKey ? checked : updated[c.key] !== false
      )
      ;(updated as Record<string, boolean>)[sectionKey] = anyChecked
    }
    onChange(updated)
  }

  return (
    <div className="space-y-4">
      {PERMISSION_SECTIONS.map(section => {
        const sectionChecked = (permissions as Record<string, boolean>)[section.key] !== false
        const childStates = section.children.map(c => permissions[c.key] !== false)
        const allChildrenChecked = childStates.every(Boolean)
        const someChildrenChecked = childStates.some(Boolean)
        const isIndeterminate = sectionChecked && someChildrenChecked && !allChildrenChecked

        return (
          <div key={section.key} className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id={`perm-${section.key}`}
                checked={isIndeterminate ? 'indeterminate' : sectionChecked && allChildrenChecked}
                onCheckedChange={(checked) => handleSectionToggle(section.key, checked === true)}
                disabled={disabled}
              />
              <Label
                htmlFor={`perm-${section.key}`}
                className="text-sm font-medium cursor-pointer"
              >
                {section.label}
              </Label>
            </div>
            {section.children.length > 0 && (
              <div className="ml-6 space-y-1.5">
                {section.children.map(child => (
                  <div key={child.key} className="flex items-center gap-2">
                    <Checkbox
                      id={`perm-${child.key}`}
                      checked={permissions[child.key] !== false}
                      onCheckedChange={(checked) =>
                        handleChildToggle(section.key, child.key, checked === true)
                      }
                      disabled={disabled}
                    />
                    <Label
                      htmlFor={`perm-${child.key}`}
                      className="text-xs text-muted-foreground cursor-pointer"
                    >
                      {child.label}
                    </Label>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
