/**
 * Preview Markup Calculator
 *
 * Calculates and stores "preview" markups on transactions BEFORE Monday invoicing.
 * This allows clients to see marked-up charges as soon as possible.
 *
 * IMPORTANT: These are PREVIEW values only. Invoice generation always recalculates fresh.
 * The invoicing process is the authoritative source of truth.
 *
 * Rules:
 * - SHIPMENTS (fee_type='Shipping'): Only calculate if base_cost is populated (from SFTP)
 *   because we mark up base_cost separately from surcharges
 * - NON-SHIPMENTS: Calculate immediately using cost field (API cost is final)
 * - ALREADY INVOICED: Skip (don't overwrite invoice-approved values)
 * - NO MATCHING RULE: Set billed_amount = cost (0% markup, not NULL)
 *
 * Integration points:
 * - SFTP sync: Calls this for Shipments after base_cost is populated
 * - Transaction sync: Calls this for non-Shipments after upsert
 */

import { createAdminClient } from '@/lib/supabase/admin'
import {
  calculateBatchMarkups,
  getShipmentFeeType,
  TransactionContext,
  BillingCategory,
} from './markup-engine'

// Fee type to billing category mapping
const FEE_TYPE_TO_CATEGORY: Record<string, BillingCategory> = {
  // Shipment fees
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

  // Storage
  'Warehousing Fee': 'storage',
  'URO Storage Fee': 'storage',

  // Returns
  'Return to sender - Processing Fees': 'returns',
  'Return Processed by Operations Fee': 'returns',
  'Return Label': 'returns',

  // Receiving
  'WRO Receiving Fee': 'receiving',
  'WRO Label Fee': 'receiving',

  // Credits (treated as the category of what they're crediting)
  'Credit': 'credits',

  // VAS
  'VAS - Paid Requests': 'shipment_fees',

  // Others
  'Others': 'shipment_fees',
}

function getFeeTypeBillingCategory(feeType: string): BillingCategory {
  return FEE_TYPE_TO_CATEGORY[feeType] || 'shipment_fees'
}

export interface PreviewMarkupOptions {
  transactionIds?: string[]  // Specific transactions to process
  feeTypes?: string[]        // Filter by fee type
  clientId?: string          // Filter by client
  forceRecalc?: boolean      // Recalculate even if markup exists (but not invoiced)
  limit?: number             // Max transactions to process (default 1000)
}

// Tax entry from ShipBob API (stored in transactions.taxes)
interface TaxEntry {
  tax_type: string
  tax_rate: number
  tax_amount: number
}

// Transaction row type from the query
interface TransactionRow {
  id: string
  transaction_id: string
  client_id: string
  fee_type: string | null
  cost: number | null
  base_cost: number | null
  surcharge: number | null
  insurance_cost: number | null
  charge_date: string
  reference_id: string | null
  reference_type: string | null
  invoiced_status_jp: boolean | null
  markup_is_preview: boolean | null
  billed_amount: number | null
  taxes: TaxEntry[] | null
}

export interface PreviewMarkupResult {
  updated: number
  skipped: number
  pending: number
  errors: string[]
}

/**
 * Calculate and store preview markups on transactions.
 *
 * @param options - Filter options for which transactions to process
 * @returns Summary of processing results
 */
