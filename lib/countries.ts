// lib/countries.ts
// Full list of ISO 3166-1 alpha-2 countries with primary currency suggestion.
// Regions use full ISO 3166-2 codes where relevant for tax/accounting (CA, US, AU, etc.).

export interface Country {
  code: string
  name: string
  currency: string
}

export interface Region {
  code: string // full ISO 3166-2 e.g. "CA-ON", "US-CA"
  name: string
}

export const COUNTRIES: Country[] = [
  { code: 'CA', name: 'Canada', currency: 'CAD' },
  { code: 'US', name: 'United States', currency: 'USD' },
  { code: 'DE', name: 'Germany', currency: 'EUR' },
  { code: 'AT', name: 'Austria', currency: 'EUR' },
  { code: 'FR', name: 'France', currency: 'EUR' },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP' },
  { code: 'AU', name: 'Australia', currency: 'AUD' },
  { code: 'CH', name: 'Switzerland', currency: 'CHF' },
  { code: 'NL', name: 'Netherlands', currency: 'EUR' },
  { code: 'BE', name: 'Belgium', currency: 'EUR' },
  { code: 'IT', name: 'Italy', currency: 'EUR' },
  { code: 'ES', name: 'Spain', currency: 'EUR' },
  { code: 'SE', name: 'Sweden', currency: 'SEK' },
  { code: 'NO', name: 'Norway', currency: 'NOK' },
  { code: 'DK', name: 'Denmark', currency: 'DKK' },
  { code: 'FI', name: 'Finland', currency: 'EUR' },
  { code: 'JP', name: 'Japan', currency: 'JPY' },
  { code: 'CN', name: 'China', currency: 'CNY' },
  { code: 'IN', name: 'India', currency: 'INR' },
  { code: 'BR', name: 'Brazil', currency: 'BRL' },
  { code: 'MX', name: 'Mexico', currency: 'MXN' },
  { code: 'SG', name: 'Singapore', currency: 'SGD' },
  { code: 'HK', name: 'Hong Kong', currency: 'HKD' },
  { code: 'NZ', name: 'New Zealand', currency: 'NZD' },
  // add more as needed; this is already a solid starting set
]

export const REGIONS: Record<string, Region[]> = {
  CA: [
    { code: 'CA-ON', name: 'Ontario' },
    { code: 'CA-QC', name: 'Quebec' },
    { code: 'CA-BC', name: 'British Columbia' },
    { code: 'CA-AB', name: 'Alberta' },
    { code: 'CA-MB', name: 'Manitoba' },
    { code: 'CA-SK', name: 'Saskatchewan' },
    { code: 'CA-NS', name: 'Nova Scotia' },
    { code: 'CA-NB', name: 'New Brunswick' },
    { code: 'CA-NL', name: 'Newfoundland and Labrador' },
    { code: 'CA-PE', name: 'Prince Edward Island' },
    { code: 'CA-NT', name: 'Northwest Territories' },
    { code: 'CA-NU', name: 'Nunavut' },
    { code: 'CA-YT', name: 'Yukon' },
  ],
  US: [
    { code: 'US-AL', name: 'Alabama' },
    { code: 'US-AK', name: 'Alaska' },
    { code: 'US-AZ', name: 'Arizona' },
    { code: 'US-AR', name: 'Arkansas' },
    { code: 'US-CA', name: 'California' },
    { code: 'US-CO', name: 'Colorado' },
    { code: 'US-CT', name: 'Connecticut' },
    { code: 'US-DE', name: 'Delaware' },
    { code: 'US-FL', name: 'Florida' },
    { code: 'US-GA', name: 'Georgia' },
    { code: 'US-HI', name: 'Hawaii' },
    { code: 'US-ID', name: 'Idaho' },
    { code: 'US-IL', name: 'Illinois' },
    { code: 'US-IN', name: 'Indiana' },
    { code: 'US-IA', name: 'Iowa' },
    { code: 'US-KS', name: 'Kansas' },
    { code: 'US-KY', name: 'Kentucky' },
    { code: 'US-LA', name: 'Louisiana' },
    { code: 'US-ME', name: 'Maine' },
    { code: 'US-MD', name: 'Maryland' },
    { code: 'US-MA', name: 'Massachusetts' },
    { code: 'US-MI', name: 'Michigan' },
    { code: 'US-MN', name: 'Minnesota' },
    { code: 'US-MS', name: 'Mississippi' },
    { code: 'US-MO', name: 'Missouri' },
    { code: 'US-MT', name: 'Montana' },
    { code: 'US-NE', name: 'Nebraska' },
    { code: 'US-NV', name: 'Nevada' },
    { code: 'US-NH', name: 'New Hampshire' },
    { code: 'US-NJ', name: 'New Jersey' },
    { code: 'US-NM', name: 'New Mexico' },
    { code: 'US-NY', name: 'New York' },
    { code: 'US-NC', name: 'North Carolina' },
    { code: 'US-ND', name: 'North Dakota' },
    { code: 'US-OH', name: 'Ohio' },
    { code: 'US-OK', name: 'Oklahoma' },
    { code: 'US-OR', name: 'Oregon' },
    { code: 'US-PA', name: 'Pennsylvania' },
    { code: 'US-RI', name: 'Rhode Island' },
    { code: 'US-SC', name: 'South Carolina' },
    { code: 'US-SD', name: 'South Dakota' },
    { code: 'US-TN', name: 'Tennessee' },
    { code: 'US-TX', name: 'Texas' },
    { code: 'US-UT', name: 'Utah' },
    { code: 'US-VT', name: 'Vermont' },
    { code: 'US-VA', name: 'Virginia' },
    { code: 'US-WA', name: 'Washington' },
    { code: 'US-WV', name: 'West Virginia' },
    { code: 'US-WI', name: 'Wisconsin' },
    { code: 'US-WY', name: 'Wyoming' },
    { code: 'US-DC', name: 'District of Columbia' },
  ],
  AU: [
    { code: 'AU-NSW', name: 'New South Wales' },
    { code: 'AU-VIC', name: 'Victoria' },
    { code: 'AU-QLD', name: 'Queensland' },
    { code: 'AU-WA', name: 'Western Australia' },
    { code: 'AU-SA', name: 'South Australia' },
    { code: 'AU-TAS', name: 'Tasmania' },
    { code: 'AU-ACT', name: 'Australian Capital Territory' },
    { code: 'AU-NT', name: 'Northern Territory' },
  ],
}

// Helper to get suggested currency for a country code
export function getSuggestedCurrency(countryCode: string): string {
  const c = COUNTRIES.find(x => x.code === countryCode)
  return c?.currency || 'EUR'
}

// Helper to get regions for a country (empty array if none)
export function getRegionsForCountry(countryCode: string): Region[] {
  return REGIONS[countryCode] || []
}
