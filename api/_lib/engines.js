'use strict';
// AI answer engines. Each one gets the question exactly as a person would type it, with live web search on,
// and returns { text, sources: [{ url, title, host }], queries: [what the AI searched for], model }.
// Google AI Overviews and AI Mode come from the live Google results (DataForSEO); when Google shows no
// AI answer for a question the engine returns { none: true }.
// An engine is on when its key is set. ENGINES=openai,aio limits the list. Perplexity is kept for a later release
// and stays off until PERPLEXITY_ENABLED=1 is set, whatever its key.

const ORDER = ['openai', 'aio', 'aimode', 'gemini', 'perplexity', 'claude', 'grok'];
const LABEL = { openai: 'ChatGPT', aio: 'AI Overviews', aimode: 'AI Mode', gemini: 'Gemini', perplexity: 'Perplexity', claude: 'Claude', grok: 'Grok' };
const LONG = { openai: 'ChatGPT', aio: 'Google AI Overviews', aimode: 'Google AI Mode', gemini: 'Gemini', perplexity: 'Perplexity', claude: 'Claude', grok: 'Grok' };
const KEY = { openai: 'OPENAI_API_KEY', aio: 'DATAFORSEO_LOGIN', aimode: 'DATAFORSEO_LOGIN', gemini: 'GEMINI_API_KEY', perplexity: 'PERPLEXITY_API_KEY', claude: 'ANTHROPIC_API_KEY', grok: 'XAI_API_KEY' };
// How many calls to one engine may run at the same time (stays under each provider's rate limits)
const PARALLEL = { openai: 4, aio: 4, aimode: 4, gemini: 3, perplexity: 2, claude: 2, grok: 2 };
// Engines that stay off until switched on: { engine: env flag that must be "1" }
const OPT_IN = { perplexity: 'PERPLEXITY_ENABLED' };
// The free plan gets the first three of these that are on: cheap per answer and widely used
const FREE = ['openai', 'aio', 'perplexity', 'gemini'];
const FREE_COUNT = 3;

const env = (k, d) => String(process.env[k] || d || '').trim();
const base = (k, d) => env(k, d).replace(/\/+$/, '');

function enabled() {
  const only = env('ENGINES').toLowerCase().split(',').map((x) => x.trim()).filter(Boolean);
  return ORDER.filter((e) => env(KEY[e]) && (!OPT_IN[e] || env(OPT_IN[e]) === '1') && (e !== 'aio' && e !== 'aimode' || env('DATAFORSEO_PASSWORD')) && (!only.length || only.includes(e)));
}
// The engines of the free plan, in order (ChatGPT, Google AI Overviews and Gemini while Perplexity is off)
function freeEngines() {
  const on = enabled();
  return FREE.filter((e) => on.includes(e)).slice(0, FREE_COUNT);
}
// Engines a plan may use, and the ones it shows as locked
function forLimits(limits) {
  const on = enabled();
  if (limits.allEngines) return on;
  const free = freeEngines();
  return free.length ? free : on.slice(0, 1);
}
function lockedFor(limits) {
  const use = forLimits(limits);
  return enabled().filter((e) => !use.includes(e));
}

