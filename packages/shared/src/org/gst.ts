/** GSTIN checks that work offline. A GST API provider (CLAUDE.md §12) can add the legal name on top. */
const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const FORMAT = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export const GST_STATE_CODES: Record<string, string> = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
  '99': 'Centre Jurisdiction',
};

export const INDIAN_STATES = [...new Set(Object.values(GST_STATE_CODES))]
  .filter((s) => s !== 'Other Territory' && s !== 'Centre Jurisdiction')
  .sort();

export function gstinCheckDigit(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = CHARS.indexOf(first14[i]!) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36]!;
}

export type GstinCheck =
  | { valid: true; gstin: string; pan: string; stateCode: string; stateName: string }
  | { valid: false; gstin: string; reason: 'format' | 'state' | 'checksum' };

export function checkGstin(input: string): GstinCheck {
  const gstin = input.trim().toUpperCase();
  if (!FORMAT.test(gstin)) return { valid: false, gstin, reason: 'format' };
  const stateCode = gstin.slice(0, 2);
  const stateName = GST_STATE_CODES[stateCode];
  if (!stateName) return { valid: false, gstin, reason: 'state' };
  if (gstinCheckDigit(gstin.slice(0, 14)) !== gstin[14]) return { valid: false, gstin, reason: 'checksum' };
  return { valid: true, gstin, pan: gstin.slice(2, 12), stateCode, stateName };
}
