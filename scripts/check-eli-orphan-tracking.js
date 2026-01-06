const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ELI_CLIENT_ID = 'e6220921-695e-41f9-9f49-af3e0cdc828a';

// Voided/orphaned transactions to check
const orphanedTxIds = [
  '01KDRKEGAGS9KGPWAZGE2B726G',  // Refund for voided label
  '01KDRKETK5TQW9RMVTJFYF6C25',  // Charge for voided label (shipment 328833284)
  '01KDNW53SVE0Q7PYV9SZA5NES0',  // Charge for voided label (shipment 332558746)
  '01KDR7K0M6BJRX7ZT9DYB42ZX3',  // Charge for voided label (shipment 332911820)
  '01KDR4V0V3GY268T20S8V10WK3',  // Charge for voided label (shipment 332912138)
];

async function main() {
  console.log('Checking orphaned transactions for Eli Health...\n');

  for (const txId of orphanedTxIds) {
    const { data: tx } = await supabase
      .from('transactions')
      .select('transaction_id, reference_id, tracking_id, cost, charge_date, transaction_type')
      .eq('transaction_id', txId)
      .single();

    if (!tx) {
      console.log(`Transaction ${txId}: NOT FOUND`);
      continue;
    }

    const { data: shipment } = await supabase
      .from('shipments')
      .select('shipment_id, tracking_id, status')
      .eq('shipment_id', tx.reference_id)
      .single();

    console.log(`Transaction ${txId}:`);
    console.log(`  Shipment ID: ${tx.reference_id}`);
    console.log(`  TX Type: ${tx.transaction_type} | Cost: $${tx.cost} | Date: ${tx.charge_date}`);
    console.log(`  TX Tracking: ${tx.tracking_id}`);
    console.log(`  Shipment Tracking: ${shipment?.tracking_id || 'N/A'}`);
    console.log(`  Match: ${tx.tracking_id === shipment?.tracking_id ? 'YES' : 'NO - ORPHANED'}`);
    console.log('');
  }

  // Sum up the orphaned charges
  const { data: orphanedTx } = await supabase
    .from('transactions')
    .select('cost, transaction_type')
    .in('transaction_id', orphanedTxIds);

  const totalOrphanedCost = orphanedTx.reduce((sum, t) => sum + parseFloat(t.cost), 0);
  console.log('Total orphaned transaction cost:', totalOrphanedCost.toFixed(2));

  // Calculate what our total should be
  console.log('\n=== Cost Reconciliation ===');
  console.log('DB Total: $2333.18');
  console.log('Expected (DB - orphaned):', (2333.18 - totalOrphanedCost).toFixed(2));
  console.log('PowerBI Total: $2283.29');
}

main().catch(console.error);
