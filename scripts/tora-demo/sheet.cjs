// Compose screenshots into contact sheets: node sheet.cjs <dir> <perSheet> <scale>
const { chromium } = require('/work/node_modules/@playwright/test');
const fs = require('fs');
const [, , dir, per = '4', scale = '0.6'] = process.argv;
(async () => {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png') && !f.startsWith('sheet')).sort();
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1800, height: 900 } });
  for (let i = 0; i < files.length; i += +per) {
    const set = files.slice(i, i + +per);
    const html = `<body style="margin:0;display:flex;gap:6px;background:#888;font:12px sans-serif">${set.map((f) => `<div><div style="background:#fff;padding:2px">${f}</div><img style="zoom:${scale}" src="data:image/png;base64,${fs.readFileSync(dir + '/' + f).toString('base64')}"></div>`).join('')}</body>`;
    await p.setContent(html); await p.waitForTimeout(200);
    const el = await p.$('body'); await el.screenshot({ path: `${dir}/sheet${String(i / +per).padStart(2, '0')}.png` });
  }
  await b.close();
})();
