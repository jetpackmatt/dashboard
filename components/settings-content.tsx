'use client'

import * as React from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import {
  Building2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
  Plus,
  Settings,
  User,
  Users,
  Wrench,
  Shield,
  Mail,
  UserPlus,
  Trash2,
  Key,
  Eye,
  EyeOff,
  MapPin,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useClient } from '@/components/client-context'

interface ConnectionTestResult {
  clientId: string
  status: 'idle' | 'testing' | 'success' | 'error'
  message?: string
  latency?: number
}

interface UserWithClients {
  id: string
  email: string
  created_at: string
  user_metadata: {
    full_name?: string
    role?: string
  }
  clients: Array<{
    client_id: string
    client_name: string
    role: string
  }>
}

interface BillingAddress {
  street: string
  city: string
  region: string
  postalCode: string
  country: string
}

interface ClientForManage {
  id: string
  company_name: string
  shipbob_user_id: string | null
  short_code: string | null
  has_token: boolean
  billing_address?: BillingAddress | null
}

const isDev = process.env.NODE_ENV === 'development'

export function SettingsContent() {
  const { clients, isLoading, isAdmin, refreshClients } = useClient()

  // Tab state with URL persistence - using Next.js hooks
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const validTabs = ['profile', 'users', 'brands', 'dev']
  const tabFromUrl = searchParams.get('tab')
  const initialTab = tabFromUrl && validTabs.includes(tabFromUrl) ? tabFromUrl : 'profile'
  const [activeTab, setActiveTab] = React.useState(initialTab)

  // Sync tab to URL when it changes
  const handleTabChange = React.useCallback((newTab: string) => {
    setActiveTab(newTab)
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', newTab)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }, [searchParams, router, pathname])

  const [testResults, setTestResults] = React.useState<
    Record<string, ConnectionTestResult>
  >({})
  const [isRefreshing, setIsRefreshing] = React.useState(false)
  const [devRole, setDevRole] = React.useState<'admin' | 'client'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('jetpack_dev_role')
      if (saved === 'admin' || saved === 'client') return saved
    }
    return 'client'
  })

  // Persist devRole to localStorage when it changes
  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('jetpack_dev_role', devRole)
    }
  }, [devRole])
  const [addClientOpen, setAddClientOpen] = React.useState(false)
  const [newClientName, setNewClientName] = React.useState('')
  const [newShipBobUserId, setNewShipBobUserId] = React.useState('')
  const [newShortCode, setNewShortCode] = React.useState('')
  const [isAddingClient, setIsAddingClient] = React.useState(false)
  const [addClientError, setAddClientError] = React.useState<string | null>(null)

  // Manage client state
  const [manageOpen, setManageOpen] = React.useState(false)
  const [managingClient, setManagingClient] = React.useState<ClientForManage | null>(null)
  const [editCompanyName, setEditCompanyName] = React.useState('')
  const [editShipBobUserId, setEditShipBobUserId] = React.useState('')
  const [editShortCode, setEditShortCode] = React.useState('')
  const [editToken, setEditToken] = React.useState('')
  // Billing address fields
  const [editBillingStreet, setEditBillingStreet] = React.useState('')
  const [editBillingCity, setEditBillingCity] = React.useState('')
  const [editBillingRegion, setEditBillingRegion] = React.useState('')
  const [editBillingPostalCode, setEditBillingPostalCode] = React.useState('')
  const [editBillingCountry, setEditBillingCountry] = React.useState('')
  const [isSaving, setIsSaving] = React.useState(false)
  const [isSavingToken, setIsSavingToken] = React.useState(false)
  const [isDeletingToken, setIsDeletingToken] = React.useState(false)
  const [isDeleting, setIsDeleting] = React.useState(false)
  const [manageError, setManageError] = React.useState<string | null>(null)
  const [manageSuccess, setManageSuccess] = React.useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false)

  // Profile state
  const [profileName, setProfileName] = React.useState('')
  const [profileEmail, setProfileEmail] = React.useState('')
  const [currentPassword, setCurrentPassword] = React.useState('')
  const [newPassword, setNewPassword] = React.useState('')
  const [confirmPassword, setConfirmPassword] = React.useState('')
  const [isLoadingProfile, setIsLoadingProfile] = React.useState(true)
  const [isSavingProfile, setIsSavingProfile] = React.useState(false)
  const [isChangingPassword, setIsChangingPassword] = React.useState(false)
  const [profileError, setProfileError] = React.useState<string | null>(null)
  const [profileSuccess, setProfileSuccess] = React.useState<string | null>(null)
  const [passwordError, setPasswordError] = React.useState<string | null>(null)
  const [passwordSuccess, setPasswordSuccess] = React.useState<string | null>(null)

  // User management state
  const [users, setUsers] = React.useState<UserWithClients[]>([])
  const [isLoadingUsers, setIsLoadingUsers] = React.useState(false)
  const [inviteOpen, setInviteOpen] = React.useState(false)
  const [inviteEmail, setInviteEmail] = React.useState('')
  const [inviteFullName, setInviteFullName] = React.useState('')
  const [inviteClientId, setInviteClientId] = React.useState('')
  const [inviteRole, setInviteRole] = React.useState<'owner' | 'editor' | 'viewer'>('viewer')
  const [isInviting, setIsInviting] = React.useState(false)
  const [inviteError, setInviteError] = React.useState<string | null>(null)
  const [inviteSuccess, setInviteSuccess] = React.useState<string | null>(null)

  // Sync state
  const [isSyncing, setIsSyncing] = React.useState(false)
  const [syncResult, setSyncResult] = React.useState<{
    success: boolean
    summary?: {
      totalClients: number
      totalOrdersFound: number
      totalOrdersInserted: number
      totalOrdersUpdated: number
      totalErrors: number
      // Billing fields
      totalInvoicesFound?: number
      totalInvoicesInserted?: number
      totalTransactionsFound?: number
      totalTransactionsInserted?: number
      totalTransactionsUpdated?: number
    }
    error?: string
  } | null>(null)

  // In dev mode, allow overriding the role for testing
  const effectiveIsAdmin = isDev ? devRole === 'admin' : isAdmin

  const handleTestConnection = async (clientId: string) => {
    setTestResults((prev) => ({
      ...prev,
      [clientId]: { clientId, status: 'testing' },
    }))

    try {
      const response = await fetch(
        `/api/admin/clients/${clientId}/test-connection`,
        { method: 'POST' }
      )
      const data = await response.json()

      if (response.ok && data.success) {
        setTestResults((prev) => ({
          ...prev,
          [clientId]: {
            clientId,
            status: 'success',
            message: `Connected successfully`,
            latency: data.latency,
          },
        }))
      } else {
        setTestResults((prev) => ({
          ...prev,
          [clientId]: {
            clientId,
            status: 'error',
            message: data.error || 'Connection failed',
          },
        }))
      }
    } catch {
      setTestResults((prev) => ({
        ...prev,
        [clientId]: {
          clientId,
          status: 'error',
          message: 'Network error',
        },
      }))
    }
  }

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await refreshClients()
    setIsRefreshing(false)
  }

  const handleAddClient = async () => {
    if (!newClientName.trim()) {
      setAddClientError('Company name is required')
      return
    }

    setIsAddingClient(true)
    setAddClientError(null)

    try {
      // Validate short_code format (2-3 uppercase letters)
      const trimmedShortCode = newShortCode.trim().toUpperCase()
      if (trimmedShortCode && !/^[A-Z]{2,3}$/.test(trimmedShortCode)) {
        setAddClientError('Short code must be 2-3 uppercase letters')
        return
      }

      const response = await fetch('/api/admin/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: newClientName.trim(),
          merchant_id: newShipBobUserId.trim() || null,
          short_code: trimmedShortCode || null,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        setAddClientError(data.error || 'Failed to add client')
        return
      }

      // Success - close dialog, reset form, refresh list
      setAddClientOpen(false)
      setNewClientName('')
      setNewShipBobUserId('')
      setNewShortCode('')
      await refreshClients()
    } catch {
      setAddClientError('Network error')
    } finally {
      setIsAddingClient(false)
    }
  }

  const openManageDialog = (client: ClientForManage) => {
    setManagingClient(client)
    setEditCompanyName(client.company_name)
    setEditShipBobUserId(client.shipbob_user_id || '')
    setEditShortCode(client.short_code || '')
    setEditToken('')
    // Initialize billing address fields
    setEditBillingStreet(client.billing_address?.street || '')
    setEditBillingCity(client.billing_address?.city || '')
    setEditBillingRegion(client.billing_address?.region || '')
    setEditBillingPostalCode(client.billing_address?.postalCode || '')
    setEditBillingCountry(client.billing_address?.country || '')
    setManageError(null)
    setManageSuccess(null)
    setShowDeleteConfirm(false)
    setManageOpen(true)
  }

  const handleSaveClientDetails = async () => {
    if (!managingClient) return
    if (!editCompanyName.trim()) {
      setManageError('Company name is required')
      return
    }

    // Validate short_code format (2-3 uppercase letters)
    const trimmedShortCode = editShortCode.trim().toUpperCase()
    if (trimmedShortCode && !/^[A-Z]{2,3}$/.test(trimmedShortCode)) {
      setManageError('Short code must be 2-3 uppercase letters')
      return
    }

    setIsSaving(true)
    setManageError(null)

    try {
      // Build billing address if any field is filled
      const hasBillingAddress = editBillingStreet || editBillingCity || editBillingRegion || editBillingPostalCode || editBillingCountry
      const billingAddress = hasBillingAddress ? {
        street: editBillingStreet.trim(),
        city: editBillingCity.trim(),
        region: editBillingRegion.trim(),
        postalCode: editBillingPostalCode.trim(),
        country: editBillingCountry.trim(),
      } : null

      const response = await fetch(`/api/admin/clients/${managingClient.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: editCompanyName.trim(),
          merchant_id: editShipBobUserId.trim() || null,
          short_code: trimmedShortCode || null,
          billing_address: billingAddress,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        setManageError(data.error || 'Failed to update')
        return
      }

      // Close dialog and refresh in background
      setManageOpen(false)
      refreshClients()
    } catch {
      setManageError('Network error')
    } finally {
      setIsSaving(false)
    }
  }

  const handleSaveToken = async () => {
    if (!managingClient) return
    if (!editToken.trim()) {
      setManageError('API token is required')
      return
    }

    setIsSavingToken(true)
    setManageError(null)

    try {
      const response = await fetch(`/api/admin/clients/${managingClient.id}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: editToken.trim() }),
      })

      if (!response.ok) {
        const data = await response.json()
        setManageError(data.error || 'Failed to save token')
        return
      }

      setManageSuccess('API token saved')
      setEditToken('')
      setManagingClient({ ...managingClient, has_token: true })
      await refreshClients()
      setTimeout(() => setManageSuccess(null), 2000)
    } catch {
      setManageError('Network error')
    } finally {
      setIsSavingToken(false)
    }
  }

  const handleDeleteToken = async () => {
    if (!managingClient) return

    setIsDeletingToken(true)
    setManageError(null)

    try {
      const response = await fetch(`/api/admin/clients/${managingClient.id}/token`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        setManageError(data.error || 'Failed to delete token')
        return
      }

      setManageSuccess('API token removed')
      setManagingClient({ ...managingClient, has_token: false })
      await refreshClients()
      setTimeout(() => setManageSuccess(null), 2000)
    } catch {
      setManageError('Network error')
    } finally {
      setIsDeletingToken(false)
    }
  }

  const handleDeleteClient = async () => {
    if (!managingClient) return

    setIsDeleting(true)
    setManageError(null)

    try {
      const response = await fetch(`/api/admin/clients/${managingClient.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        setManageError(data.error || 'Failed to delete brand')
        return
      }

      setManageOpen(false)
      await refreshClients()
    } catch {
      setManageError('Network error')
    } finally {
      setIsDeleting(false)
    }
  }

  // Fetch profile on mount
  React.useEffect(() => {
    const fetchProfile = async () => {
      try {
        const response = await fetch('/api/auth/profile')
        if (response.ok) {
          const data = await response.json()
          setProfileName(data.user?.user_metadata?.full_name || '')
          setProfileEmail(data.user?.email || '')
        }
      } catch (error) {
        console.error('Failed to fetch profile:', error)
      } finally {
        setIsLoadingProfile(false)
      }
    }
    fetchProfile()
  }, [])

  const handleSaveProfile = async () => {
    setIsSavingProfile(true)
    setProfileError(null)
    setProfileSuccess(null)

    try {
      const response = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: profileName.trim(),
          email: profileEmail.trim(),
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        setProfileError(data.error || 'Failed to update profile')
        return
      }

      setProfileSuccess('Profile updated successfully')
      setTimeout(() => setProfileSuccess(null), 3000)
    } catch {
      setProfileError('Network error')
    } finally {
      setIsSavingProfile(false)
    }
  }

  const handleChangePassword = async () => {
    setPasswordError(null)
    setPasswordSuccess(null)

    if (!newPassword || newPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters')
      return
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match')
      return
    }

    setIsChangingPassword(true)

    try {
      const response = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPassword }),
      })

      const data = await response.json()

      if (!response.ok) {
        setPasswordError(data.error || 'Failed to change password')
        return
      }

      setPasswordSuccess('Password changed successfully')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setTimeout(() => setPasswordSuccess(null), 3000)
    } catch {
      setPasswordError('Network error')
    } finally {
      setIsChangingPassword(false)
    }
  }

  // Fetch users (admin only)
  const fetchUsers = React.useCallback(async () => {
    if (!effectiveIsAdmin) return

    setIsLoadingUsers(true)
    try {
      const response = await fetch('/api/admin/users')
      const data = await response.json()
      if (response.ok) {
        setUsers(data.users || [])
      }
    } catch (error) {
      console.error('Failed to fetch users:', error)
    } finally {
      setIsLoadingUsers(false)
    }
  }, [effectiveIsAdmin])

  // Load users when admin
  React.useEffect(() => {
    if (effectiveIsAdmin) {
      fetchUsers()
    }
  }, [effectiveIsAdmin, fetchUsers])

  const handleSyncOrders = async () => {
    setIsSyncing(true)
    setSyncResult(null)

    try {
      const response = await fetch('/api/admin/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ daysBack: 30 }),
      })

      const data = await response.json()

      if (!response.ok) {
        setSyncResult({ success: false, error: data.error || 'Sync failed' })
        return
      }

      setSyncResult({ success: true, summary: data.summary })
    } catch (error) {
      setSyncResult({ success: false, error: 'Network error' })
    } finally {
      setIsSyncing(false)
    }
  }

  const handleInviteUser = async () => {
    if (!inviteEmail.trim()) {
      setInviteError('Email is required')
      return
    }
    if (!inviteClientId) {
      setInviteError('Please select a brand')
      return
    }

    setIsInviting(true)
    setInviteError(null)
    setInviteSuccess(null)

    try {
      const response = await fetch('/api/admin/users/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          client_id: inviteClientId,
          role: inviteRole,
          full_name: inviteFullName.trim() || undefined,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        setInviteError(data.error || 'Failed to invite user')
        return
      }

      // Success
      setInviteSuccess(`Invitation sent to ${inviteEmail}`)
      setInviteEmail('')
      setInviteFullName('')
      setInviteClientId('')
      setInviteRole('viewer')
      await fetchUsers()

      // Close dialog after a delay
      setTimeout(() => {
        setInviteOpen(false)
        setInviteSuccess(null)
      }, 2000)
    } catch {
      setInviteError('Network error')
    } finally {
      setIsInviting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="p-4 lg:p-6">
      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          {effectiveIsAdmin && (
            <TabsTrigger value="brands">Brands</TabsTrigger>
          )}
          {isDev && (
            <TabsTrigger value="dev">Dev Tools</TabsTrigger>
          )}
        </TabsList>

        {/* Profile Tab - Available to all users */}
        <TabsContent value="profile" className="space-y-6">
          {/* Profile Details Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                Profile Details
              </CardTitle>
              <CardDescription>
                Update your display name and email address
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingProfile ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="space-y-4 max-w-md">
                  <div className="space-y-2">
                    <Label htmlFor="profile_name">Display Name</Label>
                    <Input
                      id="profile_name"
                      value={profileName}
                      onChange={(e) => setProfileName(e.target.value)}
                      placeholder="Your name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="profile_email">Email Address</Label>
                    <Input
                      id="profile_email"
                      type="email"
                      value={profileEmail}
                      onChange={(e) => setProfileEmail(e.target.value)}
                      placeholder="your@email.com"
                    />
                    <p className="text-xs text-muted-foreground">
                      Changing your email will require verification.
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <Button
                      onClick={handleSaveProfile}
                      disabled={isSavingProfile}
                    >
                      {isSavingProfile ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : null}
                      Save Changes
                    </Button>
                    {profileError && (
                      <span className="text-sm text-red-600 dark:text-red-400 flex items-center gap-1">
                        <AlertCircle className="h-4 w-4" />
                        {profileError}
                      </span>
                    )}
                    {profileSuccess && (
                      <span className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1">
                        <CheckCircle2 className="h-4 w-4" />
                        {profileSuccess}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Password Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5" />
                Change Password
              </CardTitle>
              <CardDescription>
                Update your password to keep your account secure
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4 max-w-md">
                <div className="space-y-2">
                  <Label htmlFor="new_password">New Password</Label>
                  <Input
                    id="new_password"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm_password">Confirm New Password</Label>
                  <Input
                    id="confirm_password"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                  />
                  <p className="text-xs text-muted-foreground">
                    Password must be at least 8 characters.
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <Button
                    onClick={handleChangePassword}
                    disabled={isChangingPassword || !newPassword || !confirmPassword}
                  >
                    {isChangingPassword ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : null}
                    Change Password
                  </Button>
                  {passwordError && (
                    <span className="text-sm text-red-600 dark:text-red-400 flex items-center gap-1">
                      <AlertCircle className="h-4 w-4" />
                      {passwordError}
                    </span>
                  )}
                  {passwordSuccess && (
                    <span className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1">
                      <CheckCircle2 className="h-4 w-4" />
                      {passwordSuccess}
                    </span>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Users Tab - Available to all users but different views */}
        <TabsContent value="users" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    {effectiveIsAdmin ? 'All Users' : 'Team Members'}
                  </CardTitle>
                  <CardDescription>
                    {effectiveIsAdmin
                      ? 'Manage all users across the platform'
                      : 'Manage team members for your organization'}
                  </CardDescription>
                </div>
                {effectiveIsAdmin && (
                  <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm">
                        <UserPlus className="h-4 w-4 mr-2" />
                        Invite User
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Invite User</DialogTitle>
                        <DialogDescription>
                          Send an invitation to join the platform and access a brand.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <Label htmlFor="invite_email">Email Address *</Label>
                          <Input
                            id="invite_email"
                            type="email"
                            placeholder="user@example.com"
                            value={inviteEmail}
                            onChange={(e) => setInviteEmail(e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="invite_name">Full Name</Label>
                          <Input
                            id="invite_name"
                            placeholder="John Smith (optional)"
                            value={inviteFullName}
                            onChange={(e) => setInviteFullName(e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="invite_client">Assign to Brand *</Label>
                          <Select
                            value={inviteClientId}
                            onValueChange={setInviteClientId}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select a brand" />
                            </SelectTrigger>
                            <SelectContent>
                              {clients.map((client) => (
                                <SelectItem key={client.id} value={client.id}>
                                  {client.company_name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="invite_role">Role</Label>
                          <Select
                            value={inviteRole}
                            onValueChange={(v: 'owner' | 'editor' | 'viewer') => setInviteRole(v)}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="viewer">Viewer (read-only)</SelectItem>
                              <SelectItem value="editor">Editor (can edit)</SelectItem>
                              <SelectItem value="owner">Owner (full access)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        {inviteError && (
                          <div className="text-sm text-red-600 dark:text-red-400">
                            {inviteError}
                          </div>
                        )}
                        {inviteSuccess && (
                          <div className="text-sm text-green-600 dark:text-green-400 flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4" />
                            {inviteSuccess}
                          </div>
                        )}
                      </div>
                      <DialogFooter>
                        <Button
                          variant="outline"
                          onClick={() => setInviteOpen(false)}
                          disabled={isInviting}
                        >
                          Cancel
                        </Button>
                        <Button
                          onClick={handleInviteUser}
                          disabled={isInviting || !!inviteSuccess}
                        >
                          {isInviting ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              Sending...
                            </>
                          ) : (
                            <>
                              <Mail className="h-4 w-4 mr-2" />
                              Send Invitation
                            </>
                          )}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {effectiveIsAdmin ? (
                isLoadingUsers ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : users.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No users found. Invite users to get started.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {users.map((user) => (
                      <div
                        key={user.id}
                        className="flex items-center justify-between p-4 border rounded-lg"
                      >
                        <div className="flex items-center gap-4">
                          <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                            <User className="h-5 w-5 text-muted-foreground" />
                          </div>
                          <div>
                            <div className="font-medium">
                              {user.user_metadata?.full_name || user.email}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {user.email}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {user.user_metadata?.role === 'admin' && (
                            <Badge variant="default">
                              <Shield className="h-3 w-3 mr-1" />
                              Admin
                            </Badge>
                          )}
                          {user.clients.length > 0 ? (
                            user.clients.map((c) => (
                              <Badge key={c.client_id} variant="outline">
                                <Building2 className="h-3 w-3 mr-1" />
                                {c.client_name}
                              </Badge>
                            ))
                          ) : (
                            <Badge variant="secondary">No brands</Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              ) : (
                <div className="text-muted-foreground">
                  <p className="mb-4">Team management coming soon:</p>
                  <ul className="list-disc list-inside space-y-2">
                    <li>Invite team members to your organization</li>
                    <li>Set permissions for team members</li>
                    <li>Control access to dashboard sections</li>
                    <li>Remove team members</li>
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Brands Tab - Admin only */}
        {effectiveIsAdmin && (
          <TabsContent value="brands" className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Building2 className="h-5 w-5" />
                      Brand Management
                    </CardTitle>
                    <CardDescription>
                      Manage brand ShipBob API connections and tokens
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRefresh}
                      disabled={isRefreshing}
                    >
                      <RefreshCw
                        className={cn('h-4 w-4 mr-2', isRefreshing && 'animate-spin')}
                      />
                      Refresh
                    </Button>
                    <Dialog open={addClientOpen} onOpenChange={setAddClientOpen}>
                      <DialogTrigger asChild>
                        <Button variant="outline" size="sm">
                          <Plus className="h-4 w-4 mr-2" />
                          Add Brand
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Add New Brand</DialogTitle>
                          <DialogDescription>
                            Add a new brand to manage their ShipBob integration.
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                          <div className="space-y-2">
                            <Label htmlFor="company_name">Company Name *</Label>
                            <Input
                              id="company_name"
                              placeholder="e.g., Henson Shaving"
                              value={newClientName}
                              onChange={(e) => setNewClientName(e.target.value)}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="shipbob_user_id">ShipBob User ID</Label>
                            <Input
                              id="shipbob_user_id"
                              placeholder="e.g., 386350 (optional)"
                              value={newShipBobUserId}
                              onChange={(e) => setNewShipBobUserId(e.target.value)}
                            />
                            <p className="text-xs text-muted-foreground">
                              The ShipBob user ID for API authentication. Can be added later.
                            </p>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="short_code">Short Code (for invoices)</Label>
                            <Input
                              id="short_code"
                              placeholder="e.g., HS (2-3 letters)"
                              value={newShortCode}
                              onChange={(e) => setNewShortCode(e.target.value.toUpperCase())}
                              maxLength={3}
                            />
                            <p className="text-xs text-muted-foreground">
                              2-3 letter code for invoice numbers (e.g., JPHS-0001). Required for billing.
                            </p>
                          </div>
                          {addClientError && (
                            <div className="text-sm text-red-600 dark:text-red-400">
                              {addClientError}
                            </div>
                          )}
                        </div>
                        <DialogFooter>
                          <Button
                            variant="outline"
                            onClick={() => setAddClientOpen(false)}
                            disabled={isAddingClient}
                          >
                            Cancel
                          </Button>
                          <Button
                            onClick={handleAddClient}
                            disabled={isAddingClient}
                          >
                            {isAddingClient ? (
                              <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Adding...
                              </>
                            ) : (
                              'Add Brand'
                            )}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {clients.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No brands found. Add a brand to get started.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {clients.map((client) => {
                      const testResult = testResults[client.id]
                      return (
                        <div
                          key={client.id}
                          className="flex items-center justify-between p-4 border rounded-lg"
                        >
                          <div className="flex items-center gap-4">
                            <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                              <Building2 className="h-5 w-5 text-muted-foreground" />
                            </div>
                            <div>
                              <div className="font-medium">{client.company_name}</div>
                              <div className="text-sm text-muted-foreground">
                                ShipBob User ID: {client.shipbob_user_id || 'Not set'}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            {client.has_token ? (
                              <Badge
                                variant="outline"
                                className="bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800"
                              >
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                Token Active
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-300 dark:border-yellow-800"
                              >
                                <AlertCircle className="h-3 w-3 mr-1" />
                                No Token
                              </Badge>
                            )}

                            {testResult?.status === 'success' && (
                              <Badge
                                variant="outline"
                                className="bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800"
                              >
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                {testResult.latency}ms
                              </Badge>
                            )}
                            {testResult?.status === 'error' && (
                              <Badge
                                variant="outline"
                                className="bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800"
                              >
                                <AlertCircle className="h-3 w-3 mr-1" />
                                {testResult.message}
                              </Badge>
                            )}

                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleTestConnection(client.id)}
                              disabled={
                                !client.has_token || testResult?.status === 'testing'
                              }
                            >
                              {testResult?.status === 'testing' ? (
                                <>
                                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                  Testing...
                                </>
                              ) : (
                                <>
                                  <RefreshCw className="h-4 w-4 mr-2" />
                                  Test
                                </>
                              )}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openManageDialog(client)}
                            >
                              <Settings className="h-4 w-4 mr-2" />
                              Manage
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Manage Brand Dialog */}
            <Dialog open={manageOpen} onOpenChange={setManageOpen}>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Manage Brand</DialogTitle>
                  <DialogDescription>
                    Edit brand details, manage API tokens, or delete this brand.
                  </DialogDescription>
                </DialogHeader>

                {managingClient && (
                  <div className="space-y-6 py-4">
                    {/* Brand Details Section */}
                    <div className="space-y-4">
                      <h3 className="font-medium flex items-center gap-2">
                        <Building2 className="h-4 w-4" />
                        Brand Details
                      </h3>
                      <div className="space-y-3">
                        <div className="space-y-2">
                          <Label htmlFor="edit_company_name">Company Name *</Label>
                          <Input
                            id="edit_company_name"
                            value={editCompanyName}
                            onChange={(e) => setEditCompanyName(e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="edit_shipbob_id">ShipBob User ID</Label>
                          <Input
                            id="edit_shipbob_id"
                            value={editShipBobUserId}
                            onChange={(e) => setEditShipBobUserId(e.target.value)}
                            placeholder="e.g., 386350"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="edit_short_code">Short Code (for invoices)</Label>
                          <Input
                            id="edit_short_code"
                            value={editShortCode}
                            onChange={(e) => setEditShortCode(e.target.value.toUpperCase())}
                            placeholder="e.g., HS (2-3 letters)"
                            maxLength={3}
                          />
                          <p className="text-xs text-muted-foreground">
                            2-3 letter code for invoice numbers (e.g., JPHS-0001). Required for billing.
                          </p>
                        </div>

                        {/* Billing Address */}
                        <div className="space-y-3 pt-3 border-t">
                          <h4 className="font-medium text-sm flex items-center gap-2">
                            <MapPin className="h-3.5 w-3.5" />
                            Billing Address (for invoices)
                          </h4>
                          <div className="space-y-2">
                            <Label htmlFor="edit_billing_street">Street Address</Label>
                            <Input
                              id="edit_billing_street"
                              value={editBillingStreet}
                              onChange={(e) => setEditBillingStreet(e.target.value)}
                              placeholder="e.g., 123 Main St, Suite 400"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-2">
                              <Label htmlFor="edit_billing_city">City</Label>
                              <Input
                                id="edit_billing_city"
                                value={editBillingCity}
                                onChange={(e) => setEditBillingCity(e.target.value)}
                                placeholder="e.g., Toronto"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="edit_billing_region">Province/State</Label>
                              <Input
                                id="edit_billing_region"
                                value={editBillingRegion}
                                onChange={(e) => setEditBillingRegion(e.target.value)}
                                placeholder="e.g., ON"
                              />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-2">
                              <Label htmlFor="edit_billing_postal">Postal/ZIP Code</Label>
                              <Input
                                id="edit_billing_postal"
                                value={editBillingPostalCode}
                                onChange={(e) => setEditBillingPostalCode(e.target.value)}
                                placeholder="e.g., M5V 1K4"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="edit_billing_country">Country</Label>
                              <Input
                                id="edit_billing_country"
                                value={editBillingCountry}
                                onChange={(e) => setEditBillingCountry(e.target.value)}
                                placeholder="e.g., CANADA"
                              />
                            </div>
                          </div>
                        </div>

                        <Button
                          size="sm"
                          onClick={handleSaveClientDetails}
                          disabled={isSaving}
                        >
                          {isSaving ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          ) : null}
                          Save Details
                        </Button>
                      </div>
                    </div>

                    {/* API Token Section */}
                    <div className="space-y-4 pt-4 border-t">
                      <h3 className="font-medium flex items-center gap-2">
                        <Key className="h-4 w-4" />
                        ShipBob API Token
                      </h3>
                      <div className="space-y-3">
                        {managingClient.has_token ? (
                          <div className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-950 rounded-lg border border-green-200 dark:border-green-800">
                            <div className="flex items-center gap-2 text-green-700 dark:text-green-300">
                              <CheckCircle2 className="h-4 w-4" />
                              <span className="text-sm font-medium">Token configured</span>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handleDeleteToken}
                              disabled={isDeletingToken}
                              className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            >
                              {isDeletingToken ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 p-3 bg-yellow-50 dark:bg-yellow-950 rounded-lg border border-yellow-200 dark:border-yellow-800">
                            <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
                            <span className="text-sm text-yellow-700 dark:text-yellow-300">No token configured</span>
                          </div>
                        )}

                        <div className="space-y-2">
                          <Label htmlFor="edit_token">
                            {managingClient.has_token ? 'Replace Token' : 'Add Token'}
                          </Label>
                          <Input
                            id="edit_token"
                            type="password"
                            value={editToken}
                            onChange={(e) => setEditToken(e.target.value)}
                            placeholder="pat_xxxxxxxx..."
                          />
                          <p className="text-xs text-muted-foreground">
                            Enter the ShipBob Personal Access Token for this brand.
                          </p>
                        </div>
                        <Button
                          size="sm"
                          onClick={handleSaveToken}
                          disabled={isSavingToken || !editToken.trim()}
                        >
                          {isSavingToken ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          ) : (
                            <Key className="h-4 w-4 mr-2" />
                          )}
                          {managingClient.has_token ? 'Update Token' : 'Save Token'}
                        </Button>
                      </div>
                    </div>

                    {/* Delete Section */}
                    <div className="space-y-4 pt-4 border-t">
                      <h3 className="font-medium flex items-center gap-2 text-red-600 dark:text-red-400">
                        <Trash2 className="h-4 w-4" />
                        Danger Zone
                      </h3>
                      {!showDeleteConfirm ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setShowDeleteConfirm(true)}
                          className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete Brand
                        </Button>
                      ) : (
                        <div className="p-4 border border-red-200 dark:border-red-800 rounded-lg bg-red-50 dark:bg-red-950 space-y-3">
                          <p className="text-sm text-red-700 dark:text-red-300">
                            Are you sure you want to delete <strong>{managingClient.company_name}</strong>? This action cannot be undone.
                          </p>
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setShowDeleteConfirm(false)}
                              disabled={isDeleting}
                            >
                              Cancel
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={handleDeleteClient}
                              disabled={isDeleting}
                            >
                              {isDeleting ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4 mr-2" />
                              )}
                              Yes, Delete
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Status Messages */}
                    {manageError && (
                      <div className="text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
                        <AlertCircle className="h-4 w-4" />
                        {manageError}
                      </div>
                    )}
                    {manageSuccess && (
                      <div className="text-sm text-green-600 dark:text-green-400 flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4" />
                        {manageSuccess}
                      </div>
                    )}
                  </div>
                )}

                <DialogFooter>
                  <Button variant="outline" onClick={() => setManageOpen(false)}>
                    Close
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </TabsContent>
        )}

        {/* Dev Tools Tab - Development only */}
        {isDev && (
          <TabsContent value="dev" className="space-y-6">
            <Card className="border-orange-200 dark:border-orange-800">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-orange-600 dark:text-orange-400">
                  <Wrench className="h-5 w-5" />
                  Development Tools
                </CardTitle>
                <CardDescription>
                  These tools are only visible in development mode
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Role Switcher */}
                <div className="space-y-3">
                  <h3 className="font-medium flex items-center gap-2">
                    <Shield className="h-4 w-4" />
                    Role Simulator
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Switch between admin and client views without logging out.
                    This only affects the UI - API calls still use your real role.
                  </p>
                  <div className="flex items-center gap-4">
                    <Select
                      value={devRole}
                      onValueChange={(value: 'admin' | 'client') => setDevRole(value)}
                    >
                      <SelectTrigger className="w-[200px]">
                        <SelectValue placeholder="Select role" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">
                          <span className="flex items-center gap-2">
                            <Shield className="h-4 w-4 text-blue-500" />
                            Admin
                          </span>
                        </SelectItem>
                        <SelectItem value="client">
                          <span className="flex items-center gap-2">
                            <User className="h-4 w-4 text-green-500" />
                            Brand User
                          </span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <Badge variant={devRole === 'admin' ? 'default' : 'secondary'}>
                      Currently viewing as: {devRole === 'admin' ? 'Jetpack Admin' : 'Brand User'}
                    </Badge>
                  </div>
                </div>

                {/* Current User Info */}
                <div className="space-y-3 pt-4 border-t">
                  <h3 className="font-medium">Current Session Info</h3>
                  <div className="text-sm space-y-1 text-muted-foreground">
                    <p>Real isAdmin from API: <code className="bg-muted px-1 rounded">{String(isAdmin)}</code></p>
                    <p>Effective isAdmin (with dev override): <code className="bg-muted px-1 rounded">{String(effectiveIsAdmin)}</code></p>
                    <p>Clients loaded: <code className="bg-muted px-1 rounded">{clients.length}</code></p>
                  </div>
                </div>

                {/* Data Sync */}
                <div className="space-y-3 pt-4 border-t">
                  <h3 className="font-medium flex items-center gap-2">
                    <RefreshCw className="h-4 w-4" />
                    ShipBob Data Sync
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Full sync: Orders (per-brand tokens) + Billing/Transactions (parent token).
                  </p>
                  <div className="flex items-center gap-4">
                    <Button
                      onClick={handleSyncOrders}
                      disabled={isSyncing}
                      variant="outline"
                    >
                      {isSyncing ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Syncing...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2" />
                          Full Sync (Last 30 Days)
                        </>
                      )}
                    </Button>
                  </div>
                  {syncResult && (
                    <div className={cn(
                      "p-4 rounded-lg border",
                      syncResult.success
                        ? "bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800"
                        : "bg-red-50 border-red-200 dark:bg-red-950 dark:border-red-800"
                    )}>
                      {syncResult.success && syncResult.summary ? (
                        <div className="space-y-3">
                          <div className="flex items-center gap-2 text-green-700 dark:text-green-300">
                            <CheckCircle2 className="h-4 w-4" />
                            <span className="font-medium">Sync Complete</span>
                          </div>
                          <div className="text-sm text-green-600 dark:text-green-400 space-y-1">
                            <p className="font-medium">Orders (per brand):</p>
                            <p className="pl-3">Brands synced: {syncResult.summary.totalClients}</p>
                            <p className="pl-3">Orders found: {syncResult.summary.totalOrdersFound}</p>
                            <p className="pl-3">New: {syncResult.summary.totalOrdersInserted} | Updated: {syncResult.summary.totalOrdersUpdated}</p>
                          </div>
                          {(syncResult.summary.totalInvoicesFound !== undefined || syncResult.summary.totalTransactionsFound !== undefined) && (
                            <div className="text-sm text-green-600 dark:text-green-400 space-y-1 pt-2 border-t border-green-200 dark:border-green-700">
                              <p className="font-medium">Billing (parent account):</p>
                              <p className="pl-3">Invoices: {syncResult.summary.totalInvoicesFound} found, {syncResult.summary.totalInvoicesInserted} synced</p>
                              <p className="pl-3">Transactions: {syncResult.summary.totalTransactionsFound} found</p>
                              <p className="pl-3">New: {syncResult.summary.totalTransactionsInserted} | Updated: {syncResult.summary.totalTransactionsUpdated}</p>
                            </div>
                          )}
                          {syncResult.summary.totalErrors > 0 && (
                            <p className="text-yellow-600 pt-2">Errors: {syncResult.summary.totalErrors}</p>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-red-700 dark:text-red-300">
                          <AlertCircle className="h-4 w-4" />
                          <span>{syncResult.error || 'Sync failed'}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
