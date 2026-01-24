// Script to reset a user's password directly
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function resetPassword() {
  const email = process.argv[2]
  const newPassword = process.argv[3]

  if (!email || !newPassword) {
    console.log('Usage: node scripts/reset-password.js <email> <new-password>')
    console.log('Example: node scripts/reset-password.js admin@example.com newpassword123')
    process.exit(1)
  }

  console.log(`Resetting password for: ${email}`)

  // First, list users to find the one with this email
  const { data: users, error: listError } = await supabase.auth.admin.listUsers()

  if (listError) {
    console.error('Error listing users:', listError.message)
    process.exit(1)
  }

  const user = users.users.find(u => u.email === email)

  if (!user) {
    console.error(`User not found with email: ${email}`)
    console.log('Available users:')
    users.users.forEach(u => console.log(`  - ${u.email}`))
    process.exit(1)
  }

  console.log(`Found user: ${user.id}`)

  // Update the user's password
  const { error: updateError } = await supabase.auth.admin.updateUserById(
    user.id,
    { password: newPassword }
  )

  if (updateError) {
    console.error('Error updating password:', updateError.message)
    process.exit(1)
  }

  console.log('Password updated successfully!')
  console.log(`You can now log in with: ${email} / ${newPassword}`)
}

resetPassword()
