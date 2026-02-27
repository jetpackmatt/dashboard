/**
 * Static destination data for country/state filtering.
 * Used by the DestinationFilter component and API routes.
 */

// ISO 3166-1 alpha-2 country codes → display names
// Only includes countries likely to appear in shipping data
export const COUNTRY_NAMES: Record<string, string> = {
  US: 'United States',
  CA: 'Canada',
  AU: 'Australia',
  GB: 'United Kingdom',
  DE: 'Germany',
  NO: 'Norway',
  CH: 'Switzerland',
  SG: 'Singapore',
  NZ: 'New Zealand',
  NL: 'Netherlands',
  SE: 'Sweden',
  IS: 'Iceland',
  PH: 'Philippines',
  AE: 'United Arab Emirates',
  ZA: 'South Africa',
  HK: 'Hong Kong',
  TH: 'Thailand',
  SA: 'Saudi Arabia',
  IE: 'Ireland',
  DK: 'Denmark',
  FI: 'Finland',
  AT: 'Austria',
  BE: 'Belgium',
  FR: 'France',
  IT: 'Italy',
  ES: 'Spain',
  PT: 'Portugal',
  JP: 'Japan',
  KR: 'South Korea',
  IN: 'India',
  MX: 'Mexico',
  BR: 'Brazil',
  IL: 'Israel',
  MY: 'Malaysia',
  ID: 'Indonesia',
  TW: 'Taiwan',
  PL: 'Poland',
  CZ: 'Czech Republic',
  RO: 'Romania',
  GR: 'Greece',
  HR: 'Croatia',
  QA: 'Qatar',
  KW: 'Kuwait',
  BH: 'Bahrain',
  OM: 'Oman',
  CL: 'Chile',
  CO: 'Colombia',
  PR: 'Puerto Rico',
  VI: 'U.S. Virgin Islands',
  GU: 'Guam',
}

export interface StateEntry {
  code: string
  name: string
}

export const US_STATES: StateEntry[] = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DE', name: 'Delaware' },
  { code: 'DC', name: 'District of Columbia' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
]

export const CA_PROVINCES: StateEntry[] = [
  { code: 'AB', name: 'Alberta' },
  { code: 'BC', name: 'British Columbia' },
  { code: 'MB', name: 'Manitoba' },
  { code: 'NB', name: 'New Brunswick' },
  { code: 'NL', name: 'Newfoundland and Labrador' },
  { code: 'NS', name: 'Nova Scotia' },
  { code: 'NT', name: 'Northwest Territories' },
  { code: 'NU', name: 'Nunavut' },
  { code: 'ON', name: 'Ontario' },
  { code: 'PE', name: 'Prince Edward Island' },
  { code: 'QC', name: 'Quebec' },
  { code: 'SK', name: 'Saskatchewan' },
  { code: 'YT', name: 'Yukon' },
]

export const AU_STATES: StateEntry[] = [
  { code: 'ACT', name: 'Australian Capital Territory' },
  { code: 'NSW', name: 'New South Wales' },
  { code: 'NT', name: 'Northern Territory' },
  { code: 'QLD', name: 'Queensland' },
  { code: 'SA', name: 'South Australia' },
  { code: 'TAS', name: 'Tasmania' },
  { code: 'VIC', name: 'Victoria' },
  { code: 'WA', name: 'Western Australia' },
]

// Maps for countries that have hardcoded state lists
const STATE_MAPS: Record<string, StateEntry[]> = {
  US: US_STATES,
  CA: CA_PROVINCES,
  AU: AU_STATES,
}

/**
 * Get display name for a country code. Falls back to the code itself.
 */
export function getCountryName(code: string): string {
  return COUNTRY_NAMES[code] || code
}

/**
 * Get hardcoded states for a country, or null if not available.
 * For countries not in STATE_MAPS, states come from the data dynamically.
 */
export function getStatesForCountry(countryCode: string): StateEntry[] | null {
  return STATE_MAPS[countryCode] || null
}

/**
 * Get display label for a state entry.
 * US/CA/AU use "CODE - Name" format, others use full name.
 */
export function getStateLabel(countryCode: string, state: StateEntry): string {
  if (countryCode === 'US' || countryCode === 'CA' || countryCode === 'AU') {
    return `${state.code} - ${state.name}`
  }
  return state.name
}

/**
 * Parse a destination filter array into separate country-level and state-level entries.
 * Used by API routes to build queries.
 *
 * Example: ["AU", "US:CA", "US:TX"] →
 *   { countries: ["AU"], statesByCountry: { US: ["CA", "TX"] } }
 */
export function parseDestinationFilter(selected: string[]): {
  countries: string[]
  statesByCountry: Record<string, string[]>
} {
  const countries: string[] = []
  const statesByCountry: Record<string, string[]> = {}

  for (const entry of selected) {
    if (entry.includes(':')) {
      const [country, state] = entry.split(':')
      if (!statesByCountry[country]) {
        statesByCountry[country] = []
      }
      statesByCountry[country].push(state)
    } else {
      countries.push(entry)
    }
  }

  return { countries, statesByCountry }
}

/**
 * Build destination options from available countries and data-extracted states.
 * Merges hardcoded state lists (US/CA/AU) with dynamic states from data.
 */
export interface DestinationOption {
  countryCode: string
  countryName: string
  states?: StateEntry[]
}

export function buildDestinationOptions(
  availableCountries: string[],
  dataStates?: Record<string, string[]> // country → state codes from data
): DestinationOption[] {
  return availableCountries
    .sort((a, b) => {
      // US first, then alphabetical by name
      if (a === 'US') return -1
      if (b === 'US') return 1
      return getCountryName(a).localeCompare(getCountryName(b))
    })
    .map(code => {
      const option: DestinationOption = {
        countryCode: code,
        countryName: getCountryName(code),
      }

      // Use hardcoded states if available
      const hardcodedStates = getStatesForCountry(code)
      if (hardcodedStates) {
        option.states = hardcodedStates
      } else if (dataStates?.[code]?.length) {
        // Use data-extracted states for other countries
        option.states = dataStates[code]
          .sort()
          .map(s => ({ code: s, name: s }))
      }

      return option
    })
}
