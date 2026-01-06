const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Orphaned transactions to delete (voided labels for Eli Health)
const orphanedTxIds = [
  '01KDRKEGAGS9KGPWAZGE2B726G',  // Refund for voided label (shipment 328833284)
  '01KDRKETK5TQW9RMVTJFYF6C25',  // Charge for voided label (shipment 328833284)
  '01KDNW53SVE0Q7PYV9SZA5NES0',  // Charge for voided label (shipment 332558746)
  '01KDR7K0M6BJRX7ZT9DYB42ZX3',  // Charge for voided label (shipment 332911820)
  '01KDR4V0V3GY268T20S8V10WK3',  // Charge for voided label (shipment 332912138)
];

async function main() {
  console.log('Deleting orphaned transactions for Eli Health...\n');

  for (const txId of orphanedTxIds) {
    // First verify the transaction exists and get details
    const { data: tx } = await supabase
      .from('transactions')
      .select('transaction_id, reference_id, tracking_id, cost, transaction_type')
      .eq('transaction_id', txId)
      .single();

    if (!tx) {
      console.log(`Transaction ${txId}: NOT FOUND (already deleted?)`);
      continue;
    }

    console.log(`Deleting: ${txId} | Shipment ${tx.reference_id} | $${tx.cost} | ${tx.transaction_type} | tracking: ${tx.tracking_id}`);

    const { error } = await supabase
      .from('transactions')
      .delete()
      .eq('transaction_id', txId);

    if (error) {
      console.error(`  ERROR: ${error.message}`);
    } else {
      console.log(`  DELETED`);
    }
  }

  console.log('\nDone!');
}

main().catch(console.error);
