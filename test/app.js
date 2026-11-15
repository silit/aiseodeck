// End-to-end test: mock Webflow, mock Upstash Redis, mock AI engines (OpenAI, Perplexity, Gemini),
// mock Resend, mock Polar and a mock customer website. Run: node test/app.js
const http = require('http');
const crypto = require('crypto');

let passed = 0, failed = 0;
function assert(c, m) { if (c) { passed++; console.log('  ok   ' + m); } else { failed++; console.log('  FAIL ' + m); } }
function listen(server) { return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port))); }
function readRaw(req) { return new Promise((resolve) => { const ch = []; req.on('data', (c) => ch.push(c)); req.on('end', () => resolve(Buffer.concat(ch).toString())); }); }
async function readJSON(req) { const raw = await readRaw(req); try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; } }
function json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); }

/* ---- mock Redis (Upstash REST subset) ---- */
const db = new Map();
const ttl = new Map();
function alive(k) { if (ttl.has(k) && ttl.get(k) < Date.now()) { db.delete(k); ttl.delete(k); } return db.has(k); }
function exec(cmd) {
  const [c, ...a] = cmd;
  switch (c.toUpperCase()) {
    case 'GET': return alive(a[0]) ? db.get(a[0]) : null;
    case 'GETDEL': { const v = alive(a[0]) ? db.get(a[0]) : null; db.delete(a[0]); ttl.delete(a[0]); return v; }
    case 'MGET': return a.map((k) => (alive(k) ? db.get(k) : null));
    case 'SET': {
      const nx = a.includes('NX'); const xx = a.includes('XX'); const exI = a.indexOf('EX');
      if (nx && alive(a[0])) return null;
      if (xx && !alive(a[0])) return null;
      db.set(a[0], a[1]);
      if (exI > -1) ttl.set(a[0], Date.now() + parseInt(a[exI + 1], 10) * 1000); else ttl.delete(a[0]);
      return 'OK';
    }
    case 'DEL': { let n = 0; for (const k of a) { if (db.delete(k)) n++; ttl.delete(k); } return n; }
    case 'SADD': { const s = alive(a[0]) ? db.get(a[0]) : new Set(); let n = 0; for (const m of a.slice(1)) if (!s.has(m)) { s.add(m); n++; } db.set(a[0], s); return n; }
    case 'SREM': { const s = alive(a[0]) ? db.get(a[0]) : new Set(); let n = 0; for (const m of a.slice(1)) if (s.delete(m)) n++; db.set(a[0], s); return n; }
    case 'SMEMBERS': return alive(a[0]) ? [...db.get(a[0])] : [];
    case 'SCARD': return alive(a[0]) ? db.get(a[0]).size : 0;
    case 'LPUSH': { const l = alive(a[0]) ? db.get(a[0]) : []; l.unshift(...a.slice(1).reverse()); db.set(a[0], l); return l.length; }
    case 'RPUSH': { const l = alive(a[0]) ? db.get(a[0]) : []; l.push(...a.slice(1)); db.set(a[0], l); return l.length; }
    case 'LPOP': {
      if (!alive(a[0])) return null;
      const l = db.get(a[0]);
      if (a[1] === undefined) { const v = l.shift(); if (!l.length) db.delete(a[0]); return v === undefined ? null : v; }
      const out = l.splice(0, parseInt(a[1], 10));
      if (!l.length) db.delete(a[0]);
      return out.length ? out : null;
    }
    case 'LLEN': return alive(a[0]) ? db.get(a[0]).length : 0;
    case 'LTRIM': { const l = alive(a[0]) ? db.get(a[0]) : []; db.set(a[0], l.slice(parseInt(a[1], 10), parseInt(a[2], 10) + 1)); return 'OK'; }
    case 'LRANGE': { const l = alive(a[0]) ? db.get(a[0]) : []; const end = parseInt(a[2], 10); return l.slice(parseInt(a[1], 10), end === -1 ? undefined : end + 1); }
    case 'INCR': { const v = (alive(a[0]) ? parseInt(db.get(a[0]), 10) : 0) + 1; db.set(a[0], String(v)); return v; }
    case 'INCRBY': { const v = (alive(a[0]) ? parseInt(db.get(a[0]), 10) : 0) + parseInt(a[1], 10); db.set(a[0], String(v)); return v; }
    case 'EXPIRE': ttl.set(a[0], Date.now() + parseInt(a[1], 10) * 1000); return 1;
    case 'HSET': { const h = alive(a[0]) ? db.get(a[0]) : new Map(); let n = 0; for (let i = 1; i + 1 < a.length; i += 2) { if (!h.has(a[i])) n++; h.set(a[i], a[i + 1]); } db.set(a[0], h); return n; }
    case 'HGETALL': { if (!alive(a[0])) return []; const out = []; for (const [k, v] of db.get(a[0])) out.push(k, v); return out; }
    case 'HLEN': return alive(a[0]) ? db.get(a[0]).size : 0;
    case 'HINCRBY': { const h = alive(a[0]) ? db.get(a[0]) : new Map(); const v = (parseInt(h.get(a[1]) || '0', 10)) + parseInt(a[2], 10); h.set(a[1], String(v)); db.set(a[0], h); return v; }
    default: throw new Error('mock redis: unsupported ' + c);
  }
}
const redis = http.createServer(async (req, res) => {
  const body = await readJSON(req);
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/pipeline') return json(res, 200, body.map((cmd) => { try { return { result: exec(cmd) }; } catch (e) { return { error: e.message }; } }));
  try { json(res, 200, { result: exec(body) }); } catch (e) { json(res, 400, { error: e.message }); }
});

