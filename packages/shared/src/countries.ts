export interface CountryDef {
  code: string;
  name: string;
  currency: string;
  region: 'north_america' | 'europe' | 'africa' | 'asia' | 'latam' | 'oceania' | 'middle_east';
  /** Tier-1 markets typically get the highest partner payouts. */
  tier1?: boolean;
}

export const COUNTRIES: CountryDef[] = [
  { code: 'US', name: 'United States', currency: 'USD', region: 'north_america', tier1: true },
  { code: 'CA', name: 'Canada', currency: 'CAD', region: 'north_america', tier1: true },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP', region: 'europe', tier1: true },
  { code: 'IE', name: 'Ireland', currency: 'EUR', region: 'europe', tier1: true },
  { code: 'DE', name: 'Germany', currency: 'EUR', region: 'europe', tier1: true },
  { code: 'FR', name: 'France', currency: 'EUR', region: 'europe', tier1: true },
  { code: 'NL', name: 'Netherlands', currency: 'EUR', region: 'europe', tier1: true },
  { code: 'ES', name: 'Spain', currency: 'EUR', region: 'europe' },
  { code: 'IT', name: 'Italy', currency: 'EUR', region: 'europe' },
  { code: 'PL', name: 'Poland', currency: 'PLN', region: 'europe' },
  { code: 'AU', name: 'Australia', currency: 'AUD', region: 'oceania', tier1: true },
  { code: 'NZ', name: 'New Zealand', currency: 'NZD', region: 'oceania', tier1: true },
  { code: 'NG', name: 'Nigeria', currency: 'NGN', region: 'africa' },
  { code: 'GH', name: 'Ghana', currency: 'GHS', region: 'africa' },
  { code: 'KE', name: 'Kenya', currency: 'KES', region: 'africa' },
  { code: 'ZA', name: 'South Africa', currency: 'ZAR', region: 'africa' },
  { code: 'UG', name: 'Uganda', currency: 'UGX', region: 'africa' },
  { code: 'TZ', name: 'Tanzania', currency: 'TZS', region: 'africa' },
  { code: 'EG', name: 'Egypt', currency: 'EGP', region: 'middle_east' },
  { code: 'AE', name: 'United Arab Emirates', currency: 'AED', region: 'middle_east' },
  { code: 'IN', name: 'India', currency: 'INR', region: 'asia' },
  { code: 'PK', name: 'Pakistan', currency: 'PKR', region: 'asia' },
  { code: 'BD', name: 'Bangladesh', currency: 'BDT', region: 'asia' },
  { code: 'PH', name: 'Philippines', currency: 'PHP', region: 'asia' },
  { code: 'ID', name: 'Indonesia', currency: 'IDR', region: 'asia' },
  { code: 'VN', name: 'Vietnam', currency: 'VND', region: 'asia' },
  { code: 'BR', name: 'Brazil', currency: 'BRL', region: 'latam' },
  { code: 'MX', name: 'Mexico', currency: 'MXN', region: 'latam' },
  { code: 'AR', name: 'Argentina', currency: 'ARS', region: 'latam' },
  { code: 'CO', name: 'Colombia', currency: 'COP', region: 'latam' },
];

export const COUNTRY_BY_CODE: Record<string, CountryDef> = Object.fromEntries(COUNTRIES.map((c) => [c.code, c]));

export function countryName(code: string | null | undefined): string {
  if (!code) return 'Unknown';
  return COUNTRY_BY_CODE[code]?.name ?? code;
}

/** 🇳🇬 from "NG" */
export function flagEmoji(code: string | null | undefined): string {
  if (!code || code.length !== 2) return '🌍';
  return String.fromCodePoint(...code.toUpperCase().split('').map((c) => 127397 + c.charCodeAt(0)));
}

/** Best-effort country from an IANA timezone (used to pre-fill sign-up; the user can change it). */
export const TIMEZONE_COUNTRY: Record<string, string> = {
  'America/New_York': 'US', 'America/Chicago': 'US', 'America/Denver': 'US', 'America/Los_Angeles': 'US',
  'America/Phoenix': 'US', 'America/Anchorage': 'US', 'Pacific/Honolulu': 'US', 'America/Detroit': 'US',
  'America/Toronto': 'CA', 'America/Vancouver': 'CA', 'America/Edmonton': 'CA', 'America/Winnipeg': 'CA', 'America/Halifax': 'CA',
  'Europe/London': 'GB', 'Europe/Dublin': 'IE', 'Europe/Berlin': 'DE', 'Europe/Paris': 'FR', 'Europe/Amsterdam': 'NL',
  'Europe/Madrid': 'ES', 'Europe/Rome': 'IT', 'Europe/Warsaw': 'PL',
  'Australia/Sydney': 'AU', 'Australia/Melbourne': 'AU', 'Australia/Brisbane': 'AU', 'Australia/Perth': 'AU', 'Australia/Adelaide': 'AU',
  'Pacific/Auckland': 'NZ',
  'Africa/Lagos': 'NG', 'Africa/Accra': 'GH', 'Africa/Nairobi': 'KE', 'Africa/Johannesburg': 'ZA', 'Africa/Kampala': 'UG',
  'Africa/Dar_es_Salaam': 'TZ', 'Africa/Cairo': 'EG', 'Asia/Dubai': 'AE',
  'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN', 'Asia/Karachi': 'PK', 'Asia/Dhaka': 'BD', 'Asia/Manila': 'PH',
  'Asia/Jakarta': 'ID', 'Asia/Ho_Chi_Minh': 'VN', 'Asia/Saigon': 'VN',
  'America/Sao_Paulo': 'BR', 'America/Mexico_City': 'MX', 'America/Argentina/Buenos_Aires': 'AR', 'America/Bogota': 'CO',
};

export function guessCountryFromTimezone(tz: string | undefined | null): string | null {
  if (!tz) return null;
  return TIMEZONE_COUNTRY[tz] ?? null;
}
