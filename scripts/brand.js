// Renders the logo to favicon.png, the app icon (900x900) and the social preview image (1200x630).
// Run: node scripts/brand.js  (needs Playwright)
const path = require('path');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..');
const logo = (s) => `<svg width="${s}" height="${s}" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#10162B"/><circle cx="11" cy="11" r="4" fill="#FFE066"/><circle cx="21" cy="11" r="4" fill="none" stroke="#2D5BFF" stroke-width="2.4"/><circle cx="11" cy="21" r="2" fill="#8A93A6"/><circle cx="21" cy="21" r="4" fill="#FFE066" stroke="#2D5BFF" stroke-width="2.4"/></svg>`;
const og = `<div style="width:1200px;height:630px;background:#F5F6F8;display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:center;padding:0 70px;box-sizing:border-box;font-family:'Schibsted Grotesk',Arial,sans-serif;color:#10162B">
<div><div style="display:flex;align-items:center;gap:14px;font-weight:800;font-size:30px">${logo(46)}AI SEO Deck</div>
<div style="font-size:58px;font-weight:800;line-height:1.05;letter-spacing:-.03em;margin-top:30px">Find out if ChatGPT recommends you</div>
<div style="font-size:24px;color:#5C6478;margin-top:20px">AI search visibility and fixes for Webflow sites</div></div>
<div style="background:#fff;border:1px solid #E2E5EC;border-radius:22px;padding:28px;display:grid;gap:16px">
<div style="justify-self:end;background:#10162B;color:#F5F6F8;border-radius:16px 16px 4px 16px;padding:10px 15px;font-weight:600;font-size:19px">Best bookkeeping app for UK freelancers?</div>
<div style="font-size:15px;font-weight:700">ChatGPT <span style="background:#FFE066;border-radius:99px;padding:3px 10px;margin-left:6px">Named #1</span> <span style="background:#E7EDFF;color:#2D5BFF;border-radius:99px;padding:3px 10px">Your site cited</span></div>
<div style="font-family:Georgia,serif;font-size:22px;line-height:1.55">The tools recommended most often are <span style="background:#FFE066;padding:0 3px">Tallyhawk</span>, Ledgerbird and Sumwise.</div></div></div>`;
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
  for (const [file, size] of [['public/favicon.png', 64], ['assets/icon-900.png', 900], ['assets/icon-256.png', 256]]) {
    await p.setContent(`<body style="margin:0;background:transparent">${logo(size)}</body>`);
    await p.locator('svg').screenshot({ path: path.join(ROOT, file), omitBackground: true });
  }
  await p.setContent(`<body style="margin:0">${og}</body>`);
  await p.locator('body > div').screenshot({ path: path.join(ROOT, 'public/og.png') });
  await b.close();
  console.log('brand images written');
})();
