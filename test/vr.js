// AI Visibility Report, end to end: a made-up hotel (test/vr-fixture.js), a mock Redis, canned AI engines and a mock
// Polar. Nothing leaves this process. Run: node test/vr.js
const http = require('http');
const crypto = require('crypto');
const fx = require('./vr-fixture.js');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { passed++; console.log('  ok   ' + m); } else { failed++; console.log('  FAIL ' + m); } }
const listen = (server) => new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
function request(port, method, p, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: Object.assign(body ? { 'Content-Type': 'application/json' } : {}, headers) }, (res) => {
      const ch = [];
      res.on('data', (c) => ch.push(c));
      res.on('end', () => { const text = Buffer.concat(ch).toString(); let j = null; try { j = JSON.parse(text); } catch (e) { j = null; } resolve({ status: res.statusCode, headers: res.headers, body: text, json: j }); });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

/* ---- mock Polar ---- */
const polarState = { checkouts: [], byId: {}, products: [{ id: 'p_solo_m', name: 'AI SEO Deck Solo', recurring_interval: 'month', metadata: {} }, { id: 'p_report', name: 'AI Visibility Report', metadata: { app: 'aiseodeck', kind: 'report' } }] };
const polar = http.createServer((req, res) => {
  const ch = [];
  req.on('data', (c) => ch.push(c));
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    let body = null;
    try { body = JSON.parse(Buffer.concat(ch).toString()); } catch (e) { body = null; }
    const send = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    let m;
    if (u.pathname === '/v1/products/') return send(200, { items: polarState.products.filter((p) => (u.searchParams.get('is_recurring') === 'false' ? !p.recurring_interval : true)), pagination: { max_page: 1 } });
    if (u.pathname === '/v1/checkouts/' && req.method === 'POST') { const id = 'co-' + (polarState.checkouts.length + 1) + '-abcdef'; polarState.checkouts.push(body); polarState.byId[id] = Object.assign({ id, status: 'open' }, body); return send(201, { id, url: 'https://polar.test/checkout/' + id }); }
    if (req.method === 'GET' && (m = u.pathname.match(/^\/v1\/checkouts\/([\w-]+)$/))) return polarState.byId[m[1]] ? send(200, polarState.byId[m[1]]) : send(404, { detail: 'not found' });
    send(404, { detail: 'no route' });
  });
});