export async function calculatePreviewMarkups(
  options: PreviewMarkupOptions = {}
): Promise<PreviewMarkupResult> {
  const supabase = createAdminClient()
  const result: PreviewMarkupResult = {
    updated: 0,
    skipped: 0,
    pending: 0,
    errors: [],
  }

  const { transactionIds, feeTypes, clientId, forceRecalc, limit = 1000 } = options

  try {
    // Build query for transactions needing preview markup
    let query = supabase
      .from('transactions')
      .select(`
        id,
        transaction_id,
        client_id,
        fee_type,
        cost,
        base_cost,
        surcharge,
        insurance_cost,
        charge_date,
        reference_id,
        reference_type,
        invoiced_status_jp,
        markup_is_preview,
        billed_amount,
        taxes
      `)
      // Must have client attribution (can't calculate markup without knowing which client)
      .not('client_id', 'is', null)
      // Not already invoiced (never overwrite invoice-approved values)
      .or('invoiced_status_jp.is.null,invoiced_status_jp.eq.false')
      .order('charge_date', { ascending: false })
      .limit(limit)

    // Apply filters
    if (transactionIds && transactionIds.length > 0) {
      query = query.in('id', transactionIds)
    }

    if (feeTypes && feeTypes.length > 0) {
      query = query.in('fee_type', feeTypes)
    }

    if (clientId) {
      query = query.eq('client_id', clientId)
    }

    // If not forcing recalc, only process those without preview markup
    if (!forceRecalc) {
      query = query.is('markup_is_preview', null)
    }

    const { data: transactions, error: fetchError } = await query

    if (fetchError) {
      result.errors.push(`Fetch error: ${fetchError.message}`)
      return result
    }

    if (!transactions || transactions.length === 0) {
      return result
    }

    // Cast to typed array
    const typedTransactions = transactions as TransactionRow[]

    console.log(`[PreviewMarkup] Processing ${typedTransactions.length} transactions...`)

    // Filter transactions: Shipments need base_cost, others can proceed immediately
    const processable = typedTransactions.filter((tx: TransactionRow) => {
      const feeType = tx.fee_type

      // For Shipping fee type, we need base_cost from SFTP
      // because surcharges are NOT marked up
      if (feeType === 'Shipping') {
        if (tx.base_cost === null || tx.base_cost === undefined) {
          result.skipped++
          return false
        }
      }

      return true
    })

    if (processable.length === 0) {
      console.log(`[PreviewMarkup] No processable transactions (${result.skipped} skipped awaiting SFTP)`)
      return result
    }

    // Fetch full shipment context for markup engine (ship_option_id, weight, country, order info)
    // This enables ALL markup rule conditions to work, even if we don't have rules using them yet
    const shipmentRefIds = processable
      .filter(tx => tx.reference_type === 'Shipment')
      .map(tx => tx.reference_id)
      .filter((id): id is string => !!id)

    interface ShipmentContext {
      shipOptionId: string | null
      weightOz: number | null
      country: string | null
      orderType: string | null  // DTC, FBA, B2B -> maps to order_category
      state: string | null
    }
    const shipmentContextMap = new Map<string, ShipmentContext>()

    if (shipmentRefIds.length > 0) {
      for (let i = 0; i < shipmentRefIds.length; i += 500) {
        const batch = shipmentRefIds.slice(i, i + 500)

        // Fetch shipment data (weight, country, ship_option)
        const { data: shipments } = await supabase
          .from('shipments')
          .select('shipment_id, ship_option_id, billable_weight_oz, destination_country, shipbob_order_id')
          .in('shipment_id', batch)

        if (!shipments) continue

        // Get order IDs to fetch state and order_type
        const orderIds = shipments
          .map((s: { shipbob_order_id: number | null }) => s.shipbob_order_id)
          .filter((id: number | null): id is number => id !== null)

        // Fetch order data (state, order_type)
        const orderMap = new Map<number, { state: string | null; orderType: string | null }>()
        if (orderIds.length > 0) {
          const { data: orders } = await supabase
            .from('orders')
            .select('shipbob_order_id, state, order_type')
            .in('shipbob_order_id', orderIds)

          for (const o of orders || []) {
            orderMap.set(o.shipbob_order_id, {
              state: o.state || null,
              orderType: o.order_type || null,
            })
          }
        }

        // Build context for each shipment
        for (const s of shipments) {
          const orderData = s.shipbob_order_id ? orderMap.get(s.shipbob_order_id) : null
          shipmentContextMap.set(String(s.shipment_id), {
            shipOptionId: s.ship_option_id ? String(s.ship_option_id) : null,
            weightOz: s.billable_weight_oz ?? null,
            country: s.destination_country || null,
            orderType: orderData?.orderType || null,
            state: orderData?.state || null,
          })
        }
      }
    }

    // Build contexts for batch markup calculation
    const txContexts = processable.map(tx => {
      const feeType = tx.fee_type || ''
      const billingCategory = getFeeTypeBillingCategory(feeType)
      const isShipment = feeType === 'Shipping'

      // Determine base amount for markup calculation
      let baseAmount: number
      if (isShipment) {
        // For shipping, use base_cost (surcharges not marked up)
        baseAmount = Number(tx.base_cost) || 0
      } else {
        // For all others, use cost
        baseAmount = Number(tx.cost) || 0
      }

      // Get full shipment context (for all markup engine conditions)
      const shipmentCtx = tx.reference_id ? shipmentContextMap.get(tx.reference_id) : null

      // IMPORTANT: For shipments, the feeType used in markup rules is "Standard", "FBA", or "VAS"
      // not the literal "Shipping" from the transaction fee_type field.
      // We use getShipmentFeeType() which maps order_type (DTC/FBA/B2B) to the rule's fee_type.
      // - DTC -> "Standard"
      // - FBA -> "FBA"
      // - B2B -> "B2B" (if we add rules for it)
      const ruleFeeType = isShipment
        ? getShipmentFeeType(shipmentCtx?.orderType === 'FBA' ? 'FBA' : shipmentCtx?.orderType === 'VAS' ? 'VAS' : null)
        : feeType

      return {
        id: tx.id,
        baseAmount,
        context: {
          clientId: tx.client_id,
          transactionDate: new Date(tx.charge_date),
          feeType: ruleFeeType,
          billingCategory,
          orderCategory: shipmentCtx?.orderType || null,
          shipOptionId: shipmentCtx?.shipOptionId || null,
          weightOz: shipmentCtx?.weightOz ?? undefined,
          state: shipmentCtx?.state ?? undefined,
          country: shipmentCtx?.country ?? undefined,
        } as TransactionContext,
        // Carry forward for update
        originalTx: tx,
      }
    })

    // Calculate markups in batch (efficient - groups by client)
    const markupResults = await calculateBatchMarkups(
      txContexts.map(({ id, baseAmount, context }) => ({ id, baseAmount, context }))
    )

    // Build update batches
    const updates: Array<{
      id: string
      updateData: Record<string, unknown>
    }> = []

    for (const txContext of txContexts) {
      const markupResult = markupResults.get(txContext.id)
      const tx = txContext.originalTx

      if (!markupResult) {
        result.errors.push(`No markup result for ${txContext.id}`)
        continue
      }

      // Build update data based on fee type
      const isShipment = tx.fee_type === 'Shipping'

      // Get the actual configured rule percentage
      const rulePercentage = markupResult.appliedRules.length > 0 &&
        markupResult.appliedRules[0].markupType === 'percentage'
        ? markupResult.appliedRules[0].markupValue
        : markupResult.markupPercentage
      const markupDecimal = rulePercentage / 100

      let updateData: Record<string, unknown>
      let billedAmount: number

      if (isShipment) {
        // For shipments: calculate breakdown fields matching invoice-generator logic
        const baseCost = Number(tx.base_cost) || 0
        const surcharge = Number(tx.surcharge) || 0
        const insuranceCost = Number(tx.insurance_cost) || 0

        // Match Excel/invoice formula exactly
        const baseChargeRaw = baseCost * (1 + markupDecimal)
        const insuranceChargeRaw = insuranceCost * (1 + markupDecimal)
        const billedAmountRaw = baseChargeRaw + surcharge + insuranceChargeRaw

        billedAmount = Math.round(billedAmountRaw * 100) / 100
        const baseCharge = Math.round(baseChargeRaw * 100) / 100
        const totalCharge = Math.round((baseChargeRaw + surcharge) * 100) / 100
        const insuranceCharge = Math.round(insuranceChargeRaw * 100) / 100
        const totalMarkup = Math.round((baseCost * markupDecimal + insuranceCost * markupDecimal) * 100) / 100

        updateData = {
          markup_applied: totalMarkup,
          billed_amount: billedAmount,
          markup_percentage: markupDecimal,
          markup_rule_id: markupResult.ruleId,
          base_charge: baseCharge,
          total_charge: totalCharge,
          insurance_charge: insuranceCharge,
          markup_is_preview: true,
          updated_at: new Date().toISOString(),
        }
      } else {
        // For non-shipments: simple calculation
        billedAmount = markupResult.billedAmount
        updateData = {
          markup_applied: markupResult.markupAmount,
          billed_amount: billedAmount,
          markup_percentage: markupDecimal,
          markup_rule_id: markupResult.ruleId,
          markup_is_preview: true,
          updated_at: new Date().toISOString(),
        }
      }

      // Calculate taxes_charge if transaction has taxes
      // Formula: tax_amount = billed_amount * (tax_rate / 100)
      if (tx.taxes && Array.isArray(tx.taxes) && tx.taxes.length > 0) {
        const taxesCharge = tx.taxes.map((taxEntry: TaxEntry) => ({
          tax_type: taxEntry.tax_type,
          tax_rate: taxEntry.tax_rate,
          tax_amount: Math.round(billedAmount * (taxEntry.tax_rate / 100) * 100) / 100,
        }))
        updateData.taxes_charge = taxesCharge
      }

      updates.push({ id: tx.id, updateData })
    }

    // Execute updates in batches
    const BATCH_SIZE = 100
    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const batch = updates.slice(i, i + BATCH_SIZE)

      const batchResults = await Promise.all(
        batch.map(async ({ id, updateData }) => {
          const { error } = await supabase
            .from('transactions')
            .update(updateData)
            .eq('id', id)

          return { id, error }
        })
      )

      for (const { id, error } of batchResults) {
        if (error) {
          result.errors.push(`Update ${id}: ${error.message}`)
        } else {
          result.updated++
        }
      }
    }

    console.log(`[PreviewMarkup] Complete: ${result.updated} updated, ${result.skipped} skipped`)

    return result
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : 'Unknown error')
    return result
  }
}

