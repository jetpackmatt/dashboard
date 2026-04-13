#!/usr/bin/env node
/**
 * Generate synthetic care tickets for 1% of Paul's Boutique shipments,
 * using real ticket language sampled from the 4 source clients.
 *
 * Lifecycle distribution:
 *   10% Under Review
 *   15% Credit Requested
 *   50% Credit Approved
 *   25% Resolved
 *
 * Each ticket's events array is backdated realistically based on the
 * shipment's event_delivered (or event_labeled) timestamp.
 *
 * Usage:
 *   node scripts/backfill-demo-care.js <DEMO_CLIENT_ID>
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const DEMO_CLIENT_ID = process.argv[2]
if (!DEMO_CLIENT_ID) {
  console.error('Usage: node backfill-demo-care.js <DEMO_CLIENT_ID>')
  process.exit(1)
}

const SOURCE_CLIENT_IDS = [
  '78854d47-a4eb-4bc1-af16-f2ac624cdc9d',
  'e6220921-695e-41f9-9f49-af3e0cdc828a',
  '6b94c274-0446-4167-9d02-b998f8be59ad',
  'ca33dd0e-bd81-4ff7-88d1-18a3caf81d8e',
]

const TICKET_RATE = 0.01 // 1% of shipments get care tickets

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min }
function randomChoice(arr) { return arr[Math.floor(Math.random() * arr.length)] }

// Pick lifecycle stage via weighted distribution
function pickStage() {
  const r = Math.random()
  if (r < 0.10) return 'Under Review'
  if (r < 0.25) return 'Credit Requested'
  if (r < 0.75) return 'Credit Approved'
  return 'Resolved'
}

// Sample real ticket language from source clients
async function loadLanguageCorpus() {
  const { data } = await supabase
    .from('care_tickets')
    .select('description, ticket_type, issue_type, events')
    .in('client_id', SOURCE_CLIENT_IDS)
    .not('description', 'is', null)
    .is('deleted_at', null)
    .limit(500)

  const byIssue = { Loss: [], Damage: [], 'Incorrect Items': [], 'Missing Item': [], Other: [] }
  const eventNotes = { 'Under Review': [], 'Credit Requested': [], 'Credit Approved': [], 'Resolved': [] }

  for (const t of data || []) {
    const desc = (t.description || '').trim()
    if (desc.length < 10 || desc.length > 400) continue
    // Strip PII: tracking URLs, shipment/order IDs, email addresses, long numbers
    const cleaned = desc
      .replace(/https?:\/\/\S+/g, '')
      .replace(/\b\d{8,}\b/g, '')
      .replace(/\S+@\S+\.\S+/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (cleaned.length < 10) continue
    const issue = t.issue_type || 'Other'
    if (byIssue[issue]) byIssue[issue].push(cleaned)
    else byIssue.Other.push(cleaned)

    for (const ev of t.events || []) {
      if (eventNotes[ev.status] && ev.note && ev.note.length < 200) {
        const clean = ev.note.replace(/JPHS-\d+-\d+/g, '').replace(/\$\d+(\.\d+)?/g, '').trim()
        if (clean.length > 5) eventNotes[ev.status].push(clean)
      }
    }
  }
  return { byIssue, eventNotes }
}

// Generate a realistic events array for a given target stage + base date
function buildEvents(targetStage, baseDate, creditAmount, corpus) {
  const events = []
  const base = new Date(baseDate)
  const STAGES = ['Ticket Created', 'Under Review', 'Credit Requested', 'Credit Approved', 'Resolved']
  const targetIdx = STAGES.indexOf(targetStage === 'Resolved' ? 'Resolved' : targetStage)

  const stageOffsets = { 'Ticket Created': 0, 'Under Review': 1, 'Credit Requested': 1.01, 'Credit Approved': randInt(2, 6), 'Resolved': randInt(8, 18) }
  const pickNote = (status) => {
    const pool = corpus.eventNotes[status === 'Ticket Created' ? 'Under Review' : status] || []
    if (pool.length > 0 && Math.random() < 0.5) return randomChoice(pool)
    switch (status) {
      case 'Ticket Created': return 'Awaiting review by a Jetpack team member.'
      case 'Under Review': return 'Jetpack team is reviewing your claim request.'
      case 'Credit Requested': return 'Credit request has been sent to the warehouse team for review.'
      case 'Credit Approved': return `A credit of $${creditAmount.toFixed(2)} has been approved and will appear on your next invoice.`
      case 'Resolved': return `Your credit of $${creditAmount.toFixed(2)} has been applied to your next invoice.`
    }
    return ''
  }

  const stageRange = targetStage === 'Under Review' ? 1 : targetIdx
  for (let i = 0; i <= stageRange; i++) {
    const status = STAGES[i]
    const offsetDays = stageOffsets[status]
    const createdAt = new Date(base.getTime() + offsetDays * 86400_000 + randInt(0, 3600 * 8) * 1000).toISOString()
    events.unshift({  // newest first
      note: pickNote(status),
      status,
      createdAt,
      createdBy: status === 'Ticket Created' || status === 'Credit Requested' || status === 'Credit Approved' || status === 'Resolved' ? 'System' : 'Jetpack Team',
    })
  }
  return events
}

async function main() {
  console.log(`\n🎸 Backfilling demo care tickets for client ${DEMO_CLIENT_ID}\n`)

  // Load corpus
  console.log('Sampling real ticket language from source clients...')
  const corpus = await loadLanguageCorpus()
  const totalDesc = Object.values(corpus.byIssue).reduce((a, b) => a + b.length, 0)
  console.log(`  Loaded ${totalDesc} description samples across ${Object.keys(corpus.byIssue).length} issue types\n`)

  // Get demo shipments (paginated), sample 1%
  const candidates = []
  let lastId = null
  while (true) {
    let q = supabase
      .from('shipments')
      .select('id, shipment_id, shipbob_order_id, carrier, tracking_id, event_delivered, event_labeled, created_at')
      .eq('client_id', DEMO_CLIENT_ID)
      .order('id', { ascending: true })
      .limit(1000)
    if (lastId) q = q.gt('id', lastId)
    const { data, error } = await q
    if (error) throw error
    if (!data || data.length === 0) break
    for (const s of data) if (Math.random() < TICKET_RATE) candidates.push(s)
    lastId = data[data.length - 1].id
    if (data.length < 1000) break
  }
  console.log(`Selected ${candidates.length} shipments for care tickets\n`)

  // Valid issue_types (DB constraint): Loss, Damage, Pick Error, Short Ship,
  // Other, Incorrect Items, Incorrect Quantity, Incorrect Delivery, Claim
  const ticketTypes = [
    { type: 'Claim', issue: 'Loss', weight: 50 },
    { type: 'Claim', issue: 'Damage', weight: 25 },
    { type: 'Claim', issue: 'Incorrect Items', weight: 15 },
    { type: 'Claim', issue: 'Short Ship', weight: 10 },
  ]
  const weightedTypes = []
  for (const t of ticketTypes) for (let i = 0; i < t.weight; i++) weightedTypes.push(t)

  const ticketRows = []
  for (const s of candidates) {
    const { type, issue } = randomChoice(weightedTypes)
    const descPool = corpus.byIssue[issue] || corpus.byIssue.Other
    const description = descPool.length > 0 ? randomChoice(descPool) : `${type} for ${issue} issue`
    const stage = pickStage()
    const baseDate = s.event_delivered || s.event_labeled || s.created_at
    const creditAmount = +(Math.random() * 40 + 10).toFixed(2)
    const events = buildEvents(stage, baseDate, creditAmount, corpus)

    ticketRows.push({
      client_id: DEMO_CLIENT_ID,
      // ticket_number intentionally omitted — let the DB sequence assign it
      ticket_type: type,
      issue_type: issue,
      status: stage,
      shipment_id: s.shipment_id,
      order_id: s.shipbob_order_id,
      carrier: s.carrier,
      tracking_number: s.tracking_id,
      description,
      credit_amount: (stage === 'Credit Approved' || stage === 'Resolved') ? creditAmount : null,
      currency: 'USD',
      events,
      attachments: [],
      internal_notes: [],
      carrier_confirmed_loss: issue === 'Loss' && Math.random() < 0.3,
      ship_date: baseDate ? baseDate.split('T')[0] : null,
      created_at: events[events.length - 1]?.createdAt || baseDate,
      updated_at: events[0]?.createdAt || baseDate,
      resolved_at: stage === 'Resolved' ? events[0]?.createdAt : null,
    })
  }

  // Insert in batches
  const BATCH = 500
  let inserted = 0
  for (let i = 0; i < ticketRows.length; i += BATCH) {
    const chunk = ticketRows.slice(i, i + BATCH)
    const { error } = await supabase.from('care_tickets').insert(chunk)
    if (error) {
      console.error(`  ❌ batch ${i / BATCH}: ${error.message}`)
    } else {
      inserted += chunk.length
      process.stdout.write(`  inserted ${inserted}/${ticketRows.length}\r`)
    }
  }
  console.log()
  console.log(`\n✅ Created ${inserted} demo care tickets`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
