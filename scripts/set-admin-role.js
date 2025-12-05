#!/usr/bin/env node
/**
 * Set admin role for a user
 * Usage: node scripts/set-admin-role.js <email>
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function setAdminRole(email) {
  console.log(`Setting admin role for: ${email}`)

  // Get user by email
  const { data: { users }, error: listError } = await supabase.auth.admin.listUsers()

  if (listError) {
    console.error('Error listing users:', listError)
    return
  }

  const user = users.find(u => u.email === email)
  if (!user) {
    console.error(`User not found: ${email}`)
    return
  }

  console.log('Found user:', user.id)
  console.log('Current metadata:', user.user_metadata)

  // Update user metadata to add admin role
  const { data, error } = await supabase.auth.admin.updateUserById(user.id, {
    user_metadata: { ...user.user_metadata, role: 'admin' }
  })

  if (error) {
    console.error('Error updating user:', error)
    return
  }

  console.log('Updated user metadata:', data.user.user_metadata)
  console.log('Admin role set successfully!')
}

const email = process.argv[2] || 'matt@shipwithjetpack.com'
setAdminRole(email).catch(console.error)