/**
 * Calculate preview markups specifically for shipments that just got SFTP data.
 * Called by the SFTP sync cron after updateTransactionsWithDailyBreakdown().
 */
export async function calculateShipmentPreviewMarkups(
  options: { limit?: number } = {}
): Promise<PreviewMarkupResult> {
  return calculatePreviewMarkups({
    feeTypes: ['Shipping'],
    limit: options.limit || 2000,
  })
}

/**
 * Calculate preview markups for non-shipment transactions.
 * Called by transaction sync after upsert.
 *
 * Non-shipment fee types can be calculated immediately because
 * their API cost is final (no SFTP breakdown needed).
 */
export async function calculateNonShipmentPreviewMarkups(
  options: { transactionIds?: string[]; limit?: number } = {}
): Promise<PreviewMarkupResult> {
  // All fee types except Shipping
  const nonShipmentFeeTypes = [
    'Per Pick Fee',
    'B2B - Label Fee',
    'B2B - Each Pick Fee',
    'B2B - Case Pick Fee',
    'B2B - Order Fee',
    'B2B - Supplies',
    'B2B - Pallet Material Charge',
    'B2B - Pallet Pack Fee',
    'B2B - ShipBob Freight Fee',
    'Warehousing Fee',
    'URO Storage Fee',
    'Return to sender - Processing Fees',
    'Return Processed by Operations Fee',
    'Return Label',
    'WRO Receiving Fee',
    'WRO Label Fee',
    // 'Credit' — handled separately by calculateCreditPreviewMarkups() (needs care_ticket data)
    'VAS - Paid Requests',
    'Address Correction',
    'Inventory Placement Program Fee',
    'Kitting Fee',
    'Others',
  ]

  return calculatePreviewMarkups({
    feeTypes: nonShipmentFeeTypes,
    transactionIds: options.transactionIds,
    limit: options.limit || 1000,
  })
}

