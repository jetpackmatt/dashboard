#!/usr/bin/env node
/**
 * Insert demo care tickets into the database.
 * These are marked with [DEMO_DATA] in internal_notes for easy removal.
 *
 * Run: node scripts/insert-demo-care-tickets.js
 * Remove demo data: Run DELETE FROM care_tickets WHERE internal_notes LIKE '[DEMO_DATA]%'
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Demo data from care-data.json
const demoTickets = [
  {
    dateCreated: "2025-11-19",
    type: "Claim",
    status: "Under Review",
    manager: "Nora",
    issue: "Loss",
    shipDate: "2025-11-18",
    orderId: "1847362",
    carrier: "FedEx",
    tracking: "773892456821",
    credit: 245.50,
    currency: "USD",
    notes: "Customer reporting temperature control issue during transit. Investigation required.",
    reshipment: "Please reship for me",
    whatToReship: "2x Vitamin D3 5000IU, 1x Omega-3 Fish Oil",
    reshipmentId: "1847890",
    compensationRequest: "Credit to account"
  },
  {
    dateCreated: "2025-11-16",
    type: "Claim",
    status: "Credit Approved",
    manager: "Nora",
    issue: "Damage",
    shipDate: "2025-11-15",
    orderId: "1842915",
    carrier: "UPS",
    tracking: "1Z9X8A7W6543210987",
    credit: 128.75,
    currency: "CAD",
    notes: "Update required for SKU mapping on new product line launch.",
    reshipment: "I've already reshipped",
    reshipmentId: "1843156",
    compensationRequest: "Free replacement"
  },
  {
    dateCreated: "2025-11-20",
    type: "Work Order",
    status: "Input Required",
    manager: "Nora",
    issue: "Other",
    shipDate: "2025-11-20",
    orderId: "1849203",
    carrier: "Purolator",
    tracking: "PUR329847561234",
    credit: 0.00,
    currency: "USD",
    notes: "Quarantine work order to be created when plan is agreed upon with Nicole",
    workOrderId: "WO-2025-0847",
    inventoryId: "21600394"
  },
  {
    dateCreated: "2025-11-13",
    type: "Claim",
    status: "Resolved",
    manager: "Kirty",
    issue: "Pick Error",
    shipDate: "2025-11-12",
    orderId: "1838764",
    carrier: "Canada Post",
    tracking: "CA123456789012345",
    credit: 89.25,
    currency: "CAD",
    notes: "Can we please have Lot number T104A of Inventory ID 20777250 moved to Inventory ID 21600394?",
    reshipment: "I've already reshipped",
    whatToReship: "Correct SKU-001 product",
    reshipmentId: "1839102",
    compensationRequest: "Refund to payment method"
  },
  {
    dateCreated: "2025-11-17",
    type: "Claim",
    status: "Credit Requested",
    manager: "Nora",
    issue: "Short Ship",
    shipDate: "2025-11-16",
    orderId: "1844521",
    carrier: "FedEx",
    tracking: "773892456822",
    credit: 156.00,
    currency: "USD",
    notes: "Customs documentation incomplete for international shipment 5847. Broker follow-up needed.",
    reshipment: "Please reship for me",
    whatToReship: "3x Missing units of Probiotics 50B CFU",
    reshipmentId: "1844789",
    compensationRequest: "Credit to account"
  },
  {
    dateCreated: "2025-11-19",
    type: "Technical",
    status: "Under Review",
    manager: "Nora",
    issue: "Other",
    shipDate: "2025-11-19",
    orderId: "1847892",
    carrier: "Amazon FBM",
    tracking: "TBA394857261",
    credit: 0.00,
    currency: "USD",
    notes: "Methyl Life is being penalized on Amazon for non-compliant shipping.",
    shipmentId: "SHP-847892"
  },
  {
    dateCreated: "2025-11-20",
    type: "Inquiry",
    status: "Input Required",
    manager: "Matt",
    issue: "Other",
    shipDate: "2025-11-20",
    orderId: "1849567",
    carrier: "DHL",
    tracking: "9845032178",
    credit: 0.00,
    currency: "USD",
    notes: "Quotes from the most reliable and quickest couriers? \nThe Mexico one especially the staff member will only be there for a while.\n\nThe Address in South Africa is 7 Villa Baroque Complex, 91 East road, Brentwood Park AH, Kempton Park, 1505. \nAddress in mexico: Av. Isaac Newton 178, Polanco, 11560 Ciudad de México, CDMX",
    shipmentId: "SHP-849567"
  },
  {
    dateCreated: "2025-11-11",
    type: "Claim",
    status: "Resolved",
    manager: "Nora",
    issue: "Damage",
    shipDate: "2025-11-10",
    orderId: "1835629",
    carrier: "UPS",
    tracking: "1Z9X8A7W6543210988",
    credit: 312.50,
    currency: "USD",
    notes: "Label printer calibration off by 2mm causing barcode scan issues.",
    reshipment: "I've already reshipped",
    whatToReship: "Complete order - expedited shipment",
    reshipmentId: "1836045",
    compensationRequest: "Free replacement"
  },
  {
    dateCreated: "2025-11-15",
    type: "Claim",
    status: "Credit Approved",
    manager: "Dave",
    issue: "Loss",
    shipDate: "2025-11-14",
    orderId: "1841023",
    carrier: "FedEx",
    tracking: "773892456823",
    credit: 425.00,
    currency: "CAD",
    notes: "Request to expedite priority client order processing through fulfillment queue.",
    reshipment: "Don't reship",
    compensationRequest: "Refund to payment method"
  },
  {
    dateCreated: "2025-11-18",
    type: "Claim",
    status: "Under Review",
    manager: "Nora",
    issue: "Pick Error",
    shipDate: "2025-11-17",
    orderId: "1845783",
    carrier: "Canada Post",
    tracking: "CA123456789012346",
    credit: 0.00,
    currency: "CAD",
    notes: "Need to schedule inventory reconciliation for warehouse sections B4-B7 by end of week.",
    reshipment: "Please reship for me",
    whatToReship: "1x Blue variant (sent Red by mistake)",
    compensationRequest: "Free replacement"
  },
  {
    dateCreated: "2025-11-10",
    type: "Claim",
    status: "Resolved",
    manager: "Nora",
    issue: "Short Ship",
    shipDate: "2025-11-09",
    orderId: "1834512",
    carrier: "UPS",
    tracking: "1Z9X8A7W6543210989",
    credit: 67.80,
    currency: "USD",
    notes: "Jamie is still getting Action required emails",
    reshipment: "I've already reshipped",
    whatToReship: "2x Missing Magnesium Glycinate capsules",
    reshipmentId: "1834891",
    compensationRequest: "Credit to account"
  },
  {
    dateCreated: "2025-11-20",
    type: "Claim",
    status: "Credit Requested",
    manager: "Kirty",
    issue: "Damage",
    shipDate: "2025-11-19",
    orderId: "1848126",
    carrier: "Purolator",
    tracking: "PUR329847561235",
    credit: 189.99,
    currency: "CAD",
    notes: "Lot Export capabilities to be worked out / fixed.",
    reshipment: "Please reship for me",
    whatToReship: "1x CoQ10 supplement bottle (undamaged)",
    reshipmentId: "1848445",
    compensationRequest: "Free replacement"
  }
]

async function insertDemoData() {
  console.log('Inserting demo care tickets...\n')

  // Get Henson Shaving client ID to associate tickets with
  const { data: clients, error: clientError } = await supabase
    .from('clients')
    .select('id, company_name')
    .limit(2)

  if (clientError) {
    console.error('Failed to fetch clients:', clientError.message)
    process.exit(1)
  }

  if (!clients || clients.length === 0) {
    console.error('No clients found in database')
    process.exit(1)
  }

  console.log('Available clients:', clients.map(c => `${c.company_name} (${c.id})`).join(', '))

  // Use the first client for demo data
  const clientId = clients[0].id
  console.log(`\nUsing client: ${clients[0].company_name} for demo tickets\n`)

  // Convert demo tickets to database format
  const records = demoTickets.map(ticket => ({
    client_id: clientId,
    ticket_type: ticket.type,
    issue_type: ticket.issue,
    status: ticket.status,
    manager: ticket.manager,
    order_id: ticket.orderId,
    shipment_id: ticket.shipmentId || null,
    ship_date: ticket.shipDate,
    carrier: ticket.carrier,
    tracking_number: ticket.tracking,
    reshipment_status: ticket.reshipment || null,
    what_to_reship: ticket.whatToReship || null,
    reshipment_id: ticket.reshipmentId || null,
    compensation_request: ticket.compensationRequest || null,
    credit_amount: ticket.credit || 0,
    currency: ticket.currency,
    work_order_id: ticket.workOrderId || null,
    inventory_id: ticket.inventoryId || null,
    description: ticket.notes,
    internal_notes: '[DEMO_DATA] This is demo data for testing. Delete with: DELETE FROM care_tickets WHERE internal_notes LIKE \'[DEMO_DATA]%\'',
    created_at: new Date(ticket.dateCreated).toISOString(),
    resolved_at: ticket.status === 'Resolved' ? new Date(ticket.dateCreated).toISOString() : null,
  }))

  // Insert all records
  const { data, error } = await supabase
    .from('care_tickets')
    .insert(records)
    .select('id, ticket_number, ticket_type, status')

  if (error) {
    console.error('Failed to insert demo tickets:', error.message)
    process.exit(1)
  }

  console.log(`Successfully inserted ${data.length} demo tickets:\n`)
  data.forEach(t => {
    console.log(`  #${t.ticket_number} - ${t.ticket_type} (${t.status})`)
  })

  console.log('\n--- To remove demo data later ---')
  console.log("DELETE FROM care_tickets WHERE internal_notes LIKE '[DEMO_DATA]%'")
}

insertDemoData().catch(console.error)
