#!/usr/bin/env node

/**
 * Add demo events to care_tickets for visualization
 *
 * Run after adding the events column:
 * ALTER TABLE care_tickets ADD COLUMN IF NOT EXISTS events JSONB DEFAULT '[]'::jsonb;
 *
 * Usage: node scripts/add-demo-events.js
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Status flow: Input Required → Under Review → Credit Requested → Credit Approved → Resolved
const statusFlow = ['Input Required', 'Under Review', 'Credit Requested', 'Credit Approved', 'Resolved']

const managers = ['Nora', 'Kirty', 'Dave', 'Matt']

const noteTemplates = {
  'Input Required': [
    'Ticket created - awaiting initial assessment',
    'Customer submitted claim - needs documentation review',
    'New case opened - pending investigation',
  ],
  'Under Review': [
    'Investigating carrier tracking data',
    'Reviewing warehouse footage and inventory logs',
    'Checking shipment manifests for discrepancies',
    'Cross-referencing order details with fulfillment records',
  ],
  'Credit Requested': [
    'Investigation complete - credit request submitted for approval',
    'Documentation verified - forwarding to finance for credit processing',
    'Claim validated - requesting credit issuance',
  ],
  'Credit Approved': [
    'Credit approved by finance team',
    'Credit processed - will appear on next invoice',
    'Compensation approved as requested',
  ],
  'Resolved': [
    'Case closed - credit applied to account',
    'Resolution confirmed with customer',
    'Ticket resolved - no further action needed',
    'All items reshipped and credit processed',
  ],
}

function getRandomNote(status) {
  const templates = noteTemplates[status] || ['Status updated']
  return templates[Math.floor(Math.random() * templates.length)]
}

function generateEventsForTicket(ticket) {
  const events = []
  const currentStatus = ticket.status
  const currentStatusIndex = statusFlow.indexOf(currentStatus)
  const createdDate = new Date(ticket.created_at)

  // Generate events from creation to current status
  for (let i = 0; i <= currentStatusIndex && i < statusFlow.length; i++) {
    const status = statusFlow[i]

    // Calculate timestamp - each status change is 1-3 days apart
    const daysAfterCreation = i * (1 + Math.floor(Math.random() * 2))
    const eventDate = new Date(createdDate)
    eventDate.setDate(eventDate.getDate() + daysAfterCreation)

    // Don't create events in the future
    if (eventDate > new Date()) {
      eventDate.setTime(Date.now() - Math.random() * 86400000) // Random time in last 24h
    }

    const event = {
      status,
      note: getRandomNote(status),
      createdAt: eventDate.toISOString(),
      createdBy: i === 0 ? (ticket.manager || managers[Math.floor(Math.random() * managers.length)])
                         : managers[Math.floor(Math.random() * managers.length)],
    }

    // Prepend (most recent first)
    events.unshift(event)
  }

  return events
}

async function main() {
  console.log('Adding demo events to care_tickets...\n')

  // Fetch all care tickets
  const { data: tickets, error } = await supabase
    .from('care_tickets')
    .select('id, status, created_at, manager, internal_notes')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching tickets:', error)

    // Check if events column exists
    if (error.message?.includes('events')) {
      console.log('\n❌ The "events" column does not exist yet.')
      console.log('Please run this SQL first:')
      console.log('ALTER TABLE care_tickets ADD COLUMN IF NOT EXISTS events JSONB DEFAULT \'[]\'::jsonb;')
    }

    process.exit(1)
  }

  if (!tickets || tickets.length === 0) {
    console.log('No tickets found')
    process.exit(0)
  }

  console.log(`Found ${tickets.length} tickets`)

  let updated = 0
  let skipped = 0

  for (const ticket of tickets) {
    // Only update tickets marked as demo data
    const isDemo = ticket.internal_notes?.includes('[DEMO_DATA]')

    if (!isDemo) {
      console.log(`  Skipping non-demo ticket: ${ticket.id.substring(0, 8)}...`)
      skipped++
      continue
    }

    const events = generateEventsForTicket(ticket)

    const { error: updateError } = await supabase
      .from('care_tickets')
      .update({ events })
      .eq('id', ticket.id)

    if (updateError) {
      console.error(`  Error updating ticket ${ticket.id}:`, updateError)
      continue
    }

    console.log(`  Updated ticket ${ticket.id.substring(0, 8)}... with ${events.length} events (${ticket.status})`)
    updated++
  }

  console.log(`\nDone! Updated ${updated} tickets, skipped ${skipped} non-demo tickets`)
}

main().catch(console.error)
