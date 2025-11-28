'use client'

import * as React from 'react'

export interface ClientInfo {
  id: string
  company_name: string
  shipbob_user_id: string | null
  has_token: boolean
}

interface ClientContextType {
  clients: ClientInfo[]
  selectedClientId: string | null // null = "All Clients"
  selectedClient: ClientInfo | null
  setSelectedClientId: (id: string | null) => void
  isLoading: boolean
  isAdmin: boolean
  refreshClients: () => Promise<void>
}

const ClientContext = React.createContext<ClientContextType | undefined>(
  undefined
)

const STORAGE_KEY = 'jetpack_selected_client_id'

export function ClientProvider({ children }: { children: React.ReactNode }) {
  const [clients, setClients] = React.useState<ClientInfo[]>([])
  const [selectedClientId, setSelectedClientIdState] = React.useState<
    string | null
  >(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isAdmin, setIsAdmin] = React.useState(false)

  // Load from localStorage on mount
  React.useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && stored !== 'null') {
      setSelectedClientIdState(stored)
    }
  }, [])

  // Fetch clients on mount
  const fetchClients = React.useCallback(async () => {
    try {
      setIsLoading(true)
      const response = await fetch('/api/admin/clients')

      if (response.status === 401) {
        // Not authenticated
        setIsAdmin(false)
        setClients([])
        return
      }

      if (response.status === 403) {
        // Not admin
        setIsAdmin(false)
        return
      }

      if (!response.ok) {
        throw new Error('Failed to fetch clients')
      }

      const data = await response.json()
      setClients(data.clients || [])
      setIsAdmin(true)
    } catch (error) {
      console.error('Error fetching clients:', error)
      setIsAdmin(false)
    } finally {
      setIsLoading(false)
    }
  }, [])

  React.useEffect(() => {
    fetchClients()
  }, [fetchClients])

  // Persist selection to localStorage
  const setSelectedClientId = React.useCallback((id: string | null) => {
    setSelectedClientIdState(id)
    if (id === null) {
      localStorage.removeItem(STORAGE_KEY)
    } else {
      localStorage.setItem(STORAGE_KEY, id)
    }
  }, [])

  // Get the selected client object
  const selectedClient = React.useMemo(() => {
    if (!selectedClientId) return null
    return clients.find((c) => c.id === selectedClientId) || null
  }, [clients, selectedClientId])

  const value = React.useMemo(
    () => ({
      clients,
      selectedClientId,
      selectedClient,
      setSelectedClientId,
      isLoading,
      isAdmin,
      refreshClients: fetchClients,
    }),
    [
      clients,
      selectedClientId,
      selectedClient,
      setSelectedClientId,
      isLoading,
      isAdmin,
      fetchClients,
    ]
  )

  return (
    <ClientContext.Provider value={value}>{children}</ClientContext.Provider>
  )
}

export function useClient() {
  const context = React.useContext(ClientContext)
  if (context === undefined) {
    throw new Error('useClient must be used within a ClientProvider')
  }
  return context
}
