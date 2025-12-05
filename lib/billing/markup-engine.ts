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
}

export type BillingCategory =
  | 'shipments'
  | 'shipment_fees'
  | 'storage'
  | 'credits'
  | 'returns'
  | 'receiving'

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
 * - ship_option_id specified: +1
 * - weight bracket specified: +1
 * - client-specific (vs global): +1 (always takes precedence)
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
  context: TransactionContext
): MarkupRule | null {
  const matching = rules.filter(rule => ruleMatchesContext(rule, context))

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
    // Get the date range for this client's transactions
    const dates = clientTxs.map(tx => tx.context.transactionDate)
    const minDate = new Date(Math.min(...dates.map(d => d.getTime())))

    // Fetch rules once for this client
    const rules = await fetchMarkupRules(clientId, minDate)

    // Calculate markup for each transaction
    for (const tx of clientTxs) {
      const matchingRule = findMatchingRule(rules, tx.context)
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
