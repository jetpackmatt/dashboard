/**
 * Find which shipments from the SFTP CSV are not in our transactions table
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const Client = require('ssh2-sftp-client')
const { parse } = require('csv-parse/sync')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

function parseCurrency(value) {
  if (!value) return 0
  const cleaned = value.replace(/[$,]/g, '').trim()
  const num = parseFloat(cleaned)
  return isNaN(num) ? 0 : num
}

async function main() {
  // Fetch CSV from SFTP
  const sftp = new Client()
  await sftp.connect({
    host: process.env.SFTP_HOST,
    port: parseInt(process.env.SFTP_PORT || '22', 10),
    username: process.env.SFTP_USERNAME,
    password: process.env.SFTP_PASSWORD
  })

  const buffer = await sftp.get('/extras-120125.csv')
  await sftp.end()

  const records = parse(buffer.toString('utf-8'), {
    columns: true,
    skip_empty_lines: true,
    trim: true
  })

  const rows = records.map(row => ({
    shipment_id: String(row['OrderID'] || ''),
    merchant_name: String(row['Merchant Name'] || ''),
    base_cost: parseCurrency(row['Fulfillment without Surcharge']),
    surcharge: parseCurrency(row['Surcharge Applied']),
    total: parseCurrency(row['Original Invoice'])
  }))

  console.log('Total rows in CSV:', rows.length)
  console.log('\nChecking which are NOT in transactions table...\n')

  const notFound = []

  for (const row of rows) {
    const { data: tx } = await supabase
      .from('transactions')
      .select('id, reference_id, transaction_fee')
      .eq('reference_type', 'Shipment')
      .eq('reference_id', row.shipment_id)
      .eq('transaction_fee', 'Shipping')
      .maybeSingle()

    if (!tx) {
      notFound.push(row)
    }
  }

  console.log('NOT FOUND in transactions:', notFound.length)
  console.log('\nDetails:')

  for (const row of notFound) {
    console.log('  Shipment ID:', row.shipment_id)
    console.log('    Merchant:', row.merchant_name)
    console.log('    Base:', '$' + row.base_cost.toFixed(2))
    console.log('    Surcharge:', '$' + row.surcharge.toFixed(2))
    console.log('    Total:', '$' + row.total.toFixed(2))

    // Check if shipment exists at all in shipments table
    const { data: shipment } = await supabase
      .from('shipments')
      .select('id, shipment_id, status')
      .eq('shipment_id', row.shipment_id)
      .maybeSingle()

    if (shipment) {
      console.log('    -> EXISTS in shipments table (status:', shipment.status + ')')
    } else {
      console.log('    -> NOT in shipments table either!')
    }

    // Check if there is ANY transaction with this reference_id
    const { data: anyTx } = await supabase
      .from('transactions')
      .select('id, reference_id, reference_type, transaction_fee, amount')
      .eq('reference_id', row.shipment_id)
      .limit(5)

    if (anyTx && anyTx.length > 0) {
      console.log('    -> Found ' + anyTx.length + ' transactions with this reference_id:')
      anyTx.forEach(t => console.log('       ' + t.reference_type + '/' + t.transaction_fee + ': $' + (t.amount?.toFixed(2) || '?')))
    } else {
      console.log('    -> NO transactions with this reference_id')
    }
    console.log('')
  }
}

main().catch(console.error)
