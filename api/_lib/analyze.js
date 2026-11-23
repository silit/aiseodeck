'use strict';
// Reads an AI answer for a project: is the brand mentioned, where, is its website cited, which competitors
// show up and which websites the engine relied on. Matching ignores case, accents and punctuation
// ("Brightline Studio", "brightline-studio", "BrightlineStudio" and an all caps spelling with Turkish dotted letters all match).

// Lowercase, accents removed, everything that is not a letter or digit turned into one space.
// map[i] is the index in the original text of normalized character i (for snippets).
function normMap(s) {
  s = String(s || '');
  let out = '';
  const map = [];
  let space = true;
  for (let i = 0; i < s.length; i++) {
    let n = s[i] === 'ı' ? 'i' : s[i].normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
    for (const ch of n) {
      if (/[\p{L}\p{N}]/u.test(ch)) { out += ch; map.push(i); space = false; }
      else if (!space) { out += ' '; map.push(i); space = true; }
    }
  }
  return { out, map };
}
const norm = (s) => normMap(s).out.trim();

// First position of a term in normalized text, as a whole word or phrase; -1 when absent.
function findTerm(textNorm, term) {
  const t = norm(term);
  if (t.length < 2) return -1;
  const hay = ' ' + textNorm + ' ';
  let best = -1;
  const tryOne = (needle) => {
    const i = hay.indexOf(' ' + needle + ' ');
    if (i >= 0 && (best < 0 || i < best)) best = i;
  };
  tryOne(t);
  const compact = t.replace(/ /g, '');
  if (compact !== t && compact.length >= 4) tryOne(compact); // "brightline studio" also finds "brightlinestudio"
  return best; // index in textNorm (the leading space of hay shifts by one, the match starts after it)
}

function cleanDomain(d) {
  return String(d || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '');
}
function hostMatches(host, domains) {
  const h = cleanDomain(host);
  return !!h && domains.some((d) => d && (h === d || h.endsWith('.' + d)));
}

// entity: { name, aliases: [], domains: [] }
function detect(entity, textNorm, sources) {
  const terms = [entity.name].concat(entity.aliases || []).filter((x) => String(x || '').trim().length >= 2);
  let index = -1;
  for (const t of terms) {
    const i = findTerm(textNorm, t);
    if (i >= 0 && (index < 0 || i < index)) index = i;
  }
  const domains = (entity.domains || []).map(cleanDomain).filter(Boolean);
  const citedUrls = (sources || []).filter((s) => hostMatches(s.host || s.url, domains)).map((s) => s.url || s.host);
  // A domain written in the answer text ("visit brightline.com") counts as a mention too
  if (index < 0) for (const d of domains) { const i = findTerm(textNorm, d); if (i >= 0 && (index < 0 || i < index)) index = i; }
  return { mentioned: index >= 0, index, cited: citedUrls.length > 0, citedUrls: citedUrls.slice(0, 5) };
}

function snippetAt(text, mapIndex, map) {
  const t = String(text || '');
  if (!t) return '';
  if (mapIndex == null || mapIndex < 0) return t.slice(0, 280).trim() + (t.length > 280 ? '…' : '');
  const at = map[Math.min(mapIndex, map.length - 1)] || 0;
  let from = Math.max(0, at - 120);
  let to = Math.min(t.length, at + 200);
  if (from > 0) { const sp = t.indexOf(' ', from); if (sp > 0 && sp < at) from = sp + 1; }
  if (to < t.length) { const sp = t.lastIndexOf(' ', to); if (sp > at) to = sp; }
  return (from > 0 ? '…' : '') + t.slice(from, to).trim() + (to < t.length ? '…' : '');
}

// project: { brand, aliases, domains, competitors: [{ name, domain }] }
// answer: { text, sources: [{ url, title, host }] }
function analyzeAnswer(project, answer) {
  const { out: textNorm, map } = normMap(answer.text);
  const brand = { name: project.brand, aliases: project.aliases || [], domains: project.domains || [] };
  const b = detect(brand, textNorm, answer.sources);
  const comps = {};
  const order = [];
  if (b.mentioned) order.push({ key: '', index: b.index });
  for (const c of project.competitors || []) {
    if (!c || !c.name) continue;
    const r = detect({ name: c.name, aliases: c.aliases || [], domains: c.domain ? [c.domain] : [] }, textNorm, answer.sources);
    comps[c.name] = { m: r.mentioned, c: r.cited };
    if (r.mentioned) order.push({ key: c.name, index: r.index });
  }
  order.sort((x, y) => x.index - y.index);
  const rank = b.mentioned ? order.findIndex((o) => o.key === '') + 1 : 0;
  const own = (project.domains || []).map(cleanDomain).filter(Boolean);
  const hosts = [];
  for (const s of answer.sources || []) {
    const h = cleanDomain(s.host || s.url);
    if (h && !hosts.includes(h)) hosts.push(h);
  }
  return {
    mentioned: b.mentioned,
    rank, // 1 = the first brand named among the tracked ones
    of: order.length,
    cited: b.cited,
    citedUrls: b.citedUrls,
    comp: comps,
    hosts: hosts.slice(0, 15),
    ownHosts: hosts.filter((h) => hostMatches(h, own)).length,
    snippet: snippetAt(answer.text, b.mentioned ? b.index : -1, map),
    sources: (answer.sources || []).slice(0, 10).map((s) => ({ url: s.url, title: s.title, host: cleanDomain(s.host || s.url) }))
  };
}

