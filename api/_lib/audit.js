'use strict';
// AEO site audit: reads the live pages and the files AI crawlers look at, and lists what keeps
// answer engines from understanding or citing the site. No storage here.
const fetcher = require('./fetcher');

/* ---------- tiny HTML reading (no dependencies) ---------- */

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
function decode(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
    return ENT[e.toLowerCase()] != null ? ENT[e.toLowerCase()] : m;
  });
}
const stripTags = (h) => decode(String(h || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

// The HTML without what is never page text: comments, and scripts, styles, noscript, SVG and templates
// with all they hold. They are taken out in the order a browser meets them, so what starts first wins:
// a "<!--" inside a script is not a comment, and a "<script" inside a comment is not a script. One that
// is never closed runs to the end of the page, as it does in a browser.
const HIDDEN_END = {};
for (const tag of ['script', 'style', 'noscript', 'svg', 'template']) HIDDEN_END[tag] = new RegExp('</' + tag + '\\s*>', 'gi');
function visibleHtml(html) {
  html = String(html || '');
  const start = /<!--|<(script|style|noscript|svg|template)\b/gi;
  let out = '', at = 0, m;
  while ((m = start.exec(html))) {
    let end;
    if (m[1]) {
      const close = HIDDEN_END[m[1].toLowerCase()];
      close.lastIndex = start.lastIndex;
      const c = close.exec(html);
      end = c ? c.index + c[0].length : html.length;
    } else {
      const c = html.indexOf('-->', m.index + 4);
      end = c < 0 ? html.length : c + 3;
    }
    out += html.slice(at, m.index) + ' ';
    at = end;
    start.lastIndex = end;
  }
  return out + html.slice(at);
}
function attrs(tag) {
  const out = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  const inner = tag.replace(/^<\s*[a-zA-Z0-9]+/, '').replace(/\/?>$/, '');
  let m;
  while ((m = re.exec(inner))) out[m[1].toLowerCase()] = decode(m[3] != null ? m[3] : m[4] != null ? m[4] : m[5] != null ? m[5] : '');
  return out;
}
function schemaTypes(node, out) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach((n) => schemaTypes(n, out)); return out; }
  const t = node['@type'];
  (Array.isArray(t) ? t : t ? [t] : []).forEach((x) => { if (typeof x === 'string' && !out.includes(x)) out.push(x); });
  if (node['@graph']) schemaTypes(node['@graph'], out);
  for (const k of ['mainEntity', 'itemListElement']) if (node[k] && typeof node[k] === 'object') schemaTypes(node[k], out);
  return out;
}

