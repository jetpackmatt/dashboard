/**
 * eShipper API Client
 *
 * Reference: https://ww2.eshipper.com/swagger-ui/index.html
 *
 * TODO: Implement actual API calls once endpoints are explored.
 * This is a skeleton ready for implementation.
 */

interface EshipperShipment {
  id: string
  trackingNumber: string
  createdAt: string
  status: string
}

interface EshipperApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

export class EshipperClient {
  private apiKey: string
  private baseUrl: string

  constructor(apiKey: string, baseUrl?: string) {
    this.apiKey = apiKey
    this.baseUrl = baseUrl || process.env.ESHIPPER_API_URL || 'https://ww2.eshipper.com'
  }

  /**
   * Get headers for API requests
   */
  private getHeaders(): Record<string, string> {
    // TODO: Verify authentication method from Swagger docs
    // Could be Bearer token, API key header, or basic auth
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
    }
  }

  /**
   * List shipments for a company within a date range
   *
   * TODO: Implement based on actual eShipper API endpoint
   */
  async listShipments(
    companyId: string,
    startDate: Date,
    endDate: Date
  ): Promise<EshipperApiResponse<EshipperShipment[]>> {
    try {
      // TODO: Determine the correct endpoint from Swagger docs
      // Possible endpoints:
      // - /api/shipments?companyId=X&startDate=Y&endDate=Z
      // - /api/v2/shipments/list
      // - /api/orders (if shipments are represented as orders)

      const params = new URLSearchParams({
        companyId,
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
      })

      const response = await fetch(
        `${this.baseUrl}/api/shipments?${params}`,
        {
          method: 'GET',
          headers: this.getHeaders(),
        }
      )

      if (!response.ok) {
        throw new Error(`eShipper API error: ${response.status}`)
      }

      const data = await response.json()

      // TODO: Map response to EshipperShipment[] format
      return {
        success: true,
        data: data.shipments || [],
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Get shipment count for a company on a specific date
   *
   * This may need to list shipments and count them, or use a stats endpoint
   * if one is available.
   */
  async getShipmentCount(
    companyId: string,
    date: Date
  ): Promise<EshipperApiResponse<number>> {
    const result = await this.listShipments(companyId, date, date)

    if (!result.success) {
      return { success: false, error: result.error }
    }

    return {
      success: true,
      data: result.data?.length || 0,
    }
  }

  /**
   * Health check / connection test
   */
  async testConnection(): Promise<boolean> {
    try {
      // TODO: Find a lightweight endpoint to test connectivity
      const response = await fetch(`${this.baseUrl}/api/health`, {
        method: 'GET',
        headers: this.getHeaders(),
      })
      return response.ok
    } catch {
      return false
    }
  }
}

/**
 * Get a configured eShipper client instance
 */
export function getEshipperClient(): EshipperClient | null {
  const apiKey = process.env.ESHIPPER_API_KEY
  if (!apiKey) {
    console.warn('ESHIPPER_API_KEY not configured')
    return null
  }
  return new EshipperClient(apiKey)
}
