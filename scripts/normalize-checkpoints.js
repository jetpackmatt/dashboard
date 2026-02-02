/**
 * Batch normalize checkpoints using Gemini AI
 *
 * This script:
 * 1. Fetches unnormalized checkpoints from tracking_checkpoints
 * 2. Sends them to Gemini in batches of 20
 * 3. Updates the normalized_type, display_title, and sentiment fields
 *
 * Run with: node scripts/normalize-checkpoints.js
 *
 * Optional: node scripts/normalize-checkpoints.js --fallback (use rule-based, no API)
 */

require('dotenv').config({ path: '.env.local' })

const { createClient } = require('@supabase/supabase-js')
const { GoogleGenerativeAI } = require('@google/generative-ai')

// Initialize Supabase
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Initialize Gemini - using gemini-3-flash-preview (Gemini 3 Flash)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' })

const BATCH_SIZE = 20
const MAX_CHECKPOINTS = 5000 // Process up to 5000 in one run
const USE_FALLBACK = process.argv.includes('--fallback')

// Normalized types
const VALID_TYPES = ['LABEL', 'PICKUP', 'INTRANSIT', 'HUB', 'LOCAL', 'OFD', 'DELIVERED', 'ATTEMPT', 'EXCEPTION', 'RETURN', 'CUSTOMS', 'HOLD']
const VALID_SENTIMENTS = ['positive', 'neutral', 'concerning', 'critical']

/**
 * Rule-based fallback normalization (no API call)
 */
function normalizeCheckpointFallback(description, status) {
  const desc = (description || '').toLowerCase()
  const stat = (status || '').toLowerCase()

  // DELIVERED
  if (desc.includes('delivered') || stat === 'delivered') {
    return { normalized_type: 'DELIVERED', display_title: 'Delivered', sentiment: 'positive' }
  }

  // OUT FOR DELIVERY
  if (desc.includes('out for delivery') || stat === 'outfordelivery') {
    return { normalized_type: 'OFD', display_title: 'Out for delivery', sentiment: 'positive' }
  }

  // DELIVERY ATTEMPT
  if (desc.includes('delivery attempt') || desc.includes('notice left') || desc.includes('no access')) {
    return { normalized_type: 'ATTEMPT', display_title: 'Delivery attempted', sentiment: 'concerning' }
  }

  // EXCEPTION / LOST
  if (desc.includes('unable to locate') || desc.includes('lost') || desc.includes('cannot be found') ||
      stat === 'exception' || stat === 'undelivered') {
    return { normalized_type: 'EXCEPTION', display_title: 'Exception', sentiment: 'critical' }
  }

  // RETURN
  if (desc.includes('return') || desc.includes('rts') || desc.includes('refused')) {
    return { normalized_type: 'RETURN', display_title: 'Returning to sender', sentiment: 'critical' }
  }

  // CUSTOMS
  if (desc.includes('customs') || desc.includes('import') || desc.includes('export')) {
    return { normalized_type: 'CUSTOMS', display_title: 'In customs', sentiment: 'neutral' }
  }

  // HOLD
  if (desc.includes('held') || desc.includes('available for pickup') || desc.includes('will call')) {
    return { normalized_type: 'HOLD', display_title: 'Held at facility', sentiment: 'concerning' }
  }

  // LABEL CREATED
  if (desc.includes('label created') || desc.includes('shipping label') || desc.includes('electronic info') ||
      stat === 'inforeceived') {
    return { normalized_type: 'LABEL', display_title: 'Label created', sentiment: 'neutral' }
  }

  // PICKUP
  if (desc.includes('picked up') || desc.includes('accepted') || desc.includes('origin scan')) {
    return { normalized_type: 'PICKUP', display_title: 'Picked up', sentiment: 'positive' }
  }

  // LOCAL FACILITY
  if (desc.includes('local') || desc.includes('post office') || desc.includes('destination')) {
    return { normalized_type: 'LOCAL', display_title: 'At local facility', sentiment: 'positive' }
  }

  // HUB (arrived at facility)
  if (desc.includes('arrived') || desc.includes('facility') || desc.includes('hub') ||
      desc.includes('distribution')) {
    return { normalized_type: 'HUB', display_title: 'At hub', sentiment: 'neutral' }
  }

  // IN TRANSIT (default for movement)
  if (desc.includes('transit') || desc.includes('departed') || desc.includes('processed') ||
      stat === 'transit') {
    return { normalized_type: 'INTRANSIT', display_title: 'In transit', sentiment: 'neutral' }
  }

  // Default fallback
  return { normalized_type: 'INTRANSIT', display_title: 'In transit', sentiment: 'neutral' }
}

/**
 * Normalize a batch of checkpoints using Gemini
 */
