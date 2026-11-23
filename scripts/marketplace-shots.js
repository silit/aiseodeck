'use strict';
// Makes the pictures for the Marketplace listing from the app itself, with a made-up business (Tallyhawk, a
// bookkeeping app). The real server code answers; the services behind it are the stand-ins the tests use, so
// nothing leaves this machine and no real site or account is shown. The answers of the AI engines are written
// here and go through the app's own analysis, so every number on the screens is one the app computed.
//
//   node scripts/marketplace-shots.js <out folder> [fonts folder]
//
// out folder: gets raw/*.png (as rendered) and 1280x846/*.png (what the listing takes).
// fonts folder (optional): a folder that holds @fontsource-variable/montserrat and
// @fontsource-variable/martian-mono (npm i --no-save them somewhere). Without it the pages ask Google Fonts.
// Needs Playwright with Chromium, and Python with Pillow for the last step (the resize to 1280 x 846).

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const playwright = require('playwright');
const M = require('../test/mocks');
const { listen, db, wfState, textNode, imageNode, findPage } = M;

const OUT = path.resolve(process.argv[2] || 'shots');
const FONTS = process.argv[3] ? path.resolve(process.argv[3]) : '';
const RAW = path.join(OUT, 'raw'), FINAL = path.join(OUT, '1280x846');
for (const d of [RAW, FINAL]) fs.mkdirSync(d, { recursive: true });

const DAY = 86400000;
const APP = 'https://aiseodeck.silitlabs.com';
const PANEL = 'https://cid.webflow-ext.com';
const ENG = ['openai', 'aio', 'aimode', 'gemini', 'claude', 'grok'];
const SEARCH = ['aio', 'aimode'];

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
const getJ = (k) => { const v = db.get(k); return v ? JSON.parse(v) : null; };

/* ---------- the made-up business ---------- */
// For each keyword: its monthly searches, and for the four weekly checks one letter per engine, in the order of
// ENG. b: names Tallyhawk and links its site. n: names it. o: names a rival. x: Google shows no AI answer.
const KEYWORDS = [
  ['invoicing software for small business', 6600, ['oooooo', 'oooooo', 'ooonoo', 'ooonoo']],
  ['bookkeeping app for freelancers', 2900, ['ooxooo', 'nonooo', 'bonboo', 'bonbno']],
  ['expense tracker for contractors', 1300, ['nonooo', 'nonnoo', 'nbnnoo', 'nbnnon']],
  ['accounting app for self employed', 880, ['ooxooo', 'onxooo', 'onxboo', 'onxboo']],
  ['receipt scanner app', 720, ['oooooo', 'oooooo', 'onoooo', 'onooon']],
  ['tax software for freelancers', 590, ['nnnooo', 'bnnoon', 'bnnbon', 'bnnbon']]
];
const RIVAL_OF = { openai: 'Ledgerbird', aio: 'Ledgerbird', aimode: 'Sumwise', gemini: 'Ledgerbird', claude: 'Sumwise', grok: 'Ledgerbird' };
const REVIEW_SITES = [
  { url: 'https://www.freelancerstack.com/best-invoicing-tools', title: 'Best invoicing tools for freelancers', host: 'freelancerstack.com' },
  { url: 'https://www.smallbizreviews.net/accounting-software', title: 'Accounting software, compared', host: 'smallbizreviews.net' },
  { url: 'https://invoicinghub.io/guides/small-business', title: 'Invoicing for a small business', host: 'invoicinghub.io' }
];
function answerFor(letter, engine, keyword, question) {
  const rival = RIVAL_OF[engine];
  const other = rival === 'Ledgerbird' ? 'Sumwise' : 'Ledgerbird';
  const cost = /cost|price|much/i.test(question);
  if (letter === 'b' || letter === 'n') {
    const text = cost
      ? `Tallyhawk starts at $12 a month and includes invoices, card payments and receipt scanning. ${rival} starts at $15 a month, and ${other} has a free plan for up to five clients.`
      : `Tallyhawk and ${rival} are the two names that come up most for ${keyword}. Tallyhawk is simpler if you mostly send invoices and track what clients still owe you, while ${rival} goes deeper on reports.`;
    const sources = letter === 'b' ? [{ url: 'https://tallyhawk.com/invoicing', title: 'Invoicing | Tallyhawk', host: 'tallyhawk.com' }, REVIEW_SITES[0]] : [REVIEW_SITES[0], REVIEW_SITES[1]];
    return { text, sources };
  }
  const text = cost
    ? `${rival} starts at $15 a month and ${other} has a free plan for up to five clients. Both can send recurring invoices and remind clients who pay late.`
    : `${rival} is the easiest place to start for most people who search for ${keyword}. It connects to your bank, sends invoices from a phone and keeps receipts with the job they belong to.`;
  return { text, sources: cost ? [REVIEW_SITES[1], { url: 'https://www.' + rival.toLowerCase() + '.com/pricing', title: rival + ' pricing', host: rival.toLowerCase() + '.com' }] : [REVIEW_SITES[1], REVIEW_SITES[2]] };
}

