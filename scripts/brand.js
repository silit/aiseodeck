// Renders the logo to favicon.png, the app icon (900x900) and the social preview image (1200x630).
// Run: node scripts/brand.js  (needs Playwright)
const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..');
const logo = (s) => `<svg width="${s}" height="${s}" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#10162B"/><circle cx="11" cy="11" r="4" fill="#FFE066"/><circle cx="21" cy="11" r="4" fill="none" stroke="#2D5BFF" stroke-width="2.4"/><circle cx="11" cy="21" r="2" fill="#8A93A6"/><circle cx="21" cy="21" r="4" fill="#FFE066" stroke="#2D5BFF" stroke-width="2.4"/></svg>`;
// Optional: FONT_DIR=<folder with @fontsource woff2 files> embeds Schibsted Grotesk; otherwise Arial is used.
const fs = require('fs');
function fontCss() {
  const dir = process.env.FONT_DIR;
  if (!dir) return '';
  return [600, 700, 800].map((w) => {
    const f = path.join(dir, `schibsted-grotesk-latin-${w}-normal.woff2`);
    return fs.existsSync(f) ? `@font-face{font-family:'Schibsted Grotesk';font-weight:${w};src:url(data:font/woff2;base64,${fs.readFileSync(f).toString('base64')}) format('woff2')}` : '';
  }).join('');
}
// The same question across the seven engines, like the grid on the landing page
const rows = [['ChatGPT', 'both', '1'], ['AI Overviews', 'named', '2'], ['AI Mode', 'none', ''], ['Gemini', 'both', '1'], ['Perplexity', 'named', '2'], ['Claude', 'named', '1'], ['Grok', 'none', '']];
const cell = (k, n) => k === 'none'
  ? '<span style="width:30px;height:30px;display:inline-grid;place-items:center"><span style="width:8px;height:8px;border-radius:50%;background:#8A93A6;opacity:.55"></span></span>'
  : `<span style="width:30px;height:30px;border-radius:50%;display:inline-grid;place-items:center;font-weight:800;font-size:14px;background:#FFE066;${k === 'both' ? 'box-shadow:inset 0 0 0 3px #2D5BFF' : ''}">${n}</span>`;
const og = `<div style="width:1200px;height:630px;background:#F5F6F8;display:grid;grid-template-columns:1.05fr 1fr;gap:48px;align-items:center;padding:0 70px;box-sizing:border-box;font-family:'Schibsted Grotesk',Arial,sans-serif;color:#10162B">
<div><div style="display:flex;align-items:center;gap:14px;font-weight:800;font-size:30px;letter-spacing:-.02em">${logo(46)}AI SEO Deck</div>
<div style="font-size:92px;font-weight:800;line-height:.98;letter-spacing:-.045em;margin-top:34px">Every AI.<br>One deck.</div>
<div style="font-size:24px;line-height:1.4;color:#5C6478;margin-top:26px;max-width:470px">See if ChatGPT, Google AI, Gemini, Perplexity, Claude and Grok recommend you. Then fix your Webflow site.</div></div>
<div style="background:#fff;border:1px solid #E2E5EC;border-radius:22px;padding:24px 26px;display:grid;gap:12px;box-shadow:0 30px 60px -40px rgba(16,22,43,.35)">
<div style="justify-self:end;background:#10162B;color:#F5F6F8;border-radius:16px 16px 4px 16px;padding:10px 15px;font-weight:600;font-size:18px">Best bookkeeping app for UK freelancers?</div>
<div style="display:grid;gap:2px;margin-top:4px">${rows.map(([e, k, n]) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 2px;border-bottom:1px solid #EEF0F4;font-size:18px;font-weight:600">${e}${cell(k, n)}</div>`).join('')}</div>
<div style="font-size:16px;font-weight:700;color:#5C6478">Named by <span style="color:#10162B">5 of 7</span> AI engines, site cited by 2</div></div></div>`;
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
  for (const [file, size] of [['public/favicon.png', 64], ['assets/icon-900.png', 900], ['assets/icon-256.png', 256]]) {
    await p.setContent(`<body style="margin:0;background:transparent">${logo(size)}</body>`);
    await p.locator('svg').screenshot({ path: path.join(ROOT, file), omitBackground: true });
  }
  await p.setContent(`<head><style>${fontCss()}</style></head><body style="margin:0">${og}</body>`);
  await p.evaluate(() => document.fonts.ready);
  await p.locator('body > div').screenshot({ path: path.join(ROOT, 'public/og.png') });
  await b.close();
  console.log('brand images written');
})();
