// Renders the logo to favicon.png, the app icon (900x900) and the social preview image (1200x630).
// Run: node scripts/brand.js  (needs Playwright)
const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..');
const logo = (s) => `<svg width="${s}" height="${s}" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#10162B"/><circle cx="11" cy="11" r="4" fill="#FFE066"/><circle cx="21" cy="11" r="4" fill="none" stroke="#2D5BFF" stroke-width="2.4"/><circle cx="11" cy="21" r="2" fill="#8A93A6"/><circle cx="21" cy="21" r="4" fill="#FFE066" stroke="#2D5BFF" stroke-width="2.4"/></svg>`;
// Optional: FONT_DIR=<node_modules/@fontsource-variable folder> embeds Montserrat; otherwise Arial is used.
const fs = require('fs');
function fontCss() {
  const dir = process.env.FONT_DIR;
  if (!dir) return '';
  const f = path.join(dir, 'montserrat/files/montserrat-latin-wght-normal.woff2');
  return fs.existsSync(f) ? `@font-face{font-family:'Montserrat';font-weight:100 900;src:url(data:font/woff2;base64,${fs.readFileSync(f).toString('base64')}) format('woff2')}` : '';
}
// The light tile logo used in the site header, for the blue social image
const logoLight = (s) => `<svg width="${s}" height="${s}" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#F1F2FF"/><circle cx="11" cy="11" r="4" fill="#E8C300"/><circle cx="21" cy="11" r="4" fill="none" stroke="#2F5BFF" stroke-width="2.4"/><circle cx="11" cy="21" r="2" fill="#8A93B8"/><circle cx="21" cy="21" r="4" fill="#E8C300" stroke="#2F5BFF" stroke-width="2.4"/></svg>`;
// The same question across the six engines, like the deck on the landing page (site colours)
const C = { bg: '#222B5E', panel: '#2B3571', line: '#434F93', line2: '#36417F', lift: '#3A4689', ink: '#F0F2FF', muted: '#BCC1E6', faint: '#9AA1D1', mark: '#FFE45C', markInk: '#1B1600', cite: '#86AEFF' };
const rows = [['ChatGPT', 'both', '1'], ['AI Overviews', 'named', '2'], ['AI Mode', 'none', ''], ['Gemini', 'both', '1'], ['Claude', 'named', '1'], ['Grok', 'none', '']];
const cell = (k, n) => k === 'none'
  ? `<span style="width:30px;height:30px;display:inline-grid;place-items:center"><span style="width:8px;height:8px;border-radius:50%;background:${C.faint};opacity:.7"></span></span>`
  : `<span style="width:30px;height:30px;border-radius:50%;display:inline-grid;place-items:center;font-weight:800;font-size:14px;color:${C.markInk};background:${C.mark};${k === 'both' ? `box-shadow:0 0 0 3px ${C.panel},0 0 0 5px ${C.cite}` : ''}">${n}</span>`;
const og = `<div style="width:1200px;height:630px;background:${C.bg};background-image:linear-gradient(rgba(160,172,255,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(160,172,255,.08) 1px,transparent 1px);background-size:56px 56px;color:${C.ink};display:grid;grid-template-columns:1.05fr 1fr;gap:48px;align-items:center;padding:0 70px;box-sizing:border-box;font-family:'Montserrat',Arial,sans-serif">
<div><div style="display:flex;align-items:center;gap:14px;font-weight:800;font-size:28px;letter-spacing:-.01em">${logoLight(44)}AI SEO Deck</div>
<div style="font-size:84px;font-weight:820;line-height:1;letter-spacing:-.026em;margin-top:34px">Every AI.<br>One deck.</div>
<div style="font-size:22px;line-height:1.45;font-weight:500;color:${C.muted};margin-top:24px;max-width:480px">See if ChatGPT, Google AI, Gemini, Claude and Grok recommend you. Then fix your Webflow site.</div>
<div style="display:inline-block;margin-top:26px;background:${C.mark};color:${C.markInk};font-weight:800;font-size:18px;border-radius:12px;padding:10px 18px">7 days free</div></div>
<div style="background:${C.panel};border:1px solid ${C.line};border-radius:22px;padding:24px 26px;display:grid;gap:12px;box-shadow:0 30px 70px -40px rgba(10,14,46,.8)">
<div style="justify-self:end;background:${C.lift};color:${C.ink};border-radius:16px 16px 4px 16px;padding:10px 15px;font-weight:600;font-size:17px">Best bookkeeping app for UK freelancers?</div>
<div style="display:grid;gap:2px;margin-top:4px">${rows.map(([e, k, n]) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 2px;border-bottom:1px solid ${C.line2};font-weight:600;font-size:18px">${e}${cell(k, n)}</div>`).join('')}</div>
<div style="font-size:15px;font-weight:600;color:${C.muted}">Named by <span style="color:${C.ink}">${rows.filter((r) => r[1] !== 'none').length} of ${rows.length}</span> AI engines, site cited by ${rows.filter((r) => r[1] === 'both').length}</div></div></div>`;
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
  const onlyOg = process.argv.includes('og');
  for (const [file, size] of onlyOg ? [] : [['public/favicon.png', 64], ['assets/icon-900.png', 900], ['assets/icon-256.png', 256]]) {
    await p.setContent(`<body style="margin:0;background:transparent">${logo(size)}</body>`);
    await p.locator('svg').screenshot({ path: path.join(ROOT, file), omitBackground: true });
  }
  await p.setContent(`<head><style>${fontCss()}</style></head><body style="margin:0">${og}</body>`);
  await p.evaluate(() => document.fonts.ready);
  await p.locator('body > div').screenshot({ path: path.join(ROOT, 'public/og.png') });
  await b.close();
  console.log('brand images written');
})();
