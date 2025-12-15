#!/usr/bin/env node
/**
 * Delete all draft invoices and reset invoice numbers
 */
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  // Get all draft invoices
  const { data: drafts } = await supabase
    .from('invoices_jetpack')
    .select('id, invoice_number, client_id')
    .eq('status', 'draft')

  console.log('Draft invoices to delete:', drafts?.length || 0)
  for (const d of drafts || []) {
    console.log('  -', d.invoice_number)
  }

  if (!drafts || drafts.length === 0) {
    console.log('No drafts to delete')
    return
  }

  // Delete all drafts
  const { error: delError } = await supabase
    .from('invoices_jetpack')
    .delete()
    .eq('status', 'draft')

  if (delError) {
    console.error('Delete error:', delError)
    return
  }

  console.log('\nDeleted all draft invoices')

  // Reset invoice numbers for affected clients
  const clientIds = [...new Set(drafts.map(d => d.client_id))]
  for (const clientId of clientIds) {
    // Get the client's current next_invoice_number
    const { data: client } = await supabase
      .from('clients')
      .select('company_name, next_invoice_number')
      .eq('id', clientId)
      .single()

    if (client) {
      // Decrement by 1
      const newNum = client.next_invoice_number - 1
      await supabase
        .from('clients')
        .update({ next_invoice_number: newNum })
        .eq('id', clientId)
      console.log('Reset', client.company_name, 'invoice number to', newNum)
    }
  }

  console.log('\nReady to regenerate!')
}

main().catch(console.error)
