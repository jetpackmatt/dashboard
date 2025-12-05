const XLSX = require("xlsx");
const path = require("path");
const workbook = XLSX.readFile(path.join(__dirname, "../reference/data/historic/shipments.xlsx"));
const data = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

const stats = { Charge: {}, Refund: {} };

for (const row of data) {
  const type = row["Transaction Type"];
  const category = row["Order Category"] || "(empty)";

  if (stats[type]) {
    stats[type][category] = (stats[type][category] || 0) + 1;
  }
}

console.log("Order Category distribution:");
console.log("\nCharges:");
for (const [cat, count] of Object.entries(stats.Charge)) {
  console.log("  " + cat + ": " + count);
}

console.log("\nRefunds:");
for (const [cat, count] of Object.entries(stats.Refund)) {
  console.log("  " + cat + ": " + count);
}
