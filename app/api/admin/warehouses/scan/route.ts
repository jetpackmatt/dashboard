/**
 * Admin API to scan transactions for new fulfillment centers
 * POST - Scans all transactions (with proper pagination) and adds any new FCs
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { detectFCLocation } from '@/lib/fulfillment-centers'

export async function POST() {
  // Verify admin access
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()

  if (!user || user.user_metadata?.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const startTime = Date.now()

  // Get all existing FC names
  const { data: existingFCs } = await supabase
    .from('fulfillment_centers')
    .select('name')

  const existingNames = new Set(existingFCs?.map((fc: { name: string }) => fc.name) || [])
  console.log(`[Warehouses Scan] Found ${existingNames.size} existing FCs`)

  // Scan transactions for unique FC names using cursor-based pagination
  // (Supabase returns max 1000 rows per query)
  const allFCNames = new Set<string>()
  const pageSize = 1000
  let lastId: string | null = null
  let pagesScanned = 0
  let rowsScanned = 0

  while (true) {
    let query = supabase
      .from('transactions')
      .select('transaction_id, fulfillment_center')
      .not('fulfillment_center', 'is', null)
      .order('transaction_id', { ascending: true })
      .limit(pageSize)

    if (lastId) {
      query = query.gt('transaction_id', lastId)
    }

    const { data: page, error } = await query

    if (error) {
      console.error('[Warehouses Scan] Error fetching transactions:', error)
      return NextResponse.json({ error: 'Failed to scan transactions' }, { status: 500 })
    }

    if (!page || page.length === 0) break

    page.forEach((tx: { transaction_id: string; fulfillment_center: string | null }) => {
      if (tx.fulfillment_center) {
        allFCNames.add(tx.fulfillment_center)
      }
    })

    lastId = page[page.length - 1].transaction_id
    pagesScanned++
    rowsScanned += page.length

    if (page.length < pageSize) break
  }

  console.log(`[Warehouses Scan] Scanned ${rowsScanned} transactions across ${pagesScanned} pages, found ${allFCNames.size} unique FC names`)

  // Find NEW FCs that aren't in the database yet
  const newFCNames = [...allFCNames].filter(name => !existingNames.has(name))

  if (newFCNames.length === 0) {
    return NextResponse.json({
      message: 'No new fulfillment centers found',
      scanned: rowsScanned,
      existingCount: existingNames.size,
      newCount: 0,
      added: [],
      duration: Date.now() - startTime,
    })
  }

  // Build records for new FCs using auto-detection
  const newRecords = newFCNames.map(name => {
    const location = detectFCLocation(name)
    return {
      name,
      country: location.country,
      state_province: location.stateProvince,
      tax_rate: location.taxRate,
      tax_type: location.taxType,
      auto_detected: true,
    }
  })

  // Insert new FCs
  const { error: insertError } = await supabase
    .from('fulfillment_centers')
    .insert(newRecords)

  if (insertError) {
    console.error('[Warehouses Scan] Error inserting new FCs:', insertError)
    return NextResponse.json({ error: 'Failed to add new fulfillment centers' }, { status: 500 })
  }

  console.log(`[Warehouses Scan] Added ${newRecords.length} new FCs:`, newFCNames)

  return NextResponse.json({
    message: `Added ${newRecords.length} new fulfillment center(s)`,
    scanned: rowsScanned,
    existingCount: existingNames.size,
    newCount: newRecords.length,
    added: newRecords.map(r => ({
      name: r.name,
      country: r.country,
      state_province: r.state_province,
      tax_rate: r.tax_rate,
      tax_type: r.tax_type,
    })),
    duration: Date.now() - startTime,
  })
}
