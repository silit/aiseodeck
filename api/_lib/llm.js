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

// The writing providers in order. One that fails fast (a refused account, busy, an error) hands over to the next, so an
// empty balance at one provider does not stop the writing of fixes. A timeout does not hand over: no time is left.
const PROVIDERS = [
  { id: 'openai', key: 'OPENAI_API_KEY', async run({ system, prompt, maxTokens, timeoutMs }) {
    const d = await post(base('OPENAI_API_BASE', 'https://api.openai.com') + '/v1/responses', { Authorization: 'Bearer ' + env('OPENAI_API_KEY') },
      { model: env('OPENAI_GEN_MODEL', env('OPENAI_MODEL', 'gpt-6-luna')), instructions: system, input: prompt, max_output_tokens: maxTokens }, timeoutMs);
    let text = typeof d.output_text === 'string' ? d.output_text : '';
    if (!text) for (const item of d.output || []) if (item.type === 'message') for (const c of item.content || []) text += c.text || '';
    return text;
  } },
  { id: 'gemini', key: 'GEMINI_API_KEY', async run({ system, prompt, maxTokens, timeoutMs }) {
    const model = env('GEMINI_GEN_MODEL', env('GEMINI_MODEL', 'gemini-3.8-flash'));
    const d = await post(base('GEMINI_API_BASE', 'https://generativelanguage.googleapis.com') + `/v1beta/models/${encodeURIComponent(model)}:generateContent`, { 'x-goog-api-key': env('GEMINI_API_KEY') },
      { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: maxTokens } }, timeoutMs);
    const c = (d.candidates && d.candidates[0]) || {};
    return ((c.content && c.content.parts) || []).map((p) => p.text || '').join('');
  } },
  { id: 'anthropic', key: 'ANTHROPIC_API_KEY', async run({ system, prompt, maxTokens, timeoutMs }) {
    const d = await post(base('ANTHROPIC_API_BASE', 'https://api.anthropic.com') + '/v1/messages', { 'x-api-key': env('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01' },
      { model: env('ANTHROPIC_GEN_MODEL', env('ANTHROPIC_MODEL', 'claude-haiku-5-5')), max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }] }, timeoutMs);
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

async function generateJSON(opts) {
  const text = await generate(Object.assign({}, opts, { system: opts.system + '\nReply with JSON only, no prose, no code fence.' }));
  const j = parseJSON(text);
  if (j == null) throw Object.assign(new Error('The AI reply could not be read. Try again.'), { public: true });
  return j;
}

module.exports = { available, generate, generateJSON, parseJSON };
