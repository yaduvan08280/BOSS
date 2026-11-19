/**
 * What may be written to the server log about a request. An address can itself be a secret: a guest's
 * booking link, a webhook's token, the code Google sends back after a sign-in. Those parts are replaced by
 * their first four characters, enough to tell two links apart when reading a log, never enough to use one.
 */
const SECRET_QUERY = /^(code|token|state|key|secret|password|signature|sig)$/i;

export function safeUrl(url: string): string {
  const [path = '', query] = url.split('?');
  const masked = path.replace(
    /^(\/api\/(?:hooks|public)\/[^/]+\/)([^/]+)/,
    (_all, head: string, token: string) => `${head}${token.slice(0, 4)}…`,
  );
  if (query === undefined) return masked;
  const params = query
    .split('&')
    .map((pair) => {
      const [name = '', value] = pair.split('=');
      return value !== undefined && SECRET_QUERY.test(name) ? `${name}=…` : pair;
    })
    .join('&');
  return `${masked}?${params}`;
}

/** The request as the log keeps it: no headers, no body — method, a safe address, who asked (address only). */
export function reqForLog(req: { method?: string; url?: string; ip?: string; id?: string }) {
  return { method: req.method, url: safeUrl(req.url ?? ''), remoteAddress: req.ip };
}