// ==========================================
// Credit-specific markup calculation
// ==========================================

// Claim types that NEVER include a shipping label cost in credits
const NEVER_HAS_LABEL = ['Loss', 'Damage', 'Incorrect Delivery']

// Claim types that SOMETIMES include a shipping label cost in credits
const SOMETIMES_HAS_LABEL = ['Pick Error', 'Short Ship']

// Care ticket fields needed for classification
interface CreditTicketInfo {
  id: string
  issueType: string | null
  reshipmentStatus: string | null
  compensationRequest: string | null
  reshipmentId: string | null
  shipmentId: string | null
  ticketNumber: number | null
  status: string | null
  events: Array<{ status: string; note: string; createdAt: string; createdBy: string }> | null
}

// Shipping transaction data for label cost comparison
interface ShippingTxInfo {
  baseCost: number
  surcharge: number
  markupPercentage: number | null
  markupRuleId: string | null
}

/**
 * Calculate and store preview markups on Credit transactions.
 *
 * Must run AFTER the Fifth Pass (care_ticket linking) so that credits
 * have care_ticket_id populated for claim-type classification.
 *
 * Classification logic:
 * 1. NEVER_HAS_LABEL (Loss, Damage, Incorrect Delivery) → item-only, no markup
 * 2. SOMETIMES_HAS_LABEL (Pick Error, Short Ship):
 *    a. Reshipment: compare credit vs reshipment label cost (decomposable)
 *    b. Original label: compare credit vs original shipping base_cost + surcharge
 *    c. compensation_request = "Credit me the item's manufacturing cost" → item-only
 *    d. Otherwise → Pending Review
 * 3. No care_ticket or unknown issue_type → Pending Review
 */
