#!/usr/bin/env node
/**
 * Backfill Preview Markups for Historical Transactions
 *
 * This script calculates and stores "preview" markups for transactions that:
 * - Have client_id (attributed)
 * - Are NOT already invoiced (invoiced_status_jp != true)
 * - Don't have a preview markup yet (markup_is_preview IS NULL)
 *
 * For Shipments (fee_type='Shipping'):
 * - Only processes those with base_cost populated (from SFTP)
 *
 * For all other fee types:
 * - Calculates markup immediately using cost field
 *
 * IMPORTANT: This script mirrors the full markup-engine.ts logic including:
 * - ship_option_id matching
 * - fee_type matching
 * - order_category (FBA/VAS) matching
 * - Weight bracket conditions
 * - "Most conditions wins" rule selection
 *
 * Usage:
 *   node scripts/backfill-preview-markups.js [options]
 *
 * Options:
 *   --dry-run         Show what would be updated without making changes
 *   --limit N         Process at most N transactions (default: all)
 *   --fee-type TYPE   Only process specific fee type (e.g., "Shipping")
 *   --client-id ID    Only process specific client
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Parse command line arguments
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const limitIndex = args.indexOf('--limit')
const limit = limitIndex !== -1 ? parseInt(args[limitIndex + 1]) : null
const feeTypeIndex = args.indexOf('--fee-type')
const feeTypeFilter = feeTypeIndex !== -1 ? args[feeTypeIndex + 1] : null
const clientIndex = args.indexOf('--client-id')
const clientIdFilter = clientIndex !== -1 ? args[clientIndex + 1] : null
const startDateIndex = args.indexOf('--start-date')
const startDateFilter = startDateIndex !== -1 ? args[startDateIndex + 1] : null

console.log('='.repeat(60))
console.log('Preview Markup Backfill Script')
console.log('='.repeat(60))
console.log(`Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE'}`)
if (limit) console.log(`Limit: ${limit} transactions`)
if (feeTypeFilter) console.log(`Fee Type Filter: ${feeTypeFilter}`)
if (clientIdFilter) console.log(`Client Filter: ${clientIdFilter}`)
if (startDateFilter) console.log(`Start Date Filter: >= ${startDateFilter}`)
console.log('')

// Fee type to billing category mapping (copied from preview-markups.ts)
const FEE_TYPE_TO_CATEGORY = {
  'Shipping': 'shipments',
  'Per Pick Fee': 'shipment_fees',
  'B2B - Label Fee': 'shipment_fees',
  'B2B - Each Pick Fee': 'shipment_fees',
  'B2B - Case Pick Fee': 'shipment_fees',
  'B2B - Order Fee': 'shipment_fees',
  'B2B - Supplies': 'shipment_fees',
  'B2B - Pallet Material Charge': 'shipment_fees',
  'B2B - Pallet Pack Fee': 'shipment_fees',
  'B2B - ShipBob Freight Fee': 'shipment_fees',
  'Address Correction': 'shipment_fees',
  'Inventory Placement Program Fee': 'shipment_fees',
  'Kitting Fee': 'shipment_fees',
  'Warehousing Fee': 'storage',
  'URO Storage Fee': 'storage',
  'Return to sender - Processing Fees': 'returns',
  'Return Processed by Operations Fee': 'returns',
  'Return Label': 'returns',
  'WRO Receiving Fee': 'receiving',
  'WRO Label Fee': 'receiving',
  'Credit': 'credits',
  'VAS - Paid Requests': 'shipment_fees',
  'Others': 'shipment_fees',
}

async function getActiveMarkupRules() {
  const { data, error } = await supabase
    .from('markup_rules')
    .select('*')
    .eq('is_active', true)
    .or('effective_to.is.null,effective_to.gte.' + new Date().toISOString().split('T')[0])

  if (error) throw error
  return data || []
}

/**
 * Check if a rule matches the transaction context
 * Mirrors markup-engine.ts ruleMatchesContext()
 */