/* ---- mock customer website ---- */
const pagesHtml = {
  '/': `<!doctype html><html lang="en"><head><title>Lumen Dental</title><meta name="description" content="Dentist."><meta property="og:image" content="/og.png"><link rel="icon" href="/fav.png"></head><body><h1>Lumen Dental</h1><p>${'Smile design and veneers in Antalya for international patients. '.repeat(30)}</p><a href="https://www.instagram.com/lumendental/">Instagram</a><img src="a.jpg"></body></html>`,
  '/about': `<!doctype html><html lang="en"><head><title>About Lumen Dental Antalya | Our clinic and team</title><meta name="description" content="Meet the Lumen Dental team in Antalya: digital smile design, veneers and implants for patients from the UK and Ireland."><meta property="og:title" content="About"><meta property="og:description" content="About"><meta property="og:image" content="/og.png"><script type="application/ld+json">{"@context":"https://schema.org","@type":"AboutPage"}</script></head><body><h1>About us</h1><h2>How long do veneers last?</h2><p>Veneers usually last 10 to 15 years with good care and checkups twice a year.</p><h2>Do I need a visa?</h2><p>Most UK and Irish visitors do not need a visa for a short treatment stay in Turkey.</p><p>${'Our team works with a fully digital workflow. '.repeat(40)}</p></body></html>`,
  '/blog/post-1': `<!doctype html><html lang="en"><head><title>Blog post one about dental tourism in Turkey</title></head><body><h1>Post</h1><p>Short.</p></body></html>`
};
let robotsTxt = 'User-agent: *\nDisallow: /private\n\nUser-agent: PerplexityBot\nDisallow: /\n';
const customer = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/robots.txt') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(robotsTxt); }
  if (u.pathname === '/sitemap.xml') { res.writeHead(200, { 'Content-Type': 'application/xml' }); return res.end(`<?xml version="1.0"?><urlset><url><loc>http://${req.headers.host}/</loc></url><url><loc>http://${req.headers.host}/about</loc></url><url><loc>http://${req.headers.host}/blog/post-1</loc></url></urlset>`); }
  const page = pagesHtml[u.pathname.replace(/\/+$/, '') || '/'];
  if (!page) { res.writeHead(404, { 'Content-Type': 'text/html' }); return res.end('<h1>404</h1>'); }
  res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(page);
});

