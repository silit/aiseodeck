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
      if (/List \d+ questions/.test(ins)) return json(res, 200, { output_text: '{"prompts": ["Best clinic for veneers in Antalya?", "Where to get dental implants in Antalya?", "How much do veneers cost in Turkey?"]}' });
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
  if ((m = p.match(/^\/v2\/sites\/(\w+)\/pages$/))) { const all = wfState.pages[m[1]] || []; return json(res, 200, { pages: all, pagination: { limit: 100, offset: 0, total: all.length } }); }
  if ((m = p.match(/^\/v2\/pages\/(\w+)$/)) && req.method === 'PUT') { wfState.pageUpdates.push({ id: m[1], body }); return json(res, 200, Object.assign({ id: m[1] }, body)); }
  if ((m = p.match(/^\/beta\/pages\/(\w+)\/schema-markup$/))) {
    if (req.method === 'PUT') { wfState.schemaPuts.push({ id: m[1], body }); wfState.schemas[m[1]] = body.jsonLdSchema; return json(res, 200, { id: m[1], jsonLdSchema: body.jsonLdSchema }); }
    return json(res, 200, { id: m[1], jsonLdSchema: wfState.schemas[m[1]] || null });
  }
  if ((m = p.match(/^\/v2\/sites\/(\w+)\/collections$/))) return json(res, 200, { collections: [{ id: 'colFaq', displayName: 'FAQs', slug: 'faqs' }] });
  if (p === '/v2/collections/colFaq') return json(res, 200, { id: 'colFaq', displayName: 'FAQs', fields: [{ slug: 'name', type: 'PlainText', displayName: 'Name' }, { slug: 'slug', type: 'PlainText', displayName: 'Slug' }, { slug: 'answer', type: 'RichText', displayName: 'Answer' }] });
  if (p === '/v2/collections/colFaq/items' && req.method === 'POST') { wfState.items.push(body); return json(res, 202, { id: 'it' + wfState.items.length }); }
  json(res, 404, { message: 'mock: no route ' + p });
});

