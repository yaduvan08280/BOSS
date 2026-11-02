import { checkGstin } from '@mono/shared';

export type GstLookup = { legalName: string | null; tradeName: string | null; status: string | null };

/** Pluggable GST lookup (CLAUDE.md §12). Add real providers here; `none` only checks the checksum. */
export interface GstProvider {
  name: string;
  lookup(gstin: string): Promise<GstLookup | null>;
}

const providers: Record<string, (key: string) => GstProvider> = {
  // Deterministic fake for tests and demos; never use in production.
  mock: () => ({
    name: 'mock',
    lookup: async (gstin) => ({
      legalName: `Registered Business ${gstin.slice(2, 7)} Pvt Ltd`,
      tradeName: null,
      status: 'Active',
    }),
  }),
};

export function gstProvider(name: string, key: string): GstProvider | null {
  const make = providers[name];
  return make ? make(key) : null;
}

export async function verifyGstin(input: string, provider: GstProvider | null) {
  const check = checkGstin(input);
  if (!check.valid) return { ...check, legalName: null, provider: null };
  const found = provider ? await provider.lookup(check.gstin).catch(() => null) : null;
  return { ...check, legalName: found?.legalName ?? null, provider: provider?.name ?? null };
}
