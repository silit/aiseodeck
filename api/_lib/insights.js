'use strict';
// Extra findings for a finished run: questions where rivals are named and the brand is not (gaps),
// and how the AI answers describe the brand (sentiment, descriptors, statements worth checking).
const llm = require('./llm');

const clean = (t, n) => String(t || '').replace(/[–—]/g, ', ').replace(/\s+/g, ' ').trim().slice(0, n);

// res: { "promptId|engine": result }. Sorted by how many engines name a rival instead of the brand.
function gaps(run, res) {
  const out = [];
  for (const p of run.prompts || []) {
    const engines = [];
    const rivals = {};
    let named = 0, answered = 0;
    for (const e of run.engines || []) {
      const r = res[p.id + '|' + e];
      if (!r || !r.ok || r.none) continue;
      answered++;
      if (r.mentioned) { named++; continue; }
      const who = Object.entries(r.comp || {}).filter(([, v]) => v && v.m).map(([k]) => k);
      if (who.length) { engines.push(e); for (const w of who) rivals[w] = (rivals[w] || 0) + 1; }
    }
    if (engines.length) out.push({ p: p.id, text: p.text, engines, rivals: Object.entries(rivals).sort((a, b) => b[1] - a[1]).map(([name]) => name).slice(0, 3), named, answered });
  }
  return out.sort((a, b) => b.engines.length - a.engines.length || a.named - b.named).slice(0, 15);
}

// One short AI call per run, on the answers that name the brand.
async function describe(run, results) {
  const named = results.filter((r) => r && r.ok && !r.none && r.mentioned && r.snippet).slice(0, 24);
  if (!named.length || !llm.available()) return null;
  const brand = run.project.brand;
  const j = await llm.generateJSON({
    system: 'You analyse what AI assistants say about a brand. Only use what the excerpts say. Never invent. No em dashes.',
    prompt: `Brand: ${brand}\nExcerpts from AI answers that mention the brand:\n` + named.map((r, i) => `${i + 1}. ${clean(r.snippet, 400)}`).join('\n') +
      `\n\nReturn {"sentiment": [one of "positive", "neutral" or "negative" for each excerpt, in order], "descriptors": [up to 8 short phrases of 1 to 4 words that the excerpts use for ${brand}], "check": [up to 3 specific factual statements about ${brand} in the excerpts that the owner should verify, such as prices, locations, hours or features]}`,
    maxTokens: 700,
    timeoutMs: 20000
  });
  const count = { positive: 0, neutral: 0, negative: 0 };
  for (const x of (Array.isArray(j.sentiment) ? j.sentiment : []).slice(0, named.length)) { const k = String(x).toLowerCase(); if (k in count) count[k]++; }
  return {
    sentiment: count,
    descriptors: (Array.isArray(j.descriptors) ? j.descriptors : []).map((d) => clean(d, 40)).filter(Boolean).slice(0, 8),
    check: (Array.isArray(j.check) ? j.check : []).map((d) => clean(d, 220)).filter(Boolean).slice(0, 3),
    basedOn: named.length
  };
}

module.exports = { gaps, describe };
