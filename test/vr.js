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
  const realAdsVolumes = require('../api/_lib/keywords.js').adsVolumes; // the stand-ins replace it below
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
  assert(rd.opened === 8 && rd.you === 2 && rd.theirs === 1 && rd.top.name === 'The Lumiar House' && rd.top.n === 6, 'the pages the engines read were opened: the business is on 2 of 8, and a rival is not counted on its own website');
  const lw = rd.pages.find((p) => p.host === 'lisbonweekender.example');
  assert(lw.status === 'read' && lw.you === false && lw.rivals.length === 4 && rd.pages.filter((p) => p.host === 'lisbonweekender.example').length === 1, 'a page cited by address and by site name is one row, read for the business and its rivals');
  assert(rd.pages.find((p) => p.host === 'tripadvisor.com').status === 'refused' && rd.pages.find((p) => p.host === 'reddit.com').kind === 'Forum' && rd.pages.find((p) => p.host === 'lumiarhouse.example').kind === 'A rival\'s own site', 'pages that refuse the reader are marked; kinds of pages are told apart');
  const lumiar = rd.pages.find((p) => p.host === 'lumiarhouse.example'), journal = rd.pages.find((p) => p.host === 'citybreakjournal.example');
  assert(lumiar.theirs === true && journal.kind === 'Article or guide' && journal.theirs === false && rd.pages.filter((p) => p.theirs).length === 1 && calls.llm.some((x) => /^You sort web pages/.test(x)), 'a rival\'s own website is set apart, and the pages no list knows are sorted from address and title');
  assert(r.probe.engines.find((x) => x.e === 'grok').knows === 'other' && r.probe.engines.find((x) => x.e === 'claude').knows === 'no' && r.probe.check.length === 2, 'asked by name: one engine mixes the business up with another, and two claims need checking');
  assert(r.says.descriptors.includes('family-run') && r.says.basedOn === 15, 'the words the engines use for the business');
  assert(r.fixes[0].id === 'robots' && r.fixes[0].asset.body.includes('User-agent: Claude-SearchBot') && !r.fixes[0].asset.body.includes('ClaudeBot\n'), 'the first fix lets the blocked search crawler in, and leaves the training crawler to the owner');
  const fx2 = Object.fromEntries(r.fixes.map((f) => [f.id, f]));
  assert(fx2.org.asset.body.includes('"@type": "LocalBusiness"') && fx2.org.asset.body.includes('Rua das Flores') && fx2.faq.asset.body.includes('FAQPage') && fx2.llms.asset.body.startsWith('# Casa Aldora') && fx2.listings.steps.length >= 3 && fx2.page.why.includes('"romantic hotels lisbon" (about 480 Google searches a month in the United Kingdom) you are named in 1 of 10') && fx2.page.steps[0].includes('Where should a couple stay') && fx2.page.asset.body.includes('romantic'), 'the fix kit: organization markup, FAQ markup, llms.txt, the pages to get onto and a page for the search with the biggest gap');
  assert(fx2.listings.why.includes('Of the 8 we could open, one is another business\'s own website. On the other 7 you are named on 2. The Lumiar House is on 6.') && !fx2.listings.steps.join(' ').includes('lumiarhouse') && fx2.listings.steps.length === 4 && fx2.listings.steps.every((x) => /ask the editor to add you\.$/.test(x)), 'the pages to get onto leave out a rival\'s own website');
  assert(fx2.page.title === 'Publish a page for the search you are missing' && fx2.page.why.includes('None of the 3 pages we read on your site is about it') && !/No page on your site/.test(JSON.stringify(r.fixes)), 'the page fix says what was read, not what was not');
  assert(r.fixes.every((f, i) => f.n === i + 1 && f.why && f.minutes > 0) && r.fixes.map((f) => f.impact).join('') === r.fixes.map((f) => f.impact).sort((a, b) => b - a).join(''), 'fixes are numbered, biggest win first');
  assert(calls.emails.length === 1 && calls.emails[0].to === 'owner@casaaldora.example' && calls.emails[0].text.includes('https://silitlabs.com/check/' + id) && !/app\.test|aiseodeck/.test(calls.emails[0].text + calls.emails[0].html), 'the buyer is emailed the link once, at the site\'s address');
  const mailer = require('../api/_lib/email');
  assert(calls.emails[0].as === 'AI Visibility Report' && mailer.sender('AI Visibility Report') === 'AI Visibility Report <hello@silitlabs.com>' && mailer.sender() === 'AI SEO Deck <hello@silitlabs.com>' && mailer.sender('Evil <x@y.z>') === 'Evil x@y.z <hello@silitlabs.com>', 'the email is signed by the report, from the same address; the app\'s own emails keep their name');
  assert(c.recheck && c.recheck.dueAt > Date.now() + 29 * 86400000 && (await kv.smembers('vr:due')).includes(id), 'a re-check is scheduled for 30 days later');
  const rep = await pub(id);
  assert(rep.stage === 'report' && rep.answers.length === 54 && rep.report.fixes.length === r.fixes.length && rep.email === 'o•••@casaaldora.example', 'the report page gets every answer; the email is masked');
  const repHtml = V.app(rep);
  assert(/AI names Casa Aldora in 15 of 49 answers/.test(repHtml) && /Start here/.test(repHtml) && /Second ask/.test(repHtml) && /you are not on it/.test(repHtml) && /Mixes you up/.test(repHtml) && /Copy the brief for my web person/.test(repHtml), 'the report page renders every section');
  assert(/We could open 8 of these 10 pages\. One is the own website of another business, where nobody else is listed\. On the other 7 you are named on 2\. The Lumiar House is on 6\./.test(repHtml.replace(/<[^>]+>/g, '')) && /their own website/.test(repHtml) && /From the 15 answers that name you: 14 positive, 1 neutral, 0 negative\./.test(repHtml), 'the pages section counts a rival\'s own website apart, and the tone of the answers is given');
  const mute = JSON.parse(JSON.stringify(rep)); mute.report.says.sentiment = { positive: 0, neutral: 0, negative: 0 }; delete mute.report.reading.theirs; for (const p of mute.report.reading.pages) delete p.theirs;
  const muteHtml = V.app(mute);
  assert(!/positive, \d+ neutral/.test(muteHtml) && /The words AI uses for you/.test(muteHtml) && /We could open 8 of these 10 pages\. You are on 2\./.test(muteHtml.replace(/<[^>]+>/g, '')), 'a tone that could not be read is left out, and a report built before today still renders');
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
  assert(/<link rel="canonical" href="https:\/\/silitlabs\.com\/ai-visibility-report">/.test(land.body) && /<link rel="canonical" href="https:\/\/silitlabs\.com\/ai-visibility-report\/sample">/.test(samp.body) && /og:image" content="https:\/\/silitlabs\.com\/images\/og\/ai-visibility-report\.jpg"/.test(land.body) && /"url":"https:\/\/silitlabs\.com\/ai-visibility-report"/.test(land.body) && /"@id":"https:\/\/silitlabs\.com\/#org"/.test(land.body), 'the pages say they live at silitlabs.com: canonical, share picture and structured data');
  const links = [...new Set([...land.body.replace(/<script[\s\S]*?<\/script>/g, '').matchAll(/<a [^>]*href="([^"#][^"]*)"/g)].map((m) => m[1]))];
  assert(links.includes('https://silitlabs.com/') && links.includes('https://silitlabs.com/guides/') && links.includes('https://silitlabs.com/terms/') && links.includes('https://silitlabs.com/privacy/') && links.includes('https://app.test/') && links.includes('/ai-visibility-report/sample') && links.filter((l) => l.startsWith('/')).every((l) => l.startsWith('/ai-visibility-report')), 'links to the site and to AI SEO Deck are written in full; only the report\'s own addresses are relative');
  assert(/<div class="brand"><a href="https:\/\/silitlabs\.com\/"[^>]*><svg[\s\S]*?<\/svg>Silit Labs<\/a><small><a href="\/ai-visibility-report">AI Visibility Report<\/a><\/small><\/div>/.test(land.body) && !/AI SEO Deck<small>/.test(land.body), 'the top bar carries the site\'s name and the product\'s name');
  assert((await request(port, 'POST', '/check/start', { body: { url: 'casaaldora.example' }, headers: { Origin: 'https://evil.example' } })).status === 403 && (await request(port, 'POST', '/check/start', { body: { url: 'casaaldora.example' }, headers: { Origin: 'https://silitlabs.com.evil.example' } })).status === 403, 'a form posted from another site is blocked');
  const fromSite = await request(port, 'POST', '/check/start', { body: { url: 'not a website' }, headers: { Origin: 'https://silitlabs.com' } });
  const fromWww = await request(port, 'POST', '/check/start', { body: { url: 'not a website' }, headers: { Origin: 'https://www.silitlabs.com' } });
  assert(fromSite.status === 200 && fromSite.json.error && fromWww.status === 200 && fromWww.json.error, 'a form posted from silitlabs.com, where the pages are read, is let in');
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
  assert(polarState.checkouts[1].success_url === 'https://silitlabs.com/check/' + id2 + '?checkout_id={CHECKOUT_ID}' && polarState.checkouts[1].return_url === 'https://silitlabs.com/check/' + id2, 'the buyer comes back from the checkout to the site\'s address');
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

  console.log('\nNames, spellings and Google\'s own cards');
  const same = (a, b) => core.sameBusiness(core.nameWords(a), core.nameWords(b));
  assert(same('Drakes', 'Drakes of Brighton') && same('Drakes Hotel', 'Drakes') && same('Hotel du Vin', 'The Hotel du Vin Brighton') && !same('Grand', 'Grand Central') && !same('Hotel Una', 'Hotel Pelirocco') && !same('Hilton', 'Hilton Garden Inn Brighton City'), 'a shorter name that starts a longer one is the same business; one short word is not enough');
  assert(core.bareName('Drakes Hotel | A Curious Group of Hotels') === 'Drakes Hotel' && core.bareName('Hotel du Vin - Brighton') === 'Hotel du Vin' && core.bareName('A1 | Taxis') === 'A1 | Taxis' && core.bareName('Travessa Nove Suites') === 'Travessa Nove Suites', 'a tagline after a bar or a dash is cut from a name');
  const spelt = (e, names) => ({ ok: true, k: 't0', q: '0', e, named: names.map((name) => ({ name, kind: 'business' })) });
  const reg = core.registry([spelt('openai', ['Hotel Pelirocco', 'Drakes']), spelt('aio', ['Drakes Hotel', 'Hotel du Vin Brighton']), spelt('gemini', ['Hotel Pelirocco', 'Drakes of Brighton'])], 'business');
  assert(reg.length === 3 && reg[0].n === 3 && /^Drakes/.test(reg[0].name) && reg[1].name === 'Hotel Pelirocco' && reg[1].n === 2, 'three spellings of one hotel in three answers count as one rival named three times');
  c = await core.get(id2);
  const cardRow = core.readAnswer(c, { id: 't1.k', k: 't1', q: 'k', text: 'boutique hotel alfama' }, 'aio', { text: 'Casa Aldora and The Lumiar House are small hotels in Alfama.', ms: 900, model: 'mock', sources: [{ url: 'https://lisbonweekender.example/alfama', title: 'Alfama hotels', host: 'lisbonweekender.example' }, { url: 'https://www.google.com/searchviewer/10?x=1', title: 'Casa Aldora', host: 'google.com' }, { url: 'https://www.google.com/searchviewer/10?x=2', title: 'The Lumiar House', host: 'google.com' }], consulted: [] });
  assert(cardRow.card === true && cardRow.sources.length === 1 && cardRow.sources[0].host === 'lisbonweekender.example', 'a business card Google shows with its answer is not counted as a page, and the business\'s own card is noticed');
  assert(V.notesFor({ state: 'named', topic: 't1', you: true, rank: 1, of: 2, card: true, pages: 1, named: [{ name: 'Casa Aldora', kind: 'business', you: true }, { name: 'The Lumiar House', kind: 'business' }] }, {}).some((n) => /your own business card/.test(n.text)), 'and the margin says so');
  const shell2 = await core.start('appshell.example', { ip: 'visitor3b' });
  assert(shell2.id && shell2.id !== other.id && !shell2.cached, 'a draft whose searches could not be worked out is not handed to the next visitor');

  console.log('\nWhat the first paid report taught');
  // (a) a name providers only use or belong to is not someone named in the business's place
  c = await core.get(id2);
  const mixed = 'Casa Aldora and The Lumiar House both have Hästens beds. Hotel Marquês Azul is recommended by Turismo de Lisboa. Compare prices on Booking.com.';
  const got = await core.extractNamed(c, { text: 'Which small hotels in Lisbon are comfortable?' }, mixed, 12000);
  assert(got.map((x) => x.name + ':' + x.kind).join('|') === 'Casa Aldora:business|The Lumiar House:business|Hotel Marquês Azul:business|Booking.com:directory|Hotel That Is Not There:business', 'a bed maker and a tourist board in an answer about hotels are left out; rivals and listing sites stay');
  const lastNames = callsL.llm.length;
  const placed = core.placeNamed(c, { text: mixed, mentioned: true, idx: 0 }, got);
  assert(placed.of === 3 && placed.rank === 1 && placed.named.length === 4 && !JSON.stringify(placed.named).includes('Hästens') && callsL.llm.length === lastNames, 'so the business is first of three, not of five');
  // (b) pages: a listing site the answers named, and the kinds a model tells from address and title
  assert(core.hostKind('hotelfinder.example', [], ['hotelfinder', 'lisbonstays']) === core.KIND.listing && core.hostKind('www.lisbonstays.co.uk', ['lumiarhouse'], ['hotelfinder', 'lisbonstays']) === core.KIND.listing && core.hostKind('lumiarhouse.example', ['thelumiarhouse'], ['hotelfinder']) === core.KIND.rival && core.hostKind('grandhotelbelem.example', ['thelumiarhouse'], ['hotelfinder']) === core.KIND.article && core.hostKind('tripadvisor.co.uk', [], []) === 'Listing or review site', 'a site the answers called a listing site is one; an unknown site starts as an article');
  const sorted = [{ host: 'grandhotelbelem.example', title: 'Grand Hotel Belém | Official site', kind: core.KIND.article }, { host: 'hastens.example', title: 'Hästens beds', kind: core.KIND.article }, { host: 'turismolisboa.example', title: 'Visit Lisboa', kind: core.KIND.article }, { host: 'lisbonforum.example', title: 'Where to stay?', kind: core.KIND.article }, { host: 'unknown.example', title: '', kind: core.KIND.article }, { host: 'reddit.com', title: 'r/lisboa', kind: 'Forum' }];
  await core.sortPages(c, sorted, 9000);
  assert(sorted.map((x) => x.kind).join('|') === 'A rival\'s own site|A supplier\'s site|Official body|Forum|Article or guide|Forum', 'another provider, a supplier, an official body and a forum are told apart; what the model does not know stays an article');
  const untouched = [{ host: 'grandhotelbelem.example', title: '', kind: core.KIND.article }];
  await core.sortPages(c, untouched, 1000);
  assert(untouched[0].kind === core.KIND.article, 'with no time left the pages are not sorted, and the step goes on');
  const pg = (host, kind, extra) => Object.assign({ url: 'https://' + host + '/x', host, title: host, n: 3, cited: 1, engines: ['openai'], kind, status: 'read', you: false, rivals: [], theirs: kind === core.KIND.rival || kind === core.KIND.supplier }, extra || {});
  const mixedPages = [pg('hotelfinderlisbon.example', core.KIND.listing, { rivals: ['The Lumiar House'] }), pg('turismolisboa.example', core.KIND.official), pg('lisbonforum.example', core.KIND.forum), pg('grandhotelbelem.example', core.KIND.rival), pg('hastens.example', core.KIND.supplier), pg('youtube.com', 'Social network'), pg('wikipedia.org', 'Encyclopedia'), pg('alfamaguide.example', core.KIND.article, { you: true })];
  const byKind = core.fixesOf(await core.get(id), await core.rowsOf(id), { reading: { pages: mixedPages, opened: 8, theirs: 2, you: 1, top: { name: 'The Lumiar House', n: 1 } }, audit: (await core.get(id)).work.audit, assets: {}, probe: r.probe, t: core.tally(await core.rowsOf(id)) }).find((f) => f.id === 'listings');
  assert(byKind.steps.join('\n') === 'hotelfinderlisbon.example names The Lumiar House, not you: claim or create your listing.' && byKind.why.includes('Of the 8 we could open, two are other businesses\' own websites. On the other 6 you are named on 1.'), 'when one page names a rival, that is the one to start with');
  const noRivals = core.fixesOf(await core.get(id), await core.rowsOf(id), { reading: { pages: mixedPages.map((x) => Object.assign({}, x, { rivals: [] })), opened: 8, theirs: 2, you: 1, top: null }, audit: (await core.get(id)).work.audit, assets: {}, probe: r.probe, t: core.tally(await core.rowsOf(id)) }).find((f) => f.id === 'listings');
  assert(noRivals.steps.join('\n') === 'hotelfinderlisbon.example does not mention you: claim or create your listing.\nturismolisboa.example does not mention you: see whether its register or member list can include you.\nlisbonforum.example does not mention you: answer the thread honestly, as the business.' && !/grandhotel|hastens|youtube|wikipedia/.test(JSON.stringify(noRivals.steps) + JSON.stringify(noRivals.links)), 'a listing site, an official body and a forum each get their own step; another business, a supplier, a social network and an encyclopedia get none');
  const onlyTheirs = core.fixesOf(await core.get(id), await core.rowsOf(id), { reading: { pages: [pg('grandhotelbelem.example', core.KIND.rival), pg('youtube.com', 'Social network')], opened: 2, theirs: 1, you: 0, top: null }, audit: (await core.get(id)).work.audit, assets: {}, probe: r.probe, t: core.tally(await core.rowsOf(id)) }).find((f) => f.id === 'listings');
  assert(!onlyTheirs, 'when nothing can be done about the pages that were read, the fix is not offered');
  // (c) the page fix looks at the pages we read on the site before it says one is missing
  const rowsDone = await core.rowsOf(id);
  const doneCheck = await core.get(id);
  const ctx = (pages) => ({ reading: r.reading, audit: Object.assign({}, doneCheck.work.audit, { pages }), assets: { page: { title: 'T', slug: 's', intro: 'Intro text.', faq: [{ q: 'Q?', a: 'A.' }] } }, probe: r.probe, t: core.tally(rowsDone) });
  const hasPage = core.fixesOf(doneCheck, rowsDone, ctx([{ path: '/', ok: true, title: 'Casa Aldora | Boutique hotel in Alfama', h1: ['A quiet house'], description: '' }, { path: '/romantic-hotel-lisbon', ok: true, title: 'A romantic hotel in Lisbon with a view', h1: ['Romantic stays'], description: '' }])).find((f) => f.id === 'page');
  assert(hasPage.title === 'Make your page for this search the one AI quotes' && hasPage.why.includes('Your page /romantic-hotel-lisbon is already about this search, so a new page is not what is missing.') && hasPage.steps.length === 3 && hasPage.asset.label === 'Section draft' && hasPage.asset.body === 'Intro text.\n\nQ?\nA.' && hasPage.minutes === 45, 'when the site already has a page for the search, the fix is to sharpen it, not to publish another');
  const homeIsIt = core.fixesOf(doneCheck, rowsDone, ctx([{ path: '/', ok: true, title: 'Romantic hotels in Lisbon | Casa Aldora', h1: [], description: '' }])).find((f) => f.id === 'page');
  const noAudit = core.fixesOf(doneCheck, rowsDone, Object.assign(ctx([]), { audit: null })).find((f) => f.id === 'page');
  const weakDesc = core.fixesOf(doneCheck, rowsDone, ctx([{ path: '/', ok: true, title: 'Casa Aldora', h1: [], description: 'Romantic hotels in Lisbon for couples.' }, { path: '/gone', ok: false, title: 'Romantic hotels Lisbon', h1: [], description: '' }])).find((f) => f.id === 'page');
  assert(homeIsIt.why.includes('Your home page is already about this search') && noAudit.title === 'Publish a page for the search you are missing' && noAudit.why.endsWith('A page that answers it in your own words gives engines something of yours to lift.') && weakDesc.title === 'Publish a page for the search you are missing', 'the home page can be that page; a mention in a description, a page that did not open or no pages read do not count as one');
  // (d) searches the first lookup has no number for are asked of Google Ads once, when a check starts
  const callsA = fx.install({ ads: { 'alfama hotel near fado houses': 320, 'boutique hotel alfama': 9999 } });
  const two = await core.searchVolumes(['boutique hotel alfama', 'Alfama hotel near Fado houses', 'lisbon hotel with a butler'], 'GB', 'en', 5000, () => 8000);
  assert(two.known && two.map['boutique hotel alfama'] === 590 && two.map['alfama hotel near fado houses'] === 320 && !('lisbon hotel with a butler' in two.map) && two.asked === 2 && two.filled === 1 && callsA.ads.length === 1 && callsA.ads[0].list.join('|') === 'alfama hotel near fado houses|lisbon hotel with a butler' && callsA.ads[0].country === 'GB' && callsA.ads[0].timeoutMs === 8000, 'only the searches without a number are asked of Google Ads, and a number the first lookup gave is kept');
  const picked = core.pickTopics(fx.SEARCHES, two.map, 5);
  assert((await core.searchVolumes(['boutique hotel alfama', 'alfama hotel near fado houses'], 'GB', 'en', 5000)).asked === 0 && (await core.searchVolumes(['alfama hotel near fado houses'], 'GB', 'en', 5000, 2000)).asked === 0 && callsA.ads.length === 1 && picked.length >= 1, 'it is not asked without leave, nor when there is no time left for it');
  const kwA = await core.start('casaaldora.example', { ip: 'kwA', fresh: true });
  c = await core.get(kwA.id);
  assert(callsA.ads.length === 2 && callsA.ads[1].list.join() === 'alfama hotel near fado houses' && c.topics.map((t) => t.keyword + ' ' + t.volume).join('|') === 'boutique hotel alfama 590|romantic hotels lisbon 480|alfama hotel near fado houses 320|quiet hotel lisbon 110|hotels near santa apolonia station 90' && c.others[0].keyword === 'lisbon hotel with roof terrace' && c.others[0].volume === 70, 'a check that starts gets the missing number, and the search it belongs to takes its place among the five');
  const adsDay = 'vrads:' + new Date().toISOString().slice(0, 10);
  assert(parseInt(await kv.command('GET', adsDay), 10) >= 2, 'each of these lookups is counted for the day');
  await kv.del(adsDay);
  process.env.VR_ADS_LOOKUPS_PER_DAY = '1';
  await core.searchVolumes(['alfama hotel near fado houses'], 'GB', 'en', 5000, 8000);
  const pastCap = await core.searchVolumes(['alfama hotel near fado houses'], 'GB', 'en', 5000, 8000);
  assert(callsA.ads.length === 3 && pastCap.known && pastCap.asked === 0 && !('alfama hotel near fado houses' in pastCap.map), 'the second lookup has a daily cap of its own; past it the first numbers stand');
  process.env.VR_ADS_LOOKUPS_PER_DAY = '0';
  assert((await core.searchVolumes(['alfama hotel near fado houses'], 'GB', 'en', 5000, 8000)).asked === 0 && callsA.ads.length === 3, 'and it can be turned off');
  delete process.env.VR_ADS_LOOKUPS_PER_DAY;
  await kv.del(adsDay);
  const callsD = fx.install({ ads: 'down' });
  const down = await core.searchVolumes(['boutique hotel alfama', 'alfama hotel near fado houses'], 'GB', 'en', 5000, 8000);
  assert(down.known && down.map['boutique hotel alfama'] === 590 && down.asked === 1 && down.filled === 0 && callsD.ads.length === 1, 'when Google Ads does not answer, the numbers already found are used');
  fx.install();
  // the request itself, against a stand-in for DataForSEO that answers the way its documentation says
  const adsSeen = [];
  const adsApi = http.createServer((req, res) => {
    const ch = [];
    req.on('data', (x) => ch.push(x));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(ch).toString() || '[]');
      adsSeen.push({ path: req.url, method: req.method, auth: req.headers.authorization, body });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (body[0].keywords.includes('rate limited')) return res.end(JSON.stringify({ status_code: 20000, tasks: [{ status_code: 40202, status_message: 'Rate limit per minute exceeded.', result: null }] }));
      res.end(JSON.stringify({ status_code: 20000, tasks: [{ status_code: 20000, status_message: 'Ok.', cost: 0.09, result: [
        { keyword: 'Alfama Hotel near fado houses', spell: null, location_code: 2826, language_code: 'en', search_volume: 320, competition: 'LOW', monthly_searches: [] },
        { keyword: 'lisbon hotel with a butler', location_code: null, language_code: null, search_volume: null, competition: null, monthly_searches: null }
      ] }] }));
    });
  });
  const adsPort = await listen(adsApi);
  process.env.DATAFORSEO_API_BASE = 'http://127.0.0.1:' + adsPort;
  const fromAds = await realAdsVolumes(['Alfama hotel near Fado houses', 'lisbon hotel with a butler', 'what is a boutique hotel?', 'lisbon hotel with a butler'], 'GB', 'en', 4000);
  assert(JSON.stringify(fromAds) === '{"alfama hotel near fado houses":{"volume":320}}' && adsSeen.length === 1 && adsSeen[0].path === '/v3/keywords_data/google_ads/search_volume/live' && adsSeen[0].method === 'POST' && /^Basic /.test(adsSeen[0].auth) && adsSeen[0].body.length === 1 && adsSeen[0].body[0].keywords.join('|') === 'alfama hotel near fado houses|lisbon hotel with a butler|what is a boutique hotel' && adsSeen[0].body[0].location_code === 2826 && adsSeen[0].body[0].language_code === 'en', 'Google Ads is asked in one request for the country, and only searches it has a number for come back');
  let adsError = '';
  try { await realAdsVolumes(['rate limited'], 'GB', 'en', 4000); } catch (e) { adsError = e.message; }
  assert(/Rate limit/.test(adsError) && JSON.stringify(await realAdsVolumes(['a/b testing tool', '  '], 'GB', 'en', 4000)) === '{}' && adsSeen.length === 2, 'a refusal is an error for the caller to catch, and a search Google Ads would turn down is never sent');
  adsApi.close();
  delete process.env.DATAFORSEO_API_BASE;

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

  console.log('\nWhere the report is served');
  const fs = require('fs');
  const root = require('path').join(__dirname, '..');
  const vercel = JSON.parse(fs.readFileSync(root + '/vercel.json', 'utf8'));
  const to = (src) => (vercel.redirects.find((r) => r.source === src) || {}).destination;
  assert(to('/ai-visibility-report') === 'https://silitlabs.com/ai-visibility-report' && to('/ai-visibility-report/:rest*') === 'https://silitlabs.com/ai-visibility-report/:rest*' && to('/check/:rest*') === 'https://silitlabs.com/check/:rest*' && to('/check') === 'https://silitlabs.com/ai-visibility-report' && vercel.redirects.every((r) => r.permanent), 'this app\'s own addresses for the report lead to silitlabs.com for good');
  const served = vercel.rewrites.filter((r) => /ai-visibility-report|check/.test(r.source));
  assert(served.length === 3 && served.every((r) => r.source.startsWith('/_vr/') && r.destination === '/api/index?path=' + r.source.slice(5)) && vercel.crons.some((c) => c.path === '/cron/vr'), 'the site\'s proxy is answered under /_vr, and the cron stays where it was');
  const where = require('../api/_lib/vr/where');
  assert(where.site() === 'https://silitlabs.com' && where.home() === 'https://silitlabs.com/ai-visibility-report' && where.app() === 'https://app.test' && where.fromSite({ headers: { referer: 'https://silitlabs.com/check/abc' } }) && !where.fromSite({ headers: {} }) && !where.fromSite({ headers: { origin: 'https://notsilitlabs.com' } }), 'the report knows its own address from the app\'s');
  process.env.VR_URL = 'https://staging.example/';
  assert(where.home() === 'https://staging.example/ai-visibility-report' && where.fromSite({ headers: { origin: 'https://staging.example' } }) && !where.fromSite({ headers: { origin: 'https://silitlabs.com' } }), 'VR_URL moves it');
  delete process.env.VR_URL;
  const ownSite = ['index.html', 'llms.txt', 'sitemap.xml', 'terms.html', 'privacy.html', 'docs.html', 'robots.txt'].map((f) => fs.readFileSync(root + '/public/' + f, 'utf8')).join('\n');
  assert(!/ai-visibility-report|AI Visibility Report/i.test(ownSite), 'the website of AI SEO Deck itself does not mention the report');

  console.log('\nThe plans are untouched');
  const none = JSON.stringify({ type: 'subscription.active', data: { id: 'sub_x', product: { name: 'Something else' } } });
  assert((await billing.handleWebhook(none, sign(none, 'msg_5'), { getUser: async () => null, saveUser: async () => null })).status === 202, 'subscription webhooks still go to the plans');
  assert(engines.freeEngines().join() === 'openai,aio,gemini', 'the free engines are the same as in the app');

  app.close(); polar.close(); redis.server.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
