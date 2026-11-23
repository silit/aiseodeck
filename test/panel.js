// The Designer panel (extension/public), run in a real browser against the real app code.
// The panel's files are served from the address Webflow gives a Designer Extension, under a strict Content
// Security Policy, and its calls go to the app handler with the mock Webflow behind it. A small stand-in for
// the Designer API (window.webflow) plays the Designer. Run: node test/panel.js
// Needs Playwright with Chromium. Without it the test says so and passes, so `npm test` works everywhere.
const http = require('http');
const fs = require('fs');
const path = require('path');

let playwright;
try { playwright = require('playwright'); } catch (e) {
  console.log('panel test skipped: Playwright is not installed here. Install it (npm i -D playwright, then npx playwright install chromium) to run the Designer panel in a browser.');
  process.exit(0);
}

const M = require('./mocks');
const { listen, db, wfState, textNode, imageNode, findPage } = M;

let passed = 0, failed = 0;
function assert(c, m) { if (c) { passed++; console.log('  ok   ' + m); } else { failed++; console.log('  FAIL ' + m); } }
const root = path.join(__dirname, '..');
const panelDir = path.join(root, 'extension', 'public');
const shotDir = process.env.PANEL_SHOTS || '';
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
  Object.assign(process.env, {
    WEBFLOW_CLIENT_ID: 'cid', WEBFLOW_CLIENT_SECRET: 'sec', SESSION_SECRET: 'test-session-secret-which-is-long', APP_URL: 'https://aiseodeck.silitlabs.com', CRON_SECRET: 'cronkey',
    REVOKE_CONFIRM_MS: '0',
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

  /* ---- the site in the mock Webflow ---- */
  const long = (sentence, times) => '<p>' + (sentence + ' ').repeat(times) + '</p>';
  wfState.sites = [{ id: 'siteA', workspaceId: 'ws1', displayName: 'Lumen Dental', shortName: 'lumen-dental', customDomains: [{ id: 'd0', url: 'lumendental.com' }] }];
  const copied = { title: '', titleCopied: true, description: '', descriptionCopied: true };
  wfState.pages.siteA = [
    { id: 'p1', title: 'Home', slug: 'home', publishedPath: '/', seo: { title: 'Lumen Dental', description: 'Dentist.' }, openGraph: copied },
    { id: 'p2', title: 'About', slug: 'about', publishedPath: '/about', seo: { title: 'Veneers in Antalya | About Lumen Dental', description: 'Meet the Lumen Dental team in Antalya: digital smile design, veneers and implants for patients from the UK and Ireland.' }, openGraph: copied },
    { id: 'p3', title: 'Services', slug: 'services', publishedPath: '/services', seo: { title: 'Dental services in Antalya | Lumen Dental', description: 'Implants, crowns, whitening and smile design at Lumen Dental in Antalya, planned with a fully digital workflow.' }, openGraph: copied },
    { id: 'tpl', title: 'Blog Template', slug: 'detail_blog', publishedPath: '/blog/detail_blog', collectionId: 'colBlog', seo: { title: '{{wf {"path":"name","type":"PlainText"} }}', description: '{{wf {"path":"summary","type":"PlainText"} }}' }, openGraph: copied }
  ];
  wfState.dom.p1 = [textNode('<h1>Lumen Dental</h1>'), textNode(long('Smile design and veneers in Antalya for international patients.', 40)), imageNode('')];
  wfState.dom.p2 = [textNode('<h1>About us</h1>'), textNode(long('Our team works with a fully digital workflow.', 45)), imageNode('The clinic in Antalya')];
  // a page whose heading and most of its text sit inside components
  wfState.dom.p3 = [{ id: 'c1', type: 'component-instance', componentId: 'cmpHero', propertyOverrides: [] }, textNode('<p>Implants, crowns and whitening.</p>'), { id: 'c2', type: 'component-instance', componentId: 'cmpList', propertyOverrides: [] }];

  /* ---- the app, with one connected site that has a keyword and a Site health read ---- */
  const handler = require('../api/index.js');
  const app = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    req.query = Object.fromEntries(u.searchParams);
    req.query.path = u.pathname.replace(/^\//, '');
    handler(req, res);
  });
  const appPort = await listen(app);
  const post = (p, cookie, body) => request(appPort, 'POST', p, { headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', origin: 'https://aiseodeck.silitlabs.com' }, body: typeof body === 'string' ? body : form(body) });
  let r = await request(appPort, 'GET', '/auth');
  const state = new URL(r.headers.location).searchParams.get('state');
  r = await request(appPort, 'GET', '/callback?code=good-code&state=' + state, { headers: { cookie: cookiesFrom(r) } });
  const cookie = cookiesFrom(r);
  if (!cookie) { console.log('  FAIL the test could not sign in to the app (' + r.status + ' ' + (r.headers.location || '') + ')'); process.exit(1); }
  r = await post('/app/setup', cookie, { id: 'siteA', brand: 'Lumen Dental', country: 'GB', language: 'en', rivals: 'Bright Smile Clinic', own: 'veneers in antalya' });
  for (let i = 0; i < 12; i++) { const x = await post('/app/run/pump', cookie, 'id=siteA'); const j = JSON.parse(x.body); if (j.finished || j.idle) break; }
  const user0 = getJ('user:user_1'); user0.plan = 'solo'; db.set('user:user_1', JSON.stringify(user0));
  r = await post('/app/site/audit', cookie, { id: 'siteA' });
  const site0 = getJ('site:siteA');
  assert(site0 && site0.keywords.length === 1 && site0.kw[site0.keywords[0].id] && getJ('audit:siteA').pagesChecked === 4, 'the app has a connected site with a checked keyword and a Site health read to show in the panel');
  // a page made in Webflow after Site health read the site
  wfState.pages.siteA.push({ id: 'pNew', title: 'Pricing', slug: 'pricing', publishedPath: '/pricing', seo: { title: 'Prices at Lumen Dental in Antalya, per treatment', description: '' }, openGraph: copied });
  wfState.dom.pNew = [textNode('<h1>Prices</h1>'), textNode(long('Every plan is priced per treatment.', 60))];

  /* ---- the browser ---- */
  const PANEL = 'https://cid.webflow-ext.com';
  const APP = 'https://aiseodeck.silitlabs.com';
  // What a strict host allows a Designer Extension: its own files, no inline script or style, and its own server.
  const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src " + APP + "; base-uri 'none'; form-action 'none'";
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
  const browser = await playwright.chromium.launch();
  const context = await browser.newContext({ viewport: { width: 320, height: 600 } });
  const servePanel = (route) => {
    const u = new URL(route.request().url());
    const full = path.join(panelDir, u.pathname === '/' ? 'index.html' : u.pathname.slice(1));
    if (!full.startsWith(panelDir + path.sep) || !fs.existsSync(full)) return route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' });
    return route.fulfill({ status: 200, contentType: TYPES[path.extname(full)] || 'application/octet-stream', headers: { 'Content-Security-Policy': CSP }, body: fs.readFileSync(full) });
  };
  await context.route(PANEL + '/**', servePanel);
  await context.route('https://other.webflow-ext.com/**', servePanel);
  const calls = [];
  const others = [];
  let tamper = null; // a test may change what the app answered before the panel gets it
  await context.route(APP + '/**', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    let body = null;
    try { body = req.postData() ? JSON.parse(req.postData()) : null; } catch (e) { body = req.postData(); }
    const res = await route.fetch({ url: 'http://127.0.0.1:' + appPort + u.pathname + u.search });
    calls.push({ method: req.method(), path: u.pathname, origin: req.headers().origin || '', body, status: res.status() });
    if (tamper && u.pathname === '/ext/context') { const j = await res.json(); tamper(j); return route.fulfill({ response: res, json: j }); }
    await route.fulfill({ response: res });
  });
  // anything else the panel asks for is a finding of its own
  await context.route((url) => ![PANEL, APP, 'https://other.webflow-ext.com'].includes(url.origin), (route) => { others.push(route.request().url()); route.abort(); });

  const designerPages = {
    p1: { name: 'Home', slug: 'home', path: '/', home: true, title: 'Lumen Dental', description: 'Dentist.' },
    p2: { name: 'About', slug: 'about', path: '/about', title: 'Veneers in Antalya | About Lumen Dental', description: 'Meet the Lumen Dental team in Antalya: digital smile design, veneers and implants for patients from the UK and Ireland.' },
    p3: { name: 'Services', slug: 'services', path: '/services', title: 'Dental services in Antalya | Lumen Dental', description: 'Implants, crowns, whitening and smile design at Lumen Dental in Antalya, planned with a fully digital workflow.' },
    tpl: { name: 'Blog Template', slug: 'detail_blog', path: '/blog/detail_blog', title: '', description: '', collectionId: 'colBlog' },
    pNew: { name: 'Pricing', slug: 'pricing', path: '/pricing', title: 'Prices at Lumen Dental in Antalya, per treatment', description: '' }
  };
  // The stand-in for the Designer API: the calls the panel uses, and a record of what it asked the Designer to do.
  await context.addInitScript((pages) => {
    const st = (window.__wf = { siteId: 'siteA', pageId: 'p1', pages, sets: [], notes: [], sizes: [], sub: null, tokens: 0, refuse: false, noPage: false });
    const pageObj = (id) => {
      const p = st.pages[id];
      return {
        id, type: 'Page',
        getName: async () => p.name, isHomepage: async () => !!p.home, getPublishPath: async () => p.path, getSlug: async () => p.slug,
        getTitle: async () => p.title, getDescription: async () => p.description, getCollectionId: async () => p.collectionId || null,
        setTitle: async (t) => { if (st.refuse) throw new Error('Not in Design mode'); p.title = t; st.sets.push(['title', id, t]); await window.__designerSaved(id, 'title', t); },
        setDescription: async (d) => { if (st.refuse) throw new Error('Not in Design mode'); p.description = d; st.sets.push(['description', id, d]); await window.__designerSaved(id, 'description', d); }
      };
    };
    window.webflow = {
      getSiteInfo: async () => ({ siteId: st.siteId, siteName: 'Lumen Dental', shortName: 'lumen-dental', domains: [{ url: 'https://lumen-dental.webflow.io', default: false }, { url: 'https://lumendental.com', default: true }] }),
      getCurrentPage: async () => (st.noPage ? null : pageObj(st.pageId)),
      getIdToken: async () => { st.tokens++; return 'idt:' + st.siteId; },
      setExtensionSize: async (size) => { st.sizes.push(size); },
      subscribe: (name, cb) => { st.sub = { name, cb }; return () => {}; },
      notify: async (o) => { st.notes.push(o); }
    };
  }, designerPages);

  const problems = [];
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  // what the Designer does when the panel sets a value: the page in Webflow has it
  await page.exposeFunction('__designerSaved', (id, field, value) => { const f = findPage(id); if (f) f.pg.seo = Object.assign({}, f.pg.seo, { [field]: value }); });

  const text = (sel) => page.locator(sel).first().innerText();
  const all = (sel) => page.locator(sel).allInnerTexts();
  const settled = async () => { await page.waitForFunction(() => !document.querySelector('.loading'), null, { timeout: 15000 }); };
  const shot = async (name) => { if (shotDir) await page.screenshot({ path: path.join(shotDir, name + '.png') }); };
  const wf = (fn, arg) => page.evaluate(fn, arg);
  const switchTo = async (id) => { await wf((x) => { window.__wf.pageId = x; window.__wf.sub.cb(); }, id); await page.waitForFunction((x) => { const p = document.querySelector('.here .p'); return p && p.textContent === window.__wf.pages[x].path && !document.querySelector('.loading'); }, id, { timeout: 15000 }); };
  const fixes = async () => (await page.locator('ul.fixes li').evaluateAll((els) => els.map((li) => ({ title: li.querySelector('b').textContent, note: (li.querySelector('.nt') || {}).textContent || '', button: (li.querySelector('button') || {}).textContent || '', kind: li.querySelector('.ic').className.replace('ic ', '') }))));
  const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && [...document.querySelectorAll('#app *')].every((el) => el.getBoundingClientRect().right <= window.innerWidth + 0.5));
  const unnamed = () => page.evaluate(() => [...document.querySelectorAll('button, a, input, textarea')].filter((el) => {
    if (el.matches('input, textarea')) return !(el.id && document.querySelector('label[for="' + el.id + '"]')) && !el.getAttribute('aria-label');
    return !(el.textContent || '').trim() && !el.getAttribute('aria-label');
  }).map((el) => el.outerHTML.slice(0, 80)));

  console.log('the home page: what the Designer has now, and what Site health found');
  await page.goto(PANEL + '/index.html');
  await settled();
  await shot('01-home');
  assert((await text('.top b')) === 'AI SEO Deck' && (await text('.here .nm')) === 'Home' && (await text('.here .p')) === '/', 'the panel opens on the page that is open in the Designer');
  let list = await fixes();
  assert(list.length === 3 && list[0].title === 'Title length' && list[0].note === '12 characters now. Aim for 35 to 60 characters, with the keyword.' && list[0].button === 'Fix', 'the title finding is made from the title the Designer has now, with the length to aim for');
  assert(list[1].title === 'Description length' && list[1].note === '8 characters now. Aim for 120 to 155 characters.' && list[1].button === 'Fix', 'and so is the description finding');
  assert(list[2].title === 'Alt text' && list[2].note === 'Images without alt text' && list[2].button === '' && (await text('.sec .hd span')) === '3 things to fix', 'the finding on images comes from Site health and has no button, because the panel does not change images');
  const note = (await text('.sec .note')).replace(/\s+/g, ' ');
  assert(note.startsWith('Title and description: as the Designer has them now. Headings, text and images: read from Webflow by Site health just now.') && note.includes('Refresh in Site health') && note.includes('Read this page again'), 'the panel says where each part comes from and when it was read, with a way to read again');
  assert((await page.locator('.sec .note a').getAttribute('href')) === APP + '/app/site?id=siteA&tab=audit' && (await page.locator('.sec .note a').getAttribute('target')) === '_blank' && /noopener/.test(await page.locator('.sec .note a').getAttribute('rel')), 'links to the app open in a new tab, only when clicked');
  assert((await text('.foot .note')) === 'Fixes go into this page in the Designer. Publish the site when you are ready.' && (await page.locator('.foot a.btn').getAttribute('href')).startsWith(APP + '/app/site?id=siteA'), 'the footer leads to the full report');
  const first = calls.filter((c) => c.method === 'POST');
  assert(first.length === 1 && first[0].path === '/ext/context' && first[0].origin === PANEL && first[0].status === 200 && Object.keys(first[0].body).sort().join() === 'idToken,pageId,path,siteId' && first[0].body.idToken === 'idt:siteA', 'opening the panel makes one call to the app, with the Webflow ID token, the site, the page and nothing else');
  assert(!/https?:\/\//.test(fs.readFileSync(path.join(panelDir, 'app.js'), 'utf8').replace("var API = 'https://aiseodeck.silitlabs.com';", '')) && !/https?:\/\//.test(fs.readFileSync(path.join(panelDir, 'index.html'), 'utf8')) && !/https?:\/\//.test(fs.readFileSync(path.join(panelDir, 'app.css'), 'utf8')), 'the only address written in the files of the panel is the address of the app, over HTTPS');
  assert(await wf(() => window.__wf.sets.length === 0 && window.__wf.sub && window.__wf.sub.name === 'currentpage'), 'nothing is changed on load, and the panel follows the page that is open');
  assert(await noOverflow(), 'nothing runs out of the 320 pixel panel');
  assert((await unnamed()).length === 0, 'every control has a name a screen reader can say');

  console.log('writing a title and description');
  await page.locator('ul.fixes li button', { hasText: 'Fix' }).first().click();
  await page.waitForSelector('#mt');
  await shot('02-editor');
  assert((await all('.now .v')).join(' | ') === 'Lumen Dental | Dentist.' && (await text('.now .k')) === 'On this page now, in the Designer', 'the editor shows what the page has now, apart from the fields');
  assert((await page.inputValue('#mt')) === 'Lumen Dental' && (await page.inputValue('#md')) === 'Dentist.' && (await page.locator('.tag:visible').count()) === 0, 'the fields start from the current values, with no AI label');
  assert((await all('.field .count')).join(' | ') === '12 characters, aim for 35 to 60 | 8 characters, aim for 120 to 155' && (await page.locator('.field .count.ok').count()) === 0, 'each field counts its characters against the length to aim for');
  const updatesBefore = wfState.pageUpdates.length;
  await page.locator('button', { hasText: 'Write with AI' }).click();
  await page.waitForFunction(() => document.querySelector('.msg.ok'));
  await shot('03-suggested');
  assert((await page.inputValue('#mt')) === 'Veneers and smile design in Antalya | Lumen Dental' && (await page.inputValue('#md')).startsWith('Digital smile design, veneers and implants in Antalya'), 'Write with AI puts a suggestion into the fields');
  assert((await page.locator('.tag:visible').count()) === 2 && (await all('.tag:visible')).every((t) => t === 'Suggested by AI') && (await all('.now .v')).join(' | ') === 'Lumen Dental | Dentist.', 'the suggestion is labelled as written by AI, and what the page has now still stands next to it');
  assert((await text('.msg.ok')).includes('It is a suggestion: nothing is changed until you press Apply.') && wfState.pageUpdates.length === updatesBefore && (await wf(() => window.__wf.sets.length)) === 0, 'writing a suggestion changes nothing in Webflow');
  const sug = calls.filter((c) => c.path === '/ext/suggest');
  assert(sug.length === 1 && sug[0].status === 200 && sug[0].body.what === 'meta' && !('title' in sug[0].body), 'the suggestion is asked for once, when the button is pressed');
  await page.locator('#mt').fill('Veneers and smile design in Antalya | Lumen Dental clinic');
  assert((await page.locator('.tag:visible').count()) === 1 && (await page.locator('.field', { has: page.locator('#md') }).locator('.tag:visible').count()) === 1, 'a field the user edits is no longer labelled as the AI\'s text');
  assert((await page.locator('.field .count.ok').count()) === 2 && (await text('.serp .t')) === 'Veneers and smile design in Antalya | Lumen Dental clinic' && (await text('.serp .u')) === 'lumendental.com', 'the counters turn good inside the range, and the preview follows the fields with the site\'s own domain');

  console.log('applying, on the click of the user');
  await wf(() => { window.__wf.refuse = true; });
  await page.locator('button', { hasText: 'Apply to this page' }).click();
  await page.waitForFunction(() => document.querySelector('.msg.err'));
  assert((await text('.msg.err')) === 'The Designer did not take the change. Switch to Design mode and try again.' && !calls.some((c) => c.path === '/ext/applied') && (await page.inputValue('#mt')).endsWith('clinic'), 'when the Designer refuses the change the panel says so, keeps the text and tells the app nothing');
  await wf(() => { window.__wf.refuse = false; });
  await page.locator('button', { hasText: 'Apply to this page' }).click();
  await page.waitForFunction(() => document.querySelector('.msg.ok') && document.querySelector('ul.fixes'));
  await shot('04-applied');
  const sets = await wf(() => window.__wf.sets);
  assert(sets.length === 2 && sets[0].join('|') === 'title|p1|Veneers and smile design in Antalya | Lumen Dental clinic' && sets[1][0] === 'description' && sets[1][1] === 'p1', 'Apply sets the title and the description on the open page through the Designer API');
  const applied = calls.filter((c) => c.path === '/ext/applied');
  assert(applied.length === 1 && applied[0].status === 200 && !('title' in applied[0].body) && !('description' in applied[0].body), 'the app is told that a fix was applied, not what the values are');
  assert(wfState.pageUpdates.length === updatesBefore && getJ('audit:siteA').pages.find((p) => p.path === '/').title === 'Veneers and smile design in Antalya | Lumen Dental clinic', 'the server writes nothing to Webflow for the panel, and Site health takes the new values from Webflow');
  list = await fixes();
  assert((await text('.msg.ok')) === 'Title and description set on this page. Publish the site to make them live.' && list[0].title === 'Title and description are fine' && list[0].kind === 'good' && list[0].button === 'Edit' && list.length === 2 && (await text('.sec .hd span')) === '1 thing to fix', 'after Apply the list shows the page as the Designer has it now');
  assert((await wf(() => window.__wf.notes)).some((n) => n.type === 'Success' && /Publish the site/.test(n.message)), 'and the Designer shows its own confirmation');

  console.log('other pages');
  await switchTo('p2');
  await shot('05-keyword');
  list = await fixes();
  const kw = await page.locator('section.card[aria-label^="Keyword"]').first().innerText();
  assert((await text('.here .nm')) === 'About' && kw.includes('veneers in antalya') && (await page.locator('.strip .m').count()) >= 3 && list.length === 1 && list[0].title === 'Title and description are fine' && (await text('.sec .hd span')) === 'Nothing to fix', 'switching pages in the Designer shows that page, with its keyword and each AI engine');
  assert((await page.locator('.strip .m').evaluateAll((els) => els.every((el) => el.getAttribute('role') === 'img' && /: /.test(el.getAttribute('aria-label') || '')))), 'each engine mark says in words what it means');
  await switchTo('p3');
  await shot('06-components');
  list = await fixes();
  assert(list.some((x) => x.title === 'No H1: not determined' && x.kind === 'info' && /inside components, which this read does not open/.test(x.note)) && !list.some((x) => x.title === 'No H1') && (await text('.sec .hd span')) === 'Nothing to fix', 'a heading that may sit inside a component is "not determined", never reported as missing');
  await switchTo('tpl');
  await shot('07-template');
  list = await fixes();
  assert(list.length >= 1 && list[0].title === 'Collection template' && list[0].kind === 'info' && !list.some((x) => x.button), 'a Collection template is explained and has no fix button');
  await switchTo('pNew');
  await shot('08-not-read');
  list = await fixes();
  const noteNew = (await text('.sec .note')).replace(/\s+/g, ' ');
  assert(list.length === 1 && list[0].title === 'No meta description' && list[0].button === 'Write' && noteNew.includes('checked by Site health, which has not read this page yet.') && noteNew.includes('Open Site health'), 'a page Site health has not read yet still gets its title and description checked from the Designer, and the panel says what is missing');
  await page.locator('ul.fixes li button', { hasText: 'Write' }).click();
  await page.waitForSelector('#mt');
  assert((await all('.now .v')).join(' | ') === 'Prices at Lumen Dental in Antalya, per treatment | (no meta description)', 'an empty value is shown as empty, not left blank');
  await page.locator('button', { hasText: 'Write with AI' }).click();
  await page.waitForFunction(() => document.querySelector('.msg.ok, .msg.err'));
  assert((await page.locator('.msg.ok').count()) === 1 && calls.filter((c) => c.path === '/ext/suggest').pop().status === 200, 'and the writer reads that page from Webflow when asked');
  await page.locator('.top .back').click();
  await page.waitForSelector('ul.fixes');
  assert((await wf(() => window.__wf.sets.length)) === 2, 'going back applies nothing');
  assert((await wf(() => window.__wf.tokens)) === calls.filter((c) => c.method === 'POST').length, 'every call to the app carries an ID token asked from the Designer for that call: none is kept');
  await page.locator('.linkbtn', { hasText: 'Read this page again' }).click();
  await settled();
  assert(calls.filter((c) => c.path === '/ext/context').pop().body.pageId === 'pNew', '"Read this page again" asks the Designer and the app again');

  console.log('the free plan, a site that is not connected, and a foreign address');
  const u1 = getJ('user:user_1'); u1.plan = 'free'; u1.billing = {}; db.set('user:user_1', JSON.stringify(u1));
  await switchTo('p1');
  assert((await text('.foot .note')) === 'Applying fixes is part of the paid plans. You can write and copy them on the free plan.', 'on the free plan the panel says that applying is a paid feature');
  await page.locator('ul.fixes li button', { hasText: 'Edit' }).click();
  await page.waitForSelector('#mt');
  await shot('09-free');
  assert(await page.locator('button', { hasText: 'Apply to this page' }).isDisabled() && (await page.locator('.msg.info a').getAttribute('href')) === APP + '/app/settings#plan' && !(await page.locator('button', { hasText: 'Write with AI' }).isDisabled()), 'Apply is off, writing still works, and the plans are one click away');
  await wf(() => { window.__wf.siteId = 'siteNotConnected'; window.__wf.sub.cb(); });
  await page.waitForFunction(() => /Connect this site/.test(document.body.textContent));
  await shot('10-connect');
  assert((await page.locator('a.btn.mark').getAttribute('href')) === APP + '/app?available=1' && (await text('.card h2')) === 'Connect this site to AI SEO Deck' && (await page.locator('.card button', { hasText: 'Try again' }).count()) === 1, 'a site the app cannot confirm gets a link to the Sites page, where it can be connected, and a way to try again');
  {
    // whatever address an answer carries, a link of the panel only ever leads to the app
    const hrefs = [];
    for (const bad of ['javascript:void(document.title=1)', 'https://evil.example/app?available=1', 'https://aiseodeck.silitlabs.com.evil.example/app', '//evil.example/x', 'data:text/html,x']) {
      tamper = (j) => { j.connectUrl = bad; };
      // Try again clears the card at once and draws it again when the app has answered
      await page.locator('.card button', { hasText: 'Try again' }).click();
      await page.waitForSelector('a.btn.mark');
      hrefs.push(await page.locator('a.btn.mark').getAttribute('href'));
    }
    tamper = null;
    assert(hrefs.length === 5 && hrefs.every((x) => x === APP + '/app'), 'a link of the panel can only lead to the app itself: any other address in an answer is replaced (got: ' + [...new Set(hrefs)].join(', ') + ')');
    await page.locator('.card button', { hasText: 'Try again' }).click();
    await page.waitForFunction((want) => { const a = document.querySelector('a.btn.mark'); return a && a.getAttribute('href') === want; }, APP + '/app?available=1');
  }
  await wf(() => { window.__wf.siteId = 'siteA'; window.__wf.noPage = true; window.__wf.sub.cb(); });
  await page.waitForFunction(() => document.querySelector('.msg.err'));
  assert(/Switch to a page|Open a page/.test(await text('.msg.err')), 'with no page open the panel asks to open one');
  assert(problems.length === 0, 'the browser reported no error, no warning and no Content Security Policy violation' + (problems.length ? ': ' + problems.slice(0, 4).join(' || ') : ''));
  assert(others.length === 0, 'the panel asked for nothing outside its own files and the app' + (others.length ? ': ' + others.slice(0, 4).join(', ') : ''));

  const foreign = await context.newPage();
  const foreignProblems = [];
  foreign.on('console', (m) => { if (m.type() === 'error') foreignProblems.push(m.text()); });
  const before = calls.length;
  await foreign.goto('https://other.webflow-ext.com/index.html');
  await foreign.waitForFunction(() => document.querySelector('.msg.err'), null, { timeout: 15000 });
  const fromOther = calls.slice(before);
  assert(fromOther.length >= 1 && fromOther.every((c) => c.status === 403 && c.origin === 'https://other.webflow-ext.com') && /could not be reached|may not call/.test(await foreign.locator('.msg.err').innerText()), 'the same panel served from another address gets nothing from the app');

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
