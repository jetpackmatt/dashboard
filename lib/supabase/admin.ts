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
// Client Token Management
// ============================================================================

export interface Client {
  id: string
  company_name: string
  shipbob_user_id: string | null
  is_active: boolean
  created_at: string
}

export interface ClientCredential {
  id: string
  client_id: string
  provider: string
  api_token: string
  created_at: string
}

/**
 * Get all active clients
 */
export async function getClients(): Promise<Client[]> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('is_active', true)
    .order('company_name')

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
  shipbob_user_id?: string | null
}): Promise<Client> {
  const supabase = createAdminClient()

  const { data: client, error } = await supabase
    .from('clients')
    .insert({
      company_name: data.company_name,
      shipbob_user_id: data.shipbob_user_id || null,
      is_active: true,
    })
    .select()
    .single()

  if (error) {
    console.error('Failed to create client:', error)
    throw new Error('Failed to create client')
  }

  return client
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

  return (clients || []).map((client: Client) => ({
    ...client,
    has_token: clientsWithTokens.has(client.id),
  }))
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
 * Update a client's details
 */
export async function updateClient(
  clientId: string,
  data: { company_name?: string; shipbob_user_id?: string | null }
): Promise<Client> {
  const supabase = createAdminClient()

  const { data: client, error } = await supabase
    .from('clients')
    .update({
      ...(data.company_name && { company_name: data.company_name }),
      ...(data.shipbob_user_id !== undefined && { shipbob_user_id: data.shipbob_user_id }),
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
