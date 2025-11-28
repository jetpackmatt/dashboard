'use client'

import * as React from 'react'
import { Building2, Check, ChevronDown, Loader2, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useClient } from '@/components/client-context'

export function ClientSelector() {
  const {
    clients,
    selectedClientId,
    selectedClient,
    setSelectedClientId,
    isLoading,
    isAdmin,
  } = useClient()

  // Don't render if not admin or still loading
  if (isLoading) {
    return (
      <Button variant="ghost" size="sm" disabled className="gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="hidden sm:inline">Loading...</span>
      </Button>
    )
  }

  if (!isAdmin || clients.length === 0) {
    return null
  }

  const displayName = selectedClient?.company_name || 'All Brands'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 min-w-[140px] justify-between"
        >
          <div className="flex items-center gap-2">
            {selectedClient ? (
              <Building2 className="h-4 w-4 text-muted-foreground" />
            ) : (
              <Users className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="truncate max-w-[120px]">{displayName}</span>
          </div>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[220px]">
        <DropdownMenuLabel>Viewing Data For</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {/* All Brands option */}
        <DropdownMenuItem
          onClick={() => setSelectedClientId(null)}
          className="gap-2"
        >
          <Users className="h-4 w-4" />
          <span className="flex-1">All Brands</span>
          {selectedClientId === null && (
            <Check className="h-4 w-4 text-primary" />
          )}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/* Individual brands */}
        {clients.map((client) => (
          <DropdownMenuItem
            key={client.id}
            onClick={() => setSelectedClientId(client.id)}
            className="gap-2"
          >
            <Building2 className="h-4 w-4" />
            <span className="flex-1 truncate">{client.company_name}</span>
            <div className="flex items-center gap-1">
              {!client.has_token && (
                <span
                  className="h-2 w-2 rounded-full bg-yellow-500"
                  title="No API token"
                />
              )}
              {selectedClientId === client.id && (
                <Check className="h-4 w-4 text-primary" />
              )}
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
