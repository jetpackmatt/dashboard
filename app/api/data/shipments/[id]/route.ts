import { createAdminClient, verifyClientAccess, handleAccessError } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

// Types for ShipBob Order API response
interface ShipBobStatusDetail {
  name: string
  description: string
  id: number
  inventory_id?: number
  exception_fulfillment_center_id?: number
}

interface ShipBobInventoryItem {
  id: number
  name: string
  quantity: number
  quantity_committed: number
}

interface ShipBobProduct {
  id: number
  reference_id: string
  name: string
  sku: string
  inventory_items: ShipBobInventoryItem[]
}

interface ShipBobShipment {
  id: number
  status: string
  status_details: ShipBobStatusDetail[]
  products: ShipBobProduct[]
  estimated_fulfillment_date_status: string
}

interface ShipBobOrderResponse {
  id: number
  shipments: ShipBobShipment[]
}

// Issue info structure for problematic shipments
interface IssueInfo {
  type: 'warning' | 'error'
  issueType: string
  description: string
  affectedItems?: Array<{ name: string; sku: string; quantity: number }>
}

// Map status_details.name to human-readable issue info
function mapStatusDetailToIssue(statusDetail: ShipBobStatusDetail): IssueInfo | null {
  const { name, description } = statusDetail

  switch (name) {
    case 'OutOfStock':
      return {
        type: 'warning',
        issueType: 'Out of Stock',
        description: 'Fulfillment Center is short of inventory required to fulfill this shipment.',
      }
    case 'InvalidAddress':
      return {
        type: 'error',
        issueType: 'Invalid Address',
        description: description || 'The shipping address could not be validated. Please update the address.',
      }
    case 'Manual':
      return {
        type: 'warning',
        issueType: 'Manual Hold',
        description: description || 'This shipment has been manually placed on hold.',
      }
    case 'PackagePreferenceNotSet':
      return {
        type: 'warning',
        issueType: 'Package Preference Not Set',
        description: description || 'No package preference has been set for this inventory.',
      }
    case 'AddressValidationFailed':
      return {
        type: 'error',
        issueType: 'Address Validation Failed',
        description: description || 'The address could not be validated by the carrier.',
      }
    case 'MissingDimensions':
      return {
        type: 'warning',
        issueType: 'Missing Dimensions',
        description: description || 'Product dimensions are missing and required for shipping.',
      }
    case 'MissingWeight':
      return {
        type: 'warning',
        issueType: 'Missing Weight',
        description: description || 'Product weight is missing and required for shipping.',
      }
    case 'FraudSuspected':
      return {
        type: 'error',
        issueType: 'Fraud Suspected',
        description: description || 'This order has been flagged for potential fraud.',
      }
    case 'PaymentFailed':
      return {
        type: 'error',
        issueType: 'Payment Failed',
        description: description || 'Payment for this order could not be processed.',
      }
    case 'LabelPurchaseFailed':
      return {
        type: 'error',
        issueType: 'Label Purchase Failed',
        description: description || 'Unable to purchase shipping label for this shipment.',
      }
    case 'InternationalDocumentsFailed':
      return {
        type: 'error',
        issueType: 'International Documents Failed',
        description: description || 'Required international shipping documents could not be generated.',
      }
    case 'ShippingMethodUnavailable':
      return {
        type: 'warning',
        issueType: 'Shipping Method Unavailable',
        description: description || 'The selected shipping method is not available for this destination.',
      }
    default:
      // For unknown status details, use the description if available
      if (description) {
        return {
          type: 'warning',
          issueType: name.replace(/([A-Z])/g, ' $1').trim(), // Convert camelCase to words
          description: description,
        }
      }
      return null
  }
}

// Fetch out-of-stock items from ShipBob Order API
async function fetchOutOfStockItems(
  supabase: ReturnType<typeof createAdminClient>,
  clientId: string,
  orderId: string,
  shipmentId: string
): Promise<Array<{ name: string; sku: string; quantity: number }>> {
  try {
    // Get client's API token
    const { data: creds } = await supabase
      .from('client_api_credentials')
      .select('api_token')
      .eq('client_id', clientId)
      .eq('provider', 'shipbob')
      .single()

    if (!creds?.api_token) {
      console.log(`[ShipmentDetail] No API token found for client ${clientId}`)
      return []
    }

    // Call ShipBob Order API
    const response = await fetch(`https://api.shipbob.com/1.0/order/${orderId}`, {
      headers: {
        'Authorization': `Bearer ${creds.api_token}`,
        'Accept': 'application/json'
      }
    })

    if (!response.ok) {
      console.error(`[ShipmentDetail] ShipBob API error: ${response.status}`)
      return []
    }

    const orderData: ShipBobOrderResponse = await response.json()

    // Find the specific shipment
    const shipment = orderData.shipments?.find(s => s.id.toString() === shipmentId)
    if (!shipment) {
      console.log(`[ShipmentDetail] Shipment ${shipmentId} not found in order ${orderId}`)
      return []
    }

    // Get inventory IDs from status_details where name is "OutOfStock"
    const outOfStockInventoryIds = new Set(
      shipment.status_details
        ?.filter(sd => sd.name === 'OutOfStock' && sd.inventory_id)
        .map(sd => sd.inventory_id) || []
    )

    if (outOfStockInventoryIds.size === 0) {
      console.log(`[ShipmentDetail] No OutOfStock status_details found`)
      return []
    }

    // Find products that match the out-of-stock inventory IDs
    const outOfStockItems: Array<{ name: string; sku: string; quantity: number }> = []

    for (const product of shipment.products || []) {
      for (const invItem of product.inventory_items || []) {
        if (outOfStockInventoryIds.has(invItem.id)) {
          outOfStockItems.push({
            name: invItem.name || product.name,
            sku: product.sku,
            quantity: invItem.quantity
          })
        }
      }
    }

    return outOfStockItems
  } catch (err) {
    console.error('[ShipmentDetail] Error fetching out-of-stock items:', err)
    return []
  }
}

