// Script to add demo internal notes to care tickets
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const demoNotes = {
  1: [
    { note: "Spoke with ShipBob - they confirmed package was damaged in transit. Credit approved.", createdAt: "2025-01-09T14:32:00Z", createdBy: "Nora" },
    { note: "Customer provided photos of damaged items. Forwarding to claims.", createdAt: "2025-01-08T11:15:00Z", createdBy: "Kirty" }
  ],
  2: [
    { note: "SKU mapping updated in ShipBob. Should be resolved going forward.", createdAt: "2025-01-07T16:45:00Z", createdBy: "Matt" }
  ],
  3: [
    { note: "Waiting on Nicole to confirm quarantine plan. Will follow up Monday.", createdAt: "2025-01-10T09:20:00Z", createdBy: "Nora" },
    { note: "Lot T104A identified - 847 units affected.", createdAt: "2025-01-09T15:00:00Z", createdBy: "Dave" },
    { note: "Client escalated this issue - needs resolution by EOW.", createdAt: "2025-01-08T10:30:00Z", createdBy: "Rebecca" }
  ],
  4: [
    { note: "Pick error confirmed via audit. Warehouse team notified.", createdAt: "2025-01-06T13:22:00Z", createdBy: "Kirty" }
  ],
  5: [
    { note: "Customs docs resubmitted. Broker confirms clearance expected tomorrow.", createdAt: "2025-01-09T17:00:00Z", createdBy: "Matt" },
    { note: "Missing HS codes on original documentation.", createdAt: "2025-01-08T14:45:00Z", createdBy: "Nora" }
  ],
  6: [
    { note: "Opened case with Amazon. Reference #AMZ-9847362.", createdAt: "2025-01-10T10:15:00Z", createdBy: "Dave" },
    { note: "Client reporting 3 ASINs affected by tracking issue.", createdAt: "2025-01-09T08:30:00Z", createdBy: "Rebecca" }
  ],
  7: [
    { note: "Got quotes from DHL and FedEx for international. Sending to client.", createdAt: "2025-01-10T11:00:00Z", createdBy: "Matt" }
  ],
  8: [
    { note: "Replacement shipped via expedited. Tracking shared with client.", createdAt: "2025-01-05T15:30:00Z", createdBy: "Nora" },
    { note: "Damage occurred at Moreno Valley FC. Incident report filed.", createdAt: "2025-01-04T12:00:00Z", createdBy: "Kirty" }
  ],
  9: [
    { note: "Package confirmed lost. FedEx claim submitted.", createdAt: "2025-01-07T14:20:00Z", createdBy: "Dave" },
    { note: "No scan updates since Dec 28. Investigating.", createdAt: "2025-01-06T09:45:00Z", createdBy: "Nora" }
  ],
  10: [
    { note: "Red vs Blue variant - checking if this is a systemic issue.", createdAt: "2025-01-10T08:00:00Z", createdBy: "Rebecca" }
  ],
  11: [
    { note: "Jamie's email issue resolved - was a notification setting.", createdAt: "2025-01-05T11:00:00Z", createdBy: "Kirty" }
  ],
  12: [
    { note: "Working with dev team on lot export feature.", createdAt: "2025-01-10T14:00:00Z", createdBy: "Matt" },
    { note: "CoQ10 bottle had visible dent - photo documented.", createdAt: "2025-01-09T16:30:00Z", createdBy: "Rebecca" }
  ]
}

async function seedInternalNotes() {
  console.log('Seeding internal notes...')

  for (const [ticketNumber, notes] of Object.entries(demoNotes)) {
    const { error } = await supabase
      .from('care_tickets')
      .update({ internal_notes: notes })
      .eq('ticket_number', parseInt(ticketNumber))

    if (error) {
      console.error(`Error updating ticket ${ticketNumber}:`, error.message)
    } else {
      console.log(`Updated ticket ${ticketNumber} with ${notes.length} note(s)`)
    }
  }

  console.log('Done!')
}

seedInternalNotes()
