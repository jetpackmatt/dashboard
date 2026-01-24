// Script to update ticket numbers to start at 100353
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function updateTicketNumbers() {
  console.log('Updating ticket numbers to start at 100353...')

  // Get all existing tickets
  const { data: tickets, error: fetchError } = await supabase
    .from('care_tickets')
    .select('id, ticket_number')
    .order('ticket_number', { ascending: true })

  if (fetchError) {
    console.error('Error fetching tickets:', fetchError.message)
    return
  }

  console.log(`Found ${tickets.length} tickets to update`)

  // Update each ticket: add 100352 to the ticket_number
  for (const ticket of tickets) {
    const newNumber = ticket.ticket_number + 100352
    const { error } = await supabase
      .from('care_tickets')
      .update({ ticket_number: newNumber })
      .eq('id', ticket.id)

    if (error) {
      console.error(`Error updating ticket ${ticket.ticket_number}:`, error.message)
    } else {
      console.log(`Updated ticket ${ticket.ticket_number} -> ${newNumber}`)
    }
  }

  // Verify the update
  const { data: updated } = await supabase
    .from('care_tickets')
    .select('ticket_number')
    .order('ticket_number', { ascending: true })

  console.log('\nUpdated ticket numbers:', updated?.map(t => t.ticket_number).join(', '))
  console.log('Done!')
}

updateTicketNumbers()
