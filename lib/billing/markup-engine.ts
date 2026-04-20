/**
 * Markup Engine
 *
 * Calculates markups for billing transactions based on configured rules.
 *
 * Rule Selection: "Most Conditions Wins"
 * - Each rule is standalone (no inheritance/stacking)
 * - If multiple rules match, the one with the most conditions wins
 * - Conditions counted: ship_option_id, weight bracket, client-specific
 * - If still tied, first created wins
 *
 * Example:
 * - "Standard" (0 conditions) = 14%
 * - "Standard + Ship 146" (1 condition) = 18%
 * - "Standard + Ship 146 + 5-10lbs" (2 conditions) = 25%
 *
 * A shipment with Ship 146 at 7lbs → 25% (most specific match)
 */

import { createAdminClient } from '@/lib/supabase/admin'

// Types
export interface MarkupRule {
  id: string
  client_id: string | null
  name: string
  fee_type: string | null
  ship_option_id: string | null
  billing_category: string | null
  order_category: string | null
  origin_country: string | null
  conditions: MarkupConditions | null
  markup_type: 'percentage' | 'fixed'
  markup_value: number
  priority: number
  is_additive: boolean
  effective_from: string
  effective_to: string | null
  is_active: boolean
  description: string | null
}

export interface MarkupConditions {
  weight_min_oz?: number
  weight_max_oz?: number
  states?: string[]
  countries?: string[]
  ship_option_ids?: string[]
}

export interface MarkupResult {
  baseAmount: number
  markupAmount: number
  billedAmount: number
  ruleId: string | null
  ruleName: string | null
  markupPercentage: number
  appliedRules: AppliedRule[]
}

export interface AppliedRule {
  ruleId: string
  ruleName: string
  markupType: 'percentage' | 'fixed'
  markupValue: number
  markupAmount: number
}

export interface TransactionContext {
  clientId: string
  transactionDate: Date
  feeType: string
  billingCategory: BillingCategory
  orderCategory?: string | null  // FBA, VAS, or null for standard
  shipOptionId?: string | null
  weightOz?: number
  state?: string
  country?: string
  originCountry?: string
}

export type BillingCategory =
  | 'shipments'
  | 'shipment_fees'
  | 'storage'
  | 'credits'
  | 'returns'
  | 'receiving'
  | 'insurance'

// Weight bracket definitions
export const WEIGHT_BRACKETS = [
  { label: '<8oz', minOz: 0, maxOz: 8 },
  { label: '8-16oz', minOz: 8, maxOz: 16 },
  { label: '1-5lbs', minOz: 16, maxOz: 80 },
  { label: '5-10lbs', minOz: 80, maxOz: 160 },
  { label: '10-15lbs', minOz: 160, maxOz: 240 },
  { label: '15-20lbs', minOz: 240, maxOz: 320 },
  { label: '20+lbs', minOz: 320, maxOz: null },
] as const

/**
 * Map order_category from billing_shipments to fee type
 *
 * For shipments, the fee type is determined by order_category:
 * - null/undefined → "Standard" (D2C shipments)
 * - "FBA" → "FBA"
 * - "VAS" → "VAS"
 *
 * This applies to both charges and refunds - refunds automatically
 * use the same markup as their corresponding charge type.
 */
export function getShipmentFeeType(orderCategory: string | null | undefined): string {
  if (!orderCategory) {
    return 'Standard'
  }
  // Return the order_category as-is for FBA, VAS, etc.
  return orderCategory
}

/**
 * Find the weight bracket for a given weight in ounces
 */
export function getWeightBracket(weightOz: number): string {
  for (const bracket of WEIGHT_BRACKETS) {
    if (weightOz >= bracket.minOz && (bracket.maxOz === null || weightOz < bracket.maxOz)) {
      return bracket.label
    }
  }
  return '20+lbs'
}

/**
 * Fetch all active markup rules for a client (including global rules)
 */
export async function fetchMarkupRules(
  clientId: string,
  asOfDate?: Date
): Promise<MarkupRule[]> {
  const supabase = createAdminClient()
  const dateStr = (asOfDate || new Date()).toISOString().split('T')[0]

  const { data, error } = await supabase
    .from('markup_rules')
    .select('*')
    .eq('is_active', true)
    .lte('effective_from', dateStr)
    .or(`effective_to.is.null,effective_to.gte.${dateStr}`)
    .or(`client_id.is.null,client_id.eq.${clientId}`)
    .order('priority', { ascending: false })

  if (error) {
    console.error('Error fetching markup rules:', error)
    return []
  }

  return data || []
}

