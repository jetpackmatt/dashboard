import { createClient } from '@supabase/supabase-js'

/**
 * Supabase Admin Client
 *
 * Uses SERVICE_ROLE key - bypasses RLS entirely.
 * ONLY use this server-side in API routes, never expose to client.
 *
 * Use cases:
 * - Reading client_api_credentials (no RLS policies = blocked from anon/authenticated)
 * - Admin operations that need to bypass RLS
 * - Background jobs and cron tasks
 */

// Singleton instance - reused across requests
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let adminClient: any = null

// Returns untyped client since we don't have generated Supabase types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createAdminClient(): any {
  if (adminClient) return adminClient

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Missing Supabase admin credentials. Ensure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set.'
    )
  }

  adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  return adminClient
}

// ============================================================================
// CRITICAL SECURITY: Client Access Verification
// ============================================================================
//
// ⚠️  ABSOLUTELY CRUCIAL: Jetpack clients can NEVER see any other client's data.
// ⚠️  Clients can NEVER see admin settings, markups, costs, or ShipBob invoices.
// ⚠️  This is VITAL - failure could sink the business.
//
// ALL data routes MUST use verifyClientAccess() before returning any data.
// NEVER use hardcoded client IDs or fallbacks.
// NEVER trust clientId from query params without verification.
// ============================================================================

import { createClient as createServerClient } from '@/lib/supabase/server'

// ============================================================================
// User Role Types
// ============================================================================
//
// Role hierarchy (stored in user_metadata.role):
// - 'admin'      : Full access to Admin panel, can see/manage all clients
// - 'care_admin' : Full access to Jetpack Care, can edit tickets, sees all clients
// - 'care_team'  : View-only access to Jetpack Care, sees all clients
// - undefined    : Regular client user (access controlled via user_clients table)
//
// ============================================================================

export type UserRole = 'admin' | 'care_admin' | 'care_team' | undefined

/**
 * Check if a role is an admin role (full admin access)
 */
export function isAdminRole(role: string | undefined): boolean {
  return role === 'admin'
}

/**
 * Check if a role is a Care user (care_admin or care_team)
 */
export function isCareRole(role: string | undefined): boolean {
  return role === 'care_admin' || role === 'care_team'
}

/**
 * Check if a role is Care Admin (can edit in Jetpack Care)
 */
export function isCareAdminRole(role: string | undefined): boolean {
  return role === 'care_admin'
}

/**
 * Check if a role has access to all clients (admin or care roles)
 */
export function hasAllClientsAccess(role: string | undefined): boolean {
  return role === 'admin' || role === 'care_admin' || role === 'care_team'
}

export interface ClientAccessResult {
  isAdmin: boolean
  isCareUser: boolean  // true for care_admin or care_team
  userRole: UserRole
  allowedClientIds: string[]  // Empty for admin/care users means "all clients"
  requestedClientId: string | null  // null means "all" (admin/care users only)
}

/**
 * CRITICAL SECURITY FUNCTION
 *
 * Verifies that the current user has access to the requested client(s).
 * - Admin users (user_metadata.role === 'admin') can access all clients
 * - Care users (care_admin, care_team) can access all clients (for ticket management)
 * - Regular users can only access clients they're assigned to via user_clients
 * - Returns 401 if not authenticated
 * - Returns 403 if user doesn't have access to requested client
 * - Returns 400 if clientId is missing and user is not admin/care
 *
 * @param requestedClientId - The clientId from query params. 'all' means all clients (admin/care only)
 * @returns ClientAccessResult with verified access info
 * @throws Error with status code in message (e.g., "401: Not authenticated")
 */
