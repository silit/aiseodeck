// The contrast of every text on the pages of the web app and its public pages, measured in a real browser in the
// light and in the dark theme, on the free plan and on a paid one (WCAG 2: 4.5 to 1, or 3 to 1 for large text).
// The real server code answers; Webflow, the database, the AI engines, mail and billing are the stand-ins the
// other tests use. Run: node test/contrast.js
// Needs Playwright with Chromium. Without it the test says so and passes, so `npm test` works everywhere.
const http = require('http');
const fs = require('fs');
const path = require('path');

let playwright;
try { playwright = require('playwright'); } catch (e) {
  console.log('contrast test skipped: Playwright is not installed here. Install it (npm i -D playwright, then npx playwright install chromium) to measure the pages in a browser.');
  process.exit(0);
}

const M = require('./mocks');
const { listen, db, wfState, textNode, imageNode } = M;

let passed = 0, failed = 0;
function assert(c, m) { if (c) { passed++; console.log('  ok   ' + m); } else { failed++; console.log('  FAIL ' + m); } }
const root = path.join(__dirname, '..');
const getJ = (k) => { const v = db.get(k); return v ? JSON.parse(v) : null; };

function request(port, method, p, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
      const ch = [];
      res.on('data', (c) => ch.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(ch).toString() }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
const form = (obj) => { const sp = new URLSearchParams(); for (const [k, v] of Object.entries(obj)) for (const x of [].concat(v)) sp.append(k, x); return sp.toString(); };
const cookiesFrom = (res) => (res.headers['set-cookie'] || []).map((c) => c.split(';')[0]).filter((c) => !c.endsWith('=')).join('; ');

(async () => {
  const redisPort = await listen(M.redis);
  const aiPort = await listen(M.ai);
  const resendPort = await listen(M.resend);
  const wfPort = await listen(M.webflow);
  const polarPort = await listen(M.polar);
  const APP = 'https://aiseodeck.silitlabs.com';
  Object.assign(process.env, {
    WEBFLOW_CLIENT_ID: 'cid', WEBFLOW_CLIENT_SECRET: 'sec', SESSION_SECRET: 'test-session-secret-which-is-long', APP_URL: APP, CRON_SECRET: 'cronkey',
    COMPLIMENTARY_CODE: 'an-access-code-so-the-form-shows',
    KV_REST_API_URL: 'http://127.0.0.1:' + redisPort, KV_REST_API_TOKEN: 't',
    WEBFLOW_API_BASE: 'http://127.0.0.1:' + wfPort, WEBFLOW_AUTH_BASE: 'http://127.0.0.1:' + wfPort,
    RESEND_API_KEY: 'rk', RESEND_API_BASE: 'http://127.0.0.1:' + resendPort, EMAIL_FROM: 'AI SEO Deck <t@test>',
    OPENAI_API_KEY: 'ok', OPENAI_API_BASE: 'http://127.0.0.1:' + aiPort,
    GEMINI_API_KEY: 'gk', GEMINI_API_BASE: 'http://127.0.0.1:' + aiPort,
    ANTHROPIC_API_KEY: 'ak', ANTHROPIC_API_BASE: 'http://127.0.0.1:' + aiPort,
    XAI_API_KEY: 'xk', XAI_API_BASE: 'http://127.0.0.1:' + aiPort + '/xai',
    DATAFORSEO_LOGIN: 'dl', DATAFORSEO_PASSWORD: 'dp', DATAFORSEO_API_BASE: 'http://127.0.0.1:' + aiPort,
    POLAR_ACCESS_TOKEN: 'polar_oat', POLAR_API_BASE: 'http://127.0.0.1:' + polarPort, POLAR_WEBHOOK_SECRET: 'whsec_' + Buffer.from('polar-secret-key').toString('base64')
  });

  /* ---- a site with two languages, pages that have things to fix, a checked keyword and a Site health read ---- */
  const long = (sentence, times) => '<p>' + (sentence + ' ').repeat(times) + '</p>';
  const copied = { title: '', titleCopied: true, description: '', descriptionCopied: true };
  wfState.sites = [{ id: 'siteA', workspaceId: 'ws1', displayName: 'Lumen Dental', shortName: 'lumen-dental', customDomains: [{ id: 'd0', url: 'lumendental.com' }],
    locales: { primary: { id: 'loc_en', cmsLocaleId: 'cms_en', displayName: 'English', tag: 'en', enabled: true }, secondary: [{ id: 'loc_de', displayName: 'German', tag: 'de', enabled: true }] } }];
  wfState.pages.siteA = [
    { id: 'p1', title: 'Home', slug: 'home', publishedPath: '/', seo: { title: 'Lumen Dental', description: 'Dentist.' }, openGraph: copied },
    { id: 'p2', title: 'About', slug: 'about', publishedPath: '/about', seo: { title: 'Veneers in Antalya | About Lumen Dental', description: 'Meet the Lumen Dental team in Antalya: digital smile design, veneers and implants for patients from the UK and Ireland.' }, openGraph: copied },
    { id: 'p3', title: 'Services', slug: 'services', publishedPath: '/services', seo: { title: 'Dental services in Antalya | Lumen Dental', description: 'Implants, crowns, whitening and smile design at Lumen Dental in Antalya, planned with a fully digital workflow.' }, openGraph: copied }
  ];
  wfState.dom.p1 = [textNode('<h1>Lumen Dental</h1>'), textNode(long('Smile design and veneers in Antalya for international patients.', 40)), imageNode('')];
  wfState.dom.p2 = [textNode('<h1>About us</h1>'), textNode(long('Our team works with a fully digital workflow.', 45)), imageNode('The clinic in Antalya')];
  wfState.dom.p3 = [{ id: 'c1', type: 'component-instance', componentId: 'cmpHero', propertyOverrides: [] }, textNode('<p>Implants, crowns and whitening.</p>')];

  const handler = require('../api/index.js');
  const app = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    req.query = Object.fromEntries(u.searchParams);
    req.query.path = u.pathname.replace(/^\//, '');
    handler(req, res);
  });
  const appPort = await listen(app);
  const post = (p, cookie, body) => request(appPort, 'POST', p, { headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', origin: APP }, body: typeof body === 'string' ? body : form(body) });
  let r = await request(appPort, 'GET', '/auth');
  const state = new URL(r.headers.location).searchParams.get('state');
  r = await request(appPort, 'GET', '/callback?code=good-code&state=' + state, { headers: { cookie: cookiesFrom(r) } });
  const cookie = cookiesFrom(r);
  if (!cookie) { console.log('  FAIL the test could not sign in to the app (' + r.status + ' ' + (r.headers.location || '') + ')'); process.exit(1); }
  await post('/app/setup', cookie, { id: 'siteA', brand: 'Lumen Dental', country: 'GB', language: 'en', rivals: 'Bright Smile Clinic', own: 'veneers in antalya\ndental implants antalya' });
  for (let i = 0; i < 14; i++) { const x = await post('/app/run/pump', cookie, 'id=siteA'); const j = JSON.parse(x.body); if (j.finished || j.idle) break; }
  await post('/app/site/audit', cookie, { id: 'siteA' });
  await post('/app/site/report', cookie, { id: 'siteA' });
  const site = getJ('site:siteA');
  const k = site.keywords[0];
  await post('/app/keyword/plan', cookie, { id: 'siteA', k: k.id });
  await post('/app/fix/suggest', cookie, { id: 'siteA', path: '/' });
  const store = require('../api/_lib/store');
  const loginToken = await store.createLoginToken('user_1');
  const reportToken = getJ('site:siteA').settings.reportToken;
  assert(site.keywords.length === 2 && getJ('audit:siteA') && reportToken && loginToken, 'the app has a site with checked keywords, a Site health read, a fix plan, a suggestion and a report link to show');

  /* ---- the browser ---- */
  const TYPES = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml' };
  const STATIC = { '/': 'index.html', '/docs': 'docs.html', '/privacy': 'privacy.html', '/terms': 'terms.html' };
  const browser = await playwright.chromium.launch();
  const lowContrast = (page) => page.evaluate(() => {
    const parse = (c) => { c = String(c); let m = c.match(/^color\(srgb\s+([^)]+)\)/); if (m) { const p = m[1].split(/[\s/]+/).filter(Boolean).map(Number); return [p[0] * 255, p[1] * 255, p[2] * 255, p.length > 3 ? p[3] : 1]; } m = c.match(/rgba?\(([^)]+)\)/); if (!m) return [0, 0, 0, 0]; const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
    const over = (top, under) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat([1]); };
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const behind = (el) => { const layers = []; let img = false; for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); let c = parse(cs.backgroundColor); if (cs.backgroundImage && cs.backgroundImage !== 'none') { const g = cs.backgroundImage.match(/^linear-gradient\((rgba?\([^)]+\)), (rgba?\([^)]+\))\)$/); if (g && g[1] === g[2]) c = parse(g[1]); else img = true; } if (c[3] > 0) { layers.push(c); if (c[3] === 1) break; } } let out = [255, 255, 255, 1]; for (let i = layers.length - 1; i >= 0; i--) out = over(layers[i], out); out.img = img; return out; };
    const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity) > 0 && !el.closest('[hidden], [aria-hidden="true"], svg, script, style, noscript, template'); };
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      if (!shown(el) || el.closest('[disabled]')) continue;
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      const field = el.matches('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea, select') && el.value;
      if (!own && !field) continue;
      const cs = getComputedStyle(el);
      const bg = behind(el);
      const fg = over(parse(cs.color), bg);
      // opacity of ancestors dims the text too
      let op = 1; for (let e = el; e; e = e.parentElement) op *= parseFloat(getComputedStyle(e).opacity);
      const fg2 = op < 1 ? over([fg[0], fg[1], fg[2], op], bg) : fg;
      const r = ratio(fg2, bg);
      const px = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700;
      const need = px >= 24 || (px >= 18.66 && bold) ? 3 : 4.5;
      if (r < need) out.push({ what: (el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '')), text: (el.value || el.textContent).trim().replace(/\s+/g, ' ').slice(0, 40), ratio: +r.toFixed(2), need, color: cs.color, bg: 'rgb(' + bg.slice(0, 3).map(Math.round).join(', ') + ')' + (bg.img ? ' +image' : ''), size: px });
    }
    return out;
  });
  const kid = encodeURIComponent(k.id);
  const PAGES = [
    ['home', '/'], ['guide', '/docs'], ['privacy policy', '/privacy'], ['terms', '/terms'],
    ['sign in', '/login', 'out'], ['sign in, link sent', '/login?sent=1', 'out'], ['sign in link', '/l/' + loginToken, 'out'], ['client report', '/r/' + reportToken, 'out'],
    ['sites', '/app'], ['sites, with the authorized ones', '/app?available=1'], ['setup', '/app/setup?id=siteA'],
    ['site overview', '/app/site?id=siteA'], ['keywords', '/app/site?id=siteA&tab=keywords'], ['discover', '/app/site?id=siteA&tab=discover'], ['rivals and sources', '/app/site?id=siteA&tab=rivals'],
    ['Site health', '/app/site?id=siteA&tab=audit'], ['site settings', '/app/site?id=siteA&tab=setup'],
    ['keyword', '/app/keyword?id=siteA&k=' + kid], ['fix a page', '/app/fix?id=siteA&page=%2F'], ['fix a page with nothing to fix', '/app/fix?id=siteA&page=%2Fabout'],
    ['account', '/app/settings'], ['start a trial', '/app/start?plan=solo&interval=monthly'], ['a site that is not there', '/app/site?id=nope'], ['an address that is not there', '/nothing-here-at-all', 'out']
  ];
  const setPlan = (plan) => { const u = getJ('user:user_1'); u.plan = plan; u.billing = plan === 'free' ? {} : { subscriptionId: 'sub_1', status: 'active', renewsAt: Date.now() + 20 * 86400000 }; db.set('user:user_1', JSON.stringify(u)); };
  let pagesSeen = 0;
  for (const plan of ['free', 'solo']) {
    setPlan(plan);
    for (const scheme of ['light', 'dark']) {
      console.log('the ' + scheme + ' theme, ' + (plan === 'free' ? 'on the free plan' : 'on a paid plan'));
      // animations at rest, so that text is measured as it stands and not half faded in
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: scheme, reducedMotion: 'reduce' });
      const others = [];
      await context.route('**/*', async (route) => {
        const u = new URL(route.request().url());
        // fonts and anything else from another host: the pages are measured without them
        if (u.origin !== APP) { others.push(u.host); return route.abort(); }
        const rel = u.pathname.slice(1);
        const file = STATIC[u.pathname] || (rel && !rel.includes('..') && fs.existsSync(path.join(root, 'public', rel)) && fs.statSync(path.join(root, 'public', rel)).isFile() ? rel : '');
        if (file) return route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(path.join(root, 'public', file)) });
        // redirects are followed here, so the browser always gets a page
        const res = await route.fetch({ url: 'http://127.0.0.1:' + appPort + u.pathname + u.search }).catch(() => null);
        if (!res) return route.abort();
        return route.fulfill({ response: res });
      });
      const signedIn = cookie.split('; ').map((c) => { const i = c.indexOf('='); return { name: c.slice(0, i), value: c.slice(i + 1), domain: 'aiseodeck.silitlabs.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }; });
      const page = await context.newPage();
      for (const [name, url, who] of PAGES) {
        // the public pages look the same on every plan: once is enough
        if (plan !== 'free' && (who === 'out' || STATIC[url])) continue;
        await context.clearCookies();
        if (who !== 'out') await context.addCookies(signedIn);
        let low = null, texts = 0;
        try {
          await page.goto(APP + url, { waitUntil: 'load', timeout: 20000 });
          await page.waitForTimeout(url === '/' ? 1500 : 150);
          // what is folded away is text too
          await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
          texts = await page.evaluate(() => document.body.innerText.trim().length);
          low = await lowContrast(page);
        } catch (e) { low = [{ what: 'the page did not load', text: String(e.message).slice(0, 120), ratio: 0, need: 0, color: '', bg: '' }]; }
        pagesSeen++;
        const seen = new Set();
        const list = low.filter((x) => { const key = x.what + x.color + x.bg; if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 5).map((x) => x.what + ' "' + x.text + '" ' + x.ratio + ' of ' + x.need + ' (' + x.color + ' on ' + x.bg + ')');
        assert(low.length === 0 && texts > 40, name + ': every text reads' + (low.length ? ' (' + low.length + ' do not: ' + list.join('; ') + ')' : texts > 40 ? '' : ' (the page is empty)'));
      }
      await context.close();
    }
  }
  assert(pagesSeen === PAGES.length * 2 + PAGES.filter((p) => p[2] !== 'out' && !STATIC[p[1]]).length * 2, 'every page was measured in both themes, and the pages of the app on both plans (' + pagesSeen + ' page views)');

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