export async function calculateCreditPreviewMarkups(
  options: { limit?: number } = {}
): Promise<PreviewMarkupResult> {
  const supabase = createAdminClient()
  const result: PreviewMarkupResult = {
    updated: 0,
    skipped: 0,
    pending: 0,
    errors: [],
  }

  try {
    // 1. Fetch uninvoiced Credit transactions needing markup classification
    const { data: credits, error: fetchError } = await supabase
      .from('transactions')
      .select('id, transaction_id, client_id, cost, reference_id, reference_type, care_ticket_id, taxes, charge_date')
      .eq('fee_type', 'Credit')
      .eq('is_voided', false)
      .not('client_id', 'is', null)
      .or('invoiced_status_jp.is.null,invoiced_status_jp.eq.false')
      .is('markup_is_preview', null)
      .order('charge_date', { ascending: false })
      .limit(options.limit || 500)

    if (fetchError) {
      result.errors.push(`Fetch error: ${fetchError.message}`)
      return result
    }

    if (!credits || credits.length === 0) {
      return result
    }

    console.log(`[CreditMarkup] Processing ${credits.length} credit transactions...`)

    // 2. Batch-lookup care_tickets for classification signals
    const ticketIds = credits
      .map((c: { care_ticket_id: string | null }) => c.care_ticket_id)
      .filter((id: string | null): id is string => !!id)
    const uniqueTicketIds = [...new Set(ticketIds)]

    const ticketMap = new Map<string, CreditTicketInfo>()

    if (uniqueTicketIds.length > 0) {
      for (let i = 0; i < uniqueTicketIds.length; i += 500) {
        const batch = uniqueTicketIds.slice(i, i + 500)
        const { data: tickets } = await supabase
          .from('care_tickets')
          .select('id, issue_type, reshipment_status, compensation_request, reshipment_id, shipment_id, ticket_number, status, events')
          .in('id', batch)

        for (const t of tickets || []) {
          ticketMap.set(t.id, {
            id: t.id,
            issueType: t.issue_type,
            reshipmentStatus: t.reshipment_status,
            compensationRequest: t.compensation_request,
            reshipmentId: t.reshipment_id,
            shipmentId: t.shipment_id,
            ticketNumber: t.ticket_number,
            status: t.status,
            events: (t.events as CreditTicketInfo['events']) || [],
          })
        }
      }
    }

    // 3. Collect all shipment IDs we need Shipping tx data for
    //    - Original shipments (from care_ticket.shipment_id and credit.reference_id)
    //    - Reshipments (from care_ticket.reshipment_id)
    const shipmentIdsNeeded = new Set<string>()

    for (const credit of credits) {
      // Original shipment from credit reference
      if (credit.reference_id && credit.reference_type === 'Shipment') {
        shipmentIdsNeeded.add(credit.reference_id)
      }
      // From care ticket
      const ticket = credit.care_ticket_id ? ticketMap.get(credit.care_ticket_id) : null
      if (ticket?.shipmentId) shipmentIdsNeeded.add(ticket.shipmentId)
      if (ticket?.reshipmentId) shipmentIdsNeeded.add(ticket.reshipmentId)
    }

    // Batch-lookup Shipping transactions for these shipments
    const shippingTxMap = new Map<string, ShippingTxInfo>()
    const shipmentIdArray = [...shipmentIdsNeeded]

    if (shipmentIdArray.length > 0) {
      for (let i = 0; i < shipmentIdArray.length; i += 500) {
        const batch = shipmentIdArray.slice(i, i + 500)
        const { data: shippingTxs } = await supabase
          .from('transactions')
          .select('reference_id, base_cost, surcharge, cost, markup_percentage, markup_rule_id')
          .eq('fee_type', 'Shipping')
          .eq('is_voided', false)
          .in('reference_id', batch)
          .order('charge_date', { ascending: false })

        for (const stx of shippingTxs || []) {
          // Only store the first (most recent) per shipment_id
          if (!shippingTxMap.has(stx.reference_id)) {
            const baseCost = Number(stx.base_cost) || 0
            const surcharge = Number(stx.surcharge) || 0
            // Fall back to total cost if no SFTP breakdown
            const effectiveBase = baseCost > 0 ? baseCost : (Number(stx.cost) || 0)
            const effectiveSurcharge = baseCost > 0 ? surcharge : 0

            shippingTxMap.set(stx.reference_id, {
              baseCost: effectiveBase,
              surcharge: effectiveSurcharge,
              markupPercentage: stx.markup_percentage != null ? Number(stx.markup_percentage) : null,
              markupRuleId: stx.markup_rule_id,
            })
          }
        }
      }
    }

    // 4. For credits without a stored markup_percentage on the shipping tx,
    //    we need the client's current shipping markup rule as fallback
    const clientIdsNeedingRule = new Set<string>()
    for (const credit of credits) {
      const ticket = credit.care_ticket_id ? ticketMap.get(credit.care_ticket_id) : null
      if (!ticket || !SOMETIMES_HAS_LABEL.includes(ticket.issueType || '')) continue
      // Check if we'll need a fallback markup percentage
      const shipmentId = ticket.reshipmentId || ticket.shipmentId || credit.reference_id
      const shipping = shipmentId ? shippingTxMap.get(shipmentId) : null
      if (!shipping?.markupPercentage) {
        clientIdsNeedingRule.add(credit.client_id)
      }
    }

    // Fetch current shipping markup rules for clients that need fallback
    const clientMarkupMap = new Map<string, number>() // client_id → markup decimal
    if (clientIdsNeedingRule.size > 0) {
      const clientIds = [...clientIdsNeedingRule]
      const { data: rules } = await supabase
        .from('markup_rules')
        .select('client_id, markup_value')
        .in('client_id', clientIds)
        .eq('billing_category', 'shipments')
        .eq('markup_type', 'percentage')
        .eq('is_active', true)

      for (const rule of rules || []) {
        if (!clientMarkupMap.has(rule.client_id)) {
          clientMarkupMap.set(rule.client_id, Number(rule.markup_value) / 100)
        }
      }
    }

    // 5. Classify each credit and calculate billed_amount
    const updates: Array<{ id: string; updateData: Record<string, unknown>; careTicketId?: string; billedAmount?: number }> = []

    for (const credit of credits) {
      const absCredit = Math.abs(Number(credit.cost) || 0)
      if (absCredit === 0) {
        result.skipped++
        continue
      }

      // ── Credits >= $100 are always item-only (no markup needed) ──
      // Large credits are never shipping label refunds, so pass through without manual review
      if (absCredit >= 100) {
        const update = buildItemOnlyUpdate(credit)
        const careTicketId = credit.care_ticket_id || undefined
        updates.push({ id: credit.id, updateData: update, careTicketId, billedAmount: Number(credit.cost) })
        result.updated++
        continue
      }

      const ticket = credit.care_ticket_id ? ticketMap.get(credit.care_ticket_id) : null

      // ── No care ticket → PENDING REVIEW ──
      if (!ticket) {
        updates.push({ id: credit.id, updateData: buildPendingUpdate() })
        result.updated++
        continue
      }

      const issueType = ticket.issueType || ''

      // ── NEVER_HAS_LABEL → item-only, no markup ──
      if (NEVER_HAS_LABEL.includes(issueType)) {
        const update = buildItemOnlyUpdate(credit)
        updates.push({ id: credit.id, updateData: update, careTicketId: ticket.id, billedAmount: Number(credit.cost) })
        result.updated++
        continue
      }

      // ── SOMETIMES_HAS_LABEL → comparison logic ──
      if (SOMETIMES_HAS_LABEL.includes(issueType)) {
        const isItemCostOnly = ticket.compensationRequest === "Credit me the item's manufacturing cost"

        // Determine the shipment to compare against and the markup to use
        const shipmentId = credit.reference_type === 'Shipment' ? credit.reference_id : ticket.shipmentId

        // ── Priority 1: Reshipment label (client said "I've already reshipped") ──
        if (ticket.reshipmentId) {
          const reship = shippingTxMap.get(ticket.reshipmentId)
          if (reship && reship.baseCost > 0) {
            const markupDecimal = reship.markupPercentage ?? clientMarkupMap.get(credit.client_id) ?? 0
            const reshipLabel = reship.baseCost + reship.surcharge

            if (Math.abs(absCredit - reshipLabel) < 0.05) {
              // Credit exactly matches reshipment label → LABEL ONLY, markup entire credit
              const update = buildLabelUpdate(credit, reship.baseCost, reship.surcharge, markupDecimal, reship.markupRuleId)
              updates.push({ id: credit.id, updateData: update, careTicketId: ticket.id, billedAmount: Number(update.billed_amount) })
              result.updated++
              continue
            } else if (absCredit > reshipLabel) {
              // Credit > reshipment label → COMBINED: we know the shipping portion
              const update = buildCombinedUpdate(credit, reship.baseCost, reship.surcharge, markupDecimal, reship.markupRuleId)
              updates.push({ id: credit.id, updateData: update, careTicketId: ticket.id, billedAmount: Number(update.billed_amount) })
              result.updated++
              continue
            } else {
              // Credit < reshipment label — unexpected, pending review
              updates.push({ id: credit.id, updateData: buildPendingUpdate() })
              result.updated++
              continue
            }
          }
          // No Shipping tx for reshipment — fall through to original label comparison
        }

        // ── Priority 2: Original shipment label ──
        const shipping = shipmentId ? shippingTxMap.get(shipmentId) : null
        if (shipping && shipping.baseCost > 0) {
          const markupDecimal = shipping.markupPercentage ?? clientMarkupMap.get(credit.client_id) ?? 0
          const fullLabel = shipping.baseCost + shipping.surcharge
          const baseOnly = shipping.baseCost

          if (Math.abs(absCredit - fullLabel) < 0.05 || Math.abs(absCredit - baseOnly) < 0.05) {
            // Exact match to original label
            const matchedSurcharge = Math.abs(absCredit - fullLabel) < 0.05 ? shipping.surcharge : 0
            const update = buildLabelUpdate(credit, shipping.baseCost, matchedSurcharge, markupDecimal, shipping.markupRuleId)
            updates.push({ id: credit.id, updateData: update, careTicketId: ticket.id, billedAmount: Number(update.billed_amount) })
            result.updated++
            continue
          } else if (isItemCostOnly) {
            // Pick Error + compensation confirms item-only
            const update = buildItemOnlyUpdate(credit)
            updates.push({ id: credit.id, updateData: update, careTicketId: ticket.id, billedAmount: Number(credit.cost) })
            result.updated++
            continue
          } else {
            // Ambiguous amount — pending review
            updates.push({ id: credit.id, updateData: buildPendingUpdate() })
            result.updated++
            continue
          }
        } else if (isItemCostOnly) {
          // No base_cost but compensation confirms item-only
          const update = buildItemOnlyUpdate(credit)
          updates.push({ id: credit.id, updateData: update, careTicketId: ticket.id, billedAmount: Number(credit.cost) })
          result.updated++
          continue
        } else {
          // No comparison data — pending review
          updates.push({ id: credit.id, updateData: buildPendingUpdate() })
          result.updated++
          continue
        }
      }

      // ── Unknown issue_type → PENDING REVIEW ──
      updates.push({ id: credit.id, updateData: buildPendingUpdate() })
      result.updated++
    }

    // 6. Execute updates in batches
    const BATCH_SIZE = 100
    let actualUpdated = 0

    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const batch = updates.slice(i, i + BATCH_SIZE)

      const batchResults = await Promise.all(
        batch.map(async ({ id, updateData, careTicketId, billedAmount }) => {
          const { error } = await supabase
            .from('transactions')
            .update(updateData)
            .eq('id', id)

          // Update care_ticket after successful classification:
          // - Set credit_amount to the correct billed amount (with markup)
          // - Advance status to "Credit Approved" (if still in Credit Requested)
          // - Add event note with the correct amount
          // This was moved here from the Fifth Pass (sync.ts) so clients
          // never see raw ShipBob costs — only the correctly marked-up amount.
          if (!error && careTicketId && billedAmount != null) {
            const ticket = ticketMap.get(careTicketId)
            const correctAmount = Math.abs(billedAmount)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ticketUpdate: Record<string, any> = {
              credit_amount: correctAmount,
              updated_at: new Date().toISOString(),
            }

            // Only advance status if ticket is still waiting for credit
            if (ticket && ticket.status === 'Credit Requested') {
              const approvedEvent = {
                note: `A credit of $${correctAmount.toFixed(2)} has been approved and will appear on your next invoice.`,
                status: 'Credit Approved',
                createdAt: new Date().toISOString(),
                createdBy: 'System',
              }
              ticketUpdate.status = 'Credit Approved'
              ticketUpdate.events = [approvedEvent, ...(ticket.events || [])]
            }

            await supabase
              .from('care_tickets')
              .update(ticketUpdate)
              .eq('id', careTicketId)
          }

          return { id, error }
        })
      )

      for (const { id, error } of batchResults) {
        if (error) {
          result.errors.push(`Update ${id}: ${error.message}`)
        } else {
          actualUpdated++
        }
      }
    }

    result.updated = actualUpdated
    result.pending = updates.filter(u => u.updateData.billed_amount === null).length

    // Log summary
    const classified = updates.filter(u => u.updateData.billed_amount !== null).length
    console.log(`[CreditMarkup] Complete: ${classified} classified, ${result.pending} pending review, ${result.skipped} skipped, ${result.errors.length} errors`)

    return result
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : 'Unknown error')
    return result
  }
}