export async function verifyClientAccess(
  requestedClientId: string | null | undefined
): Promise<ClientAccessResult> {
  // Get current user from session
  const supabase = await createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    throw new Error('401: Not authenticated')
  }

  const userRole = user.user_metadata?.role as UserRole
  const isAdmin = isAdminRole(userRole)
  const isCareUser = isCareRole(userRole)

  // Admin and Care users can access all clients
  if (isAdmin || isCareUser) {
    // 'all' or null means all clients
    if (!requestedClientId || requestedClientId === 'all') {
      return {
        isAdmin,
        isCareUser,
        userRole,
        allowedClientIds: [], // Empty means "all" for admin/care users
        requestedClientId: null,
      }
    }
    // Admin/Care user requesting specific client
    return {
      isAdmin,
      isCareUser,
      userRole,
      allowedClientIds: [requestedClientId],
      requestedClientId,
    }
  }

  // Regular users: get their allowed clients from user_clients table
  const adminClient = createAdminClient()
  const { data: userClients, error: ucError } = await adminClient
    .from('user_clients')
    .select('client_id')
    .eq('user_id', user.id)

  if (ucError) {
    console.error('Failed to fetch user clients:', ucError)
    throw new Error('500: Failed to verify client access')
  }

  const allowedClientIds = (userClients || []).map((uc: { client_id: string }) => uc.client_id)

  // Regular user with no client assignments = no access to anything
  if (allowedClientIds.length === 0) {
    throw new Error('403: No client access configured for this user')
  }

  // Regular user requesting 'all' = forbidden
  if (requestedClientId === 'all') {
    throw new Error('403: Only administrators can view all clients')
  }

  // Regular user with no clientId specified
  if (!requestedClientId) {
    // If user has exactly one client, use that
    if (allowedClientIds.length === 1) {
      return {
        isAdmin: false,
        isCareUser: false,
        userRole: undefined,
        allowedClientIds,
        requestedClientId: allowedClientIds[0],
      }
    }
    // Multiple clients but none specified - require explicit selection
    throw new Error('400: clientId parameter is required')
  }

  // Regular user requesting specific client - verify access
  if (!allowedClientIds.includes(requestedClientId)) {
    throw new Error('403: Access denied to this client')
  }

  return {
    isAdmin: false,
    isCareUser: false,
    userRole: undefined,
    allowedClientIds,
    requestedClientId,
  }
}

/**
 * Helper to parse error from verifyClientAccess and return appropriate response
 */