(async () => {
  const redis = fx.mockRedis();
  fx.env(await redis.listen());
  const polarPort = await listen(polar);
  Object.assign(process.env, { POLAR_ACCESS_TOKEN: 'polar_oat', POLAR_API_BASE: 'http://127.0.0.1:' + polarPort, POLAR_WEBHOOK_SECRET: 'whsec_' + Buffer.from('polar-secret-key').toString('base64'), VR_UNLOCK_KEY: 'unlock-key-for-tests', CRON_SECRET: 'cronkey' });
  const calls = fx.install();
  const core = require('../api/_lib/vr/core.js');
  const state = require('../api/_lib/vr/state.js');
  const pay = require('../api/_lib/vr/pay.js');
  const V = require('../api/_lib/vr/view.js');
  const kv = require('../api/_lib/kv.js');
  const billing = require('../api/_lib/billing.js');
  const engines = require('../api/_lib/engines.js');
  const until = async (id, status, max) => { for (let i = 0; i < (max || 40); i++) { await core.pump(id, 30000); const c = await core.get(id); if (c && c.status === status) return c; } return core.get(id); };
  const pub = async (id, opts) => state.publicState(await core.get(id), await core.rowsOf(id), Object.assign({ canPay: true }, opts || {}));

  console.log('\nThe address a visitor types');
  assert(core.normalizeUrl('Example.com/pricing?x=1').host === 'example.com' && core.normalizeUrl('https://www.example.com').origin === 'https://www.example.com', 'a bare domain or a full address both work, and only the home page is kept');
  assert(core.normalizeUrl('').error === 'empty' && core.normalizeUrl('hello@example.com').error === 'email' && core.normalizeUrl('javascript:alert(1)').error === 'bad' && core.normalizeUrl('not a site').error === 'bad', 'empty input, an email address, a script and loose words are refused with their own words');
  assert(core.normalizeUrl('instagram.com/somehotel').error === 'shared' && !core.normalizeUrl('myhotel.webflow.io').error, 'a page on a social network is refused; a site on a builder subdomain is fine');
  process.env.ALLOW_PRIVATE_FETCH = '';
  assert(core.normalizeUrl('localhost:3000').error === 'bad' && core.normalizeUrl('http://127.0.0.1/').error === 'bad' && core.normalizeUrl('example.com:8443').error === 'bad' && core.normalizeUrl('intranet').error === 'bad', 'local names, IP addresses and odd ports are refused');
  process.env.ALLOW_PRIVATE_FETCH = '1';

  console.log('\nReading the site');
  const started = await core.start('casaaldora.example', { ip: 'visitor1' });
  const id = started.id;
  let c = await core.get(id);
  assert(core.ID_RE.test(id) && c.status === 'draft', 'a check is created as a draft with a long random id');
  assert(c.project.brand === 'Casa Aldora' && c.profile.category === 'boutique hotel' && c.topics.length === 5 && c.topics[0].keyword === 'boutique hotel alfama' && /^What is a good boutique hotel/.test(c.topics[0].question), 'the business, what it is and the searches its customers make are worked out from the home page, each with its question');
  assert(calls.volumes.length === 1 && calls.volumes[0].country === 'GB' && calls.volumes[0].list.length === 10 && c.topics.map((t) => t.volume).join() === '590,480,110,90,70' && c.topics.every((t) => t.looked === 'GB'), 'ten searches are looked up in the customers\' country and the five made most often are kept, most searched first');
  assert(!c.topics.concat(c.others).some((t) => t.keyword === 'boutique hotels in alfama lisbon') && c.others.map((o) => o.keyword + ':' + o.volume).join('|') === 'small hotel lisbon old town:50|family run hotel lisbon:40|lisbon hotel with courtyard:30|alfama hotel near fado houses:null', 'another wording of the main search is dropped even though it is searched more; the rest are kept aside with their numbers');
  assert(core.pickTopics(fx.SEARCHES, fx.VOLUMES.GB, 3).map((t) => t.keyword).join('|') === 'boutique hotel alfama|romantic hotels lisbon|quiet hotel lisbon' && core.pickTopics([{ keyword: 'main thing', question: 'q' }, { keyword: 'side thing', question: 'q' }, { keyword: 'third thing', question: 'q' }], { 'side thing': 100, 'third thing': 50 }, 2).map((t) => t.keyword).join('|') === 'side thing|main thing', 'the main thing the business sells always makes the report, placed by its own number');
  assert(c.ask.country === 'GB' && c.ask.language === 'en', 'the question is asked from where the customers are, not where the business is');
  assert(c.site.words > 300 && c.site.blockedBots.includes('Claude-SearchBot') && !c.site.llms && c.site.sitemap && !c.site.orgSchema && !c.site.description, 'the home page is read like a crawler: words, robots.txt, llms.txt, sitemap, structured data');
  const found = core.findingsOf(c.site).map((f) => f.code);
  assert(found[0] === 'robots_blocks_ai' && found.includes('org_schema_missing') && found.includes('meta_weak') && found.includes('llms_missing'), 'findings come worst first');
  const again = await core.start('https://www.casaaldora.example/rooms', { ip: 'visitor2' });
  assert(again.id === id && again.cached, 'a second visitor of the same website within a week gets the same check');
  let draft = await pub(id);
  const draftHtml = V.app(draft);
  assert(draft.stage === 'draft' && draft.countries.length === 18 && !draft.slots && !draft.report && /Is this you/.test(draftHtml), 'the draft shows what was read and asks which search to check');
  assert(draft.topics[0].measured && draft.others.length === 4 && (draftHtml.match(/type="radio"/g) || []).length === 5 && /590<small> a month<\/small>/.test(draftHtml) && /Google searches a month in the United Kingdom, most searched first/.test(draftHtml) && /Left out, because fewer people search them: small hotel lisbon old town \(50\), family run hotel lisbon \(40\), lisbon hotel with courtyard \(30\)\./.test(draftHtml), 'the searches are there to pick from, each with its monthly number, and the ones left out are named');

  console.log('\nThe free check');
  assert((await core.runFree(id, { topic: 't0', question: 'x', country: 'GB' })).ok, 'a question left as it is starts the check');
  c = await core.get(id);
  assert(c.status === 'running' && c.phase === 'free' && c.run.total === 3 && c.run.engines.join() === 'openai,aio,gemini', 'one question goes to the three free engines');
  let asking = await pub(id);
  assert(asking.stage === 'asking' && asking.slots.length === 3 && asking.slots.every((s) => s.state === 'pending'), 'while the engines work the page shows three sheets waiting');
  c = await until(id, 'preview');
  assert(c.status === 'preview', 'the free check ends in a preview');
  const freeAsks = calls.ask.slice();
  assert(freeAsks.length === 3 && freeAsks.every((a) => a.country === 'GB'), 'three engine calls, each from the customers\' country');
  assert(freeAsks.find((a) => a.engine === 'aio').prompt === 'boutique hotel alfama' && /^What is a good boutique hotel/.test(freeAsks.find((a) => a.engine === 'openai').prompt), 'Google gets the search, chat engines get the question');
  let prev = await pub(id);
  const gpt = prev.slots.find((s) => s.e === 'openai'), aio = prev.slots.find((s) => s.e === 'aio');
  assert(gpt.state === 'both' && gpt.rank === 2 && gpt.of === 4 && gpt.cited, 'ChatGPT: named second of four and the site is a source');
  assert(aio.state === 'absent' && aio.of === 3 && !aio.you, 'Google AI Overviews: three others, not the business');
  assert(!JSON.stringify(gpt.named).includes('Not There') && gpt.named.some((n) => n.kind === 'directory' && n.name === 'TripAdvisor'), 'a name the answer never wrote is dropped; a listing site is told apart from a business');
  const marks = gpt.blocks.flatMap((b) => b.segs).filter((s) => s.m);
  assert(marks.filter((s) => s.m === 'you').length === 2 && marks.some((s) => s.m === 'rival' && s.x === 'Hotel Marquês Azul') && marks.some((s) => s.m === 'dir'), 'the answer comes as plain blocks with the business, rivals and listing sites marked');
  assert(!/\*\*|\]\(http/.test(JSON.stringify(gpt.blocks)), 'no markdown is left in the blocks');
  assert(prev.preview.named === 2 && prev.preview.answers === 3 && prev.preview.rivals[0].name === 'The Lumiar House' && prev.preview.findings === 4, 'the preview counts answers, rivals and findings');
  const prevJson = JSON.stringify(prev);
  assert(!prev.report && !prev.answers && !/Almada Terrace|application\/ld\+json|Porto/.test(prevJson) && prev.findings.first.title.includes('Claude-SearchBot'), 'nothing of the paid report is sent before payment: one finding, counts for the rest');
  const html = V.app(prev);
  assert(/2 of 3 AI engines named you/.test(html) && /Get the full report for \$29/.test(html) && /You, named 2nd of 4/.test(html), 'the preview page gives the verdict, the pen notes and the price');
  assert(/about 590 searches a month on Google in the United Kingdom/.test(html) && prev.locked.topics.length === 4 && prev.locked.topics[0].keyword === 'romantic hotels lisbon' && prev.locked.topics[0].volume === 480 && /Your other four searches/.test(html) && /made about 1,340 times a month on Google in the United Kingdom/.test(html), 'it says how often the search is made, and lists the other searches with their numbers');
  assert((await core.pump(id, 5000)).status === 'preview' && (await core.runFree(id, {})).already, 'a finished free check does no more work, and cannot be run twice');

  console.log('\nPaying');
  assert(await pay.enabled(), 'the one-time product is found at Polar by its name');
  const url = await pay.checkoutUrl(await core.get(id), 'https://app.test');
  const co = polarState.checkouts[0];
  assert(/polar\.test\/checkout/.test(url) && co.products[0] === 'p_report' && co.success_url === 'https://app.test/check/' + id + '?checkout_id={CHECKOUT_ID}' && co.metadata.check_id === id && co.metadata.sig === pay.sign(id), 'the checkout is for the report product and carries the signed check id');
  const coId = Object.keys(polarState.byId)[0];
  assert(!(await pay.confirm(id, coId)).ok && !(await core.get(id)).paid, 'an open checkout does not open the report');
  polarState.byId[coId].status = 'succeeded'; polarState.byId[coId].customer_email = 'Owner@CasaAldora.example'; polarState.byId[coId].total_amount = 2900;
  const other = await core.start('appshell.example', { ip: 'visitor3' });
  assert(!(await pay.confirm(other.id, coId)).ok && !(await core.get(other.id)).paid, 'a paid checkout cannot open somebody else\'s check');
  assert((await pay.confirm(id, coId)).ok, 'a succeeded checkout opens the report');
  c = await core.get(id);
  assert(c.paid && c.paid.checkoutId === coId && c.email === 'owner@casaaldora.example' && c.status === 'running' && c.phase === 'full', 'the check is marked paid, keeps the buyer\'s email and starts the full run');
  assert(c.run.total === 54 && (await kv.llen('vrq:' + id)) === 51, 'the full run is 54 answers; the 3 free ones are kept, 51 are asked');
  // the webhook arrives too: signed, and harmless the second time
  const sign = (raw, msgId) => { const ts = Math.floor(Date.now() / 1000); const key = Buffer.from(process.env.POLAR_WEBHOOK_SECRET.slice(6), 'base64'); return { 'webhook-id': msgId, 'webhook-timestamp': String(ts), 'webhook-signature': 'v1,' + crypto.createHmac('sha256', key).update(`${msgId}.${ts}.${raw}`).digest('base64') }; };
  const paidEvt = JSON.stringify({ type: 'order.paid', data: { id: 'ord_1', checkout_id: coId, total_amount: 2900, customer: { email: 'owner@casaaldora.example' }, metadata: { check_id: id, sig: pay.sign(id) } } });
  const wh = await pay.handleWebhook(paidEvt, sign(paidEvt, 'msg_1'), { verify: billing.polar.verify });
  assert(wh.status === 200 && wh.body.already, 'the order.paid webhook is accepted and changes nothing the second time');
  assert((await pay.handleWebhook(paidEvt, Object.assign(sign(paidEvt, 'msg_2'), { 'webhook-signature': 'v1,AAAA' }), { verify: billing.polar.verify })).status === 401, 'a webhook with a bad signature is refused');
  const strange = JSON.stringify({ type: 'order.paid', data: { id: 'ord_9', metadata: { check_id: id, sig: 'forged' } } });
  assert((await pay.handleWebhook(strange, sign(strange, 'msg_3'), { verify: billing.polar.verify })).status === 202, 'an order with a forged check id is ignored');
  const building = await pub(id);
  assert(building.stage === 'building' && building.progress.total === 54 && building.matrix.length === 5 && building.slots.length === 3 && !building.report, 'while the report is built the page shows progress and the free answers');

  console.log('\nThe full report');
  c = await until(id, 'done', 60);
  assert(c.status === 'done' && c.report, 'the report is built in steps and ends as done');
  const r = c.report;
  assert(calls.ask.length === 54 && calls.ask.filter((a) => /^What is Casa Aldora in Alfama, Lisbon\?/.test(a.prompt)).length === 4, '51 more engine calls: five searches on six engines, chat engines twice, and four asked about the business by name');
  assert(r.counts.answers === 49 && r.counts.named === 15 && r.counts.cited === 7 && r.counts.first === 6 && r.counts.none === 1 && r.score === 24, 'named in 15 of 49 answers, cited in 7, first in 6, one search with no AI answer: score 24');
  assert(r.ladder.map((x) => x.state).join() === 'partly,partly,partly,partly,partly' && r.start === 'readable' && r.ladder[0].p === 0.83 && r.ladder[2].p === 0.31 && r.ladder[4].p === 0.12, 'the ladder: every rung judged and measured, the lowest that wobbles is where to start');
  const m0 = r.matrix[0].cells;
  assert(m0.find((x) => x.e === 'openai').samples.join() === 'both,absent' && m0.find((x) => x.e === 'gemini').samples.join() === 'both,named' && r.matrix[2].cells.find((x) => x.e === 'aio').samples[0] === 'none' && r.matrix[3].named === 7 && r.matrix[2].named === 0, 'asked twice: ChatGPT named the business once and not the second time; one search is won, one is lost outright');
  assert(r.demand.known === 5 && r.demand.total === 1340 && r.demand.country === 'GB' && r.demand.top.keyword === 'boutique hotel alfama' && r.demand.gap.keyword === 'romantic hotels lisbon' && r.demand.gap.named === 1, 'the demand behind the report: 1,340 searches a month, and the biggest gap is not the search with the fewest answers naming the business');
  assert(r.voice[0].name === 'Hotel Marquês Azul' && r.voice[0].n === 37 && r.voice.find((v) => v.you).n === 15 && r.dirs[0].name === 'TripAdvisor', 'who gets named instead, with the spellings merged');
  const rd = r.reading;
  assert(rd.opened === 8 && rd.you === 2 && rd.top.name === 'The Lumiar House' && rd.top.n === 7, 'the pages the engines read were opened: the business is on 2 of 8');
  const lw = rd.pages.find((p) => p.host === 'lisbonweekender.example');
  assert(lw.status === 'read' && lw.you === false && lw.rivals.length === 4 && rd.pages.filter((p) => p.host === 'lisbonweekender.example').length === 1, 'a page cited by address and by site name is one row, read for the business and its rivals');
  assert(rd.pages.find((p) => p.host === 'tripadvisor.com').status === 'refused' && rd.pages.find((p) => p.host === 'reddit.com').kind === 'Forum' && rd.pages.find((p) => p.host === 'lumiarhouse.example').kind === 'A rival\'s own site', 'pages that refuse the reader are marked; kinds of pages are told apart');
  assert(r.probe.engines.find((x) => x.e === 'grok').knows === 'other' && r.probe.engines.find((x) => x.e === 'claude').knows === 'no' && r.probe.check.length === 2, 'asked by name: one engine mixes the business up with another, and two claims need checking');
  assert(r.says.descriptors.includes('family-run') && r.says.basedOn === 15, 'the words the engines use for the business');
  assert(r.fixes[0].id === 'robots' && r.fixes[0].asset.body.includes('User-agent: Claude-SearchBot') && !r.fixes[0].asset.body.includes('ClaudeBot\n'), 'the first fix lets the blocked search crawler in, and leaves the training crawler to the owner');
  const fx2 = Object.fromEntries(r.fixes.map((f) => [f.id, f]));
  assert(fx2.org.asset.body.includes('"@type": "LocalBusiness"') && fx2.org.asset.body.includes('Rua das Flores') && fx2.faq.asset.body.includes('FAQPage') && fx2.llms.asset.body.startsWith('# Casa Aldora') && fx2.listings.steps.length >= 3 && fx2.page.why.includes('"romantic hotels lisbon" (about 480 Google searches a month in the United Kingdom) you are named in 1 of 10') && fx2.page.steps[0].includes('Where should a couple stay') && fx2.page.asset.body.includes('romantic'), 'the fix kit: organization markup, FAQ markup, llms.txt, the pages to get onto and a page for the search with the biggest gap');
  assert(r.fixes.every((f, i) => f.n === i + 1 && f.why && f.minutes > 0) && r.fixes.map((f) => f.impact).join('') === r.fixes.map((f) => f.impact).sort((a, b) => b - a).join(''), 'fixes are numbered, biggest win first');
  assert(calls.emails.length === 1 && calls.emails[0].to === 'owner@casaaldora.example' && calls.emails[0].text.includes('https://app.test/check/' + id), 'the buyer is emailed the link once');
  assert(c.recheck && c.recheck.dueAt > Date.now() + 29 * 86400000 && (await kv.smembers('vr:due')).includes(id), 'a re-check is scheduled for 30 days later');
  const rep = await pub(id);
  assert(rep.stage === 'report' && rep.answers.length === 54 && rep.report.fixes.length === r.fixes.length && rep.email === 'o•••@casaaldora.example', 'the report page gets every answer; the email is masked');
  const repHtml = V.app(rep);
  assert(/AI names Casa Aldora in 15 of 49 answers/.test(repHtml) && /Start here/.test(repHtml) && /Second ask/.test(repHtml) && /you are not on it/.test(repHtml) && /Mixes you up/.test(repHtml) && /Copy the brief for my web person/.test(repHtml), 'the report page renders every section');
  assert(/<span>Searches<\/span>5, made about 1,340 times a month on Google/.test(repHtml) && /Most searched<\/span>/.test(repHtml) && /Biggest gap<\/span>/.test(repHtml) && /Best result<\/span>/.test(repHtml) && /named least on quiet hotel lisbon \(0 of 9\), but fewer people search it/.test(repHtml) && /Searches a month<\/th>/.test(repHtml) && /Searches we weighed and did not ask/.test(repHtml) && rep.others.length === 4, 'the report is laid out by search: where the demand is, the biggest gap, the best result and the searches that were weighed');
  assert(/udm=50&q=romantic%20hotels%20lisbon/.test(repHtml) && /chatgpt\.com\/\?q=Where%20should%20a%20couple/.test(repHtml), 'to ask it yourself, Google gets the search and a chat engine gets the question');
  assert(!/[—–]/.test(repHtml.replace(/<pre[\s\S]*?<\/pre>/g, '')) && !/İ/.test(repHtml), 'no long dashes and no dotted capital I in the page');
  assert(V.brief(rep).includes('1. Let AI search crawlers into robots.txt') && V.brief(rep).includes('User-agent: Claude-SearchBot') && V.brief(rep).includes('Searches checked, with Google searches a month in the United Kingdom:') && V.brief(rep).includes('- romantic hotels lisbon (480): named in 1 of 10 answers'), 'the brief for the web person is plain text with the searches and every fix');

  console.log('\nThe pages and addresses');
  const handler = require('../api/index.js');
  const app = http.createServer((req, res) => { const u = new URL(req.url, 'http://x'); req.query = Object.fromEntries(u.searchParams); req.query.path = u.pathname.replace(/^\//, ''); handler(req, res); });
  const port = await listen(app);
  const land = await request(port, 'GET', '/ai-visibility-report');
  assert(land.status === 200 && /Read what AI tells your customers about you/.test(land.body) && /name="url"/.test(land.body) && /FAQPage/.test(land.body) && /max-age/.test(land.headers['cache-control']), 'the landing page is served, cacheable, with the form and its own FAQ markup');
  const samp = await request(port, 'GET', '/ai-visibility-report/sample');
  assert(samp.status === 200 && /This is a sample/.test(samp.body) && /AI names Casa Aldora/.test(samp.body), 'the sample report is served');
  assert((await request(port, 'POST', '/check/start', { body: { url: 'casaaldora.example' }, headers: { Origin: 'https://evil.example' } })).status === 403, 'a form posted from another site is blocked');
  const viaHttp = await request(port, 'POST', '/check/start', { body: { url: 'casaaldora.example' }, headers: { Origin: 'https://app.test' } });
  assert(viaHttp.status === 200 && core.ID_RE.test(viaHttp.json.id) && viaHttp.json.id !== id, 'a paid report is not handed to the next visitor of the same site: they get a check of their own');
  const id2 = viaHttp.json.id;
  const page = await request(port, 'GET', '/check/' + id2);
  assert(page.status === 200 && /noindex/.test(page.headers['x-robots-tag']) && /script-src 'nonce-/.test(page.headers['content-security-policy']) && page.headers['cache-control'] === 'no-store', 'the page of a check is kept out of search, never cached, and only runs our own scripts');
  assert(!/<\/script><script>alert/.test(page.body) && /window\.__VR=\{/.test(page.body), 'the state is embedded safely');
  const stJson = await request(port, 'GET', '/check/' + id2 + '/state');
  assert(stJson.json.stage === 'draft' && stJson.json.site.brand === 'Casa Aldora' && !('ip' in stJson.json) && !/visitor/.test(stJson.body), 'the state is served as JSON without anything private');
  assert((await request(port, 'GET', '/check/AAAAAAAAAAAAAAAAAAAAAA')).status === 404 && (await request(port, 'GET', '/check/short')).status === 404 && (await request(port, 'GET', '/check/AAAAAAAAAAAAAAAAAAAAAA/state')).status === 404, 'an unknown or malformed id is a plain 404');
  const own = await request(port, 'POST', '/check/' + id2 + '/run', { body: { topic: '', question: 'Which Alfama hotel has the best breakfast?', brand: 'Casa Aldora', country: 'IE' } });
  c = await core.get(id2);
  assert(own.json.ok && c.topics[0].question === 'Which Alfama hotel has the best breakfast?' && c.topics[0].edited && c.topics.length === 5 && c.ask.country === 'IE' && c.freeTopic === 't0', 'a visitor\'s own question takes the first place and is asked from the country they chose');
  assert(c.topics[0].volume === null && c.topics[1].keyword === 'boutique hotel alfama' && c.topics[1].volume === 70 && c.topics.concat(c.others).every((t) => t.looked === 'IE') && calls.volumes[calls.volumes.length - 1].country === 'IE', 'and the search numbers are looked up again for that country');
  for (let i = 0; i < 6; i++) { const p = await request(port, 'POST', '/check/' + id2 + '/pump', { body: {} }); if (p.json.status !== 'running') break; }
  assert((await core.get(id2)).status === 'preview', 'the open page keeps the check moving until the preview');
  const un = await request(port, 'POST', '/check/' + id2 + '/unlock', { body: {} });
  assert(/polar\.test\/checkout/.test(un.json.url) && polarState.checkouts[1].metadata.check_id === id2, 'the unlock button answers with a checkout link for this check');
  assert((await request(port, 'GET', '/check/' + id2 + '?key=wrong-key-wrong-key')).status === 302 && !(await core.get(id2)).paid, 'a wrong key opens nothing');
  const keyed = await request(port, 'GET', '/check/' + id2 + '?key=unlock-key-for-tests');
  assert(keyed.status === 302 && keyed.headers.location === '/check/' + id2 && (await core.get(id2)).paid.by === 'key', 'our own key opens a report without a payment');
  const mail = await request(port, 'POST', '/check/' + id2 + '/email', { body: { email: 'not-an-email' } });
  assert(mail.json.error && (await request(port, 'POST', '/check/' + id2 + '/email', { body: { email: 'Second@Example.com' } })).json.ok && (await core.get(id2)).email === 'second@example.com', 'an email for the link is checked and saved');
  assert((await request(port, 'GET', '/cron/vr')).status === 401, 'the cron address needs its secret');
  const tick = await request(port, 'GET', '/cron/vr', { headers: { 'x-cron-secret': 'cronkey' } });
  assert(tick.status === 200 && tick.json.worked >= 1, 'the cron works on checks nobody has open');
  c = await until(id2, 'done', 60);
  assert(c.status === 'done' && calls.emails.some((e) => e.to === 'second@example.com'), 'the second report finishes and its link is emailed');

  console.log('\nThe re-check');
  assert((await core.startRecheck(id, 'manual')).error, 'the re-check cannot be started in the first 14 days');
  await core.update(id, (x) => { x.doneAt = Date.now() - 15 * 86400000; });
  const open = await pub(id);
  assert(open.recheck.open && !open.recheck.id, 'after 14 days the buyer can start it');
  const asksBefore = calls.ask.length;
  const rc = await core.startRecheck(id, 'manual');
  assert(rc.ok && rc.id !== id && (await core.startRecheck(id, 'manual')).id === rc.id, 'the re-check is a new check that points back, and can only be started once');
  const child = await until(rc.id, 'done', 60);
  assert(child.status === 'done' && child.parent === id && child.compare && child.compare.score[0] === 24 && child.compare.named.join() === '15,15' && child.compare.ladder.length === 5, 'the re-check asks everything again and holds the before and after');
  assert(calls.ask.length - asksBefore === 54 && !child.recheck, 'it asks all 54 questions afresh and schedules no re-check of its own');
  const parent = await pub(id);
  assert(parent.recheck.id === rc.id && /Open the before and after/.test(V.app(parent)) && /Then and now/.test(V.app(await pub(rc.id))), 'the first report links to the re-check, which shows then and now');
  await core.update(id2, (x) => { x.recheck.dueAt = Date.now() - 1000; });
  const t2 = await core.tick({ budgetMs: 40000 });
  assert(t2.started === 1 && (await core.get(id2)).recheck.id, 'a re-check that is due is started by the cron');

  console.log('\nRefunds');
  const refund = JSON.stringify({ type: 'order.refunded', data: { id: 'ord_1', checkout_id: coId, metadata: { check_id: id, sig: pay.sign(id) } } });
  assert((await pay.handleWebhook(refund, sign(refund, 'msg_4'), { verify: billing.polar.verify })).body.refunded, 'a refund is recorded');
  const closed = await pub(id);
  assert(closed.stage === 'closed' && !closed.report && /This report is closed/.test(V.app(closed)), 'a refunded report is closed');

  console.log('\nSearches and their questions');
  const callsK = fx.install();
  const kw1 = await core.start('casaaldora.example', { ip: 'kw1', fresh: true });
  await core.runFree(kw1.id, { topic: 't1', question: 'Where should a couple stay in Lisbon for a romantic weekend with a view?', country: 'GB' });
  c = await core.get(kw1.id);
  assert(c.freeTopic === 't1' && c.topics[1].edited && c.topics[1].keyword === 'romantic hotels lisbon' && c.topics[1].volume === 480 && callsK.volumes.length === 1, 'a reworded question keeps its search and its number, and nothing is looked up again');
  assert(callsK.ask.every((a) => (a.engine === 'aio' ? a.prompt === 'romantic hotels lisbon' : /romantic weekend/.test(a.prompt))), 'Google still gets the search, the chat engines get the question as the visitor put it');
  const kw2 = await core.start('casaaldora.example', { ip: 'kw2', fresh: true });
  await core.runFree(kw2.id, { topic: 't2', question: 'Which hotels in Lisbon have parking for an electric car?', country: 'GB' });
  c = await core.get(kw2.id);
  assert(c.topics[2].keyword === 'hotels lisbon have parking electric car' && c.topics[2].volume === null && c.topics[2].looked === 'GB' && c.topics[0].volume === 590 && /too few searches to measure on Google in the United Kingdom/.test(V.app(await pub(kw2.id))), 'a question about something else becomes a search of its own, and a search too small to measure is called that');
  assert(core.sameSubject({ keyword: 'romantic hotels lisbon', question: fx.TOPICS[1].question }, 'Which Lisbon hotels are romantic?') && !core.sameSubject({ keyword: 'boutique hotel alfama', question: fx.TOPICS[0].question }, 'Where can I rent a car in Lisbon?'), 'sharing the city alone does not make it the same search');
  const kw3 = await core.start('casaaldora.example', { ip: 'kw3', fresh: true });
  const lookups = callsK.volumes.length;
  await core.runFree(kw3.id, { topic: 't0', question: fx.TOPICS[0].question, country: 'IE' });
  c = await core.get(kw3.id);
  assert(callsK.volumes.length === lookups + 1 && callsK.volumes[lookups].country === 'IE' && callsK.volumes[lookups].list.length === 9 && c.topics.map((t) => t.volume).join() === '70,50,10,20,' && c.others[0].volume === null, 'another country gets its own search numbers before the engines are asked');
  fx.install({ kwDown: true });
  const kw4 = await core.start('casaaldora.example', { ip: 'kw4', fresh: true });
  c = await core.get(kw4.id);
  assert(c.topics.map((t) => t.keyword).join('|') === 'boutique hotel alfama|small hotel lisbon old town|hotels near santa apolonia station|romantic hotels lisbon|quiet hotel lisbon' && c.topics.every((t) => t.volume === null && t.looked === ''), 'without the keyword data the searches keep the order they were found in');
  const plain = V.app(await pub(kw4.id));
  assert(/The search to check/.test(plain) && !/class="vol/.test(plain) && !/Google searches a month/.test(plain) && !/Left out/.test(plain), 'and the page shows them without numbers instead of guessing');
  const callsL = fx.install();
  await core.runFree(kw4.id, { topic: 't0', question: fx.TOPICS[0].question, country: 'GB' });
  c = await core.get(kw4.id);
  assert(callsL.volumes.length === 1 && c.topics[0].volume === 590 && c.topics[1].volume === 50 && c.topics.every((t) => t.looked === 'GB'), 'numbers that were missing are looked up when the check starts');
  process.env.VR_LOOKUPS_PER_DAY = '1';
  const capped = await core.searchVolumes(['boutique hotel alfama'], 'GB', 'en');
  delete process.env.VR_LOOKUPS_PER_DAY;
  assert(capped.known === false && callsL.volumes.length === 1, 'past the day\'s cap no lookup is paid for, and the check goes on without numbers');

  console.log('\nWhen things go wrong');
  const shell = await core.get(other.id);
  assert(shell.site.words < 120 && shell.site.appShell && core.findingsOf(shell.site)[0].code === 'empty_html' && shell.topics.length === 0, 'a page drawn by JavaScript reads as empty, which is the first finding');
  assert((await core.runFree(other.id, { question: 'short' })).code === 'question' && (await core.runFree(other.id, { question: 'See https://x.example for the best hotel' })).code === 'question', 'a check with no question, or a question with a link, is not started');
  assert((await core.start('nowhere.example', { ip: 'visitor4' })).code === 'unreachable', 'a website that does not exist is said so');
  const blocked = await core.start('blocked.example', { ip: 'visitor4' });
  c = await core.get(blocked.id);
  assert(blocked.id && !c.site.read.ok && c.site.read.status === 403 && core.findingsOf(c.site)[0].code === 'blocked' && /We could not read/.test(V.app(await pub(blocked.id))), 'a site that refuses our reader still gets a check, and the refusal is the first finding');
  for (let i = 0; i < 6; i++) await core.start('nowhere.example', { ip: 'greedy' });
  assert((await core.start('casaaldora.example', { ip: 'greedy', fresh: true })).code === 'limit', 'free checks are limited per visitor and day');
  // one engine fails, the writing model is down
  const calls2 = fx.install({ failEngine: 'gemini', llmDown: true });
  const rough = await core.start('casaaldora.example', { ip: 'visitor5', fresh: true });
  c = await core.get(rough.id);
  assert(c.project.brand === 'Casa Aldora' && c.topics.length === 0 && !c.profile.byAi, 'without the writing model the name comes from the page itself and the visitor writes the question');
  await core.runFree(rough.id, { question: fx.TOPICS[0].question });
  c = await until(rough.id, 'preview');
  const rs = (await pub(rough.id)).slots;
  assert(c.status === 'preview' && rs.find((s) => s.e === 'gemini').state === 'failed' && rs.find((s) => s.e === 'openai').state === 'both', 'an engine that fails is shown as not answered and the others still count');
  assert(rs.find((s) => s.e === 'openai').named.some((n) => n.name === 'The Lumiar House') && rs.find((s) => s.e === 'openai').rank === 2, 'without the writing model the other businesses are read from the shape of the answer');
  await core.markPaid(rough.id, { by: 'key' });
  c = await until(rough.id, 'done', 60);
  assert(c.status === 'done' && c.report.fixes.some((f) => f.id === 'robots') && c.report.fixes.some((f) => f.id === 'org' && !f.ai) && c.report.probe && c.report.probe.judged === false, 'the report is still built: rule-based fixes, no AI drafts, and the by-name check read without a judge');
  assert(/AI names Casa Aldora/.test(V.app(await pub(rough.id))), 'and it still renders');
  assert(calls2.emails.length === 0, 'no email is sent when no address was given');

  console.log('\nCounting the funnel');
  const days = (await request(port, 'GET', '/cron/vrstats', { headers: { 'x-cron-secret': 'cronkey' } })).json.days;
  const today = days[0] || {};
  assert(days.length === 1 && today.start >= 5 && today.asked >= 3 && today.preview >= 3 && today.checkout === 1 && today.paid === 1 && today.opened_by_key >= 1 && today.report_built >= 2 && today.recheck_built >= 1 && today.again === 1, 'each step of the funnel is counted per day, with numbers only');
  assert((await request(port, 'GET', '/cron/vrstats')).status === 401, 'the numbers need the cron secret');

  console.log('\nThe plans are untouched');
  const none = JSON.stringify({ type: 'subscription.active', data: { id: 'sub_x', product: { name: 'Something else' } } });
  assert((await billing.handleWebhook(none, sign(none, 'msg_5'), { getUser: async () => null, saveUser: async () => null })).status === 202, 'subscription webhooks still go to the plans');
  assert(engines.freeEngines().join() === 'openai,aio,gemini', 'the free engines are the same as in the app');

  app.close(); polar.close(); redis.server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