/** Pending Review: billed_amount=NULL, markup_is_preview=true to prevent re-processing */
function buildPendingUpdate(): Record<string, unknown> {
  return {
    billed_amount: null,
    markup_applied: null,
    markup_percentage: null,
    credit_shipping_portion: null,
    markup_is_preview: true,
    updated_at: new Date().toISOString(),
  }
}

/** Item-only credit: no markup, credit_shipping_portion=0 */
function buildItemOnlyUpdate(credit: { cost: number | null; taxes?: TaxEntry[] | null }): Record<string, unknown> {
  const cost = Number(credit.cost) || 0
  const update: Record<string, unknown> = {
    billed_amount: cost,
    markup_applied: 0,
    markup_percentage: 0,
    credit_shipping_portion: 0,
    markup_is_preview: true,
    updated_at: new Date().toISOString(),
  }
  // Calculate taxes on billed_amount
  if (credit.taxes && Array.isArray(credit.taxes) && credit.taxes.length > 0) {
    update.taxes_charge = credit.taxes.map((t: TaxEntry) => ({
      tax_type: t.tax_type,
      tax_rate: t.tax_rate,
      tax_amount: Math.round(cost * (t.tax_rate / 100) * 100) / 100,
    }))
  }
  return update
}

/** Label-only credit: entire credit is shipping, markup applies to base_cost */
function buildLabelUpdate(
  credit: { cost: number | null; taxes?: TaxEntry[] | null },
  baseCost: number,
  surcharge: number,
  markupDecimal: number,
  markupRuleId: string | null
): Record<string, unknown> {
  // billed_amount = -(baseCost × (1+markup) + surcharge)
  const billedAmount = -((baseCost * (1 + markupDecimal)) + surcharge)
  const roundedBilled = Math.round(billedAmount * 100) / 100
  const markupAmount = Math.round(baseCost * markupDecimal * 100) / 100

  const update: Record<string, unknown> = {
    billed_amount: roundedBilled,
    markup_applied: -markupAmount, // Negative because it's a credit
    markup_percentage: markupDecimal,
    markup_rule_id: markupRuleId,
    credit_shipping_portion: baseCost,
    markup_is_preview: true,
    updated_at: new Date().toISOString(),
  }
  if (credit.taxes && Array.isArray(credit.taxes) && credit.taxes.length > 0) {
    update.taxes_charge = credit.taxes.map((t: TaxEntry) => ({
      tax_type: t.tax_type,
      tax_rate: t.tax_rate,
      tax_amount: Math.round(roundedBilled * (t.tax_rate / 100) * 100) / 100,
    }))
  }
  return update
}