function ruleMatchesContext(rule, context) {
  // Client match: rule is global (null) or matches specific client
  if (rule.client_id !== null && rule.client_id !== context.clientId) {
    return false
  }

  // Billing category match
  if (rule.billing_category && rule.billing_category !== context.billingCategory) {
    return false
  }

  // Fee type match (from rule.fee_type field)
  if (rule.fee_type && rule.fee_type !== context.feeType) {
    return false
  }

  // Order category match (FBA, VAS, standard)
  if (rule.order_category !== null && rule.order_category !== undefined) {
    // If rule specifies a category, context must match
    // null order_category in context means "standard"
    if (rule.order_category !== (context.orderCategory || null)) {
      return false
    }
  }

  // Ship option match (single ship_option_id)
  if (rule.ship_option_id && rule.ship_option_id !== context.shipOptionId) {
    return false
  }

  // Conditions check (weight, states, countries, ship_option_ids array)
  if (rule.conditions) {
    const conditions = rule.conditions

    // Weight range
    if (context.weightOz !== undefined && context.weightOz !== null) {
      if (conditions.weight_min_oz !== undefined && context.weightOz < conditions.weight_min_oz) {
        return false
      }
      if (conditions.weight_max_oz !== undefined && context.weightOz >= conditions.weight_max_oz) {
        return false
      }
    }

    // State list
    if (conditions.states && conditions.states.length > 0) {
      if (!context.state || !conditions.states.includes(context.state)) {
        return false
      }
    }

    // Country list
    if (conditions.countries && conditions.countries.length > 0) {
      if (!context.country || !conditions.countries.includes(context.country)) {
        return false
      }
    }

    // Ship option IDs list (alternative to single ship_option_id)
    if (conditions.ship_option_ids && conditions.ship_option_ids.length > 0) {
      if (!context.shipOptionId || !conditions.ship_option_ids.includes(context.shipOptionId)) {
        return false
      }
    }
  }

  return true
}

/**
 * Count how many conditions a rule specifies
 * More conditions = more specific rule
 * Mirrors markup-engine.ts countRuleConditions()
 */
function countRuleConditions(rule) {
  let count = 0

  // Client-specific rules are more specific than global
  if (rule.client_id !== null) {
    count += 1
  }

  // Ship option specified
  if (rule.ship_option_id) {
    count += 1
  }

  // Fee type specified
  if (rule.fee_type) {
    count += 1
  }

  // Order category specified
  if (rule.order_category !== null && rule.order_category !== undefined) {
    count += 1
  }

  // Weight conditions specified
  if (rule.conditions?.weight_min_oz !== undefined || rule.conditions?.weight_max_oz !== undefined) {
    count += 1
  }

  // Ship option IDs array
  if (rule.conditions?.ship_option_ids && rule.conditions.ship_option_ids.length > 0) {
    count += 1
  }

  return count
}

/**
 * Find the best matching rule for a transaction
 * Returns a single rule (most conditions wins) or null if no match
 * Mirrors markup-engine.ts findMatchingRule()
 */
function findMatchingRule(rules, context) {
  const matching = rules.filter(rule => ruleMatchesContext(rule, context))

  if (matching.length === 0) {
    return null
  }

  // Sort by condition count (descending) - most conditions wins
  matching.sort((a, b) => countRuleConditions(b) - countRuleConditions(a))

  return matching[0]
}

function calculateMarkup(baseAmount, rule) {
  if (!rule) {
    return { markupAmount: 0, billedAmount: baseAmount, percentage: 0, ruleId: null, ruleName: null }
  }

  let markupAmount = 0
  if (rule.markup_type === 'percentage') {
    markupAmount = baseAmount * (rule.markup_value / 100)
  } else if (rule.markup_type === 'fixed') {
    markupAmount = rule.markup_value
  }

  const billedAmount = Math.round((baseAmount + markupAmount) * 100) / 100

  return {
    markupAmount: Math.round(markupAmount * 100) / 100,
    billedAmount,
    percentage: rule.markup_value / 100,
    ruleId: rule.id,
    ruleName: rule.name || null,
  }
}

