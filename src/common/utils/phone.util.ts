import { parsePhoneNumberWithError } from 'libphonenumber-js';

// Stores every phone in E.164 regardless of how it was typed — the mobile
// forms accept local Nigerian format ("0812 345 6789"), and a mix of
// formats would break equality lookups later. Callers validate first
// (@IsPhoneNumber), so a parse failure here is a programmer error.
export function toE164(phone: string, defaultCountry: 'NG' = 'NG'): string {
  return parsePhoneNumberWithError(phone, defaultCountry).format('E.164');
}
