const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const token = process.env.SHIPBOB_API_TOKEN;

async function inspectCredit() {
  console.log('=== FETCHING RAW API RESPONSE FOR CREDITS INVOICE 8693056 ===\n');

  const url = 'https://api.shipbob.com/2025-07/invoices/8693056/transactions?PageSize=100';
  console.log('URL:', url);

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  const data = await response.json();

  console.log('\nStatus:', response.status);
  console.log('Total transactions in response:', data.items?.length || (Array.isArray(data) ? data.length : 'N/A'));

  const items = data.items || data || [];

  // Find the courtesy credit with reference_id = 0
  const courtesyCredit = items.find(tx =>
    tx.reference_id === '0' &&
    tx.additional_details?.CreditReason === 'Courtesy'
  );

  if (courtesyCredit) {
    console.log('\n' + '='.repeat(60));
    console.log('FOUND COURTESY CREDIT - FULL RAW RESPONSE');
    console.log('='.repeat(60));
    console.log(JSON.stringify(courtesyCredit, null, 2));

    console.log('\n' + '='.repeat(60));
    console.log('ALL TOP-LEVEL FIELDS');
    console.log('='.repeat(60));
    Object.keys(courtesyCredit).forEach(key => {
      const val = JSON.stringify(courtesyCredit[key]);
      console.log(`  ${key}: ${typeof courtesyCredit[key]} → ${val.substring(0, 100)}`);
    });

    console.log('\n' + '='.repeat(60));
    console.log('ADDITIONAL_DETAILS FIELDS (KEY AREA)');
    console.log('='.repeat(60));
    if (courtesyCredit.additional_details) {
      Object.keys(courtesyCredit.additional_details).forEach(key => {
        console.log(`  ${key}: ${courtesyCredit.additional_details[key]}`);
      });
    }
  } else {
    console.log('\nCourtesy credit not found. Showing first 3 transactions:');
    items.slice(0, 3).forEach((tx, i) => {
      console.log(`\n--- Transaction ${i} ---`);
      console.log(JSON.stringify(tx, null, 2));
    });
  }

  // Collect ALL unique additional_details keys across all credits
  console.log('\n' + '='.repeat(60));
  console.log('ALL UNIQUE ADDITIONAL_DETAILS KEYS ON THIS INVOICE');
  console.log('='.repeat(60));
  const allKeys = new Set();
  items.forEach(tx => {
    if (tx.additional_details) {
      Object.keys(tx.additional_details).forEach(k => allKeys.add(k));
    }
  });
  console.log('Keys found:', Array.from(allKeys).join(', '));

  // Check if any transaction has merchant-related fields at top level
  console.log('\n' + '='.repeat(60));
  console.log('SEARCHING FOR MERCHANT/USER/CHANNEL FIELDS');
  console.log('='.repeat(60));

  const merchantFields = [
    'merchant_id', 'MerchantId', 'merchant',
    'user_id', 'UserId', 'user',
    'channel_id', 'ChannelId', 'channel',
    'account_id', 'AccountId', 'account',
    'client_id', 'ClientId', 'client',
    'store_id', 'StoreId', 'store',
    'partner_id', 'PartnerId', 'partner',
    'company_id', 'CompanyId', 'company',
    'tenant_id', 'TenantId', 'tenant',
    'organization_id', 'OrganizationId', 'organization',
    'owner', 'Owner', 'owner_id', 'OwnerId',
    'brand', 'Brand', 'brand_id', 'BrandId'
  ];

  let foundAny = false;
  items.forEach((tx, i) => {
    merchantFields.forEach(field => {
      if (tx[field] !== undefined) {
        console.log(`  Found ${field} at TOP LEVEL of tx ${i}:`, tx[field]);
        foundAny = true;
      }
      if (tx.additional_details && tx.additional_details[field] !== undefined) {
        console.log(`  Found ${field} in ADDITIONAL_DETAILS of tx ${i}:`, tx.additional_details[field]);
        foundAny = true;
      }
    });
  });

  if (!foundAny) {
    console.log('  NO merchant/user/channel fields found in any transaction!');
  }

  // Show sample of other credits with their reference_ids
  console.log('\n' + '='.repeat(60));
  console.log('ALL CREDITS WITH THEIR REFERENCE_IDS');
  console.log('='.repeat(60));
  items.forEach((tx, i) => {
    const reason = tx.additional_details?.CreditReason || 'N/A';
    const shipmentId = tx.additional_details?.ShipmentId || 'N/A';
    const orderId = tx.additional_details?.OrderId || 'N/A';
    console.log(`  ${i+1}. ref_id=${tx.reference_id}, ref_type=${tx.reference_type}, fee=${tx.transaction_fee}, reason=${reason}, ShipmentId=${shipmentId}, OrderId=${orderId}, amount=${tx.amount}`);
  });
}

inspectCredit().catch(console.error);
