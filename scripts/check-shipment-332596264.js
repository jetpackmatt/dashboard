require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  // Get Henson API token
  const { data: creds } = await supabase
    .from("client_api_credentials")
    .select("api_token")
    .eq("client_id", "6b94c274-0446-4167-9d02-b998f8be59ad")
    .single();

  if (!creds) {
    console.log("No credentials found");
    return;
  }

  // Get shipment details from ShipBob
  const res = await fetch("https://api.shipbob.com/1.0/shipment/332596264", {
    headers: { "Authorization": `Bearer ${creds.api_token}` }
  });
  const data = await res.json();

  console.log("Shipment 332596264 from ShipBob API:");
  console.log("  Status:", data.status);
  console.log("  Tracking:", data.tracking?.tracking_number);
  console.log("  Carrier:", data.tracking?.carrier);
  console.log("  Logs:", data.logs?.length || 0, "entries");

  // Look for any label events
  const labelEvents = (data.logs || []).filter(l =>
    l.log_type_name?.toLowerCase().includes("label") ||
    l.log_type_text?.toLowerCase().includes("label")
  );
  console.log("\nLabel-related events:");
  labelEvents.forEach(e => console.log(`  ${e.timestamp}: ${e.log_type_name} - ${e.log_type_text}`));

  // Now check the billing API for this shipment's transactions
  const parentToken = process.env.SHIPBOB_API_TOKEN;

  // Query by date range to find transactions for this shipment
  const txRes = await fetch(
    `https://api.shipbob.com/1.0/billing/transaction?startDate=2025-12-28&endDate=2026-01-01&referenceType=Shipment&referenceId=332596264&limit=100`,
    { headers: { "Authorization": `Bearer ${parentToken}` } }
  );
  const txData = await txRes.json();

  console.log("\nBilling API response for shipment 332596264:");
  console.log(JSON.stringify(txData, null, 2));
}


main().catch(console.error);