// Get detailed shipment information by shipment_id
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = createAdminClient()
  const { id } = await params

  if (!id) {
    return NextResponse.json({ error: 'Shipment ID is required' }, { status: 400 })
  }

  try {
    // First, fetch just the client_id to verify access
    const { data: shipmentCheck, error: checkError } = await supabase
      .from('shipments')
      .select('client_id')
      .eq('shipment_id', id)
      .single()

    if (checkError) {
      if (checkError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Shipment not found' }, { status: 404 })
      }
      console.error('Error checking shipment:', checkError)
      return NextResponse.json({ error: checkError.message }, { status: 500 })
    }

    // CRITICAL SECURITY: Verify user has access to this shipment's client
    try {
      await verifyClientAccess(shipmentCheck.client_id)
    } catch (error) {
      return handleAccessError(error)
    }

    // Fetch the shipment with all details
    const { data: shipment, error: shipmentError } = await supabase
      .from('shipments')
      .select(`
        *,
        orders(
          id,
          shipbob_order_id,
          store_order_id,
          customer_name,
          customer_email,
          order_import_date,
          purchase_date,
          status,
          order_type,
          channel_id,
          channel_name,
          application_name,
          address1,
          address2,
          company_name,
          city,
          state,
          zip_code,
          country,
          total_shipments
        )
      `)
      .eq('shipment_id', id)
      .single()

    if (shipmentError) {
      if (shipmentError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Shipment not found' }, { status: 404 })
      }
      console.error('Error fetching shipment:', shipmentError)
      return NextResponse.json({ error: shipmentError.message }, { status: 500 })
    }

    // Fetch shipment items
    const { data: items } = await supabase
      .from('shipment_items')
      .select('*')
      .eq('shipment_id', id)

    // Fetch shipment cartons
    const { data: cartons } = await supabase
      .from('shipment_cartons')
      .select('*')
      .eq('shipment_id', id)

    // Fetch related transactions for this shipment (by tracking_id)
    // Include breakdown fields for charges display: base_charge, surcharge, total_charge, insurance_charge, taxes
    let transactions: any[] = []
    if (shipment.tracking_id) {
      const { data: txData } = await supabase
        .from('transactions')
        .select('id, transaction_id, cost, billed_amount, fee_type, transaction_type, charge_date, invoice_id_jp, base_charge, surcharge, total_charge, insurance_charge, markup_is_preview, taxes, taxes_charge')
        .eq('tracking_id', shipment.tracking_id)
        .order('charge_date', { ascending: false })

      transactions = txData || []
    }

    // Check for associated returns (by original_shipment_id)
    const { data: returns } = await supabase
      .from('returns')
      .select('id, shipbob_return_id, status, return_type, tracking_number, insert_date, arrived_date, completed_date')
      .eq('original_shipment_id', parseInt(id))

    // Fetch any associated care ticket (claim) for this shipment
    const { data: careTicket } = await supabase
      .from('care_tickets')
      .select('id, ticket_number, ticket_type, issue_type, status, credit_amount, currency, description, events, created_at, updated_at, resolved_at, reshipment_status, reshipment_id')
      .eq('shipment_id', id)
      .eq('ticket_type', 'Claim')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    // Build timeline from event_* columns, event_logs, and claim ticket events
    const timeline = buildTimeline(shipment, careTicket)

    // Calculate status
    const status = getShipmentStatus(
      shipment.status,
      shipment.estimated_fulfillment_date_status,
      shipment.status_details,
      shipment.event_labeled,
      shipment.event_delivered,
      shipment.event_picked,
      shipment.event_packed,
      shipment.event_intransit
    )

    // Check if refunded
    const isRefunded = transactions.some((tx: any) => tx.transaction_type === 'Refund')

    // Extract issue info from status_details (for OnHold, Exception, etc.)
    let issueInfo: IssueInfo | null = null
    let outOfStockItems: Array<{ name: string; sku: string; quantity: number }> = []

    // Check status_details for the actual issue type
    const statusDetails = shipment.status_details as ShipBobStatusDetail[] | null
    if (statusDetails && Array.isArray(statusDetails) && statusDetails.length > 0) {
      // Look for hold/exception status details (not tracking updates)
      const holdDetail = statusDetails.find(sd =>
        ['OutOfStock', 'InvalidAddress', 'Manual', 'PackagePreferenceNotSet',
         'AddressValidationFailed', 'MissingDimensions', 'MissingWeight',
         'FraudSuspected', 'PaymentFailed', 'LabelPurchaseFailed',
         'InternationalDocumentsFailed', 'ShippingMethodUnavailable'].includes(sd.name)
      )

      if (holdDetail) {
        issueInfo = mapStatusDetailToIssue(holdDetail)

        // Only fetch out-of-stock items from API when the issue is actually OutOfStock
        if (holdDetail.name === 'OutOfStock') {
          outOfStockItems = await fetchOutOfStockItems(
            supabase,
            shipment.client_id,
            shipment.shipbob_order_id,
            id
          )
          if (issueInfo) {
            issueInfo.affectedItems = outOfStockItems
          }
        }
      }
    }

    // Fall back to status-based issue detection for non-DB issues
    if (!issueInfo) {
      if (status === 'Exception') {
        issueInfo = {
          type: 'error',
          issueType: 'Exception',
          description: 'This shipment has encountered an exception that requires attention.',
        }
      } else if (status === 'Import Review') {
        issueInfo = {
          type: 'warning',
          issueType: 'Import Review',
          description: 'This order is under review and requires action before it can be processed.',
        }
      } else if (status === 'Delivery Attempted' || status === 'Delivery Failed') {
        issueInfo = {
          type: 'warning',
          issueType: 'Delivery Failed',
          description: 'The carrier attempted delivery but was unable to complete it.',
        }
      } else if (status === 'Cancelled') {
        issueInfo = {
          type: 'error',
          issueType: 'Cancelled',
          description: 'This shipment has been cancelled and will not be fulfilled.',
        }
      }
    }

    // Build response with all details
    const response = {
      // Basic shipment info
      id: shipment.id,
      shipmentId: shipment.shipment_id,
      status: isRefunded ? 'Refunded' : status,
      trackingId: shipment.tracking_id,
      trackingUrl: shipment.tracking_url,

      // Order info
      orderId: shipment.shipbob_order_id,
      storeOrderId: shipment.orders?.store_order_id,
      orderType: shipment.orders?.order_type || shipment.order_type || 'DTC',
      channelName: shipment.application_name || shipment.orders?.application_name || shipment.orders?.channel_name,
      orderDate: shipment.orders?.purchase_date,
      importDate: shipment.orders?.order_import_date,

      // Customer info
      customer: {
        name: shipment.recipient_name || shipment.orders?.customer_name,
        email: shipment.recipient_email || shipment.orders?.customer_email,
        company: shipment.orders?.company_name,
        address: {
          line1: shipment.orders?.address1,
          line2: shipment.orders?.address2,
          city: shipment.orders?.city,
          state: shipment.orders?.state,
          zipCode: shipment.orders?.zip_code,
          country: shipment.destination_country || shipment.orders?.country,
        },
      },

      // Shipping details
      shipping: {
        carrier: shipment.carrier,
        carrierService: shipment.carrier_service,
        shipOptionName: shipment.ship_option_name,
        shipOptionId: shipment.ship_option_id,
        zone: shipment.zone_used,
        fulfillmentCenter: shipment.fc_name,
        fcId: shipment.fc_id,
      },

      // Package details
      package: {
        actualWeightOz: shipment.actual_weight_oz,
        dimWeightOz: shipment.dim_weight_oz,
        billableWeightOz: shipment.billable_weight_oz,
        length: shipment.length,
        width: shipment.width,
        height: shipment.height,
      },

      // Timeline dates
      dates: {
        created: shipment.event_created,
        picked: shipment.event_picked,
        packed: shipment.event_packed,
        labeled: shipment.event_labeled,
        labelValidated: shipment.event_labelvalidated,
        inTransit: shipment.event_intransit,
        outForDelivery: shipment.event_outfordelivery,
        delivered: shipment.event_delivered,
        deliveryAttemptFailed: shipment.event_deliveryattemptfailed,
        estimatedFulfillment: shipment.estimated_fulfillment_date,
        estimatedFulfillmentStatus: shipment.estimated_fulfillment_date_status,
      },

      // Calculated metrics
      metrics: {
        transitTimeDays: shipment.transit_time_days,
        totalShipments: shipment.orders?.total_shipments || 1,
        ...calculateFulfillMetrics(
          shipment.orders?.order_import_date,
          shipment.event_labeled,
          shipment.fc_name,
          shipment.event_logs
        ),
      },

      // Timeline events (formatted for display)
      timeline,

      // Raw status details from carrier
      statusDetails: shipment.status_details,

      // Related items
      items: (items || []).map((item: any) => ({
        id: item.id,
        productId: item.shipbob_product_id,
        name: item.name,
        sku: item.sku,
        quantity: item.quantity,
        lotNumber: item.lot,  // Column is 'lot' not 'lot_number'
        expirationDate: item.expiration_date,
      })),

      // Out of stock items (from live ShipBob API) - kept for backward compatibility
      outOfStockItems,

      // Issue info (derived from status_details)
      issueInfo,

      // Cartons/boxes
      cartons: (cartons || []).map((carton: any) => ({
        id: carton.id,
        cartonId: carton.carton_id,
        trackingNumber: carton.tracking_number,
        weight: carton.weight,
        length: carton.length,
        width: carton.width,
        height: carton.height,
      })),

      // Billing transactions (with breakdown fields)
      transactions: transactions.map((tx: any) => ({
        id: tx.id,
        transactionId: tx.transaction_id,
        cost: tx.cost,
        billedAmount: tx.billed_amount,
        feeType: tx.fee_type,
        transactionType: tx.transaction_type,
        chargeDate: tx.charge_date,
        invoiceId: tx.invoice_id_jp,
        baseCharge: tx.base_charge,
        surcharge: tx.surcharge,
        totalCharge: tx.total_charge,
        insuranceCharge: tx.insurance_charge,
        isPreview: tx.markup_is_preview === true,
      })),

      // Charges breakdown for display (computed from transactions)
      // Structure: baseFulfillmentFees, surcharges, totalFulfillmentCost, pickFees, insurance, subtotal, taxes, total
      chargesBreakdown: (() => {
        // Find the Shipping transaction (non-refund) for fulfillment costs
        const shippingTx = transactions.find((tx: any) =>
          tx.fee_type === 'Shipping' && tx.transaction_type !== 'Refund'
        )

        // Sum all Per Pick Fee transactions (non-refund)
        const pickFeeTotal = transactions
          .filter((tx: any) => tx.fee_type === 'Per Pick Fee' && tx.transaction_type !== 'Refund')
          .reduce((sum: number, tx: any) => sum + (parseFloat(tx.billed_amount) || 0), 0)

        // Get individual breakdown fields from shipping transaction
        const baseCharge = shippingTx?.base_charge != null ? parseFloat(shippingTx.base_charge) : null
        const surcharge = shippingTx?.surcharge != null ? parseFloat(shippingTx.surcharge) : null
        const totalCharge = shippingTx?.total_charge != null ? parseFloat(shippingTx.total_charge) : null
        const insuranceCharge = shippingTx?.insurance_charge != null ? parseFloat(shippingTx.insurance_charge) : null

        // Calculate subtotal (sum of all non-null values)
        let subtotal: number | null = null
        const components = [totalCharge, pickFeeTotal > 0 ? pickFeeTotal : null, insuranceCharge]
        const validComponents = components.filter((v): v is number => v !== null && v !== undefined)
        if (validComponents.length > 0) {
          subtotal = validComponents.reduce((sum, v) => sum + v, 0)
        }

        // Sum taxes from all transactions
        // Use taxes_charge (marked-up taxes) if available, otherwise fall back to raw taxes
        let taxesTotal = 0
        for (const tx of transactions) {
          if (tx.transaction_type === 'Refund') continue
          // Prefer taxes_charge (marked-up amount) over raw taxes
          const taxArray = tx.taxes_charge || tx.taxes
          if (taxArray && Array.isArray(taxArray)) {
            for (const taxEntry of taxArray) {
              if (taxEntry.tax_amount) {
                taxesTotal += parseFloat(taxEntry.tax_amount) || 0
              }
            }
          }
        }
        const taxes = taxesTotal > 0 ? taxesTotal : null

        // Total = subtotal + taxes (or just subtotal if no taxes)
        const total = subtotal !== null ? subtotal + (taxes || 0) : null

        // Check if markup is preview (not yet invoiced)
        const isPreview = shippingTx?.markup_is_preview === true

        return {
          baseFulfillmentFees: baseCharge,
          surcharges: surcharge,
          totalFulfillmentCost: totalCharge,
          pickFees: pickFeeTotal > 0 ? pickFeeTotal : null,
          insurance: insuranceCharge,
          subtotal,
          taxes,
          total,
          isPreview,
        }
      })(),

      // Associated returns
      returns: (returns || []).map((ret: any) => ({
        id: ret.id,
        returnId: ret.shipbob_return_id,
        status: ret.status,
        returnType: ret.return_type,
        trackingNumber: ret.tracking_number,
        insertDate: ret.insert_date,
        arrivedDate: ret.arrived_date,
        completedDate: ret.completed_date,
      })),

      // Total billing
      billing: {
        totalCost: transactions.filter((tx: any) => tx.transaction_type !== 'Refund')
          .reduce((sum: number, tx: any) => sum + (parseFloat(tx.billed_amount) || 0), 0),
        totalRefunds: transactions.filter((tx: any) => tx.transaction_type === 'Refund')
          .reduce((sum: number, tx: any) => sum + Math.abs(parseFloat(tx.billed_amount) || 0), 0),
      },

      // Associated claim ticket info (if any)
      claimTicket: careTicket ? {
        id: careTicket.id,
        ticketNumber: careTicket.ticket_number,
        ticketType: careTicket.ticket_type,
        issueType: careTicket.issue_type,
        status: careTicket.status,
        creditAmount: careTicket.credit_amount,
        currency: careTicket.currency || 'USD',
        description: careTicket.description,
        createdAt: careTicket.created_at,
        updatedAt: careTicket.updated_at,
        resolvedAt: careTicket.resolved_at,
        reshipmentStatus: careTicket.reshipment_status,
        reshipmentId: careTicket.reshipment_id,
        // Extract jetpackInvoiceNumber from the Resolved event for View Invoice link
        jetpackInvoiceNumber: (careTicket.events as ClaimTicketEvent[] | null)
          ?.find(e => e.status === 'Resolved')?.jetpackInvoiceNumber || null,
      } : null,
    }

    return NextResponse.json(response)
  } catch (err) {
    console.error('Shipment detail API error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Map ShipBob log_type_id to event name and icon (matches sync.ts TIMELINE_EVENT_MAP)
const LOG_TYPE_MAP: Record<number, { name: string; icon: string }> = {
  601: { name: 'Order Created', icon: 'plus' },
  602: { name: 'Items Picked', icon: 'check' },
  603: { name: 'Items Packed', icon: 'box' },
  604: { name: 'Label Created', icon: 'tag' },
  605: { name: 'Label Validated', icon: 'check-circle' },
  607: { name: 'In Transit', icon: 'truck' },
  608: { name: 'Out for Delivery', icon: 'door-open' },
  609: { name: 'Delivered', icon: 'check-circle-2' },
  611: { name: 'Delivery Attempt Failed', icon: 'alert-circle' },
}

// Claim ticket event interface
interface ClaimTicketEvent {
  note: string
  status: string
  createdAt: string
  createdBy: string
  invoiceId?: number | null
  jetpackInvoiceNumber?: string | null
}

// Build timeline from event columns, event_logs, and claim ticket events
function buildTimeline(shipment: any, careTicket?: any): Array<{
  event: string
  timestamp: string
  description: string
  icon: string
  source?: 'shipment' | 'claim'
  claimStatus?: string
  invoiceId?: number | null
  jetpackInvoiceNumber?: string | null
}> {
  const timeline: Array<{ event: string; timestamp: string; description: string; icon: string; source?: 'shipment' | 'claim'; claimStatus?: string; invoiceId?: number | null; jetpackInvoiceNumber?: string | null }> = []

  // Map from database column to display name
  const eventColumnMap: Record<string, { name: string; icon: string }> = {
    event_created: { name: 'Order Created', icon: 'plus' },
    event_picked: { name: 'Items Picked', icon: 'check' },
    event_packed: { name: 'Items Packed', icon: 'box' },
    event_labeled: { name: 'Label Created', icon: 'tag' },
    event_labelvalidated: { name: 'Label Validated', icon: 'check-circle' },
    event_intransit: { name: 'In Transit', icon: 'truck' },
    event_outfordelivery: { name: 'Out for Delivery', icon: 'door-open' },
    event_delivered: { name: 'Delivered', icon: 'check-circle-2' },
    event_deliveryattemptfailed: { name: 'Delivery Attempt Failed', icon: 'alert-circle' },
  }

  // Events to hide from timeline (internal ShipBob processing noise)
  // These happen on almost every order and aren't meaningful to users
  // We keep the canonical events (601-609) and hide duplicates/internal events
  const HIDDEN_LOG_TYPE_IDS = new Set([
    // Internal processing (noise on every order)
    19,  // OrderPlacedStoreIntegration - "Order placed" (redundant with 601 Shipment Created)
    21,  // ShipOptionMappingResolved - "Resolved ship option mapping" (internal)
    13,  // OrderMovedToPending - "Order moved from Exception to Pending" (internal inventory allocation)
    78,  // OrderDimensionSource - "Order dimensions created" (internal)
    98,  // OrderSLAUpdated - "Order's SLA set" (internal)
    // Duplicate events (we have canonical versions)
    20,  // OrderTrackingUploaded - "Tracking details uploaded" (redundant with In Transit)
    35,  // LabelGeneratedLog - "Shipping label generated" (duplicate of 604 Label Created)
    70,  // OrderLabelValidated - "Label validated" (duplicate of 605 Label Validated)
    // Carrier/shipping events (too granular)
    106, // ShipmentSortedToCarrier - "Order has been sorted for carrier and is now awaiting pickup"
    107, // ShipmentPickedupByCarrier - "Order picked up by carrier" (redundant with In Transit)
    135, // OrderInTransitToShipBobSortCenter - "Order in transit to ShipBob sort center"
    612, // Shipped - "Order Shipped" (redundant with 607 In Transit)
  ])

  // Events to rename for clarity
  const EVENT_NAME_OVERRIDES: Record<number, string> = {
    132: 'Address Validated',  // AddressChangeDetail - ShipBob auto-validates/standardizes addresses
    603: 'Packed',             // Packed - ShipBob shows "Packaged", we prefer "Packed"
    613: 'Inventory Allocated', // Allocated - clearer than "Inventory was Allocated to the FC"
  }

  // First, build timeline from event_logs JSONB
  // ShipBob API returns: { log_type_id, log_type_name, log_type_text, timestamp, metadata }
  // Note: metadata is typically null - ShipBob doesn't include descriptions for standard events
  if (shipment.event_logs && Array.isArray(shipment.event_logs)) {
    for (const log of shipment.event_logs) {
      const ts = log.timestamp
      if (!ts) continue

      // Skip hidden events (internal ShipBob processing noise)
      if (HIDDEN_LOG_TYPE_IDS.has(log.log_type_id)) {
        continue
      }

      // Use override name if available, otherwise use log_type_text, mapped name, or log_type_name
      const logTypeConfig = LOG_TYPE_MAP[log.log_type_id]
      const eventName = EVENT_NAME_OVERRIDES[log.log_type_id]
        || log.log_type_text
        || logTypeConfig?.name
        || log.log_type_name
        || `Event ${log.log_type_id}`
      const eventIcon = logTypeConfig?.icon || 'circle'

      timeline.push({
        event: eventName,
        timestamp: ts,
        description: '', // ShipBob doesn't provide descriptions for timeline events
        icon: eventIcon,
      })
    }
  }

  // Always merge event_* columns to ensure tracking milestones are included
  // even if they weren't in event_logs (e.g., In Transit, Out for Delivery, Delivered)
  // These columns are populated by timeline sync and may have more recent data
  //
  // Build a set of keywords from existing events for smarter deduplication
  // e.g., "Items Picked" and "Picked" should be considered duplicates
  const existingEventKeywords = new Set<string>()
  for (const e of timeline) {
    const lower = e.event.toLowerCase()
    existingEventKeywords.add(lower)
    // Also add individual keywords for matching
    if (lower.includes('picked')) existingEventKeywords.add('picked')
    if (lower.includes('packed')) existingEventKeywords.add('packed')
    if (lower.includes('label')) existingEventKeywords.add('labeled')
    if (lower.includes('transit')) existingEventKeywords.add('in transit')
    if (lower.includes('delivery') && !lower.includes('attempt')) existingEventKeywords.add('out for delivery')
    if (lower.includes('delivered')) existingEventKeywords.add('delivered')
    if (lower.includes('created') && lower.includes('order')) existingEventKeywords.add('order created')
    if (lower.includes('validated')) existingEventKeywords.add('label validated')
  }

  for (const [key, config] of Object.entries(eventColumnMap)) {
    if (shipment[key]) {
      // Check if this event type (or a variant) is already in the timeline
      const configLower = config.name.toLowerCase()
      const isDuplicate = existingEventKeywords.has(configLower) ||
        (configLower.includes('picked') && existingEventKeywords.has('picked')) ||
        (configLower.includes('packed') && existingEventKeywords.has('packed')) ||
        (configLower.includes('label') && configLower.includes('created') && existingEventKeywords.has('labeled')) ||
        (configLower.includes('transit') && existingEventKeywords.has('in transit')) ||
        (configLower.includes('delivery') && existingEventKeywords.has('out for delivery')) ||
        (configLower.includes('delivered') && existingEventKeywords.has('delivered'))

      if (!isDuplicate) {
        timeline.push({
          event: config.name,
          timestamp: shipment[key],
          description: '',
          icon: config.icon,
        })
        existingEventKeywords.add(configLower)
      }
    }
  }

  // If status_details indicates a tracking status but we don't have the corresponding event,
  // add a synthetic event. This handles cases where ShipBob's /timeline endpoint
  // didn't return the event but the carrier status is known.
  if (shipment.status_details && Array.isArray(shipment.status_details) && shipment.status_details.length > 0) {
    const statusName = shipment.status_details[0]?.name

    // Map status_details names to events we might need to synthesize
    const statusToEvent: Record<string, { eventKey: string; name: string; icon: string }> = {
      'InTransit': { eventKey: 'event_intransit', name: 'In Transit', icon: 'truck' },
      'OutForDelivery': { eventKey: 'event_outfordelivery', name: 'Out for Delivery', icon: 'door-open' },
      'Delivered': { eventKey: 'event_delivered', name: 'Delivered', icon: 'check-circle-2' },
    }

    const eventConfig = statusToEvent[statusName]
    if (eventConfig && !shipment[eventConfig.eventKey]) {
      // We have a status but no timestamp - check if this event is already in timeline
      const eventLower = eventConfig.name.toLowerCase()
      const hasEvent = existingEventKeywords.has(eventLower) ||
        (eventLower.includes('transit') && existingEventKeywords.has('in transit')) ||
        (eventLower.includes('delivery') && existingEventKeywords.has('out for delivery')) ||
        (eventLower.includes('delivered') && existingEventKeywords.has('delivered'))

      if (!hasEvent) {
        // Use the timeline_checked_at as a rough timestamp, or fall back to labeled date
        // This gives users visibility that the package reached this status
        const syntheticTimestamp = shipment.timeline_checked_at || shipment.event_labeled
        if (syntheticTimestamp) {
          timeline.push({
            event: eventConfig.name,
            timestamp: syntheticTimestamp,
            description: 'Status confirmed by carrier',
            icon: eventConfig.icon,
          })
          existingEventKeywords.add(eventLower)
        }
      }
    }
  }

  // Merge claim ticket events if a care ticket exists
  if (careTicket?.events && Array.isArray(careTicket.events)) {
    // Map claim status to display name and icon
    const claimStatusConfig: Record<string, { displayName: string; icon: string }> = {
      'Input Required': { displayName: 'Claim Filed', icon: 'file-text' },
      'Under Review': { displayName: 'Claim Under Review', icon: 'search' },
      'Credit Requested': { displayName: 'Credit Requested', icon: 'clock' },
      'Credit Approved': { displayName: 'Credit Approved', icon: 'check-circle' },
      'Credit Denied': { displayName: 'Credit Denied', icon: 'x-circle' },
      'Resolved': { displayName: 'Claim Resolved', icon: 'check-circle-2' },
    }

    for (const claimEvent of careTicket.events as ClaimTicketEvent[]) {
      if (!claimEvent.createdAt) continue

      const config = claimStatusConfig[claimEvent.status] || {
        displayName: claimEvent.status,
        icon: 'circle'
      }

      timeline.push({
        event: config.displayName,
        timestamp: claimEvent.createdAt,
        description: claimEvent.note || '',
        icon: config.icon,
        source: 'claim',
        claimStatus: claimEvent.status,
        invoiceId: claimEvent.invoiceId || null,
        jetpackInvoiceNumber: claimEvent.jetpackInvoiceNumber || null,
      })
    }
  }

  // Sort by timestamp (most recent first)
  timeline.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  return timeline
}

// Extract shipment status (same logic as main shipments route)
function getShipmentStatus(
  status?: string,
  efdStatus?: string,
  statusDetails?: any[],
  shippedDate?: string | null,
  deliveredDate?: string | null,
  eventPicked?: string | null,
  eventPacked?: string | null,
  eventInTransit?: string | null
): string {
  if (deliveredDate) {
    return 'Delivered'
  }

  // Check status_details FIRST for tracking updates (InTransit, OutForDelivery, etc.)
  // These are more authoritative than event timestamps for carrier tracking status
  if (statusDetails && Array.isArray(statusDetails) && statusDetails.length > 0) {
    const statusName = statusDetails[0]?.name
    if (statusName) {
      // Tracking updates take priority
      switch (statusName) {
        case 'Delivered': return 'Delivered'
        case 'OutForDelivery': return 'Out for Delivery'
        case 'InTransit': return 'In Transit'
        case 'DeliveryException': return 'Exception'
        case 'DeliveryAttemptFailed': return 'Delivery Attempted'
      }
    }
  }

  // Also check event_intransit timestamp - if we have it, we're in transit
  if (eventInTransit) {
    return 'In Transit'
  }

  // Check event timestamps for fulfillment progress (most specific first)
  // These are more reliable than the raw status field for in-progress shipments
  if (shippedDate) {
    return 'Awaiting Carrier'
  }
  if (eventPacked) {
    return 'Packed'
  }
  if (eventPicked) {
    return 'Picked'
  }

  // Check status_details for hold reasons (tracking statuses already handled above)
  if (statusDetails && Array.isArray(statusDetails) && statusDetails.length > 0) {
    const statusName = statusDetails[0]?.name
    const statusDescription = statusDetails[0]?.description

    if (statusName) {
      // Hold reasons - these indicate a blocked shipment
      switch (statusName) {
        case 'OutOfStock': return 'Out of Stock'
        case 'InvalidAddress': return 'Invalid Address'
        case 'AddressValidationFailed': return 'Invalid Address'
        case 'Manual': return 'On Hold'
        case 'PackagePreferenceNotSet': return 'On Hold'
        case 'MissingDimensions': return 'On Hold'
        case 'MissingWeight': return 'On Hold'
        case 'FraudSuspected': return 'On Hold'
        case 'PaymentFailed': return 'On Hold'
        case 'LabelPurchaseFailed': return 'On Hold'
        case 'InternationalDocumentsFailed': return 'On Hold'
        case 'ShippingMethodUnavailable': return 'On Hold'
        // Fulfillment progress
        case 'AwaitingCarrierScan': return 'Awaiting Carrier'
        case 'Picked': return 'Picked'
        case 'Packed': return 'Packed'
        case 'PickInProgress': return 'Pick In-Progress'
        case 'Processing':
          if (statusDescription?.includes('Waiting For Carrier') || statusDescription?.includes('Carrier Pickup')) {
            return 'Awaiting Carrier'
          }
          break
      }
    }
  }

  // Handle OnHold status explicitly
  if (status === 'OnHold') {
    return 'On Hold'
  }

  if (status) {
    switch (status) {
      case 'Completed': return 'Awaiting Carrier'
      case 'LabeledCreated': return 'Labelled'
      case 'Cancelled': return 'Cancelled'
      case 'Exception':
        return efdStatus === 'AwaitingInventoryAllocation' ? 'Out of Stock' : 'Exception'
      case 'Packed': return 'Packed'
      case 'Picked': return 'Picked'
      case 'PickInProgress': return 'Pick In-Progress'
      case 'ImportReview': return 'Import Review'
      case 'AwaitingCarrierScan': return 'Awaiting Carrier'
      case 'Processing':
        return efdStatus === 'AwaitingInventoryAllocation' ? 'Out of Stock' : 'Awaiting Pick'
    }
  }

  if (shippedDate) {
    return 'Awaiting Carrier'
  }

  if (efdStatus) {
    switch (efdStatus) {
      case 'FulfilledOnTime':
      case 'FulfilledLate':
        return shippedDate ? 'Awaiting Carrier' : 'Pending'
      case 'AwaitingInventoryAllocation': return 'Out of Stock'
      case 'PendingOnTime':
      case 'PendingLate': return 'Awaiting Pick'
      case 'Unavailable': return 'Unavailable'
      default: return efdStatus
    }
  }

  return status || 'Pending'
}

/**
 * Calculate fulfillment metrics: fulfill time and SLA compliance
 *
 * SLA Rule: If order imported before 2pm warehouse local time,
 * it should ship before midnight that same day.
 *
 * Special case: If there's an "Inventory was Allocated to the FC" event in the timeline,
 * we use that timestamp as the start time instead of order_import_date. This handles
 * cases where inventory was out of stock and the order had to wait for replenishment.
 */
function calculateFulfillMetrics(
  orderImportDate: string | null | undefined,
  eventLabeled: string | null | undefined,
  fcName: string | null | undefined,
  eventLogs: Array<{ log_type_text?: string; timestamp?: string }> | null | undefined
): { fulfillTimeDays: number | null; fulfillTimeHours: number | null; metSla: boolean | null } {
  if (!eventLabeled) {
    return { fulfillTimeDays: null, fulfillTimeHours: null, metSla: null }
  }

  // Check for "Inventory was Allocated to the FC" event in the timeline
  // If found, use that as the start time instead of order import date
  let startDate: Date | null = null

  if (eventLogs && Array.isArray(eventLogs)) {
    const inventoryAllocatedEvent = eventLogs.find(log =>
      log.log_type_text?.toLowerCase().includes('inventory was allocated')
    )
    if (inventoryAllocatedEvent?.timestamp) {
      startDate = new Date(inventoryAllocatedEvent.timestamp)
    }
  }

  // Fall back to order import date if no inventory allocation event
  if (!startDate && orderImportDate) {
    startDate = new Date(orderImportDate)
  }

  // If we still don't have a start date, we can't calculate
  if (!startDate) {
    return { fulfillTimeDays: null, fulfillTimeHours: null, metSla: null }
  }

  const labeledDate = new Date(eventLabeled)

  // Calculate fulfill time in days and hours
  const fulfillTimeMs = labeledDate.getTime() - startDate.getTime()
  const fulfillTimeDays = Math.round((fulfillTimeMs / (1000 * 60 * 60 * 24)) * 10) / 10
  const fulfillTimeHours = Math.round((fulfillTimeMs / (1000 * 60 * 60)) * 10) / 10

  // Get timezone for the fulfillment center
  const fcTimezone = getFcTimezone(fcName)

  // Check SLA: order imported before 2pm local time should ship by midnight
  // Use Intl.DateTimeFormat to extract local time components without string-parsing issues
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: fcTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })

  // Get start time components in FC local time
  const startParts = formatter.formatToParts(startDate)
  const startYear = parseInt(startParts.find(p => p.type === 'year')?.value || '2025')
  const startMonth = parseInt(startParts.find(p => p.type === 'month')?.value || '1')
  const startDay = parseInt(startParts.find(p => p.type === 'day')?.value || '1')
  const startHour = parseInt(startParts.find(p => p.type === 'hour')?.value || '0')

  // Get labeled time components in FC local time
  const labeledParts = formatter.formatToParts(labeledDate)
  const labeledYear = parseInt(labeledParts.find(p => p.type === 'year')?.value || '2025')
  const labeledMonth = parseInt(labeledParts.find(p => p.type === 'month')?.value || '1')
  const labeledDay = parseInt(labeledParts.find(p => p.type === 'day')?.value || '1')
  const labeledHour = parseInt(labeledParts.find(p => p.type === 'hour')?.value || '0')
  const labeledMinute = parseInt(labeledParts.find(p => p.type === 'minute')?.value || '0')

  // Calculate SLA deadline: if before 2pm, same day midnight; if after 2pm, next day midnight
  const slaCutoffHour = 14 // 2pm
  let deadlineYear = startYear
  let deadlineMonth = startMonth
  let deadlineDay = startDay

  if (startHour >= slaCutoffHour) {
    // Started after 2pm - deadline is next day
    // Create a date object to handle month/year rollover
    const tempDate = new Date(startYear, startMonth - 1, startDay + 1)
    deadlineYear = tempDate.getFullYear()
    deadlineMonth = tempDate.getMonth() + 1
    deadlineDay = tempDate.getDate()
  }

  // Compare: labeled must be on or before deadline day (at any time during that day)
  // Convert to comparable integers: YYYYMMDD format
  const labeledDateInt = labeledYear * 10000 + labeledMonth * 100 + labeledDay
  const deadlineDateInt = deadlineYear * 10000 + deadlineMonth * 100 + deadlineDay

  // Met SLA if labeled on deadline day or earlier
  const metSla = labeledDateInt <= deadlineDateInt

  return { fulfillTimeDays, fulfillTimeHours, metSla }
}

/**
 * Map fulfillment center name to timezone
 */
function getFcTimezone(fcName: string | null | undefined): string {
  if (!fcName) return 'America/Chicago' // Default to Central

  const fcLower = fcName.toLowerCase()

  // IMPORTANT: Check Canadian FCs FIRST because "Brampton (Ontario)" contains "ontario"
  // which would otherwise match the California "Ontario" FC
  // Canada - Eastern Time
  if (fcLower.includes('brampton')) {
    return 'America/Toronto'
  }

  // California FCs - Pacific Time
  // Note: "Ontario" here refers to Ontario, California (not Ontario, Canada)
  if (fcLower.includes('riverside') || fcLower.includes('ontario')) {
    return 'America/Los_Angeles'
  }

  // Pennsylvania, New Jersey - Eastern Time
  if (fcLower.includes('wind gap') || fcLower.includes('trenton')) {
    return 'America/New_York'
  }

  // Wisconsin, Illinois - Central Time
  if (fcLower.includes('twin lakes') || fcLower.includes('elwood')) {
    return 'America/Chicago'
  }

  // Default to Central Time
  return 'America/Chicago'
}
