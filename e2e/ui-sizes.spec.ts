import { expect, test } from '@playwright/test';
import { settled, signIn } from './phase11-kit';

/**
 * Decision 247: no screen may scroll sideways, and nothing may stick out of the window or of its own card, at a
 * phone (390), a small or zoomed-in laptop (1024), a laptop (1440) and a 27" monitor (2560). The twenty busiest
 * screens are checked here; `npm run ui:audit:all` covers every screen, tab, dialog and dropdown.
 */
const SIZES = [
  [390, 844],
  [1024, 768],
  [1440, 900],
  [2560, 1440],
] as const;
const SCREENS = [
  '/',
  '/workspace',
  '/delegation',
  '/checklists',
  '/help-tickets',
  '/mis',
  '/fms/live',
  '/hr/attendance',
  '/hr/payroll',
  '/ims/stock',
  '/ims/locations',
  '/crm',
  '/crm/customers',
  '/money/bills',
  '/money/owed',
  '/owner',
  '/reports',
  '/system/users',
  '/system/roles',
  '/system/integration/rules',
];

test('the twenty busiest screens fit every screen size', async ({ page }, info) => {
  // One browser is enough: the sizes are set here, not by the project.
  test.skip(info.project.name !== 'desktop', 'sizes are set inside the test');
  test.setTimeout(600_000);
  await signIn(page);
  const problems: string[] = [];
  for (const [width, height] of SIZES) {
    await page.setViewportSize({ width, height });
    for (const path of SCREENS) {
      await page.goto(path);
      await settled(page);
      const found = await page.evaluate(() => {
        const out: string[] = [];
        const side = document.documentElement.scrollWidth - innerWidth;
        if (side > 2) out.push(`page scrolls sideways by ${side}px`);
        const clipped = (e: Element) => {
          for (let p = e.parentElement; p && p !== document.body; p = p.parentElement)
            if (getComputedStyle(p).overflowX !== 'visible') return true;
          return false;
        };
        for (const e of document.querySelectorAll('main button, main input, main [data-ui=kpi]')) {
          const r = e.getBoundingClientRect();
          if (!r.width || clipped(e)) continue;
          if (r.right > innerWidth + 2)
            out.push(`"${(e.textContent ?? '').trim().slice(0, 30)}" is outside the window`);
          const card = e.closest('[data-slot=card]');
          if (card && r.right > card.getBoundingClientRect().right + 3)
            out.push(`"${(e.textContent ?? '').trim().slice(0, 30)}" sticks out of its card`);
        }
        return out;
      });
      for (const f of found) problems.push(`${width}px ${path}: ${f}`);
    }
  }
  expect(problems, problems.join('\n')).toEqual([]);
});
