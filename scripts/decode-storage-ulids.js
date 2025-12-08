require("dotenv").config({ path: ".env.local" })
const { createClient } = require("@supabase/supabase-js")

// ULID decoding - first 10 chars encode timestamp
const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
const ENCODING_LEN = ENCODING.length

function decodeTime(id) {
  // First 10 characters encode the timestamp
  const timeStr = id.substring(0, 10).toUpperCase()
  let time = 0
  for (const char of timeStr) {
    const index = ENCODING.indexOf(char)
    if (index === -1) return null
    time = time * ENCODING_LEN + index
  }
  return new Date(time)
}

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  // Get storage transactions for one inventory item
  const { data } = await supabase
    .from("transactions")
    .select("transaction_id, reference_id, charge_date, cost")
    .eq("client_id", "6b94c274-0446-4167-9d02-b998f8be59ad")
    .eq("reference_type", "FC")
    .eq("invoice_id_sb", 8633618)
    .eq("reference_id", "156-20101185-Pallet")
    .order("transaction_id")

  console.log("Storage transactions for 156-20101185-Pallet:")
  console.log("(15 days of storage = 15 transactions)\n")

  for (const tx of data || []) {
    const decodedDate = decodeTime(tx.transaction_id)
    console.log(
      "  TX: " + tx.transaction_id.slice(0, 10) +
      " -> " + (decodedDate ? decodedDate.toISOString() : "invalid") +
      " | charge_date: " + tx.charge_date +
      " | $" + tx.cost
    )
  }

  // Get unique decoded dates
  console.log("\n\nUnique dates from ULID timestamps:")
  const dates = new Set()
  for (const tx of data || []) {
    const d = decodeTime(tx.transaction_id)
    if (d) dates.add(d.toISOString().split("T")[0])
  }
  Array.from(dates).sort().forEach(d => console.log("  " + d))
}
main()
