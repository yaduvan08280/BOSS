// A tiny client for MONO's own API: signs in like the web app does and keeps the session cookies.
// No packages — Node 22 only.

export class Refused extends Error {
  constructor(method, path, status, body) {
    const msg = body?.error?.message ?? JSON.stringify(body)?.slice(0, 300);
    super(`${method} ${path} → ${status} ${msg}`);
    this.status = status;
    this.code = body?.error?.code;
    this.body = body;
  }
}

export async function signIn(base, identifier, password, companyId) {
  const jar = new Map();
  const keep = (res) => {
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(';');
      const at = pair.indexOf('=');
      const [k, v] = [pair.slice(0, at).trim(), pair.slice(at + 1)];
      if (v) jar.set(k, v);
      else jar.delete(k);
    }
  };
  const raw = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        origin: base,
        cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
        ...(body !== undefined && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
    keep(res);
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text.slice(0, 300) };
    }
    return { status: res.status, body: json };
  };
  const call = async (method, path, body, headers) => {
    let r = await raw(method, path, body, headers);
    if (r.status === 401) {
      // The 15-minute access cookie ran out: renew it once and try again.
      const again = await raw('POST', '/api/auth/refresh', {});
      if (again.status === 200) r = await raw(method, path, body, headers);
    }
    if (r.status === 429) {
      await new Promise((done) => setTimeout(done, 5000));
      r = await raw(method, path, body, headers);
    }
    if (r.status < 200 || r.status >= 300) throw new Refused(method, path, r.status, r.body);
    return r.body;
  };
  const first = await raw('POST', '/api/auth/login', { identifier, password, ...(companyId ? { companyId } : {}) });
  if (first.status !== 200) throw new Refused('POST', '/api/auth/login', first.status, first.body);
  return {
    get: (path, headers) => call('GET', path, undefined, headers),
    post: (path, body = {}, headers) => call('POST', path, body, headers),
    put: (path, body = {}) => call('PUT', path, body),
    patch: (path, body = {}) => call('PATCH', path, body),
    del: (path) => call('DELETE', path),
    /** Upload a file the way the screens do; returns its id. */
    upload: async (bytes, name, mime) => {
      const form = new FormData();
      form.append('file', new Blob([bytes], { type: mime }), name);
      return (await call('POST', '/api/files', form)).id;
    },
    /** The answer or the refusal, without throwing (for things that may already exist). */
    tryPost: async (path, body = {}) => {
      try {
        return { ok: true, body: await call('POST', path, body) };
      } catch (e) {
        if (e instanceof Refused) return { ok: false, status: e.status, message: e.message, body: e.body };
        throw e;
      }
    },
  };
}

/** Run one part of the set-up; a part that fails is reported and the rest still runs. */
export async function part(report, name, fn) {
  const at = Date.now();
  try {
    const note = await fn();
    report.push({ name, ok: true, note: note ?? '' });
    console.log(`  ✓ ${name}${note ? ` — ${note}` : ''} (${((Date.now() - at) / 1000).toFixed(1)} s)`);
  } catch (e) {
    report.push({ name, ok: false, note: e.message });
    console.log(`  ✗ ${name} — ${e.message}`);
    if (process.env.TORA_DEBUG) console.log(e.stack);
  }
}

// Dates the API takes: an instant, or a plain day in India (the demo is in Jaipur).
export const iso = (d) => d.toISOString();
export const inDays = (n, hh = 12, mm = 0) => {
  const day = dayIn(n);
  return new Date(`${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+05:30`);
};
export const dayIn = (n) =>
  new Date(Date.now() + 5.5 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);
export const rupees = (n) => String(Math.round(n * 100));
/** 1 = Monday … 7 = Sunday, for a plain day. */
export const weekdayOf = (day) => ((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;

/** The last character of a GSTIN (its check character), for a made-up number that still passes the check. */
export function gstinCheck(first14) {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let sum = 0;
  [...first14].forEach((c, i) => {
    const p = chars.indexOf(c) * (i % 2 ? 2 : 1);
    sum += Math.floor(p / 36) + (p % 36);
  });
  return chars[(36 - (sum % 36)) % 36];
}
