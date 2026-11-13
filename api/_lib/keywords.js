'use strict';
// Keywords: cleaning, matching a keyword to the best page of a site, and keyword data from DataForSEO Labs
// (monthly search volumes, related keywords, and the keywords where Google's AI Overviews already cite a domain).
// Labs calls cost about 1.2 cents each plus 0.012 cents per returned keyword, from the same DataForSEO balance.
const { LOCATION } = require('./engines');

const env = (k, d) => String(process.env[k] || d || '').trim();
const base = () => env('DATAFORSEO_API_BASE', 'https://api.dataforseo.com').replace(/\/+$/, '');

function available() { return !!(env('DATAFORSEO_LOGIN') && env('DATAFORSEO_PASSWORD')); }

/* ---------- cleaning ---------- */

// "  Webflow Agency in London? " -> "webflow agency in london". Turkish dotted and dotless i are lowercased correctly.
function clean(text) {
  let t = String(text || '').replace(/[İ]/g, 'i').replace(/I/g, 'i');
  t = t.toLocaleLowerCase('en').replace(/[“”"'`´]/g, '').replace(/\s+/g, ' ').trim();
  t = t.replace(/[?!.,;:]+$/g, '').replace(/^[#\-*•\s]+/, '').trim().slice(0, 80).trim();
  return t.length >= 2 ? t : '';
}
function cleanList(lines, max) {
  const out = [];
  for (const l of lines || []) {
    const k = clean(l);
    if (k && !out.includes(k)) out.push(k);
    if (max && out.length >= max) break;
  }
  return out;
}

/* ---------- matching a keyword to a page ---------- */

const STOP = new Set(('a an the and or of for in on at to by with from your our my is are be how what which who best top near me vs versus ' +
  'ile ve veya icin için en iyi bir bu da de mi mı nasıl nedir fiyat fiyatları').split(' '));
function tokens(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i')
    .split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w));
}
// A light stem so "agencies" matches "agency" and "templates" matches "template".
const stem = (w) => w.replace(/(ies|es|s)$/, (m) => (m === 'ies' ? 'y' : '')).slice(0, 12);

// pages: audit rows ({ path, title, description, h1, name, pageId, template, noindex, ok }).
// Returns { path, pageId, score (0..1), static } for the best page, or null when nothing fits.
function matchPage(keyword, pages) {
  const want = [...new Set(tokens(keyword).map(stem))];
  if (!want.length) return null;
  let best = null;
  for (const p of pages || []) {
    if (!p || p.ok === false || p.noindex || p.error) continue;
    const fields = [
      [tokens(p.path.replace(/\//g, ' ')), 3],
      [tokens(p.title), 3],
      [tokens((p.h1 || []).join(' ')), 2],
      [tokens(p.description), 1],
      [tokens(p.name), 1]
    ];
    let score = 0;
    for (const w of want) {
      let hit = 0;
      for (const [list, weight] of fields) if (list.some((t) => stem(t) === w)) hit = Math.max(hit, weight);
      score += hit;
    }
    const norm = score / (want.length * 3);
    // the homepage only wins when nothing else matches as well
    const adj = p.path === '/' ? norm - 0.05 : norm;
    if (!best || adj > best.adj) best = { path: p.path, pageId: p.pageId || '', static: !!p.pageId, score: Math.round(norm * 100) / 100, adj };
  }
  if (!best || best.score < 0.34) return null;
  delete best.adj;
  return best;
}

/* ---------- DataForSEO Labs ---------- */

function where(country, language) {
  return { location_code: LOCATION[country] || 2840, language_code: /^[a-z]{2}$/.test(language || '') ? language : 'en' };
}
async function labs(path, task, timeoutMs) {
  let res;
  try {
    res = await fetch(base() + '/v3/dataforseo_labs/google/' + path + '/live', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(env('DATAFORSEO_LOGIN') + ':' + env('DATAFORSEO_PASSWORD')).toString('base64') },
      body: JSON.stringify([task]),
      signal: AbortSignal.timeout(timeoutMs || 20000)
    });
  } catch (e) { throw new Error(e.name === 'TimeoutError' ? 'Keyword data timed out' : 'Keyword data could not be reached'); }
  const d = await res.json().catch(() => ({}));
  const t = (d.tasks && d.tasks[0]) || {};
  if (!res.ok || t.status_code !== 20000) throw new Error('Keyword data: ' + String(t.status_message || d.status_message || res.status).slice(0, 140));
  return (t.result && t.result[0]) || {};
}
const vol = (info) => (info && typeof info.search_volume === 'number' ? info.search_volume : null);

// Monthly searches for up to 700 keywords: { keyword: { volume, intent } }
async function volumes(list, country, language) {
  const kws = cleanList(list, 700);
  if (!kws.length) return {};
  const r = await labs('keyword_overview', Object.assign({ keywords: kws }, where(country, language)));
  const out = {};
  for (const it of r.items || []) {
    if (!it || !it.keyword) continue;
    out[clean(it.keyword)] = { volume: vol(it.keyword_info), intent: (it.search_intent_info && it.search_intent_info.main_intent) || '' };
  }
  return out;
}

// Keywords where Google's AI Overviews cite the domain, most searched first.
async function inAiOverviews(domain, country, language, limit) {
  const target = String(domain || '').replace(/^[a-z]+:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '');
  if (!target) return [];
  const r = await labs('ranked_keywords', Object.assign({ target, item_types: ['ai_overview_reference'], limit: Math.min(limit || 50, 200), order_by: ['keyword_data.keyword_info.search_volume,desc'] }, where(country, language)));
  const out = [];
  for (const it of r.items || []) {
    const kd = it && it.keyword_data;
    const k = kd && clean(kd.keyword);
    if (!k || out.some((x) => x.keyword === k)) continue;
    const si = (it.ranked_serp_element && it.ranked_serp_element.serp_item) || {};
    out.push({ keyword: k, volume: vol(kd.keyword_info), url: String(si.url || si.source_url || '').slice(0, 300) });
  }
  return out;
}

// Searches related to a keyword (Google's "related searches", one level deep), most searched first.
async function related(seed, country, language, limit) {
  const keyword = clean(seed);
  if (!keyword) return [];
  const r = await labs('related_keywords', Object.assign({ keyword, depth: 1, limit: Math.min(limit || 20, 100) }, where(country, language)));
  const out = [];
  for (const it of r.items || []) {
    const kd = it && it.keyword_data;
    const k = kd && clean(kd.keyword);
    if (k && k !== keyword && !out.some((x) => x.keyword === k)) out.push({ keyword: k, volume: vol(kd.keyword_info) });
  }
  return out.sort((a, b) => (b.volume || 0) - (a.volume || 0));
}

module.exports = { available, clean, cleanList, tokens, matchPage, volumes, inAiOverviews, related, where };
