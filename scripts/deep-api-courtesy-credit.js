const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const token = process.env.SHIPBOB_API_TOKEN;
const baseUrl = 'https://api.shipbob.com';

async function fetchAPI(endpoint, version = '1.0', options = {}) {
  const url = `${baseUrl}/${version}${endpoint}`;
  console.log(`\nFetching: ${url}`);

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  console.log(`Status: ${response.status}`);

  const text = await response.text();
  if (!text) return { status: response.status, data: null };

  try {
    return { status: response.status, data: JSON.parse(text) };
  } catch {
    return { status: response.status, data: { raw: text.substring(0, 500) } };
  }
}

async function deepSearch() {
  console.log('='.repeat(70));
  console.log('DEEP API SEARCH FOR MERCHANT ID IN COURTESY CREDIT');
  console.log('Transaction: 01KC8DAQR9EJ62ZJYDJEGJA029');
  console.log('TicketReference: 02375071');
  console.log('='.repeat(70));

  // 1. Try /transactions:query endpoint with the transaction_id
  console.log('\n### 1. Try /transactions:query with transaction_id ###');
  const queryRes = await fetchAPI('/transactions:query', '2025-07', {
    method: 'POST',
    body: JSON.stringify({
      transaction_ids: ['01KC8DAQR9EJ62ZJYDJEGJA029'],
    }),
  });

  if (queryRes.data?.items?.[0]) {
    console.log('Full response from :query endpoint:');
    console.log(JSON.stringify(queryRes.data.items[0], null, 2));
  } else {
    console.log('No results or different structure:', JSON.stringify(queryRes.data).substring(0, 500));
  }

  // 2. Try ticket-related endpoints
  console.log('\n### 2. Try ticket-related endpoints ###');
  const ticketEndpoints = [
    '/tickets/02375071',
    '/ticket/02375071',
    '/support/tickets/02375071',
    '/support-tickets/02375071',
    '/cases/02375071',
  ];

  for (const endpoint of ticketEndpoints) {
    const res = await fetchAPI(endpoint, '1.0');
    if (res.status === 200 && res.data) {
      console.log(`FOUND: ${endpoint}`, JSON.stringify(res.data).substring(0, 500));
    }
  }

  // 3. Try 2025-07 version for tickets
  console.log('\n### 3. Try 2025-07 version for tickets ###');
  for (const endpoint of ['/tickets', '/support-tickets', '/cases']) {
    const res = await fetchAPI(endpoint, '2025-07');
    if (res.status === 200) {
      console.log(`Found at 2025-07${endpoint}:`, JSON.stringify(res.data).substring(0, 500));
    }
  }

  // 4. Check what other billing-related endpoints exist
  console.log('\n### 4. Try other billing endpoints ###');
  const billingEndpoints = [
    '/credits',
    '/credit-requests',
    '/claims',
    '/billing/credits',
    '/billing/claims',
  ];

  for (const endpoint of billingEndpoints) {
    const res = await fetchAPI(endpoint, '2025-07');
    if (res.status === 200) {
      console.log(`Found at 2025-07${endpoint}:`, JSON.stringify(res.data).substring(0, 500));
    }
  }

  // 5. Check if /invoices/{id} returns more detail
  console.log('\n### 5. Check /invoices/{id} endpoint for more detail ###');
  const invoiceRes = await fetchAPI('/invoices/8693056', '2025-07');
  if (invoiceRes.data) {
    console.log('Invoice details:');
    console.log(JSON.stringify(invoiceRes.data, null, 2));
  }

  // 6. Try to get a specific transaction
  console.log('\n### 6. Try /transactions/{id} endpoint ###');
  const txRes = await fetchAPI('/transactions/01KC8DAQR9EJ62ZJYDJEGJA029', '2025-07');
  if (txRes.data) {
    console.log('Transaction details:');
    console.log(JSON.stringify(txRes.data, null, 2));
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`
The ShipBob Billing API does NOT include merchant identification for credits.

Fields available in the API response:
- transaction_id: 01KC8DAQR9EJ62ZJYDJEGJA029
- reference_id: 0 (empty - no shipment/return link)
- reference_type: Default
- additional_details.CreditReason: Courtesy
- additional_details.TicketReference: 02375071

NO merchant_id, user_id, channel_id, or any other identifier is present.

The ONLY potential cross-reference is the TicketReference, which may:
1. Link to a ShipBob support ticket (not accessible via API)
2. Be manually trackable through ShipBob's portal

RECOMMENDATION:
1. For courtesy credits with reference_id=0, use sibling attribution
2. If sibling attribution fails (multi-client invoice), flag for manual review
3. Consider requesting ShipBob add merchant_id to the Billing API response
`);
}

deepSearch().catch(console.error);
