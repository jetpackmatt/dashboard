'use client'

import * as React from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import {
  Building2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
  User,
  Users,
  Wrench,
  Shield,
  Mail,
  UserPlus,
  Key,
  HeartHandshake,
  UserCog,
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
import { useClient, DevRole } from '@/components/client-context'

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

const isDev = process.env.NODE_ENV === 'development'

export function SettingsContent() {
  const { clients, isLoading, isAdmin, devRole, setDevRole, effectiveIsAdmin, effectiveIsCareUser, effectiveIsCareAdmin } = useClient()

  // Tab state with URL persistence - using Next.js hooks
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const validTabs = ['profile', 'users', 'dev']
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

  // Profile state
  const [profileName, setProfileName] = React.useState('')
  const [profileEmail, setProfileEmail] = React.useState('')
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
  // User type: 'admin', 'care_admin', 'care_team' are global roles (no brand assignment)
  // 'brand_user' requires brand assignment with sub-role (owner/editor/viewer)
  const [inviteUserType, setInviteUserType] = React.useState<'admin' | 'care_admin' | 'care_team' | 'brand_user'>('brand_user')
  const [inviteBrandRole, setInviteBrandRole] = React.useState<'owner' | 'editor' | 'viewer'>('viewer')
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
    } catch {
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
    // Brand assignment only required for brand users
    if (inviteUserType === 'brand_user' && !inviteClientId) {
      setInviteError('Please select a brand')
      return
    }

    setIsInviting(true)
    setInviteError(null)
    setInviteSuccess(null)

    try {
      // Different endpoints for different user types
      const isBrandUser = inviteUserType === 'brand_user'
      const endpoint = isBrandUser ? '/api/admin/users/invite' : '/api/admin/care-users'

      const body = isBrandUser
        ? {
            email: inviteEmail.trim(),
            client_id: inviteClientId,
            role: inviteBrandRole,
            full_name: inviteFullName.trim() || undefined,
          }
        : {
            email: inviteEmail.trim(),
            role: inviteUserType, // 'admin', 'care_admin', or 'care_team'
            full_name: inviteFullName.trim() || undefined,
          }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
      setInviteUserType('brand_user')
      setInviteBrandRole('viewer')
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
                        {/* Email */}
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

                        {/* Full Name */}
                        <div className="space-y-2">
                          <Label htmlFor="invite_name">Full Name</Label>
                          <Input
                            id="invite_name"
                            placeholder="John Smith (optional)"
                            value={inviteFullName}
                            onChange={(e) => setInviteFullName(e.target.value)}
                          />
                        </div>

                        {/* User Type (Role) - moved before brand */}
                        <div className="space-y-2">
                          <Label htmlFor="invite_user_type">User Type *</Label>
                          <Select
                            value={inviteUserType}
                            onValueChange={(v: 'admin' | 'care_admin' | 'care_team' | 'brand_user') => {
                              setInviteUserType(v)
                              // Clear brand selection when switching away from brand user
                              if (v !== 'brand_user') {
                                setInviteClientId('')
                              }
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="admin">
                                <span className="flex items-center gap-2">
                                  <Shield className="h-4 w-4 text-blue-500" />
                                  Admin (full platform access)
                                </span>
                              </SelectItem>
                              <SelectItem value="care_admin">
                                <span className="flex items-center gap-2">
                                  <UserCog className="h-4 w-4 text-purple-500" />
                                  Care Admin (care team lead)
                                </span>
                              </SelectItem>
                              <SelectItem value="care_team">
                                <span className="flex items-center gap-2">
                                  <HeartHandshake className="h-4 w-4 text-pink-500" />
                                  Care Team (support staff)
                                </span>
                              </SelectItem>
                              <SelectItem value="brand_user">
                                <span className="flex items-center gap-2">
                                  <Building2 className="h-4 w-4 text-green-500" />
                                  Brand User (client access)
                                </span>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Brand Assignment - only shown for brand_user */}
                        {inviteUserType === 'brand_user' && (
                          <>
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

                            {/* Brand Role - only for brand users */}
                            <div className="space-y-2">
                              <Label htmlFor="invite_brand_role">Brand Role</Label>
                              <Select
                                value={inviteBrandRole}
                                onValueChange={(v: 'owner' | 'editor' | 'viewer') => setInviteBrandRole(v)}
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
                          </>
                        )}

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
                    Switch between different user role views without logging out.
                    This only affects the UI - API calls still use your real role.
                  </p>
                  <div className="flex items-center gap-4">
                    <Select
                      value={devRole}
                      onValueChange={(value: DevRole) => setDevRole(value)}
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
                        <SelectItem value="care_admin">
                          <span className="flex items-center gap-2">
                            <UserCog className="h-4 w-4 text-purple-500" />
                            Care Admin
                          </span>
                        </SelectItem>
                        <SelectItem value="care_team">
                          <span className="flex items-center gap-2">
                            <HeartHandshake className="h-4 w-4 text-pink-500" />
                            Care Team
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
                    <Badge variant={devRole === 'admin' ? 'default' : devRole === 'care_admin' || devRole === 'care_team' ? 'outline' : 'secondary'}>
                      Currently viewing as: {
                        devRole === 'admin' ? 'Jetpack Admin' :
                        devRole === 'care_admin' ? 'Care Admin' :
                        devRole === 'care_team' ? 'Care Team' :
                        'Brand User'
                      }
                    </Badge>
                  </div>
                </div>

                {/* Current User Info */}
                <div className="space-y-3 pt-4 border-t">
                  <h3 className="font-medium">Current Session Info</h3>
                  <div className="text-sm space-y-1 text-muted-foreground">
                    <p>Real isAdmin from API: <code className="bg-muted px-1 rounded">{String(isAdmin)}</code></p>
                    <p>Effective isAdmin: <code className="bg-muted px-1 rounded">{String(effectiveIsAdmin)}</code></p>
                    <p>Effective isCareUser: <code className="bg-muted px-1 rounded">{String(effectiveIsCareUser)}</code></p>
                    <p>Effective isCareAdmin: <code className="bg-muted px-1 rounded">{String(effectiveIsCareAdmin)}</code></p>
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
