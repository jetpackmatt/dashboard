// Script to update reshipment data - only updates reshipment_id to 9-digit format
// (reshipment_status has a check constraint that requires old values)
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const updates = [
  { ticket_number: 1, reshipment_id: '335847890' },
  { ticket_number: 2, reshipment_id: '335843156' },
  { ticket_number: 4, reshipment_id: '335839102' },
  { ticket_number: 5, reshipment_id: '335844789' },
  { ticket_number: 8, reshipment_id: '335836045' },
  { ticket_number: 10, reshipment_id: '335850123' },
  { ticket_number: 11, reshipment_id: '335834891' },
  { ticket_number: 12, reshipment_id: '335848445' },
]

async function updateReshipmentData() {
  console.log('Updating reshipment IDs to 9-digit format...')

  for (const update of updates) {
    const { error } = await supabase
      .from('care_tickets')
      .update({
        reshipment_id: update.reshipment_id,
        what_to_reship: null, // Clear this field
      })
      .eq('ticket_number', update.ticket_number)

    if (error) {
      console.error(`Error updating ticket ${update.ticket_number}:`, error.message)
    } else {
      console.log(`Updated ticket ${update.ticket_number}: ID: ${update.reshipment_id}`)
    }
  }

  // Also clear what_to_reship for tickets that don't have reshipment IDs
  const { error: clearError } = await supabase
    .from('care_tickets')
    .update({ what_to_reship: null })
    .not('ticket_number', 'in', '(1,2,4,5,8,10,11,12)')

  if (clearError) {
    console.error('Error clearing what_to_reship:', clearError.message)
  }

  console.log('Done!')
}

updateReshipmentData()
