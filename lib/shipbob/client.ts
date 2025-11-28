/**
 * ShipBob API Client
 *
 * A minimal client for interacting with ShipBob's API.
 * Supports both the 2025-07 Billing API and the standard Orders/Shipments API.
 *
 * NOTE: API uses snake_case for all field names
 *
 * Usage:
 *   const client = new ShipBobClient()
 *   const invoices = await client.billing.getInvoices()
 */

// ============================================================================
// Types for 2025-07 Billing API (snake_case)
// ============================================================================

export interface ShipBobInvoice {
  invoice_id: number
  invoice_date: string // YYYY-MM-DD format
  invoice_type: string // "Credits", "ReturnsFee", "FulfillmentFee", etc.
  amount: number
  currency_code: string
  running_balance: number
}

export interface ShipBobTransaction {
  transaction_id: string
  amount: number
  currency_code: string
  charge_date: string // YYYY-MM-DD format
  invoiced_status: boolean
  invoice_date: string | null
  invoice_id: number | null
  invoice_type: string | null
  transaction_fee: string // "Shipping", "Per Pick Fee", "Warehousing Fee", etc.
  reference_id: string // Shipment ID or Order ID depending on reference_type
  reference_type: string // "Shipment", "Order", etc.
  transaction_type: string // "Charge", "Refund", "Credit"
  fulfillment_center: string // "Ontario 6 (CA)", etc.
  taxes: Array<{
    tax_type?: string
    amount?: number
  }>
  additional_details: {
    TrackingId?: string
    Comment?: string
    [key: string]: unknown
  }
}

export interface ShipBobFeeTypesResponse {
  fee_list: string[]
}

// ============================================================================
// Types for 1.0 Orders API (also snake_case in responses)
// ============================================================================

export interface ShipBobOrder {
  id: number
  reference_id: string
  order_number: string
  status: string
  created_date: string
  shipments?: ShipBobOrderShipment[]
}

export interface ShipBobOrderShipment {
  id: number
  order_id: number
  tracking_number?: string
  carrier?: string
  shipping_method?: string
  status: string
  created_date: string
  estimated_delivery_date?: string
  actual_delivery_date?: string
  measurements?: {
    total_weight_oz?: number
    length_in?: number
    width_in?: number
    height_in?: number
  }
}

// ============================================================================
// Query Parameters and Response Types
// ============================================================================

export interface TransactionQueryParams {
  reference_ids?: string[]
  invoice_ids?: number[]
  transaction_types?: string[]
  start_date?: string
  end_date?: string
  cursor?: string  // For pagination (NOTE: cursor pagination has bugs in ShipBob API)
  page_size?: number  // Max 1000, default 100
}

export interface CursorPaginatedResponse<T> {
  items: T[]
  next?: string // Cursor for next page
  last?: string // Cursor for last page
}

// ============================================================================
// Error Handling
// ============================================================================

class ShipBobAPIError extends Error {
  constructor(
    message: string,
    public status: number,
    public response?: unknown
  ) {
    super(message)
    this.name = 'ShipBobAPIError'
  }
}

// ============================================================================
// Client Implementation
// ============================================================================

export class ShipBobClient {
  private token: string
  private baseUrl: string

