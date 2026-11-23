// The services the app talks to, as small local servers for the tests: Upstash Redis, the AI engines and the
// keyword data provider, Resend, Webflow and Polar. test/app.js and test/panel.js share them.
const http = require('http');

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

/* ---- mock AI engines and text generation ---- */
const engineCalls = [];
// switches a test can set: Perplexity answers 429 once; Sonar chat completions are gone
const flags = { perplexityFailOnce: true, sonarGone: false };
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
      if (/CUTSHORT/.test(ins)) { engineCalls.push({ e: 'gen-max', max: body.max_output_tokens }); return json(res, 200, { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [{ type: 'reasoning', summary: [] }] }); }
      if (/NOJSON/.test(ins)) return json(res, 200, { output_text: 'I could not find enough facts on the page.' });
      if (/SLOWGEN/.test(ins)) { await new Promise((r) => setTimeout(r, 1500)); return json(res, 200, { output_text: '{"from": "openai"}' }); }
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
    if (flags.sonarGone) return json(res, 410, { error: { message: 'Sonar chat completions moved to the Agent API' } });
    engineCalls.push({ e: 'perplexity', p: body.messages[0].content });
    if (flags.perplexityFailOnce) { flags.perplexityFailOnce = false; return json(res, 429, { error: { message: 'rate limited' } }); }
    const a = answerFor(body.messages[0].content);
    return json(res, 200, { model: 'sonar', choices: [{ message: { role: 'assistant', content: a.text } }], citations: a.sources, search_results: a.sources.map((s) => ({ title: 'T', url: s })) });
  }
  let m;
  if ((m = u.pathname.match(/^\/v1beta\/models\/([^/:]+):generateContent$/))) {
    const prompt = body.contents[0].parts[0].text;
    if (!body.tools && /CUTSHORT|NOJSON|SLOWGEN/.test(prompt)) return json(res, 200, { candidates: [{ content: { parts: [{ text: 'thinking', thought: true }, { text: '{"from": "gemini"}' }] }, finishReason: 'STOP' }] });
    engineCalls.push({ e: 'gemini', p: prompt, key: req.headers['x-goog-api-key'], where: body.system_instruction && body.system_instruction.parts[0].text });
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
// tokenRequests: code exchanges at /oauth/access_token. refused: calls answered 401. resolveStatus: makes the ID token
// endpoint fail with that status. revokeCalls: calls to /oauth/revoke_authorization, which the app must never make.
const wfState = { sites: [], pages: {}, dom: {}, domCalls: [], domFail: {}, paths: [], pageUpdates: [], items: [], revoked: false, revokeCalls: [], tokenRequests: [], refused: [], resolveStatus: 0 };
let nodeSeq = 0;
// a text node as GET /v2/pages/:page_id/dom returns it: the HTML of the element and its plain text
const textNode = (html) => ({ id: 'n' + (++nodeSeq), type: 'text', text: { html, text: html.replace(/<[^>]+>/g, '') }, attributes: {} });
const imageNode = (alt) => ({ id: 'n' + (++nodeSeq), type: 'image', image: { alt, assetId: 'asset' + nodeSeq }, attributes: {} });
const findPage = (id) => { for (const [sid, list] of Object.entries(wfState.pages)) { const pg = list.find((x) => x.id === id); if (pg) return { sid, pg }; } return null; };
const webflow = http.createServer(async (req, res) => {
  const body = await readJSON(req);
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/oauth/access_token') {
    wfState.tokenRequests.push({ code: body && body.code, redirect_uri: body && body.redirect_uri });
    if (body.code !== 'good-code' || body.client_id !== 'cid' || body.client_secret !== 'sec') return json(res, 400, { error: 'invalid_grant' });
    // like Webflow: the redirect address has to be the app's own, exactly
    if (body.redirect_uri !== (process.env.APP_URL || 'https://app.test') + '/callback') return json(res, 400, { error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
    return json(res, 200, { access_token: 'tok_abc', token_type: 'bearer' });
  }
  if (u.pathname === '/oauth/revoke_authorization') { wfState.revokeCalls.push(body); return json(res, 200, { didRevoke: true }); }
  if (wfState.revoked || (req.headers.authorization || '') !== 'Bearer tok_abc') { wfState.refused.push(req.method + ' ' + u.pathname); return json(res, 401, { message: 'Request not authorized' }); }
  const p = u.pathname;
  wfState.paths.push(req.method + ' ' + p);
  let m;
  if (p === '/v2/token/authorized_by') return json(res, 200, { id: 'user_1', email: 'owner@agency.com', firstName: 'Ada', lastName: 'L' });
  if (p === '/beta/token/resolve' && req.method === 'POST' && wfState.resolveStatus) return json(res, wfState.resolveStatus, { message: 'mock: the ID token endpoint is failing' });
  if (p === '/beta/token/resolve' && req.method === 'POST') { const t = String((body && body.idToken) || ''); return t.startsWith('idt:') ? json(res, 200, { id: t.split(':')[2] || 'user_1', email: 'owner@agency.com', firstName: 'Ada', lastName: 'L', siteId: t.split(':')[1] }) : json(res, 401, { message: 'Invalid ID token' }); }
  if ((m = p.match(/^\/v2\/pages\/(\w+)$/)) && req.method === 'GET') { const f = findPage(m[1]); return f ? json(res, 200, Object.assign({ siteId: f.sid }, f.pg)) : json(res, 404, { message: 'mock: no page' }); }
  if ((m = p.match(/^\/v2\/pages\/(\w+)\/dom$/)) && req.method === 'GET') {
    // like Webflow: at most 100 nodes a call, with the total in the pagination
    wfState.domCalls.push(m[1]);
    if (wfState.domFail[m[1]]) return json(res, wfState.domFail[m[1]], { message: 'mock: the content of this page is not served now' });
    const f = findPage(m[1]);
    if (!f) return json(res, 404, { message: 'mock: no page' });
    const all = wfState.dom[m[1]] || [];
    const limit = Math.min(100, parseInt(u.searchParams.get('limit') || '100', 10));
    const offset = parseInt(u.searchParams.get('offset') || '0', 10);
    return json(res, 200, { pageId: m[1], nodes: all.slice(offset, offset + limit), pagination: { limit, offset, total: all.length }, lastUpdated: f.pg.lastUpdated || null });
  }
  if (p === '/v2/sites') return json(res, 200, { sites: wfState.sites });
  if ((m = p.match(/^\/v2\/sites\/(\w+)$/)) && req.method === 'GET') { const one = wfState.sites.find((x) => x.id === m[1]); return one ? json(res, 200, one) : json(res, 404, { message: 'mock: no site' }); }
  if ((m = p.match(/^\/v2\/sites\/(\w+)\/pages$/))) { const all = wfState.pages[m[1]] || []; return json(res, 200, { pages: all, pagination: { limit: 100, offset: 0, total: all.length } }); }
  if ((m = p.match(/^\/v2\/pages\/(\w+)$/)) && req.method === 'PUT') {
    // like Webflow: a primary locale id is refused, only a secondary one may be named
    const lid = u.searchParams.get('localeId');
    const site0 = wfState.sites[0] || {};
    if (lid && site0.locales && site0.locales.primary && site0.locales.primary.id === lid) return json(res, 400, { code: 'bad_request', message: 'Bad Request: Request is malformed: The provided locale must be a secondary locale.' });
    const f = findPage(m[1]);
    if (!f) return json(res, 404, { message: 'mock: no page' });
    // like Webflow: the page keeps what was sent, and the answer is the page as it is now
    if (body && body.seo) f.pg.seo = Object.assign({}, f.pg.seo, body.seo);
    if (body && body.openGraph) f.pg.openGraph = Object.assign({}, f.pg.openGraph, body.openGraph);
    wfState.pageUpdates.push({ id: m[1], body, localeId: lid });
    return json(res, 200, Object.assign({ siteId: f.sid }, f.pg));
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

module.exports = {
  listen, readRaw, readJSON, json,
  db, ttl, redis,
  engineCalls, flags, answerFor, ai,
  emails, resend,
  wfState, textNode, imageNode, findPage, webflow,
  polarState, polar
};