async function normalizeWithGemini(checkpoints) {
  const checkpointList = checkpoints.map((cp, idx) => ({
    index: idx,
    id: cp.id,
    carrier: cp.carrier,
    description: cp.raw_description,
    location: cp.raw_location,
    status: cp.raw_status,
  }))

  const prompt = `You are an expert at classifying shipping carrier tracking events into standard categories.

## TASK
Normalize each carrier scan description into a standard type with a clean display title and sentiment.

## INPUT CHECKPOINTS
${JSON.stringify(checkpointList, null, 2)}

## NORMALIZED TYPES (choose ONE per checkpoint)
- LABEL: Label created, shipping info sent (pre-shipment)
- PICKUP: Carrier picked up, origin scan, accepted at facility
- INTRANSIT: In transit, departed facility, en route between locations
- HUB: Arrived at sorting/distribution facility, processed at hub
- LOCAL: Arrived at local delivery facility, at destination post office
- OFD: Out for delivery, with delivery courier
- DELIVERED: Delivered, left with resident, handed off
- ATTEMPT: Delivery attempt failed, no access, business closed
- EXCEPTION: Problem occurred - unable to locate, address issue, damaged
- RETURN: Return to sender, being returned
- CUSTOMS: Customs clearance, import/export scan
- HOLD: Held at facility, available for pickup, awaiting action

## SENTIMENT (choose ONE per checkpoint)
- positive: Good news - delivered, picked up, moving forward
- neutral: Normal progress - in transit, at hub
- concerning: Attention needed - attempt failed, delayed
- critical: Urgent issue - exception, lost, return

## DISPLAY TITLE RULES
- Keep it SHORT (2-5 words)
- Remove carrier branding (no "USPS", "FedEx", etc.)
- Remove redundant words
- Use sentence case

## RESPONSE FORMAT
Respond ONLY with a JSON array (no markdown, no explanation):
[{"index": 0, "id": "uuid", "normalized_type": "HUB", "display_title": "At regional hub", "sentiment": "neutral"}, ...]`

  try {
    const result = await model.generateContent(prompt)
    const response = result.response
    const text = response.text()

    // Parse JSON response, removing any markdown
    const jsonText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const normalized = JSON.parse(jsonText)

    // Validate and return
    return normalized.filter(n =>
      n.id &&
      VALID_TYPES.includes(n.normalized_type) &&
      VALID_SENTIMENTS.includes(n.sentiment) &&
      n.display_title
    )
  } catch (error) {
    console.error('Gemini error:', error.message)
    return []
  }
}

/**
 * Get unnormalized checkpoints
 */
async function getUnnormalizedCheckpoints(limit) {
  const { data, error } = await supabase
    .from('tracking_checkpoints')
    .select('id, carrier, raw_description, raw_location, raw_status')
    .is('normalized_type', null)
    .limit(limit)

  if (error) {
    console.error('Error fetching checkpoints:', error)
    return []
  }

  return data || []
}

/**
 * Update normalized checkpoints in database
 */
async function updateNormalized(normalized) {
  let success = 0
  let failed = 0

  for (const n of normalized) {
    const { error } = await supabase
      .from('tracking_checkpoints')
      .update({
        normalized_type: n.normalized_type,
        display_title: n.display_title,
        sentiment: n.sentiment,
        normalized_at: new Date().toISOString(),
      })
      .eq('id', n.id)

    if (error) {
      console.error(`Error updating ${n.id}:`, error.message)
      failed++
    } else {
      success++
    }
  }

  return { success, failed }
}

/**
 * Main function
 */
async function main() {
  console.log(`Starting checkpoint normalization (${USE_FALLBACK ? 'FALLBACK mode' : 'Gemini AI'})...\n`)

  // Get total count
  const { count: totalUnnormalized } = await supabase
    .from('tracking_checkpoints')
    .select('*', { count: 'exact', head: true })
    .is('normalized_type', null)

  console.log(`Found ${totalUnnormalized} unnormalized checkpoints\n`)

  if (totalUnnormalized === 0) {
    console.log('All checkpoints already normalized!')
    return
  }

  const toProcess = Math.min(totalUnnormalized, MAX_CHECKPOINTS)
  console.log(`Processing ${toProcess} checkpoints in batches of ${BATCH_SIZE}...\n`)

  let totalProcessed = 0
  let totalErrors = 0
  let batchNum = 0

  while (totalProcessed < toProcess) {
    batchNum++
    const checkpoints = await getUnnormalizedCheckpoints(BATCH_SIZE)

    if (checkpoints.length === 0) break

    process.stdout.write(`Batch ${batchNum}: ${checkpoints.length} checkpoints... `)

    let normalized
    if (USE_FALLBACK) {
      // Use rule-based fallback
      normalized = checkpoints.map(cp => ({
        id: cp.id,
        ...normalizeCheckpointFallback(cp.raw_description, cp.raw_status)
      }))
    } else {
      // Use Gemini AI
      normalized = await normalizeWithGemini(checkpoints)

      // Fall back for any that didn't get normalized
      if (normalized.length < checkpoints.length) {
        const normalizedIds = new Set(normalized.map(n => n.id))
        const missing = checkpoints.filter(cp => !normalizedIds.has(cp.id))
        for (const cp of missing) {
          normalized.push({
            id: cp.id,
            ...normalizeCheckpointFallback(cp.raw_description, cp.raw_status)
          })
        }
      }
    }

    // Update database
    const result = await updateNormalized(normalized)
    totalProcessed += result.success
    totalErrors += result.failed

    console.log(`OK (${result.success} success, ${result.failed} failed)`)

    // Small delay between batches
    await new Promise(r => setTimeout(r, USE_FALLBACK ? 100 : 500))
  }

  console.log('\n--- NORMALIZATION COMPLETE ---')
  console.log(`Total processed: ${totalProcessed}`)
  console.log(`Total errors: ${totalErrors}`)

  // Get final counts
  const { count: remaining } = await supabase
    .from('tracking_checkpoints')
    .select('*', { count: 'exact', head: true })
    .is('normalized_type', null)

  const { count: normalized } = await supabase
    .from('tracking_checkpoints')
    .select('*', { count: 'exact', head: true })
    .not('normalized_type', 'is', null)

  console.log(`\nDatabase status:`)
  console.log(`  Normalized: ${normalized}`)
  console.log(`  Remaining: ${remaining}`)
}

main().catch(console.error)
