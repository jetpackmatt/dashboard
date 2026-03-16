// Country configuration for multi-country performance maps

export interface CountryConfig {
  code: string
  label: string
  regionLabel: string       // "State" or "Province"
  regionLabelPlural: string // "States" or "Provinces"
  geoUrl: string            // path to TopoJSON file
  projection: string        // 'geoAlbersUsa' or 'geoMercator'
  projectionConfig: Record<string, unknown>
  objectName: string        // TopoJSON object key
  nameToCode: Record<string, string>
  codeToName: Record<string, string>
}

// US state mappings
const US_NAME_TO_CODE: Record<string, string> = {
  'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR',
  'California': 'CA', 'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE',
  'Florida': 'FL', 'Georgia': 'GA', 'Hawaii': 'HI', 'Idaho': 'ID',
  'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA', 'Kansas': 'KS',
  'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
  'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS',
  'Missouri': 'MO', 'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH', 'Oklahoma': 'OK',
  'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT',
  'Vermont': 'VT', 'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV',
  'Wisconsin': 'WI', 'Wyoming': 'WY',
  'District of Columbia': 'DC',
}

const US_CODE_TO_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(US_NAME_TO_CODE).map(([name, code]) => [code, name])
)

// Canadian province mappings
const CA_NAME_TO_CODE: Record<string, string> = {
  'Alberta': 'AB',
  'British Columbia': 'BC',
  'Manitoba': 'MB',
  'New Brunswick': 'NB',
  'Newfoundland and Labrador': 'NL',
  'Northwest Territories': 'NT',
  'Nova Scotia': 'NS',
  'Nunavut': 'NU',
  'Ontario': 'ON',
  'Prince Edward Island': 'PE',
  'Quebec': 'QC',
  'Saskatchewan': 'SK',
  'Yukon': 'YT',
  // Alternate spellings from our data
  'Québec': 'QC',
  'Newfoundland': 'NL',
  'Labrador': 'NL',
  'Yukon Territory': 'YT',
}

const CA_CODE_TO_NAME: Record<string, string> = {
  'AB': 'Alberta',
  'BC': 'British Columbia',
  'MB': 'Manitoba',
  'NB': 'New Brunswick',
  'NL': 'Newfoundland and Labrador',
  'NT': 'Northwest Territories',
  'NS': 'Nova Scotia',
  'NU': 'Nunavut',
  'ON': 'Ontario',
  'PE': 'Prince Edward Island',
  'QC': 'Quebec',
  'SK': 'Saskatchewan',
  'YT': 'Yukon',
}

export const COUNTRY_CONFIGS: Record<string, CountryConfig> = {
  US: {
    code: 'US',
    label: 'United States',
    regionLabel: 'State',
    regionLabelPlural: 'States',
    geoUrl: '/us-states.json',
    projection: 'geoAlbersUsa',
    projectionConfig: { scale: 1000 },
    objectName: 'states',
    nameToCode: US_NAME_TO_CODE,
    codeToName: US_CODE_TO_NAME,
  },
  CA: {
    code: 'CA',
    label: 'Canada',
    regionLabel: 'Province',
    regionLabelPlural: 'Provinces',
    geoUrl: '/ca-provinces.json',
    projection: 'geoMercator',
    projectionConfig: { center: [-93, 58], scale: 550 },
    objectName: 'provinces',
    nameToCode: CA_NAME_TO_CODE,
    codeToName: CA_CODE_TO_NAME,
  },
}

// Northern territories that dominate the map when empty
export const CA_NORTHERN_TERRITORIES = ['YT', 'NT', 'NU']

// Projection config when northern territories are hidden (zoom into southern provinces)
export const CA_SOUTHERN_PROJECTION_CONFIG = { center: [-92, 50] as [number, number], scale: 550 }

/**
 * Normalize a region value (state/province) to its standard code.
 * Handles mixed formats in our data: "Ontario" → "ON", "ON" → "ON"
 */
export function normalizeRegionCode(value: string, countryCode: string): string {
  if (!value) return ''
  const trimmed = value.trim()
  const config = COUNTRY_CONFIGS[countryCode]
  if (!config) return trimmed

  // If it's already a valid code, return it
  if (config.codeToName[trimmed.toUpperCase()]) {
    return trimmed.toUpperCase()
  }

  // Try name-to-code lookup (case-insensitive)
  for (const [name, code] of Object.entries(config.nameToCode)) {
    if (name.toLowerCase() === trimmed.toLowerCase()) {
      return code
    }
  }

  // Return as-is (uppercase) if no match
  return trimmed.toUpperCase()
}

/**
 * Get full region name from code
 */
export function getRegionName(code: string, countryCode: string): string {
  const config = COUNTRY_CONFIGS[countryCode]
  return config?.codeToName[code] || code
}
