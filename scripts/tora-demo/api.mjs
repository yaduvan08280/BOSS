// Tiny MONO API client: sign in, keep cookies, call JSON routes.
export const BASE = process.env.MONO_URL || 'http://localhost:3000';
const ORIGIN = process.env.MONO_ORIGIN ?? 'http://localhost:5173';
export async function session(identifier, password, companyId) {
  let cookie = '';
  const call = async (method, path, body) => {
    const r = await fetch(BASE + path, {
      method,
      headers: { origin: ORIGIN, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), cookie },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = r.headers.getSetCookie();
    if (set.length) {
      const jar = Object.fromEntries(cookie.split('; ').filter(Boolean).map((c) => c.split(/=(.*)/s).slice(0, 2)));
      for (const c of set) { const [kv] = c.split(';'); const [k, v] = kv.split(/=(.*)/s); jar[k] = v; }
      cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    }
    const text = await r.text();
    let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!r.ok) { const e = new Error(`${method} ${path} -> ${r.status} ${text.slice(0, 400)}`); e.status = r.status; e.data = data; throw e; }
    return data;
  };
  const me = await call('POST', '/api/auth/login', { identifier, password, ...(companyId ? { companyId } : {}) });
  const upload = async (buf, name = 'photo.png', mime = 'image/png') => {
    const fd = new FormData(); fd.append('file', new Blob([buf], { type: mime }), name);
    const r = await fetch(BASE + '/api/files', { method: 'POST', headers: { origin: ORIGIN, cookie }, body: fd });
    const t = await r.text(); if (!r.ok) throw new Error('upload ' + r.status + ' ' + t.slice(0, 200)); return JSON.parse(t);
  };
  return { me, upload, get: (p) => call('GET', p), post: (p, b = {}) => call('POST', p, b), put: (p, b = {}) => call('PUT', p, b), patch: (p, b = {}) => call('PATCH', p, b), del: (p) => call('DELETE', p) };
}