// One run's results -> the numbers on the dashboard.
// results: [{ p: promptId, e: engine, ok, mentioned, rank, cited, comp, hosts }]
function summarize(project, results) {
  const all = results.filter(Boolean);
  const ok = all.filter((r) => r.ok && !r.none);
  const none = all.filter((r) => r.ok && r.none);
  const n = ok.length;
  const m = ok.filter((r) => r.mentioned).length;
  const c = ok.filter((r) => r.cited).length;
  const rankSum = ok.reduce((a, r) => a + (r.mentioned && r.rank ? 1 / r.rank : 0), 0);
  const ranks = ok.filter((r) => r.mentioned && r.rank).map((r) => r.rank);
  const mentionRate = n ? m / n : 0;
  const citationRate = n ? c / n : 0;
  const rankScore = n ? rankSum / n : 0;
  const byEngine = {};
  for (const r of ok) {
    const e = (byEngine[r.e] = byEngine[r.e] || { n: 0, m: 0, c: 0, na: 0 });
    e.n++; if (r.mentioned) e.m++; if (r.cited) e.c++;
  }
  for (const r of none) (byEngine[r.e] = byEngine[r.e] || { n: 0, m: 0, c: 0, na: 0 }).na++;
  // Share of voice: of all answers naming any tracked brand, how many name each one
  const voice = [{ name: project.brand, own: true, n: m }];
  for (const comp of project.competitors || []) {
    if (!comp || !comp.name) continue;
    voice.push({ name: comp.name, own: false, n: ok.filter((r) => r.comp && r.comp[comp.name] && r.comp[comp.name].m).length });
  }
  const voiceTotal = voice.reduce((a, v) => a + v.n, 0);
  for (const v of voice) v.share = voiceTotal ? v.n / voiceTotal : 0;
  voice.sort((a, b) => b.n - a.n || (a.own ? -1 : 1));
  // Websites the engines cite for these questions (the brand's own excluded): outreach targets
  const own = (project.domains || []).map(cleanDomain).filter(Boolean);
  const hostCount = {};
  for (const r of ok) for (const h of r.hosts || []) if (!hostMatches(h, own)) hostCount[h] = (hostCount[h] || 0) + 1;
  const topHosts = Object.entries(hostCount).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([host, k]) => ({ host, n: k }));
  // What the engines searched for to answer (query fan-out) and which of the brand's own pages they cite
  const qCount = {};
  for (const r of ok) for (const q of r.queries || []) { const k = String(q).toLowerCase(); qCount[k] = qCount[k] || { q, n: 0 }; qCount[k].n++; }
  const topQueries = Object.values(qCount).sort((a, b) => b.n - a.n).slice(0, 15);
  const uCount = {};
  for (const r of ok) for (const u of r.citedUrls || []) { const k = String(u).replace(/[?#].*$/, '').replace(/\/+$/, ''); uCount[k] = (uCount[k] || 0) + 1; }
  const ownCited = Object.entries(uCount).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([url, k]) => ({ url, n: k }));
  return {
    total: all.length,
    ok: n,
    none: none.length,
    failed: all.length - n - none.length,
    topQueries,
    ownCited,
    mentionRate,
    citationRate,
    avgRank: ranks.length ? ranks.reduce((a, x) => a + x, 0) / ranks.length : null,
    score: Math.round(100 * (0.5 * mentionRate + 0.3 * citationRate + 0.2 * rankScore)),
    byEngine,
    voice,
    topHosts
  };
}

/* ---------- keywords ---------- */

// The state of one engine for one keyword, as one letter (the deck's dots):
// b named and cited, n named, i cited only, o answered without naming you, x Google showed no AI answer, f could not be read.
const STATE_ORDER = ['b', 'n', 'i', 'o', 'x', 'f'];
const topEntries = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, n);