const SOCIAL = /^https?:\/\/(www\.)?(facebook\.com|instagram\.com|linkedin\.com|x\.com|twitter\.com|youtube\.com|tiktok\.com|pinterest\.com|threads\.net)\/[^\s"'<>]+/i;

function readPage(html) {
  html = String(html || '');
  const head = (html.match(/<head\b[\s\S]*?<\/head>/i) || [html])[0];
  const out = { title: '', description: '', robots: '', canonical: '', lang: '', og: {}, h1: [], headings: [], schema: [], schemaTypes: [], schemaErrors: 0, words: 0, images: 0, imagesNoAlt: 0, faq: [], socials: [], icon: '' };
  const t = head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  out.title = t ? stripTags(t[1]) : '';
  const lang = html.match(/<html\b[^>]*>/i);
  out.lang = lang ? (attrs(lang[0]).lang || '') : '';
  for (const m of head.match(/<meta\b[^>]*>/gi) || []) {
    const a = attrs(m);
    const key = (a.name || a.property || '').toLowerCase();
    if (key === 'description') out.description = a.content || '';
    else if (key === 'robots') out.robots = (a.content || '').toLowerCase();
    else if (key.startsWith('og:')) out.og[key.slice(3)] = a.content || '';
  }
  for (const m of head.match(/<link\b[^>]*>/gi) || []) {
    const a = attrs(m);
    const rel = (a.rel || '').toLowerCase();
    if (rel === 'canonical') out.canonical = a.href || '';
    if (!out.icon && /(^|\s)(icon|apple-touch-icon)(\s|$)/.test(rel) && a.href) out.icon = a.href;
  }
  // JSON-LD blocks anywhere on the page
  const ldRe = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = ldRe.exec(html))) {
    const raw = m[1].replace(/^\s*<!--|-->\s*$/g, '').replace(/^\s*\/\/<!\[CDATA\[|\/\/\]\]>\s*$/g, '').trim();
    try { const j = JSON.parse(raw); out.schema.push(j); schemaTypes(j, out.schemaTypes); } catch (e) { out.schemaErrors++; }
  }
  // Body text and headings. Scripts, styles and comments go first, and only then is the body looked for:
  // a "<body" written inside a stylesheet or a script in the head is not where the body starts.
  const seen = visibleHtml(html);
  const bodyHtml = (seen.match(/<body\b[\s\S]*<\/body>/i) || [seen])[0];
  const hRe = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  const marks = [];
  while ((m = hRe.exec(bodyHtml))) {
    const text = stripTags(m[2]);
    if (!text) continue;
    if (m[1] === '1') out.h1.push(text);
    out.headings.push({ level: +m[1], text: text.slice(0, 200) });
    marks.push({ level: +m[1], text, start: m.index, end: m.index + m[0].length });
  }
  const text = stripTags(bodyHtml);
  out.words = text ? text.split(/\s+/).length : 0;
  out.text = text.slice(0, 6000);
  for (const img of bodyHtml.match(/<img\b[^>]*>/gi) || []) { out.images++; if (!('alt' in attrs(img))) out.imagesNoAlt++; }
  // Questions answered on the page: a heading that asks something, and the text under it
  for (let i = 0; i < marks.length; i++) {
    const q = marks[i];
    if (q.level < 2 || !/\?\s*$/.test(q.text)) continue;
    const next = marks[i + 1] ? marks[i + 1].start : Math.min(bodyHtml.length, q.end + 4000);
    const a = stripTags(bodyHtml.slice(q.end, next)).slice(0, 700);
    if (a.length >= 20) out.faq.push({ q: q.text.slice(0, 200), a });
  }
  // <details><summary>Question?</summary> answer </details> accordions
  const detRe = /<details\b[^>]*>\s*<summary\b[^>]*>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/gi;
  while ((m = detRe.exec(bodyHtml))) {
    const q = stripTags(m[1]); const a = stripTags(m[2]).slice(0, 700);
    if (q && a.length >= 20 && !out.faq.some((f) => f.q === q)) out.faq.push({ q: q.slice(0, 200), a });
  }
  out.faq = out.faq.slice(0, 20);
  for (const href of html.match(/href\s*=\s*["']([^"']+)["']/gi) || []) {
    const u = href.replace(/^href\s*=\s*["']|["']$/gi, '');
    if (SOCIAL.test(u)) { const clean = u.split(/[?#]/)[0].replace(/\/+$/, ''); if (!out.socials.includes(clean)) out.socials.push(clean); }
  }
  out.socials = out.socials.slice(0, 8);
  return out;
}

/* ---------- checks ---------- */

const PAGE_RULES = {
  title_missing: { w: 15, text: 'No page title' },
  title_length: { w: 5, text: 'Title is shorter than 20 or longer than 65 characters' },
  desc_missing: { w: 15, text: 'No meta description' },
  desc_length: { w: 5, text: 'Meta description is shorter than 60 or longer than 165 characters' },
  h1_missing: { w: 10, text: 'No H1 heading' },
  h1_multiple: { w: 4, text: 'More than one H1 heading' },
  schema_missing: { w: 15, text: 'No structured data (JSON-LD), so AI engines have to guess what the page is about' },
  schema_invalid: { w: 10, text: 'A JSON-LD block is not valid JSON' },
  faq_no_schema: { w: 10, text: 'Questions are answered on the page but there is no FAQPage schema' },
  og_missing: { w: 5, text: 'Open Graph title, description or image is missing' },
  thin: { w: 8, text: 'Less than 300 words: little for an AI engine to quote' },
  alt_missing: { w: 4, text: 'Images without alt text' },
  lang_missing: { w: 3, text: 'No language set on the page' }
};

function checkPage(p) {
  const issues = [];
  if (!p.title) issues.push('title_missing'); else if (p.title.length < 20 || p.title.length > 65) issues.push('title_length');
  if (!p.description) issues.push('desc_missing'); else if (p.description.length < 60 || p.description.length > 165) issues.push('desc_length');
  if (!p.h1.length) issues.push('h1_missing'); else if (p.h1.length > 1) issues.push('h1_multiple');
  if (p.schemaErrors) issues.push('schema_invalid');
  if (!p.schemaTypes.length) issues.push('schema_missing');
  if (p.faq.length >= 2 && !p.schemaTypes.includes('FAQPage')) issues.push('faq_no_schema');
  if (!p.og.title || !p.og.description || !p.og.image) issues.push('og_missing');
  if (p.words < 300) issues.push('thin');
  if (p.imagesNoAlt > 0) issues.push('alt_missing');
  if (!p.lang) issues.push('lang_missing');
  const score = Math.max(0, 100 - issues.reduce((a, k) => a + PAGE_RULES[k].w, 0));
  return { issues, score };
}

// Crawlers of AI answer engines. Blocking a "search" bot keeps the site out of that engine's answers;
// "training" bots only collect data for model training, so blocking them is the owner's choice.
const BOTS = [
  { ua: 'OAI-SearchBot', engine: 'ChatGPT search', kind: 'search' },
  { ua: 'ChatGPT-User', engine: 'ChatGPT (when a user asks it to open a page)', kind: 'search' },
  { ua: 'PerplexityBot', engine: 'Perplexity', kind: 'search' },
  { ua: 'Claude-SearchBot', engine: 'Claude search', kind: 'search' },
  { ua: 'Googlebot', engine: 'Google Search and Gemini', kind: 'search' },
  { ua: 'Bingbot', engine: 'Bing and Copilot', kind: 'search' },
  { ua: 'GPTBot', engine: 'OpenAI model training', kind: 'training' },
  { ua: 'ClaudeBot', engine: 'Anthropic model training', kind: 'training' },
  { ua: 'Google-Extended', engine: 'Gemini model training', kind: 'training' },
  { ua: 'CCBot', engine: 'Common Crawl (used to train many models)', kind: 'training' }
];

// Is "/" disallowed for this user agent? Uses the most specific group that names it, else "*".
function robotsBlocks(robots, ua) {
  const groups = [];
  let cur = null;
  let lastWasAgent = false;
  for (const raw of String(robots || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const i = line.indexOf(':');
    if (i < 0) continue;
    const k = line.slice(0, i).trim().toLowerCase();
    const v = line.slice(i + 1).trim();
    if (k === 'user-agent') {
      if (!lastWasAgent || !cur) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(v.toLowerCase());
      lastWasAgent = true;
    } else if (cur && (k === 'disallow' || k === 'allow')) {
      cur.rules.push({ allow: k === 'allow', path: v });
      lastWasAgent = false;
    } else lastWasAgent = false;
  }
  const name = ua.toLowerCase();
  let group = null;
  for (const g of groups) if (g.agents.some((a) => a !== '*' && name.includes(a) || a === name)) { group = g; break; }
  if (!group) group = groups.find((g) => g.agents.includes('*'));
  if (!group) return false;
  const disallowRoot = group.rules.some((r) => !r.allow && r.path === '/');
  const allowRoot = group.rules.some((r) => r.allow && (r.path === '/' || r.path === '/*' || r.path === ''));
  return disallowRoot && !allowRoot;
}

function sitemapLocs(xml) {
  const out = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m;
  while ((m = re.exec(String(xml || '')))) out.push(decode(m[1]));
  return out;
}

const UTILITY = /^\/(401|404|search)(\/|$)/;

// site: { url, domains, name }, pages: Webflow pages (static and templates), options: { maxPages, budgetMs }
async function auditSite(site, pages, opts) {
  opts = opts || {};
  const started = Date.now();
  const budget = opts.budgetMs || 40000;
  const maxPages = opts.maxPages || 50;
  const origin = String(site.url || '').replace(/\/+$/, '');
  const hosts = [new URL(origin).host].concat(site.domains || []);
  const get = (u, ms, max) => fetcher.getText(u, { allowedHosts: hosts, timeoutMs: ms || 10000, maxBytes: max || 1500000 });

  const [robots, llms, sitemap] = await Promise.all([get(origin + '/robots.txt', 6000, 200000), get(origin + '/llms.txt', 6000, 300000), get(origin + '/sitemap.xml', 8000, 3000000)]);
  const siteInfo = {
    https: origin.startsWith('https://'),
    robots: robots.ok ? 'found' : (robots.status === 404 ? 'none' : 'unreachable'),
    blockedBots: [],
    llms: llms.ok && llms.text && llms.text.trim().length > 20 && !/<html/i.test(llms.text.slice(0, 400)),
    sitemap: !!(sitemap.ok && /<(urlset|sitemapindex)\b/i.test(sitemap.text || '')),
    orgSchema: false,
    homeReachable: false
  };
  if (robots.ok) for (const b of BOTS) if (robotsBlocks(robots.text, b.ua)) siteInfo.blockedBots.push(b.ua);

  // Pages to read: static pages from Webflow first (they can be fixed from the app), then CMS item pages from the sitemap
  const list = [];
  const seen = new Set();
  const add = (path, page) => {
    const p = path === '' ? '/' : path;
    if (seen.has(p) || list.length >= maxPages) return;
    seen.add(p);
    list.push({ path: p, pageId: page ? page.id : '', pageTitle: page ? page.title : '', template: !!(page && page.collectionId) });
  };
  const statics = (pages || []).filter((p) => !p.collectionId && !p.draft && !p.archived && typeof p.publishedPath === 'string' && !UTILITY.test(p.publishedPath));
  statics.sort((a, b) => (a.publishedPath === '/' ? -1 : b.publishedPath === '/' ? 1 : a.publishedPath.length - b.publishedPath.length));
  for (const p of statics) add(p.publishedPath, p);
  if (siteInfo.sitemap) {
    let locs = sitemapLocs(sitemap.text);
    if (/<sitemapindex\b/i.test(sitemap.text)) {
      const kids = locs.slice(0, 3);
      locs = [];
      for (const k of kids) { const r = await get(k, 8000, 3000000); if (r.ok) locs.push(...sitemapLocs(r.text)); }
    }
    for (const loc of locs) {
      try { const u = new URL(loc); if (hosts.some((h) => h.replace(/^www\./, '') === u.host.replace(/^www\./, ''))) add(u.pathname.replace(/\/+$/, '') || '/', null); } catch (e) { /* skip */ }
    }
  }
  if (!list.length) add('/', null);

  const results = [];
  let i = 0;
  async function worker() {
    while (i < list.length && Date.now() - started < budget) {
      const item = list[i++];
      const r = await get(origin + item.path, 9000);
      const row = { path: item.path, pageId: item.pageId, name: item.pageTitle, template: item.template, status: r.status, ok: r.ok };
      if (r.ok && /html/i.test(r.contentType || 'text/html')) {
        const p = readPage(r.text);
        const c = checkPage(p);
        Object.assign(row, {
          title: p.title, description: p.description, h1: p.h1.slice(0, 2), lang: p.lang, words: p.words,
          schemaTypes: p.schemaTypes, faq: p.faq.slice(0, 8), noindex: /noindex/.test(p.robots), og: { title: !!p.og.title, description: !!p.og.description, image: p.og.image || '' },
          images: p.images, imagesNoAlt: p.imagesNoAlt, issues: c.issues, score: c.score
        });
        if (item.path === '/') {
          siteInfo.homeReachable = true;
          siteInfo.orgSchema = p.schemaTypes.some((t) => /^(Organization|LocalBusiness|Corporation|ProfessionalService|MedicalBusiness|Dentist|MedicalClinic|Store|Restaurant|HealthAndBeautyBusiness|BeautySalon|DaySpa|LegalService|Attorney|RealEstateAgent|EducationalOrganization|NGO)$/.test(t));
          siteInfo.socials = p.socials;
          siteInfo.ogImage = p.og.image || '';
          siteInfo.icon = p.icon || '';
          siteInfo.homeTitle = p.title;
          siteInfo.homeDescription = p.description;
          siteInfo.lang = p.lang;
        }
      } else {
        row.issues = []; row.score = null; row.error = r.error || (r.ok ? 'not an HTML page' : 'HTTP ' + r.status);
      }
      results.push(row);
    }
  }
  await Promise.all([worker(), worker(), worker(), worker(), worker()]);
  results.sort((a, b) => list.findIndex((x) => x.path === a.path) - list.findIndex((x) => x.path === b.path));

  // Site-level findings
  const siteIssues = [];
  const searchBlocked = siteInfo.blockedBots.filter((ua) => BOTS.find((b) => b.ua === ua).kind === 'search');
  if (searchBlocked.length) siteIssues.push({ code: 'robots_blocks_ai', w: 12, detail: searchBlocked.join(', ') });
  if (!siteInfo.llms) siteIssues.push({ code: 'llms_missing', w: 6 });
  if (!siteInfo.sitemap) siteIssues.push({ code: 'sitemap_missing', w: 6 });
  if (siteInfo.homeReachable && !siteInfo.orgSchema) siteIssues.push({ code: 'org_schema_missing', w: 6 });
  if (!siteInfo.https) siteIssues.push({ code: 'not_https', w: 6 });
  if (!siteInfo.homeReachable) siteIssues.push({ code: 'home_unreachable', w: 30 });

  const scored = results.filter((r) => typeof r.score === 'number' && !r.noindex);
  const pageAvg = scored.length ? scored.reduce((a, r) => a + r.score, 0) / scored.length : 0;
  const sitePart = Math.max(0, 30 - siteIssues.reduce((a, x) => a + x.w, 0));
  const score = Math.round(pageAvg * 0.7 + sitePart);
  return {
    at: Date.now(),
    ms: Date.now() - started,
    score,
    origin,
    site: siteInfo,
    siteIssues,
    pagesListed: list.length,
    pagesChecked: results.length,
    complete: results.length >= list.length,
    pages: results
  };
}

module.exports = { readPage, checkPage, robotsBlocks, sitemapLocs, auditSite, PAGE_RULES, BOTS, decode, stripTags, visibleHtml };
