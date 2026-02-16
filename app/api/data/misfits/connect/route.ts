import {
  createAdminClient,
  verifyClientAccess,
  handleAccessError,
  isCareAdminRole,
} from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/data/misfits/connect
 *
 * Connect a misfit transaction to a shipment, care ticket, or brand.
 * Supports smart cascade:
 * - connect_shipment: validates shipment, auto-sets brand + finds matching care ticket
 * - connect_ticket: links to ticket, auto-sets brand + shipment from ticket
 * - set_brand: simple brand attribution
 *
 * Admin and Care Admin only.
 */
export async function POST(request: NextRequest) {
  try {
    const access = await verifyClientAccess(null)
    if (!access.isAdmin && !isCareAdminRole(access.userRole)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }
  } catch (error) {
    return handleAccessError(error)
  }

  const supabase = createAdminClient()

  try {
    const body = await request.json()
    const { transactionId, action, shipmentId, careTicketId, clientId } = body

    if (!transactionId || !action) {
      return NextResponse.json({ error: 'transactionId and action are required' }, { status: 400 })
    }

    // Verify the transaction exists
    const { data: tx, error: txError } = await supabase
      .from('transactions')
      .select('id, transaction_id, client_id, reference_id, reference_type, care_ticket_id, fee_type, cost, charge_date, invoice_id_jp')
      .eq('transaction_id', transactionId)
      .single()

    if (txError || !tx) {
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
    }

    const result = { brand: false, shipment: false, ticket: false }

    if (action === 'connect_shipment') {
      if (!shipmentId) {
        return NextResponse.json({ error: 'shipmentId is required' }, { status: 400 })
      }

      // Look up shipment
      const { data: shipment, error: shipErr } = await supabase
        .from('shipments')
        .select('shipment_id, client_id')
        .eq('shipment_id', shipmentId.trim())
        .single()

      if (shipErr || !shipment) {
        return NextResponse.json({ error: `Shipment ${shipmentId} not found` }, { status: 404 })
      }

      // Build update object — never overwrite non-null with null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const update: Record<string, any> = {
        reference_id: shipment.shipment_id,
        reference_type: 'Shipment',
      }
      result.shipment = true

      // Auto-set brand from shipment
      if (shipment.client_id && !tx.client_id) {
        update.client_id = shipment.client_id
        result.brand = true
      } else if (shipment.client_id && tx.client_id) {
        // Already has a brand — still counts
        result.brand = true
      }

      // Auto-find matching care ticket
      const { data: matchingTicket } = await supabase
        .from('care_tickets')
        .select('id')
        .eq('shipment_id', shipment.shipment_id)
        .is('deleted_at', null)
        .limit(1)
        .single()

      if (matchingTicket) {
        update.care_ticket_id = matchingTicket.id
        result.ticket = true
      }

      const { error: updateError } = await supabase
        .from('transactions')
        .update(update)
        .eq('transaction_id', transactionId)

      if (updateError) {
        console.error('Error connecting shipment:', updateError)
        return NextResponse.json({ error: 'Failed to update transaction' }, { status: 500 })
      }

    } else if (action === 'connect_ticket') {
      if (!careTicketId) {
        return NextResponse.json({ error: 'careTicketId is required' }, { status: 400 })
      }

      // Look up care ticket
      const { data: ticket, error: ticketErr } = await supabase
        .from('care_tickets')
        .select('id, client_id, shipment_id')
        .eq('id', careTicketId)
        .is('deleted_at', null)
        .single()

      if (ticketErr || !ticket) {
        return NextResponse.json({ error: 'Care ticket not found' }, { status: 404 })
      }

      // Build update — never overwrite non-null with null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const update: Record<string, any> = {
        care_ticket_id: ticket.id,
      }
      result.ticket = true

      // Auto-set brand from ticket
      if (ticket.client_id && !tx.client_id) {
        update.client_id = ticket.client_id
        result.brand = true
      } else if (tx.client_id) {
        result.brand = true
      }

      // Auto-set shipment from ticket (if transaction has no valid shipment link)
      if (ticket.shipment_id && (!tx.reference_id || tx.reference_type === 'Default')) {
        update.reference_id = ticket.shipment_id
        update.reference_type = 'Shipment'
        result.shipment = true
      } else if (tx.reference_id && tx.reference_type === 'Shipment') {
        result.shipment = true
      }

      const { error: updateError } = await supabase
        .from('transactions')
        .update(update)
        .eq('transaction_id', transactionId)

      if (updateError) {
        console.error('Error connecting ticket:', updateError)
        return NextResponse.json({ error: 'Failed to update transaction' }, { status: 500 })
      }

    } else if (action === 'set_brand') {
      if (!clientId) {
        return NextResponse.json({ error: 'clientId is required' }, { status: 400 })
      }

      // Verify client exists
      const { data: client, error: clientErr } = await supabase
        .from('clients')
        .select('id, merchant_id')
        .eq('id', clientId)
        .single()

      if (clientErr || !client) {
        return NextResponse.json({ error: 'Client not found' }, { status: 404 })
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const update: Record<string, any> = { client_id: client.id }
      if (client.merchant_id) {
        update.merchant_id = client.merchant_id
      }
      result.brand = true

      const { error: updateError } = await supabase
        .from('transactions')
        .update(update)
        .eq('transaction_id', transactionId)

      if (updateError) {
        console.error('Error setting brand:', updateError)
        return NextResponse.json({ error: 'Failed to update transaction' }, { status: 500 })
      }

    } else if (action === 'create_ticket') {
      // Create a new care ticket from this credit and link it
      if (tx.care_ticket_id) {
        return NextResponse.json({ error: 'Transaction already linked to a ticket' }, { status: 400 })
      }

      // Get authenticated user for created_by
      const authSupabase = await createClient()
      const { data: { user } } = await authSupabase.auth.getUser()
      const userName = user?.user_metadata?.full_name || user?.email || 'System'

      const creditAmount = Math.abs(parseFloat(tx.cost) || 0)
      const { shipmentId: newShipmentId, description } = body

      // Determine shipment ID: from input, or from transaction reference
      const ticketShipmentId = newShipmentId?.trim() ||
        (tx.reference_id && tx.reference_type === 'Shipment' ? tx.reference_id : null)

      // Backdate ticket to the credit's charge_date so it orders correctly in Care
      const creditDate = tx.charge_date || new Date().toISOString()

      // Check if this credit is already on a Jetpack invoice → should be Resolved
      let invoiceDate: string | null = null
      if (tx.invoice_id_jp) {
        const { data: invoice } = await supabase
          .from('invoices_jetpack')
          .select('invoice_date')
          .eq('invoice_number', tx.invoice_id_jp)
          .single()
        invoiceDate = invoice?.invoice_date || null
      }
      const isAlreadyInvoiced = !!invoiceDate

      // Build events timeline (newest first)
      const events: Array<{ status: string; note: string; createdAt: string; createdBy: string }> = []

      if (isAlreadyInvoiced) {
        events.push({
          status: 'Resolved',
          note: `Credit already invoiced on ${tx.invoice_id_jp}. Auto-resolved.`,
          createdAt: `${invoiceDate}T00:00:00.000Z`,
          createdBy: 'System',
        })
      }

      events.push({
        status: 'Credit Approved',
        note: 'Ticket created from unlinked ShipBob credit.',
        createdAt: creditDate.includes('T') ? creditDate : `${creditDate}T00:00:00.000Z`,
        createdBy: userName,
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ticketData: Record<string, any> = {
        ticket_type: 'Claim',
        issue_type: 'Credit',
        status: isAlreadyInvoiced ? 'Resolved' : 'Credit Approved',
        credit_amount: creditAmount,
        currency: 'USD',
        description: description?.trim() || null,
        shipment_id: ticketShipmentId || null,
        created_by: user?.id || null,
        created_at: creditDate.includes('T') ? creditDate : `${creditDate}T00:00:00.000Z`,
        events,
      }

      if (isAlreadyInvoiced) {
        ticketData.resolved_at = `${invoiceDate}T00:00:00.000Z`
      }

      // Set client from transaction
      if (tx.client_id) {
        ticketData.client_id = tx.client_id
      }

      const { data: newTicket, error: ticketCreateErr } = await supabase
        .from('care_tickets')
        .insert(ticketData)
        .select('id, ticket_number')
        .single()

      if (ticketCreateErr || !newTicket) {
        console.error('Error creating ticket:', ticketCreateErr)
        return NextResponse.json({ error: 'Failed to create ticket' }, { status: 500 })
      }

      // Link the transaction to the new ticket
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const txUpdate: Record<string, any> = { care_ticket_id: newTicket.id }

      // Also set shipment reference if we have one and transaction doesn't
      if (ticketShipmentId && (!tx.reference_id || tx.reference_type === 'Default')) {
        txUpdate.reference_id = ticketShipmentId
        txUpdate.reference_type = 'Shipment'
      }

      await supabase.from('transactions').update(txUpdate).eq('transaction_id', transactionId)

      result.ticket = true
      result.brand = !!tx.client_id
      result.shipment = !!(tx.reference_id && tx.reference_type === 'Shipment') || !!ticketShipmentId

      return NextResponse.json({
        success: true,
        resolved: result,
        ticketNumber: newTicket.ticket_number,
        autoResolved: isAlreadyInvoiced,
      })

    } else {
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      resolved: result,
    })

  } catch (err) {
    console.error('Error in misfits connect route:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
