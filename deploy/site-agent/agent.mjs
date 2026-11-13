#!/usr/bin/env node
// MONO site agent — a small program for a branch's own computer (Node 22, no packages to install).
// It prints MONO's kitchen tickets and bills on the branch's printers (network or USB) and posts MONO's
// vouchers to the Tally running on the same network. It only ever calls MONO; nothing calls it.
//
//   MONO_URL=https://mono.example.com MONO_AGENT_KEY=agt_... node agent.mjs
//   TALLY_URL=http://localhost:9000   (leave out where there is no Tally)
//
// The key comes from System Master → Integration → Site agents (shown once).
import { writeFile } from 'node:fs/promises';
import { Socket } from 'node:net';
import { pathToFileURL } from 'node:url';

/** Send bytes to a printer: "192.168.1.50:9100" (network) or a device path such as /dev/usb/lp0 (USB). */
export function sendToPrinter(address, bytes, timeoutMs = 4000) {
  const m = /^([^/\\:]+):(\d+)$/.exec(address ?? '');
  if (!m) {
    if (!address) return Promise.reject(new Error('The printer has no address'));
    return writeFile(address, bytes);
  }
  return new Promise((resolve, reject) => {
    const s = new Socket();
    const fail = (e) => (s.destroy(), reject(e));
    s.setTimeout(timeoutMs, () => fail(new Error('The printer did not answer')));
    s.once('error', fail);
    s.connect(Number(m[2]), m[1], () => s.end(bytes, resolve));
  });
}

/** Post one voucher to Tally (XML over HTTP). Tally answers 200 even when it refuses: the body says which. */
export async function postToTally(url, xml, doFetch = fetch) {
  const res = await doFetch(url, { method: 'POST', headers: { 'content-type': 'text/xml' }, body: xml });
  const text = await res.text();
  const created = Number(/<CREATED>(\d+)<\/CREATED>/i.exec(text)?.[1] ?? 0);
  const altered = Number(/<ALTERED>(\d+)<\/ALTERED>/i.exec(text)?.[1] ?? 0);
  const error = /<LINEERROR>([^<]*)<\/LINEERROR>/i.exec(text)?.[1];
  if (!res.ok) return { ok: false, error: `Tally answered ${res.status}` };
  if (error || created + altered < 1)
    return { ok: false, error: error ?? 'Tally did not create the voucher' };
  return { ok: true };
}

/**
 * One round: print what waits, post what waits. `o.print` and `o.tally` can be replaced (tests do).
 * Returns what it did; a failure of one job never stops the others.
 */
export async function runOnce(o) {
  const doFetch = o.fetch ?? fetch;
  const call = async (path, body) => {
    const res = await doFetch(`${o.server.replace(/\/$/, '')}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${o.key}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`MONO answered ${res.status} for ${path}`);
    return res.json();
  };
  const done = { printed: 0, printFailed: 0, posted: 0, postFailed: 0, unmapped: [] };
  const print = o.print ?? sendToPrinter;
  for (const job of await call('/api/agent/print')) {
    let error = null;
    try {
      await print(job.address, Buffer.from(job.payload, 'base64'));
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    await call(`/api/agent/print/${job.id}`, { ok: !error, error });
    if (error) done.printFailed++;
    else done.printed++;
  }
  if (o.tallyUrl || o.tally) {
    const tally = o.tally ?? ((xml) => postToTally(o.tallyUrl, xml, doFetch));
    const waiting = await call('/api/agent/tally');
    done.unmapped = waiting.unmapped ?? [];
    const results = [];
    for (const v of waiting.vouchers) {
      let r;
      try {
        r = await tally(v.xml);
      } catch {
        // Tally is closed or unreachable: leave the voucher waiting, try again next round.
        continue;
      }
      results.push({ id: v.id, ok: r.ok, error: r.error ?? null });
      if (r.ok) done.posted++;
      else done.postFailed++;
    }
    if (results.length) await call('/api/agent/tally', { results });
  }
  return done;
}

async function main() {
  const server = process.env.MONO_URL;
  const key = process.env.MONO_AGENT_KEY;
  if (!server || !key) {
    console.error('Set MONO_URL and MONO_AGENT_KEY first.');
    process.exit(1);
  }
  const tallyUrl = process.env.TALLY_URL || null;
  console.log(`MONO site agent: ${server}${tallyUrl ? `, Tally at ${tallyUrl}` : ''}`);
  let round = 0;
  for (;;) {
    try {
      // Printing every 3 seconds; Tally once a minute.
      const done = await runOnce({ server, key, tallyUrl: round % 20 === 0 ? tallyUrl : null });
      if (done.printed || done.printFailed || done.posted || done.postFailed)
        console.log(new Date().toISOString(), JSON.stringify(done));
    } catch (e) {
      console.error(new Date().toISOString(), e instanceof Error ? e.message : e);
    }
    round++;
    await new Promise((r) => setTimeout(r, 3000));
  }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
