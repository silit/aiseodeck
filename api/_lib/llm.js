'use strict';
// Text generation for suggestions (prompt ideas, meta titles and descriptions, FAQ answers).
// Uses the first provider with a key that answers: OpenAI, then Gemini, then Anthropic. No web search here.

const alerts = require('./alerts');

const env = (k, d) => String(process.env[k] || d || '').trim();
const base = (k, d) => env(k, d).replace(/\/+$/, '');

function available() { return !!(env('OPENAI_API_KEY') || env('GEMINI_API_KEY') || env('ANTHROPIC_API_KEY')); }

async function post(url, headers, body, timeoutMs) {
  const res = await fetch(url, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers), body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs || 40000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error('AI provider: ' + String((data.error && data.error.message) || data.message || res.status).slice(0, 160)), { status: res.status });
  return data;
}

// A reply that stopped at the token limit (often spent on the model's own reasoning) is not usable: the next provider
// gets a turn. It is not an outage, so it raises no alert.
function cutShort(provider, reason) {
  return Object.assign(new Error('AI provider: reply cut short (' + (reason || 'incomplete') + ')'), { cutShort: true, provider });
}

// The writing providers in order. One that fails (a refused account, busy, an error) hands over to the next, so an
// empty balance at one provider does not stop the writing of fixes. generate() stops at a timeout; generateJSON() hands
// over while its time budget lasts.
const PROVIDERS = [
  { id: 'openai', key: 'OPENAI_API_KEY', async run({ system, prompt, maxTokens, timeoutMs }) {
    const d = await post(base('OPENAI_API_BASE', 'https://api.openai.com') + '/v1/responses', { Authorization: 'Bearer ' + env('OPENAI_API_KEY') },
      { model: env('OPENAI_GEN_MODEL', env('OPENAI_MODEL', 'gpt-6-luna')), instructions: system, input: prompt, max_output_tokens: maxTokens }, timeoutMs);
    if (d.status === 'incomplete') throw cutShort('openai', d.incomplete_details && d.incomplete_details.reason);
    let text = typeof d.output_text === 'string' ? d.output_text : '';
    if (!text) for (const item of d.output || []) if (item.type === 'message') for (const c of item.content || []) text += c.text || '';
    return text;
  } },
  { id: 'gemini', key: 'GEMINI_API_KEY', async run({ system, prompt, maxTokens, timeoutMs }) {
    const model = env('GEMINI_GEN_MODEL', env('GEMINI_MODEL', 'gemini-3.8-flash'));
    const d = await post(base('GEMINI_API_BASE', 'https://generativelanguage.googleapis.com') + `/v1beta/models/${encodeURIComponent(model)}:generateContent`, { 'x-goog-api-key': env('GEMINI_API_KEY') },
      { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: maxTokens } }, timeoutMs);
    const c = (d.candidates && d.candidates[0]) || {};
    if (c.finishReason === 'MAX_TOKENS') throw cutShort('gemini', 'max_tokens');
    return ((c.content && c.content.parts) || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
  } },
  { id: 'anthropic', key: 'ANTHROPIC_API_KEY', async run({ system, prompt, maxTokens, timeoutMs }) {
    const d = await post(base('ANTHROPIC_API_BASE', 'https://api.anthropic.com') + '/v1/messages', { 'x-api-key': env('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01' },
      { model: env('ANTHROPIC_GEN_MODEL', env('ANTHROPIC_MODEL', 'claude-haiku-5-5')), max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }] }, timeoutMs);
    if (d.stop_reason === 'max_tokens') throw cutShort('anthropic', 'max_tokens');
    return (d.content || []).map((b) => b.text || '').join('');
  } }
];

async function generate(opts) {
  const o = Object.assign({}, opts, { maxTokens: (opts && opts.maxTokens) || 900 });
  const list = PROVIDERS.filter((p) => env(p.key));
  if (!list.length) throw new Error('No AI provider is set up.');
  let last = null;
  for (const p of list) {
    try { return await p.run(o); } catch (e) {
      last = e;
      if (e.cutShort) continue;
      if ((await alerts.report(p.id, e, 'writing fixes and suggestions')) === 'timeout') break;
    }
  }
  throw last;
}

// The first JSON object or array in a model reply (models sometimes wrap it in a code fence).
function parseJSON(text) {
  const s = String(text || '');
  const start = s.search(/[[{]/);
  if (start < 0) return null;
  for (let end = s.length; end > start; end--) {
    const ch = s[end - 1];
    if (ch !== '}' && ch !== ']') continue;
    try { return JSON.parse(s.slice(start, end)); } catch (e) { /* shorter */ }
  }
  return null;
}

const UNREADABLE = 'The AI reply could not be read. Try again.';

// JSON from the first provider whose reply parses. The token limit leaves room for reasoning models, which spend part
// of it before they write; a reply that is cut short or is not JSON hands over to the next provider.
// budgetMs caps the whole call, every provider included, so a page that waits for it stays inside the 60 second
// function limit. Each provider gets at most 30 seconds of it.
async function generateJSON(opts) {
  const deadline = Date.now() + ((opts && opts.budgetMs) || 40000);
  const o = Object.assign({}, opts, {
    system: opts.system + '\nReply with JSON only, no prose, no code fence.',
    maxTokens: Math.max(4000, ((opts && opts.maxTokens) || 900) * 4)
  });
  const list = PROVIDERS.filter((p) => env(p.key));
  if (!list.length) throw new Error('No AI provider is set up.');
  let last = null;
  for (const p of list) {
    const left = deadline - Date.now();
    if (last && left < 6000) break; // the first provider always gets its turn
    let text;
    try { text = await p.run(Object.assign({}, o, { timeoutMs: Math.max(1000, Math.min((opts && opts.timeoutMs) || 30000, left)) })); } catch (e) {
      last = e.cutShort ? Object.assign(new Error(UNREADABLE), { public: true }) : e;
      if (!e.cutShort) await alerts.report(p.id, e, 'writing fixes and suggestions');
      continue; // the next provider, while the budget lasts
    }
    const j = parseJSON(text);
    if (j != null) return j;
    last = Object.assign(new Error(UNREADABLE), { public: true });
  }
  throw last || Object.assign(new Error(UNREADABLE), { public: true });
}

module.exports = { available, generate, generateJSON, parseJSON };
