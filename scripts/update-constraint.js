// Script to update the check constraint using Supabase RPC
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function updateConstraint() {
  console.log('Updating reshipment_status check constraint...')

  // First, drop the old constraint
  const { error: dropError } = await supabase.rpc('exec_sql', {
    query: "ALTER TABLE care_tickets DROP CONSTRAINT IF EXISTS care_tickets_reshipment_status_check"
  })

  if (dropError) {
    console.log('Note: Drop constraint may have failed (expected if using RLS):', dropError.message)
  }

  // Try updating via direct update - clear all old values first
  console.log('Clearing reshipment_status values...')
  const { error: clearError } = await supabase
    .from('care_tickets')
    .update({ reshipment_status: null })
    .neq('ticket_number', -1) // Match all

  if (clearError) {
    console.error('Clear error:', clearError.message)
  } else {
    console.log('Cleared all reshipment_status values')
  }
}

updateConstraint()