async function backfillPreviewMarkups() {
  const startTime = Date.now()
  let totalProcessed = 0
  let totalUpdated = 0
  let totalSkipped = 0
  let totalErrors = 0

  try {
    // Get active markup rules
    console.log('Loading markup rules...')
    const rules = await getActiveMarkupRules()
    console.log(`Found ${rules.length} active markup rules`)

    // Show rules summary
    console.log('\nActive Rules:')
    for (const rule of rules) {
      const conditions = []
      if (rule.client_id) conditions.push(`client=${rule.client_id.slice(0, 8)}...`)
      if (rule.ship_option_id) conditions.push(`ship_opt=${rule.ship_option_id}`)
      if (rule.fee_type) conditions.push(`fee_type=${rule.fee_type}`)
      if (rule.order_category) conditions.push(`order_cat=${rule.order_category}`)
      if (rule.billing_category) conditions.push(`billing_cat=${rule.billing_category}`)
      if (rule.conditions?.weight_min_oz !== undefined) conditions.push(`weight>=${rule.conditions.weight_min_oz}oz`)
      if (rule.conditions?.weight_max_oz !== undefined) conditions.push(`weight<${rule.conditions.weight_max_oz}oz`)
      if (rule.conditions?.ship_option_ids?.length) conditions.push(`ship_opts=[${rule.conditions.ship_option_ids.length}]`)

      console.log(`  ${rule.name}: ${rule.markup_type === 'percentage' ? rule.markup_value + '%' : '$' + rule.markup_value} (${conditions.join(', ') || 'no conditions'})`)
    }
    console.log('')

    // Build shipment lookup with FULL context for all markup engine conditions
    // This enables weight-based, state-based, country-based rules to work even if we don't have them yet
    console.log('Building shipment context lookup...')
    const shipmentLookup = new Map() // shipment_id -> { shipOptionId, weightOz, country, orderType, state }
    let shipmentOffset = 0
    const SHIP_BATCH = 1000

    // First pass: get all shipment data
    const allShipments = []
    while (true) {
      const { data: shipments } = await supabase
        .from('shipments')
        .select('shipment_id, ship_option_id, billable_weight_oz, destination_country, shipbob_order_id')
        .order('id')
        .range(shipmentOffset, shipmentOffset + SHIP_BATCH - 1)

      if (!shipments || shipments.length === 0) break
      allShipments.push(...shipments)
      shipmentOffset += shipments.length
      if (shipments.length < SHIP_BATCH) break
    }
    console.log(`Loaded ${allShipments.length} shipments`)

    // Second pass: get order data for state and order_type
    const orderIds = [...new Set(allShipments.map(s => s.shipbob_order_id).filter(id => id !== null))]
    console.log(`Looking up ${orderIds.length} orders for state/order_type...`)
    const orderMap = new Map() // shipbob_order_id -> { state, orderType }

    for (let i = 0; i < orderIds.length; i += SHIP_BATCH) {
      const batch = orderIds.slice(i, i + SHIP_BATCH)
      const { data: orders } = await supabase
        .from('orders')
        .select('shipbob_order_id, state, order_type')
        .in('shipbob_order_id', batch)

      for (const o of orders || []) {
        orderMap.set(o.shipbob_order_id, {
          state: o.state || null,
          orderType: o.order_type || null,
        })
      }
    }
    console.log(`Loaded ${orderMap.size} orders`)

    // Build final lookup
    for (const s of allShipments) {
      const orderData = s.shipbob_order_id ? orderMap.get(s.shipbob_order_id) : null
      shipmentLookup.set(String(s.shipment_id), {
        shipOptionId: s.ship_option_id ? String(s.ship_option_id) : null,
        weightOz: s.billable_weight_oz ?? null,
        country: s.destination_country || null,
        orderType: orderData?.orderType || null,
        state: orderData?.state || null,
      })
    }
    console.log(`Built context for ${shipmentLookup.size} shipments`)
    console.log('')

    // Process transactions in batches
    const BATCH_SIZE = 500
    let lastId = null

    while (true) {
      // Build query
      let query = supabase
        .from('transactions')
        .select('id, transaction_id, client_id, fee_type, cost, base_cost, surcharge, insurance_cost, charge_date, reference_id, reference_type, taxes')
        .not('client_id', 'is', null)
        .or('invoiced_status_jp.is.null,invoiced_status_jp.eq.false')
        .is('markup_is_preview', null)
        .order('id', { ascending: true })
        .limit(BATCH_SIZE)

      if (lastId) {
        query = query.gt('id', lastId)
      }

      if (feeTypeFilter) {
        query = query.eq('fee_type', feeTypeFilter)
      }

      if (clientIdFilter) {
        query = query.eq('client_id', clientIdFilter)
      }

      if (startDateFilter) {
        query = query.gte('charge_date', startDateFilter)
      }

      const { data: transactions, error } = await query

      if (error) {
        console.error('Error fetching transactions:', error.message)
        break
      }

      if (!transactions || transactions.length === 0) {
        console.log('No more transactions to process')
        break
      }

      console.log(`Processing batch of ${transactions.length} transactions...`)

      for (const tx of transactions) {
        totalProcessed++
        lastId = tx.id

        const feeType = tx.fee_type || ''
        const isShipment = feeType === 'Shipping'

        // Shipments need base_cost from SFTP
        if (isShipment && (tx.base_cost === null || tx.base_cost === undefined)) {
          totalSkipped++
          continue
        }

        // Determine base amount for markup
        let baseAmount
        if (isShipment) {
          baseAmount = Number(tx.base_cost) || 0
        } else {
          baseAmount = Number(tx.cost) || 0
        }

        // Build context for rule matching (mirrors preview-markups.ts)
        const billingCategory = FEE_TYPE_TO_CATEGORY[feeType] || 'shipment_fees'

        // Get full shipment context (for ALL markup engine conditions)
        const shipmentCtx = tx.reference_id ? shipmentLookup.get(tx.reference_id) : null

        // IMPORTANT: For shipments, the feeType used in markup rules is "Standard", "FBA", or "VAS"
        // not the literal "Shipping" from the transaction fee_type field.
        // This mirrors getShipmentFeeType() from markup-engine.ts
        // - DTC -> "Standard"
        // - FBA -> "FBA"
        // - B2B -> could add "B2B" rules if needed
        let ruleFeeType = feeType
        if (isShipment) {
          const orderType = shipmentCtx?.orderType
          if (orderType === 'FBA') {
            ruleFeeType = 'FBA'
          } else if (orderType === 'VAS') {
            ruleFeeType = 'VAS'
          } else {
            ruleFeeType = 'Standard'
          }
        }

        const context = {
          clientId: tx.client_id,
          billingCategory,
          feeType: ruleFeeType,
          orderCategory: shipmentCtx?.orderType || null,
          shipOptionId: shipmentCtx?.shipOptionId || null,
          weightOz: shipmentCtx?.weightOz ?? undefined,
          state: shipmentCtx?.state ?? undefined,
          country: shipmentCtx?.country ?? undefined,
        }

        // Find matching rule and calculate markup
        const rule = findMatchingRule(rules, context)
        const markup = calculateMarkup(baseAmount, rule)

        // Build update data
        let updateData
        let billedAmount
        if (isShipment) {
          const baseCost = Number(tx.base_cost) || 0
          const surcharge = Number(tx.surcharge) || 0
          const insuranceCost = Number(tx.insurance_cost) || 0

          const baseChargeRaw = baseCost * (1 + markup.percentage)
          const insuranceChargeRaw = insuranceCost * (1 + markup.percentage)
          const billedAmountRaw = baseChargeRaw + surcharge + insuranceChargeRaw
          billedAmount = Math.round(billedAmountRaw * 100) / 100

          updateData = {
            markup_applied: Math.round((baseCost * markup.percentage + insuranceCost * markup.percentage) * 100) / 100,
            billed_amount: billedAmount,
            markup_percentage: markup.percentage,
            markup_rule_id: markup.ruleId,
            base_charge: Math.round(baseChargeRaw * 100) / 100,
            total_charge: Math.round((baseChargeRaw + surcharge) * 100) / 100,
            insurance_charge: Math.round(insuranceChargeRaw * 100) / 100,
            markup_is_preview: true,
            updated_at: new Date().toISOString(),
          }
        } else {
          billedAmount = markup.billedAmount
          updateData = {
            markup_applied: markup.markupAmount,
            billed_amount: billedAmount,
            markup_percentage: markup.percentage,
            markup_rule_id: markup.ruleId,
            markup_is_preview: true,
            updated_at: new Date().toISOString(),
          }
        }

        // Calculate taxes_charge if transaction has taxes
        // Formula: tax_amount = billed_amount * (tax_rate / 100)
        if (tx.taxes && Array.isArray(tx.taxes) && tx.taxes.length > 0) {
          const taxesCharge = tx.taxes.map((taxEntry) => ({
            tax_type: taxEntry.tax_type,
            tax_rate: taxEntry.tax_rate,
            tax_amount: Math.round(billedAmount * (taxEntry.tax_rate / 100) * 100) / 100,
          }))
          updateData.taxes_charge = taxesCharge
        }

        if (dryRun) {
          console.log(`\n[DRY RUN] Transaction ${tx.id}`)
          console.log(`  fee_type: ${feeType}${isShipment ? ` (rule lookup uses: "${ruleFeeType}")` : ''}`)
          console.log(`  transaction_id: ${tx.transaction_id}`)
          console.log(`  reference_id: ${tx.reference_id || 'null'}`)
          console.log(`  client_id: ${tx.client_id}`)
          console.log(`  charge_date: ${tx.charge_date}`)
          // Show full context used for rule matching
          console.log(`  --- Context (for rule matching) ---`)
          console.log(`  ship_option_id: ${context.shipOptionId || 'null'}`)
          console.log(`  weight_oz: ${context.weightOz ?? 'null'}`)
          console.log(`  order_type: ${context.orderCategory || 'null'}`)
          console.log(`  state: ${context.state || 'null'}`)
          console.log(`  country: ${context.country || 'null'}`)
          if (isShipment) {
            console.log(`  --- Current Values ---`)
            console.log(`  base_cost: ${tx.base_cost}`)
            console.log(`  surcharge: ${tx.surcharge}`)
            console.log(`  insurance_cost: ${tx.insurance_cost}`)
            console.log(`  cost (total): ${tx.cost}`)
          } else {
            console.log(`  --- Current Values ---`)
            console.log(`  cost: ${tx.cost}`)
          }
          console.log(`  --- Rule Match ---`)
          console.log(`  matched_rule: ${markup.ruleName || 'NO MATCH'}`)
          console.log(`  rule_id: ${markup.ruleId || 'null'}`)
          console.log(`  --- Would Write ---`)
          console.log(`  markup_applied: ${updateData.markup_applied}`)
          console.log(`  billed_amount: ${updateData.billed_amount}`)
          console.log(`  markup_percentage: ${updateData.markup_percentage} (${(updateData.markup_percentage * 100).toFixed(1)}%)`)
          console.log(`  markup_rule_id: ${updateData.markup_rule_id || 'null'}`)
          if (isShipment) {
            console.log(`  base_charge: ${updateData.base_charge}`)
            console.log(`  total_charge: ${updateData.total_charge}`)
            console.log(`  insurance_charge: ${updateData.insurance_charge}`)
          }
          console.log(`  markup_is_preview: true`)
          totalUpdated++
        } else {
          const { error: updateError } = await supabase
            .from('transactions')
            .update(updateData)
            .eq('id', tx.id)

          if (updateError) {
            console.error(`Error updating ${tx.id}:`, updateError.message)
            totalErrors++
          } else {
            totalUpdated++
          }
        }

        // Check limit
        if (limit && totalProcessed >= limit) {
          console.log(`Reached limit of ${limit} transactions`)
          break
        }
      }

      // Check limit
      if (limit && totalProcessed >= limit) break

      // Progress update
      if (totalProcessed % 1000 === 0) {
        console.log(`Progress: ${totalProcessed} processed, ${totalUpdated} updated, ${totalSkipped} skipped`)
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log('')
    console.log('='.repeat(60))
    console.log('Backfill Complete')
    console.log('='.repeat(60))
    console.log(`Total processed: ${totalProcessed}`)
    console.log(`Total updated:   ${totalUpdated}`)
    console.log(`Total skipped:   ${totalSkipped} (shipments without base_cost)`)
    console.log(`Total errors:    ${totalErrors}`)
    console.log(`Duration:        ${duration}s`)
    console.log('')

  } catch (err) {
    console.error('Fatal error:', err)
    process.exit(1)
  }
}

backfillPreviewMarkups()
