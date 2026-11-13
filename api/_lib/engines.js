'use strict';
// AI answer engines. Each one gets the prompt exactly as a person would type it, with live web search on,
// and returns the answer text and the sources it cited: { text, sources: [{ url, title, host }], model }.
// Engines are on when their API key is set. ENGINES=openai,perplexity limits the list.

const ORDER = ['openai', 'perplexity', 'gemini', 'claude'];
const LABEL = { openai: 'ChatGPT', perplexity: 'Perplexity', gemini: 'Gemini', claude: 'Claude' };
const KEY = { openai: 'OPENAI_API_KEY', perplexity: 'PERPLEXITY_API_KEY', gemini: 'GEMINI_API_KEY', claude: 'ANTHROPIC_API_KEY' };
// How many calls to one engine may run at the same time (stays under each provider's rate limits)
const PARALLEL = { openai: 4, perplexity: 2, gemini: 3, claude: 2 };

const env = (k, d) => String(process.env[k] || d || '').trim();
const base = (k, d) => env(k, d).replace(/\/+$/, '');

function enabled() {
  const only = env('ENGINES').toLowerCase().split(',').map((x) => x.trim()).filter(Boolean);
  return ORDER.filter((e) => env(KEY[e]) && (!only.length || only.includes(e)));
}
// Engines a plan may use: the free plan gets one (ChatGPT when it is set up), paid plans all of them.
function forLimits(limits) {
  const on = enabled();
  if (!on.length) return [];
  if (limits.engines >= on.length) return on;
  return on.slice(0, Math.max(1, limits.engines));
}

function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) { return ''; }
}
function addSource(list, url, title, host) {
  if (!url && !host) return;
  const h = host || hostOf(url);
  if (!h) return;
  if (list.some((s) => (url && s.url === url) || (!url && s.host === h))) return;
  list.push({ url: url || '', title: String(title || '').slice(0, 160), host: h });
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
    const msg = (data && ((data.error && (data.error.message || data.error.type)) || data.message || data.detail)) || ('HTTP ' + res.status);
    // 429 and 5xx are worth another try later; 4xx (bad key, bad model) are not
    throw new EngineError(String(msg).slice(0, 200), res.status, res.status === 429 || res.status >= 500);
  }
  return data || {};
}

/* ---- ChatGPT: OpenAI Responses API with the web_search tool ---- */
async function openai(prompt, opts) {
  const model = env('OPENAI_MODEL', 'gpt-6-luna');
  const tool = { type: 'web_search' };
  if (opts.country && /^[A-Z]{2}$/.test(opts.country)) tool.user_location = { type: 'approximate', country: opts.country };
  const body = { model, input: prompt, tools: [tool], include: ['web_search_call.action.sources'] };
  if (env('OPENAI_FORCE_SEARCH') === '1') body.tool_choice = 'required';
  const d = await post(base('OPENAI_API_BASE', 'https://api.openai.com') + '/v1/responses', { Authorization: 'Bearer ' + env('OPENAI_API_KEY') }, body, opts.timeoutMs);
  let text = '';
  const sources = [];
  const consulted = [];
  for (const item of d.output || []) {
    if (item.type === 'message') {
      for (const c of item.content || []) {
        if (c.type === 'output_text' || typeof c.text === 'string') {
          text += (text ? '\n' : '') + (c.text || '');
          for (const a of c.annotations || []) if (a.type === 'url_citation') addSource(sources, a.url, a.title);
        }
      }
    } else if (item.type === 'web_search_call' && item.action && Array.isArray(item.action.sources)) {
      for (const s of item.action.sources) if (s && s.url) addSource(consulted, s.url, s.title);
    }
  }
  if (!text && typeof d.output_text === 'string') text = d.output_text;
  return { text, sources, consulted, model: d.model || model };
}

