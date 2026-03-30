/**
 * Shared formatting utilities.
 *
 * Consolidates duplicate formatCurrency / formatDate implementations
 * that were independently defined across 8+ files.
 */

/**
 * Format a number as USD currency: "$1,234.56"
 * Handles negatives correctly: -5 → "-$5.00" (not "$-5.00")
 */
export function formatCurrency(amount: number): string {
  const abs = Math.abs(amount)
  const formatted = `$${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  return amount < 0 ? `-${formatted}` : formatted
}
