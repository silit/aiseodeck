// End-to-end test: mock Webflow, mock Upstash Redis, mock AI engines (OpenAI, Perplexity, Gemini),
// mock Resend and mock Polar. The customer's published website is here too, only to prove that the app
// never requests it: everything the app knows about a site comes from the Webflow API. Run: node test/app.js
const http = require('http');
const crypto = require('crypto');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { passed++; console.log('  ok   ' + m); } else { failed++; console.log('  FAIL ' + m); } }
const { listen, db, ttl, redis, engineCalls, flags, ai, emails, resend, wfState, textNode, imageNode, webflow, polarState, polar } = require('./mocks');

/* ---- the customer's published website ---- */
// The app must never request it. This server counts what it gets, and the run ends by checking that it got nothing.
const customerHits = [];
const customer = http.createServer((req, res) => { customerHits.push(req.method + ' ' + req.url); res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<h1>The published site</h1>'); });

// Every address the app requests during the run, to check at the end that each one is a service the app is
// meant to call (Webflow's API, the AI and keyword data providers, the mail and billing providers, its database).
const requestedHosts = new Set();
{
  const realFetch = global.fetch;
  global.fetch = (input, init) => {
    try { requestedHosts.add(new URL(typeof input === 'string' ? input : input.url).host); } catch (e) { requestedHosts.add('unreadable: ' + String(input).slice(0, 60)); }
    return realFetch(input, init);
  };
}

/* ---- app under test ---- */
function startApp() {
  const handler = require('../api/index.js');
  return http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    req.query = Object.fromEntries(u.searchParams);
    req.query.path = u.pathname.replace(/^\//, '');
    handler(req, res);
  });
}
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

(async () => {
  const redisPort = await listen(redis);
  const custPort = await listen(customer);
  const aiPort = await listen(ai);
  const resendPort = await listen(resend);
  const wfPort = await listen(webflow);
  const polarPort = await listen(polar);
  Object.assign(process.env, {
    WEBFLOW_CLIENT_ID: 'cid', WEBFLOW_CLIENT_SECRET: 'sec', SESSION_SECRET: 'test-session-secret-which-is-long', APP_URL: 'https://app.test', CRON_SECRET: 'cronkey',
    SITE_URL_SCHEME: 'http',
    KV_REST_API_URL: 'http://127.0.0.1:' + redisPort, KV_REST_API_TOKEN: 't',
    WEBFLOW_API_BASE: 'http://127.0.0.1:' + wfPort, WEBFLOW_AUTH_BASE: 'http://127.0.0.1:' + wfPort,
    RESEND_API_KEY: 'rk', RESEND_API_BASE: 'http://127.0.0.1:' + resendPort, EMAIL_FROM: 'AI SEO Deck <t@test>',
    OPENAI_API_KEY: 'ok', OPENAI_API_BASE: 'http://127.0.0.1:' + aiPort,
    // Perplexity is off in the app until PERPLEXITY_ENABLED=1; the end-to-end runs keep it on to test the engine
    PERPLEXITY_API_KEY: 'pk', PERPLEXITY_API_BASE: 'http://127.0.0.1:' + aiPort, PERPLEXITY_ENABLED: '1',
    GEMINI_API_KEY: 'gk', GEMINI_API_BASE: 'http://127.0.0.1:' + aiPort,
    ANTHROPIC_API_KEY: 'ak', ANTHROPIC_API_BASE: 'http://127.0.0.1:' + aiPort,
    XAI_API_KEY: 'xk', XAI_API_BASE: 'http://127.0.0.1:' + aiPort + '/xai',
    DATAFORSEO_LOGIN: 'dl', DATAFORSEO_PASSWORD: 'dp', DATAFORSEO_API_BASE: 'http://127.0.0.1:' + aiPort,
    POLAR_ACCESS_TOKEN: 'polar_oat', POLAR_API_BASE: 'http://127.0.0.1:' + polarPort, POLAR_WEBHOOK_SECRET: 'whsec_' + Buffer.from('polar-secret-key').toString('base64')
  });
  const host = '127.0.0.1:' + custPort;
  wfState.sites = [{ id: 'siteA', workspaceId: 'ws1', displayName: 'Lumen Dental', shortName: 'lumen-dental', customDomains: [{ id: 'd1', url: host }, { id: 'd0', url: 'lumendental.com' }] }];
  // the pages as GET /v2/sites/:site_id/pages lists them, with their SEO and Open Graph settings
  const ABOUT_TITLE = 'About Lumen Dental Antalya | Our clinic and team';
  const ABOUT_DESC = 'Meet the Lumen Dental team in Antalya: digital smile design, veneers and implants for patients from the UK and Ireland.';
  wfState.pages.siteA = [
    { id: 'p1', title: 'Home', slug: 'home', publishedPath: '/', lastUpdated: '2026-11-20T09:00:00.000Z', seo: { title: 'Lumen Dental', description: 'Dentist.' }, openGraph: { title: '', titleCopied: true, description: '', descriptionCopied: true } },
    { id: 'p2', title: 'About', slug: 'about', publishedPath: '/about', lastUpdated: '2026-11-21T09:00:00.000Z', seo: { title: ABOUT_TITLE, description: ABOUT_DESC }, openGraph: { title: 'About', titleCopied: false, description: 'About', descriptionCopied: false } },
    { id: 'p404', title: '404', slug: '404', publishedPath: '/404', seo: {}, openGraph: {} },
    { id: 'pDraft', title: 'Coming soon', slug: 'soon', publishedPath: '/soon', draft: true, seo: {}, openGraph: {} },
    { id: 'tpl', title: 'Blog Template', slug: 'detail_blog', publishedPath: '/blog/[slug]', collectionId: 'colBlog', seo: { title: '{{wf {"path":"name","type":"PlainText"} }}', description: '' }, openGraph: { title: '', titleCopied: true, description: '', descriptionCopied: true } }
  ];
  // and what GET /v2/pages/:page_id/dom returns for the two static pages
  wfState.dom.p1 = [textNode('<h1>Lumen Dental</h1>'), textNode('<p>' + 'Smile design and veneers in Antalya for international patients. '.repeat(40) + '</p>'), imageNode('')];
  wfState.dom.p2 = [textNode('<h1>About us</h1>'), textNode('<h2>How long do veneers last?</h2>'), textNode('<p>Veneers usually last 10 to 15 years with good care and checkups twice a year.</p>'), textNode('<h2>Do I need a visa?</h2>'), textNode('<p>Most UK and Irish visitors do not need a visa for a short treatment stay in Turkey.</p>'), textNode('<p>' + 'Our team works with a fully digital workflow. '.repeat(40) + '</p>'), imageNode('__wf_reserved_decorative')];

  console.log('unit: analysis, audit, fixes, plans, keywords');
  {
    const html = require('../api/_lib/html');
    const fsite = { id: 's1', keywords: [{ id: 'a', text: 'alpha', volume: 100 }, { id: 'b', text: 'beta', volume: 5000 }, { id: 'c', text: 'gamma', volume: 900, fixedAt: Date.now() - 86400000 }, { id: 'd', text: 'delta', volume: 50 }],
      kw: { a: { eng: { openai: 'o', aio: 'n', perplexity: 'o' } }, b: { eng: { openai: 'o', aio: 'o', perplexity: 'o' }, lost: { openai: ['Rivalco'] } }, c: { eng: { openai: 'o', aio: 'o', perplexity: 'o' } }, d: { eng: { openai: 'n', aio: 'n', perplexity: 'o' } } } };
    const fx = html.fixNext(fsite);
    assert(fx.indexOf('>beta<') < fx.indexOf('>gamma<') && fx.indexOf('>gamma<') < fx.indexOf('>alpha<') && !fx.includes('>delta<') && fx.includes('Rivalco') && fx.includes('Check again'), 'fix next ranks by searches and gap, puts fresh fixes lower and skips keywords AI already names');
    assert(html.fixNext({ id: 's2', keywords: [{ id: 'x', text: 'x' }], kw: {} }) === '', 'no fix next before the first check');
  }
  {
    const a = require('../api/_lib/analyze');
    const proj = { brand: 'Lumen Dental', aliases: [], domains: ['lumendental.com'], competitors: [{ name: 'Bright Smile Clinic', domain: 'brightsmile.com' }] };
    const r = a.analyzeAnswer(proj, { text: 'Try Bright Smile Clinic or LUMEN-DENTAL in Antalya.', sources: [{ url: 'https://lumendental.com/x' }] });
    assert(r.mentioned && r.rank === 2 && r.of === 2 && r.cited, 'brand found despite case and dash, ranked 2nd after the rival, site cited');
    const t = a.analyzeAnswer(proj, { text: 'No names here.', sources: [] });
    assert(!t.mentioned && !t.cited && t.rank === 0, 'absent brand is not mentioned');
    const tr = a.analyzeAnswer({ brand: 'Şık Diş', domains: ['sikdis.com.tr'], competitors: [] }, { text: 'ŞIK DİŞ kliniği önerilir.', sources: [] });
    assert(tr.mentioned, 'Turkish letters match regardless of case and dots');
    const rows = [
      { e: 'openai', ok: true, mentioned: true, cited: true, rank: 1, comp: { 'Bright Smile Clinic': { m: true } }, hosts: ['lumendental.com', 'trustpilot.com'], queries: ['Veneers Antalya'], citedUrls: ['https://lumendental.com/veneers/'] },
      { e: 'openai', ok: true, mentioned: false, cited: false, comp: { 'Bright Smile Clinic': { m: true } }, hosts: ['trustpilot.com'], queries: ['veneers antalya'] },
      { e: 'aio', ok: true, none: true },
      { e: 'gemini', ok: false, err: 'x' },
      { e: 'claude', ok: true, mentioned: false, cited: false, comp: { 'Bright Smile Clinic': { m: true } }, hosts: [] }
    ];
    const ks = a.keywordSummary(proj, ['openai', 'aio', 'gemini', 'claude'], rows);
    assert(ks.n === 3 && ks.m === 1 && ks.c === 1 && ks.na === 1 && ks.f === 1 && Math.abs(ks.vis - 1 / 3) < 1e-9, 'keyword summary counts named, cited, no answer and failed');
    assert(ks.eng.openai === 'b' && ks.eng.aio === 'x' && ks.eng.gemini === 'f' && ks.eng.claude === 'o', 'one state per engine: named and cited, no AI answer, failed, not named');
    assert(ks.lost.claude && ks.lost.claude[0] === 'Bright Smile Clinic' && !ks.lost.openai, 'a rival wins on Claude, not on ChatGPT where the brand is named once');
    assert(ks.hosts[0][0] === 'trustpilot.com' && ks.queries[0] === 'veneers antalya' && ks.own[0][0] === 'https://lumendental.com/veneers', 'own site left out of sources, searches merged, own pages cited');
    assert(a.verdict(ks) === 'some' && a.verdict({ eng: { openai: 'n', aio: 'b', perplexity: 'o' } }) === 'yes' && a.verdict({ eng: { openai: 'o' } }) === 'no', 'yes, sometimes or no');
    const kw = require('../api/_lib/keywords');
    assert(kw.clean('  Veneers in ANTALYA? ') === 'veneers in antalya' && kw.clean('İzmir DİŞ') === 'izmir diş' && kw.clean('x') === '', 'keywords are cleaned and lowercased, Turkish İ included');
    const pages = [{ path: '/', title: 'Lumen Dental', h1: ['Lumen Dental'], ok: true, pageId: 'p1' }, { path: '/veneers', title: 'Veneers', description: 'Emax veneers in Antalya', ok: true, pageId: 'p9' }, { path: '/blog/x', title: 'Visa rules', ok: true }];
    const m = kw.matchPage('veneers in antalya', pages);
    assert(m && m.path === '/veneers' && m.static === true, 'a keyword matches the page about it');
    assert(kw.matchPage('wedding photographer lisbon', pages) === null, 'no page is matched when nothing fits');
    const pt = require('../api/_lib/pagetext');
    const tricky = '<h1>Teeth in a day</h1><style>/* the menu moves under <h1>; the item classes survive that move */ .m > a { display: flex !important; }</style><script>var s = "<h1>not a heading</h1>"; document.write("<!-- not a comment");</script><p>We place implants in one day.</p><!-- <script> --><p>Clinics across the UK.</p><script>var x = 1;</script>';
    const trickyRead = pt.readFragment(tricky);
    assert(trickyRead.text === 'Teeth in a day We place implants in one day. Clinics across the UK.' && trickyRead.words === 14 && trickyRead.h1.length === 1 && trickyRead.h1[0] === 'Teeth in a day', 'the text of a page leaves out scripts, styles and comments, and a heading written inside one is not a heading');
    assert(pt.visibleHtml('<p>a</p><style>p{}') === '<p>a</p> ' && pt.visibleHtml('<p>a</p><!-- open') === '<p>a</p> ' && pt.visibleHtml('<p>a</p><SCRIPT>x</SCRIPT ><p>b</p>') === '<p>a</p> <p>b</p>', 'a script, style or comment that is never closed runs to the end of the page, and tag names match in any case');
    assert(pt.visibleHtml('<p>a</p><script>var c = "<!--";</script><p>b</p><!-- <style> --><p>c</p>') === '<p>a</p> <p>b</p> <p>c</p>', 'what starts first wins: a comment mark inside a script and a style tag inside a comment hide nothing more');
    const qa = pt.readFragment('<h1>Veneers</h1><h2>How long do veneers last?</h2><p>Usually 10 to 15 years with good care.</p><h2>Our team</h2><p>Five dentists.</p><details><summary>Is it painful?</summary><p>No, the teeth are numbed first.</p></details><h3>Short?</h3><p>Yes.</p>');
    assert(qa.faq.length === 2 && qa.faq[0].q === 'How long do veneers last?' && qa.faq[0].a === 'Usually 10 to 15 years with good care.' && qa.faq[1].q === 'Is it painful?' && qa.headings.length === 4, 'questions a page answers: a heading that ends in a question mark with the text under it, or a details block; an answer of a few letters does not count');

    // Site health works on what the Webflow API returns for a page: its settings and its nodes
    const hl = require('../api/_lib/health');
    const fromNodes = hl.domToHtml([
      { id: 'a', type: 'text', text: { html: '<h1>Veneers in Antalya</h1>', text: 'Veneers in Antalya' } },
      { id: 'b', type: 'text', text: { html: null, text: 'Plain <b>text</b> & more' } },
      { id: 'c', type: 'image', image: { alt: 'A smile', assetId: 'x1' } },
      { id: 'd', type: 'image', image: { alt: '', assetId: 'x2' } },
      { id: 'e', type: 'image', image: { alt: '__wf_reserved_decorative', assetId: 'x3' } },
      { id: 'f', type: 'image', image: { alt: '__wf_reserved_inherit', assetId: 'x4' } },
      { id: 'g', type: 'component-instance', componentId: 'cmp1', propertyOverrides: [{ propertyId: 'p1', type: 'Plain Text', label: 'Button', text: { html: null, text: 'Book a call' } }] },
      { id: 'h', type: 'a-node-type-added-later' },
      null
    ]);
    const fromNodesRead = pt.readFragment(fromNodes.html);
    assert(fromNodes.components === 1 && fromNodes.imagesInherit === 1 && fromNodesRead.images === 4 && fromNodesRead.imagesNoAlt === 1 && fromNodesRead.h1.join() === 'Veneers in Antalya', 'the nodes of a page: an image with no alt text is counted, one marked decorative or using the alt of its asset is not, and component instances are counted');
    assert(fromNodesRead.text === 'Veneers in Antalya Plain <b>text</b> & more Book a call', 'text that Webflow gives without HTML is read as text, never as markup, and the text set on a component instance is read too');
    const pageMeta = { id: 'pg1', title: 'Veneers', slug: 'veneers', publishedPath: '/veneers', lastUpdated: '2026-11-02T10:00:00.000Z', seo: { title: 'Veneers in Antalya | Lumen Dental', description: 'Emax veneers planned with digital smile design in Antalya, for patients from the UK and Ireland.' }, openGraph: { title: '', titleCopied: true, description: '', descriptionCopied: false } };
    const thinRow = hl.rowFor(pageMeta, { h1: ['Veneers in Antalya'], words: 120, images: 2, imagesNoAlt: 1, components: 0, faq: [], readAt: 5 });
    assert(thinRow.issues.join() === 'og_missing,thin,alt_missing' && thinRow.unknown.length === 0 && thinRow.score === 78 && thinRow.og.title === true && thinRow.og.description === false && thinRow.contentAt === 5 && thinRow.metaAt > 0, 'a page row: an Open Graph title that copies the SEO title counts as set, an empty one that does not is a finding; thin text and a missing alt text are findings');
    const partRow = hl.rowFor(pageMeta, { h1: [], words: 120, images: 0, imagesNoAlt: 0, components: 2, faq: [], readAt: 5 });
    assert(partRow.issues.join() === 'og_missing' && partRow.unknown.join() === 'h1_missing,thin' && partRow.score === 94, 'what depends on text inside components is "not determined": it is never reported as a fact and takes nothing off the score');
    const cutRow = hl.rowFor(pageMeta, { h1: [], words: 120, images: 0, imagesNoAlt: 0, components: 0, truncated: true, faq: [], readAt: 5 });
    assert(cutRow.unknown.join() === 'h1_missing,thin' && cutRow.truncated === true, 'the same holds for a page too long to read in full');
    const twoH1 = hl.rowFor(pageMeta, { h1: ['One', 'Two', 'Three'], words: 400, images: 0, imagesNoAlt: 0, components: 3, faq: [], readAt: 5 });
    assert(twoH1.issues.includes('h1_multiple') && twoH1.h1Count === 3 && twoH1.h1.length === 2, 'more than one H1 is a fact even when part of the page is inside components');
    const tplUnit = hl.rowFor(Object.assign({}, pageMeta, { collectionId: 'col1', seo: { title: '{{wf {"path":"name"} }}', description: '' } }), null);
    assert(tplUnit.template && tplUnit.content === false && tplUnit.words === null && tplUnit.issues.join() === 'desc_missing,og_missing', 'a Collection template is checked on its settings only, and the length of a title made of a field binding is not judged');
    assert(hl.listed([{ id: 'a', publishedPath: '/' }, { id: 'b', publishedPath: '/404' }, { id: 'c', publishedPath: '/search' }, { id: 'd', publishedPath: '/x', draft: true }, { id: 'e', publishedPath: '/y', archived: true }, { id: 'f' }, { publishedPath: '/z' }, null]).map((p) => p.id).join() === 'a', 'utility pages, drafts, archived pages and pages without an address are left out of Site health');
    assert(hl.LIMITS.title.min === 20 && hl.LIMITS.title.max === 65 && hl.RULES.title_length.text.includes('20') && hl.RULES.title_length.text.includes('65') && hl.RULES.desc_length.text.includes('165'), 'the length limits are named once and the texts of the findings use them');
    {
      // Webflow's rate limit: wait and try again, three more times at most
      const wfLib = require('../api/_lib/webflow');
      const realFetch = global.fetch;
      let calls = 0;
      process.env.WEBFLOW_RETRY_BASE_MS = '1';
      global.fetch = async () => { calls++; return new Response(JSON.stringify(calls < 4 ? { message: 'slow down' } : { sites: [] }), { status: calls < 4 ? 429 : 200 }); };
      const sitesAfterWait = await wfLib.listSites('tok');
      assert(Array.isArray(sitesAfterWait) && calls === 4, 'a rate-limited Webflow call is tried again after a wait');
      calls = 0;
      global.fetch = async () => { calls++; return new Response(JSON.stringify({ message: 'slow down' }), { status: 429 }); };
      let gaveUp = null;
      try { await wfLib.listSites('tok'); } catch (e) { gaveUp = e; }
      assert(gaveUp && gaveUp.status === 429 && calls === 4 && gaveUp.retryAfter === 60, 'and after three more tries it gives up');
      // Webflow names the wait itself (Retry-After): a call is never tried again sooner than that
      calls = 0;
      global.fetch = async () => { calls++; return new Response(JSON.stringify({ message: 'slow down' }), { status: 429, headers: { 'Retry-After': '60', 'X-RateLimit-Remaining': '0' } }); };
      gaveUp = null;
      const t429 = Date.now();
      try { await wfLib.listSites('tok-limited'); } catch (e) { gaveUp = e; }
      assert(gaveUp && gaveUp.status === 429 && gaveUp.retryAfter === 60 && calls === 1 && Date.now() - t429 < 1000 && wfLib.callsLeft('tok-limited') === 0, 'when Webflow asks to wait a minute, the call is not tried again: it stops and says how long Webflow asked to wait');
      assert(wfLib.callsLeft('a-token-never-used') === null, 'how many calls are left is known only after Webflow said so');
      // a long page comes from Webflow in parts of 100 nodes
      let offsets = [];
      global.fetch = async (url) => {
        const q = new URL(String(url)).searchParams;
        const off = parseInt(q.get('offset'), 10);
        offsets.push(off + ':' + q.get('limit'));
        const n = Math.max(0, Math.min(100, 250 - off));
        return new Response(JSON.stringify({ pageId: 'pg1', nodes: Array.from({ length: n }, (_, i) => ({ id: 'n' + (off + i), type: 'text', text: { html: '<p>word</p>', text: 'word' } })), pagination: { limit: 100, offset: off, total: 250 }, lastUpdated: '2026-11-01T00:00:00.000Z' }), { status: 200 });
      };
      const whole = await wfLib.pageDom('tok', 'pg1');
      assert(whole.nodes.length === 250 && whole.total === 250 && !whole.truncated && offsets.join() === '0:100,100:100,200:100' && whole.lastUpdated === '2026-11-01T00:00:00.000Z', 'the content of a long page is read from Webflow in parts of 100 nodes');
      offsets = [];
      const cut = await wfLib.pageDom('tok', 'pg1', 200);
      assert(cut.nodes.length === 200 && cut.truncated && offsets.join() === '0:100,100:100', 'and a page longer than the limit is marked as read in part');
      const hl2 = require('../api/_lib/health');
      const longRead = await hl2.readContent('tok', 'pg1', 200);
      assert(longRead.truncated === true && longRead.words === 200 && longRead.readAt > 0, 'the content read says when it was read and whether it is complete');
      global.fetch = realFetch;
      delete process.env.WEBFLOW_RETRY_BASE_MS;
    }
    const { limitsFor } = require('../api/_lib/plans');
    assert(limitsFor({ plan: 'free', email: 'a@b.com' }).allEngines === false && limitsFor({ plan: 'free' }).keywords === 3 && limitsFor({ plan: 'solo' }).keywords === 10 && limitsFor({ plan: 'agency' }).keywords === 100 && limitsFor({ plan: 'solo' }).rechecks === 10 && limitsFor({ plan: 'studio' }).keywords === 30, 'plan limits in keywords and keyword checks');
    assert(limitsFor({ plan: 'free', email: 'reviewer@webflow.com' }).plan === 'agency', 'Webflow reviewers get Agency');
    const { parseFaq, parseRivals } = require('../api/index.js')._test;
    assert(parseFaq('Q: One?\nA: First answer\ncontinues\n\nQ: Two?\nA: Second').length === 2, 'FAQ text parses into pairs');
    assert(parseRivals('Bright Smile Clinic, https://www.brightsmile.com/\nX\nOther Co').length === 2, 'rivals parse; one-letter names are skipped');
    const st = require('../api/_lib/store');
    db.set('site:old1', JSON.stringify({ id: 'old1', project: {}, prompts: [{ id: 'p1', text: 'Best clinic for veneers in Antalya?', at: 1 }], sched: {}, settings: {} }));
    const old = await st.getSite('old1');
    assert(old.keywords.length === 1 && old.keywords[0].text === 'best clinic for veneers in antalya' && old.keywords[0].questions[0] === 'Best clinic for veneers in Antalya?' && !old.prompts && old.kw, 'sites saved with questions read as keywords asked as those questions');
    db.delete('site:old1');
  }

  console.log('unit: where the app sends requests');
  {
    const fs = require('fs');
    const pathLib = require('path');
    const root = pathLib.join(__dirname, '..');
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(pathLib.join(d, e.name)) : [pathLib.join(d, e.name)]));
    const code = walk(pathLib.join(root, 'api')).filter((f) => /\.(js|mjs|cjs|ts)$/.test(f)).map((f) => ({ f: pathLib.relative(root, f).split(pathLib.sep).join('/'), s: fs.readFileSync(f, 'utf8') }));
    const NET = /\bfetch\s*\(|\bhttps?\.(request|get)\s*\(|require\(\s*['"](node:)?(https?|http2|tls|dgram|dns|child_process|undici|axios|got|node-fetch|puppeteer|playwright)['"]\s*\)|\bimport\b[^;]*['"](node:)?(https?|http2|tls|undici|axios|got|node-fetch)['"]|\bnet\.(connect|createConnection|Socket|createServer)\b|XMLHttpRequest|WebSocket|EventSource/;
    const senders = code.filter((c) => NET.test(c.s)).map((c) => c.f).sort();
    assert(senders.join() === 'api/_lib/email.js,api/_lib/engines.js,api/_lib/html.js,api/_lib/keywords.js,api/_lib/kv.js,api/_lib/llm.js,api/_lib/polar.js,api/_lib/webflow.js',
      'requests leave the app from these modules only: the Webflow client, the AI engines, the writer, keyword data, mail, billing and the database (found: ' + senders.join(', ') + ')');
    const htmlSrc = code.find((c) => c.f === 'api/_lib/html.js').s;
    assert((htmlSrc.match(/\bfetch\s*\(/g) || []).length === 3 && (htmlSrc.match(/\bfetch\s*\(\s*'\/app\//g) || []).length === 3, "the scripts in the app's own pages call the app itself and nothing else");
    const wfSrc = code.find((c) => c.f === 'api/_lib/webflow.js').s;
    const wfLibEarly = require('../api/_lib/webflow');
    assert((wfSrc.match(/\bfetch\s*\(/g) || []).length === 2 && (wfSrc.match(/\bfetch\s*\(\s*API_BASE\(\) \+/g) || []).length === 2 && !/revoke_authorization'/.test(wfSrc) && !wfLibEarly.revokeToken, "every call of the Webflow client goes to Webflow's API address, and none of them revokes the authorization");
    const betaPaths = code.flatMap((c) => (c.s.match(/\/beta\/[A-Za-z0-9_\/:{}$.-]*/g) || []).map((x) => c.f + ' ' + x));
    assert([...new Set(betaPaths)].join() === 'api/_lib/webflow.js /beta/token/resolve', 'no feature uses a beta endpoint of Webflow: the one beta path in the code resolves the ID token of the Designer panel (found: ' + betaPaths.join(', ') + ')');
    assert(!code.some((c) => /schema-markup|jsonLdSchema|ld\+json|robots\.txt|sitemap\.xml/i.test(c.s) && c.f !== 'api/_lib/html.js' && c.f !== 'api/_lib/health.js'), 'nothing in the app reads or writes schema markup, robots.txt or a sitemap');
    const loggers = code.filter((c) => /\bconsole\.(log|error|warn|info|debug)\s*\(/.test(c.s)).map((c) => c.f);
    const logLib = require('../api/_lib/log');
    const logged = logLib.redact('login email failed for ada.l@agency.com with Bearer tok_abcdefghijklmnopqrstuvwxyz0123456789 and state Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFy on site 62b720ef280c7a7a3be8cabe');
    assert(loggers.join() === 'api/_lib/log.js' && !/agency\.com|tok_abc|Zm9v/.test(logged) && logged.includes('[email]') && logged.includes('[redacted]') && logged.includes('62b720ef280c7a7a3be8cabe') && logLib.redact(new Error('for owner@agency.com')).includes('[email]'),
      'the app writes to its logs in one place, which takes out email addresses and anything long enough to be a token');
    assert(!fs.existsSync(pathLib.join(root, 'api/_lib/audit.js')) && !fs.existsSync(pathLib.join(root, 'api/_lib/fetcher.js')) && !fs.existsSync(pathLib.join(root, 'api/_lib/vr')), 'the reader of published websites is not part of the app');
    const wfLib = require('../api/_lib/webflow');
    assert(wfLib.SCOPES.join(' ') === 'authorized_user:read sites:read pages:read pages:write cms:read cms:write' && !wfLib.getSchema && !wfLib.putSchema && !wfLib.querySchemas, 'the scopes are the six the features use, and the Webflow client has no schema calls');

    // the Designer panel: what it may call and what it must not do
    const panel = fs.readFileSync(pathLib.join(root, 'extension/public/app.js'), 'utf8');
    const panelPage = fs.readFileSync(pathLib.join(root, 'extension/public/index.html'), 'utf8');
    assert((panel.match(/\bfetch\s*\(/g) || []).length === 1 && /fetch\(API \+ '\/ext\/' \+ route,/.test(panel) && /var API = 'https:\/\/aiseodeck\.silitlabs\.com';/.test(panel), 'the Designer panel calls one server, the app itself, over HTTPS');
    assert(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function|setInterval|setTimeout|importScripts|createElement\(\s*['"]script|javascript:/.test(panel), 'the Designer panel adds no HTML from strings, runs no generated code and has no timers');
    assert(!/keydown|keyup|keypress|accesskey|localStorage|sessionStorage|indexedDB|document\.cookie|postMessage|window\.open|location\.(href|assign|replace)/i.test(panel), 'the Designer panel has no keyboard shortcuts, stores nothing in the browser, opens no windows and sends no messages');
    assert(!/\bon(click|dblclick|submit|input|change|load|error|focus|blur|key[a-z]+|mouse[a-z]+|pointer[a-z]+|touch[a-z]+|message)\b/i.test(panel) && /else if \(EVENTS\[k\] === true\) el\.addEventListener\(k, v\);/.test(panel) && !/setAttribute\(\s*['"]on/i.test(panel),
      'the Designer panel binds its events with addEventListener: no handler attribute is named anywhere in the script');
    assert((panel.match(/h\(\s*'a'/g) || []).length === 1 && /var href = typeof url === 'string' && url\.indexOf\(API \+ '\/'\) === 0 \? url : API \+ '\/app';\s+return h\('a', \{ class: cls, href: href, target: '_blank', rel: 'noopener noreferrer' \}, text\);/.test(panel) && !/\.href\s*=|setAttribute\(\s*'href'/.test(panel),
      'every link of the Designer panel is made in one place, which lets it lead only to the app itself, in a new tab');
    assert(!/\son[a-z]+\s*=|javascript:|<script(?![^>]*\ssrc="app\.js")|style\s*=/i.test(panelPage) && /<script src="app\.js"><\/script>/.test(panelPage), 'the page of the panel has no inline scripts, handlers or styles');
    const usesWebflow = [...new Set(panel.match(/\bwebflow\.[A-Za-z]+/g) || [])].sort();
    assert(usesWebflow.join() === 'webflow.getCurrentPage,webflow.getIdToken,webflow.getSiteInfo,webflow.notify,webflow.setExtensionSize,webflow.subscribe', 'the Designer API calls of the panel are the ones the review notes list (found: ' + usesWebflow.join(', ') + ')');
    // what the two documents a reviewer reads say about the panel is what the code does: the review notes and the
    // README that goes into the review ZIP
    const pageCalls = [...new Set((panel.match(/\bpage\.(?:get|set|is)[A-Z][A-Za-z]+/g) || []).map((x) => x.split('.')[1]))].sort();
    const panelRoutes = [...new Set((panel.match(/\bcall\('([a-z]+)'/g) || []).map((x) => x.slice(6, -1)))].sort();
    const serverRoutes = [...new Set((code.find((c) => c.f === 'api/index.js').s.match(/path === '\/ext\/([a-z]+)'/g) || []).map((x) => x.slice(15, -1)))].sort();
    assert(pageCalls.join() === 'getCollectionId,getDescription,getName,getPublishPath,getSlug,getTitle,isHomepage,setDescription,setTitle' && panelRoutes.join() === 'applied,context,suggest' && serverRoutes.join() === panelRoutes.join(),
      'the panel reads and sets the title and description of the open page, and calls the three routes the server has (page calls: ' + pageCalls.join(', ') + '; routes: ' + panelRoutes.join(', ') + ' / ' + serverRoutes.join(', ') + ')');
    for (const [docName, docPath] of [['the review notes', 'REVIEW.md'], ['the README of the review ZIP', 'extension/README.md']]) {
      const doc = fs.readFileSync(pathLib.join(root, docPath), 'utf8');
      const named = [...new Set(doc.match(/\bwebflow\.[A-Za-z]+/g) || [])].filter((x) => !/^webflow\.(json|js|io|com)$/.test(x)).sort();
      const missing = usesWebflow.filter((x) => !named.includes(x)).concat(pageCalls.filter((x) => !new RegExp('\\b' + x + '\\b').test(doc))).concat(panelRoutes.filter((x) => !new RegExp('/ext/' + x + '\\b|`' + x + '`').test(doc)));
      const extra = named.filter((x) => !usesWebflow.includes(x)).concat((doc.match(/\/ext\/[a-z]+/g) || []).map((x) => x.slice(5)).filter((x) => !panelRoutes.includes(x)));
      assert(missing.length === 0 && extra.length === 0, docName + ': every Designer API call and every route of the panel is named, and none that the code does not use (missing: ' + (missing.join(', ') || 'none') + '; not in the code: ' + (extra.join(', ') || 'none') + ')');
    }
  }

  console.log('unit: the extension bundle and the review ZIP');
  {
    const pk = require('../scripts/package-extension');
    // two ZIP files made by another program: stored entries, a deflated one and a folder
    const stored = pk.readZip(Buffer.from('UEsDBAoAAAAAAIq4d12jogmfMAAAADAAAAAFAAAAYS50eHRoZWxsbyBoZWxsbyBoZWxsbyBoZWxsbyBoZWxsbyBoZWxsbyBoZWxsbyBoZWxsbwpQSwMECgAAAAAAirh3XQ60qxwHAAAABwAAAAYAAABiLmpzb257ImsiOjF9UEsBAh4DCgAAAAAAirh3XaOiCZ8wAAAAMAAAAAUAAAAAAAAAAAAAAKSBAAAAAGEudHh0UEsBAh4DCgAAAAAAirh3XQ60qxwHAAAABwAAAAYAAAAAAAAAAAAAAKSBUwAAAGIuanNvblBLBQYAAAAAAgACAGcAAAB+AAAAAAA=', 'base64'));
    const deflated = pk.readZip(Buffer.from('UEsDBBQAAgAIAIq4d12jogmfDAAAADAAAAAFAAAAYS50eHTLSM3JyVfIIJbkAgBQSwMECgACAAAAirh3XQ60qxwHAAAABwAAAAYAAABiLmpzb257ImsiOjF9UEsDBAoAAAAAAIq4d10AAAAAAAAAAAAAAAAEAAAAc3ViL1BLAwQKAAIAAACKuHddgxbcjAEAAAABAAAACQAAAHN1Yi9jLnR4dHhQSwECHgMUAAIACACKuHddo6IJnwwAAAAwAAAABQAAAAAAAAABAAAApIEAAAAAYS50eHRQSwECHgMKAAIAAACKuHddDrSrHAcAAAAHAAAABgAAAAAAAAABAAAApIEvAAAAYi5qc29uUEsBAh4DCgAAAAAAirh3XQAAAAAAAAAAAAAAAAQAAAAAAAAAAAAQAO1BWgAAAHN1Yi9QSwECHgMKAAIAAACKuHddgxbcjAEAAAABAAAACQAAAAAAAAABAAAApIF8AAAAc3ViL2MudHh0UEsFBgAAAAAEAAQA0AAAAKQAAAAAAA==', 'base64'));
    const hello = 'hello hello hello hello hello hello hello hello\n';
    assert(stored.map((f) => f.name).join() === 'a.txt,b.json' && stored[0].data.toString() === hello && stored[1].data.toString() === '{"k":1}', 'a ZIP made by another program is read: stored files');
    assert(deflated.map((f) => f.name + (f.dir ? '(folder)' : '')).join() === 'a.txt,b.json,sub/(folder),sub/c.txt' && deflated[0].data.toString() === hello && deflated[3].data.toString() === 'x', 'and compressed files and folders');
    assert(pk.crc32(Buffer.from(hello)) === 0x9f09a2a3 && pk.crc32(Buffer.from('{"k":1}')) === 0x1cabb40e && pk.crc32(Buffer.alloc(0)) === 0, 'the checksum of a file is the one other ZIP programs compute');
    let damaged = null;
    try { const bad = Buffer.from(pk.writeZip([{ name: 'a.txt', data: Buffer.from(hello.repeat(40)) }])); bad[40] ^= 0xff; pk.readZip(bad); } catch (e) { damaged = e; }
    assert(damaged, 'a ZIP whose content was changed is refused');
    const src = { 'webflow.json': Buffer.from(JSON.stringify(pk.MANIFEST, null, 2) + '\n'), 'index.html': Buffer.from('<!doctype html>\n'), 'app.css': Buffer.from('body{}\n'), 'app.js': Buffer.from('var a = 1;\n') };
    const zipOf = (o) => pk.writeZip(Object.entries(o).map(([name, data]) => ({ name, data })));
    const good = pk.checkBundle(zipOf(src), src);
    const again = pk.readZip(pk.writeZip(good.files.concat([{ name: 'README.md', data: Buffer.from('# read me\n') }])));
    assert(good.problems.length === 0 && good.files.map((f) => f.name).join() === 'app.css,app.js,index.html,webflow.json' && good.sums['app.js'] === crypto.createHash('sha256').update(src['app.js']).digest('hex'), 'a bundle that holds the four files of the extension, byte for byte, passes');
    assert(again.map((f) => f.name).join() === 'app.css,app.js,index.html,webflow.json,README.md' && again.every((f) => f.name === 'README.md' || f.data.equals(src[f.name])) && pk.writeZip(good.files).equals(pk.writeZip(good.files)), 'the review ZIP holds those same bytes and the README, and the same input gives the same file');
    const problemsOf = (o) => pk.checkBundle(zipOf(o), src).problems.join(' | ');
    assert(/app\.js in bundle\.zip is not the same bytes/.test(problemsOf(Object.assign({}, src, { 'app.js': Buffer.from('var a = 2;\n') }))), 'a file that differs from the source by one character is refused');
    assert(/not part of the extension: app\.js\.map/.test(problemsOf(Object.assign({}, src, { 'app.js.map': Buffer.from('{}') }))) && /holds a source map/.test(problemsOf(Object.assign({}, src, { 'app.js.map': Buffer.from('{}') }))), 'a source map in the bundle is refused');
    assert(/not part of the extension: node_modules\/x\/index\.js/.test(problemsOf(Object.assign({}, src, { 'node_modules/x/index.js': Buffer.from('1') }))) && /not part of the extension: \.env/.test(problemsOf(Object.assign({}, src, { '.env': Buffer.from('A=1') }))), 'any other file in the bundle is refused');
    { const less = Object.assign({}, src); delete less['app.css']; assert(/does not hold app\.css/.test(problemsOf(less)), 'a missing file is refused'); }
    {
      const mapped = Object.assign({}, src, { 'app.js': Buffer.from('var a = 1;\n//# sourceMappingURL=data:application/json;base64,e30=\n') });
      assert(/app\.js carries a source map reference/.test(pk.checkBundle(zipOf(mapped), mapped).problems.join(' | ')), 'a source map written into a file is refused');
      const other = Object.assign({}, src, { 'webflow.json': Buffer.from(JSON.stringify(Object.assign({}, pk.MANIFEST, { name: 'Another' }))) });
      assert(/not the manifest of the repository/.test(pk.checkBundle(zipOf(other), other).problems.join(' | ')), 'a manifest other than the one of the repository is refused');
      assert(/cannot be read/.test(pk.checkBundle(Buffer.from('this is not a zip file at all, just text'), src).problems.join(' | ')), 'a file that is not a ZIP is refused');
    }
    const fsx = require('fs'), px = require('path');
    assert(JSON.stringify(JSON.parse(fsx.readFileSync(pk.SOURCES['webflow.json'], 'utf8'))) === JSON.stringify(pk.MANIFEST) && Object.values(pk.SOURCES).every((f) => fsx.existsSync(f)) && Object.keys(pk.SOURCES).sort().join() === 'app.css,app.js,index.html,webflow.json' && fsx.readdirSync(px.dirname(pk.SOURCES['app.js'])).sort().join() === 'app.css,app.js,index.html',
      'the extension is four files: the manifest and the three files of public/, and nothing else is in that folder');
  }

  const app = startApp();
  const port = await listen(app);
  const post = (path, cookie, body, origin) => request(port, 'POST', path, { headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', origin: origin || 'https://app.test' }, body: typeof body === 'string' ? body : form(body) });
  const pump = async (cookie) => { for (let i = 0; i < 10; i++) { const x = await post('/app/run/pump', cookie, 'id=siteA'); const j = JSON.parse(x.body); if (j.finished || j.idle) break; } };

  console.log('the install address and the OAuth state');
  {
    const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
    // every authorization starts at /auth, which mints a state of its own each time
    const a1 = await request(port, 'GET', '/auth');
    const a2 = await request(port, 'GET', '/auth');
    const u1 = new URL(a1.headers.location);
    const s1 = u1.searchParams.get('state'), s2 = new URL(a2.headers.location).searchParams.get('state');
    assert(a1.status === 302 && u1.origin === 'http://127.0.0.1:' + wfPort && u1.pathname === '/oauth/authorize' && u1.searchParams.get('client_id') === 'cid' && u1.searchParams.get('response_type') === 'code' && u1.searchParams.get('redirect_uri') === 'https://app.test/callback', 'the install address of the app sends the browser to the Webflow authorization screen');
    assert(s1 && s2 && s1 !== s2 && s1.length >= 40, 'two requests carry two different state values');
    const b1 = cookiesFrom(a1), b2 = cookiesFrom(a2);
    assert(/^ad_oauth=[A-Za-z0-9_-]{24,}$/.test(b1) && b1 !== b2 && (a1.headers['set-cookie'] || []).every((c) => /HttpOnly/.test(c) && /Secure/.test(c) && /SameSite=Lax/.test(c)), 'the browser that starts gets a value of its own, in a cookie that scripts cannot read');
    assert(db.has('oauth:' + sha(s1)) && db.has('oauth:' + sha(s2)) && ![...db.keys()].some((k) => k.includes(s1)) && JSON.parse(db.get('oauth:' + sha(s1))).b === sha(b1.split('=')[1]) && ttl.get('oauth:' + sha(s1)) - Date.now() <= 600000 && ttl.get('oauth:' + sha(s1)) - Date.now() > 590000, 'the state is kept on the server as a hash, tied to that browser, and expires on its own after ten minutes');
    const before = wfState.tokenRequests.length;
    let x = await request(port, 'GET', '/callback?code=good-code', { headers: { cookie: b1 } });
    assert(x.status === 400 && x.body.includes('This sign in cannot be completed') && x.body.includes('href="/auth"') && wfState.tokenRequests.length === before, 'a callback with no state is refused before the code is used (this is what the Install button of the developer Workspace sends)');
    x = await request(port, 'GET', '/callback?code=good-code&state=' + s1.slice(0, -2) + (s1.endsWith('AA') ? 'BB' : 'AA'), { headers: { cookie: b1 } });
    assert(x.status === 400 && wfState.tokenRequests.length === before, 'a changed state is refused');
    x = await request(port, 'GET', '/callback?code=good-code&state=' + s1 + '&state=' + s1, { headers: { cookie: b1 } });
    assert(x.status === 400 && wfState.tokenRequests.length === before, 'a state given twice in one address is refused');
    x = await request(port, 'GET', '/callback?code=good-code&state=' + s2, { headers: { cookie: 'ad_oauth=' + 'z'.repeat(32) } });
    assert(x.status === 400 && wfState.tokenRequests.length === before, 'a state completed in another browser is refused');
    x = await request(port, 'GET', '/callback?code=good-code&state=' + s2, { headers: { cookie: b2 } });
    assert(x.status === 400 && wfState.tokenRequests.length === before && !db.has('oauth:' + sha(s2)), 'and that attempt used it up: it works for nobody afterwards');
    x = await request(port, 'GET', '/callback?code=good-code&state=' + s2);
    assert(x.status === 400 && wfState.tokenRequests.length === before, 'a callback from a browser that never started is refused');
    const a3 = await request(port, 'GET', '/auth');
    const s3 = new URL(a3.headers.location).searchParams.get('state');
    const old = JSON.parse(db.get('oauth:' + sha(s3))); old.at = Date.now() - 11 * 60000; db.set('oauth:' + sha(s3), JSON.stringify(old));
    x = await request(port, 'GET', '/callback?code=good-code&state=' + s3, { headers: { cookie: cookiesFrom(a3) } });
    assert(x.status === 400 && wfState.tokenRequests.length === before, 'a state older than ten minutes is refused');
    const a4 = await request(port, 'GET', '/auth');
    const s4 = new URL(a4.headers.location).searchParams.get('state');
    x = await request(port, 'GET', '/callback?error=access_denied&state=' + s4, { headers: { cookie: cookiesFrom(a4) } });
    assert(x.status === 400 && x.body.includes('You cancelled on the Webflow screen') && x.body.includes('nothing was stored') && wfState.tokenRequests.length === before && !db.has('oauth:' + sha(s4)) && !db.has('user:user_1') && !(x.headers['set-cookie'] || []).some((c) => c.startsWith('ad_session=')), 'a denied request ends on a page that says nothing was stored: no account, no session, no code exchange');
    x = await request(port, 'GET', '/callback?state=' + s1, { headers: { cookie: b1 } });
    assert(x.status === 400 && x.body.includes('Missing code') && wfState.tokenRequests.length === before && !db.has('oauth:' + sha(s1)), 'a callback with a good state and no code does nothing, and the state is used up');
  }

  console.log('connect from a keyword on the home page, then set up');
  let r = await request(port, 'GET', '/auth?kw=' + encodeURIComponent('Veneers in Antalya'));
  const state = new URL(r.headers.location).searchParams.get('state');
  const startCookies = cookiesFrom(r);
  assert(r.status === 302 && /scope=authorized_user%3Aread\+sites%3Aread\+pages%3Aread\+pages%3Awrite\+cms%3Aread\+cms%3Awrite/.test(r.headers.location), 'auth asks for the read, page write and CMS scopes');
  assert((r.headers['set-cookie'] || []).some((c) => c.startsWith('ad_kw=veneers%20in%20antalya')), 'the keyword from the home page waits in a cookie');
  r = await request(port, 'GET', '/callback?code=good-code&state=' + state, { headers: { cookie: startCookies } });
  const cookie = cookiesFrom(r);
  assert(r.status === 302 && r.headers.location === '/app/setup?id=siteA&kw=veneers%20in%20antalya', 'one new site goes straight to setup, with the keyword');
  assert(wfState.tokenRequests.length === 1 && wfState.tokenRequests[0].redirect_uri === 'https://app.test/callback' && getJ('user:user_1').connections.length === 1 && getJ('user:user_1').connections[0].siteIds.join() === 'siteA' && !JSON.stringify(getJ('user:user_1')).includes('tok_abc'), 'the code is exchanged once, with the redirect address of the app, and the token is kept encrypted');
  {
    const again = await request(port, 'GET', '/callback?code=good-code&state=' + state, { headers: { cookie: startCookies } });
    assert(again.status === 400 && again.body.includes('This sign in cannot be completed') && wfState.tokenRequests.length === 1, 'a state that was used once does not work a second time, in the same browser either');
  }
  r = await request(port, 'GET', '/app/setup?id=siteA&kw=veneers%20in%20antalya', { headers: { cookie } });
  assert(r.status === 200 && r.body.includes('Set up Lumen Dental') && r.body.includes('value="en" selected') && r.body.includes('>veneers in antalya</textarea>'), 'setup page shows the site and holds the keyword');
  assert(!/name="domains"/.test(r.body) && r.body.includes('Your website, read from Webflow') && r.body.includes('lumendental.com, lumen-dental.webflow.io') && r.body.includes('Read from Webflow just now') && /<button class="wfbtn" type="submit" form="wfrefresh">Refresh from Webflow<\/button>/.test(r.body), 'setup asks for no website address: the addresses come from Webflow, with the time they were read and a refresh');
  assert(!/name, then website|brightline\.com/.test(r.body) && r.body.includes('one name per line'), 'rivals are asked for by name only');
  assert(r.body.includes('id="suggbtn">Suggest keywords from my site</button>') && r.body.includes("btn.addEventListener('click'") && wfState.domCalls.length === 0 && !engineCalls.some((c) => c.e === 'gen'), 'opening the setup page reads no page content and asks no AI: keyword ideas come when the user asks for them');
  r = await post('/app/setup/suggest', cookie, { id: 'siteA' });
  assert(wfState.domCalls.join() === 'p1', 'the ideas are written from the home page as the Webflow API returns it');
  const sug = JSON.parse(r.body);
  assert(sug.ideas.length === 3 && sug.ideas[0].keyword === 'veneers in antalya' && sug.ideas[0].volume === 1800 && !sug.ideas.some((x) => /lumen/.test(x.keyword)), 'keyword ideas come back lowercased, with volumes, without the brand');
  assert(sug.cited.length === 1 && sug.cited[0].keyword === 'smile makeover antalya' && sug.cited[0].volume === 880, 'keywords already cited in Google AI Overviews come back');
  const rk = engineCalls.find((c) => c.e === 'labs' && c.kind === 'ranked_keywords');
  assert(rk && rk.task.item_types[0] === 'ai_overview_reference' && rk.task.location_code === 2840, 'AI Overviews keywords asked for the site domain');
  r = await post('/app/setup', cookie, { id: 'siteA', brand: 'Lumen Dental', aliases: '', domains: 'lumendental.com, ' + host, country: 'GB', language: 'en', rivals: 'Bright Smile Clinic, brightsmile.com', pick: ['veneers in antalya', 'dental implants antalya', 'smile makeover antalya'], own: 'veneers in antalya\nBest dentist for a SMILE makeover?\nx' });
  assert(r.status === 302 && r.headers.location.startsWith('/app/site?id=siteA&tab=keywords') && decodeURIComponent(r.headers.location).includes('so 1 were left out'), 'setup saves, opens the keywords and says what the free plan left out');
  let site = getJ('site:siteA');
  assert(site.project.ready && site.tracked && site.keywords.length === 3 && site.keywords.map((k) => k.text).join() === 'veneers in antalya,dental implants antalya,smile makeover antalya', 'free plan: 3 keywords tracked, duplicates removed');
  assert(site.keywords.every((k) => k.questions.length === 2) && site.keywords[0].questions[0] === 'Which clinic is best for veneers in antalya?', 'each keyword gets two customer questions');
  assert(site.keywords[0].volume === 1800 && site.keywords[2].volume === 880 && site.keywords[2].source === 'aio' && site.keywords[0].source === 'idea', 'volumes and sources kept from the suggestions');
  assert(site.project.competitors.length === 1 && site.project.competitors[0].name === 'Bright Smile Clinic' && site.project.competitors[0].domain === '' && site.project.country === 'GB', 'rivals are saved by name, a website typed after the name is left out, and the market is saved');
  assert(site.project.domains.join() === host + ',lumendental.com,lumen-dental.webflow.io' && site.metaAt > Date.now() - 60000, 'the addresses of the site are the ones Webflow gives, not the ones typed into the form');
  wfState.sites[0].customDomains.push({ id: 'd2', url: 'https://www.lumen.example' });
  r = await post('/app/site/refresh', cookie, { id: 'siteA', back: 'settings' });
  assert(r.status === 302 && r.headers.location.startsWith('/app/site?id=siteA&tab=settings') && /Read%20from%20Webflow%20just%20now/.test(r.headers.location) && getJ('site:siteA').project.domains.includes('lumen.example'), 'Refresh from Webflow reads the addresses of the site again and goes back to the settings');
  r = await request(port, 'GET', '/app/site?id=siteA&tab=settings', { headers: { cookie } });
  assert(r.status === 200 && !/name="domains"/.test(r.body) && r.body.includes('Your website, read from Webflow') && r.body.includes('lumen.example') && r.body.includes('form="wfrefresh"') && r.body.includes('Rivals, one name per line') && />Bright Smile Clinic<\/textarea>/.test(r.body), 'the site settings show the addresses from Webflow read-only, and the rivals by name');
  wfState.sites[0].customDomains.pop();
  r = await post('/app/site/refresh', cookie, { id: 'siteA', back: 'setup' });
  assert(r.status === 302 && r.headers.location.startsWith('/app/setup?id=siteA') && !getJ('site:siteA').project.domains.includes('lumen.example'), 'a domain removed in Webflow is gone after the next refresh');
  r = await post('/app/site/refresh', cookie, { id: 'siteZ', back: 'setup' });
  assert(r.status === 404, 'only the owner of a site can refresh it');
  const run1 = getJ('run:' + site.sched.runId);
  assert(run1 && run1.engines.join() === 'openai,aio,perplexity' && run1.total === 15 && !run1.partial, 'free plan: first run on ChatGPT, Google AI Overviews and Perplexity, 5 answers per keyword');
  assert(run1.units.filter((u) => u.q === 'k').length === 3 && run1.units.find((u) => u.id.endsWith('.0')).text.startsWith('Which clinic'), 'Google gets the keyword, chat engines get the questions');

  console.log('live progress while a check runs');
  r = await request(port, 'GET', '/app/run/progress?id=siteA', { headers: { cookie } });
  let prog = JSON.parse(r.body);
  assert(r.status === 200 && prog.total === 15 && prog.done === 0 && !prog.idle, 'the progress endpoint reports answers read so far');
  r = await request(port, 'GET', '/app/run/progress?id=siteA');
  assert(r.status === 401 && JSON.parse(r.body).error === 'signed out', 'signed out progress gets a JSON answer, not the login page');
  r = await request(port, 'GET', '/app/run/progress?id=nosuchsite', { headers: { cookie } });
  assert(r.status === 404, 'progress of a site that is not yours is not found');
  r = await request(port, 'GET', '/app/site?id=siteA', { headers: { cookie } });
  assert(r.body.includes("fetch('/app/run/progress?id='") && r.body.includes('setTimeout(peek,5000)'), 'an open page polls the progress while the pump works');

  console.log('first run through the page pump');
  await pump(cookie);
  r = await request(port, 'GET', '/app/run/progress?id=siteA', { headers: { cookie } });
  assert(JSON.parse(r.body).idle === true, 'progress is idle once the check is done');
  site = getJ('site:siteA');
  const [kVen, kImp, kSmile] = site.keywords;
  const sVen = site.kw[kVen.id], sImp = site.kw[kImp.id], sSmile = site.kw[kSmile.id];
  assert(!site.sched.runId && sVen && sImp && sSmile, 'run finished, every keyword has a summary');
  assert(sVen.n === 5 && sVen.m === 5 && sVen.c === 5 && sVen.eng.openai === 'b' && sVen.eng.aio === 'b' && sVen.eng.perplexity === 'b', 'veneers: named and cited by all three engines');
  assert(sImp.eng.aio === 'x' && sImp.na === 1 && sImp.m === 0 && sImp.lost.openai[0] === 'Bright Smile Clinic', 'implants: no AI Overview, the rival is named instead');
  assert(sSmile.m === 0 && sSmile.eng.openai === 'o', 'smile makeover: not named');
  assert(site.latest.score === Math.round(500 / 14) && site.latest.kwNamed === 1 && site.latest.keywords === 3 && site.latest.ok === 14 && site.latest.none === 1, 'site visibility adds up the keywords: named in 5 of 14 answers');
  assert(site.latest.voice[0].name === 'Bright Smile Clinic' && site.latest.voice[0].n === 9 && site.latest.voice[1].n === 5, 'share of voice: the rival is named in 9 answers, the brand in 5');
  assert(site.latest.byEngine.aio.kx === 1 && site.latest.byEngine.openai.km === 1 && site.latest.byEngine.openai.k === 3, 'by engine: keywords answered, named, without an AI answer');
  assert(site.latest.insights && site.latest.insights.descriptors.includes('digital smile design') && site.latest.insights.sentiment.positive === 2, 'insights: descriptors and sentiment from the answers that name the brand');
  assert(site.latest.gaps.length === 1 && site.latest.gaps[0].text === 'dental implants antalya' && site.latest.gaps[0].rivals[0] === 'Bright Smile Clinic', 'where rivals win: the implants keyword');
  assert(site.latest.topQueries.some((q) => q.q === 'antalya dental clinic reviews'), 'what the AI searched for is collected');
  assert(engineCalls.some((c) => c.e === 'aio' && c.loc === 2826 && c.lang === 'en' && c.p === 'veneers in antalya'), 'Google AI Overviews asked the keyword for the UK market in English');
  assert(engineCalls.filter((c) => c.e === 'openai').every((c) => c.country === 'GB' && c.model === 'gpt-6-luna'), 'ChatGPT calls use the market and the default model');
  assert(emails.some((e) => /AI visibility for Lumen Dental: 36% of answers/.test(e.subject)), 'first report email sent');
  assert(site.sched.nextRunAt - Date.now() > 29 * 86400000 && sVen.trend.length === 1, 'free plan: next check in about a month, trend started');

  r = await request(port, 'GET', '/app/site?id=siteA', { headers: { cookie } });
  assert(r.status === 200 && r.body.includes('class="shell"') && r.body.includes('aria-current="page">' ) && r.body.includes('>Overview<') && r.body.includes('AI visibility') && r.body.includes('Do these next') && r.body.includes('Keywords each engine names you for'), 'a site opens on its overview, inside the sidebar');
  assert(r.body.includes('Open the fix plan') && r.body.includes('Read your pages from Webflow') && r.body.includes('Open Site health') && /<ol class="todo">/.test(r.body), 'the overview says what to do next: keywords worth fixing, then Site health');
  assert(r.body.includes('Who AI names') && r.body.includes('Sites the AI reads') && r.body.includes('Not read yet'), 'rivals, sources and the Site health badge');
  r = await request(port, 'GET', '/app/site?id=siteA&tab=keywords', { headers: { cookie } });
  assert(r.status === 200 && r.body.includes('class="kt"') && r.body.includes('veneers in antalya') && r.body.includes('c st-b') && r.body.includes('c st-x'), 'the keyword deck renders with engine states');
  assert(r.body.includes('What the marks mean') && r.body.includes('Names you and links your site') && r.body.includes('Named by') && (r.body.includes('Fix this first') || r.body.includes('Fix plan')), 'the marks are explained in words, each keyword says how many engines name it and what to do');
  assert(r.body.indexOf('1,800 searches a month') > -1 && r.body.indexOf('veneers in antalya') < r.body.indexOf('smile makeover antalya'), 'the most searched keywords come first');
  assert(r.body.includes('c st-lock') && r.body.includes('4 more AI engines') && r.body.includes('1,800'), 'free plan sees the paid engines as locked columns, volumes shown');
  assert(r.body.includes('Check all keywords now') && r.body.includes('disabled') && r.body.includes('Checks on demand are part of the paid plans'), 'free plan cannot check on demand');
  r = await request(port, 'GET', '/app/keyword?id=siteA&k=' + kVen.id, { headers: { cookie } });
  assert(r.status === 200 && r.body.includes('Yes. 3 of 3 AI engines name Lumen Dental.') && r.body.includes('<mark>Lumen Dental</mark>') && r.body.includes('rival-name') && r.body.includes('chip own'), 'keyword page: the verdict and the answers with the brand marked');
  assert(r.body.includes('Which clinic is best for veneers in antalya?') && r.body.includes('Search <b>veneers in antalya</b>'), 'keyword page shows the questions and the search behind each answer');
  assert(r.body.includes('Read my pages from Webflow') && r.body.includes('Searches related to this keyword'), 'before Site health has read the pages the plan asks to read them; related searches offered');
  r = await request(port, 'GET', '/app/site?id=siteA&tab=insights', { headers: { cookie } });
  assert(r.body.includes('Where rivals win') && r.body.includes('dental implants antalya') && r.body.includes('whatclinic.com') && !/class="host" title="lumendental\.com"/.test(r.body) && r.body.includes('lumendental.com/veneers'), 'rivals and sources: the gap, the sites the AI uses, the own pages cited');
  r = await request(port, 'GET', '/app/site?id=siteA&tab=discover', { headers: { cookie } });
  assert(r.body.includes('Cited in Google AI Overviews') && r.body.includes('smile makeover antalya') && r.body.includes('Tracking') && r.body.includes('veneers cost turkey'), 'discover lists cited keywords and ideas, tracked ones marked');

  console.log('keywords: add, plan limit, related');
  r = await post('/app/keywords', cookie, { id: 'siteA', text: 'hollywood smile turkey', back: 'keywords' });
  assert(decodeURIComponent(r.headers.location).includes('Your plan tracks 3 keywords') && getJ('site:siteA').keywords.length === 3, 'free plan: a fourth keyword is refused');
  r = await post('/app/keyword/remove', cookie, { id: 'siteA', k: kSmile.id, sure: '1' });
  site = getJ('site:siteA');
  assert(site.keywords.length === 2 && !site.kw[kSmile.id] && site.latest.keywords === 2 && site.latest.ok === 9, 'removing a keyword updates the site numbers');
  r = await post('/app/keywords', cookie, { id: 'siteA', text: 'Hollywood Smile Turkey', back: 'keywords' });
  site = getJ('site:siteA');
  const kHol = site.keywords.find((k) => k.text === 'hollywood smile turkey');
  assert(kHol && r.headers.location.startsWith('/app/keyword?id=siteA&k=' + kHol.id) && kHol.questions.length === 2 && kHol.volume === 2200, 'a typed keyword is added with questions and volume, and opens');
  const run3 = getJ('run:' + site.sched.runId);
  assert(run3 && run3.partial && run3.total === 5 && run3.keywords.length === 1 && run3.reason === 'new', 'a new keyword gets its own first check');
  assert(getJ('user:user_1').usage.newChecks === 1, 'the first check of a new keyword is counted');
  await pump(cookie);
  site = getJ('site:siteA');
  assert(site.kw[kHol.id] && site.kw[kVen.id].trend.length === 1 && db.get('hist:siteA').length === 1 && !site.sched.runId, 'only the new keyword was checked; the history keeps weekly checks');
  r = await post('/app/keyword/related', cookie, { id: 'siteA', k: kVen.id });
  r = await request(port, 'GET', '/app/keyword?id=siteA&k=' + kVen.id, { headers: { cookie } });
  assert(r.body.includes('best veneers in antalya') && r.body.includes('500 a month'), 'related searches load with volumes');

  console.log('upgrade, check all, check one keyword, cron');
  const user = getJ('user:user_1');
  user.plan = 'solo';
  db.set('user:user_1', JSON.stringify(user));
  r = await post('/app/site/run', cookie, 'id=siteA');
  site = getJ('site:siteA');
  const run2 = getJ('run:' + site.sched.runId);
  assert(run2 && run2.engines.join() === 'openai,aio,aimode,gemini,perplexity,claude,grok' && run2.total === 36 && !run2.partial, 'paid: all seven AI engines, 12 answers for each of the 3 keywords');
  assert(getJ('user:user_1').usage.rechecks === 3, 'checking all keywords uses one keyword check each');
  r = await request(port, 'GET', '/cron/tick', {});
  assert(r.status === 401, 'cron needs the key');
  r = await request(port, 'GET', '/cron/tick', { headers: { authorization: 'Bearer wrong' } });
  assert(r.status === 401, 'a wrong Vercel Cron bearer is refused');
  r = await request(port, 'GET', '/cron/tick?key=cronkey', {});
  assert(r.status === 401, 'the cron secret is not taken from the address, where it would be written to request logs');
  r = await request(port, 'GET', '/cron/tick', { headers: { 'x-cron-secret': 'cronkey' } });
  assert(r.status === 200, 'a manual call may carry the secret in the x-cron-secret header');
  r = await request(port, 'GET', '/cron/tick', { headers: { authorization: 'Bearer cronkey' } });
  assert(r.status === 200, 'Vercel Cron bearer is accepted');
  for (let i = 0; i < 4 && getJ('site:siteA').sched.runId; i++) r = await request(port, 'GET', '/cron/tick', { headers: { authorization: 'Bearer cronkey' } });
  site = getJ('site:siteA');
  assert(!site.sched.runId && site.latest.total === 36, 'cron finished the paid run');
  const res2 = Object.fromEntries([...db.get('res:' + run2.id)].map(([k, v]) => [k, JSON.parse(v)]));
  const gem = Object.values(res2).filter((x) => x.e === 'gemini');
  assert(gem.filter((x) => !x.ok && /API key/.test(x.err)).length === 3 && gem.some((x) => x.ok && x.cited), 'Gemini: a 400 is recorded as failed, grounding domains count as citations');
  {
    // the other chat engines take the country as a setting of their search tool; Gemini is told in a system instruction
    const told = engineCalls.filter((c) => c.e === 'gemini');
    assert(told.length > 0 && told.every((c) => c.where === 'The person asking is in the United Kingdom.' && !/United Kingdom/.test(c.p)), 'Gemini is told the market in a system instruction, and the question itself is not changed');
  }
  assert(gem.filter((x) => !x.ok).every((x) => x.kind === 'account') && emails.filter((e) => /Google Gemini needs attention/.test(e.subject)).length === 1, 'a refused key is an account problem: the owner gets one email, not one per answer');
  assert(Object.values(res2).filter((x) => x.e === 'perplexity').every((x) => x.ok), 'Perplexity answers all read');
  assert(site.latest.failed === 3 && site.latest.none === 1 && site.latest.ok === 32, 'summary counts the failed answers and the missing AI Overview');
  const cl = Object.values(res2).filter((x) => x.e === 'claude' && x.ok && x.cited);
  const gk = Object.values(res2).filter((x) => x.e === 'grok' && x.ok && x.cited);
  assert(cl.length === 2 && gk.length === 2 && cl[0].queries[0] === 'veneers antalya clinics', 'Claude and Grok answers read, with citations and searches');
  assert(engineCalls.some((c) => c.e === 'claude' && c.tool === 'web_search_20250305' && c.model === 'claude-haiku-5-5') && engineCalls.some((c) => c.e === 'grok' && c.auth === 'Bearer xk'), 'Claude and Grok called with the right tool, model and key');
  assert(Object.values(res2).some((x) => x.e === 'aimode' && x.ok && x.mentioned && x.p.endsWith('.k')), 'Google AI Mode asked the keyword and read');
  assert(db.get('hist:siteA').length === 2 && site.kw[kVen.id].trend.length === 2, 'two checks in the history, two points on the keyword trend');
  r = await post('/app/keyword/check', cookie, { id: 'siteA', k: kVen.id });
  site = getJ('site:siteA');
  const run4 = getJ('run:' + site.sched.runId);
  assert(run4 && run4.partial && run4.total === 12 && run4.reason === 'recheck' && getJ('user:user_1').usage.rechecks === 4, 'one keyword checked again on demand: 12 answers, one keyword check used');
  await pump(cookie);
  site = getJ('site:siteA');
  assert(site.kw[kVen.id].trend.length === 3 && site.kw[kVen.id].runId === run4.id && site.kw[kImp.id].runId === run2.id && db.get('hist:siteA').length === 2, 'the check on demand updates that keyword only');
  const u3 = getJ('user:user_1'); u3.usage.rechecks = 10; db.set('user:user_1', JSON.stringify(u3));
  r = await post('/app/keyword/check', cookie, { id: 'siteA', k: kVen.id });
  assert(!getJ('site:siteA').sched.runId && decodeURIComponent(r.headers.location).includes("used this month's 10 keyword checks"), 'at most 10 keyword checks a month on Solo');
  r = await request(port, 'GET', '/app/site?id=siteA', { headers: { cookie } });
  assert(r.body.includes('Checking all 3 keywords needs 3 keyword checks; 0 are left'), 'check all is refused without enough keyword checks');

  console.log('site health from the Webflow API, keyword fixes and page fixes');
  r = await request(port, 'GET', '/app/site?id=siteA&tab=audit', { headers: { cookie } });
  assert(r.status === 200 && r.body.includes('Read my pages from Webflow') && r.body.includes('Nothing is changed in Webflow') && !r.body.includes('llms.txt'), 'before the first read, Site health offers to read the pages through Webflow');
  const domBefore = wfState.domCalls.length;
  r = await post('/app/site/audit', cookie, { id: 'siteA', back: kVen.id });
  let audit = getJ('audit:siteA');
  assert(audit && audit.source === 'webflow-data-api' && audit.pagesListed === 3 && audit.pagesChecked === 3 && audit.complete && audit.pages.length === 3 && r.headers.location.startsWith('/app/keyword?id=siteA&k=' + kVen.id), 'Site health reads the pages through the Webflow API and comes back to the keyword');
  assert(wfState.domCalls.slice(domBefore).sort().join() === 'p1,p2', 'the text of the static pages comes from GET /v2/pages/:page_id/dom; the utility page, the draft and the Collection template are not read');
  let home = audit.pages.find((p) => p.path === '/');
  let about = audit.pages.find((p) => p.path === '/about');
  assert(home.pageId === 'p1' && home.issues.join() === 'title_length,desc_length,alt_missing' && home.score === 82 && home.h1[0] === 'Lumen Dental' && home.words > 300 && home.og.title && home.og.description && home.contentAt > 0, 'home page: a short title and description, and an image without alt text; its Open Graph values copy the SEO ones');
  assert(about.faq.length === 2 && about.faq[0].q === 'How long do veneers last?' && !('a' in about.faq[0]) && about.issues.length === 0 && about.score === 100 && about.images === 1 && about.imagesNoAlt === 0 && !('text' in about), 'about page: two questions found, an image marked decorative is not a finding, and the text of the page is not kept');
  const tplRow = audit.pages.find((p) => p.template);
  assert(tplRow && tplRow.content === false && tplRow.issues.join() === 'desc_missing,og_missing' && !audit.pages.some((p) => p.path === '/404' || p.path === '/soon'), 'a Collection template is checked on its settings only; utility pages and drafts are left out');
  assert(audit.origin === 'http://' + host && audit.readAt >= audit.at && audit.score === 85 && getJ('site:siteA').audit.complete === true && getJ('site:siteA').audit.pages === 3, 'the read is stamped with its time and its summary is kept on the site');
  r = await request(port, 'GET', '/app/keyword?id=siteA&k=' + kVen.id, { headers: { cookie } });
  assert(r.body.includes('Best page: <a href="http://' + host + '/about"') && r.body.includes('Write the fixes') && !r.body.includes('<option value="/blog/[slug]"'), 'the keyword is matched to its best page, and a Collection template is not offered as its page');
  assert(!r.body.includes('API key not valid') && r.body.includes('This engine could not answer right now. It is asked again at the next check.'), 'customers see plain words for a failed answer, never the provider message');
  r = await post('/app/keyword/page', cookie, { id: 'siteA', k: kVen.id, path: '/blog/[slug]' });
  assert(!getJ('site:siteA').keywords.find((k) => k.id === kVen.id).page, 'a Collection template cannot be chosen as the page of a keyword');
  const domAtPlan = wfState.domCalls.length;
  r = await post('/app/keyword/plan', cookie, { id: 'siteA', k: kVen.id });
  assert(wfState.domCalls.slice(domAtPlan).join() === 'p2' && decodeURIComponent(r.headers.location).includes('Fixes ready'), 'the writer gets the text of the page from Webflow, read when the user asks for the fixes');
  r = await request(port, 'GET', '/app/keyword?id=siteA&k=' + kVen.id, { headers: { cookie } });
  assert(r.body.includes('Veneers and smile design in Antalya | Lumen Dental') && r.body.includes('Q: Do UK visitors need a visa?') && r.body.includes('Apply to Webflow') && r.body.includes('value="colFaq"'), 'the fixes are written from the page, with the keyword, ready to apply');
  assert(r.body.includes('<span class="l">Now in Webflow</span><b>' + ABOUT_TITLE + '</b>') && r.body.includes('<span class="l">Suggested</span>') && /data-read-from-webflow>Read from Webflow just now\. <button/.test(r.body) && r.body.includes('name="seen_title" value="' + ABOUT_TITLE + '" form="applyform"'), 'what the page has in Webflow now stands apart from the suggestion, with the time it was read');
  assert(!r.body.includes('do_schema') && !/schema/i.test(r.body), 'no schema markup is offered or mentioned');
  {
    // the fix plan can read its page from Webflow again, and comes back to the keyword
    assert(r.body.includes('<button class="wfbtn" type="submit" form="kwrefresh">Refresh from Webflow</button>') && r.body.includes('<form id="kwrefresh" method="post" action="/app/fix/refresh" hidden>'), 'the fix plan has a Refresh from Webflow button next to the values it shows');
    const domAtRefresh = wfState.domCalls.length;
    const back = await post('/app/fix/refresh', cookie, { id: 'siteA', path: '/about', k: kVen.id });
    assert(back.status === 302 && back.headers.location.startsWith('/app/keyword?id=siteA&k=' + kVen.id + '&') && /Read%20from%20Webflow%20just%20now/.test(back.headers.location) && wfState.domCalls.slice(domAtRefresh).join() === 'p2', 'it reads that page from Webflow and returns to the keyword');
  }
  const metaGen = engineCalls.filter((c) => c.e === 'gen' && /meta descriptions/.test(c.ins)).length;
  assert(metaGen >= 1, 'the title and description were written by the AI');
  const NEW_DESC = 'Emax veneers and digital smile design in Antalya for patients from the UK and Ireland, planned in one visit.';
  r = await post('/app/keyword/apply', cookie, { id: 'siteA', k: kVen.id, what: 'page', do_meta: '1', title: 'A title sent without what was seen', description: NEW_DESC });
  assert(wfState.pageUpdates.length === 0 && decodeURIComponent(r.headers.location).includes('changed in Webflow after you opened it'), 'a write that does not name the values the user was shown is not written');
  r = await post('/app/keyword/apply', cookie, { id: 'siteA', k: kVen.id, what: 'page', do_meta: '1', seen: '1', seen_title: ABOUT_TITLE, seen_description: ABOUT_DESC, title: 'Veneers in Antalya | Lumen Dental', description: NEW_DESC, do_cms: '1', collection: 'colFaq', faq: 'Q: How long do veneers last?\nA: Usually 10 to 15 years.\n\nQ: Do UK visitors need a visa?\nA: Most do not.' });
  assert(wfState.pageUpdates.length === 1 && wfState.pageUpdates[0].id === 'p2' && wfState.pageUpdates[0].body.seo.title === 'Veneers in Antalya | Lumen Dental' && wfState.pageUpdates[0].body.seo.description === NEW_DESC && !wfState.pageUpdates[0].body.openGraph && !wfState.pageUpdates[0].body.slug, 'one click: the title and description go to the matched page, and nothing else of the page is sent');
  assert(wfState.items.length === 2 && wfState.items.every((x) => x.isDraft === true) && wfState.items[0].fieldData.answer === '<p>Usually 10 to 15 years.</p>', 'one click: the answers go to the CMS as drafts');
  assert(getJ('site:siteA').keywords.find((k) => k.id === kVen.id).fixedAt > 0 && decodeURIComponent(r.headers.location).includes('Applied the title and description and 2 answers as drafts in FAQs'), 'the keyword remembers it was fixed');
  assert(getJ('audit:siteA').pages.find((p) => p.path === '/about').title === 'Veneers in Antalya | Lumen Dental', 'Site health holds what Webflow answered to the write');
  {
    // someone changes the page in Webflow while the fix is open here: nothing is overwritten
    wfState.pages.siteA.find((p) => p.id === 'p2').seo.title = 'Veneers in Antalya, edited in the Designer';
    const before = wfState.pageUpdates.length;
    r = await post('/app/keyword/apply', cookie, { id: 'siteA', k: kVen.id, what: 'page', do_meta: '1', seen: '1', seen_title: 'Veneers in Antalya | Lumen Dental', seen_description: NEW_DESC, title: 'Another title for this page', description: 'Another description, long enough to pass the length check of the form.' });
    assert(wfState.pageUpdates.length === before && decodeURIComponent(r.headers.location).includes('changed in Webflow after you opened it') && getJ('audit:siteA').pages.find((p) => p.path === '/about').title === 'Veneers in Antalya, edited in the Designer', 'a page changed in Webflow in the meantime is not overwritten: the write stops and the values from Webflow are shown');
    r = await request(port, 'GET', '/app/keyword?id=siteA&k=' + kVen.id, { headers: { cookie } });
    assert(r.body.includes('name="seen_title" value="Veneers in Antalya, edited in the Designer"'), 'and the next Apply starts from the values Webflow has now');
  }
  r = await post('/app/keyword/page', cookie, { id: 'siteA', k: kImp.id, path: 'new' });
  r = await post('/app/keyword/plan', cookie, { id: 'siteA', k: kImp.id });
  r = await request(port, 'GET', '/app/keyword?id=siteA&k=' + kImp.id, { headers: { cookie } });
  assert(r.body.includes('Dental implants in Antalya | Lumen Dental') && r.body.includes('/dental-implants-antalya') && r.body.includes('Add the draft to Webflow'), 'a keyword without a page gets a new page drafted from what the site says');
  r = await post('/app/keyword/apply', cookie, { id: 'siteA', k: kImp.id, what: 'newpage', collection: 'colFaq' });
  assert(wfState.items.length === 3 && wfState.items[2].fieldData.name === 'Dental implants in Antalya | Lumen Dental' && wfState.items[2].fieldData.answer.includes('<h3>How long do implants take?</h3>') && wfState.items[2].isDraft, 'the new page lands in the CMS as a draft');
  r = await request(port, 'GET', '/app/site?id=siteA&tab=audit', { headers: { cookie } });
  assert(r.status === 200 && /data-read-from-webflow>3 pages of 3\. Read from Webflow just now\./.test(r.body) && r.body.includes('>Refresh from Webflow</button>') && r.body.includes('The published site is not requested') && !r.body.includes('Download llms.txt') && !r.body.includes('User-agent:'), 'Site health says where its data comes from and when it was read, and offers a refresh');
  assert(r.body.includes('>Title length</span>') && r.body.includes('>Alt text</span>') && r.body.includes('Collection template') && r.body.includes('/app/fix?id=siteA&page=%2Fabout') && !r.body.includes('/app/fix?id=siteA&page=%2Fblog'), 'the findings of each page are listed; a Collection template has no Fix button');
  r = await request(port, 'GET', '/app/llms?id=siteA', { headers: { cookie } });
  assert(r.status === 404, 'the llms.txt download is gone');
  r = await post('/app/fix/schema', cookie, { id: 'siteA', path: '/', schema: '{"@context":"https://schema.org","@type":"Dentist"}' });
  assert(r.status === 404 && !wfState.paths.some((x) => /schema/.test(x)), 'and so is the route that wrote schema markup');
  r = await request(port, 'GET', '/app/fix?id=siteA&page=' + encodeURIComponent('/blog/[slug]'), { headers: { cookie } });
  assert(r.status === 302 && r.headers.location.includes('tab=audit'), 'a Collection template has no fix page');
  r = await request(port, 'GET', '/app/fix?id=siteA&page=%2F', { headers: { cookie } });
  assert(r.status === 200 && r.body.includes('Now in Webflow') && r.body.includes('name="seen_title" value="Lumen Dental"') && r.body.includes('name="seen_description" value="Dentist."') && /data-read-from-webflow>Read from Webflow just now</.test(r.body) && r.body.includes('action="/app/fix/refresh"') && !/schema/i.test(r.body), 'the fix page shows the title and description the page has in Webflow now, when they were read and a refresh');
  {
    // the page changes in Webflow: opening the fix shows the new values, and Refresh reads its content again
    wfState.pages.siteA.find((p) => p.id === 'p1').seo.title = 'Lumen Dental Antalya';
    r = await request(port, 'GET', '/app/fix?id=siteA&page=%2F', { headers: { cookie } });
    assert(r.body.includes('name="seen_title" value="Lumen Dental Antalya"') && !getJ('audit:siteA').pages.find((p) => p.path === '/').issues.includes('title_length'), 'opening a fix reads the title and description from Webflow again');
    wfState.dom.p1.push(textNode('<h1>A second main heading</h1>'));
    r = await post('/app/fix/refresh', cookie, { id: 'siteA', path: '/' });
    assert(r.status === 302 && /Read%20from%20Webflow%20just%20now/.test(r.headers.location) && getJ('audit:siteA').pages.find((p) => p.path === '/').issues.includes('h1_multiple'), 'Refresh from Webflow on a fix page reads the content of the page again');
    wfState.dom.p1.pop();
    r = await post('/app/fix/refresh', cookie, { id: 'siteA', path: '/' });
    assert(!getJ('audit:siteA').pages.find((p) => p.path === '/').issues.includes('h1_multiple'), 'and again after the page is corrected in Webflow');
  }
  r = await post('/app/fix/suggest', cookie, { id: 'siteA', path: '/about', what: 'faq' });
  r = await request(port, 'GET', '/app/fix?id=siteA&page=%2Fabout', { headers: { cookie } });
  assert(r.body.includes('Q: Do UK visitors need a visa?') && r.body.includes('Save the draft') && r.body.includes('We found 2 questions answered on this page.'), 'AI answers are written from the page as Webflow returns it, as a draft to review');
  r = await post('/app/fix/suggest', cookie, { id: 'siteA', path: '/', what: 'meta' });
  r = await request(port, 'GET', '/app/fix?id=siteA&page=%2F', { headers: { cookie } });
  assert(r.body.includes('New title (suggested by AI, change what you like)') && r.body.includes('value="Veneers and smile design in Antalya | Lumen Dental"') && r.body.includes('name="seen_title" value="Lumen Dental Antalya"'), 'an AI suggestion is labelled as one and stays apart from what Webflow has');
  {
    const before = wfState.pageUpdates.length;
    const HOME_TITLE = 'Lumen Dental | Veneers and implants in Antalya';
    const HOME_DESC = 'Emax veneers, implants and digital smile design in Antalya for patients from the UK and Ireland.';
    r = await post('/app/fix/meta', cookie, { id: 'siteA', path: '/', seen: '1', seen_title: 'Lumen Dental', seen_description: 'Dentist.', title: HOME_TITLE, description: HOME_DESC });
    assert(wfState.pageUpdates.length === before && decodeURIComponent(r.headers.location).includes('changed in Webflow after you opened it'), 'the fix page does not overwrite a title that changed in Webflow after it was shown');
    r = await post('/app/fix/meta', cookie, { id: 'siteA', path: '/', title: HOME_TITLE, description: HOME_DESC });
    assert(wfState.pageUpdates.length === before, 'and it writes nothing for a form that does not say what the user was shown');
    r = await post('/app/fix/meta', cookie, { id: 'siteA', path: '/', seen: '1', seen_title: 'Lumen Dental Antalya', seen_description: 'Dentist.', title: HOME_TITLE, description: HOME_DESC });
    const last = wfState.pageUpdates[wfState.pageUpdates.length - 1];
    assert(wfState.pageUpdates.length === before + 1 && last.id === 'p1' && last.body.seo.title === HOME_TITLE && decodeURIComponent(r.headers.location).includes('Saved to Webflow. Publish your site in Webflow to make it live.') && getJ('audit:siteA').pages.find((p) => p.path === '/').title === HOME_TITLE, 'the title and description are written when the user presses Apply on the values shown, as an unpublished change');
  }
  {
    // a long site, or a Webflow rate limit, leaves the read in parts: nothing is guessed for a page not read yet
    process.env.WEBFLOW_RETRY_BASE_MS = '1';
    wfState.domFail.p2 = 429;
    const at = wfState.domCalls.length;
    r = await post('/app/site/audit', cookie, { id: 'siteA' });
    audit = getJ('audit:siteA');
    about = audit.pages.find((p) => p.path === '/about');
    assert(!audit.complete && audit.pending === 1 && audit.pagesChecked === 2 && about.state === 'pending' && about.words === null && about.content === false && !about.issues.includes('thin') && !about.issues.includes('h1_missing'), 'when Webflow asks to slow down, the page that was not read is marked as not read: no finding is made up for it');
    assert(wfState.domCalls.slice(at).filter((x) => x === 'p2').length === 4 && decodeURIComponent(r.headers.location).includes('2 of 3 pages are read so far. Webflow limits how fast its API may be read. Press "Read the rest" in a minute.') && audit.slowed === 60, 'the rate-limited call is tried three more times, then the read stops and says how far it got and why');
    r = await request(port, 'GET', '/app/site?id=siteA&tab=audit', { headers: { cookie } });
    assert(r.body.includes('>Read the rest</button>') && r.body.includes('Text not read yet') && r.body.includes('The text of 1 page is not read yet: Webflow limits how fast its API may be read'), 'Site health shows what is not read yet and offers to read the rest');
    delete wfState.domFail.p2;
    const at2 = wfState.domCalls.length;
    r = await post('/app/site/audit', cookie, { id: 'siteA', resume: '1' });
    audit = getJ('audit:siteA');
    assert(audit.complete && audit.pending === 0 && audit.pagesChecked === 3 && wfState.domCalls.slice(at2).join() === 'p2' && audit.pages.find((p) => p.path === '/about').faq.length === 2, '"Read the rest" reads only the pages that were left');
    {
      // Webflow says with every answer how many calls it still takes this minute: the read stops short of the limit
      wfState.remaining = 7; // two calls list the site and its pages: five are left, fewer than the app keeps back
      const at3 = wfState.domCalls.length, refusedAt = wfState.refused.length;
      r = await post('/app/site/audit', cookie, { id: 'siteA' });
      audit = getJ('audit:siteA');
      assert(wfState.domCalls.length === at3 && audit.pending === 2 && audit.slowed === 60 && !audit.complete && wfState.remaining === 5 && wfState.refused.length === refusedAt && decodeURIComponent(r.headers.location).includes('Webflow limits how fast its API may be read'), 'near the rate limit of Webflow the read stops before the limit is reached, and says so');
      wfState.remaining = 120; // a minute later Webflow takes calls again
      r = await post('/app/site/audit', cookie, { id: 'siteA', resume: '1' });
      assert(getJ('audit:siteA').complete && getJ('audit:siteA').slowed === 0 && wfState.domCalls.slice(at3).sort().join() === 'p1,p2', 'and reads the rest when asked again');
      wfState.remaining = null;
    }
    wfState.domFail.p2 = 500;
    r = await post('/app/site/audit', cookie, { id: 'siteA' });
    audit = getJ('audit:siteA');
    assert(audit.complete && audit.pages.find((p) => p.path === '/about').state === 'unreadable' && audit.pages.find((p) => p.path === '/about').words === null, 'a page whose content Webflow does not return is listed with its settings and marked as not available');
    r = await request(port, 'GET', '/app/site?id=siteA&tab=audit', { headers: { cookie } });
    assert(r.body.includes('Text not available'), 'and Site health says so');
    delete wfState.domFail.p2;
    r = await post('/app/site/audit', cookie, { id: 'siteA' });
    delete process.env.WEBFLOW_RETRY_BASE_MS;
    assert(getJ('audit:siteA').pages.every((p) => !p.state), 'the next refresh reads every page again');
  }

  console.log("localized sites: writes go to the primary locale");
  assert(wfState.pageUpdates.every((x) => !x.localeId) && wfState.items.every((x) => !x.cmsLocaleId), 'a site without locales is written exactly as before');
  wfState.sites[0].locales = { primary: { id: 'loc_en', cmsLocaleId: 'cms_en', displayName: 'English', tag: 'en', enabled: true }, secondary: [{ id: 'loc_tr', cmsLocaleId: 'cms_tr', displayName: 'Turkish', tag: 'tr', enabled: true }, { id: 'loc_de', cmsLocaleId: 'cms_de', displayName: 'German', tag: 'de', enabled: false }] };
  {
    const now = wfState.pages.siteA.find((p) => p.id === 'p1').seo;
    const before = wfState.pageUpdates.length;
    r = await post('/app/fix/meta', cookie, { id: 'siteA', path: '/', seen: '1', seen_title: now.title, seen_description: now.description, title: 'Lumen Dental | Veneers, implants and smile design', description: 'Emax veneers, implants and digital smile design in Antalya for patients from the UK and Ireland.' });
    assert(r.status === 302 && wfState.pageUpdates.length === before + 1 && decodeURIComponent(r.headers.location).includes('Saved to Webflow'), 'the title and description of a localized site are accepted by Webflow');
    assert(wfState.pageUpdates[wfState.pageUpdates.length - 1].localeId === null && wfState.pageUpdates[wfState.pageUpdates.length - 1].body.seo.title.startsWith('Lumen Dental | Veneers'), 'the title and description go to the primary locale without naming it (Webflow refuses a primary locale id)');
  }
  r = await post('/app/fix/faq', cookie, { id: 'siteA', path: '/about', action: 'cms', collection: 'colFaq', faq: 'Q: Do you speak English?\nA: Yes, every coordinator does.' });
  const lastItem = wfState.items[wfState.items.length - 1];
  assert(!lastItem.cmsLocaleId && lastItem.isDraft === true && lastItem.fieldData.name === 'Do you speak English?', 'CMS drafts are created in the primary locale without naming it');
  assert(getJ('site:siteA').locale && getJ('site:siteA').locale.id === 'loc_en' && getJ('site:siteA').locale.others.join() === 'Turkish', 'the site keeps its languages; a disabled one is left out');
  r = await request(port, 'GET', '/app/fix?id=siteA&page=%2F', { headers: { cookie } });
  assert(r.body.includes('data-locale-note') && r.body.includes('one more language (Turkish)') && r.body.includes('primary language, English, only'), 'the fix page says only the primary language is written');
  r = await request(port, 'GET', '/app/keyword?id=siteA&k=' + kVen.id, { headers: { cookie } });
  assert(r.body.includes('data-locale-note'), 'the keyword page says it too, next to Apply');
  delete wfState.sites[0].locales;
  await require('../api/_lib/store').updateSite('siteA', (s) => { s.locale = null; });
  r = await request(port, 'GET', '/app/fix?id=siteA&page=%2F', { headers: { cookie } });
  assert(!r.body.includes('data-locale-note'), 'no note on a site with one language');

  console.log('the panel inside the Webflow Designer');
  const PANEL = 'https://cid.webflow-ext.com';
  const ext = (route, body, origin) => request(port, route === 'OPTIONS' ? 'OPTIONS' : 'POST', '/ext/' + (route === 'OPTIONS' ? 'context' : route), { headers: Object.assign({ 'content-type': 'application/json' }, origin === null ? {} : { origin: origin || PANEL }), body: route === 'OPTIONS' ? undefined : JSON.stringify(body) });
  r = await ext('OPTIONS');
  assert(r.status === 204 && r.headers['access-control-allow-origin'] === PANEL && /Origin/.test(r.headers.vary || '') && /POST/.test(r.headers['access-control-allow-methods']), 'the panel can call the app from its own address, and only that address is named');
  r = await ext('OPTIONS', null, 'https://evil.example');
  assert(r.status === 403 && !r.headers['access-control-allow-origin'], 'another origin gets no permission to call the panel routes');
  r = await ext('context', { siteId: 'siteA', idToken: 'idt:siteA', pageId: 'p2', path: '/about' }, 'https://abc123.webflow-ext.com');
  assert(r.status === 403 && !r.headers['access-control-allow-origin'] && !/keyword|engines/.test(r.body), 'the panel of another app is refused, with a valid ID token too');
  r = await ext('context', { siteId: 'siteA', idToken: 'idt:siteA', pageId: 'p2', path: '/about' }, null);
  assert(r.status === 403, 'a request that names no origin is refused');
  {
    // a caller that cannot be confirmed gets one and the same answer, whatever the reason
    const refusedOnes = [];
    refusedOnes.push(await ext('context', { siteId: 'siteA', idToken: 'bad-token', pageId: 'p2', path: '/about' }));
    refusedOnes.push(await ext('context', { siteId: 'siteA', idToken: 'idt:otherSite', pageId: 'p2', path: '/about' }));
    refusedOnes.push(await ext('context', { siteId: 'siteNotHere', idToken: 'idt:siteNotHere', pageId: 'x1', path: '/' }));
    wfState.resolveStatus = 500;
    refusedOnes.push(await ext('context', { siteId: 'siteA', idToken: 'idt:siteA', pageId: 'p2', path: '/about' }));
    wfState.resolveStatus = 0;
    const domAt = wfState.domCalls.length, updatesAt = wfState.pageUpdates.length;
    const fixedBefore = getJ('site:siteA').keywords.find((k) => k.id === kVen.id).fixedAt;
    await new Promise((done) => setTimeout(done, 5));
    refusedOnes.push(await ext('suggest', { siteId: 'siteA', idToken: 'idt:otherSite', pageId: 'p2', path: '/about', what: 'meta' }));
    refusedOnes.push(await ext('applied', { siteId: 'siteA', idToken: 'bad-token', pageId: 'p2', path: '/about', keywordId: kVen.id }));
    const first = JSON.parse(refusedOnes[0].body);
    assert(refusedOnes.every((x) => x.status === 200 && x.body === refusedOnes[0].body) && Object.keys(first).sort().join() === 'connect,connectUrl' && first.connect === true && first.connectUrl === 'https://app.test/app?available=1', 'an unknown ID token, a token of another site, a site that is not connected and a failing Webflow all get the same answer: it does not tell which sites use the app');
    assert(wfState.domCalls.length === domAt && wfState.pageUpdates.length === updatesAt && getJ('site:siteA').keywords.find((k) => k.id === kVen.id).fixedAt === fixedBefore, 'and nothing is read or changed for such a caller');
    r = await ext('context', { siteId: 'siteA', pageId: 'p2', path: '/about' });
    assert(r.status === 400, 'a request without an ID token is a bad request');
    r = await ext('context', { siteId: ['siteA'], idToken: 'idt:siteA', pageId: 'p2', path: '/about' });
    assert(r.status === 400, 'and so is one whose site id is not a plain id');
    r = await ext('context', { siteId: 'siteA', idToken: 'idt:siteA:user_77', pageId: 'p2', path: '/about' });
    assert(r.status === 200 && JSON.parse(r.body).ok === true, 'a teammate who opens the panel on the same site in the Designer is confirmed by Webflow for that site');
  }
  r = await ext('context', { siteId: 'siteA', idToken: 'idt:siteA', pageId: 'p2', path: '/about' });
  let ctx = JSON.parse(r.body);
  assert(r.status === 200 && ctx.ok && ctx.page.path === '/about' && ctx.page.audited && ctx.plan.canApply === true && /\/app\/site\?id=siteA/.test(ctx.site.url), 'the panel gets the page it is on, matched by its id');
  assert(ctx.page.readAt > Date.now() - 60000 && ctx.rules.title.min === 20 && ctx.rules.title.max === 65 && ctx.rules.description.aimMax === 155 && !('schemaTypes' in ctx.page) && /tab=audit/.test(ctx.site.healthUrl), 'with the time Site health read it from Webflow, the length limits, and no schema fields');
  assert(ctx.keywords.some((k) => k.text === 'veneers in antalya' && k.answered > 0 && /\/app\/keyword\?id=siteA&k=/.test(k.url)) && ctx.engines.length >= 3, 'and the keywords that belong to the page, with each engine');
  r = await ext('context', { siteId: 'siteA', idToken: 'idt:siteA', pageId: 'pNew', path: 'about/' });
  assert(JSON.parse(r.body).page.path === '/about', 'a page id the audit has not read is matched by its path');
  r = await ext('suggest', { siteId: 'siteA', idToken: 'idt:siteA', pageId: 'p2', path: '/about', what: 'meta' });
  const panelSug = JSON.parse(r.body);
  assert(panelSug.ok && /Lumen Dental/.test(panelSug.meta.title) && panelSug.meta.description.length > 40, 'the panel writes a title and description from the page');
  assert(panelSug.readAt > Date.now() - 60000 && wfState.domCalls[wfState.domCalls.length - 1] === 'p2', 'and the text it writes from is the page as the Webflow API returns it, read at that moment');
  r = await ext('faq', { siteId: 'siteA', idToken: 'idt:siteA', pageId: 'p2', path: '/about', keywordId: kVen.id, faq: [{ q: 'How long do veneers last?', a: 'Usually 10 to 15 years.' }, { q: 'Do UK visitors need a visa?', a: 'Most do not for a short stay.' }] });
  assert(r.status === 404 && !wfState.paths.some((x) => /schema/.test(x)), 'the panel route that wrote FAQ schema is gone');
  wfState.pages.siteB = [{ id: 'pB', title: 'B', slug: 'b', publishedPath: '/b', seo: { title: 'A page of another site', description: '' }, openGraph: {} }];
  wfState.dom.pB = [textNode('<h1>Another site</h1>')];
  const domAtB = wfState.domCalls.length;
  r = await ext('suggest', { siteId: 'siteA', idToken: 'idt:siteA', pageId: 'pB', path: '/b', what: 'meta' });
  assert(r.status === 404 && /not part of this site/.test(JSON.parse(r.body).error) && wfState.domCalls.length === domAtB, 'a page of another site is refused whatever id the panel sends, before its content is read');
  delete wfState.pages.siteB;
  {
    // the user sets a title in the Designer; the server takes the values of the page from Webflow, not from the panel
    wfState.pages.siteA.find((p) => p.id === 'p2').seo.title = 'About Lumen Dental, veneers in Antalya';
    const before = wfState.pageUpdates.length;
    r = await ext('applied', { siteId: 'siteA', idToken: 'idt:siteA', pageId: 'p2', path: '/about', title: 'A title the panel made up', description: 'Not what Webflow has.', keywordId: kImp.id });
    assert(JSON.parse(r.body).ok && wfState.pageUpdates.length === before && getJ('audit:siteA').pages.find((x) => x.path === '/about').title === 'About Lumen Dental, veneers in Antalya', 'after a change in the Designer, Site health holds what Webflow has, not what the panel reports, and the server writes nothing');
    assert(getJ('site:siteA').keywords.find((x) => x.id === kImp.id).fixedAt > Date.now() - 60000, 'and the keyword knows about the fix');
  }
  r = await request(port, 'GET', '/ext/context', { headers: { origin: PANEL } });
  assert(r.status === 405, 'the panel routes take POST only');

  console.log('free plan limits on fixes');
  const u2 = getJ('user:user_1'); u2.plan = 'free'; db.set('user:user_1', JSON.stringify(u2));
  r = await ext('context', { siteId: 'siteA', idToken: 'idt:siteA', pageId: 'p2', path: '/about' });
  assert(JSON.parse(r.body).plan.canApply === false && /\/app\/settings#plan$/.test(JSON.parse(r.body).plan.upgradeUrl), 'on the free plan the panel is told it cannot apply, with the address of the plans');
  const updatesBefore = wfState.pageUpdates.length;
  const homeNow = wfState.pages.siteA.find((p) => p.id === 'p1').seo;
  r = await post('/app/fix/meta', cookie, { id: 'siteA', path: '/', seen: '1', seen_title: homeNow.title, seen_description: homeNow.description, title: 'A title that is long enough', description: 'A description that is long enough to pass the check.' });
  assert(wfState.pageUpdates.length === updatesBefore && decodeURIComponent(r.headers.location).includes('paid plans'), 'free plan cannot write to Webflow');
  r = await post('/app/keyword/apply', cookie, { id: 'siteA', k: kVen.id, what: 'page', do_meta: '1', title: 'A title that is long enough', description: 'A description that is long enough to pass the check.' });
  assert(wfState.pageUpdates.length === updatesBefore && decodeURIComponent(r.headers.location).includes('paid plans'), 'free plan cannot apply keyword fixes');

  console.log('reports, security, billing');
  r = await post('/app/site/report', cookie, 'id=siteA');
  const tok = getJ('site:siteA').settings.reportToken;
  r = await request(port, 'GET', '/r/' + tok, {});
  assert(r.status === 200 && r.body.includes('AI visibility of Lumen Dental') && r.body.includes('class="kt"') && !r.body.includes('/app/keyword') && !r.body.includes('Sign out'), 'public report shows the deck without app links or signing in');
  r = await request(port, 'GET', '/r/nope-nope-nope', {});
  assert(r.status === 404, 'unknown report link is 404');
  r = await post('/app/site/settings', cookie, 'id=siteA&brand=Hacked', 'https://evil.test');
  assert(r.status === 403 && getJ('site:siteA').project.brand === 'Lumen Dental', 'cross-site posts are blocked');
  r = await request(port, 'GET', '/app/site?id=otherSite', { headers: { cookie } });
  assert(r.status === 404, 'other sites are not reachable');
  r = await request(port, 'GET', '/app/keyword?id=siteA&k=nope', { headers: { cookie } });
  assert(r.status === 302 && decodeURIComponent(r.headers.location).includes('no longer tracked'), 'an unknown keyword goes back to the deck');
  r = await request(port, 'GET', '/app/settings', { headers: { cookie } });
  assert(r.status === 200 && r.body.includes('name="plan" value="solo"') && r.body.includes('10 keywords') && r.body.includes('$19'), 'settings show upgrade buttons and keyword plans');
  assert(r.body.includes('Try free for 7 days') && r.body.includes('US$0 today, then US$19 a month or US$190 a year') && r.body.includes('All prices are in US dollars (USD)'), 'settings offer the 7 day trial on paid plans, with every price in US dollars and the yearly price named');
  {
    const card = (name) => r.body.split('<div class="plan').find((c) => c.includes('<b>' + name));
    const studio = card('Studio'), agency = card('Agency');
    assert(studio && studio.includes('value="monthly"') && !studio.includes('value="yearly"') && studio.includes('US$0 today, then US$49 a month. Cancel') && agency && !agency.includes('/app/billing/checkout'),
      'settings show a button only for a plan and billing period that has a Polar product');
  }
  r = await request(port, 'GET', '/app/start?plan=studio&interval=yearly', { headers: { cookie } });
  assert(r.status === 200 && r.body.includes('name="interval" value="monthly"') && !r.body.includes('Pay yearly'), 'start page falls back to the billing period that can be bought');
  r = await request(port, 'GET', '/app/start?plan=agency&interval=monthly', { headers: { cookie } });
  assert(r.status === 302 && decodeURIComponent(r.headers.location).includes('The Agency plan is not open yet'), 'a plan with no product sends the customer on with the free plan');
  r = await post('/app/billing/checkout', cookie, 'plan=agency&interval=monthly');
  assert(r.status === 502 && r.body.includes('could not be opened right now') && !r.body.includes('Flowdeck') && !r.body.includes('Polar returned'), 'a failed checkout shows plain words, never the product list');
  r = await post('/app/billing/checkout', cookie, 'plan=solo&interval=yearly');
  assert(r.headers.location === 'https://polar.test/checkout/1' && polarState.checkouts[0].products[0] === 'p_solo_y' && polarState.checkouts[0].metadata.app === 'aiseodeck', 'checkout uses the AI SEO Deck yearly product, never the Flowdeck one');
  assert(polarState.checkouts[0].trial_interval === 'day' && polarState.checkouts[0].trial_interval_count === 7 && polarState.checkouts[0].success_url === 'https://app.test/app/billing/return?next=settings&checkout_id={CHECKOUT_ID}', 'checkout carries a 7 day trial and returns with the checkout id');
  r = await request(port, 'GET', '/app/start?plan=studio&interval=monthly', { headers: { cookie } });
  assert(r.status === 200 && r.body.includes('Try Studio free for 7 days') && r.body.includes('<dd>US$0</dd>') && r.body.includes('Not now, continue on the free plan') && r.body.includes('name="from" value="start"'), 'start page shows the trial, today and the first charge');
  const billingLib = require('../api/_lib/billing');
  const store = require('../api/_lib/store');
  process.env.ENGINES = 'none';
  assert(!(await billingLib.canCheckout(getJ('user:user_1'))), 'no checkout while no AI engine can answer');
  delete process.env.ENGINES;
  {
    const coId = '3f1c9a52-0d7e-4c55-9e57-2b6f4d1a8c11';
    const trialEnd = new Date(Date.now() + 7 * 86400000).toISOString();
    polarState.checkout = { id: coId, status: 'succeeded', subscription_id: 'sub_t1', metadata: { user_id: 'user_1', sig: billingLib.sign('user_1'), app: 'aiseodeck' } };
    polarState.subs.sub_t1 = { id: 'sub_t1', status: 'trialing', amount: 1900, currency: 'usd', cancel_at_period_end: false, trial_start: new Date().toISOString(), trial_end: trialEnd, current_period_end: trialEnd, modified_at: new Date().toISOString(), customer_id: 'cus_1', product: { id: 'p_solo_m', name: 'AI SEO Deck Solo', recurring_interval: 'month', metadata: { app: 'aiseodeck', plan: 'solo' } }, metadata: { user_id: 'user_1', sig: billingLib.sign('user_1') } };
    r = await request(port, 'GET', '/app/billing/return?next=setup&checkout_id=' + coId, { headers: { cookie } });
    const u3 = getJ('user:user_1');
    assert(r.status === 302 && decodeURIComponent(r.headers.location).includes('trial is on until') && u3.plan === 'solo' && u3.billing.status === 'on_trial' && u3.billing.trialEnd === trialEnd && u3.trialUsedAt, 'back from checkout, the trial is on at once without waiting for the webhook');
    assert(!billingLib.trialEligible(u3), 'one trial per account');
    r = await request(port, 'GET', '/app', { headers: { cookie } });
    assert(r.body.includes('class="trialchip"') && r.body.includes('Trial, </span>7 days left') && !r.body.includes('Try Solo free'), 'the header shows the days left of the trial');
    r = await request(port, 'GET', '/app/settings', { headers: { cookie } });
    assert(r.body.includes('trial runs until') && r.body.includes('$19 a month is charged') && r.body.includes('Switch in billing') && !r.body.includes('Try free for'), 'settings explain the trial and switch plans through billing');
    r = await post('/app/billing/checkout', cookie, 'plan=studio&interval=monthly');
    assert(r.headers.location === '/app/billing/portal' && polarState.checkouts.length === 1, 'no second checkout while a subscription runs');
    polarState.checkout.metadata = { user_id: 'someone_else', sig: billingLib.sign('someone_else') };
    const other = await billingLib.syncCheckout(Object.assign({}, u3, { billing: {}, plan: 'free' }), coId, { saveUser: async () => {} });
    assert(!other.ok && other.why === 'another account', 'a checkout of another account is never applied');
  }
  const sub = { id: 'sub_1', status: 'active', cancel_at_period_end: false, current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(), modified_at: new Date().toISOString(), customer_id: 'cus_1', product: { id: 'p_solo_m', name: 'AI SEO Deck Solo', recurring_interval: 'month', metadata: { app: 'aiseodeck', plan: 'solo' } }, metadata: { user_id: 'user_1', sig: billingLib.sign('user_1') } };
  const raw = JSON.stringify({ type: 'subscription.active', data: sub });
  const id = 'msg_1', ts = Math.floor(Date.now() / 1000);
  const keyBytes = Buffer.from(process.env.POLAR_WEBHOOK_SECRET.slice(6), 'base64');
  const sig = 'v1,' + crypto.createHmac('sha256', keyBytes).update(`${id}.${ts}.${raw}`).digest('base64');
  const hdrs = { 'webhook-id': id, 'webhook-timestamp': String(ts), 'webhook-signature': sig };
  const out = await billingLib.handleWebhook(raw, hdrs, { getUser: store.getUser, saveUser: store.saveUser, enforce: (u) => store.enforceLimit(u) });
  assert(out.status === 200 && getJ('user:user_1').plan === 'solo', 'signed Polar webhook upgrades the plan');
  const bad = await billingLib.handleWebhook(raw, Object.assign({}, hdrs, { 'webhook-signature': 'v1,AAAA' }), { getUser: store.getUser, saveUser: store.saveUser });
  assert(bad.status === 401, 'bad webhook signature refused');

  console.log('perplexity stays off until switched on');
  {
    const engines = require('../api/_lib/engines');
    const htmlLib = require('../api/_lib/html');
    assert(engines.enabled().includes('perplexity') && engines.freeEngines().join() === 'openai,aio,perplexity', 'with PERPLEXITY_ENABLED=1 the engine is on and the free plan keeps it');
    delete process.env.PERPLEXITY_ENABLED;
    assert(!engines.enabled().includes('perplexity') && engines.enabled().length === 6, 'without the switch Perplexity is off, even with its key set');
    assert(engines.freeEngines().join() === 'openai,aio,gemini', 'the free plan then uses ChatGPT, Google AI Overviews and Gemini');
    assert(engines.forLimits({ allEngines: false }).join() === 'openai,aio,gemini' && engines.lockedFor({ allEngines: false }).join() === 'aimode,claude,grok', 'free plan engines and locked columns follow');
    assert(htmlLib.freeEnginesText() === 'ChatGPT, Google AI Overviews and Gemini' && htmlLib.allEnginesCount() === 6, 'the copy says six engines and names the free ones');
    process.env.PERPLEXITY_ENABLED = '1';
  }

  console.log('perplexity agent api');
  {
    const engines = require('../api/_lib/engines');
    const q = 'Best clinic for veneers in Antalya?';
    process.env.PERPLEXITY_API = 'agent';
    let ans = await engines.ask('perplexity', q, { country: 'GB', timeoutMs: 5000 });
    const call = engineCalls.filter((c) => c.e === 'perplexity-agent').pop();
    assert(call && call.effort === 'fast' && call.country === 'GB', 'Agent API asked with effort fast and the country');
    assert(ans.text && ans.queries.length === 2 && ans.sources.length >= 1 && !ans.sources.some((s) => /uncited/.test(s.url)) && ans.consulted.some((s) => /uncited/.test(s.url)), 'Agent API answer read: cited results are sources, the rest consulted, searches kept');
    delete process.env.PERPLEXITY_API;
    flags.sonarGone = true;
    const before = engineCalls.filter((c) => c.e === 'perplexity-agent').length;
    ans = await engines.ask('perplexity', q, { country: 'GB', timeoutMs: 5000 });
    assert(ans.text && engineCalls.filter((c) => c.e === 'perplexity-agent').length === before + 1, 'when Sonar is gone, Perplexity answers come from the Agent API');
    flags.sonarGone = false;
  }

  console.log('slow engines get a full window');
  {
    const jobs = require('../api/_lib/jobs');
    const enginesLib = require('../api/_lib/engines');
    assert(jobs.canStartTask('a.0|grok|0', 13000) && !jobs.canStartTask('a.0|grok|0|w', jobs.FULL_WINDOW_MS - 1) && jobs.canStartTask('a.0|grok|0|w', jobs.FULL_WINDOW_MS), 'a task cut short by our window waits for a full one');
    assert(jobs.windowRetry('a.0', 'grok', 1) === 'a.0|grok|1|w' && jobs.FULL_WINDOW_MS >= 42000, 'the retry keeps its attempt and is marked');
    const realAsk = enginesLib.ask;
    const asked = [];
    let slowMode = 'window'; // 'window': grok needs the full 40 seconds; 'never': grok always times out
    enginesLib.ask = async (engine, text, o) => {
      asked.push({ engine, timeoutMs: o.timeoutMs });
      if (engine === 'grok' && slowMode === 'refused') throw new enginesLib.EngineError('Your team has either used all available credits or reached its monthly spending limit.', 403, false);
      if (engine === 'grok' && (slowMode === 'never' || o.timeoutMs < 40000)) throw new enginesLib.EngineError('timed out', 0, true);
      return { text: 'Lumen Dental is a good choice for veneers.', sources: [], consulted: [], queries: [], ms: 5, model: 'stub' };
    };
    const fakeSite = { id: 'siteSlow', keywords: [{ id: 'k1', text: 'veneers antalya', questions: ['Best clinic for veneers in Antalya?'] }], project: { brand: 'Lumen Dental', domains: ['lumendental.com'], country: 'GB', language: 'en' } };
    try {
      const slow = await store.createRun(fakeSite, { id: 'user_slow' }, ['openai', 'grok'], 'manual', null, true);
      const queueOf = (id) => (db.get('rq:' + id) || []).slice();
      let out = await jobs.workRun(slow.id, Date.now() + 20000);
      let res = await store.results(slow.id);
      assert(out.ok === 1 && out.failed === 0 && out.retry === 1 && res['k1.0|openai'] && res['k1.0|openai'].ok && !res['k1.0|grok'], 'in a short window the fast engine answers and the slow one is not counted as failed');
      assert(queueOf(slow.id).join() === 'k1.0|grok|0|w' && asked.filter((a) => a.engine === 'grok').length === 1, 'the slow answer goes back to the queue marked, attempt not used');
      out = await jobs.workRun(slow.id, Date.now() + 30000);
      assert(asked.filter((a) => a.engine === 'grok').length === 1 && queueOf(slow.id).join() === 'k1.0|grok|0|w', 'a window too short for it does not start it again');
      out = await jobs.workRun(slow.id, Date.now() + 50000);
      res = await store.results(slow.id);
      const last = asked.filter((a) => a.engine === 'grok').pop();
      assert(last.timeoutMs === 40000 && res['k1.0|grok'] && res['k1.0|grok'].ok && !queueOf(slow.id).length, 'a full window gives it 40 seconds and the answer is saved');
      await store.endRun(slow.id);

      slowMode = 'never';
      const stuck = await store.createRun(fakeSite, { id: 'user_slow' }, ['grok'], 'manual', null, true);
      for (let i = 0; i < 3; i++) await jobs.workRun(stuck.id, Date.now() + 50000);
      res = await store.results(stuck.id);
      assert(res['k1.0|grok'] && res['k1.0|grok'].ok === false && res['k1.0|grok'].err === 'timed out' && !queueOf(stuck.id).length, 'an engine that times out with the full 40 seconds fails after three tries instead of looping');
      await store.endRun(stuck.id);

      slowMode = 'refused';
      db.delete('alert:xai');
      const mailsBefore = emails.length;
      const refused = await store.createRun(fakeSite, { id: 'user_slow' }, ['grok'], 'manual', null, true);
      const grokCalls = asked.filter((a) => a.engine === 'grok').length;
      await jobs.workRun(refused.id, Date.now() + 50000);
      res = await store.results(refused.id);
      assert(res['k1.0|grok'] && res['k1.0|grok'].ok === false && res['k1.0|grok'].kind === 'account' && asked.filter((a) => a.engine === 'grok').length === grokCalls + 1, 'an engine that refuses our account is not asked again in the same check');
      assert(emails.length === mailsBefore + 1 && /xAI \(Grok\) needs attention/.test(emails[emails.length - 1].subject), 'and the owner is told');
      await store.endRun(refused.id);

      // the last answers in flight with an open page are never cut off by the background job finishing the run
      slowMode = 'window';
      const race = await store.createRun(fakeSite, { id: 'user_slow' }, ['grok'], 'manual', null, true);
      race.lastProgressAt = Date.now() - 10 * 60000;
      await store.saveRun(race);
      await store.lock('run:' + race.id, 60); // a page pump is working on it
      const inFlight = await store.takeTasks(race.id, 12);
      let fin = await jobs.maybeFinish(race.id, Date.now());
      assert(inFlight.length === 1 && fin === false && (await store.getRun(race.id)).status === 'running', 'a run is not finished while a worker has its last answer in flight');
      await store.requeue(race.id, ...inFlight);
      await store.unlock('run:' + race.id);
      fin = await jobs.maybeFinish(race.id, Date.now());
      assert(fin === false && (await store.tasksLeft(race.id)) === 1, 'an answer back in the queue keeps the run going');
      await store.takeTasks(race.id, 12); // lost for good: nobody works on it any more
      fin = await jobs.maybeFinish(race.id, Date.now());
      assert(fin === true && (await store.getRun(race.id)).status === 'done', 'with nothing left and nobody working, a stale run is finished as it is');
    } finally {
      enginesLib.ask = realAsk;
    }
  }

  console.log('plain errors for customers, alerts for the owner');
  {
    const alerts = require('../api/_lib/alerts');
    const llm = require('../api/_lib/llm');
    const callsBefore = engineCalls.length, mailsBefore = emails.length;
    const cutReply = await llm.generateJSON({ system: 'Test writer.', prompt: 'CUTSHORT please', maxTokens: 300 });
    const cutCall = engineCalls.slice(callsBefore).find((c) => c.e === 'gen-max');
    assert(cutReply && cutReply.from === 'gemini' && cutCall && cutCall.max >= 4000 && emails.length === mailsBefore, 'writing: a reply cut short at the token limit goes to the next provider without an alert, and the limit leaves room for reasoning');
    const proseReply = await llm.generateJSON({ system: 'Test writer.', prompt: 'NOJSON please' });
    assert(proseReply && proseReply.from === 'gemini', 'writing: a reply that is not JSON goes to the next provider');
    const t0 = Date.now();
    const slowReply = await llm.generateJSON({ system: 'Test writer.', prompt: 'SLOWGEN please', timeoutMs: 400, budgetMs: 8000 });
    assert(slowReply && slowReply.from === 'gemini' && Date.now() - t0 < 1400, 'writing: a provider that takes too long hands over to the next one while the time budget lasts');
    const t1 = Date.now();
    const raced = await llm.generateJSON({ system: 'Test writer.', prompt: 'SLOWGEN please', race: true, timeoutMs: 5000, budgetMs: 8000 });
    assert(raced && raced.from === 'gemini' && Date.now() - t1 < 1200, 'writing: for a step a visitor waits on, two providers are asked at once and the first answer is used');
    const cutRaced = await llm.generateJSON({ system: 'Test writer.', prompt: 'CUTSHORT please', race: true, maxTokens: 300 });
    assert(cutRaced && cutRaced.from === 'gemini' && emails.length === mailsBefore, 'writing: in a race, a reply cut short loses to the one that can be read, without an alert');
    const k = (message, status) => alerts.kindOf({ message, status });
    assert(k('You exceeded your current quota, please check your plan and billing details.', 429) === 'account' && k('Rate limit reached for gpt-6 in organization org-1 on requests per min. Please try again in 1s.', 429) === 'busy', 'OpenAI: an empty balance needs the owner, a rate limit passes');
    assert(k('Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.', 400) === 'account' && k('Overloaded', 529) === 'busy', 'Anthropic: low credit balance, overload');
    assert(k('Your team has either used all available credits or reached its monthly spending limit.', 403) === 'account' && k('Incorrect API key provided: sk-x', 401) === 'account', 'xAI credits, a wrong key');
    assert(k('Google results: You are not authorized to access this resource.', 40100) === 'account' && k('Keyword data: Payment Required.', 40200) === 'account' && k('Google results: Internal Server Error.', 50000) === 'busy' && k('Google results: Invalid Field.', 40501) === 'other', 'DataForSEO codes');
    assert(k('timed out', 0) === 'timeout' && k('Resource has been exhausted (e.g. check quota).', 429) === 'busy', 'timeouts and Gemini rate limits');
    assert(alerts.engineText({ ok: false, err: 'Google results: You are not authorized to access this resource. See your login details here: https://app.dataforseo.com/api-access' }) === alerts.ENGINE_TEXT.account, 'older saved failures also show plain words');
    assert(alerts.publicText(Object.assign(new Error('The AI reply could not be read. Try again.'), { public: true }), 'x') === 'The AI reply could not be read. Try again.' && alerts.publicText(new Error('AI provider: You exceeded your current quota'), alerts.WRITING_TEXT) === alerts.WRITING_TEXT, 'only our own messages reach customers as they are');
    db.delete('alert:dataforseo');
    const before = emails.length;
    let kind = await alerts.report('dataforseo', { message: 'Keyword data: Payment Required.', status: 40200 }, 'monthly searches');
    const mail = emails[emails.length - 1];
    assert(kind === 'account' && emails.length === before + 1 && mail.to[0] === 'info@silitlabs.com' && mail.subject === 'AI SEO Deck: DataForSEO needs attention' && mail.text.includes('https://app.dataforseo.com') && mail.text.includes('monthly searches'), 'the owner gets an email that says what failed and where to fix it');
    await alerts.report('dataforseo', { message: 'Keyword data: Payment Required.', status: 40200 }, 'monthly searches');
    kind = await alerts.report('openai', { message: 'Rate limit reached', status: 429 }, 'writing');
    assert(emails.length === before + 1 && kind === 'busy', 'at most one email per service every 6 hours, none for a rate limit');

    // writing falls back to the next provider when one refuses our account
    const llmLib = require('../api/_lib/llm');
    const realFetch = global.fetch;
    db.delete('alert:openai');
    global.fetch = (url, o) => (/\/v1\/responses$/.test(String(url)) && !JSON.parse(o.body).tools
      ? Promise.resolve(new Response(JSON.stringify({ error: { message: 'You exceeded your current quota, please check your plan and billing details.', type: 'insufficient_quota' } }), { status: 429, headers: { 'Content-Type': 'application/json' } }))
      : realFetch(url, o));
    let text = '';
    try { text = await llmLib.generate({ system: 'Write a short line.', prompt: 'Lumen Dental veneers', maxTokens: 50 }); } finally { global.fetch = realFetch; }
    assert(text && /Lumen Dental|clinic|Prices/i.test(text) && emails.some((e) => e.subject === 'AI SEO Deck: OpenAI needs attention'), 'with no OpenAI credit the fixes are written by the next provider and the owner is told');
  }

  console.log('cost guard');
  process.env.MAX_DAILY_CALLS = '1';
  await store.updateSite('siteA', (s) => { s.sched.nextRunAt = Date.now() - 1000; });
  r = await request(port, 'GET', '/cron/tick', { headers: { authorization: 'Bearer cronkey' } });
  const tickOut = JSON.parse(r.body);
  site = getJ('site:siteA');
  assert(tickOut.started === 1 && tickOut.budget === true && site.sched.runId, 'daily call budget stops work and keeps the run for later');
  delete process.env.MAX_DAILY_CALLS;

  console.log('delete account');
  r = await request(port, 'GET', '/app/settings', { headers: { cookie } });
  assert(r.body.includes('deletes everything we stored') && r.body.includes('the Webflow access tokens') && r.body.includes('The app stays listed in Webflow until you remove it there'), 'the account page says what deleting the account deletes and what it leaves to Webflow');
  r = await post('/app/delete', cookie, 'sure=1');
  assert(r.status === 200 && r.body.includes('Your account is deleted') && r.body.includes('Uninstall app') && !db.get('user:user_1') && !db.get('site:siteA') && !db.get('audit:siteA') && !db.get('hist:siteA') && !db.get('res:' + run4.id) && ![...db.keys()].some((k) => k.startsWith('email:')), 'account and all site data deleted, single keyword checks included, and the page says how to remove the app in Webflow');
  assert(wfState.revokeCalls.length === 0 && (r.headers['set-cookie'] || []).some((c) => c.startsWith('ad_session=;')), 'the stored tokens are deleted with the account and the session ends; nothing is revoked at Webflow');
  r = await request(port, 'GET', '/app', { headers: { cookie } });
  assert(r.status === 302 && r.headers.location === '/login', 'the old session opens nothing');

  console.log('signed in keyword from the home page, uninstall detection');
  r = await request(port, 'GET', '/auth');
  const st2 = new URL(r.headers.location).searchParams.get('state');
  r = await request(port, 'GET', '/callback?code=good-code&state=' + st2, { headers: { cookie: cookiesFrom(r) } });
  const cookie2 = cookiesFrom(r);
  r = await post('/app/setup', cookie2, { id: 'siteA', brand: 'Lumen Dental', domains: host, language: 'en', pick: ['veneers in antalya'] });
  let firstRun = getJ('site:siteA').sched.runId;
  assert(!!firstRun, 'reconnected site starts its first check');
  r = await request(port, 'GET', '/auth?plan=studio&interval=yearly', { headers: { cookie: cookie2 } });
  assert(r.headers.location === '/app/start?plan=studio&interval=yearly', 'a signed in user goes from a plan button straight to the start page');
  r = await request(port, 'GET', '/auth?plan=solo');
  const st3 = new URL(r.headers.location).searchParams.get('state');
  assert(cookiesFrom(r).includes('ad_plan='), 'the plan waits in a cookie during Webflow sign in');
  r = await request(port, 'GET', '/callback?code=good-code&state=' + st3, { headers: { cookie: cookiesFrom(r) } });
  assert(r.headers.location === '/app/start?plan=solo&interval=monthly', 'after Webflow the plan opens the start page');
  assert(getJ('user:user_1').connections.length === 1 && getJ('site:siteA').connectionId === getJ('user:user_1').connections[0].id && wfState.revokeCalls.length === 0, 'a new authorization takes the place of the older one for the same sites: the older token is forgotten, and nothing is revoked at Webflow');
  r = await request(port, 'GET', '/auth?kw=all%20on%204%20antalya', { headers: { cookie: cookie2 } });
  assert(r.headers.location === '/app?kw=all%20on%204%20antalya', 'a signed in user skips Webflow and goes to the app with the keyword');
  r = await request(port, 'GET', r.headers.location, { headers: { cookie: cookie2 } });
  assert(r.headers.location === '/app/site?id=siteA&tab=keywords&kw=all%20on%204%20antalya', 'the keyword opens on the only site');
  r = await request(port, 'GET', r.headers.location, { headers: { cookie: cookie2 } });
  assert(r.body.includes('value="all on 4 antalya"'), 'the add keyword box holds it');

  console.log('disconnect, and connect again without a new authorization');
  {
    const tokensBefore = wfState.tokenRequests.length;
    r = await request(port, 'GET', '/app/site?id=siteA&tab=settings', { headers: { cookie: cookie2 } });
    assert(r.body.includes('Disconnect this site') && r.body.includes('connect this site again from your Sites page without authorizing again') && r.body.includes('Uninstall app') && r.body.includes('then Revoke next to AI SEO Deck'), 'the settings of a site explain Disconnect, and how access is removed in Webflow');
    r = await post('/app/site/remove', cookie2, { id: 'siteA' });
    assert(!!getJ('site:siteA'), 'Disconnect asks for a confirmation');
    r = await post('/app/site/remove', cookie2, { id: 'siteA', sure: '1' });
    assert(r.status === 302 && r.headers.location.startsWith('/app?available=1') && !db.get('site:siteA') && !db.get('run:' + firstRun) && getJ('user:user_1').connections.length === 1 && wfState.revokeCalls.length === 0, 'Disconnect deletes what is kept about the site, keeps the authorization and revokes nothing at Webflow');
    r = await request(port, 'GET', r.headers.location, { headers: { cookie: cookie2 } });
    assert(r.status === 200 && r.body.includes('Sites you authorized in Webflow') && r.body.includes('name="site" value="siteA"') && /data-read-from-webflow>Read from Webflow just now\./.test(r.body) && r.body.includes('Connecting one of these needs no new authorization') && r.body.includes('Authorize another site or Workspace in Webflow'), 'the Sites page lists the sites the authorization covers, read from Webflow at that moment');
    r = await post('/app/sites/connect', cookie2, { site: 'siteZ' });
    assert(!db.get('site:siteZ') && decodeURIComponent(r.headers.location).includes('not among the sites you authorized'), 'a site Webflow does not list for this account cannot be connected, whatever id is posted');
    r = await post('/app/sites/connect', cookie2, { site: 'siteA' });
    assert(r.headers.location === '/app/setup?id=siteA' && getJ('site:siteA') && getJ('site:siteA').userId === 'user_1' && getJ('site:siteA').keywords.length === 0 && wfState.tokenRequests.length === tokensBefore, 'the site is connected again, empty, without a new authorization at Webflow');
    r = await request(port, 'GET', '/app/settings', { headers: { cookie: cookie2 } });
    assert(r.body.includes('Webflow authorizations') && r.body.includes('1 site connected') && r.body.includes('action="/app/connection/remove"') && r.body.includes('Uninstall app') && r.body.includes('at the latest within a day'), 'the account page lists the authorizations and says how the app is uninstalled in Webflow and what happens then');
    const connId = getJ('user:user_1').connections[0].id;
    r = await post('/app/connection/remove', cookie2, { id: connId });
    assert(!!getJ('site:siteA'), 'Disconnect for an authorization asks for a confirmation too');
    r = await post('/app/connection/remove', cookie2, { id: connId, sure: '1' });
    assert(!db.get('site:siteA') && getJ('user:user_1').connections.length === 1 && getJ('user:user_1').siteIds.length === 0 && wfState.revokeCalls.length === 0 && decodeURIComponent(r.headers.location).includes('The app is still installed in Webflow'), 'Disconnect for an authorization removes its sites here and leaves the authorization as it is');
    r = await post('/app/connection/remove', cookie2, { id: 'someone-elses', sure: '1' });
    assert(r.status === 404, 'an authorization of another account cannot be disconnected');
    r = await request(port, 'GET', '/app', { headers: { cookie: cookie2 } });
    assert(r.body.includes('No site is connected') && r.body.includes('href="/app?available=1"') && r.body.includes('href="/auth"'), 'with no site connected, the Sites page offers the sites already authorized, and a new authorization for others');
    r = await post('/app/sites/connect', cookie2, { site: 'siteA' });
    r = await post('/app/setup', cookie2, { id: 'siteA', brand: 'Lumen Dental', language: 'en', pick: ['veneers in antalya'] });
    firstRun = getJ('site:siteA').sched.runId;
    assert(!!firstRun && wfState.tokenRequests.length === tokensBefore && wfState.revokeCalls.length === 0, 'and the site works again after connecting, still without a new authorization');
  }

  console.log('uninstalled in Webflow');
  await store.endRun(firstRun);
  await store.updateSite('siteA', (s) => { s.sched.runId = ''; s.sched.firstRunDone = true; s.sched.nextRunAt = Date.now() - 1000; });
  {
    // Webflow does not say whether the token works when scheduled checks are due: the checks run all the same,
    // since they ask the AI engines only, nothing is removed, and Webflow is asked once in that pass, not per site
    const jobsLib = require('../api/_lib/jobs');
    await store.saveSite(Object.assign({}, getJ('site:siteA'), { id: 'siteZ', kw: {} }));
    assert(db.get('sites:all').has('siteZ') && getJ('site:siteZ').sched.nextRunAt < Date.now(), 'a second site of the same authorization is due as well');
    wfState.authStatus = 503;
    const callsBefore = wfState.authCalls;
    const t0 = Date.now();
    const startedRuns = await jobsLib.scheduleDue(Date.now(), 20);
    wfState.authStatus = 0;
    const due = getJ('site:siteA'), dueZ = getJ('site:siteZ');
    assert(startedRuns >= 1 && due && !!due.sched.runId && getJ('user:user_1').connections.length === 1 && !(getJ('user:user_1').notice || '').includes('uninstalled'), 'a scheduled check starts all the same when Webflow does not answer about the token, and nothing is removed');
    assert(wfState.authCalls === callsBefore + 1 && Date.now() - t0 < 3000, 'Webflow is asked once in that pass, with no second try: a Webflow that is not answering never holds up the checks');
    for (const x of [due, dueZ]) if (x && x.sched.runId) await store.endRun(x.sched.runId);
    db.delete('site:siteZ'); db.get('sites:all').delete('siteZ');
    await store.updateSite('siteA', (s) => { s.sched.runId = ''; s.sched.firstRunDone = true; s.sched.nextRunAt = Date.now() - 1000; });
    assert(!db.has('site:siteZ') && !getJ('site:siteA').sched.runId, 'the test site is gone again');
  }
  wfState.revoked = true;
  wfState.refused.length = 0;
  r = await request(port, 'GET', '/cron/tick', { headers: { authorization: 'Bearer cronkey' } });
  assert(!db.get('site:siteA') && !db.get('audit:siteA') && /uninstalled/.test(getJ('user:user_1').notice || '') && getJ('user:user_1').connections.length === 0 && getJ('user:user_1').siteIds.length === 0, 'an uninstalled app is noticed before the next check: the token is forgotten and the sites are deleted with what was kept about them');
  assert(wfState.refused.join() === 'GET /v2/token/authorized_by' && wfState.revokeCalls.length === 0, 'one call found it out, and nothing more was asked of Webflow with that token');
  r = await request(port, 'GET', '/cron/tick', { headers: { authorization: 'Bearer cronkey' } });
  r = await request(port, 'GET', '/app', { headers: { cookie: cookie2 } });
  assert(wfState.refused.length === 1 && r.body.includes('no longer has access to Webflow') && r.body.includes('Connect Webflow'), 'later ticks and pages ask Webflow nothing, and the Sites page says what happened');
  wfState.revoked = false;
  {
    // the same, found by something the user does
    let a = await request(port, 'GET', '/auth', { headers: { cookie: cookie2 } });
    a = await request(port, 'GET', '/callback?code=good-code&state=' + new URL(a.headers.location).searchParams.get('state'), { headers: { cookie: cookie2 + '; ' + cookiesFrom(a) } });
    assert(a.status === 302 && getJ('site:siteA') && getJ('user:user_1').connections.length === 1, 'installing the app again brings the site back, empty');
    wfState.revoked = true;
    wfState.refused.length = 0;
    r = await post('/app/site/audit', cookie2, { id: 'siteA' });
    assert(r.status === 302 && r.headers.location === '/app' && !db.get('site:siteA') && getJ('user:user_1').connections.length === 0 && /uninstalled/.test(getJ('user:user_1').notice || ''), 'when a user action meets the refusal, the same happens at once');
    assert(wfState.refused.length === 2 && wfState.refused[1] === 'GET /v2/token/authorized_by', 'two calls in all: the one that was refused, and one that asked Webflow whether the token still works');
    wfState.revoked = false;
    // and by the daily look at the stored tokens, for a site nobody opens
    a = await request(port, 'GET', '/auth', { headers: { cookie: cookie2 } });
    a = await request(port, 'GET', '/callback?code=good-code&state=' + new URL(a.headers.location).searchParams.get('state'), { headers: { cookie: cookie2 + '; ' + cookiesFrom(a) } });
    const jobsLib = require('../api/_lib/jobs');
    const clearChecks = () => { for (const k of [...db.keys()]) if (k === 'lock:conncheck' || k === 'conncursor' || k.startsWith('connchk:')) { db.delete(k); ttl.delete(k); } };
    const markOf = (id) => 'connchk:' + id;
    const conn1 = getJ('user:user_1').connections[0].id;
    clearChecks();
    let seen = await jobsLib.checkConnections(Date.now(), 8000);
    const markLeft = ttl.get(markOf(conn1)) - Date.now();
    assert(seen.asked === 1 && seen.removed === 0 && getJ('site:siteA') && markLeft > 19.9 * 3600000 && markLeft <= 20 * 3600000, 'each stored token is asked whether Webflow still accepts it, and not again for 20 hours; a working one changes nothing');
    seen = await jobsLib.checkConnections(Date.now(), 8000);
    db.delete('lock:conncheck');
    const seen2 = await jobsLib.checkConnections(Date.now(), 8000);
    assert(seen.asked === 0 && seen2.asked === 0 && ttl.get('lock:conncheck') - Date.now() > 3590000, 'the look starts at most once an hour, and a token is asked about at most once in 20 hours');
    {
      // the hourly job of its own
      clearChecks();
      let j = await request(port, 'GET', '/cron/tokens', {});
      assert(j.status === 401 && !db.has(markOf(conn1)), 'the hourly look at the tokens needs the cron secret');
      j = await request(port, 'GET', '/cron/tokens', { headers: { authorization: 'Bearer cronkey' } });
      assert(j.status === 200 && JSON.parse(j.body).asked === 1 && JSON.parse(j.body).removed === 0 && db.has(markOf(conn1)), 'and with it, it asks about every token that is due');
      j = await request(port, 'GET', '/cron/nothing', { headers: { authorization: 'Bearer cronkey' } });
      assert(j.status === 404, 'an unknown job does nothing');
    }
    {
      // Webflow does not say whether the token works: nothing is removed, and it is asked again an hour later
      for (const status of [503, 429]) {
        clearChecks();
        wfState.authStatus = status;
        const callsBefore = wfState.authCalls;
        const t0 = Date.now();
        seen = await jobsLib.checkConnections(Date.now(), 8000);
        const again = ttl.get(markOf(conn1)) - Date.now();
        assert(seen.asked === 1 && seen.removed === 0 && seen.unsure === 1 && getJ('site:siteA') && getJ('user:user_1').connections.length === 1 && again > 3590000 && again <= 3600000 && wfState.authCalls === callsBefore + 1 && Date.now() - t0 < 1500 && db.has('lock:conncheck'),
          'when Webflow answers ' + status + ' about a token, nothing is removed: it is asked once, not again in a row, and again an hour later');
        wfState.authStatus = 0;
      }
    }
    {
      // more accounts than fit in one pass: the next pass continues where this one stopped
      const extra = ['user_2', 'user_3'].map((id) => { const u = store.newUser({ id, email: id + '@agency.com' }); const c = store.addConnection(u, 'tok_abc', 'Other', []); return { u, c }; });
      for (const e of extra) await store.saveUser(e.u);
      const order = ['user_1', 'user_2', 'user_3'];
      const connOf = { user_1: conn1, user_2: extra[0].c.id, user_3: extra[1].c.id };
      const asked = () => order.filter((id) => db.has(markOf(connOf[id]))).join();
      clearChecks();
      wfState.authDelayMs = 700;
      seen = await jobsLib.checkConnections(Date.now(), 300);
      wfState.authDelayMs = 0;
      assert(seen.asked === 1 && seen.more === true && asked() === 'user_1' && getJ('conncursor').id === 'user_1' && !db.has('lock:conncheck'), 'a pass that runs out of time remembers the account it reached and lets the next tick continue');
      const visited = [];
      const realGetUser = store.getUser;
      store.getUser = async (id) => { visited.push(id); return realGetUser(id); };
      seen = await jobsLib.checkConnections(Date.now(), 8000);
      store.getUser = realGetUser;
      assert(seen.asked === 2 && !seen.more && asked() === 'user_1,user_2,user_3' && !db.has('conncursor') && db.has('lock:conncheck'), 'the next pass asks about the accounts that were not reached, and then the hour starts');
      assert(visited.join() === 'user_2,user_3,user_1', 'it starts after the account the pass before stopped at, so the accounts at the end are reached however many there are (visited: ' + visited.join() + ')');
      // a pass cut while Webflow is not answering waits its hour
      clearChecks();
      wfState.authStatus = 503;
      wfState.authDelayMs = 700;
      seen = await jobsLib.checkConnections(Date.now(), 300);
      wfState.authStatus = 0;
      wfState.authDelayMs = 0;
      assert(seen.asked === 1 && seen.unsure === 1 && seen.more === true && db.has('lock:conncheck') && getJ('conncursor').id === 'user_1', 'a pass that stopped while Webflow was not answering is not continued at once: the next one waits its hour');
      for (const e of extra) { db.delete('user:' + e.u.id); db.get('users:all').delete(e.u.id); }
    }
    clearChecks();
    wfState.revoked = true;
    wfState.refused.length = 0;
    seen = await jobsLib.checkConnections(Date.now(), 8000);
    assert(seen.asked === 1 && seen.removed === 1 && !db.get('site:siteA') && getJ('user:user_1').connections.length === 0 && wfState.refused.join() === 'GET /v2/token/authorized_by', 'a token Webflow refuses is forgotten at that moment, with its sites');
    wfState.revoked = false;
  }

  console.log('shared database prefix');
  {
    const kv = require('../api/_lib/kv');
    process.env.KV_PREFIX = 'asd:';
    db.set('user:other_app', '"keep"');
    await kv.setJSON('user:p1', { a: 1 });
    await kv.sadd('sites:p', 'x', 'y');
    assert(db.has('asd:user:p1') && !db.has('user:p1') && db.has('asd:sites:p'), 'keys get the prefix');
    const got = await kv.mgetJSON(['user:p1', 'user:other_app']);
    assert(got[0] && got[0].a === 1 && got[1] === null, 'reads stay inside the prefix and never see the other app');
    await kv.pipeline([['SET', 'pipe:1', '"v"'], ['GET', 'pipe:1']]);
    assert(db.get('asd:pipe:1') === '"v"', 'pipelined commands get the prefix');
    await kv.del('user:p1', 'sites:p', 'pipe:1', 'user:other_app');
    assert(!db.has('asd:user:p1') && !db.has('asd:sites:p') && db.get('user:other_app') === '"keep"', 'deleting never touches the other app');
    delete process.env.KV_PREFIX;
    db.delete('user:other_app');
  }

  console.log('where the requests of the whole run went');
  {
    const expected = { ['127.0.0.1:' + redisPort]: 'the database', ['127.0.0.1:' + aiPort]: 'AI engines and keyword data', ['127.0.0.1:' + resendPort]: 'mail', ['127.0.0.1:' + wfPort]: 'the Webflow API', ['127.0.0.1:' + polarPort]: 'billing' };
    const other = [...requestedHosts].filter((h) => !expected[h]);
    assert(requestedHosts.has('127.0.0.1:' + wfPort) && other.length === 0, 'every request of the run went to the Webflow API, an AI or keyword data provider, the mail provider, the billing provider or the database' + (other.length ? ' (also asked: ' + other.join(', ') + ')' : ''));
    assert(customerHits.length === 0 && !requestedHosts.has(host), 'the published website of the customer was never requested' + (customerHits.length ? ' (got: ' + customerHits.slice(0, 5).join(', ') + ')' : ''));
    const beta = [...new Set(wfState.paths.filter((x) => !x.includes(' /v2/')))];
    assert(beta.join() === 'POST /beta/token/resolve', 'every Webflow call of the run was on the stable /v2 API, except the one that resolves the ID token of the Designer panel (found: ' + beta.join(', ') + ')');
    const used = [...new Set(wfState.paths.map((x) => x.replace(/\/(sites|pages|collections)\/[A-Za-z0-9]+/g, '/$1/:id')))].sort();
    const known = ['GET /v2/collections/:id', 'GET /v2/pages/:id', 'GET /v2/pages/:id/dom', 'GET /v2/sites', 'GET /v2/sites/:id', 'GET /v2/sites/:id/collections', 'GET /v2/sites/:id/pages', 'GET /v2/token/authorized_by', 'POST /beta/token/resolve', 'POST /v2/collections/:id/items', 'PUT /v2/pages/:id'];
    assert(used.every((x) => known.includes(x)) && known.every((x) => used.includes(x)), 'the Webflow endpoints the app calls are exactly the ones the review notes list (called: ' + used.join(', ') + ')');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
