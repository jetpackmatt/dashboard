/**
 * Import invoices from CSV export into invoices_sb table
 *
 * CSV Format:
 * Invoice ID | Details | Date | Amount (USD) | Balance (USD)
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Raw CSV data from ShipBob billing export
const CSV_DATA = `Invoice ID	Details	Date	Amount (USD)	Balance (USD)
8643819	ACH Payment	12/03/2025	-13951.73	0
8639220	ACH Payment	12/02/2025	-14020.69	13951.73
8633641	Invoice - Credits	12/01/2025	-686.12	27972.42
8633637	Invoice - ReturnsFee	12/01/2025	14.79	28658.54
8633634	Invoice - AdditionalFee	12/01/2025	896.17	28643.75
8633632	Invoice - WarehouseInboundFee	12/01/2025	35.00	27747.58
8633618	Invoice - WarehouseStorage	12/01/2025	2564.28	27712.58
8633612	Invoice - Shipping	12/01/2025	11127.61	25148.3
8595619	Invoice - Credits	11/24/2025	-200.00	14020.69
8595616	Invoice - ReturnsFee	11/24/2025	27.61	14220.69
8595606	Invoice - AdditionalFee	11/24/2025	1006.04	14193.08
8595600	Invoice - WarehouseInboundFee	11/24/2025	183.75	13187.04
8595597	Invoice - Shipping	11/24/2025	13003.29	13003.29
8581446	ACH Payment	11/20/2025	-15264.17	0
8564622	Invoice - Credits	11/17/2025	-297.38	15264.17
8564614	Invoice - ReturnsFee	11/17/2025	62.15	15561.55
8564605	Invoice - AdditionalFee	11/17/2025	1172.32	15499.4
8564600	Invoice - WarehouseInboundFee	11/17/2025	35.00	14327.08
8564594	Invoice - WarehouseStorage	11/17/2025	862.61	14292.08
8564590	Invoice - Shipping	11/17/2025	13429.47	13429.47
8544550	ACH Payment	11/13/2025	-10975.12	0
8540077	ACH Payment	11/12/2025	-14646.21	10975.12
8527465	Invoice - Credits	11/10/2025	-570.45	25621.33
8527461	Invoice - ReturnsFee	11/10/2025	44.80	26191.78
8527457	Invoice - AdditionalFee	11/10/2025	668.55	26146.98
8527451	Invoice - WarehouseInboundFee	11/10/2025	35.00	25478.43
8527436	Invoice - Shipping	11/10/2025	10797.22	25443.43
8520687	ACH Payment	11/07/2025	-14090.10	14646.21
8498736	Invoice - Credits	11/03/2025	-569.90	28736.31
8498735	Invoice - ReturnsFee	11/03/2025	19.28	29306.21
8498734	Invoice - AdditionalFee	11/03/2025	1164.46	29286.93
8498733	Invoice - WarehouseInboundFee	11/03/2025	70.00	28122.47
8498732	Invoice - WarehouseStorage	11/03/2025	2575.57	28052.47
8498730	Invoice - Shipping	11/03/2025	11386.80	25476.9
8470993	ACH Payment	10/28/2025	-12049.03	14090.1
8462077	Invoice - Credits	10/27/2025	-986.38	26139.13
8462075	Invoice - ReturnsFee	10/27/2025	18.56	27125.51
8462072	Invoice - AdditionalFee	10/27/2025	1257.31	27106.95
8462067	Invoice - WarehouseInboundFee	10/27/2025	35.00	25849.64
8462059	Invoice - Shipping	10/27/2025	13765.61	25814.64
8435889	Invoice - Credits	10/20/2025	-723.58	12049.03
8435887	Invoice - ReturnsFee	10/20/2025	28.13	12772.61
8435879	Invoice - AdditionalFee	10/20/2025	893.25	12744.48
8435875	Invoice - WarehouseInboundFee	10/20/2025	140.00	11851.23
8435870	Invoice - WarehouseStorage	10/20/2025	880.58	11711.23
8435858	Invoice - Shipping	10/20/2025	10830.65	10830.65
8422763	ACH Payment	10/16/2025	-10863.52	0
8401543	Invoice - Credits	10/13/2025	-265.44	10863.52
8401542	Invoice - ReturnsFee	10/13/2025	6.00	11128.96
8401526	Invoice - AdditionalFee	10/13/2025	783.64	11122.96
8401510	Invoice - WarehouseInboundFee	10/13/2025	197.50	10339.32
8401501	Invoice - WarehouseStorage	10/13/2025	-436.13	10141.82
8401487	Invoice - Shipping	10/13/2025	10577.95	10577.95
8393035	ACH Payment	10/10/2025	-14781.07	0
8380025	ACH Payment	10/07/2025	-13312.94	14781.07
8373875	Invoice - Credits	10/06/2025	-572.32	28094.01
8373872	Invoice - ReturnsFee	10/06/2025	66.24	28666.33
8373869	Invoice - AdditionalFee	10/06/2025	1710.22	28600.09
8373865	Invoice - WarehouseInboundFee	10/06/2025	125.00	26889.87
8373859	Invoice - WarehouseStorage	10/06/2025	2703.52	26764.87
8373853	Invoice - Shipping	10/06/2025	10748.41	24061.35
8344850	ACH Payment	09/30/2025	-10452.24	13312.94
8336856	Invoice - Credits	09/29/2025	-890.72	23765.18
8336853	Invoice - ReturnsFee	09/29/2025	11.86	24655.9
8336851	Invoice - AdditionalFee	09/29/2025	840.07	24644.04
8336844	Invoice - WarehouseInboundFee	09/29/2025	162.50	23803.97
8336836	Invoice - Shipping	09/29/2025	11405.24	23641.47
8322035	ACH Payment	09/24/2025	-10452.24	12236.23
8309951	Invoice - Credits	09/22/2025	-827.40	22688.47
8309949	Invoice - ReturnsFee	09/22/2025	56.51	23515.87
8309947	Invoice - AdditionalFee	09/22/2025	706.65	23459.36
8309944	Invoice - WarehouseInboundFee	09/22/2025	35.00	22752.71
8309941	Invoice - WarehouseStorage	09/22/2025	953.80	22717.71
8309936	Invoice - Shipping	09/22/2025	11311.67	21763.91
8276136	Invoice - Credits	09/15/2025	-656.37	10452.24
8276134	Invoice - ReturnsFee	09/15/2025	25.95	11108.61
8276133	Invoice - AdditionalFee	09/15/2025	732.09	11082.66
8276132	Invoice - WarehouseInboundFee	09/15/2025	70.00	10350.57
8276131	Invoice - Shipping	09/15/2025	10280.57	10280.57
8259286	ACH Payment	09/10/2025	-11850.25	0
8254804	ACH Payment	09/09/2025	-10777.56	11850.25
8247089	Invoice - Credits	09/08/2025	-1246.38	22627.81
8247083	Invoice - ReturnsFee	09/08/2025	49.45	23874.19
8247077	Invoice - AdditionalFee	09/08/2025	929.37	23824.74
8247073	Invoice - WarehouseInboundFee	09/08/2025	193.75	22895.37
8247066	Invoice - Shipping	09/08/2025	11924.06	22701.62
8224615	Invoice - Credits	09/01/2025	-2122.97	10777.56
8224611	Invoice - ReturnsFee	09/01/2025	47.82	12900.53
8224607	Invoice - AdditionalFee	09/01/2025	769.41	12852.71
8224604	Invoice - WarehouseInboundFee	09/01/2025	115.00	12083.3
8224596	Invoice - WarehouseStorage	09/01/2025	1356.30	11968.3
8224591	Invoice - Shipping	09/01/2025	10612.00	10612
8202241	ACH Payment	08/28/2025	-10985.02	0
8188434	Invoice - Credits	08/25/2025	-821.53	10985.02
8188427	Invoice - ReturnsFee	08/25/2025	25.30	11806.55
8188422	Invoice - AdditionalFee	08/25/2025	832.89	11781.25
8188417	Invoice - WarehouseInboundFee	08/25/2025	70.00	10948.36
8188411	Invoice - Shipping	08/25/2025	10878.36	10878.36
8166415	ACH Payment	08/19/2025	-14325.91	0
8159482	Invoice - Credits	08/18/2025	-796.63	14325.91
8159475	Invoice - AdditionalFee	08/18/2025	829.79	15122.54
8159471	Invoice - WarehouseInboundFee	08/18/2025	175.00	14292.75
8159467	Invoice - WarehouseStorage	08/18/2025	1196.57	14117.75
8159456	Invoice - Shipping	08/18/2025	12921.18	12921.18
8140647	ACH Payment	08/14/2025	-14023.81	0
8131999	ACH Payment	08/12/2025	-16669.76	14023.81
8126113	Invoice - Credits	08/11/2025	-864.93	30693.57
8126107	Invoice - ReturnsFee	08/11/2025	20.94	31558.5
8126101	Invoice - AdditionalFee	08/11/2025	-1174.01	31537.56
8126098	Invoice - WarehouseInboundFee	08/11/2025	140.00	32711.57
8126093	Invoice - Shipping	08/11/2025	15901.81	32571.57
8098531	Invoice - Credits	08/04/2025	-3741.77	16669.76
8098526	Invoice - ReturnsFee	08/04/2025	5.80	20411.53
8098521	Invoice - AdditionalFee	08/04/2025	1266.88	20405.73
8098513	Invoice - WarehouseInboundFee	08/04/2025	245.00	19138.85
8098507	Invoice - WarehouseStorage	08/04/2025	1035.47	18893.85
8098502	Invoice - Shipping	08/04/2025	17858.38	17858.38
8072317	ACH Payment	07/30/2025	-17624.65	0
8062021	Invoice - Credits	07/28/2025	-712.17	17624.65
8062016	Invoice - ReturnsFee	07/28/2025	43.13	18336.82
8062010	Invoice - AdditionalFee	07/28/2025	602.82	18293.69
8062003	Invoice - WarehouseInboundFee	07/28/2025	197.50	17690.87
8061998	Invoice - Shipping	07/28/2025	7289.24	17493.37
8053594	ACH Payment	07/25/2025	-24167.81	10204.13
8034255	Invoice - Credits	07/21/2025	-913.86	34371.94
8034248	Invoice - ReturnsFee	07/21/2025	16.44	35285.8
8034244	Invoice - AdditionalFee	07/21/2025	2967.75	35269.36
8034233	Invoice - WarehouseInboundFee	07/21/2025	415.35	32301.61
8034227	Invoice - WarehouseStorage	07/21/2025	614.86	31886.26
8034218	Invoice - Shipping	07/21/2025	7103.59	31271.4
8021257	ACH Payment	07/17/2025	-10043.25	24167.81
8000283	ACH Payment	07/14/2025	-14825.10	34211.06
7998720	Invoice - Credits	07/14/2025	-289.36	49036.16
7998719	Invoice - ReturnsFee	07/14/2025	26.29	49325.52
7998716	Invoice - AdditionalFee	07/14/2025	1544.14	49299.23
7998714	Invoice - WarehouseInboundFee	07/14/2025	245.00	47755.09
7998711	Invoice - Shipping	07/14/2025	22641.74	47510.09
7971273	Invoice - Credits	07/07/2025	-622.28	24868.35
7971270	Invoice - ReturnsFee	07/07/2025	22.74	25490.63
7971262	Invoice - AdditionalFee	07/07/2025	1290.37	25467.89
7971256	Invoice - WarehouseInboundFee	07/07/2025	140.00	24177.52
7971252	Invoice - WarehouseStorage	07/07/2025	431.50	24037.52
7971247	Invoice - Shipping	07/07/2025	8780.92	23606.02
7938966	Invoice - Credits	06/30/2025	-553.92	14825.1
7938962	Invoice - ReturnsFee	06/30/2025	32.72	15379.02
7938959	Invoice - AdditionalFee	06/30/2025	1721.44	15346.3
7938955	Invoice - WarehouseInboundFee	06/30/2025	468.75	13624.86
7938945	Invoice - Shipping	06/30/2025	13156.11	13156.11
7933822	ACH Payment	06/28/2025	-4139.92	0
7910816	Invoice - Credits	06/23/2025	-275.85	4139.92
7910811	Invoice - ReturnsFee	06/23/2025	24.75	4415.77
7910806	Invoice - AdditionalFee	06/23/2025	207.63	4391.02
7910802	Invoice - WarehouseInboundFee	06/23/2025	70.00	4183.39
7910797	Invoice - Shipping	06/23/2025	4113.39	4113.39
7889564	ACH Payment	06/17/2025	-9210.63	0
7882608	Invoice - Credits	06/16/2025	-508.31	9210.63
7882607	Invoice - ReturnsFee	06/16/2025	9.06	9718.94
7882606	Invoice - AdditionalFee	06/16/2025	604.20	9709.88
7882605	Invoice - WarehouseStorage	06/16/2025	466.10	9105.68
7882603	Invoice - Shipping	06/16/2025	8639.58	8639.58
7858089	ACH Payment	06/11/2025	-14785.58	0
7853552	ACH Payment	06/10/2025	-1907.94	14785.58
7848824	ACH Payment	06/09/2025	-14602.73	16693.52
7847061	Invoice - Credits	06/09/2025	-169.99	31296.25
7847058	Invoice - ReturnsFee	06/09/2025	12.61	31466.24
7847053	Invoice - AdditionalFee	06/09/2025	818.80	31453.63
7847046	Invoice - WarehouseInboundFee	06/09/2025	105.00	30634.83
7847040	Invoice - Shipping	06/09/2025	14019.16	30529.83
7819473	Invoice - Credits	06/02/2025	-313.92	16510.67
7819471	Invoice - ReturnsFee	06/02/2025	12.08	16824.59
7819470	Invoice - AdditionalFee	06/02/2025	1503.31	16812.51
7819469	Invoice - WarehouseInboundFee	06/02/2025	217.50	15309.2
7819468	Invoice - WarehouseStorage	06/02/2025	488.97	15091.7
7819467	Invoice - Shipping	06/02/2025	14602.73	14602.73
7792896	ACH Payment	05/28/2025	-5332.28	0
7785620	Invoice - Credits	05/26/2025	-189.40	5332.28
7785618	Invoice - ReturnsFee	05/26/2025	18.50	5521.68
7785615	Invoice - AdditionalFee	05/26/2025	484.36	5503.18
7785607	Invoice - WarehouseInboundFee	05/26/2025	70.00	5018.82
7785596	Invoice - Shipping	05/26/2025	4948.82	4948.82
7776853	ACH Payment	05/23/2025	-10793.52	0
7758403	Invoice - Credits	05/19/2025	-567.00	10793.52
7758401	Invoice - ReturnsFee	05/19/2025	29.91	11360.52
7758399	Invoice - AdditionalFee	05/19/2025	988.41	11330.61
7758395	Invoice - WarehouseInboundFee	05/19/2025	35.00	10342.2
7758392	Invoice - WarehouseStorage	05/19/2025	522.32	10307.2
7758387	Invoice - Shipping	05/19/2025	9784.88	9784.88
7737513	ACH Payment	05/15/2025	-11401.15	0
7728542	ACH Payment	05/13/2025	-10293.51	11401.15
7721818	Invoice - Credits	05/12/2025	-415.00	21694.66
7721817	Invoice - ReturnsFee	05/12/2025	20.13	22109.66
7721815	Invoice - AdditionalFee	05/12/2025	755.86	22089.53
7721814	Invoice - WarehouseInboundFee	05/12/2025	70.00	21333.67
7721810	Invoice - Shipping	05/12/2025	10970.16	21263.67
7695745	ACH Payment	05/05/2025	-15580.99	10293.51
7694471	Invoice - Credits	05/05/2025	-1618.70	25874.5
7694469	Invoice - ReturnsFee	05/05/2025	39.96	27493.2
7694463	Invoice - AdditionalFee	05/05/2025	793.52	27453.24
7694462	Invoice - WarehouseInboundFee	05/05/2025	35.00	26659.72
7694458	Invoice - WarehouseStorage	05/05/2025	491.20	26624.72
7694453	Invoice - Shipping	05/05/2025	10552.53	26133.52
7657556	Invoice - Credits	04/28/2025	-753.86	15580.99
7657554	Invoice - ReturnsFee	04/28/2025	47.18	16334.85
7657552	Invoice - AdditionalFee	04/28/2025	1095.94	16287.67
7657548	Invoice - WarehouseInboundFee	04/28/2025	116.25	15191.73
7657542	Invoice - Shipping	04/28/2025	15075.48	15075.48
7640597	ACH Payment	04/23/2025	-10436.94	0
7629430	Invoice - Credits	04/21/2025	-533.90	10436.94
7629429	Invoice - ReturnsFee	04/21/2025	17.16	10970.84
7629427	Invoice - AdditionalFee	04/21/2025	770.51	10953.68
7629425	Invoice - WarehouseInboundFee	04/21/2025	70.00	10183.17
7629420	Invoice - WarehouseStorage	04/21/2025	482.93	10113.17
7629416	Invoice - Shipping	04/21/2025	9630.24	9630.24
7612619	ACH Payment	04/16/2025	-7438.54	0
7594214	Invoice - Credits	04/14/2025	-327.80	7438.54
7594213	Invoice - ReturnsFee	04/14/2025	81.05	7766.34
7594212	Invoice - AdditionalFee	04/14/2025	429.72	7685.29
7594211	Invoice - WarehouseInboundFee	04/14/2025	92.50	7255.57
7594210	Invoice - Shipping	04/14/2025	7163.07	7163.07
7582081	ACH Payment	04/10/2025	-18526.21	0
7566428	Invoice - Credits	04/07/2025	-335.13	18526.21
7566427	Invoice - ReturnsFee	04/07/2025	3.00	18861.34
7566425	Invoice - AdditionalFee	04/07/2025	1366.29	18858.34
7566422	Invoice - WarehouseInboundFee	04/07/2025	151.25	17492.05
7566419	Invoice - WarehouseStorage	04/07/2025	512.74	17340.8
7566413	Invoice - Shipping	04/07/2025	16828.06	16828.06
7553707	ACH Payment	04/03/2025	-11330.38	0
7529154	Invoice - Credits	03/31/2025	-36.97	11330.38
7529152	Invoice - ReturnsFee	03/31/2025	33.78	11367.35
7529151	Invoice - AdditionalFee	03/31/2025	984.53	11333.57
7529149	Invoice - Shipping	03/31/2025	10349.04	10349.04
7517140	ACH Payment	03/27/2025	-27182.45	0
7501059	Invoice - Credits	03/24/2025	-59.18	27182.45
7501057	Invoice - AdditionalFee	03/24/2025	790.04	27241.63
7501055	Invoice - WarehouseInboundFee	03/24/2025	105.00	26451.59
7501050	Invoice - Shipping	03/24/2025	11621.14	26346.59
7484806	ACH Payment - Declined	03/19/2025	14725.45	14725.45
7475236	ACH Payment - Declined	03/17/2025	-14725.45	0
7474929	Invoice - AdditionalFee	03/17/2025	761.16	14725.45
7474928	Invoice - WarehouseInboundFee	03/17/2025	195.00	13964.29
7474927	Invoice - WarehouseStorage	03/17/2025	307.47	13769.29
7474925	Invoice - Shipping	03/17/2025	13461.82	13461.82
7437456	Card Payment	03/10/2025	-1357.26	0
7437453	Credit Card Processing Fees	03/10/2025	39.53	1357.26
7436561	Invoice - AdditionalFee	03/10/2025	42.12	1317.73
7436560	Invoice - Shipping	03/10/2025	1275.61	1275.61`

/**
 * Parse "Details" field to extract invoice_type
 */
