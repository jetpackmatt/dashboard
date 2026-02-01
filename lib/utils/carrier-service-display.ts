/**
 * Carrier Service Display Name Mapping
 *
 * Maps raw carrier service names from ShipBob API to clean display names.
 * The raw names are often technical codes or include unnecessary prefixes.
 */

// Carrier-specific aliases (key format: "carrier:raw_name")
const CARRIER_SPECIFIC_ALIASES: Record<string, string> = {
  // Amazon Shipping
  'Amazon Shipping:Amazon Shipping Ground': 'Ground',

  // CirroECommerce (regional codes)
  'CirroECommerce:REGCE': 'Ground',
  'CirroECommerce:REGWE': 'Ground',
  'CirroECommerce:REGNJ': 'Ground',

  // DHL Express
  'DHLExpress:DHL api Express Worldwide': 'Express Worldwide',
  'DHLExpress:Express Worldwide': 'Express Worldwide',

  // DHL eCommerce
  'DhlEcs:DHLParcelExpedited': 'Parcel Expedited',
  'DhlEcs:DHLParcelGround': 'Parcel Ground',
  'DhlEcs:DHLParcelExpeditedMax': 'Parcel Expedited Max',
  'DhlEcs:PriorityDdu': 'Priority DDU',

  // FedEx
  'FedEx:2Day®': '2 Day',
  'FedEx:Priority Overnight®': 'Priority Overnight',
  'FedEx:Next Day Air Saver®': 'Next Day Air Saver',
  'FedEx:Smartpost®': 'SmartPost',
  'FedEx:SMART_POST': 'SmartPost',
  'FedEx:FEDEX_GROUND': 'Ground',

  // UPS
  'UPS:Next Day Air Saver®': 'Next Day Air Saver',

  // UPS Mail Innovations
  'UPSMailInnovations:Mail Innovations Parcel': 'Parcel',

  // Veho
  'Veho:Premium Economy': 'Economy',
}

// Generic aliases (apply regardless of carrier)
const GENERIC_ALIASES: Record<string, string> = {
  'Ground Advantage': 'Ground Advantage',
  'Ground': 'Ground',
  'Express Service': 'Express',
  'Ground Express': 'Ground Express',
  'Standard': 'Standard',
  'Next Day': 'Next Day',
  'Parcel': 'Parcel',
  'PrePaid': 'PrePaid',
}

/**
 * Get the display name for a carrier service
 *
 * @param rawName - The raw carrier service name from ShipBob API
 * @param carrier - Optional carrier name for carrier-specific aliases
 * @returns The clean display name
 */
export function getCarrierServiceDisplay(
  rawName: string | null | undefined,
  carrier?: string | null
): string {
  if (!rawName) return '-'

  // Try carrier-specific alias first
  if (carrier) {
    const carrierKey = `${carrier}:${rawName}`
    if (CARRIER_SPECIFIC_ALIASES[carrierKey]) {
      return CARRIER_SPECIFIC_ALIASES[carrierKey]
    }
  }

  // Try generic alias
  if (GENERIC_ALIASES[rawName]) {
    return GENERIC_ALIASES[rawName]
  }

  // Return raw name if no alias found
  return rawName
}

/**
 * Format carrier and service together for display
 * e.g., "USPS Ground Advantage" or "FedEx 2 Day"
 */
export function formatCarrierWithService(
  carrier: string | null | undefined,
  carrierService: string | null | undefined
): string {
  if (!carrier && !carrierService) return '-'
  if (!carrier) return getCarrierServiceDisplay(carrierService)
  if (!carrierService) return carrier

  const displayService = getCarrierServiceDisplay(carrierService, carrier)
  return `${carrier} ${displayService}`
}
