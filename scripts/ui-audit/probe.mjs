/* global document, getComputedStyle, innerWidth, innerHeight */
/**
 * Runs inside the page: measures the screen as it is now and returns what looks wrong. Kept free of outside
 * names because Playwright sends its source to the browser.
 */
export function probe() {
  const W = innerWidth;
  const H = innerHeight;
  const phone = W < 500;
  const dialog = [...document.querySelectorAll('[role=dialog]')]
    .filter((d) => d.getClientRects().length)
    .at(-1);
  const scope = dialog || document.querySelector('main') || document.body;
  const shown = (e) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const cs = (e) => getComputedStyle(e);
  const scrolls = (e) => /(auto|scroll)/.test(cs(e).overflowX);
  const inScroller = (e) => {
    for (let p = e.parentElement; p && p !== document.body; p = p.parentElement)
      if (scrolls(p) || cs(p).overflowX === 'hidden' || cs(p).overflowX === 'clip') return true;
    return false;
  };
  const name = (e) =>
    `${e.tagName.toLowerCase()}${e.getAttribute('data-ui') ? `[${e.getAttribute('data-ui')}]` : ''} "${(e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 32)}"`;
  const all = [...scope.querySelectorAll('*')].filter(shown);
  const out = [];
  const add = (kind, detail) => out.push({ kind, detail });

  // The page, or the dialog, scrolling sideways; anything hanging outside the screen.
  const side = document.documentElement.scrollWidth - W;
  if (side > 2) add('page-sideways', `${side}px`);
  if (dialog && dialog.scrollWidth - dialog.clientWidth > 4)
    add('dialog-sideways', `${dialog.scrollWidth - dialog.clientWidth}px`);
  const outside = all.filter((e) => {
    const r = e.getBoundingClientRect();
    return (r.right > W + 2 || r.left < -2) && !inScroller(e) && cs(e).position !== 'fixed';
  });
  if (outside.length) add('off-screen', outside.slice(0, 2).map(name).join(' | '));

  // A dialog taller than the screen, or with its footer buttons out of reach.
  if (dialog) {
    const r = dialog.getBoundingClientRect();
    if (r.top < -2 || r.bottom > H + 2)
      add('dialog-too-tall', `${Math.round(r.height)}px on a ${H}px screen`);
    const last = [...dialog.querySelectorAll('button')].filter(shown).at(-1);
    if (last && scrollYOut(last)) add('dialog-footer-hidden', name(last));
  }
  function scrollYOut(e) {
    const r = e.getBoundingClientRect();
    if (r.bottom <= H + 2) return false;
    for (let p = e.parentElement; p; p = p.parentElement)
      if (/(auto|scroll)/.test(cs(p).overflowY) && p.scrollHeight > p.clientHeight + 2) return false;
    return true;
  }

  // Tables and rows that scroll sideways inside their own box (listed, not always wrong).
  for (const e of all) {
    if (!scrolls(e) || e.scrollWidth <= e.clientWidth + 8) continue;
    if (e.querySelector('table'))
      add('table-scrolls', `${e.scrollWidth - e.clientWidth}px ${name(e.querySelector('th') || e)}`);
  }

  // Text cut off with no "…" to say so.
  const cut = all.filter((e) => {
    if (e.children.length || !e.textContent.trim()) return false;
    const s = cs(e);
    // Text for screen readers only (a 1px box) is not text a person sees cut.
    if (e.clientWidth <= 2 || s.clip !== 'auto' || s.clipPath !== 'none') return false;
    // Cut means hidden with no sign: a box that scrolls, or ends in "…", is not cut.
    if (s.overflowX !== 'hidden' && s.overflowX !== 'clip') return false;
    if (s.textOverflow === 'ellipsis' || s.webkitLineClamp !== 'none') return false;
    return e.scrollWidth > e.clientWidth + 2 && !/INPUT|TEXTAREA|SELECT/.test(e.tagName);
  });
  if (cut.length) add('text-cut', cut.slice(0, 3).map(name).join(' | '));

  // Controls drawn on top of each other.
  // (The arrows that sit over the ends of a scrolling tab row are meant to be there.)
  const controls = all.filter(
    (e) =>
      /^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(e.tagName) &&
      cs(e).position !== 'fixed' &&
      e.getAttribute('data-ui') !== 'scroll-arrow',
  );
  // Only the part of a control that is really shown: what a scrolling box hides (a field that has slid under
  // a dialog's footer) is not on top of anything.
  const shownPart = (e) => {
    const r = e.getBoundingClientRect();
    const box = { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = cs(p);
      if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
      const c = p.getBoundingClientRect();
      box.left = Math.max(box.left, c.left);
      box.right = Math.min(box.right, c.right);
      box.top = Math.max(box.top, c.top);
      box.bottom = Math.min(box.bottom, c.bottom);
    }
    return box;
  };
  const boxes = controls
    .map((e) => [e, shownPart(e)])
    .filter(([, r]) => r.bottom > 0 && r.top < H && r.right - r.left > 4 && r.bottom - r.top > 4);
  const over = [];
  for (let i = 0; i < boxes.length && over.length < 2; i++)
    for (let j = i + 1; j < boxes.length && over.length < 2; j++) {
      const [a, ra] = boxes[i];
      const [b, rb] = boxes[j];
      if (a.contains(b) || b.contains(a)) continue;
      // One sitting wholly inside the other's box is meant: the calendar button in a date box, the star on a card.
      const inside = (p, q) =>
        p.left >= q.left - 1 && p.right <= q.right + 1 && p.top >= q.top - 1 && p.bottom <= q.bottom + 1;
      if (inside(ra, rb) || inside(rb, ra)) continue;
      const x = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const y = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (
        x > 6 &&
        y > 6 &&
        document.elementFromPoint(Math.max(ra.left, rb.left) + x / 2, Math.max(ra.top, rb.top) + y / 2)
      )
        over.push(`${name(a)} over ${name(b)}`);
    }
  if (over.length) add('overlap', over.join(' | '));

  // Phones: small touch targets and tiny text.
  if (phone) {
    const small = controls.filter((e) => {
      const r = e.getBoundingClientRect();
      if (cs(e).display === 'inline' || e.type === 'checkbox' || e.type === 'radio' || e.type === 'hidden')
        return false;
      // A bare box inside a search field: the field (its label) is what the thumb hits.
      const field = e.tagName === 'INPUT' ? e.closest('label') : null;
      if (field && field.getBoundingClientRect().height >= 40) return false;
      // A larger invisible hit area (::before or ::after) counts.
      const area = (side) =>
        Math.max(
          parseFloat(getComputedStyle(e, '::before')[side]) || 0,
          parseFloat(getComputedStyle(e, '::after')[side]) || 0,
        );
      return Math.max(r.height, area('height')) < 40 || Math.max(r.width, area('width')) < 40;
    });
    if (small.length) add('tap-small', `${small.length}: ${small.slice(0, 3).map(name).join(' | ')}`);
  }
  const tiny = all.filter(
    (e) =>
      // (Initials inside a small round avatar are a picture, not text to read.)
      e.getAttribute('aria-hidden') !== 'true' &&
      [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) &&
      parseFloat(cs(e).fontSize) < (phone ? 12 : 10),
  );
  if (tiny.length)
    add(
      'text-tiny',
      `${tiny.length}: ${tiny
        .slice(0, 2)
        .map((e) => `${name(e)} ${cs(e).fontSize}`)
        .join(' | ')}`,
    );

  // Words that should never reach a person.
  const text = scope.innerText || '';
  const bad = /Something went wrong|\bundefined\b|\bNaN\b|\[object |Invalid Date|null null/.exec(text);
  if (bad) add('bad-text', bad[0]);
  const raw = (text.match(/\b[a-z][a-zA-Z]+\.[a-z][a-zA-Z]+(\.[a-zA-Z0-9_]+)+\b/g) || []).filter(
    (k) => !/\.(com|in|co|org|net|png|jpg|pdf|csv|json|mjs|sh|md|xlsx)\b|^(www|e\.g|i\.e|api)\./.test(k),
  );
  if (raw.length) add('raw-key', [...new Set(raw)].slice(0, 3).join(', '));

  // Wide screens: the content sitting in a narrow strip.
  const main = document.querySelector('main');
  if (!dialog && main && W >= 1900) {
    const m = main.getBoundingClientRect();
    const inner = [...main.querySelectorAll(':scope > * > *, :scope > *')]
      .filter(shown)
      .map((e) => e.getBoundingClientRect());
    const left = Math.min(m.right, ...inner.map((r) => r.left));
    const right = Math.max(0, ...inner.map((r) => r.right));
    const used = right - left;
    // A column centred on purpose (a search page, a letter, a guide) is a reading width, not wasted space.
    const centred = Math.abs(left - m.left - (m.right - right)) < 24;
    if (used < m.width * 0.6 && inner.length && !centred)
      add('narrow-strip', `content uses ${Math.round(used)} of ${Math.round(m.width)}px`);
  }
  return {
    problems: out,
    fields: scope.querySelectorAll('input:not([type=hidden]), textarea, select, [role=combobox]').length,
    hasDialog: Boolean(dialog),
  };
}
