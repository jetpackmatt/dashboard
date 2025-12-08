require("dotenv").config({ path: ".env.local" })
const { createClient } = require("@supabase/supabase-js")

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  // Check if same reference_id appears multiple times
  const { data } = await supabase
    .from("transactions")
    .select("transaction_id, reference_id, charge_date, cost")
    .eq("client_id", "6b94c274-0446-4167-9d02-b998f8be59ad")
    .eq("reference_type", "FC")
    .eq("invoice_id_sb", 8633618)
    .order("reference_id")
    .limit(100)

  // Group by reference_id
  const byRef = {}
  for (const tx of data || []) {
    if (!byRef[tx.reference_id]) byRef[tx.reference_id] = []
    byRef[tx.reference_id].push(tx)
  }

  console.log("Storage transactions grouped by reference_id:")
  const entries = Object.entries(byRef).slice(0, 8)
  for (const [refId, txs] of entries) {
    console.log("\n" + refId + ": " + txs.length + " transactions")
    for (const tx of txs) {
      console.log("  ID: " + tx.transaction_id.slice(-8) + " | Date: " + tx.charge_date + " | Cost: $" + tx.cost)
    }
  }

  // Count totals
  const { count: totalTx } = await supabase
    .from("transactions")
    .select("*", { count: "exact", head: true })
    .eq("client_id", "6b94c274-0446-4167-9d02-b998f8be59ad")
    .eq("reference_type", "FC")
    .eq("invoice_id_sb", 8633618)

  console.log("\n\nTotal storage transactions: " + totalTx)
  console.log("Unique reference_ids in sample: " + Object.keys(byRef).length)

  // Check if we have multiple tx per ref
  const multiplePerRef = Object.values(byRef).filter(txs => txs.length > 1).length
  console.log("Reference IDs with multiple transactions: " + multiplePerRef)
}
main()
