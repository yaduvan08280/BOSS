// Renders apps/web/public/icon.svg into the PNG sizes the PWA manifest needs.
// Run: npm run icons
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const svg = readFileSync('apps/web/public/icon.svg', 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
const targets = [
  { file: 'icon-192.png', size: 192, pad: 0, bg: 'transparent' },
  { file: 'icon-512.png', size: 512, pad: 0, bg: 'transparent' },
  // Maskable icons get cropped to a circle/squircle: keep the mark inside the 80% safe zone.
  { file: 'icon-maskable-512.png', size: 512, pad: 0.12, bg: '#1F1E1B' },
];
for (const t of targets) {
  await page.setViewportSize({ width: t.size, height: t.size });
  const inner = Math.round(t.size * (1 - t.pad * 2));
  await page.setContent(
    `<html><body style="margin:0;background:${t.bg};display:grid;place-items:center;width:${t.size}px;height:${t.size}px">
     <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div></body></html>`,
  );
  await page.screenshot({ path: `apps/web/public/${t.file}`, omitBackground: t.bg === 'transparent' });
  console.log('wrote', t.file);
}
await browser.close();