  constructor(token?: string, baseUrl?: string) {
    this.token = token || process.env.SHIPBOB_API_TOKEN || ''
    this.baseUrl = baseUrl || process.env.SHIPBOB_API_BASE_URL || 'https://api.shipbob.com'

    if (!this.token) {
      throw new Error('ShipBob API token is required. Set SHIPBOB_API_TOKEN env var.')
    }
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    apiVersion: string = '1.0'
  ): Promise<T> {
    const url = `${this.baseUrl}/${apiVersion}${endpoint}`

    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...options.headers,
      },
    })

    if (!response.ok) {
      let errorBody: unknown
      try {
        errorBody = await response.json()
      } catch {
        errorBody = await response.text()
      }
      throw new ShipBobAPIError(
        `ShipBob API error: ${response.status} ${response.statusText}`,
        response.status,
        errorBody
      )
    }

    // Handle empty responses
    const text = await response.text()
    if (!text) {
      return {} as T
    }

    return JSON.parse(text) as T
  }

  /**
   * Billing API (2025-07 version)
   * All endpoints use snake_case field names
   */
  billing = {
    /**
     * Get paginated list of invoices
     * Uses cursor-based pagination (next/last cursors)
     */
    getInvoices: async (params?: {
      startDate?: string
      endDate?: string
      pageSize?: number
      cursor?: string // Use 'next' from previous response
    }): Promise<CursorPaginatedResponse<ShipBobInvoice>> => {
      const searchParams = new URLSearchParams()
      if (params?.startDate) searchParams.set('startDate', params.startDate)
      if (params?.endDate) searchParams.set('endDate', params.endDate)
      if (params?.pageSize) searchParams.set('pageSize', params.pageSize.toString())
      if (params?.cursor) searchParams.set('cursor', params.cursor)

      const query = searchParams.toString()
      const endpoint = `/invoices${query ? `?${query}` : ''}`

      return this.request<CursorPaginatedResponse<ShipBobInvoice>>(endpoint, {}, '2025-07')
    },

    /**
     * Get transactions for a specific invoice (with pagination)
     * Returns all transactions by automatically following cursor pagination
     */
    getTransactionsByInvoice: async (invoiceId: number): Promise<ShipBobTransaction[]> => {
      const allTransactions: ShipBobTransaction[] = []
      const seenIds = new Set<string>()
      let cursor: string | undefined

      do {
        const params = new URLSearchParams({ pageSize: '1000' })
        if (cursor) params.set('cursor', cursor)

        const endpoint = `/invoices/${invoiceId}/transactions?${params.toString()}`
        const response = await this.request<CursorPaginatedResponse<ShipBobTransaction>>(
          endpoint,
          {},
          '2025-07'
        )

        // Handle both array and paginated response formats
        const items = Array.isArray(response) ? response : (response.items || [])

        let newCount = 0
        for (const tx of items) {
          if (!seenIds.has(tx.transaction_id)) {
            seenIds.add(tx.transaction_id)
            allTransactions.push(tx)
            newCount++
          }
        }

        // Stop if no new items (duplicates mean pagination is broken)
        if (newCount === 0) break

        // Get next cursor
        cursor = Array.isArray(response) ? undefined : response.next
      } while (cursor)

      return allTransactions
    },

    /**
     * Query transactions with filters (supports batch lookups!)
     *
     * Key filters:
     * - reference_ids: Array of shipment/order IDs for batch lookup
     * - start_date/end_date: Date range filter
     * - transaction_types: ["Charge", "Refund", "Credit"]
     *
     * Returns shipment cost data including:
     * - transaction_fee: Type of fee ("Shipping", "Per Pick Fee", etc.)
     * - reference_id: Shipment ID
     * - additional_details.TrackingId: Tracking number
     */
    queryTransactions: async (
      params: TransactionQueryParams
    ): Promise<CursorPaginatedResponse<ShipBobTransaction>> => {
      return this.request<CursorPaginatedResponse<ShipBobTransaction>>(
        '/transactions:query',
        {
          method: 'POST',
          body: JSON.stringify(params),
        },
        '2025-07'
      )
    },

    /**
     * Get all available fee types
     * Returns a simple list of fee type names
     */
    getFeeTypes: async (): Promise<string[]> => {
      const response = await this.request<ShipBobFeeTypesResponse>(
        '/transaction-fees',
        {},
        '2025-07'
      )
      return response.fee_list || []
    },
  }

  /**
   * Orders API (standard 1.0 version)
   *
   * NOTE: The shipments endpoint is not available in the current API.
   * Shipment data is available through:
   * 1. Orders with embedded shipments
   * 2. Transaction queries (reference_type: "Shipment")
   */
  orders = {
    /**
     * Get a specific order by ID
     */
    getOrder: async (orderId: number): Promise<ShipBobOrder> => {
      return this.request<ShipBobOrder>(`/order/${orderId}`)
    },

    /**
     * Search orders
     */
    searchOrders: async (params?: {
      startDate?: string
      endDate?: string
      status?: string
      page?: number
      limit?: number
    }): Promise<ShipBobOrder[]> => {
      const searchParams = new URLSearchParams()
      if (params?.startDate) searchParams.set('StartDate', params.startDate)
      if (params?.endDate) searchParams.set('EndDate', params.endDate)
      if (params?.status) searchParams.set('Status', params.status)
      if (params?.page) searchParams.set('Page', params.page.toString())
      if (params?.limit) searchParams.set('Limit', params.limit.toString())

      const query = searchParams.toString()
      return this.request<ShipBobOrder[]>(`/order${query ? `?${query}` : ''}`)
    },
  }

  /**
   * Webhooks API (2025-07 version)
   * Manage webhook subscriptions for real-time status updates
   */
  webhooks = {
    /**
     * Get all webhook subscriptions
     */
    getAll: async (): Promise<WebhookSubscription[]> => {
      return this.request<WebhookSubscription[]>('/webhook', {}, '2025-07')
    },

    /**
     * Create a new webhook subscription
     */
    create: async (params: CreateWebhookParams): Promise<WebhookSubscription> => {
      return this.request<WebhookSubscription>(
        '/webhook',
        { method: 'POST', body: JSON.stringify(params) },
        '2025-07'
      )
    },

    /**
     * Delete a webhook subscription
     */
    delete: async (webhookId: number): Promise<void> => {
      await this.request<void>(
        `/webhook/${webhookId}`,
        { method: 'DELETE' },
        '2025-07'
      )
    },

    /**
     * Get webhooks for a specific URL
     */
    getByUrl: async (url: string): Promise<WebhookSubscription[]> => {
      const all = await this.webhooks.getAll()
      return all.filter(wh => wh.url === url)
    },

    /**
     * Register all webhook topics for a URL (idempotent)
     * Returns the subscription if created, null if already exists
     */
    registerAll: async (
      webhookUrl: string,
      description?: string
    ): Promise<{ created: boolean; subscription?: WebhookSubscription }> => {
      // Check if already registered
      const existing = await this.webhooks.getByUrl(webhookUrl)
      if (existing.length > 0) {
        return { created: false, subscription: existing[0] }
      }

      // Create new subscription with all topics
      const subscription = await this.webhooks.create({
        url: webhookUrl,
        topics: [...WEBHOOK_TOPICS],
        description,
      })

      return { created: true, subscription }
    },

    /**
     * Delete all webhooks for a specific URL
     */
    deleteByUrl: async (url: string): Promise<number> => {
      const webhooks = await this.webhooks.getByUrl(url)
      let deleted = 0

      for (const wh of webhooks) {
        await this.webhooks.delete(wh.id)
        deleted++
      }

      return deleted
    },
  }

  /**
   * Test connection to ShipBob API
   * Returns basic account info if successful
   */
  async testConnection(): Promise<{ success: boolean; message: string; data?: unknown }> {
    try {
      // Try to fetch a small amount of data to verify connection
      const orders = await this.orders.searchOrders({ limit: 1 })
      return {
        success: true,
        message: 'Successfully connected to ShipBob API',
        data: { orderCount: orders.length },
      }
    } catch (error) {
      if (error instanceof ShipBobAPIError) {
        return {
          success: false,
          message: `API Error: ${error.message}`,
          data: error.response,
        }
      }
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }
}

// ============================================================================
// Webhook Types and Constants (2025-07 API)
// ============================================================================

// All available webhook topics (2025-07 API)
export const WEBHOOK_TOPICS = [
  // Order/Shipment topics
  'order.shipped',
  'order.shipment.delivered',
  'order.shipment.exception',
  'order.shipment.on_hold',
  'order.shipment.cancelled',
  // Return topics
  'return.created',
  'return.updated',
  'return.completed',
] as const

export type WebhookTopic = typeof WEBHOOK_TOPICS[number]

export interface WebhookSubscription {
  id: number
  url: string
  topics: string[]
  description?: string
  secret?: string
  created_at: string
}

export interface CreateWebhookParams {
  url: string
  topics: WebhookTopic[]
  description?: string
  secret?: string
}

/**
 * Get the webhook URL for the current environment
 */
export function getWebhookUrl(): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://dashboard.jetpack.com'
  return `${baseUrl}/api/webhooks/shipbob`
}

// Default export for convenience
export default ShipBobClient
