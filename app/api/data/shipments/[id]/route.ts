import { createAdminClient } from '@/lib/supabase/admin'
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
    let transactions: any[] = []
    if (shipment.tracking_id) {
      const { data: txData } = await supabase
        .from('transactions')
        .select('id, transaction_id, cost, billed_amount, fee_type, transaction_type, charge_date, invoice_id_jp')
        .eq('tracking_id', shipment.tracking_id)
        .order('charge_date', { ascending: false })

      transactions = txData || []
    }

    // Check for associated returns (by original_shipment_id)
    const { data: returns } = await supabase
      .from('returns')
      .select('id, shipbob_return_id, status, return_type, tracking_number, insert_date, arrived_date, completed_date')
      .eq('original_shipment_id', parseInt(id))

    // Build timeline from event_* columns and event_logs
    const timeline = buildTimeline(shipment)

    // Calculate status
    const status = getShipmentStatus(
      shipment.status,
      shipment.estimated_fulfillment_date_status,
      shipment.status_details,
      shipment.event_labeled || shipment.event_intransit,
      shipment.event_delivered
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
      },

      // Timeline events (formatted for display)
      timeline,

      // Raw status details from carrier
      statusDetails: shipment.status_details,

      // Related items
      items: (items || []).map((item: any) => ({
        id: item.id,
        productId: item.product_id,
        name: item.name,
        sku: item.sku,
        quantity: item.quantity,
        lotNumber: item.lot_number,
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

      // Billing transactions
      transactions: transactions.map((tx: any) => ({
        id: tx.id,
        transactionId: tx.transaction_id,
        cost: tx.cost,
        billedAmount: tx.billed_amount,
        feeType: tx.fee_type,
        transactionType: tx.transaction_type,
        chargeDate: tx.charge_date,
        invoiceId: tx.invoice_id_jp,
      })),

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

// Build timeline from event columns and event_logs
function buildTimeline(shipment: any): Array<{
  event: string
  timestamp: string
  description: string
  icon: string
}> {
  const timeline: Array<{ event: string; timestamp: string; description: string; icon: string }> = []

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

  // First, build timeline from event_logs JSONB
  // ShipBob API returns: { log_type_id, log_type_name, log_type_text, timestamp, metadata }
  // Note: metadata is typically null - ShipBob doesn't include descriptions for standard events
  if (shipment.event_logs && Array.isArray(shipment.event_logs)) {
    for (const log of shipment.event_logs) {
      const ts = log.timestamp
      if (!ts) continue

      // Use log_type_text for display (e.g., "Label Created"), fall back to mapped name or log_type_name
      const logTypeConfig = LOG_TYPE_MAP[log.log_type_id]
      const eventName = log.log_type_text || logTypeConfig?.name || log.log_type_name || `Event ${log.log_type_id}`
      const eventIcon = logTypeConfig?.icon || 'circle'

      timeline.push({
        event: eventName,
        timestamp: ts,
        description: '', // ShipBob doesn't provide descriptions for timeline events
        icon: eventIcon,
      })
    }
  }

  // If no event_logs, fall back to event_* columns (timestamps only, no descriptions)
  if (timeline.length === 0) {
    for (const [key, config] of Object.entries(eventColumnMap)) {
      if (shipment[key]) {
        timeline.push({
          event: config.name,
          timestamp: shipment[key],
          description: '',
          icon: config.icon,
        })
      }
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
  deliveredDate?: string | null
): string {
  if (deliveredDate) {
    return 'Delivered'
  }

  // Check status_details for hold reasons or tracking updates
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
        // Tracking updates
        case 'Delivered': return 'Delivered'
        case 'OutForDelivery': return 'Out for Delivery'
        case 'InTransit': return 'In Transit'
        case 'AwaitingCarrierScan': return 'Awaiting Carrier'
        case 'DeliveryException': return 'Exception'
        case 'DeliveryAttemptFailed': return 'Delivery Attempted'
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
