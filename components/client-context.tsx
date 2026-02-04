'use client'

import * as React from 'react'

export interface ClientInfo {
  id: string
  company_name: string
  merchant_id: string | null
  eshipper_id: string | null
  gofo_id: string | null
  short_code: string | null
  has_token: boolean
}

// Dev role type for role simulator
export type DevRole = 'admin' | 'care_admin' | 'care_team' | 'client'

interface ClientContextType {
  clients: ClientInfo[]
  selectedClientId: string | null // null = "All Clients"
  selectedClient: ClientInfo | null
  setSelectedClientId: (id: string | null) => void
  isLoading: boolean
  isAdmin: boolean // Real admin status from API
  isCareUser: boolean // Real care user status from API (care_admin or care_team)
  isCareAdmin: boolean // Real care_admin status from API
  // Dev role simulator (only works in development)
  devRole: DevRole
  setDevRole: (role: DevRole) => void
  effectiveIsAdmin: boolean // Takes dev role into account in dev mode
  effectiveIsCareUser: boolean // Takes dev role into account in dev mode
  effectiveIsCareAdmin: boolean // Takes dev role into account in dev mode
  refreshClients: () => Promise<void>
}

const ClientContext = React.createContext<ClientContextType | undefined>(
  undefined
)

const STORAGE_KEY = 'jetpack_selected_client_id'
const DEV_ROLE_KEY = 'jetpack_dev_role'
const isDev = process.env.NODE_ENV === 'development'

export function ClientProvider({ children }: { children: React.ReactNode }) {
  const [clients, setClients] = React.useState<ClientInfo[]>([])
  const [selectedClientId, setSelectedClientIdState] = React.useState<
    string | null
  >(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [isAdmin, setIsAdmin] = React.useState(false)
  const [isCareUser, setIsCareUser] = React.useState(false)
  const [isCareAdmin, setIsCareAdmin] = React.useState(false)

  // Dev role simulator state (only used in development)
  const [devRole, setDevRoleState] = React.useState<DevRole>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(DEV_ROLE_KEY)
      if (saved === 'admin' || saved === 'care_admin' || saved === 'care_team' || saved === 'client') return saved
    }
    return 'admin' // Default to admin in dev mode
  })

  // Persist dev role to localStorage
  const setDevRole = React.useCallback((role: DevRole) => {
    setDevRoleState(role)
    if (typeof window !== 'undefined') {
      localStorage.setItem(DEV_ROLE_KEY, role)
    }
  }, [])

  // Effective role statuses - respect dev role in development mode
  const effectiveIsAdmin = isDev ? devRole === 'admin' : isAdmin
  const effectiveIsCareUser = isDev ? (devRole === 'care_admin' || devRole === 'care_team') : isCareUser
  const effectiveIsCareAdmin = isDev ? devRole === 'care_admin' : isCareAdmin

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
        setIsCareUser(false)
        setIsCareAdmin(false)
        setClients([])
        return
      }

      if (response.status === 403) {
        // Not admin or care user - regular brand user
        setIsAdmin(false)
        setIsCareUser(false)
        setIsCareAdmin(false)
        return
      }

      if (!response.ok) {
        throw new Error('Failed to fetch clients')
      }

      const data = await response.json()
      setClients(data.clients || [])
      // Set role flags from API response
      setIsAdmin(data.isAdmin || false)
      setIsCareUser(data.isCareUser || false)
      setIsCareAdmin(data.userRole === 'care_admin')
    } catch (error) {
      console.error('Error fetching clients:', error)
      setIsAdmin(false)
      setIsCareUser(false)
      setIsCareAdmin(false)
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
      isCareUser,
      isCareAdmin,
      devRole,
      setDevRole,
      effectiveIsAdmin,
      effectiveIsCareUser,
      effectiveIsCareAdmin,
      refreshClients: fetchClients,
    }),
    [
      clients,
      selectedClientId,
      selectedClient,
      setSelectedClientId,
      isLoading,
      isAdmin,
      isCareUser,
      isCareAdmin,
      devRole,
      setDevRole,
      effectiveIsAdmin,
      effectiveIsCareUser,
      effectiveIsCareAdmin,
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