export function handleAccessError(error: unknown): Response {
  const message = error instanceof Error ? error.message : 'Unknown error'
  const match = message.match(/^(\d{3}): (.+)$/)

  if (match) {
    const status = parseInt(match[1])
    const errorMessage = match[2]
    return new Response(JSON.stringify({ error: errorMessage }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Unknown error format
  console.error('Unexpected access error:', error)
  return new Response(JSON.stringify({ error: 'Internal server error' }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Get the user's default client ID (for users with single client assignment)
 * Returns null if user has multiple clients or no assignments
 */
export async function getUserDefaultClientId(): Promise<string | null> {
  const supabase = await createServerClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return null
  }

  // Admins don't have a default - they must select
  if (user.user_metadata?.role === 'admin') {
    return null
  }

  const adminClient = createAdminClient()
  const { data: userClients } = await adminClient
    .from('user_clients')
    .select('client_id')
    .eq('user_id', user.id)

  if (userClients?.length === 1) {
    return userClients[0].client_id
  }

  return null
}

// ============================================================================
// Client Token Management
// ============================================================================

export interface BillingAddress {
  street: string
  city: string
  region: string
  postalCode: string
  country: string
}

export interface Client {
  id: string
  company_name: string
  merchant_id: string | null
  short_code: string | null
  is_active: boolean
  created_at: string
  billing_address?: BillingAddress | null
  billing_emails?: string[] | null
  billing_phone?: string | null
  billing_contact_name?: string | null
}

export interface ClientCredential {
  id: string
  client_id: string
  provider: string
  api_token: string
  created_at: string
}

/**
 * Get all active clients (excludes internal/system entries by default)
 */
export async function getClients(includeInternal = false): Promise<Client[]> {
  const supabase = createAdminClient()

  let query = supabase
    .from('clients')
    .select('*')
    .eq('is_active', true)

  // Exclude internal clients (e.g., "ShipBob Payments", "Jetpack Costs") unless explicitly requested
  if (!includeInternal) {
    query = query.or('is_internal.is.null,is_internal.eq.false')
  }

  const { data, error } = await query.order('company_name')

  if (error) {
    console.error('Failed to fetch clients:', error)
    throw new Error('Failed to fetch clients')
  }

  return data || []
}

/**
 * Get a single client by ID
 */
export async function getClient(clientId: string): Promise<Client | null> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('id', clientId)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null // Not found
    console.error('Failed to fetch client:', error)
    throw new Error('Failed to fetch client')
  }

  return data
}

/**
 * Get a client's ShipBob API token
 * Returns null if no token is configured
 */
export async function getClientToken(
  clientId: string,
  provider: string = 'shipbob'
): Promise<string | null> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('client_api_credentials')
    .select('api_token')
    .eq('client_id', clientId)
    .eq('provider', provider)
    .single()

  if (error) {
    if (error.code === 'PGRST116') return null // Not found
    console.error('Failed to fetch client token:', error)
    throw new Error('Failed to fetch client token')
  }

  return data?.api_token || null
}

/**
 * Check if a client has a configured token
 */
export async function hasClientToken(
  clientId: string,
  provider: string = 'shipbob'
): Promise<boolean> {
  const token = await getClientToken(clientId, provider)
  return token !== null
}

/**
 * Create a new client
 */
export async function createNewClient(data: {
  company_name: string
  merchant_id?: string | null
  shipbob_token: string
  short_code?: string | null
}): Promise<Client> {
  const supabase = createAdminClient()

  const { data: client, error } = await supabase
    .from('clients')
    .insert({
      company_name: data.company_name,
      merchant_id: data.merchant_id || null,
      short_code: data.short_code || null,
      is_active: true,
    })
    .select()
    .single()

  if (error) {
    console.error('Failed to create client:', error)
    throw new Error('Failed to create client')
  }

  // Create the ShipBob API credential for this client
  const { error: credError } = await supabase
    .from('client_api_credentials')
    .insert({
      client_id: client.id,
      provider: 'shipbob',
      api_token: data.shipbob_token,
    })

  if (credError) {
    console.error('Failed to create client credentials:', credError)
    // Clean up the client record since we couldn't create credentials
    await supabase.from('clients').delete().eq('id', client.id)
    throw new Error('Failed to create client credentials')
  }

  return client
}

/**
 * Get all clients with their actual API tokens (for webhook processing)
 * Only use server-side - never expose tokens to client
 */
export async function getAllClientsWithTokens(): Promise<
  Array<{ clientId: string; companyName: string; merchantId: string | null; token: string }>
> {
  const supabase = createAdminClient()

  // Get all active clients with their credentials
  const { data: credentials, error } = await supabase
    .from('client_api_credentials')
    .select(`
      client_id,
      api_token,
      clients!inner (
        id,
        company_name,
        merchant_id,
        is_active
      )
    `)
    .eq('provider', 'shipbob')
    .eq('clients.is_active', true)

  if (error) {
    console.error('Failed to fetch clients with tokens:', error)
    return []
  }

  return (credentials || []).map((cred: {
    client_id: string
    api_token: string
    clients: { id: string; company_name: string; merchant_id: string | null }
  }) => ({
    clientId: cred.client_id,
    companyName: cred.clients.company_name,
    merchantId: cred.clients.merchant_id,
    token: cred.api_token,
  }))
}

/**
 * Get all clients with their token status (without exposing actual tokens)
 */
export async function getClientsWithTokenStatus(): Promise<
  Array<Client & { has_token: boolean }>
> {
  const supabase = createAdminClient()

  // Get all clients
  const { data: clients, error: clientsError } = await supabase
    .from('clients')
    .select('*')
    .eq('is_active', true)
    .order('company_name')

  if (clientsError) {
    console.error('Failed to fetch clients:', clientsError)
    throw new Error('Failed to fetch clients')
  }

  // Get all credentials (just the client_id, not the token)
  const { data: credentials, error: credError } = await supabase
    .from('client_api_credentials')
    .select('client_id')
    .eq('provider', 'shipbob')

  if (credError) {
    console.error('Failed to fetch credentials:', credError)
    throw new Error('Failed to fetch credentials')
  }

  const clientsWithTokens = new Set(credentials?.map((c: { client_id: string }) => c.client_id) || [])

  // Only return clients that have ShipBob tokens
  return (clients || [])
    .map((client: Client) => ({
      ...client,
      has_token: clientsWithTokens.has(client.id),
    }))
    .filter((client: { has_token: boolean }) => client.has_token)
}

// ============================================================================
// User Management
// ============================================================================

export interface UserClient {
  id: string
  user_id: string
  client_id: string
  role: 'owner' | 'editor' | 'viewer'
  created_at: string
  invited_by: string | null
}

export interface UserWithClients {
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

/**
 * Invite a user to a client
 * Creates the auth user and links them to the client
 */
export async function inviteUser(data: {
  email: string
  clientId: string
  role?: 'owner' | 'editor' | 'viewer'
  fullName?: string
  invitedBy: string
}): Promise<{ user: { id: string; email: string }; userClient: UserClient }> {
  const supabase = createAdminClient()
  const { email, clientId, role = 'viewer', fullName, invitedBy } = data

  // Check if user already exists
  const { data: existingUsers } = await supabase.auth.admin.listUsers()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existingUser = existingUsers?.users?.find(
    (u: any) => u.email?.toLowerCase() === email.toLowerCase()
  )

  let userId: string

  if (existingUser) {
    userId = existingUser.id
  } else {
    // Create new user with invite (sends email)
    const { data: newUser, error: createError } =
      await supabase.auth.admin.inviteUserByEmail(email, {
        data: {
          full_name: fullName || '',
        },
        redirectTo: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/dashboard`,
      })

    if (createError) {
      console.error('Failed to create user:', createError)
      throw new Error(createError.message || 'Failed to create user')
    }

    userId = newUser.user.id
  }

  // Check if already linked to this client
  const { data: existingLink } = await supabase
    .from('user_clients')
    .select('id')
    .eq('user_id', userId)
    .eq('client_id', clientId)
    .single()

  if (existingLink) {
    throw new Error('User is already assigned to this client')
  }

  // Link user to client
  const { data: userClient, error: linkError } = await supabase
    .from('user_clients')
    .insert({
      user_id: userId,
      client_id: clientId,
      role,
      invited_by: invitedBy,
    })
    .select()
    .single()

  if (linkError) {
    console.error('Failed to link user to client:', linkError)
    throw new Error('Failed to assign user to client')
  }

  return {
    user: { id: userId, email },
    userClient,
  }
}

/**
 * Create an admin or Care team user (admin, care_admin, or care_team role)
 * - admin: Full platform access including Admin panel
 * - care_admin: Care team lead, can manage tickets for all clients
 * - care_team: Support staff, can view/update tickets for all clients
 */
export async function createCareUser(data: {
  email: string
  role: 'admin' | 'care_admin' | 'care_team'
  fullName?: string
}): Promise<{ user: { id: string; email: string } }> {
  const supabase = createAdminClient()
  const { email, role, fullName } = data

  // Check if user already exists
  const { data: existingUsers } = await supabase.auth.admin.listUsers()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existingUser = existingUsers?.users?.find(
    (u: any) => u.email?.toLowerCase() === email.toLowerCase()
  )

  if (existingUser) {
    // User exists - update their role to Care role
    const { error: updateError } = await supabase.auth.admin.updateUserById(
      existingUser.id,
      {
        user_metadata: {
          ...existingUser.user_metadata,
          full_name: fullName || existingUser.user_metadata?.full_name || '',
          role,
        },
      }
    )

    if (updateError) {
      console.error('Failed to update user role:', updateError)
      throw new Error(updateError.message || 'Failed to update user role')
    }

    return {
      user: { id: existingUser.id, email },
    }
  }

  // Create new user with invite (sends email)
  // Redirect admins to /dashboard, care users to /dashboard/care
  const redirectPath = role === 'admin' ? '/dashboard' : '/dashboard/care'
  const { data: newUser, error: createError } =
    await supabase.auth.admin.inviteUserByEmail(email, {
      data: {
        full_name: fullName || '',
        role,
      },
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}${redirectPath}`,
    })

  if (createError) {
    console.error('Failed to create care user:', createError)
    throw new Error(createError.message || 'Failed to create care user')
  }

  return {
    user: { id: newUser.user.id, email },
  }
}

/**
 * Get all Care team users (care_admin and care_team roles)
 */
export async function getCareUsers(): Promise<
  Array<{
    id: string
    email: string
    full_name?: string
    role: 'care_admin' | 'care_team'
    created_at: string
  }>
> {
  const supabase = createAdminClient()

  // Get all users from auth
  const { data: authData, error: authError } =
    await supabase.auth.admin.listUsers()

  if (authError) {
    console.error('Failed to fetch users:', authError)
    throw new Error('Failed to fetch users')
  }

  // Filter to only Care users
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const careUsers = (authData.users || []).filter((user: any) => {
    const role = user.user_metadata?.role
    return role === 'care_admin' || role === 'care_team'
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return careUsers.map((user: any) => ({
    id: user.id,
    email: user.email || '',
    full_name: user.user_metadata?.full_name,
    role: user.user_metadata?.role as 'care_admin' | 'care_team',
    created_at: user.created_at,
  }))
}

/**
 * Update a Care user's role
 */
export async function updateCareUserRole(
  userId: string,
  newRole: 'care_admin' | 'care_team' | null
): Promise<void> {
  const supabase = createAdminClient()

  // Get current user metadata
  const { data: userData, error: fetchError } =
    await supabase.auth.admin.getUserById(userId)

  if (fetchError || !userData.user) {
    console.error('Failed to fetch user:', fetchError)
    throw new Error('User not found')
  }

  // Update with new role (null removes the role, making them a regular user)
  const { error: updateError } = await supabase.auth.admin.updateUserById(
    userId,
    {
      user_metadata: {
        ...userData.user.user_metadata,
        role: newRole,
      },
    }
  )

  if (updateError) {
    console.error('Failed to update user role:', updateError)
    throw new Error(updateError.message || 'Failed to update user role')
  }
}

/**
 * Update a client's details
 */
export async function updateClient(
  clientId: string,
  data: {
    company_name?: string
    merchant_id?: string | null
    short_code?: string | null
    billing_address?: BillingAddress | null
    billing_emails?: string[] | null
    billing_phone?: string | null
    billing_contact_name?: string | null
  }
): Promise<Client> {
  const supabase = createAdminClient()

  const { data: client, error } = await supabase
    .from('clients')
    .update({
      ...(data.company_name && { company_name: data.company_name }),
      ...(data.merchant_id !== undefined && { merchant_id: data.merchant_id }),
      ...(data.short_code !== undefined && { short_code: data.short_code }),
      ...(data.billing_address !== undefined && { billing_address: data.billing_address }),
      ...(data.billing_emails !== undefined && { billing_emails: data.billing_emails }),
      ...(data.billing_phone !== undefined && { billing_phone: data.billing_phone }),
      ...(data.billing_contact_name !== undefined && { billing_contact_name: data.billing_contact_name }),
    })
    .eq('id', clientId)
    .select()
    .single()

  if (error) {
    console.error('Failed to update client:', error)
    throw new Error('Failed to update client')
  }

  return client
}

/**
 * Delete a client (soft delete - sets is_active = false)
 */
export async function deleteClient(clientId: string): Promise<void> {
  const supabase = createAdminClient()

  const { error } = await supabase
    .from('clients')
    .update({ is_active: false })
    .eq('id', clientId)

  if (error) {
    console.error('Failed to delete client:', error)
    throw new Error('Failed to delete client')
  }
}

/**
 * Set or update a client's API token
 */
export async function setClientToken(
  clientId: string,
  token: string,
  provider: string = 'shipbob'
): Promise<void> {
  const supabase = createAdminClient()

  // Use upsert to handle both insert and update
  const { error } = await supabase
    .from('client_api_credentials')
    .upsert(
      {
        client_id: clientId,
        provider,
        api_token: token,
      },
      {
        onConflict: 'client_id,provider',
      }
    )

  if (error) {
    console.error('Failed to set client token:', error)
    throw new Error('Failed to set client token')
  }
}

/**
 * Delete a client's API token
 */
export async function deleteClientToken(
  clientId: string,
  provider: string = 'shipbob'
): Promise<void> {
  const supabase = createAdminClient()

  const { error } = await supabase
    .from('client_api_credentials')
    .delete()
    .eq('client_id', clientId)
    .eq('provider', provider)

  if (error) {
    console.error('Failed to delete client token:', error)
    throw new Error('Failed to delete client token')
  }
}

/**
 * Get all users with their client assignments
 */
export async function getUsersWithClients(): Promise<UserWithClients[]> {
  const supabase = createAdminClient()

  // Get all users from auth
  const { data: authData, error: authError } =
    await supabase.auth.admin.listUsers()

  if (authError) {
    console.error('Failed to fetch users:', authError)
    throw new Error('Failed to fetch users')
  }

  // Get all user-client assignments with client names
  const { data: assignments, error: assignError } = await supabase
    .from('user_clients')
    .select(`
      user_id,
      client_id,
      role,
      clients (
        company_name
      )
    `)

  if (assignError) {
    console.error('Failed to fetch user assignments:', assignError)
    throw new Error('Failed to fetch user assignments')
  }

  // Build user list with client info
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const users: UserWithClients[] = (authData.users || []).map((user: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userAssignments = (assignments || []).filter(
      (a: any) => a.user_id === user.id
    )

    return {
      id: user.id,
      email: user.email || '',
      created_at: user.created_at,
      user_metadata: {
        full_name: user.user_metadata?.full_name,
        role: user.user_metadata?.role,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      clients: userAssignments.map((a: any) => ({
        client_id: a.client_id,
        client_name: (a.clients as { company_name: string })?.company_name || 'Unknown',
        role: a.role,
      })),
    }
  })

  return users
}

/**
 * Get users for a specific client
 */
export async function getClientUsers(
  clientId: string
): Promise<Array<{ user_id: string; email: string; role: string; full_name?: string }>> {
  const supabase = createAdminClient()

  // Get assignments for this client
  const { data: assignments, error } = await supabase
    .from('user_clients')
    .select('user_id, role')
    .eq('client_id', clientId)

  if (error) {
    console.error('Failed to fetch client users:', error)
    throw new Error('Failed to fetch client users')
  }

  if (!assignments || assignments.length === 0) {
    return []
  }

  // Get user details from auth
  const { data: authData } = await supabase.auth.admin.listUsers()
  const authUsers = authData?.users || []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return assignments.map((a: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const authUser = authUsers.find((u: any) => u.id === a.user_id)
    return {
      user_id: a.user_id,
      email: authUser?.email || 'Unknown',
      role: a.role,
      full_name: authUser?.user_metadata?.full_name,
    }
  })
}

/**
 * Get parent-level users (users not assigned to any brand)
 * These are typically admins, care users, or sales partners
 */
export async function getParentLevelUsers(): Promise<
  Array<{ id: string; email: string; full_name?: string; role?: string }>
> {
  const supabase = createAdminClient()

  // Get all users from auth
  const { data: authData, error: authError } =
    await supabase.auth.admin.listUsers()

  if (authError) {
    console.error('Failed to fetch users:', authError)
    throw new Error('Failed to fetch users')
  }

  // Get all user-client assignments
  const { data: assignments, error: assignError } = await supabase
    .from('user_clients')
    .select('user_id')

  if (assignError) {
    console.error('Failed to fetch user assignments:', assignError)
    throw new Error('Failed to fetch user assignments')
  }

  // Get set of user IDs that have client assignments
  const assignedUserIds = new Set((assignments || []).map((a: { user_id: string }) => a.user_id))

  // Filter to users WITHOUT any client assignments
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parentUsers = (authData.users || [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((user: any) => !assignedUserIds.has(user.id))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((user: any) => ({
      id: user.id,
      email: user.email || '',
      full_name: user.user_metadata?.full_name,
      role: user.user_metadata?.role,
    }))

  return parentUsers
}
