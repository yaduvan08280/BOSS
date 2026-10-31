/** Mobiles are stored as E.164. Indian 10-digit numbers get +91. Returns null if it doesn't look like a phone. */
export function normalizeMobile(input: string, defaultCountry = '91'): string | null {
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `+${defaultCountry}${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `+${defaultCountry}${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith(defaultCountry)) return `+${digits}`;
  return null;
}

export function looksLikeEmail(input: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.trim());
}