/**
 * Fetch ALL active markup rules for a client (and globals), ignoring effective
 * dates. Use this when calculating markup for a set of transactions that span
 * multiple dates — callers must then pass each tx's own charge date to
 * findMatchingRule() so the right versioned rule applies per-tx.
 */
export async function fetchMarkupRulesAll(clientId: string): Promise<MarkupRule[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('markup_rules')
    .select('*')
    .eq('is_active', true)
    .or(`client_id.is.null,client_id.eq.${clientId}`)
    .order('priority', { ascending: false })

  if (error) {
    console.error('Error fetching markup rules (all):', error)
    return []
  }

  return data || []
}

/**
 * Check if a rule matches the transaction context
 */
export function ruleMatchesContext(
  rule: MarkupRule,
  context: TransactionContext
): boolean {
  // Client match: rule is global (null) or matches specific client
  if (rule.client_id !== null && rule.client_id !== context.clientId) {
    return false
  }

  // Billing category match
  if (rule.billing_category && rule.billing_category !== context.billingCategory) {
    return false
  }

  // Fee type match
  if (rule.fee_type && rule.fee_type !== context.feeType) {
    return false
  }

  // Order category match (for shipments: FBA, VAS, standard)
  if (rule.order_category !== null) {
    // If rule specifies a category, context must match
    // null order_category in context means "standard"
    if (rule.order_category !== (context.orderCategory || null)) {
      return false
    }
  }

  // Ship option match
  if (rule.ship_option_id && rule.ship_option_id !== context.shipOptionId) {
    return false
  }

  // Origin country match
  // NULL = catchall (matches all origin countries including US)
  // Non-null = only match transactions from warehouses in that country
  if (rule.origin_country !== null && rule.origin_country !== undefined) {
    if (!context.originCountry || rule.origin_country !== context.originCountry) {
      return false
    }
  }

  // Conditions check
  if (rule.conditions) {
    const conditions = rule.conditions

    // Weight range
    if (context.weightOz !== undefined) {
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
 *
 * Counted as conditions:
 * - client-specific (vs global): +1 (always takes precedence)
 * - ship_option_id specified: +1
 * - origin_country specified: +2 (country-specific rules always beat
 *   catchall rules with ship_option/weight conditions, because catchall
 *   rules were designed for US and shouldn't override country overrides)
 * - weight bracket specified: +1
 */
export function countRuleConditions(rule: MarkupRule): number {
  let count = 0

  // Client-specific rules are more specific than global
  if (rule.client_id !== null) {
    count += 1
  }

  // Ship option specified
  if (rule.ship_option_id) {
    count += 1
  }

  // Origin country specified — weighted +2 so country-specific rules
  // always beat catchall rules that have ship_option or weight conditions.
  // A "Standard (CA)" rule (3 points) beats "Standard (Ship 146)" (2 points)
  // for Canadian shipments, which is correct because the Ship 146 rule
  // was designed for US and shouldn't leak into country-specific billing.
  if (rule.origin_country) {
    count += 2
  }

  // Weight conditions specified
  if (rule.conditions?.weight_min_oz !== undefined || rule.conditions?.weight_max_oz !== undefined) {
    count += 1
  }

  return count
}

/**
 * Find the best matching rule for a transaction
 * Returns a single rule (most conditions wins) or null if no match
 */
export function findMatchingRule(
  rules: MarkupRule[],
  context: TransactionContext,
  asOfDate?: Date
): MarkupRule | null {
  // When asOfDate is provided, also filter by the rule's effective window.
  // This is required when caller has pre-fetched rules across a multi-day span
  // (see fetchMarkupRulesAll) — each tx should only match the rule version that
  // was live on its own charge_date.
  const asOfStr = asOfDate ? asOfDate.toISOString().split('T')[0] : null
  const matching = rules.filter(rule => {
    if (!ruleMatchesContext(rule, context)) return false
    if (asOfStr) {
      if (rule.effective_from && asOfStr < rule.effective_from) return false
      if (rule.effective_to && asOfStr > rule.effective_to) return false
    }
    return true
  })

  if (matching.length === 0) {
    return null
  }

  // Sort by condition count (descending) - most conditions wins
  matching.sort((a, b) => countRuleConditions(b) - countRuleConditions(a))

  return matching[0]
}

/**
 * Calculate markup for a base amount using a single matching rule
 *
 * Simple: one rule applies, no stacking
 */
export function calculateMarkup(
  baseAmount: number,
  rule: MarkupRule | null
): MarkupResult {
  if (!rule) {
    return {
      baseAmount,
      markupAmount: 0,
      billedAmount: baseAmount,
      ruleId: null,
      ruleName: null,
      markupPercentage: 0,
      appliedRules: [],
    }
  }

  let markupAmount = 0

  if (rule.markup_type === 'percentage') {
    markupAmount = baseAmount * (rule.markup_value / 100)
  } else {
    // Fixed amount
    markupAmount = rule.markup_value
  }

  // Round to 2 decimal places
  markupAmount = Math.round(markupAmount * 100) / 100
  const billedAmount = Math.round((baseAmount + markupAmount) * 100) / 100

  // Calculate effective markup percentage
  const effectivePercentage = baseAmount !== 0
    ? Math.round((markupAmount / baseAmount) * 10000) / 100
    : 0

  return {
    baseAmount,
    markupAmount,
    billedAmount,
    ruleId: rule.id,
    ruleName: rule.name,
    markupPercentage: effectivePercentage,
    appliedRules: [{
      ruleId: rule.id,
      ruleName: rule.name,
      markupType: rule.markup_type,
      markupValue: rule.markup_value,
      markupAmount,
    }],
  }
}

/**
 * Main function: Calculate markup for a transaction
 */
export async function calculateTransactionMarkup(
  baseAmount: number,
  context: TransactionContext
): Promise<MarkupResult> {
  // Fetch applicable rules
  const rules = await fetchMarkupRules(context.clientId, context.transactionDate)

  // Find the best matching rule (most conditions wins)
  const matchingRule = findMatchingRule(rules, context)

  // Calculate markup
  return calculateMarkup(baseAmount, matchingRule)
}

/**
 * Batch calculate markups for multiple transactions
 * More efficient as it only fetches rules once per client
 */
export async function calculateBatchMarkups(
  transactions: Array<{
    id: string
    baseAmount: number
    context: TransactionContext
  }>
): Promise<Map<string, MarkupResult>> {
  const results = new Map<string, MarkupResult>()

  // Group by client for efficient rule fetching
  const byClient = new Map<string, typeof transactions>()
  for (const tx of transactions) {
    const existing = byClient.get(tx.context.clientId) || []
    existing.push(tx)
    byClient.set(tx.context.clientId, existing)
  }

  // Process each client's transactions
  for (const [clientId, clientTxs] of byClient) {
    // Fetch ALL active rules for this client across the full span of tx dates.
    // Previously used only minDate, which silently dropped any rule that became
    // effective LATER than the earliest tx in the batch — causing a multi-day
    // invoice spanning a rule change to apply the wrong markup to the later days
    // (or, in the Arterra case where historical rule data was corrupted, zero markup).
    // We now filter per-tx by date inside findMatchingRule using asOfDate.
    const rules = await fetchMarkupRulesAll(clientId)

    // Calculate markup for each transaction using its own charge date
    for (const tx of clientTxs) {
      const matchingRule = findMatchingRule(rules, tx.context, tx.context.transactionDate)
      const result = calculateMarkup(tx.baseAmount, matchingRule)
      results.set(tx.id, result)
    }
  }

  return results
}

/**
 * Create a markup rule history entry
 */
export async function recordRuleChange(
  ruleId: string,
  changeType: 'created' | 'updated' | 'deactivated',
  previousValues: Partial<MarkupRule> | null,
  newValues: Partial<MarkupRule> | null,
  changedBy: string | null,
  changeReason: string | null
): Promise<void> {
  const supabase = createAdminClient()

  const { error } = await supabase
    .from('markup_rule_history')
    .insert({
      markup_rule_id: ruleId,
      change_type: changeType,
      previous_values: previousValues,
      new_values: newValues,
      changed_by: changedBy,
      change_reason: changeReason,
    })

  if (error) {
    console.error('Error recording rule change:', error)
  }
}

/**
 * Get rule change history
 */
export async function getRuleHistory(ruleId: string): Promise<Array<{
  id: string
  change_type: string
  previous_values: Partial<MarkupRule> | null
  new_values: Partial<MarkupRule> | null
  change_reason: string | null
  changed_at: string
  changed_by: string | null
}>> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('markup_rule_history')
    .select('*')
    .eq('markup_rule_id', ruleId)
    .order('changed_at', { ascending: false })

  if (error) {
    console.error('Error fetching rule history:', error)
    return []
  }

  return data || []
}