function parseInvoiceType(details) {
  // Map details text to invoice_type
  const mappings = {
    'ACH Payment': 'Payment',
    'ACH Payment - Declined': 'PaymentDeclined',
    'Card Payment': 'Payment',
    'Credit Card Processing Fees': 'ProcessingFee',
    'Invoice - Credits': 'Credits',
    'Invoice - ReturnsFee': 'ReturnsFee',
    'Invoice - AdditionalFee': 'AdditionalFee',
    'Invoice - WarehouseInboundFee': 'WarehouseInboundFee',
    'Invoice - WarehouseStorage': 'WarehouseStorage',
    'Invoice - Shipping': 'Shipping',
  }

  return mappings[details] || details
}

/**
 * Parse MM/DD/YYYY date to YYYY-MM-DD
 */
function parseDate(dateStr) {
  const [month, day, year] = dateStr.split('/')
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

async function main() {
  console.log('='.repeat(70))
  console.log('IMPORT SHIPBOB INVOICES FROM CSV EXPORT')
  console.log('='.repeat(70))

  // Parse CSV
  const lines = CSV_DATA.trim().split('\n')
  const headers = lines[0].split('\t')

  console.log('\nHeaders:', headers)
  console.log('Data rows:', lines.length - 1)

  const records = []

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t')

    const invoiceId = parseInt(cols[0])
    const details = cols[1]
    const dateStr = cols[2]
    const amount = parseFloat(cols[3])
    const balance = parseFloat(cols[4])

    const invoiceType = parseInvoiceType(details)
    const invoiceDate = parseDate(dateStr)

    // Calculate billing period (ShipBob bills weekly, Mon-Sun)
    // The invoice_date is typically a Monday (start of week for the previous week's charges)
    // So period is the 7 days prior to invoice_date
    const invDateObj = new Date(invoiceDate + 'T00:00:00Z')
    const periodEnd = new Date(invDateObj)
    periodEnd.setDate(periodEnd.getDate() - 1)  // Day before invoice
    const periodStart = new Date(periodEnd)
    periodStart.setDate(periodStart.getDate() - 6)  // 7 days prior

    const formatDate = (d) => d.toISOString().substring(0, 10)

    records.push({
      shipbob_invoice_id: invoiceId,  // This IS the invoice number
      invoice_date: invoiceDate,
      invoice_type: invoiceType,
      base_amount: amount,
      currency_code: 'USD',
      period_start: formatDate(periodStart),
      period_end: formatDate(periodEnd),
      raw_data: {
        details,
        running_balance: balance,
        original_date: dateStr
      }
    })
  }

  // Show type distribution
  const byType = {}
  let totalCharges = 0
  let totalPayments = 0

  for (const r of records) {
    byType[r.invoice_type] = (byType[r.invoice_type] || 0) + 1
    if (r.base_amount > 0) totalCharges += r.base_amount
    else totalPayments += Math.abs(r.base_amount)
  }

  console.log('\nBy Invoice Type:')
  for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`)
  }

  console.log('\nFinancials:')
  console.log('  Total Charges: $' + totalCharges.toFixed(2))
  console.log('  Total Payments: $' + totalPayments.toFixed(2))
  console.log('  Net: $' + (totalCharges - totalPayments).toFixed(2))

  // Date range
  const dates = records.map(r => r.invoice_date).sort()
  console.log('\nDate Range:', dates[0], 'to', dates[dates.length - 1])

  // Check existing records
  const { count: existingCount } = await supabase
    .from('invoices_sb')
    .select('*', { count: 'exact', head: true })

  console.log('\nExisting invoices_sb records:', existingCount)

  // Upsert records
  console.log('\nUpserting', records.length, 'records...')

  const { data, error } = await supabase
    .from('invoices_sb')
    .upsert(records, {
      onConflict: 'shipbob_invoice_id',
      ignoreDuplicates: false
    })
    .select()

  if (error) {
    console.error('Upsert error:', error)
    return
  }

  console.log('Upserted:', records.length, 'records')

  // Verify
  const { count: finalCount } = await supabase
    .from('invoices_sb')
    .select('*', { count: 'exact', head: true })

  console.log('\nFinal invoices_sb count:', finalCount)

  // Show sample
  const { data: sample } = await supabase
    .from('invoices_sb')
    .select('shipbob_invoice_id, invoice_date, invoice_type, base_amount')
    .order('invoice_date', { ascending: false })
    .limit(10)

  console.log('\nLatest 10 records:')
  for (const inv of sample || []) {
    console.log(`  ${inv.shipbob_invoice_id} | ${inv.invoice_date} | ${inv.invoice_type} | $${inv.base_amount}`)
  }
}

main().catch(console.error)