function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) { return ''; }
}
function addSource(list, url, title, host) {
  if (!url && !host) return;
  const h = String(host || hostOf(url)).replace(/^www\./, '').toLowerCase();
  if (!h) return;
  if (list.some((s) => (url && s.url === url) || (!url && s.host === h))) return;
  list.push({ url: url || '', title: String(title || '').slice(0, 160), host: h });
}
function addQuery(list, q) {
  const t = String(q || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  if (t && !list.some((x) => x.toLowerCase() === t.toLowerCase())) list.push(t);
}

class EngineError extends Error {
  constructor(message, status, retry) { super(message); this.status = status || 0; this.retry = !!retry; }
}
async function post(url, headers, body, timeoutMs) {
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json', Accept: 'application/json' }, headers), body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs || 45000) });
  } catch (e) {
    throw new EngineError(e.name === 'TimeoutError' ? 'timed out' : 'network error: ' + e.message, 0, true);
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
  if (!res.ok) {
    const msg = (data && ((data.error && (data.error.message || data.error.type)) || data.message || data.detail || data.status_message)) || ('HTTP ' + res.status);
    // 429 and 5xx are worth another try later; other 4xx (bad key, bad model) are not
    throw new EngineError(String(typeof msg === 'string' ? msg : JSON.stringify(msg)).slice(0, 200), res.status, res.status === 429 || res.status >= 500);
  }
  return data || {};
}

/* ---- Responses API answers (ChatGPT, Grok): message text with url_citation annotations ---- */
function readResponses(d, out) {
  for (const item of d.output || []) {
    if (item.type === 'message') {
      for (const c of item.content || []) {
        if (typeof c.text === 'string') {
          out.text += (out.text ? '\n' : '') + c.text;
          for (const a of c.annotations || []) if (a.type === 'url_citation' || a.url) addSource(out.sources, a.url, a.title);
        }
      }
    } else if (item.type === 'web_search_call' && item.action) {
      const a = item.action;
      if (a.query) addQuery(out.queries, a.query);
      for (const q of a.queries || []) addQuery(out.queries, q);
      for (const s of a.sources || []) if (s && s.url) addSource(out.consulted, s.url, s.title);
    }
  }
  if (!out.text && typeof d.output_text === 'string') out.text = d.output_text;
  for (const u of d.citations || []) addSource(out.sources, typeof u === 'string' ? u : u && u.url, u && u.title);
  return out;
}

/* ---- ChatGPT: OpenAI Responses API with the web_search tool ---- */
async function openai(prompt, opts) {
  const model = env('OPENAI_MODEL', 'gpt-6-luna');
  const tool = { type: 'web_search' };
  if (opts.country && /^[A-Z]{2}$/.test(opts.country)) tool.user_location = { type: 'approximate', country: opts.country };
  const body = { model, input: prompt, tools: [tool], include: ['web_search_call.action.sources'] };
  if (env('OPENAI_FORCE_SEARCH') === '1') body.tool_choice = 'required';
  const d = await post(base('OPENAI_API_BASE', 'https://api.openai.com') + '/v1/responses', { Authorization: 'Bearer ' + env('OPENAI_API_KEY') }, body, opts.timeoutMs);
  return Object.assign(readResponses(d, { text: '', sources: [], consulted: [], queries: [] }), { model: d.model || model });
}

/* ---- Grok: xAI Responses API with the web_search tool ---- */
async function grok(prompt, opts) {
  const model = env('XAI_MODEL', 'grok-4.3');
  const d = await post(base('XAI_API_BASE', 'https://api.x.ai') + '/v1/responses', { Authorization: 'Bearer ' + env('XAI_API_KEY') },
    { model, input: prompt, tools: [{ type: 'web_search' }] }, opts.timeoutMs);
  return Object.assign(readResponses(d, { text: '', sources: [], consulted: [], queries: [] }), { model: d.model || model });
}

/* ---- Perplexity: the Agent API (Perplexity's successor to Sonar chat completions) ---- */
async function perplexityAgent(prompt, opts, root, headers) {
  const body = { input: prompt, max_output_tokens: 1200 };
  const m = env('PERPLEXITY_AGENT_MODEL');
  if (m) body.model = m; else body.effort = env('PERPLEXITY_EFFORT', 'fast'); // "fast" is the documented stand-in for sonar
  const tool = { type: 'web_search' };
  if (opts.country && /^[A-Z]{2}$/.test(opts.country)) tool.user_location = { country: opts.country };
  body.tools = [tool];
  const d = await post(root + '/v1/agent', headers, body, opts.timeoutMs);
  const out = { text: '', sources: [], consulted: [], queries: [], model: d.model || m || 'perplexity-agent' };
  const byId = new Map();
  for (const item of d.output || []) {
    if (item.type === 'message') {
      for (const c of item.content || []) {
        if (typeof c.text !== 'string') continue;
        out.text += (out.text ? '\n' : '') + c.text;
        for (const a of c.annotations || []) if (a && a.url) addSource(out.sources, a.url, a.title);
      }
    } else if (item.type === 'search_results') {
      for (const q of item.queries || []) addQuery(out.queries, q);
      for (const r of item.results || []) if (r && r.url) { byId.set(String(r.id), r); addSource(out.consulted, r.url, r.title); }
    }
  }
  if (!out.text && typeof d.output_text === 'string') out.text = d.output_text;
  // [n] in the answer points to search result n: those are the sources it cites
  for (const mk of out.text.match(/\[(\d{1,3})\]/g) || []) { const r = byId.get(mk.slice(1, -1)); if (r) addSource(out.sources, r.url, r.title); }
  if (!out.sources.length) for (const s of out.consulted) addSource(out.sources, s.url, s.title);
  return out;
}

/* ---- Perplexity: Sonar while it lasts, then the Agent API ---- */
async function perplexity(prompt, opts) {
  const model = env('PERPLEXITY_MODEL', 'sonar');
  const root = base('PERPLEXITY_API_BASE', 'https://api.perplexity.ai');
  const headers = { Authorization: 'Bearer ' + env('PERPLEXITY_API_KEY') };
  if (env('PERPLEXITY_API') === 'agent') return perplexityAgent(prompt, opts, root, headers);
  const body = { model, messages: [{ role: 'user', content: prompt }] };
  let d;
  try { d = await post(root + env('PERPLEXITY_PATH', '/v1/sonar'), headers, body, opts.timeoutMs); }
  catch (e) {
    const gone = e.status === 404 || e.status === 410 || (e.status >= 400 && e.status < 500 && /deprecat|migrat|no longer|sunset/i.test(e.message || ''));
    if (!gone || env('PERPLEXITY_PATH')) throw e;
    try { return await perplexityAgent(prompt, opts, root, headers); }
    catch (e2) {
      if (e2.status !== 404) throw e2;
      d = await post(root + '/chat/completions', headers, body, opts.timeoutMs); // older address
    }
  }
  const ch = (d.choices && d.choices[0]) || {};
  const out = { text: String((ch.message && ch.message.content) || ''), sources: [], consulted: [], queries: [], model: d.model || model };
  for (const r of d.search_results || []) addSource(out.sources, r.url, r.title);
  for (const u of d.citations || []) addSource(out.sources, typeof u === 'string' ? u : u && u.url, '');
  return out;
}

/* ---- Gemini: generateContent with Google Search grounding ---- */
async function gemini(prompt, opts) {
  const model = env('GEMINI_MODEL', 'gemini-3.8-flash');
  const d = await post(base('GEMINI_API_BASE', 'https://generativelanguage.googleapis.com') + `/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    { 'x-goog-api-key': env('GEMINI_API_KEY') },
    { contents: [{ role: 'user', parts: [{ text: prompt }] }], tools: [{ google_search: {} }] }, opts.timeoutMs);
  const cand = (d.candidates && d.candidates[0]) || {};
  const gm = cand.groundingMetadata || {};
  const out = { text: ((cand.content && cand.content.parts) || []).map((p) => p.text || '').join(''), sources: [], consulted: [], queries: [], model: d.modelVersion || model };
  // Grounding links are Google redirect links; the title holds the source domain.
  for (const ch of gm.groundingChunks || []) {
    const w = ch.web || {};
    const t = String(w.title || '').trim().toLowerCase();
    const host = /^[a-z0-9.-]+\.[a-z]{2,}$/.test(t) ? t : hostOf(w.uri);
    addSource(out.sources, w.uri || '', w.title || '', host);
  }
  for (const q of gm.webSearchQueries || []) addQuery(out.queries, q);
  return out;
}

/* ---- Claude: Messages API with the web search tool ---- */
async function claude(prompt, opts) {
  const model = env('ANTHROPIC_MODEL', 'claude-haiku-5-5');
  const tool = { type: env('ANTHROPIC_SEARCH_TOOL', 'web_search_20250305'), name: 'web_search', max_uses: 3 };
  if (opts.country && /^[A-Z]{2}$/.test(opts.country)) tool.user_location = { type: 'approximate', country: opts.country };
  const d = await post(base('ANTHROPIC_API_BASE', 'https://api.anthropic.com') + '/v1/messages',
    { 'x-api-key': env('ANTHROPIC_API_KEY'), 'anthropic-version': env('ANTHROPIC_VERSION', '2023-06-01') },
    { model, max_tokens: 1200, messages: [{ role: 'user', content: prompt }], tools: [tool] }, opts.timeoutMs);
  const out = { text: '', sources: [], consulted: [], queries: [], model: d.model || model };
  for (const b of d.content || []) {
    if (b.type === 'text') {
      out.text += b.text || '';
      for (const c of b.citations || []) if (c.url) addSource(out.sources, c.url, c.title);
    } else if (b.type === 'server_tool_use' && b.input && b.input.query) addQuery(out.queries, b.input.query);
    else if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
      for (const r of b.content) if (r && r.url) addSource(out.consulted, r.url, r.title);
    }
  }
  return out;
}

/* ---- Google AI Overviews and AI Mode: live Google results through DataForSEO ---- */
// Google Ads location codes for the markets offered in setup
const LOCATION = { US: 2840, GB: 2826, IE: 2372, CA: 2124, AU: 2036, DE: 2276, FR: 2250, NL: 2528, ES: 2724, IT: 2380, TR: 2792, AE: 2784, SA: 2682, PL: 2616, SE: 2752, IN: 2356, BR: 2076, MX: 2484 };
function dfsAuth() { return 'Basic ' + Buffer.from(env('DATAFORSEO_LOGIN') + ':' + env('DATAFORSEO_PASSWORD')).toString('base64'); }
async function dataforseo(path, task, opts) {
  const d = await post(base('DATAFORSEO_API_BASE', 'https://api.dataforseo.com') + path, { Authorization: dfsAuth() }, [task], opts.timeoutMs);
  const t = (d.tasks && d.tasks[0]) || {};
  if (t.status_code !== 20000) {
    const code = t.status_code || d.status_code || 0;
    throw new EngineError('Google results: ' + String(t.status_message || d.status_message || 'no result').slice(0, 160), code, code >= 50000);
  }
  return (t.result && t.result[0]) || {};
}
function readAiItem(item, out) {
  if (!item) return false;
  let text = item.markdown || '';
  if (!text) text = (item.items || []).map((e) => e.markdown || e.text || '').filter(Boolean).join('\n');
  out.text = String(text).replace(/\[(\d+)\]\([^)]*\)/g, '').trim();
  const refs = (item.references || []).concat(...(item.items || []).map((e) => e.references || []));
  for (const r of refs) if (r) addSource(out.sources, r.url, r.title, r.domain);
  return !!out.text;
}
async function googleAi(kind, prompt, opts) {
  const task = { keyword: prompt.replace(/\s+/g, ' ').trim().slice(0, 700), location_code: LOCATION[opts.country] || 2840, language_code: /^[a-z]{2}$/.test(opts.language || '') ? opts.language : 'en' };
  const out = { text: '', sources: [], consulted: [], queries: [], model: kind === 'aio' ? 'google-ai-overview' : 'google-ai-mode' };
  if (kind === 'aio') {
    Object.assign(task, { device: 'desktop', depth: 10, load_async_ai_overview: true });
    const r = await dataforseo('/v3/serp/google/organic/live/advanced', task, opts);
    if (!readAiItem((r.items || []).find((i) => i.type === 'ai_overview'), out)) out.none = true;
  } else {
    const r = await dataforseo('/v3/serp/google/ai_mode/live/advanced', task, opts);
    const items = r.items || [];
    if (!readAiItem(items.find((i) => i.type === 'ai_overview') || items[0], out)) out.none = true;
  }
  return out;
}

const RUN = { openai, aio: (p, o) => googleAi('aio', p, o), aimode: (p, o) => googleAi('aimode', p, o), gemini, perplexity, claude, grok };

async function ask(engine, prompt, opts) {
  if (!RUN[engine]) throw new EngineError('unknown engine ' + engine, 0, false);
  if (!env(KEY[engine])) throw new EngineError(LABEL[engine] + ' is not set up', 0, false);
  const started = Date.now();
  const out = await RUN[engine](String(prompt).slice(0, 1000), opts || {});
  out.ms = Date.now() - started;
  out.text = String(out.text || '').trim();
  out.queries = (out.queries || []).slice(0, 8);
  if (!out.text && !out.none) throw new EngineError('empty answer', 0, true);
  return out;
}

module.exports = { ORDER, LABEL, LONG, PARALLEL, FREE, OPT_IN, LOCATION, enabled, freeEngines, forLimits, lockedFor, ask, hostOf, EngineError };