/* ---- mock AI engines and text generation ---- */
const engineCalls = [];
let perplexityFailOnce = true;
let sonarGone = false;
function answerFor(prompt) {
  if (/veneer/i.test(prompt)) return { text: 'For veneers in Antalya, patients often choose Lumen Dental, then Bright Smile Clinic. Lumen Dental uses digital smile design.', sources: ['https://www.lumendental.com/veneers', 'https://www.trustpilot.com/review/lumendental.com'] };
  if (/implant/i.test(prompt)) return { text: 'Bright Smile Clinic is a popular choice for implants in Antalya.', sources: ['https://brightsmile.com/implants', 'https://www.whatclinic.com/x'] };
  return { text: 'Prices vary by clinic and material. Compare several clinics and read reviews.', sources: ['https://www.whatclinic.com/prices'] };
}
const ai = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const body = await readJSON(req);
  if (u.pathname === '/v1/responses' || u.pathname === '/xai/v1/responses') {
    const isGrok = u.pathname.startsWith('/xai/');
    if (!body.tools) {
      // text generation (suggestions)
      const ins = String(body.instructions || '') + ' ' + String(body.input || '');
      engineCalls.push({ e: 'gen', ins: ins.slice(0, 80) });
      if (/List \d+ search keywords/.test(ins)) return json(res, 200, { output_text: '{"keywords": ["Veneers in Antalya", "dental implants antalya", "veneers cost turkey", "Lumen Dental reviews"]}' });
      if (/For each keyword write/.test(ins)) {
        const kws = String(body.input).split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2));
        return json(res, 200, { output_text: JSON.stringify({ items: kws.map((k) => ({ keyword: k, questions: ['Which clinic is best for ' + k + '?', 'How much does ' + k + ' cost?'] })) }) });
      }
      if (/draft a web page/.test(ins)) return json(res, 200, { output_text: '{"title": "Dental implants in Antalya | Lumen Dental", "slug": "Dental Implants Antalya", "intro": "Lumen Dental places implants with a fully digital workflow.", "faq": [{"q": "How long do implants take?", "a": "Ask the clinic for your own plan."}, {"q": "Do UK patients come for implants?", "a": "Yes, many patients come from the UK."}]}' });
      if (/meta description/.test(ins)) return json(res, 200, { output: [{ type: 'message', content: [{ type: 'output_text', text: '```json\n{"title": "Veneers and smile design in Antalya | Lumen Dental", "description": "Digital smile design, veneers and implants in Antalya for patients from the UK and Ireland, planned with a fully digital workflow."}\n```' }] }] });
      if (/FAQ answers/.test(ins)) return json(res, 200, { output_text: '{"faq": [{"q": "How long do veneers last?", "a": "Veneers usually last 10 to 15 years with good care."}, {"q": "Do UK visitors need a visa?", "a": "Most UK visitors do not need a visa for a short stay."}]}' });
      if (/Excerpts from AI answers/.test(ins)) return json(res, 200, { output_text: '{"sentiment": ["positive", "neutral", "positive"], "descriptors": ["digital smile design", "popular for veneers"], "check": ["Lumen Dental uses digital smile design."]}' });
      return json(res, 200, { output_text: '{}' });
    }
    engineCalls.push({ e: isGrok ? 'grok' : 'openai', p: body.input, model: body.model, country: body.tools[0].user_location && body.tools[0].user_location.country, auth: req.headers.authorization });
    const a = answerFor(body.input);
    return json(res, 200, { model: body.model, output: [
      { type: 'web_search_call', id: 'ws1', status: 'completed', action: { type: 'search', query: 'antalya dental clinic reviews', sources: a.sources.map((s) => ({ type: 'url', url: s })) } },
      { type: 'message', content: [{ type: 'output_text', text: a.text, annotations: a.sources.map((s) => ({ type: 'url_citation', url: s, title: 'T', start_index: 0, end_index: 1 })) }] }] });
  }
  if (u.pathname === '/v1/agent') {
    engineCalls.push({ e: 'perplexity-agent', p: body.input, effort: body.effort, country: body.tools && body.tools[0] && body.tools[0].user_location && body.tools[0].user_location.country });
    const a = answerFor(body.input);
    const results = a.sources.map((s, i) => ({ id: i + 1, title: 'T' + (i + 1), url: s, snippet: 'x', date: null, source: 'web' }));
    results.push({ id: results.length + 1, title: 'Uncited', url: 'https://uncited.example/page', snippet: 'y', date: null, source: 'web' });
    const cites = a.sources.map((s, i) => '[' + (i + 1) + ']').join('');
    return json(res, 200, { id: 'r1', object: 'response', model: 'perplexity/sonar', status: 'completed', output: [
      { type: 'search_results', queries: ['veneers antalya clinics', 'antalya dental reviews'], results },
      { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: a.text + ' ' + cites, annotations: [] }] }],
      usage: { input_tokens: 900, output_tokens: 200, total_tokens: 1100, cost: { currency: 'USD', total_cost: 0.004, tool_calls_cost: 0.0025 } } });
  }
  if (u.pathname === '/v1/sonar') {
    if (sonarGone) return json(res, 410, { error: { message: 'Sonar chat completions moved to the Agent API' } });
    engineCalls.push({ e: 'perplexity', p: body.messages[0].content });
    if (perplexityFailOnce) { perplexityFailOnce = false; return json(res, 429, { error: { message: 'rate limited' } }); }
    const a = answerFor(body.messages[0].content);
    return json(res, 200, { model: 'sonar', choices: [{ message: { role: 'assistant', content: a.text } }], citations: a.sources, search_results: a.sources.map((s) => ({ title: 'T', url: s })) });
  }
  let m;
  if ((m = u.pathname.match(/^\/v1beta\/models\/([^/:]+):generateContent$/))) {
    const prompt = body.contents[0].parts[0].text;
    engineCalls.push({ e: 'gemini', p: prompt, key: req.headers['x-goog-api-key'] });
    if (/price|cost/i.test(prompt)) return json(res, 400, { error: { message: 'API key not valid' } });
    const a = answerFor(prompt);
    return json(res, 200, { modelVersion: m[1], candidates: [{ content: { parts: [{ text: a.text }] }, groundingMetadata: { webSearchQueries: ['antalya dental clinic reviews'], groundingChunks: a.sources.map((s) => ({ web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc', title: new URL(s).hostname.replace(/^www\./, '') } })) } }] });
  }
  if (u.pathname === '/v1/messages') {
    engineCalls.push({ e: 'claude', p: body.messages[0].content, model: body.model, tool: body.tools[0].type, key: req.headers['x-api-key'] });
    const a = answerFor(body.messages[0].content);
    return json(res, 200, { model: body.model, content: [
      { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'veneers antalya clinics' } },
      { type: 'web_search_tool_result', tool_use_id: 's1', content: a.sources.map((s) => ({ type: 'web_search_result', url: s, title: 'T' })) },
      { type: 'text', text: a.text, citations: a.sources.map((s) => ({ type: 'web_search_result_location', url: s, title: 'T', cited_text: 'x' })) }] });
  }
  if (u.pathname.startsWith('/v3/dataforseo_labs/google/')) {
    const task = body[0];
    const kind = u.pathname.split('/')[4];
    engineCalls.push({ e: 'labs', kind, task });
    if (req.headers.authorization !== 'Basic ' + Buffer.from('dl:dp').toString('base64')) return json(res, 200, { status_code: 20000, tasks: [{ status_code: 40100, status_message: 'You are not authorized' }] });
    let items = [];
    if (kind === 'keyword_overview') items = task.keywords.map((k) => ({ keyword: k, keyword_info: { search_volume: k.length * 100 }, search_intent_info: { main_intent: 'commercial' } }));
    if (kind === 'ranked_keywords') items = [{ keyword_data: { keyword: 'Smile Makeover Antalya', keyword_info: { search_volume: 880 } }, ranked_serp_element: { serp_item: { type: 'ai_overview_reference', url: 'https://lumendental.com/smile' } } }];
    if (kind === 'related_keywords') items = [{ keyword_data: { keyword: task.keyword + ' price', keyword_info: { search_volume: 300 } } }, { keyword_data: { keyword: 'best ' + task.keyword, keyword_info: { search_volume: 500 } } }];
    return json(res, 200, { status_code: 20000, tasks: [{ status_code: 20000, cost: 0.012, result: [{ items_count: items.length, items }] }] });
  }
  if (u.pathname === '/v3/serp/google/organic/live/advanced' || u.pathname === '/v3/serp/google/ai_mode/live/advanced') {
    const mode = u.pathname.includes('ai_mode') ? 'aimode' : 'aio';
    const task = body[0];
    engineCalls.push({ e: mode, p: task.keyword, loc: task.location_code, lang: task.language_code, auth: req.headers.authorization });
    if (req.headers.authorization !== 'Basic ' + Buffer.from('dl:dp').toString('base64')) return json(res, 200, { status_code: 20000, tasks: [{ status_code: 40100, status_message: 'You are not authorized' }] });
    const a = answerFor(task.keyword);
    const overview = { type: 'ai_overview', markdown: mode === 'aio' && /veneer/i.test(task.keyword) ? 'Lumen Dental and Bright Smile Clinic are popular for veneers in Antalya [1](https://lumendental.com/veneers).' : a.text, items: [], references: a.sources.map((s) => ({ type: 'ai_overview_reference', domain: new URL(s).hostname.replace(/^www\./, ''), url: s, title: 'T' })) };
    const items = mode === 'aio' && /implant/i.test(task.keyword) ? [{ type: 'organic', url: 'https://x.com' }] : [overview, { type: 'organic', url: 'https://x.com' }];
    return json(res, 200, { status_code: 20000, tasks: [{ status_code: 20000, cost: 0.0024, result: [{ keyword: task.keyword, items }] }] });
  }
  json(res, 404, { error: { message: 'mock ai: no route ' + u.pathname } });
});

/* ---- mock Resend ---- */
const emails = [];
const resend = http.createServer(async (req, res) => { const body = await readJSON(req); emails.push(body); json(res, 200, { id: 'em_' + emails.length }); });

/* ---- mock Webflow ---- */
const wfState = { sites: [], pages: {}, pageUpdates: [], schemaPuts: [], schemas: {}, items: [], revoked: false, revokeCalls: [] };
const webflow = http.createServer(async (req, res) => {
  const body = await readJSON(req);
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/oauth/access_token') {
    if (body.code !== 'good-code' || body.client_id !== 'cid' || body.client_secret !== 'sec') return json(res, 400, { error: 'invalid_grant' });
    if (body.redirect_uri !== 'https://app.test/callback') return json(res, 400, { error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
    return json(res, 200, { access_token: 'tok_abc', token_type: 'bearer' });
  }
  if (u.pathname === '/oauth/revoke_authorization') { wfState.revokeCalls.push(body); return json(res, 200, { didRevoke: true }); }
  if (wfState.revoked || (req.headers.authorization || '') !== 'Bearer tok_abc') return json(res, 401, { message: 'Request not authorized' });
  const p = u.pathname;
  let m;
  if (p === '/v2/token/authorized_by') return json(res, 200, { id: 'user_1', email: 'owner@agency.com', firstName: 'Ada', lastName: 'L' });
  if (p === '/v2/sites') return json(res, 200, { sites: wfState.sites });
  if ((m = p.match(/^\/v2\/sites\/(\w+)$/)) && req.method === 'GET') { const one = wfState.sites.find((x) => x.id === m[1]); return one ? json(res, 200, one) : json(res, 404, { message: 'mock: no site' }); }
  if ((m = p.match(/^\/v2\/sites\/(\w+)\/pages$/))) { const all = wfState.pages[m[1]] || []; return json(res, 200, { pages: all, pagination: { limit: 100, offset: 0, total: all.length } }); }
  if ((m = p.match(/^\/v2\/pages\/(\w+)$/)) && req.method === 'PUT') { wfState.pageUpdates.push({ id: m[1], body, localeId: u.searchParams.get('localeId') }); return json(res, 200, Object.assign({ id: m[1] }, body)); }
  if ((m = p.match(/^\/beta\/pages\/(\w+)\/schema-markup$/))) {
    if (req.method === 'PUT') { wfState.schemaPuts.push({ id: m[1], body, localeId: u.searchParams.get('localeId') }); wfState.schemas[m[1]] = body.jsonLdSchema; return json(res, 200, { id: m[1], jsonLdSchema: body.jsonLdSchema }); }
    return json(res, 200, { id: m[1], jsonLdSchema: wfState.schemas[m[1]] || null });
  }
  if ((m = p.match(/^\/v2\/sites\/(\w+)\/collections$/))) return json(res, 200, { collections: [{ id: 'colFaq', displayName: 'FAQs', slug: 'faqs' }] });
  if (p === '/v2/collections/colFaq') return json(res, 200, { id: 'colFaq', displayName: 'FAQs', fields: [{ slug: 'name', type: 'PlainText', displayName: 'Name' }, { slug: 'slug', type: 'PlainText', displayName: 'Slug' }, { slug: 'answer', type: 'RichText', displayName: 'Answer' }] });
  if (p === '/v2/collections/colFaq/items' && req.method === 'POST') { wfState.items.push(body); return json(res, 202, { id: 'it' + wfState.items.length }); }
  json(res, 404, { message: 'mock: no route ' + p });
});

/* ---- mock Polar ---- */
const polarState = { checkouts: [], checkout: null, subs: {} };
const polar = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const body = await readJSON(req);
  let pm;
  if (req.method === 'GET' && (pm = u.pathname.match(/^\/v1\/checkouts\/([\w-]+)$/))) return polarState.checkout && polarState.checkout.id === pm[1] ? json(res, 200, polarState.checkout) : json(res, 404, { detail: 'not found' });
  if (req.method === 'GET' && (pm = u.pathname.match(/^\/v1\/subscriptions\/([\w-]+)$/))) return polarState.subs[pm[1]] ? json(res, 200, polarState.subs[pm[1]]) : json(res, 404, { detail: 'not found' });
  if (u.pathname === '/v1/products/') return json(res, 200, { items: [
    { id: 'p_other', name: 'Flowdeck Solo Monthly', recurring_interval: 'month', metadata: {} },
    { id: 'p_solo_m', name: 'AI SEO Deck Solo', recurring_interval: 'month', metadata: { app: 'aiseodeck', plan: 'solo' } },
    { id: 'p_solo_y', name: 'AI SEO Deck Solo Yearly', recurring_interval: 'year', metadata: { app: 'aiseodeck', plan: 'solo' } },
    { id: 'p_studio_m', name: 'AI SEO Deck Studio', recurring_interval: 'month', metadata: {} }
  ], pagination: { max_page: 1 } });
  if (u.pathname === '/v1/checkouts/') { polarState.checkouts.push(body); return json(res, 201, { url: 'https://polar.test/checkout/1' }); }
  json(res, 404, { detail: 'no route' });
});

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
    SITE_URL_SCHEME: 'http', ALLOW_PRIVATE_FETCH: '1', REVOKE_CONFIRM_MS: '0',
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
  wfState.sites = [{ id: 'siteA', workspaceId: 'ws1', displayName: 'Lumen Dental', shortName: 'lumen-dental', customDomains: [{ id: 'd1', url: host }] }];
  wfState.pages.siteA = [
    { id: 'p1', title: 'Home', slug: 'home', publishedPath: '/' },
    { id: 'p2', title: 'About', slug: 'about', publishedPath: '/about' },
    { id: 'p404', title: '404', slug: '404', publishedPath: '/404' },
    { id: 'tpl', title: 'Blog Template', slug: 'detail_blog', publishedPath: '/blog/[slug]', collectionId: 'colBlog' }
  ];

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
    const audit = require('../api/_lib/audit');
    assert(audit.robotsBlocks('User-agent: *\nDisallow: /', 'OAI-SearchBot') === true, 'wildcard disallow blocks a bot');
    assert(audit.robotsBlocks('User-agent: *\nDisallow: /\n\nUser-agent: OAI-SearchBot\nAllow: /', 'OAI-SearchBot') === false, 'a specific allow group wins');
    const fx = require('../api/_lib/fixes');
    const merged = fx.mergeSchema({ '@context': 'https://schema.org', '@type': 'Dentist', name: 'Old' }, [fx.orgSchema({ type: 'Dentist', name: 'New', url: 'https://x.com/' }), fx.faqSchema([{ q: 'Q1?', a: 'A1' }, { q: 'Q2?', a: 'A2' }])]);
    assert(merged['@graph'].length === 2 && merged['@graph'][0].name === 'New' && merged['@graph'][1]['@type'] === 'FAQPage', 'merge replaces the old organization node and adds FAQ');
    const kept = fx.mergeSchema({ '@graph': [{ '@type': 'Product', name: 'Kit' }] }, [fx.faqSchema([{ q: 'a?', a: 'b' }, { q: 'c?', a: 'd' }])]);
    assert(kept['@graph'].some((n) => n['@type'] === 'Product'), 'merge keeps unrelated existing nodes');
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

  const app = startApp();
  const port = await listen(app);
  const post = (path, cookie, body, origin) => request(port, 'POST', path, { headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', origin: origin || 'https://app.test' }, body: typeof body === 'string' ? body : form(body) });
  const pump = async (cookie) => { for (let i = 0; i < 10; i++) { const x = await post('/app/run/pump', cookie, 'id=siteA'); const j = JSON.parse(x.body); if (j.finished || j.idle) break; } };

  console.log('connect from a keyword on the home page, then set up');
  let r = await request(port, 'GET', '/auth?kw=' + encodeURIComponent('Veneers in Antalya'));
  const state = new URL(r.headers.location).searchParams.get('state');
  assert(r.status === 302 && /scope=authorized_user%3Aread\+sites%3Aread\+pages%3Aread\+pages%3Awrite\+cms%3Aread\+cms%3Awrite/.test(r.headers.location), 'auth asks for the read, page write and CMS scopes');
  assert((r.headers['set-cookie'] || []).some((c) => c.startsWith('ad_kw=veneers%20in%20antalya')), 'the keyword from the home page waits in a cookie');
  r = await request(port, 'GET', '/callback?code=good-code&state=' + state, { headers: { cookie: cookiesFrom(r) } });
  const cookie = cookiesFrom(r);
  assert(r.status === 302 && r.headers.location === '/app/setup?id=siteA&kw=veneers%20in%20antalya', 'one new site goes straight to setup, with the keyword');
  r = await request(port, 'GET', '/app/setup?id=siteA&kw=veneers%20in%20antalya', { headers: { cookie } });
  assert(r.status === 200 && r.body.includes('Set up Lumen Dental') && r.body.includes('value="en" selected') && r.body.includes('>veneers in antalya</textarea>'), 'setup page shows the site, detects its language and holds the keyword');
  r = await post('/app/setup/suggest', cookie, { id: 'siteA' });
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
  assert(site.project.competitors[0].domain === 'brightsmile.com' && site.project.country === 'GB', 'rivals and market saved');
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
  assert(r.body.includes('Open the fix plan') && r.body.includes('Run the site audit') && /<ol class="todo">/.test(r.body), 'the overview says what to do next: keywords worth fixing, then the site audit');
  assert(r.body.includes('Who AI names') && r.body.includes('Sites the AI reads') && r.body.includes('Not run'), 'rivals, sources and the site health badge');
  r = await request(port, 'GET', '/app/site?id=siteA&tab=keywords', { headers: { cookie } });
  assert(r.status === 200 && r.body.includes('class="kt"') && r.body.includes('veneers in antalya') && r.body.includes('c st-b') && r.body.includes('c st-x'), 'the keyword deck renders with engine states');
  assert(r.body.includes('What the marks mean') && r.body.includes('Names you and links your site') && r.body.includes('Named by') && (r.body.includes('Fix this first') || r.body.includes('Fix plan')), 'the marks are explained in words, each keyword says how many engines name it and what to do');
  assert(r.body.indexOf('1,800 searches a month') > -1 && r.body.indexOf('veneers in antalya') < r.body.indexOf('smile makeover antalya'), 'the most searched keywords come first');
  assert(r.body.includes('c st-lock') && r.body.includes('4 more AI engines') && r.body.includes('1,800'), 'free plan sees the paid engines as locked columns, volumes shown');
  assert(r.body.includes('Check all keywords now') && r.body.includes('disabled') && r.body.includes('Checks on demand are part of the paid plans'), 'free plan cannot check on demand');
  r = await request(port, 'GET', '/app/keyword?id=siteA&k=' + kVen.id, { headers: { cookie } });
  assert(r.status === 200 && r.body.includes('Yes. 3 of 3 AI engines name Lumen Dental.') && r.body.includes('<mark>Lumen Dental</mark>') && r.body.includes('rival-name') && r.body.includes('chip own'), 'keyword page: the verdict and the answers with the brand marked');
  assert(r.body.includes('Which clinic is best for veneers in antalya?') && r.body.includes('Search <b>veneers in antalya</b>'), 'keyword page shows the questions and the search behind each answer');
  assert(r.body.includes('Run the site audit') && r.body.includes('Searches related to this keyword'), 'before an audit the plan asks to read the pages; related searches offered');
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
  r = await request(port, 'GET', '/cron/tick', { headers: { authorization: 'Bearer cronkey' } });
  assert(r.status === 200, 'Vercel Cron bearer is accepted');
  for (let i = 0; i < 4 && getJ('site:siteA').sched.runId; i++) r = await request(port, 'GET', '/cron/tick?key=cronkey', {});
  site = getJ('site:siteA');
  assert(!site.sched.runId && site.latest.total === 36, 'cron finished the paid run');
  const res2 = Object.fromEntries([...db.get('res:' + run2.id)].map(([k, v]) => [k, JSON.parse(v)]));
  const gem = Object.values(res2).filter((x) => x.e === 'gemini');
  assert(gem.filter((x) => !x.ok && /API key/.test(x.err)).length === 3 && gem.some((x) => x.ok && x.cited), 'Gemini: a 400 is recorded as failed, grounding domains count as citations');
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

  console.log('site audit, keyword fixes and page fixes');
  r = await post('/app/site/audit', cookie, { id: 'siteA', back: kVen.id });
  const audit = getJ('audit:siteA');
  assert(audit && audit.pagesChecked === 3 && r.headers.location.startsWith('/app/keyword?id=siteA&k=' + kVen.id), 'audit read the pages and came back to the keyword');
  assert(audit.site.blockedBots.includes('PerplexityBot') && audit.siteIssues.some((x) => x.code === 'robots_blocks_ai'), 'audit flags PerplexityBot blocked');
  assert(!audit.site.llms && audit.site.sitemap && !audit.site.orgSchema, 'llms.txt missing, sitemap found, no organization schema');
  const home = audit.pages.find((p) => p.path === '/');
  const about = audit.pages.find((p) => p.path === '/about');
  assert(home.pageId === 'p1' && home.issues.includes('title_length') && home.issues.includes('desc_length') && home.issues.includes('schema_missing'), 'homepage issues found');
  assert(about.faq.length === 2 && about.issues.includes('faq_no_schema'), 'questions on the about page without FAQ schema');
  assert(!audit.pages.some((p) => p.path === '/404'), 'utility pages skipped');
  r = await request(port, 'GET', '/app/keyword?id=siteA&k=' + kVen.id, { headers: { cookie } });
  assert(r.body.includes('Best page: <a href="http://' + host + '/about"') && r.body.includes('Write the fixes'), 'the keyword is matched to its best page');
  assert(!r.body.includes('API key not valid') && r.body.includes('This engine could not answer right now. It is asked again at the next check.'), 'customers see plain words for a failed answer, never the provider message');
  r = await post('/app/keyword/plan', cookie, { id: 'siteA', k: kVen.id });
  r = await request(port, 'GET', '/app/keyword?id=siteA&k=' + kVen.id, { headers: { cookie } });
  assert(r.body.includes('Veneers and smile design in Antalya | Lumen Dental') && r.body.includes('Q: Do UK visitors need a visa?') && r.body.includes('Apply to Webflow') && r.body.includes('value="colFaq"'), 'the fixes are written from the page, with the keyword, ready to apply');
  const metaGen = engineCalls.filter((c) => c.e === 'gen' && /meta descriptions/.test(c.ins)).length;
  assert(metaGen >= 1, 'the title and description were written by the AI');
  r = await post('/app/keyword/apply', cookie, { id: 'siteA', k: kVen.id, what: 'page', do_meta: '1', title: 'Veneers in Antalya | Lumen Dental', description: 'Emax veneers and digital smile design in Antalya for patients from the UK and Ireland, planned in one visit.', do_schema: '1', do_cms: '1', collection: 'colFaq', faq: 'Q: How long do veneers last?\nA: Usually 10 to 15 years.\n\nQ: Do UK visitors need a visa?\nA: Most do not.' });
  assert(wfState.pageUpdates.length === 1 && wfState.pageUpdates[0].id === 'p2' && wfState.pageUpdates[0].body.seo.title === 'Veneers in Antalya | Lumen Dental', 'one click: the title and description go to the matched page');
  assert(wfState.schemaPuts.length === 1 && wfState.schemaPuts[0].id === 'p2' && JSON.stringify(wfState.schemaPuts[0].body.jsonLdSchema).includes('FAQPage') && JSON.stringify(wfState.schemaPuts[0].body.jsonLdSchema).includes('How long do veneers last?'), 'one click: FAQ schema written to the page');
  assert(wfState.items.length === 2 && wfState.items.every((x) => x.isDraft === true) && wfState.items[0].fieldData.answer === '<p>Usually 10 to 15 years.</p>', 'one click: the answers go to the CMS as drafts');
  assert(getJ('site:siteA').keywords.find((k) => k.id === kVen.id).fixedAt > 0 && decodeURIComponent(r.headers.location).includes('Applied the title and description, FAQ schema and 2 answers as drafts in FAQs'), 'the keyword remembers it was fixed');
  r = await post('/app/keyword/page', cookie, { id: 'siteA', k: kImp.id, path: 'new' });
  r = await post('/app/keyword/plan', cookie, { id: 'siteA', k: kImp.id });
  r = await request(port, 'GET', '/app/keyword?id=siteA&k=' + kImp.id, { headers: { cookie } });
  assert(r.body.includes('Dental implants in Antalya | Lumen Dental') && r.body.includes('/dental-implants-antalya') && r.body.includes('Add the draft to Webflow'), 'a keyword without a page gets a new page drafted from the site');
  r = await post('/app/keyword/apply', cookie, { id: 'siteA', k: kImp.id, what: 'newpage', collection: 'colFaq' });
  assert(wfState.items.length === 3 && wfState.items[2].fieldData.name === 'Dental implants in Antalya | Lumen Dental' && wfState.items[2].fieldData.answer.includes('<h3>How long do implants take?</h3>') && wfState.items[2].isDraft, 'the new page lands in the CMS as a draft');
  r = await request(port, 'GET', '/app/site?id=siteA&tab=audit', { headers: { cookie } });
  assert(r.status === 200 && r.body.includes('User-agent: PerplexityBot') && r.body.includes('Download llms.txt'), 'audit tab shows the robots lines and the llms.txt download');
  r = await request(port, 'GET', '/app/llms?id=siteA', { headers: { cookie } });
  assert(r.status === 200 && r.body.startsWith('# Lumen Dental') && r.body.includes('/about'), 'llms.txt is written from the pages');
  r = await request(port, 'GET', '/app/fix?id=siteA&page=%2F', { headers: { cookie } });
  assert(r.status === 200 && r.body.includes('&quot;@type&quot;: &quot;Organization&quot;') && r.body.includes('instagram.com/lumendental'), 'homepage fix proposes Organization schema with the social profile');
  r = await post('/app/fix/schema', cookie, { id: 'siteA', path: '/', schema: '{"@context":"https://schema.org","@graph":[{"@type":"Dentist","name":"Lumen Dental"}]}' });
  assert(wfState.schemaPuts.length === 2 && wfState.schemaPuts[1].body.jsonLdSchema['@graph'][0]['@type'] === 'Dentist', 'schema written through the Webflow schema markup API');
  assert(getJ('audit:siteA').site.orgSchema === true, 'organization check passes after the fix');
  r = await post('/app/fix/schema', cookie, { id: 'siteA', path: '/', schema: '{bad json' });
  assert(wfState.schemaPuts.length === 2 && decodeURIComponent(r.headers.location).includes('not valid JSON'), 'invalid JSON is refused before Webflow');
  r = await post('/app/fix/suggest', cookie, { id: 'siteA', path: '/about', what: 'faq' });
  r = await request(port, 'GET', '/app/fix?id=siteA&page=%2Fabout', { headers: { cookie } });
  assert(r.body.includes('Q: Do UK visitors need a visa?') && r.body.includes('FAQPage'), 'AI FAQ answers feed the FAQPage proposal');

  console.log('localized sites: writes name the primary locale');
  assert(wfState.pageUpdates.every((x) => !x.localeId) && wfState.items.every((x) => !x.cmsLocaleId), 'a site without locales is written exactly as before');
  wfState.sites[0].locales = { primary: { id: 'loc_en', cmsLocaleId: 'cms_en', displayName: 'English', tag: 'en', enabled: true }, secondary: [{ id: 'loc_tr', cmsLocaleId: 'cms_tr', displayName: 'Turkish', tag: 'tr', enabled: true }, { id: 'loc_de', cmsLocaleId: 'cms_de', displayName: 'German', tag: 'de', enabled: false }] };
  r = await post('/app/fix/meta', cookie, { id: 'siteA', path: '/', title: 'Lumen Dental | Veneers and implants in Antalya', description: 'Emax veneers, implants and digital smile design in Antalya for patients from the UK and Ireland.' });
  assert(wfState.pageUpdates[wfState.pageUpdates.length - 1].localeId === 'loc_en', 'the title and description are written to the primary locale by id');
  r = await post('/app/fix/faq', cookie, { id: 'siteA', path: '/about', action: 'cms', collection: 'colFaq', faq: 'Q: Do you speak English?\nA: Yes, every coordinator does.' });
  const lastItem = wfState.items[wfState.items.length - 1];
  assert(lastItem.cmsLocaleId === 'cms_en' && lastItem.isDraft === true, 'CMS drafts are created in the primary locale by id');
  r = await post('/app/fix/schema', cookie, { id: 'siteA', path: '/about', schema: '{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[]}' });
  assert(wfState.schemaPuts[wfState.schemaPuts.length - 1].localeId === null, 'schema markup goes to the primary locale (Webflow documents localeId there for secondary locales only)');
  assert(getJ('site:siteA').locale && getJ('site:siteA').locale.id === 'loc_en' && getJ('site:siteA').locale.others.join() === 'Turkish', 'the site keeps its languages; a disabled one is left out');
  r = await request(port, 'GET', '/app/fix?id=siteA&page=%2F', { headers: { cookie } });
  assert(r.body.includes('data-locale-note') && r.body.includes('one more language (Turkish)') && r.body.includes('primary language, English, only'), 'the fix page says only the primary language is written');
  r = await request(port, 'GET', '/app/keyword?id=siteA&k=' + kVen.id, { headers: { cookie } });
  assert(r.body.includes('data-locale-note'), 'the keyword page says it too, next to Apply');
  delete wfState.sites[0].locales;
  await require('../api/_lib/store').updateSite('siteA', (s) => { s.locale = null; });
  r = await request(port, 'GET', '/app/fix?id=siteA&page=%2F', { headers: { cookie } });
  assert(!r.body.includes('data-locale-note'), 'no note on a site with one language');

  console.log('free plan limits on fixes');
  const u2 = getJ('user:user_1'); u2.plan = 'free'; db.set('user:user_1', JSON.stringify(u2));
  const updatesBefore = wfState.pageUpdates.length;
  r = await post('/app/fix/meta', cookie, { id: 'siteA', path: '/', title: 'A title that is long enough', description: 'A description that is long enough to pass the check.' });
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
  assert(r.body.includes('Try free for 7 days') && r.body.includes('$0 today, then $19 a month'), 'settings offer the 7 day trial on paid plans');
  r = await post('/app/billing/checkout', cookie, 'plan=solo&interval=yearly');
  assert(r.headers.location === 'https://polar.test/checkout/1' && polarState.checkouts[0].products[0] === 'p_solo_y' && polarState.checkouts[0].metadata.app === 'aiseodeck', 'checkout uses the AI SEO Deck yearly product, never the Flowdeck one');
  assert(polarState.checkouts[0].trial_interval === 'day' && polarState.checkouts[0].trial_interval_count === 7 && polarState.checkouts[0].success_url === 'https://app.test/app/billing/return?next=settings&checkout_id={CHECKOUT_ID}', 'checkout carries a 7 day trial and returns with the checkout id');
  r = await request(port, 'GET', '/app/start?plan=studio&interval=monthly', { headers: { cookie } });
  assert(r.status === 200 && r.body.includes('Try Studio free for 7 days') && r.body.includes('<dd>$0</dd>') && r.body.includes('Not now, continue on the free plan') && r.body.includes('name="from" value="start"'), 'start page shows the trial, today and the first charge');
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
    sonarGone = true;
    const before = engineCalls.filter((c) => c.e === 'perplexity-agent').length;
    ans = await engines.ask('perplexity', q, { country: 'GB', timeoutMs: 5000 });
    assert(ans.text && engineCalls.filter((c) => c.e === 'perplexity-agent').length === before + 1, 'when Sonar is gone, Perplexity answers come from the Agent API');
    sonarGone = false;
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
  r = await request(port, 'GET', '/cron/tick?key=cronkey', {});
  const tickOut = JSON.parse(r.body);
  site = getJ('site:siteA');
  assert(tickOut.started === 1 && tickOut.budget === true && site.sched.runId, 'daily call budget stops work and keeps the run for later');
  delete process.env.MAX_DAILY_CALLS;

  console.log('delete account');
  r = await post('/app/delete', cookie, 'sure=1');
  assert(r.headers.location === '/?deleted=1' && !db.get('user:user_1') && !db.get('site:siteA') && !db.get('audit:siteA') && !db.get('hist:siteA') && !db.get('res:' + run4.id), 'account and all site data deleted, single keyword checks included');
  assert(wfState.revokeCalls.length === 1, 'Webflow access revoked');

  console.log('signed in keyword from the home page, uninstall detection');
  r = await request(port, 'GET', '/auth');
  const st2 = new URL(r.headers.location).searchParams.get('state');
  r = await request(port, 'GET', '/callback?code=good-code&state=' + st2, { headers: { cookie: cookiesFrom(r) } });
  const cookie2 = cookiesFrom(r);
  r = await post('/app/setup', cookie2, { id: 'siteA', brand: 'Lumen Dental', domains: host, language: 'en', pick: ['veneers in antalya'] });
  const firstRun = getJ('site:siteA').sched.runId;
  assert(!!firstRun, 'reconnected site starts its first check');
  r = await request(port, 'GET', '/auth?plan=studio&interval=yearly', { headers: { cookie: cookie2 } });
  assert(r.headers.location === '/app/start?plan=studio&interval=yearly', 'a signed in user goes from a plan button straight to the start page');
  r = await request(port, 'GET', '/auth?plan=solo');
  const st3 = new URL(r.headers.location).searchParams.get('state');
  assert(cookiesFrom(r).includes('ad_plan='), 'the plan waits in a cookie during Webflow sign in');
  r = await request(port, 'GET', '/callback?code=good-code&state=' + st3, { headers: { cookie: cookiesFrom(r) } });
  assert(r.headers.location === '/app/start?plan=solo&interval=monthly', 'after Webflow the plan opens the start page');
  r = await request(port, 'GET', '/auth?kw=all%20on%204%20antalya', { headers: { cookie: cookie2 } });
  assert(r.headers.location === '/app?kw=all%20on%204%20antalya', 'a signed in user skips Webflow and goes to the app with the keyword');
  r = await request(port, 'GET', r.headers.location, { headers: { cookie: cookie2 } });
  assert(r.headers.location === '/app/site?id=siteA&tab=keywords&kw=all%20on%204%20antalya', 'the keyword opens on the only site');
  r = await request(port, 'GET', r.headers.location, { headers: { cookie: cookie2 } });
  assert(r.body.includes('value="all on 4 antalya"'), 'the add keyword box holds it');
  await store.endRun(firstRun);
  await store.updateSite('siteA', (s) => { s.sched.runId = ''; s.sched.firstRunDone = true; s.sched.nextRunAt = Date.now() - 1000; });
  wfState.revoked = true;
  r = await request(port, 'GET', '/cron/tick?key=cronkey', {});
  assert(!db.get('site:siteA') && /uninstalled/.test(getJ('user:user_1').notice || ''), 'an uninstalled app is noticed before the next check and its sites are deleted');
  wfState.revoked = false;

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

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
