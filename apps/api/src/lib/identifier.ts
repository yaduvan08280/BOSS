import { looksLikeEmail, normalizeMobile } from '@mono/shared';

/** Login ID → user filter (email lower-cased, mobile in E.164); null when it is neither. */
export function identifierWhere(identifier: string) {
  if (looksLikeEmail(identifier)) return { email: identifier.trim().toLowerCase() };
  const mobile = normalizeMobile(identifier);
  return mobile ? { mobile } : null;
}