/* ---- mock Polar ---- */
const polarState = { checkouts: [] };
const polar = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const body = await readJSON(req);
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
    PERPLEXITY_API_KEY: 'pk', PERPLEXITY_API_BASE: 'http://127.0.0.1:' + aiPort,
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

  console.log('unit: analysis, audit, fixes, plans');
  {
    const a = require('../api/_lib/analyze');
    const proj = { brand: 'Lumen Dental', aliases: [], domains: ['lumendental.com'], competitors: [{ name: 'Bright Smile Clinic', domain: 'brightsmile.com' }] };
    const r = a.analyzeAnswer(proj, { text: 'Try Bright Smile Clinic or LUMEN-DENTAL in Antalya.', sources: [{ url: 'https://lumendental.com/x' }] });
    assert(r.mentioned && r.rank === 2 && r.of === 2 && r.cited, 'brand found despite case and dash, ranked 2nd after the rival, site cited');
    const t = a.analyzeAnswer(proj, { text: 'No names here.', sources: [] });
    assert(!t.mentioned && !t.cited && t.rank === 0, 'absent brand is not mentioned');
    const tr = a.analyzeAnswer({ brand: 'Şık Diş', domains: ['sikdis.com.tr'], competitors: [] }, { text: 'ŞIK DİŞ kliniği önerilir.', sources: [] });
    assert(tr.mentioned, 'Turkish letters match regardless of case and dots');
    const audit = require('../api/_lib/audit');
    assert(audit.robotsBlocks('User-agent: *\nDisallow: /', 'OAI-SearchBot') === true, 'wildcard disallow blocks a bot');
    assert(audit.robotsBlocks('User-agent: *\nDisallow: /\n\nUser-agent: OAI-SearchBot\nAllow: /', 'OAI-SearchBot') === false, 'a specific allow group wins');
    const fx = require('../api/_lib/fixes');
    const merged = fx.mergeSchema({ '@context': 'https://schema.org', '@type': 'Dentist', name: 'Old' }, [fx.orgSchema({ type: 'Dentist', name: 'New', url: 'https://x.com/' }), fx.faqSchema([{ q: 'Q1?', a: 'A1' }, { q: 'Q2?', a: 'A2' }])]);
    assert(merged['@graph'].length === 2 && merged['@graph'][0].name === 'New' && merged['@graph'][1]['@type'] === 'FAQPage', 'merge replaces the old organization node and adds FAQ');
    const kept = fx.mergeSchema({ '@graph': [{ '@type': 'Product', name: 'Kit' }] }, [fx.faqSchema([{ q: 'a?', a: 'b' }, { q: 'c?', a: 'd' }])]);
    assert(kept['@graph'].some((n) => n['@type'] === 'Product'), 'merge keeps unrelated existing nodes');
    const { limitsFor } = require('../api/_lib/plans');
    assert(limitsFor({ plan: 'free', email: 'a@b.com' }).allEngines === false && limitsFor({ plan: 'solo' }).prompts === 25 && limitsFor({ plan: 'agency' }).prompts === 200, 'plan limits');
    assert(limitsFor({ plan: 'free', email: 'reviewer@webflow.com' }).plan === 'agency', 'Webflow reviewers get Agency');
    const { parseFaq, parseRivals } = require('../api/index.js')._test;
    assert(parseFaq('Q: One?\nA: First answer\ncontinues\n\nQ: Two?\nA: Second').length === 2, 'FAQ text parses into pairs');
    assert(parseRivals('Bright Smile Clinic, https://www.brightsmile.com/\nX\nOther Co').length === 2, 'rivals parse; one-letter names are skipped');
  }

  const app = startApp();
  const port = await listen(app);

  console.log('connect and set up');
  let r = await request(port, 'GET', '/auth');
  const state = new URL(r.headers.location).searchParams.get('state');
  assert(r.status === 302 && /scope=authorized_user%3Aread\+sites%3Aread\+pages%3Aread\+pages%3Awrite\+cms%3Aread\+cms%3Awrite/.test(r.headers.location), 'auth asks for the read, page write and CMS scopes');
  r = await request(port, 'GET', '/callback?code=good-code&state=' + state, { headers: { cookie: cookiesFrom(r) } });
  const cookie = cookiesFrom(r);
  assert(r.status === 302 && r.headers.location === '/app/setup?id=siteA', 'one new site goes straight to setup');
  r = await request(port, 'GET', '/app/setup?id=siteA', { headers: { cookie } });
  assert(r.status === 200 && r.body.includes('Set up Lumen Dental') && r.body.includes('value="en" selected'), 'setup page shows the site and detects its language');
  r = await request(port, 'POST', '/app/setup/suggest', { headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: form({ id: 'siteA' }) });
  const sugg = JSON.parse(r.body).prompts;
  assert(sugg.length === 3 && sugg[0].includes('veneers'), 'prompt ideas come back from the AI');
  r = await request(port, 'POST', '/app/setup', { headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: form({ id: 'siteA', brand: 'Lumen Dental', aliases: '', domains: 'lumendental.com, ' + host, country: 'GB', language: 'en', rivals: 'Bright Smile Clinic, brightsmile.com', pick: sugg, own: 'Best dentist for a smile makeover?\nx' }) });
  assert(r.status === 302 && r.headers.location.startsWith('/app/site?id=siteA'), 'setup saves and opens the site');
  let site = getJ('site:siteA');
  assert(site.project.ready && site.tracked && site.prompts.length === 4, 'project is ready and tracked with 4 questions');
  assert(site.project.competitors[0].domain === 'brightsmile.com' && site.project.country === 'GB', 'rivals and market saved');
  const run1 = getJ('run:' + site.sched.runId);
  assert(run1 && run1.engines.join() === 'openai,aio,perplexity' && run1.total === 12, 'free plan: first run on ChatGPT, Google AI Overviews and Perplexity, 12 answers');

  console.log('first run through the page pump');
  for (let i = 0; i < 6; i++) {
    r = await request(port, 'POST', '/app/run/pump', { headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', origin: 'https://app.test' }, body: 'id=siteA' });
    if (JSON.parse(r.body).finished || JSON.parse(r.body).idle) break;
  }
  site = getJ('site:siteA');
  assert(!site.sched.runId && site.latest && site.latest.ok === 11 && site.latest.none === 1, 'run finished: 11 answers, 1 question without a Google AI Overview');
  assert(Math.abs(site.latest.mentionRate - 6 / 11) < 1e-9 && Math.abs(site.latest.citationRate - 6 / 11) < 1e-9, 'named and cited in 6 of 11 answers (the veneer questions)');
  assert(site.latest.voice[0].name === 'Bright Smile Clinic' && site.latest.voice[0].n === 8 && site.latest.voice[1].n === 6, 'share of voice: the rival is named in 8 answers, the brand in 6');
  assert(site.latest.byEngine.aio.na === 1 && site.latest.byEngine.aio.m === 2, 'AI Overviews: one question had none, two name the brand');
  assert(site.latest.insights && site.latest.insights.descriptors.includes('digital smile design') && site.latest.insights.sentiment.positive === 2, 'insights: descriptors and sentiment from the answers that name the brand');
  assert(site.latest.gaps.length === 1 && /implants/.test(site.latest.gaps[0].text) && site.latest.gaps[0].rivals[0] === 'Bright Smile Clinic', 'where rivals win: the implants question');
  assert(site.latest.topQueries.some((q) => q.q === 'antalya dental clinic reviews'), 'what the AI searched for is collected');
  assert(engineCalls.some((c) => c.e === 'aio' && c.loc === 2826 && c.lang === 'en'), 'Google AI Overviews asked for the UK market in English');
  assert(engineCalls.filter((c) => c.e === 'openai').every((c) => c.country === 'GB' && c.model === 'gpt-6-luna'), 'ChatGPT calls use the market and the default model');
  assert(emails.some((e) => /AI visibility for Lumen Dental/.test(e.subject)), 'first report email sent');
  assert(site.sched.nextRunAt - Date.now() > 29 * 86400000, 'free plan: next check in about a month');

  r = await request(port, 'GET', '/app/site?id=siteA', { headers: { cookie } });
  assert(r.status === 200 && r.body.includes('class="cell both"') && r.body.includes('visibility score'), 'answer grid and ring render');
  assert(r.body.includes('class="cell lock"') && r.body.includes('4 more AI engines') && r.body.includes('class="cell na"'), 'free plan sees the paid engines as locked columns, and the question without an AI Overview');
  assert(r.body.includes('How AI describes you') && r.body.includes('digital smile design'), 'insights panel renders');
  assert(r.body.includes('disabled') && r.body.includes('Checks on demand are part of the paid plans'), 'free plan cannot run a check on demand');
  r = await request(port, 'GET', '/app/site?id=siteA&tab=transcripts', { headers: { cookie } });
  assert(r.body.includes('<mark>Lumen Dental</mark>') && r.body.includes('rival-name') && r.body.includes('chip own'), 'transcripts highlight the brand, rivals and own sources');
  r = await request(port, 'GET', '/app/site?id=siteA&tab=sources', { headers: { cookie } });
  assert(r.body.includes('whatclinic.com') && !/class="host" title="lumendental\.com"/.test(r.body) && r.body.includes('lumendental.com/veneers'), 'sources list excludes the own domain and lists the own pages cited');
  r = await request(port, 'GET', '/app/site?id=siteA&tab=rivals', { headers: { cookie } });
  assert(r.status === 200 && r.body.includes('Where rivals win') && r.body.includes('Where to get dental implants in Antalya?'), 'rivals tab lists the gap');

  console.log('upgrade and a full run from cron');
  const user = getJ('user:user_1');
  user.plan = 'solo';
  db.set('user:user_1', JSON.stringify(user));
  r = await request(port, 'POST', '/app/site/run', { headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', origin: 'https://app.test' }, body: 'id=siteA' });
  site = getJ('site:siteA');
  const run2 = getJ('run:' + site.sched.runId);
  assert(run2 && run2.engines.join() === 'openai,aio,aimode,gemini,perplexity,claude,grok' && run2.total === 28, 'paid run asks all seven AI engines');
  r = await request(port, 'GET', '/cron/tick', {});
  assert(r.status === 401, 'cron needs the key');
  for (let i = 0; i < 4 && getJ('site:siteA').sched.runId; i++) r = await request(port, 'GET', '/cron/tick?key=cronkey', {});
  site = getJ('site:siteA');
  assert(!site.sched.runId && site.latest.total === 28, 'cron finished the paid run');
  const res2 = Object.fromEntries([...db.get('res:' + run2.id)].map(([k, v]) => [k, JSON.parse(v)]));
  const gem = Object.values(res2).filter((x) => x.e === 'gemini');
  assert(gem.some((x) => !x.ok && /API key/.test(x.err)) && gem.some((x) => x.ok && x.cited), 'Gemini: a 400 is recorded as failed, grounding domains count as citations');
  assert(Object.values(res2).filter((x) => x.e === 'perplexity').every((x) => x.ok), 'Perplexity: the 429 was retried and every answer read');
  assert(engineCalls.filter((c) => c.e === 'perplexity').length === 9, 'Perplexity was called once more for the retry');
  assert(site.latest.failed === 1 && site.latest.ok === 26 && site.latest.none === 1, 'summary counts the failed answer and the missing AI Overview');
  const cl = Object.values(res2).filter((x) => x.e === 'claude' && x.ok && x.cited);
  const gk = Object.values(res2).filter((x) => x.e === 'grok' && x.ok && x.cited);
  assert(cl.length === 2 && gk.length === 2 && cl[0].queries[0] === 'veneers antalya clinics', 'Claude and Grok answers read, with citations and searches');
  assert(engineCalls.some((c) => c.e === 'claude' && c.tool === 'web_search_20250305' && c.model === 'claude-haiku-5-5') && engineCalls.some((c) => c.e === 'grok' && c.auth === 'Bearer xk'), 'Claude and Grok called with the right tool, model and key');
  assert(Object.values(res2).some((x) => x.e === 'aimode' && x.ok && x.mentioned), 'Google AI Mode answers read');
  assert(site.sched.manual && site.sched.manual.n === 1, 'the check on demand is counted for this month');
  await require('../api/_lib/store').updateSite('siteA', (s) => { s.sched.manual.n = 2; });
  r = await request(port, 'POST', '/app/site/run', { headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', origin: 'https://app.test' }, body: 'id=siteA' });
  assert(!getJ('site:siteA').sched.runId && decodeURIComponent(r.headers.location).includes('2 extra checks'), 'at most 2 checks on demand a month');
  assert(db.get('hist:siteA').length === 2, 'two runs in the history');

  console.log('site audit and fixes');
  r = await request(port, 'POST', '/app/site/audit', { headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', origin: 'https://app.test' }, body: 'id=siteA' });
  const audit = getJ('audit:siteA');
  assert(audit && audit.pagesChecked === 3, 'audit read the static pages and the CMS page from the sitemap');
  assert(audit.site.blockedBots.includes('PerplexityBot') && audit.siteIssues.some((x) => x.code === 'robots_blocks_ai'), 'audit flags PerplexityBot blocked');
  assert(!audit.site.llms && audit.site.sitemap && !audit.site.orgSchema, 'llms.txt missing, sitemap found, no organization schema');
  const home = audit.pages.find((p) => p.path === '/');
  const about = audit.pages.find((p) => p.path === '/about');
  assert(home.pageId === 'p1' && home.issues.includes('title_length') && home.issues.includes('desc_length') && home.issues.includes('schema_missing'), 'homepage issues found');
  assert(about.faq.length === 2 && about.issues.includes('faq_no_schema'), 'questions on the about page without FAQ schema');
  assert(!audit.pages.some((p) => p.path === '/404'), 'utility pages skipped');
  r = await request(port, 'GET', '/app/site?id=siteA&tab=audit', { headers: { cookie } });
  assert(r.status === 200 && r.body.includes('User-agent: PerplexityBot') && r.body.includes('Download llms.txt'), 'audit tab shows the robots lines and the llms.txt download');
  r = await request(port, 'GET', '/app/llms?id=siteA', { headers: { cookie } });
  assert(r.status === 200 && r.body.startsWith('# Lumen Dental') && r.body.includes('/about'), 'llms.txt is written from the pages');

  r = await request(port, 'GET', '/app/fix?id=siteA&page=%2F', { headers: { cookie } });
  assert(r.status === 200 && r.body.includes('&quot;@type&quot;: &quot;Organization&quot;') && r.body.includes('instagram.com/lumendental'), 'homepage fix proposes Organization schema with the social profile');
  r = await request(port, 'POST', '/app/fix/suggest', { headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', origin: 'https://app.test' }, body: form({ id: 'siteA', path: '/', what: 'meta' }) });
  r = await request(port, 'GET', '/app/fix?id=siteA&page=%2F', { headers: { cookie } });
  assert(r.body.includes('Veneers and smile design in Antalya | Lumen Dental'), 'AI meta suggestion is shown for review');
  r = await request(port, 'POST', '/app/fix/meta', { headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', origin: 'https://app.test' }, body: form({ id: 'siteA', path: '/', title: 'Veneers and smile design in Antalya | Lumen Dental', description: 'Digital smile design, veneers and implants in Antalya for patients from the UK and Ireland, planned with a fully digital workflow.' }) });
  assert(wfState.pageUpdates.length === 1 && wfState.pageUpdates[0].id === 'p1' && wfState.pageUpdates[0].body.seo.title.startsWith('Veneers') && !('slug' in wfState.pageUpdates[0].body), 'meta written to the Webflow page, slug untouched');
  assert(!getJ('audit:siteA').pages.find((p) => p.path === '/').issues.includes('title_length'), 'stored audit reflects the fix');
  r = await request(port, 'POST', '/app/fix/schema', { headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', origin: 'https://app.test' }, body: form({ id: 'siteA', path: '/', schema: '{"@context":"https://schema.org","@graph":[{"@type":"Dentist","name":"Lumen Dental"}]}' }) });
  assert(wfState.schemaPuts.length === 1 && wfState.schemaPuts[0].body.jsonLdSchema['@graph'][0]['@type'] === 'Dentist', 'schema written through the Webflow schema markup API');
  assert(getJ('audit:siteA').site.orgSchema === true, 'organization check passes after the fix');
  r = await request(port, 'POST', '/app/fix/schema', { headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', origin: 'https://app.test' }, body: form({ id: 'siteA', path: '/', schema: '{bad json' }) });
  assert(wfState.schemaPuts.length === 1 && decodeURIComponent(r.headers.location).includes('not valid JSON'), 'invalid JSON is refused before Webflow');
  r = await request(port, 'POST', '/app/fix/suggest', { headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', origin: 'https://app.test' }, body: form({ id: 'siteA', path: '/about', what: 'faq' }) });
  r = await request(port, 'GET', '/app/fix?id=siteA&page=%2Fabout', { headers: { cookie } });
  assert(r.body.includes('Q: Do UK visitors need a visa?') && r.body.includes('FAQPage'), 'AI FAQ answers feed the FAQPage proposal');
  r = await request(port, 'POST', '/app/fix/faq', { headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', origin: 'https://app.test' }, body: form({ id: 'siteA', path: '/about', action: 'cms', collection: 'colFaq', faq: 'Q: How long do veneers last?\nA: Usually 10 to 15 years.' }) });
  assert(wfState.items.length === 1 && wfState.items[0].isDraft === true && wfState.items[0].fieldData.answer === '<p>Usually 10 to 15 years.</p>' && /^how-long-do-veneers-last-/.test(wfState.items[0].fieldData.slug), 'FAQ added to the CMS as a draft item');

  console.log('free plan limits on fixes');
  const u2 = getJ('user:user_1'); u2.plan = 'free'; db.set('user:user_1', JSON.stringify(u2));
  r = await request(port, 'POST', '/app/fix/meta', { headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', origin: 'https://app.test' }, body: form({ id: 'siteA', path: '/', title: 'A title that is long enough', description: 'A description that is long enough to pass the check.' }) });
  assert(wfState.pageUpdates.length === 1 && decodeURIComponent(r.headers.location).includes('paid plans'), 'free plan cannot write to Webflow');

  console.log('reports, security, billing');
  r = await request(port, 'POST', '/app/site/report', { headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', origin: 'https://app.test' }, body: 'id=siteA' });
  const tok = getJ('site:siteA').settings.reportToken;
  r = await request(port, 'GET', '/r/' + tok, {});
  assert(r.status === 200 && r.body.includes('AI visibility of Lumen Dental') && !r.body.includes('Sign out'), 'public report page works without signing in');
  r = await request(port, 'GET', '/r/nope-nope-nope', {});
  assert(r.status === 404, 'unknown report link is 404');
  r = await request(port, 'POST', '/app/site/settings', { headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', origin: 'https://evil.test' }, body: 'id=siteA&brand=Hacked' });
  assert(r.status === 403 && getJ('site:siteA').project.brand === 'Lumen Dental', 'cross-site posts are blocked');
  r = await request(port, 'GET', '/app/site?id=otherSite', { headers: { cookie } });
  assert(r.status === 404, 'other sites are not reachable');
  r = await request(port, 'GET', '/app/settings', { headers: { cookie } });
  assert(r.status === 200 && r.body.includes('name="plan" value="solo"'), 'settings show upgrade buttons when Polar has products');
  r = await request(port, 'POST', '/app/billing/checkout', { headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', origin: 'https://app.test' }, body: 'plan=solo&interval=yearly' });
  assert(r.headers.location === 'https://polar.test/checkout/1' && polarState.checkouts[0].products[0] === 'p_solo_y' && polarState.checkouts[0].metadata.app === 'aiseodeck', 'checkout uses the AI SEO Deck yearly product, never the Flowdeck one');
  // Polar webhook: subscription becomes active
  const billingLib = require('../api/_lib/billing');
  const store = require('../api/_lib/store');
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

  console.log('cost guard');
  process.env.MAX_DAILY_CALLS = '1';
  await store.updateSite('siteA', (s) => { s.sched.nextRunAt = Date.now() - 1000; });
  r = await request(port, 'GET', '/cron/tick?key=cronkey', {});
  const tickOut = JSON.parse(r.body);
  site = getJ('site:siteA');
  assert(tickOut.started === 1 && tickOut.budget === true && site.sched.runId, 'daily call budget stops work and keeps the run for later');
  delete process.env.MAX_DAILY_CALLS;

  console.log('delete account');
  r = await request(port, 'POST', '/app/delete', { headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', origin: 'https://app.test' }, body: 'sure=1' });
  assert(r.headers.location === '/?deleted=1' && !db.get('user:user_1') && !db.get('site:siteA') && !db.get('audit:siteA') && !db.get('hist:siteA'), 'account and all site data deleted');
  assert(wfState.revokeCalls.length === 1, 'Webflow access revoked');

  console.log('uninstall detection');
  r = await request(port, 'GET', '/auth');
  const st2 = new URL(r.headers.location).searchParams.get('state');
  r = await request(port, 'GET', '/callback?code=good-code&state=' + st2, { headers: { cookie: cookiesFrom(r) } });
  const cookie2 = cookiesFrom(r);
  r = await request(port, 'POST', '/app/setup', { headers: { cookie: cookie2, 'content-type': 'application/x-www-form-urlencoded', origin: 'https://app.test' }, body: form({ id: 'siteA', brand: 'Lumen Dental', domains: host, language: 'en', pick: ['Best clinic for veneers in Antalya?'] }) });
  const firstRun = getJ('site:siteA').sched.runId;
  assert(!!firstRun, 'reconnected site starts its first check');
  await store.endRun(firstRun);
  await store.updateSite('siteA', (s) => { s.sched.runId = ''; s.sched.firstRunDone = true; s.sched.nextRunAt = Date.now() - 1000; });
  wfState.revoked = true;
  r = await request(port, 'GET', '/cron/tick?key=cronkey', {});
  assert(!db.get('site:siteA') && /uninstalled/.test(getJ('user:user_1').notice || ''), 'an uninstalled app is noticed before the next check and its sites are deleted');
  wfState.revoked = false;

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