/** Combined credit: shipping portion gets markup, item portion passes through */
function buildCombinedUpdate(
  credit: { cost: number | null; taxes?: TaxEntry[] | null },
  baseCost: number,
  surcharge: number,
  markupDecimal: number,
  markupRuleId: string | null
): Record<string, unknown> {
  const rawCost = Number(credit.cost) || 0  // Negative
  const absCredit = Math.abs(rawCost)
  const labelCost = baseCost + surcharge
  const itemPortion = absCredit - labelCost  // What's left after removing the label

  // Markup only applies to the base_cost of the label (not surcharge, not item)
  const markedUpLabel = baseCost * (1 + markupDecimal) + surcharge
  const billedAmount = -(markedUpLabel + itemPortion)
  const roundedBilled = Math.round(billedAmount * 100) / 100
  const markupAmount = Math.round(baseCost * markupDecimal * 100) / 100

  const update: Record<string, unknown> = {
    billed_amount: roundedBilled,
    markup_applied: -markupAmount,
    markup_percentage: markupDecimal,
    markup_rule_id: markupRuleId,
    credit_shipping_portion: baseCost,
    markup_is_preview: true,
    updated_at: new Date().toISOString(),
  }
  if (credit.taxes && Array.isArray(credit.taxes) && credit.taxes.length > 0) {
    update.taxes_charge = credit.taxes.map((t: TaxEntry) => ({
      tax_type: t.tax_type,
      tax_rate: t.tax_rate,
      tax_amount: Math.round(roundedBilled * (t.tax_rate / 100) * 100) / 100,
    }))
  }
  return update
}
