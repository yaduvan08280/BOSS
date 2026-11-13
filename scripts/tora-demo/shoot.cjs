// Visit MONO screens in Chromium (inside the Playwright Docker image): sign in, open each route, screenshot,
// and log console errors + failed API calls.  Usage (in the container):
//   node /tora/shoot.cjs <width> <height> <login> <password> <outDir> <route> [route...]
const { chromium } = require('/work/node_modules/@playwright/test');
const fs = require('fs');
const [, , w, h, login, password, outDir, ...routes] = process.argv;
const BASE = process.env.BASE ?? 'http://localhost:5173';
(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1, isMobile: +w < 700, hasTouch: +w < 700, locale: 'en-IN', timezoneId: 'Asia/Kolkata' });
  const page = await ctx.newPage();
  const problems = [];
  let current = 'login';
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`[${current}] console: ${m.text().slice(0, 300)}`); });
  page.on('pageerror', (e) => problems.push(`[${current}] pageerror: ${e.message.slice(0, 300)}`));
  page.on('response', async (r) => {
    if (r.url().includes('/api/') && r.status() >= 400 && !r.url().includes('/api/auth/refresh')) {
      let body = ''; try { body = (await r.text()).slice(0, 200); } catch {}
      problems.push(`[${current}] ${r.status()} ${r.request().method()} ${r.url().replace(BASE, '')} ${body}`);
    }
  });
  await page.goto(BASE + '/login');
  await page.waitForTimeout(1200);
  await page.locator('input').first().fill(login);
  await page.locator('input[type=password]').fill(password);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  for (const route of routes) {
    current = route;
    const [path, action] = route.split('#');
    await page.goto(BASE + path);
    await page.waitForTimeout(2600);
    let n = 0;
    if (action) for (const step of action.split('>')) {
      const [kind, rest = ''] = step.includes(':') ? [step.slice(0, step.indexOf(':')), step.slice(step.indexOf(':') + 1)] : ['click', step];
      try {
        if (kind === 'click') await page.getByText(rest, { exact: false }).first().click({ timeout: 4000 });
        else if (kind === 'exact') await page.getByText(rest, { exact: true }).first().click({ timeout: 4000 });
        else if (kind === 'btn') await page.getByRole('button', { name: rest }).first().click({ timeout: 4000 });
        else if (kind === 'fill') { const [ph, v] = rest.split('='); await page.getByPlaceholder(ph).first().fill(v, { timeout: 4000 }); }
        else if (kind === 'label') { const [l, v] = rest.split('='); await page.getByLabel(l).first().fill(v, { timeout: 4000 }); }
        else if (kind === 'select') { const [l, v] = rest.split('='); await page.getByLabel(l).first().selectOption({ label: v }, { timeout: 4000 }); }
        else if (kind === 'key') await page.keyboard.press(rest);
        else if (kind === 'wait') await page.waitForTimeout(+rest);
        else if (kind === 'shot') await page.screenshot({ path: `${outDir}/${route.replace(/[^a-z0-9]+/gi, '_').slice(0, 30)}_${String(++n).padStart(2, '0')}_${rest}.png` });
        await page.waitForTimeout(kind === 'wait' || kind === 'shot' ? 0 : 1200);
      } catch (e) { problems.push(`[${route}] step ${step} failed: ${String(e.message).split('\n')[0].slice(0, 160)}`); }
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 2) problems.push(`[${route}] horizontal overflow ${overflow}px`);
    const name = route.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'home';
    await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: process.env.FULL === '1' });
  }
  fs.writeFileSync(`${outDir}/problems.txt`, problems.join('\n'));
  console.log(problems.length + ' problems');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
