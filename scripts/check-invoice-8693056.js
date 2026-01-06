const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  const { data: all, count } = await supabase
    .from('transactions')
    .select('transaction_id, client_id, reference_id, fee_type, cost', { count: 'exact' })
    .eq('invoice_id_sb', 8693056);

  console.log('Total transactions on invoice 8693056:', count);

  const withClient = (all || []).filter(t => t.client_id !== null);
  const withoutClient = (all || []).filter(t => t.client_id === null);

  console.log('With client_id:', withClient.length);
  console.log('Without client_id:', withoutClient.length);

  console.log('\nTransactions WITHOUT client_id:');
  for (const t of withoutClient) {
    console.log(`  ${t.transaction_id}: ref=${t.reference_id}, fee=${t.fee_type}, cost=${t.cost}`);
  }

  const clientIds = [...new Set(withClient.map(t => t.client_id))];
  console.log('\nDistinct client_ids with credits:', clientIds.length);

  if (clientIds.length === 1) {
    console.log('Single client - sibling attribution would work!');
    console.log('Client ID:', clientIds[0]);
  } else {
    console.log('Multiple clients - checking counts per client:');
    for (const cid of clientIds) {
      const count = withClient.filter(t => t.client_id === cid).length;
      console.log(`  ${cid}: ${count} transactions`);
    }
  }
}
check().catch(console.error);
