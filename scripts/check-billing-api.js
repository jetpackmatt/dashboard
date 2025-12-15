/**
 * Check what the billing API returns for these transactions
 */
require('dotenv').config({ path: '.env.local' })

async function check() {
  const parentToken = process.env.SHIPBOB_API_TOKEN

  // The transaction ID is a ULID - but we query billing API differently
  // Let's find recent transactions in the billing API

  console.log('=== CHECKING BILLING API ===\n')

  // Try fetching recent billing records to see the full structure
  const url = new URL('https://api.shipbob.com/2.0/billing')
  url.searchParams.set('PageSize', '5')

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${parentToken}` }
  })

  if (!res.ok) {
    console.log(`API error: ${res.status}`)
    return
  }

  const data = await res.json()

  console.log('First 2 records from billing API:')
  for (const record of data.slice(0, 2)) {
    console.log(JSON.stringify(record, null, 2))
    console.log('---')
  }

  // Try with specific reference ID
  console.log('\n=== SEARCHING FOR RETURN 2969524 ===\n')

  // Build URL for specific return
  const searchUrl = new URL('https://api.shipbob.com/2.0/billing')
  searchUrl.searchParams.set('ReferenceId', '2969524')
  searchUrl.searchParams.set('PageSize', '50')

  const searchRes = await fetch(searchUrl.toString(), {
    headers: { Authorization: `Bearer ${parentToken}` }
  })

  if (searchRes.ok) {
    const results = await searchRes.json()
    console.log(`Found ${results.length} results:`)
    for (const r of results) {
      console.log(JSON.stringify(r, null, 2))
    }
  } else {
    console.log(`Search error: ${searchRes.status}`)
  }
}

check().catch(console.error)