(async () => {
  const redisPort = await listen(M.redis);
  const aiPort = await listen(M.ai);
  const resendPort = await listen(M.resend);
  const wfPort = await listen(M.webflow);
  const polarPort = await listen(M.polar);
  Object.assign(process.env, {
    WEBFLOW_CLIENT_ID: 'cid', WEBFLOW_CLIENT_SECRET: 'sec', SESSION_SECRET: 'a-secret-for-the-screenshots-only-0001', APP_URL: APP, CRON_SECRET: 'cronkey',
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
  delete process.env.PERPLEXITY_ENABLED;

  /* ---- the site in the stand-in for Webflow ---- */
  const long = (sentence, times) => '<p>' + (sentence + ' ').repeat(times) + '</p>';
  const copied = { title: '', titleCopied: true, description: '', descriptionCopied: true };
  wfState.sites = [{ id: 's1', workspaceId: 'ws1', displayName: 'Tallyhawk', shortName: 'tallyhawk', customDomains: [{ id: 'd0', url: 'tallyhawk.com' }] }];
  wfState.pages.s1 = [
    { id: 'p1', title: 'Home', slug: 'home', publishedPath: '/', seo: { title: 'Tallyhawk', description: 'Bookkeeping for people who work for themselves: invoices, expenses and tax time in one simple app.' }, openGraph: copied },
    { id: 'p2', title: 'Invoicing', slug: 'invoicing', publishedPath: '/invoicing', seo: { title: 'Invoicing', description: '' }, openGraph: copied },
    { id: 'p3', title: 'Pricing', slug: 'pricing', publishedPath: '/pricing', seo: { title: 'Tallyhawk pricing: plans for freelancers and small teams', description: 'Tallyhawk costs $12 a month for one person and $29 a month for a team of five. Every plan includes invoices, expenses and receipt scanning.' }, openGraph: { title: '', titleCopied: false, description: '', descriptionCopied: false } },
    { id: 'p4', title: 'Expenses', slug: 'expenses', publishedPath: '/expenses', seo: { title: 'Expense tracker for contractors and freelancers | Tallyhawk', description: 'Scan a receipt with your phone and Tallyhawk files it under the right job. See what each contract really costs you, before tax time.' }, openGraph: copied },
    { id: 'p5', title: 'For freelancers', slug: 'freelancers', publishedPath: '/freelancers', seo: { title: 'Bookkeeping app for freelancers | Tallyhawk', description: 'Send invoices, track expenses and set money aside for tax in one app made for freelancers. Free for your first three clients.' }, openGraph: copied },
    { id: 'tpl', title: 'Blog Posts Template', slug: 'detail_blog', publishedPath: '/blog/detail_blog', collectionId: 'colBlog', seo: { title: '{{wf {"path":"name","type":"PlainText"} }}', description: '{{wf {"path":"summary","type":"PlainText"} }}' }, openGraph: copied }
  ];
  wfState.dom.p1 = [textNode('<h1>Bookkeeping that takes ten minutes a week</h1>'), textNode(long('Tallyhawk sends your invoices, files your receipts and tells you what to set aside for tax.', 24)), imageNode('The Tallyhawk dashboard on a laptop'), imageNode('')];
  wfState.dom.p2 = [textNode('<h1>Invoices that get paid</h1>'), textNode(long('Create an invoice in a minute, take card payments and see who still owes you.', 12)), imageNode('')];
  wfState.dom.p3 = [textNode('<h1>Simple pricing</h1>'), textNode(long('One price for one person and one price for a team, with every feature included.', 26)), imageNode('The three plans side by side')];
  wfState.dom.p4 = [textNode('<h1>Every receipt, filed</h1>'), textNode('<h1>Built for contractors</h1>'), textNode(long('Scan a receipt and Tallyhawk reads the amount, the date and the supplier for you.', 26)), imageNode('A receipt being scanned with a phone')];
  wfState.dom.p5 = [textNode('<h1>Made for freelancers</h1>'), textNode(long('Invoices, expenses and tax in one place, so the paperwork takes minutes and not evenings.', 28)), imageNode('A freelancer sending an invoice')];

  /* ---- the app, signed in ---- */
  const handler = require('../api/index.js');
  const store = require('../api/_lib/store');
  const jobs = require('../api/_lib/jobs');
  const analyze = require('../api/_lib/analyze');
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
  if (!cookie) throw new Error('could not sign in to the app: ' + r.status + ' ' + (r.headers.location || ''));
  const sessionCookie = cookie.split('; ').map((c) => { const i = c.indexOf('='); return { name: c.slice(0, i), value: c.slice(i + 1) }; });

  /* ---- an account on the Studio plan with six keywords and four weekly checks ---- */
  const user0 = getJ('user:user_1');
  user0.plan = 'studio';
  user0.name = 'Maya Okafor';
  user0.settings = Object.assign({}, user0.settings, { digest: false, brand: 'Northlight Studio' });
  db.set('user:user_1', JSON.stringify(user0));
  const now = Date.now();
  const keywords = KEYWORDS.map(([text, volume], i) => ({ id: 'kw' + (i + 1), text, questions: ['What is the best ' + text + '?', 'How much does ' + (/app|software|tracker/.test(text) ? 'a good ' : '') + text + ' cost?'], volume, source: 'manual', page: '', at: now - 30 * DAY, fixedAt: null }));
  await store.updateSite('s1', (s) => {
    s.project = { brand: 'Tallyhawk', aliases: [], domains: ['tallyhawk.com', 'tallyhawk.webflow.io'], competitors: [{ name: 'Ledgerbird', domain: '' }, { name: 'Sumwise', domain: '' }], country: 'US', language: 'en', ready: true };
    s.keywords = keywords;
    s.tracked = true;
    s.createdAt = now - 30 * DAY;
  });
  for (let w = 0; w < 4; w++) {
    const at = now - (3 - w) * 7 * DAY - 2 * DAY;
    const site = await store.getSite('s1');
    const user = await store.getUser('user_1');
    const run = await store.createRun(site, user, ENG, 'scheduled');
    run.at = at - 120000;
    await store.saveRun(run);
    for (const u of run.units) {
      const kwIndex = keywords.findIndex((k) => k.id === u.k);
      for (const e of ENG) {
        if ((u.q === 'k') !== SEARCH.includes(e)) continue;
        let letter = KEYWORDS[kwIndex][2][w][ENG.indexOf(e)];
        // a chat engine is asked two questions: when it names the business, it does so on the first
        if (u.q === '1' && (letter === 'n' || letter === 'b')) letter = 'o';
        const base = { p: u.id, k: u.k, q: u.q, e };
        if (letter === 'x') { await store.saveResult(run.id, u.id + '|' + e, Object.assign(base, { ok: true, none: true, at, ms: 2100, model: e })); continue; }
        const ans = answerFor(letter, e, keywords[kwIndex].text, u.text);
        const queries = SEARCH.includes(e) ? [] : ['best ' + keywords[kwIndex].text + ' 2026', keywords[kwIndex].text + ' reviews'];
        await store.saveResult(run.id, u.id + '|' + e, Object.assign(base, { ok: true, at, ms: 3200, model: e, text: ans.text, queries }, analyze.analyzeAnswer(run.project, ans)));
      }
    }
    await jobs.finishRun(run, at);
  }
  // what the engines say about the business, as the Insights of the last check
  await store.updateSite('s1', (s) => {
    s.sched.nextRunAt = now + 5 * DAY;
    if (s.latest) s.latest.insights = { at: now - 2 * DAY, sentiment: { positive: 9, neutral: 5, negative: 0 }, words: ['simple', 'invoices', 'freelancers', 'receipt scanning'], claims: [{ text: 'Tallyhawk starts at $12 a month', check: 'Still your price?' }] };
  });

  /* ---- Site health, read through the stand-in for the Webflow API, and a fix written from one page ---- */
  r = await post('/app/site/audit', cookie, { id: 's1' });
  const audit = getJ('audit:s1');
  if (!audit || audit.source !== 'webflow-data-api') throw new Error('Site health did not run: ' + r.status + ' ' + (r.headers.location || ''));
  const kInv = keywords[0];
  await store.updateSite('s1', (s) => { const k = s.keywords.find((x) => x.id === kInv.id); if (k) k.page = '/invoicing'; });
  const rowInv = audit.pages.find((p) => p.path === '/invoicing');
  await store.saveDraft('s1', 'kwfix:' + kInv.id, {
    at: Date.now(),
    meta: { title: 'Invoicing software for small business | Tallyhawk', description: 'Create and send invoices in minutes, take card payments and see who still owes you. Invoicing software built for small businesses.' },
    faq: [
      { q: 'What is the best invoicing software for a small business?', a: 'Tallyhawk sends invoices, takes card payments and reminds clients when a payment is late. It is made for small businesses that mostly need to bill clients and see what is still owed.' },
      { q: 'How much does invoicing software cost?', a: 'Tallyhawk costs $12 a month for one person and $29 a month for a team of five. Every plan includes invoices, expenses and receipt scanning.' }
    ],
    path: '/invoicing',
    was: { title: rowInv.title, description: rowInv.description, readAt: Date.now() }
  });
  // the same suggestion on the fix of that page, as "Write a suggestion with AI" leaves it
  await store.saveDraft('s1', 'fix:' + require('crypto').createHash('sha1').update('/invoicing').digest('hex').slice(0, 16), {
    meta: { title: 'Invoicing software for small business | Tallyhawk', description: 'Create and send invoices in minutes, take card payments and see who still owes you. Invoicing software built for small businesses.' },
    faq: [
      { q: 'How fast can I send my first invoice?', a: 'Most people send their first invoice within ten minutes of signing up: add your client, add a line and press send.' },
      { q: 'Can clients pay an invoice by card?', a: 'Yes. Every invoice has a pay button, and Tallyhawk marks it as paid when the money arrives.' }
    ]
  });

  /* ---- the browser ---- */
  const browser = await playwright.chromium.launch();
  const fontCss = (() => {
    if (!FONTS) return null;
    const F = path.join(FONTS, '@fontsource-variable');
    const files = {
      'm-latin.woff2': path.join(F, 'montserrat/files/montserrat-latin-wght-normal.woff2'),
      'm-latin-ext.woff2': path.join(F, 'montserrat/files/montserrat-latin-ext-wght-normal.woff2'),
      'mm-latin.woff2': path.join(F, 'martian-mono/files/martian-mono-latin-standard-normal.woff2'),
      'mm-latin-ext.woff2': path.join(F, 'martian-mono/files/martian-mono-latin-ext-standard-normal.woff2')
    };
    for (const f of Object.values(files)) if (!fs.existsSync(f)) throw new Error('font file missing: ' + f);
    const L = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
    const LX = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';
    const css = [['Montserrat', 'm-latin-ext.woff2', '100 900', '100%', LX], ['Montserrat', 'm-latin.woff2', '100 900', '100%', L], ['Martian Mono', 'mm-latin-ext.woff2', '100 800', '75% 112.5%', LX], ['Martian Mono', 'mm-latin.woff2', '100 800', '75% 112.5%', L]]
      .map(([fam, f, w, s, range]) => `@font-face{font-family:'${fam}';font-style:normal;font-display:block;font-weight:${w};font-stretch:${s};src:url(https://fonts.gstatic.com/kit/${f}) format('woff2');unicode-range:${range}}`).join('\n');
    return { css, files };
  })();
  const routeAll = async (context) => {
    if (fontCss) {
      await context.route(/fonts\.googleapis\.com/, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: fontCss.css }));
      await context.route(/fonts\.gstatic\.com\/kit\//, (route) => route.fulfill({ status: 200, contentType: 'font/woff2', path: fontCss.files[route.request().url().split('/kit/')[1]] }));
    }
    await context.route(APP + '/**', async (route) => {
      const u = new URL(route.request().url());
      const res = await route.fetch({ url: 'http://127.0.0.1:' + appPort + u.pathname + u.search, maxRedirects: 0 });
      await route.fulfill({ response: res });
    });
  };

  // Each picture is framed by the elements it has to show: the page is zoomed out only as far as needed for them to
  // fit in 1280 x 846, and is rendered at twice that size.
  const box = (sel, i) => `(function(){var e=[].slice.call(document.querySelectorAll(${JSON.stringify(sel)})).filter(function(x){return x.offsetParent!==null})[${i || 0}];if(!e)return null;var b=e.getBoundingClientRect();return {top:b.top+scrollY,bottom:b.bottom+scrollY};})()`;
  // from/to: the first and the last element the picture has to hold. slack: how far below the last one it may end.
  const SHOTS = [
    { name: '1-ai-visibility', page: 'overview', from: '.pagehead', padTop: 400, to: '.ov', padBottom: 8, slack: 20, minZoom: 0.85 },
    { name: '2-every-engine', page: 'keywords', from: 'section.addbox', padTop: 18, to: 'section.deck', padBottom: 14, slack: 60, minZoom: 0.85 },
    { name: '3-what-ai-said', page: 'answers', from: '.pagehead', padTop: 400, to: 'ul.lanes > li', padBottom: 10, slack: 40, minZoom: 0.76 },
    { name: '4-fix-in-webflow', page: 'fix', from: '.head', padTop: 400, to: 'section.panel.stack', padBottom: 14, slack: 420, minZoom: 0.9 },
    { name: 'extra-site-health', page: 'health', from: '.pagehead', padTop: 400, to: 'div.tablewrap ~ .tiny', padBottom: 34, slack: 120, minZoom: 0.85 }
  ].filter((x) => !process.env.ONLY || process.env.ONLY.split(',').includes(x.name));
  const context = await browser.newContext({ viewport: { width: 1280, height: 846 }, deviceScaleFactor: 2 });
  await routeAll(context);
  await context.addCookies(sessionCookie.map((c) => ({ name: c.name, value: c.value, domain: 'aiseodeck.silitlabs.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' })));
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(e.message));

  // The pages, saved as they are, so a frame can be chosen by looking at them.
  const PAGES = {
    overview: '/app/site?id=s1',
    keywords: '/app/site?id=s1&tab=keywords',
    health: '/app/site?id=s1&tab=audit',
    keyword: '/app/keyword?id=s1&k=' + kInv.id,
    answers: '/app/keyword?id=s1&k=' + keywords[1].id + '#answers',
    fix: '/app/fix?id=s1&page=' + encodeURIComponent('/invoicing'),
    sites: '/app'
  };
  if (process.env.DUMP) {
    fs.mkdirSync(process.env.DUMP, { recursive: true });
    for (const [name, p] of Object.entries(PAGES)) {
      const res = await request(appPort, 'GET', p, { headers: { cookie } });
      fs.writeFileSync(path.join(process.env.DUMP, name + '.html'), res.body);
      await page.goto(APP + p);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: path.join(process.env.DUMP, name + '.png'), fullPage: true });
      console.log('dumped', name, res.status, res.body.length);
    }
  }

  for (const s of SHOTS) {
    await page.setViewportSize({ width: 1280, height: 846 });
    await page.goto(APP + PAGES[s.page] + (s.hash ? '#' + s.hash : ''));
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(250);
    if (s.click) { await page.locator(s.click).first().click(); await page.waitForTimeout(250); }
    const frame = `(function(){var a=${box(s.from, s.fromIndex)},b=${box(s.to, s.toIndex)};if(!a||!b)return null;return {top:a.top-${s.padTop == null ? 16 : s.padTop},min:b.bottom+${s.padBottom == null ? 14 : s.padBottom},max:b.bottom+${s.slack == null ? 70 : s.slack}};})()`;
    let picked = null;
    for (let z = 1; z >= (s.minZoom || 0.8) - 1e-9; z -= 0.004) {
      const vw = Math.round(1280 / z), vh = Math.round(846 / z);
      await page.setViewportSize({ width: vw, height: vh });
      await page.waitForTimeout(40);
      const f = await page.evaluate(frame);
      if (!f) throw new Error(s.name + ': the elements that frame this picture are not on the page');
      const top = Math.max(0, Math.round(f.top));
      const maxScroll = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
      const y = Math.min(top, Math.max(0, maxScroll));
      const end = y + vh;
      if (end >= f.min && (end <= f.max || y === Math.max(0, maxScroll))) { picked = { z, vw, vh, y }; break; }
    }
    if (!picked) { console.log(s.name, 'does not fit'); continue; }
    await page.evaluate((y) => window.scrollTo(0, y), picked.y);
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(RAW, s.name + '.png') });
    console.log(s.name, JSON.stringify({ zoom: +picked.z.toFixed(3), viewport: picked.vw + 'x' + picked.vh, y: picked.y }));
  }
  await context.close();

  /* ---- the panel in the Designer: three moments, side by side ---- */
  if (process.env.PANEL !== '0') {
    const panelDir = path.join(__dirname, '..', 'extension', 'public');
    const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2' };
    const pctx = await browser.newContext({ viewport: { width: 320, height: 600 }, deviceScaleFactor: 2, colorScheme: 'dark' });
    await routeAll(pctx);
    await pctx.route(PANEL + '/**', (route) => {
      const u = new URL(route.request().url());
      const full = path.join(panelDir, u.pathname === '/' ? 'index.html' : u.pathname.slice(1));
      return route.fulfill({ status: 200, contentType: TYPES[path.extname(full)] || 'application/octet-stream', body: fs.readFileSync(full) });
    });
    // the writer of the tests answers for a dental clinic: for these pictures the suggestion is the one made above
    await pctx.route(APP + '/ext/suggest', async (route) => {
      const res = await route.fetch({ url: 'http://127.0.0.1:' + appPort + '/ext/suggest' });
      const j = await res.json();
      if (j && j.ok && j.meta) { j.meta = { title: 'Invoicing software for small business | Tallyhawk', description: 'Create and send invoices in minutes, take card payments and see who still owes you. Invoicing software built for small businesses.' }; j.keyword = kInv.text; }
      return route.fulfill({ response: res, json: j });
    });
    const designerPages = { p2: { name: 'Invoicing', slug: 'invoicing', path: '/invoicing', title: 'Invoicing', description: '' } };
    await pctx.addInitScript((pages) => {
      const st = (window.__wf = { siteId: 's1', pageId: 'p2', pages });
      const pageObj = (id) => { const p = st.pages[id]; return { id, type: 'Page', getName: async () => p.name, isHomepage: async () => false, getPublishPath: async () => p.path, getSlug: async () => p.slug, getTitle: async () => p.title, getDescription: async () => p.description, getCollectionId: async () => null, setTitle: async (t) => { p.title = t; await window.__designerSaved(id, 'title', t); }, setDescription: async (d) => { p.description = d; await window.__designerSaved(id, 'description', d); } }; };
      window.webflow = {
        getSiteInfo: async () => ({ siteId: st.siteId, siteName: 'Tallyhawk', shortName: 'tallyhawk', domains: [{ url: 'https://tallyhawk.com', default: true }] }),
        getCurrentPage: async () => pageObj(st.pageId), getIdToken: async () => 'idt:' + st.siteId, setExtensionSize: async () => {}, subscribe: () => () => {}, notify: async () => {}
      };
    }, designerPages);
    const pp = await pctx.newPage();
    pp.on('pageerror', (e) => problems.push('panel: ' + e.message));
    await pp.exposeFunction('__designerSaved', (id, field, value) => { const f = findPage(id); if (f) f.pg.seo = Object.assign({}, f.pg.seo, { [field]: value }); });
    const settled = () => pp.waitForFunction(() => !document.querySelector('.loading'), null, { timeout: 15000 });
    await pp.goto(PANEL + '/index.html');
    await settled();
    await pp.evaluate(() => document.fonts.ready);
    await pp.screenshot({ path: path.join(RAW, 'panel-1-page.png') });
    await pp.locator('ul.fixes li button').first().click();
    await pp.waitForSelector('#mt');
    await pp.getByRole('button', { name: 'Write with AI', exact: true }).click();
    await pp.waitForFunction(() => /Written by AI/.test(document.body.textContent), null, { timeout: 15000 });
    await pp.screenshot({ path: path.join(RAW, 'panel-2-suggestion.png') });
    await pp.getByRole('button', { name: 'Apply to this page', exact: true }).click();
    await pp.waitForFunction(() => /Title and description set/.test(document.body.textContent), null, { timeout: 15000 });
    await pp.screenshot({ path: path.join(RAW, 'panel-3-applied.png') });
    await pctx.close();

    const compose = `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400..700&display=swap"><style>
:root{--bg:#F3F5FB;--ink:#0F1433;--muted:#535A7E}
html,body{margin:0}
body{width:1280px;height:846px;background:var(--bg);color:var(--ink);font-family:"Montserrat",system-ui,sans-serif;-webkit-font-smoothing:antialiased;overflow:hidden}
.wrap{padding:58px 140px 0;display:flex;flex-direction:column}
h1{margin:0;font-size:31px;line-height:38px;font-weight:700;letter-spacing:-.01em}
p{margin:8px 0 0;font-size:16px;line-height:24px;color:var(--muted)}
.row{margin-top:28px;display:flex;gap:20px}
figure{margin:0;width:320px;display:flex;flex-direction:column;gap:12px}
.frame{width:320px;height:600px;border-radius:12px;overflow:hidden;box-shadow:0 1px 2px rgba(15,20,51,.10),0 14px 34px rgba(15,20,51,.16)}
.frame img{display:block;width:320px;height:600px}
figcaption{font-size:14px;line-height:20px;font-weight:600;text-align:center}
</style></head><body><div class="wrap">
<h1>Fix the page you are editing, right in the Designer</h1>
<p>Open it from the Apps panel. Nothing changes until you press Apply, and nothing goes live until you publish.</p>
<div class="row">
<figure><div class="frame"><img src="data:image/png;base64,${fs.readFileSync(path.join(RAW, 'panel-1-page.png')).toString('base64')}" alt=""></div><figcaption>The page&#8217;s keyword on every AI engine</figcaption></figure>
<figure><div class="frame"><img src="data:image/png;base64,${fs.readFileSync(path.join(RAW, 'panel-2-suggestion.png')).toString('base64')}" alt=""></div><figcaption>A suggestion written from the page</figcaption></figure>
<figure><div class="frame"><img src="data:image/png;base64,${fs.readFileSync(path.join(RAW, 'panel-3-applied.png')).toString('base64')}" alt=""></div><figcaption>Set on the page when you press Apply</figcaption></figure>
</div></div></body></html>`;
    const cctx = await browser.newContext({ viewport: { width: 1280, height: 846 }, deviceScaleFactor: 2 });
    await routeAll(cctx);
    const cp = await cctx.newPage();
    await cp.setContent(compose);
    await cp.evaluate(() => document.fonts.ready);
    await cp.waitForTimeout(300);
    await cp.screenshot({ path: path.join(RAW, '5-designer-panel.png') });
    await cctx.close();
    console.log('5-designer-panel made from three panel pictures');
  }
  await browser.close();

  // the listing takes 1280 x 846
  const names = fs.readdirSync(RAW).filter((f) => /^(\d|extra)-.*\.png$/.test(f));
  if (names.length) {
    execFileSync('python3', ['-c', 'import sys\nfrom PIL import Image\nfor n in sys.argv[3:]:\n    im = Image.open(sys.argv[1] + "/" + n).convert("RGB")\n    im.resize((1280, 846), Image.LANCZOS).save(sys.argv[2] + "/" + n, optimize=True)\n    print("  " + n, im.size, "-> 1280x846")', RAW, FINAL].concat(names), { stdio: 'inherit' });
  }
  if (problems.length) console.log('page errors:', problems.join(' | '));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