/* ---- Perplexity: Sonar ---- */
async function perplexity(prompt, opts) {
  const model = env('PERPLEXITY_MODEL', 'sonar');
  const root = base('PERPLEXITY_API_BASE', 'https://api.perplexity.ai');
  const headers = { Authorization: 'Bearer ' + env('PERPLEXITY_API_KEY') };
  const body = { model, messages: [{ role: 'user', content: prompt }] };
  let d;
  try { d = await post(root + env('PERPLEXITY_PATH', '/v1/sonar'), headers, body, opts.timeoutMs); }
  catch (e) {
    if (e.status !== 404 || env('PERPLEXITY_PATH')) throw e;
    d = await post(root + '/chat/completions', headers, body, opts.timeoutMs); // older address
  }
  const ch = (d.choices && d.choices[0]) || {};
  const text = (ch.message && ch.message.content) || '';
  const sources = [];
  for (const r of d.search_results || []) addSource(sources, r.url, r.title);
  for (const u of d.citations || []) addSource(sources, typeof u === 'string' ? u : u && u.url, '');
  return { text: String(text), sources, consulted: [], model: d.model || model };
}

/* ---- Gemini: generateContent with Google Search grounding ---- */
async function gemini(prompt, opts) {
  const model = env('GEMINI_MODEL', 'gemini-3.8-flash');
  const d = await post(base('GEMINI_API_BASE', 'https://generativelanguage.googleapis.com') + `/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    { 'x-goog-api-key': env('GEMINI_API_KEY') },
    { contents: [{ role: 'user', parts: [{ text: prompt }] }], tools: [{ google_search: {} }] }, opts.timeoutMs);
  const cand = (d.candidates && d.candidates[0]) || {};
  const text = ((cand.content && cand.content.parts) || []).map((p) => p.text || '').join('');
  const sources = [];
  // Grounding links are Google redirect links; the title holds the source domain.
  for (const ch of (cand.groundingMetadata && cand.groundingMetadata.groundingChunks) || []) {
    const w = ch.web || {};
    const t = String(w.title || '').trim().toLowerCase();
    const host = /^[a-z0-9.-]+\.[a-z]{2,}$/.test(t) ? t.replace(/^www\./, '') : hostOf(w.uri);
    addSource(sources, w.uri || '', w.title || '', host);
  }
  return { text, sources, consulted: [], model: d.modelVersion || model };
}

/* ---- Claude: Messages API with the web search tool ---- */
async function claude(prompt, opts) {
  const model = env('ANTHROPIC_MODEL', 'claude-haiku-5-5');
  const d = await post(base('ANTHROPIC_API_BASE', 'https://api.anthropic.com') + '/v1/messages',
    { 'x-api-key': env('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01' },
    { model, max_tokens: 1200, messages: [{ role: 'user', content: prompt }], tools: [{ type: env('ANTHROPIC_SEARCH_TOOL', 'web_search_20250305'), name: 'web_search', max_uses: 3 }] }, opts.timeoutMs);
  let text = '';
  const sources = [];
  const consulted = [];
  for (const b of d.content || []) {
    if (b.type === 'text') {
      text += b.text || '';
      for (const c of b.citations || []) if (c.url) addSource(sources, c.url, c.title);
    } else if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
      for (const r of b.content) if (r && r.url) addSource(consulted, r.url, r.title);
    }
  }
  return { text, sources, consulted, model: d.model || model };
}

const RUN = { openai, perplexity, gemini, claude };

async function ask(engine, prompt, opts) {
  if (!RUN[engine]) throw new EngineError('unknown engine ' + engine, 0, false);
  if (!env(KEY[engine])) throw new EngineError(LABEL[engine] + ' is not set up', 0, false);
  const started = Date.now();
  const out = await RUN[engine](String(prompt).slice(0, 1000), opts || {});
  out.ms = Date.now() - started;
  out.text = String(out.text || '').trim();
  if (!out.text) throw new EngineError('empty answer', 0, true);
  return out;
}

module.exports = { ORDER, LABEL, PARALLEL, enabled, forLimits, ask, hostOf, EngineError };