// rows: every result of one keyword in one run ({ e, ok, none, mentioned, cited, rank, comp, hosts, queries, citedUrls }).
function keywordSummary(project, engines, rows) {
  const ownDomains = (project.domains || []).map(cleanDomain).filter(Boolean);
  const eng = {};
  const lost = {};
  const rivals = {}, hosts = {}, queries = {}, own = {};
  const ranks = [];
  let n = 0, m = 0, c = 0, na = 0, f = 0;
  for (const e of engines) {
    const rs = rows.filter((r) => r && r.e === e);
    if (!rs.length) continue;
    const ok = rs.filter((r) => r.ok && !r.none);
    const named = ok.filter((r) => r.mentioned).length;
    const cited = ok.filter((r) => r.cited).length;
    na += rs.filter((r) => r.ok && r.none).length;
    f += rs.filter((r) => !r.ok).length;
    n += ok.length; m += named; c += cited;
    eng[e] = !ok.length ? (rs.some((r) => r.ok && r.none) ? 'x' : 'f') : named && cited ? 'b' : named ? 'n' : cited ? 'i' : 'o';
    const lostTo = {};
    for (const r of ok) {
      if (r.mentioned && r.rank) ranks.push(r.rank);
      for (const [name, v] of Object.entries(r.comp || {})) if (v && v.m) { rivals[name] = (rivals[name] || 0) + 1; if (!r.mentioned) lostTo[name] = (lostTo[name] || 0) + 1; }
      for (const h of r.hosts || []) if (!hostMatches(h, ownDomains)) hosts[h] = (hosts[h] || 0) + 1;
      for (const q of r.queries || []) { const k = String(q).toLowerCase().replace(/\s+/g, ' ').trim(); if (k) queries[k] = (queries[k] || 0) + 1; }
      for (const u of r.citedUrls || []) { const k = String(u).replace(/[?#].*$/, '').replace(/\/+$/, ''); if (k) own[k] = (own[k] || 0) + 1; }
    }
    if (!named && Object.keys(lostTo).length) lost[e] = topEntries(lostTo, 3).map(([name]) => name);
  }
  return {
    n, m, c, na, f,
    vis: n ? m / n : 0,
    rank: ranks.length ? Math.round((ranks.reduce((a, x) => a + x, 0) / ranks.length) * 10) / 10 : null,
    eng,
    lost,
    rivals: topEntries(rivals, 5),
    hosts: topEntries(hosts, 8),
    queries: topEntries(queries, 10).map(([q]) => q),
    own: topEntries(own, 5)
  };
}

// Engines that name the brand for a keyword, and how many answered at all.
function engineCounts(sum) {
  const states = Object.values((sum && sum.eng) || {});
  return { named: states.filter((s) => s === 'b' || s === 'n').length, answered: states.filter((s) => s !== 'x' && s !== 'f').length, checked: states.length };
}
// "yes" when most engines that answered name you, "some" when at least one does, "no" otherwise.
function verdict(sum) {
  const k = engineCounts(sum);
  if (!sum || !k.answered) return 'none';
  if (k.named * 2 > k.answered) return 'yes';
  return k.named ? 'some' : 'no';
}

// Adds up the latest summary of every keyword into the site's numbers.
// keywords: [{ id, text }], kw: { [id]: keywordSummary + { at, runId, trend } }
function siteSummary(project, keywords, kw) {
  let n = 0, m = 0, c = 0, na = 0, f = 0, rankSum = 0, rankN = 0, measured = 0, kwNamed = 0;
  const byEngine = {}, voice = { [project.brand]: 0 }, hosts = {}, queries = {}, own = {};
  for (const r of project.competitors || []) if (r && r.name) voice[r.name] = 0;
  for (const k of keywords || []) {
    const s = kw && kw[k.id];
    if (!s) continue;
    measured++;
    n += s.n || 0; m += s.m || 0; c += s.c || 0; na += s.na || 0; f += s.f || 0;
    if (s.m) kwNamed++;
    if (s.rank && s.m) { rankSum += s.rank * s.m; rankN += s.m; }
    voice[project.brand] += s.m || 0;
    for (const [name, x] of s.rivals || []) if (name in voice) voice[name] += x;
    for (const [h, x] of s.hosts || []) hosts[h] = (hosts[h] || 0) + x;
    for (const q of s.queries || []) queries[q] = (queries[q] || 0) + 1;
    for (const [u, x] of s.own || []) own[u] = (own[u] || 0) + x;
    for (const [e, st] of Object.entries(s.eng || {})) {
      const b = (byEngine[e] = byEngine[e] || { k: 0, km: 0, kc: 0, kx: 0 });
      if (st === 'x' || st === 'f') { if (st === 'x') b.kx++; continue; }
      b.k++;
      if (st === 'b' || st === 'n') b.km++;
      if (st === 'b' || st === 'i') b.kc++;
    }
  }
  const voiceList = Object.entries(voice).map(([name, x]) => ({ name, own: name === project.brand, n: x }));
  const vt = voiceList.reduce((a, v) => a + v.n, 0);
  for (const v of voiceList) v.share = vt ? v.n / vt : 0;
  voiceList.sort((a, b) => b.n - a.n || (a.own ? -1 : 1));
  return {
    keywords: measured,
    kwNamed,
    ok: n,
    total: n + na + f,
    none: na,
    failed: f,
    mentionRate: n ? m / n : 0,
    citationRate: n ? c / n : 0,
    score: n ? Math.round((100 * m) / n) : 0,
    avgRank: rankN ? Math.round((rankSum / rankN) * 10) / 10 : null,
    byEngine,
    voice: voiceList,
    topHosts: topEntries(hosts, 15).map(([host, x]) => ({ host, n: x })),
    topQueries: topEntries(queries, 15).map(([q, x]) => ({ q, n: x })),
    ownCited: topEntries(own, 10).map(([url, x]) => ({ url, n: x }))
  };
}

module.exports = { norm, normMap, findTerm, cleanDomain, hostMatches, detect, analyzeAnswer, summarize, snippetAt, keywordSummary, siteSummary, engineCounts, verdict, STATE_ORDER };
