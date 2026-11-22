'use strict';
// AI Visibility Report: a one-off check of any website, with no account and no Webflow.
// A visitor gives a website. We read its home page the way an AI crawler does, work out who the business is and which
// searches its customers make, look up how often each is searched and keep the most searched ones. Every search has a
// customer question: Google gets the search, the chat engines get the question. The free check puts one search to the
// free engines and shows the answers word for word. Paying once unlocks the full report: every search on every
// engine, each chat engine asked twice, the pages the engines read, what they say about the business by name, and a
// fix kit. Thirty days later the same searches are asked again.
//
// Keys (all start with "vr"):
//   vr:{id}        the check record
//   vrq:{id}       tasks still to do ("unit|engine|attempt")
//   vrres:{id}     hash of answers, field "unit|engine"
//   vr:active      set of ids with work left (the cron works on them when no page is open)
//   vr:due         set of paid ids waiting for their re-check
//   vrdom:{host}   the latest check of a website (a second visitor within 7 days sees that one)
//   vrfree:{day}   free checks started that day (cost guard)
const net = require('net');
const kv = require('../kv');
const store = require('../store');
const engines = require('../engines');
const analyze = require('../analyze');
const auditLib = require('../audit');
const fetcher = require('../fetcher');
const llm = require('../llm');
const fixes = require('../fixes');
const insights = require('../insights');
const alerts = require('../alerts');
const email = require('../email');
const kwLib = require('../keywords');
const { random } = require('../crypto');
const where = require('./where');

const DAY = 86400000;
const ID_RE = /^[A-Za-z0-9_-]{16,40}$/;
const FREE_TTL = 30 * 86400; // an unpaid check is deleted after 30 days
const PAID_TTL = 400 * 86400; // a paid report stays for 400 days
const DOMAIN_CACHE_S = 7 * 86400;
const RECHECK_AFTER = 30 * DAY;
const RECHECK_EARLY = 14 * DAY;
const STALE_MS = 3 * 60000;
const MAX_ATTEMPTS = 3;
const FULL_WINDOW_MS = 43000;
const SEARCH = ['aio', 'aimode']; // Google answers searches, so it gets the keyword; chat engines get the question
const FIN_STEPS = ['reading', 'audit', 'insights', 'assets', 'compose'];

const COUNTRY = { US: 'the United States', GB: 'the United Kingdom', IE: 'Ireland', CA: 'Canada', AU: 'Australia', DE: 'Germany', FR: 'France', NL: 'the Netherlands', ES: 'Spain', IT: 'Italy', TR: 'Turkey', AE: 'the United Arab Emirates', SA: 'Saudi Arabia', PL: 'Poland', SE: 'Sweden', IN: 'India', BR: 'Brazil', MX: 'Mexico' };
const TLD_COUNTRY = { uk: 'GB', ie: 'IE', ca: 'CA', au: 'AU', de: 'DE', fr: 'FR', nl: 'NL', es: 'ES', it: 'IT', tr: 'TR', ae: 'AE', sa: 'SA', pl: 'PL', se: 'SE', in: 'IN', br: 'BR', mx: 'MX', us: 'US' };

const price = () => { const c = parseInt(process.env.VR_PRICE_CENTS || '', 10); return Number.isFinite(c) && c >= 100 ? c : 2900; };
// How many searches a report covers. Each one is about 10 answers (18 cents) in the report and again in the re-check.
const topicCount = () => { const n = parseInt(process.env.VR_TOPICS || '', 10); return n >= 3 && n <= 6 ? n : 5; };
const NUMBER = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
// How many searches the page is asked for; the most searched of them make the report.
const CANDIDATES = 10;
const clean = (s, max) => String(s == null ? '' : s).replace(/[–—]/g, ', ').replace(/\s+/g, ' ').trim().slice(0, max || 300);
const squash = (s) => analyze.norm(s).replace(/ /g, '');
const day = (t) => new Date(t || Date.now()).toISOString().slice(0, 10);
const allowLocal = () => process.env.ALLOW_PRIVATE_FETCH === '1';

/* ---------- counting the funnel ---------- */

// One counter per day and step (started, asked, preview shown, checkout opened, paid, report built), so we can see
// where visitors stop. Only numbers: no address, no website, nothing about a person. Never fails a request.
async function count(step) {
  try {
    const key = 'vrstat:' + day();
    const n = await kv.hincrby(key, step, 1);
    if (n === 1) await kv.expire(key, 200 * 86400);
  } catch (e) { /* counting is best effort */ }
}
async function stats(days) {
  const out = [];
  for (let i = 0; i < Math.min(days || 30, 120); i++) {
    const d = day(Date.now() - i * DAY);
    const h = await kv.hgetallRaw('vrstat:' + d);
    if (Object.keys(h).length) out.push(Object.assign({ day: d }, Object.fromEntries(Object.entries(h).map(([k, v]) => [k, parseInt(v, 10) || 0]))));
  }
  return out;
}

/* ---------- the address a visitor types ---------- */

// Pages on these hosts belong to someone else's site: the check needs the business's own website.
const SHARED = ['facebook.com', 'instagram.com', 'linkedin.com', 'x.com', 'twitter.com', 'tiktok.com', 'youtube.com', 'pinterest.com', 'linktr.ee', 'etsy.com', 'yelp.com', 'tripadvisor.com', 'booking.com', 'airbnb.com', 'medium.com', 'reddit.com', 'threads.net', 'wa.me', 't.me', 'g.page', 'goo.gl', 'bit.ly', 'beacons.ai', 'bio.link'];

// Returns { origin, host } or { error: code }. Only the home page is read, so a path is dropped.
function normalizeUrl(input) {
  let s = String(input || '').trim();
  if (!s) return { error: 'empty' };
  if (s.length > 300 || /\s/.test(s)) return { error: 'bad' };
  if (/^[^/]*@[^/]*$/.test(s) && !/^https?:/i.test(s)) return { error: 'email' };
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^https?:\/\//i.test(s) && !/^[a-z0-9.-]+:\d+/i.test(s)) return { error: 'bad' };
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch (e) { return { error: 'bad' }; }
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (u.username || u.password) return { error: 'bad' };
  if (!allowLocal()) {
    if (!host.includes('.') || net.isIP(host.replace(/^\[|\]$/g, '')) || /\.(local|internal|localhost|test|invalid|example)$/.test(host) || !/^[a-z0-9.-]+$/.test(host)) return { error: 'bad' };
    if (u.port && u.port !== '443' && u.port !== '80') return { error: 'bad' };
  }
  const bare = host.replace(/^(www|m)\./, '');
  if (u.pathname.replace(/\/+$/, '') && SHARED.some((d) => bare === d || bare.endsWith('.' + d))) return { error: 'shared', host: bare };
  return { origin: u.protocol + '//' + u.host, host: bare };
}

const URL_ERRORS = {
  empty: 'Type your website address, like yourbusiness.com.',
  bad: 'That does not look like a website address. Try it like yourbusiness.com.',
  email: 'That is an email address. Type your website instead, like yourbusiness.com.',
  shared: 'That is a page on someone else\'s site. The check needs your own website address.'
};

/* ---------- reading the website the way a crawler does ---------- */

async function readSite(origin, host) {
  const hosts = [host, 'www.' + host, host.replace(/:\d+$/, '')];
  const get = (u, ms, max) => fetcher.getText(u, { allowedHosts: hosts, timeoutMs: ms, maxBytes: max });
  const [home, robots, llms, sitemap] = await Promise.all([
    get(origin + '/', 9000, 1500000), get(origin + '/robots.txt', 6000, 200000), get(origin + '/llms.txt', 6000, 300000), get(origin + '/sitemap.xml', 7000, 2000000)
  ]);
  // a redirect to another domain: the caller starts again there
  if (!home.ok && home.error === 'not one of the site\'s domains' && home.url) {
    try { const moved = new URL(home.url); if (/^https?:$/.test(moved.protocol)) return { moved: moved.protocol + '//' + moved.host }; } catch (e) { /* fall through */ }
  }
  const site = {
    read: { ok: !!home.ok, status: home.status || 0, error: home.ok ? '' : String(home.error || (home.status ? 'HTTP ' + home.status : 'no answer')) },
    https: origin.startsWith('https://'),
    robots: robots.ok ? 'found' : (robots.status === 404 ? 'none' : 'unreachable'),
    blockedBots: [],
    llms: !!(llms.ok && llms.text && llms.text.trim().length > 20 && !/<html/i.test(llms.text.slice(0, 400))),
    sitemap: !!(sitemap.ok && /<(urlset|sitemapindex)\b/i.test(sitemap.text || '')),
    title: '', description: '', h1: [], lang: '', words: 0, text: '', sample: '', schemaTypes: [], orgSchema: false, faqCount: 0, faq: [], og: {}, icon: '', socials: [], htmlBytes: 0, appShell: false
  };
  if (robots.ok) for (const b of auditLib.BOTS) if (auditLib.robotsBlocks(robots.text, b.ua)) site.blockedBots.push(b.ua);
  if (home.ok && /html|^$/i.test(home.contentType || '')) {
    const p = auditLib.readPage(home.text);
    Object.assign(site, {
      title: clean(p.title, 200), description: clean(p.description, 320), h1: p.h1.slice(0, 2).map((x) => clean(x, 160)), lang: String(p.lang || '').slice(0, 12),
      words: p.words, text: String(p.text || '').slice(0, 3200), sample: clean(p.text, 340), schemaTypes: p.schemaTypes.slice(0, 12),
      orgSchema: p.schemaTypes.some((t) => /^(Organization|LocalBusiness|Corporation|ProfessionalService|MedicalBusiness|Dentist|MedicalClinic|Store|Restaurant|Hotel|LodgingBusiness|HealthAndBeautyBusiness|BeautySalon|DaySpa|LegalService|Attorney|RealEstateAgent|EducationalOrganization|NGO|TravelAgency|AutoRepair|HomeAndConstructionBusiness|FinancialService|AccountingService|SoftwareApplication|OnlineStore)$/.test(t)),
      faqCount: p.faq.length, faq: p.faq.slice(0, 6), og: { title: clean(p.og.title, 160), description: clean(p.og.description, 300), image: String(p.og.image || '').slice(0, 400), site_name: clean(p.og.site_name, 80) },
      icon: String(p.icon || '').slice(0, 400), socials: p.socials, htmlBytes: home.text.length,
      // almost no words in a large page: the content is drawn by JavaScript, which most AI crawlers do not run
      appShell: p.words < 120 && (home.text.length > 15000 || /<div[^>]+id=["'](root|app|__next|__nuxt)["']/i.test(home.text))
    });
  } else if (home.ok) {
    site.read = { ok: false, status: home.status, error: 'not a web page' };
  }
  return { site, reachable: home.status > 0 || home.ok };
}

// What stands between the site and AI crawlers, worst first. Each becomes a fix in the paid report.
function findingsOf(site) {
  const out = [];
  const searchBlocked = site.blockedBots.filter((ua) => { const b = auditLib.BOTS.find((x) => x.ua === ua); return b && b.kind === 'search'; });
  if (!site.read.ok) out.push({ code: 'blocked', sev: 3, title: 'Your site refused our reader (' + (site.read.status ? 'HTTP ' + site.read.status : site.read.error) + ')', detail: 'A firewall that turns every bot away keeps AI crawlers out too.' });
  if (searchBlocked.length) out.push({ code: 'robots_blocks_ai', sev: 3, title: 'robots.txt shuts out ' + andList(searchBlocked), detail: searchBlocked.length === 1 ? 'This crawler fetches pages for AI answers. Shut out, it cannot read or cite you.' : 'These crawlers fetch pages for AI answers. Shut out, they cannot read or cite you.', bots: searchBlocked });
  if (site.read.ok && site.words < 120) out.push({ code: 'empty_html', sev: 3, title: 'AI crawlers find only ' + site.words + ' words on your home page', detail: site.appShell ? 'The page is drawn by JavaScript, which most AI crawlers do not run.' : 'There is almost nothing for an AI engine to read or quote.' });
  if (!site.https) out.push({ code: 'not_https', sev: 2, title: 'The site does not use HTTPS', detail: 'Engines prefer sources they can trust.' });
  if (site.read.ok && !site.orgSchema) out.push({ code: 'org_schema_missing', sev: 2, title: 'No structured data says who you are', detail: 'Without Organization markup an AI engine has to guess your name, place and what you sell.' });
  if (site.read.ok && (!site.description || site.description.length < 60 || site.description.length > 165 || !site.title || site.title.length < 20 || site.title.length > 65)) out.push({ code: 'meta_weak', sev: 2, title: !site.description ? 'The home page has no meta description' : !site.title ? 'The home page has no title' : 'The home page title or description is the wrong length', detail: 'This is the line engines quote when they describe you.' });
  if (site.read.ok && site.faqCount >= 2 && !site.schemaTypes.includes('FAQPage')) out.push({ code: 'faq_no_schema', sev: 1, title: 'Questions are answered on the page without FAQ markup', detail: 'Marked-up answers are easier for an engine to lift.' });
  if (site.read.ok && site.words >= 120 && site.words < 300) out.push({ code: 'thin_home', sev: 1, title: 'The home page has only ' + site.words + ' words', detail: 'Little for an AI engine to quote.' });
  if (!site.sitemap) out.push({ code: 'sitemap_missing', sev: 1, title: 'No sitemap.xml', detail: 'Crawlers find your pages more slowly.' });
  if (!site.llms) out.push({ code: 'llms_missing', sev: 1, title: 'No llms.txt', detail: 'A short guide to your site for AI crawlers. Cheap to add, though no engine has confirmed using it yet.' });
  return out.sort((a, b) => b.sev - a.sev);
}

function andList(a) { a = (a || []).filter(Boolean); return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }

/* ---------- who the business is and what its customers ask ---------- */

function guessBrand(site, host) {
  const fromTitle = String(site.title || '').split(/\s[|\-:•·–—]\s/).map((x) => x.trim()).filter(Boolean);
  const label = host.replace(/:\d+$/, '').split('.')[0];
  const pick = site.og && site.og.site_name ? site.og.site_name : fromTitle.sort((a, b) => a.length - b.length)[0];
  return clean(pick && pick.length <= 50 ? pick : label.charAt(0).toUpperCase() + label.slice(1), 60);
}
function guessCountry(host) {
  const tld = host.replace(/:\d+$/, '').split('.').pop();
  return TLD_COUNTRY[tld] || '';
}
const validCountry = (c) => { c = String(c || '').toUpperCase(); return COUNTRY[c] ? c : ''; };

async function understand(site, host, budgetMs) {
  const base = {
    brand: guessBrand(site, host), aliases: [], category: '', place: '', country: guessCountry(host), customersCountry: guessCountry(host) || 'US',
    language: /^[a-z]{2}/i.test(site.lang) ? site.lang.slice(0, 2).toLowerCase() : 'en', summary: '', candidates: [], byAi: false
  };
  if (!site.read.ok || !llm.available()) return base;
  let j;
  try {
    // a visitor is waiting on the first page, so two providers are asked at once and the first answer is used
    j = await llm.generateJSON({
      race: true,
      budgetMs: budgetMs || 24000,
      timeoutMs: Math.min(22000, (budgetMs || 24000) - 500),
      system: 'You study the home page of a business website. You work out who the business is, which searches its potential customers make to find a business like it, and how they would put the same need to an AI assistant such as ChatGPT. Only use what the page says. No em dashes.',
      prompt: `Website: ${host}\nLanguage attribute: ${site.lang || 'not set'}\nTitle: ${site.title || '(none)'}\nMeta description: ${site.description || '(none)'}\nMain heading: ${(site.h1 || [])[0] || '(none)'}\nText on the page: ${clean(site.text, 2600) || '(none)'}\n\n` +
        'Return {"brand": "the business name the way customers say it, without slogans or legal suffixes", "aliases": ["0 to 3 other spellings or short forms customers use"], ' +
        '"category": "what the business is in 2 to 5 lowercase words, for example boutique hotel, family dentist, accounting software", ' +
        '"place": "the city or area it serves if it is a local business, else an empty string", "country": "ISO 3166-1 alpha-2 code of the country the business is in, or an empty string", ' +
        '"customers_country": "ISO code of the country most of its customers search from. It differs from country when the business sells to visitors or buyers abroad, such as hotels, clinics for medical travel, exporters and online products. One of US, GB, IE, CA, AU, DE, FR, NL, ES, IT, TR, AE, SA, PL, SE, IN, BR, MX", ' +
        '"language": "ISO 639-1 code of the language those customers write in", "summary": "one plain sentence under 140 characters: what the business offers and for whom", ' +
        `"searches": [${NUMBER[CANDIDATES]} items like {"keyword": "...", "question": "..."}]}\n\n` +
        `Rules for the ${NUMBER[CANDIDATES]} searches: each "keyword" is a search that a potential customer who has never heard of this business types into Google when choosing a provider like it: 2 to 5 lowercase words, the way people really type, in the customers' language, with the place when the business is local. It has to fit this business closely, so that the searcher would be glad to find it, and it is never broader than the business itself: a small hotel in one quarter of a city is not found for "hotels" or "city breaks". ` +
        'Each "question" is the same need the way that person would put it to an AI assistant: one natural sentence under 110 characters that an assistant can answer by naming specific businesses or products. ' +
        'The first search is the main thing the business sells. The others cover a specific need or feature the page stresses, a kind of customer, a comparison or price search, a search that starts from the customer\'s own situation, and searches tied to a concrete fact the page states, such as a location, an opening time or something included. ' +
        'Use the wording most people type, short and common, not a description of the product: "airbnb welcome book template", not "ready-made welcome book for rental hosts". ' +
        'Every search is about a different need: no two may differ only in word order, a plural or a filler word. Never include the name of the business itself or of a rival. A platform or tool the customer already uses (such as Airbnb, Shopify or Webflow) may be part of a search when the page is aimed at its users.',
      maxTokens: 1500
    });
  } catch (e) { console.error('[vr] understand', e.message); return base; }
  const list = j && typeof j === 'object' ? (Array.isArray(j.searches) ? j.searches : Array.isArray(j.topics) ? j.topics : null) : null;
  if (!j || typeof j !== 'object' || (!j.brand && !list)) return base;
  const brand = clean(j.brand, 60) || base.brand;
  const brandKey = squash(brand);
  const candidates = [];
  for (const t of list || []) {
    const q = clean(t && t.question, 170);
    if (q.length < 8) continue;
    const k = kwLib.clean(t.keyword) || keywordFrom(q);
    if (!k || (brandKey.length >= 4 && (squash(q).includes(brandKey) || squash(k).includes(brandKey)))) continue;
    if (candidates.some((x) => squash(x.question) === squash(q) || x.keyword === k)) continue;
    candidates.push({ keyword: k, question: q });
    if (candidates.length >= CANDIDATES) break;
  }
  return {
    brand,
    aliases: (Array.isArray(j.aliases) ? j.aliases : []).map((a) => clean(a, 60)).filter((a) => a.length >= 3 && squash(a) !== brandKey).slice(0, 3),
    category: clean(j.category, 50).toLowerCase(),
    place: clean(j.place, 50),
    country: validCountry(j.country) || base.country,
    customersCountry: validCountry(j.customers_country) || validCountry(j.country) || base.customersCountry,
    language: /^[a-z]{2}$/i.test(String(j.language || '')) ? String(j.language).toLowerCase() : base.language,
    summary: clean(j.summary, 170),
    candidates,
    byAi: true
  };
}

// A question turned into the search people type into Google, when no AI call wrote one.
const Q_STOP = new Set('who what which where when how why is are was were do does did can could should would the a an of for in on at to by with from and or my our your i we me you it that this there some any best good top right most'.split(' '));
function keywordFrom(question) {
  const words = analyze.norm(question).split(' ').filter(Boolean);
  const kept = words.filter((w) => !Q_STOP.has(w));
  const lead = /\b(best|top|good|recommend)/i.test(question) ? ['best'] : [];
  return kwLib.clean(lead.concat(kept).slice(0, 6).join(' ')) || kwLib.clean(question);
}

/* ---------- which searches a report is built on ---------- */

// Monthly Google searches for a list of keywords in one country: { known, map: { keyword: number }, asked, filled }.
// known is false when the keyword data service is not set up, does not answer, or the day's lookups are used up (each
// one costs about 1.3 cents, and a check is started far more often than it is bought); the report then works without
// numbers. The first lookup reads DataForSEO's own list of keywords, which has nothing for many real searches. With
// fill (how many milliseconds may still be spent, or a function that says so), the ones it missed are asked of Google
// Ads in one more request: asked is how many, filled how many came back with a number.
async function searchVolumes(keywords, country, language, timeoutMs, fill) {
  const list = [...new Set((keywords || []).map((k) => kwLib.clean(k)).filter(Boolean))];
  const none = { known: false, map: {}, asked: 0, filled: 0 };
  if (!list.length || !kwLib.available()) return none;
  try {
    const used = await kv.incr('vrkw:' + day());
    if (used === 1) await kv.expire('vrkw:' + day(), 3 * 86400);
    if (used > (parseInt(process.env.VR_LOOKUPS_PER_DAY || '', 10) || 600)) return none;
    const got = await kwLib.volumes(list, country, language, timeoutMs || 7000);
    const map = {};
    for (const k of list) if (got[k] && typeof got[k].volume === 'number') map[k] = got[k].volume;
    const missing = list.filter((k) => !(k in map));
    const more = fill && missing.length ? await fillFromAds(missing, country, language, typeof fill === 'function' ? fill() : fill, map) : { asked: 0, filled: 0 };
    return { known: true, map, asked: more.asked, filled: more.filled };
  } catch (e) { console.error('[vr] volumes', e.message); return none; }
}

// Google Ads answers for any keyword, but a request costs 9 cents however many keywords it carries, takes up to about
// seven seconds, and the whole account may send 12 a minute. So it has a daily cap of its own (VR_ADS_LOOKUPS_PER_DAY,
// 0 turns it off) and never stops a check: whatever goes wrong, the numbers already found stand.
const adsCap = () => { const n = parseInt(process.env.VR_ADS_LOOKUPS_PER_DAY || '', 10); return Number.isFinite(n) && n >= 0 ? n : 40; };
async function fillFromAds(missing, country, language, ms, map) {
  const out = { asked: 0, filled: 0 };
  if (!adsCap() || !(ms >= 3000)) return out;
  try {
    const used = await kv.incr('vrads:' + day());
    if (used === 1) await kv.expire('vrads:' + day(), 3 * 86400);
    if (used > adsCap()) return out;
    out.asked = missing.length;
    const got = await kwLib.adsVolumes(missing, country, language, Math.min(ms, 9000));
    for (const k of missing) if (got[k] && typeof got[k].volume === 'number') { map[k] = got[k].volume; out.filled++; }
  } catch (e) { console.error('[vr] ads volumes', e.message); }
  return out;
}

const stemK = (w) => w.replace(/(ies|es|s)$/, (m) => (m === 'ies' ? 'y' : '')).slice(0, 12);
const wordsOf = (text) => [...new Set(kwLib.tokens(text).map(stemK))];
// "boutique hotel lisbon" and "boutique hotels in lisbon" are one search.
function alike(a, b) {
  const A = wordsOf(a), B = new Set(wordsOf(b));
  if (!A.length || !B.size) return false;
  const both = A.filter((w) => B.has(w)).length;
  return both / (A.length + B.size - both) >= 0.75;
}
// Whether a question a visitor reworded is still about the search it belongs to: it keeps half of what the question
// it replaces was about, or it holds every word of the search. "hotel" and "lisbon" alone do not make it the same.
function sameSubject(topic, question) {
  const about = (text) => wordsOf(text).filter((w) => !Q_STOP.has(w));
  const q = new Set(about(question));
  const kept = (words) => (words.length ? words.filter((w) => q.has(w)).length / words.length : 0);
  return kept(about(topic.question)) >= 0.5 || kept(about(topic.keyword)) === 1;
}

// The searches of a report: the most searched candidates, never two that are nearly the same, and always the first
// candidate, which is the main thing the business sells. Most searched first; searches without a number keep their order.
function pickTopics(cands, vols, n) {
  const rows = (cands || []).map((c, i) => ({ keyword: c.keyword, question: c.question, i, volume: vols && typeof vols[c.keyword] === 'number' ? vols[c.keyword] : null }));
  const byDemand = (a, b) => (b.volume == null ? -1 : b.volume) - (a.volume == null ? -1 : a.volume) || a.i - b.i;
  const picked = [];
  const take = (r) => { if (picked.length < n && !picked.includes(r) && !picked.some((x) => alike(x.keyword, r.keyword))) picked.push(r); };
  if (rows[0]) take(rows[0]);
  rows.slice().sort(byDemand).forEach(take);
  for (const r of rows) if (picked.length < n && !picked.includes(r)) picked.push(r); // near-duplicates only when nothing else is left
  return picked.sort(byDemand).map((r) => ({ keyword: r.keyword, question: r.question, volume: r.volume }));
}

// The candidates that did not make the report and are not another wording of one that did, most searched first.
function othersOf(cands, vols, picked) {
  return (cands || []).filter((c) => !picked.some((p) => p.keyword === c.keyword || alike(p.keyword, c.keyword)))
    .map((c, i) => ({ keyword: c.keyword, volume: vols && typeof vols[c.keyword] === 'number' ? vols[c.keyword] : null, i }))
    .sort((a, b) => (b.volume == null ? -1 : b.volume) - (a.volume == null ? -1 : a.volume) || a.i - b.i)
    .slice(0, CANDIDATES - 1).map((c) => ({ keyword: c.keyword, volume: c.volume }));
}

// Writes fresh search numbers into the topics and the searches beside them. looked is the country the numbers are
// for; '' means they were not looked up.
function setVolumes(check, vols) {
  for (const t of check.topics.concat(check.others || [])) {
    if (vols && vols.known) { t.volume = typeof vols.map[t.keyword] === 'number' ? vols.map[t.keyword] : null; t.looked = check.ask.country; }
    else if (t.looked !== check.ask.country) { t.volume = null; t.looked = ''; }
  }
}
const needVolumes = (check) => check.topics.some((t) => t.looked !== check.ask.country);
const keywordsOf = (check) => check.topics.concat(check.others || []).map((t) => t.keyword);

/* ---------- storing a check ---------- */

async function get(id) { return ID_RE.test(String(id || '')) ? kv.getJSON('vr:' + id) : null; }
async function save(check) {
  check.updatedAt = Date.now();
  return kv.setJSON('vr:' + check.id, check, check.paid ? PAID_TTL : FREE_TTL);
}
// Every change to a stored check goes through here: the record is read again under a short lock, changed and written
// back, so a page, the cron and a payment arriving at the same moment never overwrite each other.
// fn returns false to leave the record as it is. Returns the record, or null when it no longer exists.
async function update(id, fn) {
  for (let i = 0; i < 60; i++) {
    if (await kv.setNX('lock:vr:w:' + id, { at: Date.now() }, 10)) {
      try {
        const c = await get(id);
        if (!c) return null;
        if ((await fn(c)) !== false) await save(c);
        return c;
      } finally { await kv.del('lock:vr:w:' + id); }
    }
    await new Promise((r) => setTimeout(r, 60));
  }
  throw new Error('check is busy');
}
async function results(id) { return kv.hgetallJSON('vrres:' + id); }
async function rowsOf(id) { return Object.values(await results(id)).filter(Boolean); }
async function saveResult(check, field, row) {
  await kv.hsetJSON('vrres:' + check.id, field, row);
  await kv.expire('vrres:' + check.id, check.paid ? PAID_TTL : FREE_TTL);
}
const touch = (id) => kv.setJSON('vrp:' + id, { at: Date.now() }, 7 * 86400);
async function lastProgress(check) { const p = await kv.getJSON('vrp:' + check.id); return (p && p.at) || (check.run && check.run.at) || check.at; }
const lock = (name, ttl) => store.lock('vr:' + name, ttl);
const unlock = (name) => store.unlock('vr:' + name);

// looked: the country whose search numbers the topics carry ('' when they were not looked up).
function topicsFrom(list, looked) {
  return (list || []).slice(0, topicCount()).map((t, i) => ({ id: 't' + i, keyword: kwLib.clean(t.keyword) || keywordFrom(t.question), question: clean(t.question, 170), volume: typeof t.volume === 'number' ? t.volume : null, looked: looked || '', edited: false }));
}

// Free checks are capped per visitor and per day; a website checked in the last week shows that check again.
async function start(input, ctx) {
  ctx = ctx || {};
  // the page that waits for this has 60 seconds in all: what is left is shared out between the steps
  const t0 = Date.now();
  const left = () => 55000 - (Date.now() - t0);
  let n = normalizeUrl(input);
  if (n.error) return { error: URL_ERRORS[n.error] || URL_ERRORS.bad, code: n.error };
  const cached = await kv.getJSON('vrdom:' + n.host);
  if (cached && cached.id && !ctx.fresh) {
    const old = await get(cached.id);
    // a draft whose searches could not be worked out is not handed on: the next visitor gets a fresh try
    const stuck = old && old.status === 'draft' && !old.topics.length && old.site && old.site.read && old.site.read.ok;
    if (old && ['preview', 'running', 'draft'].includes(old.status) && !old.paid && !stuck) { await count('again'); return { id: old.id, cached: true }; }
  }
  if (ctx.ip && !(await store.rateOk('vrip:' + ctx.ip, parseInt(process.env.VR_FREE_PER_IP || '', 10) || 4, 86400))) return { error: 'You have used today\'s free checks. Come back tomorrow, or open the full report for a check you already ran.', code: 'limit' };
  let read = await readSite(n.origin, n.host);
  if (read.moved) {
    const m = normalizeUrl(read.moved);
    if (!m.error && m.host !== n.host) { n = m; read = await readSite(n.origin, n.host); }
  }
  // no TLS on the typed address: one try over plain http
  if (read.site && !read.reachable && n.origin.startsWith('https://') && !/^https?:\/\//i.test(String(input).trim())) {
    const plain = await readSite('http://' + n.origin.slice(8), n.host);
    if (plain.site && plain.reachable) { read = plain; n.origin = 'http://' + n.origin.slice(8); }
  }
  if (!read.site || !read.reachable) return { error: 'We could not reach ' + n.host + '. Check the spelling, or try again in a minute.', code: 'unreachable' };
  const site = read.site;
  const tRead = Date.now() - t0;
  const who = await understand(site, n.host, Math.max(8000, Math.min(24000, left() - 9000)));
  const tWho = Date.now() - t0 - tRead;
  const askCountry = who.customersCountry || 'US';
  const vols = await searchVolumes(who.candidates.map((c) => c.keyword), askCountry, who.language || 'en', Math.max(2500, Math.min(7000, left() - 1500)), () => left() - 2500);
  // one line per started check: how long each step took, to tune the limits from real numbers
  console.log(`[vr] start ${n.host}: read ${tRead} ms, understand ${tWho} ms (${who.byAi ? who.candidates.length + ' searches' : 'no answer'}), volumes ${Date.now() - t0 - tRead - tWho} ms (${vols.known ? 'known' + (vols.asked ? ', Google Ads gave ' + vols.filled + ' of ' + vols.asked + ' more' : '') : 'not known'})`);
  const picked = pickTopics(who.candidates, vols.map, topicCount());
  const looked = vols.known ? askCountry : '';
  const check = {
    v: 1, id: random(16), at: Date.now(), status: 'draft', phase: '', ip: ctx.ip || '',
    url: n.origin, host: n.host, site,
    project: { brand: who.brand, aliases: who.aliases, domains: [n.host.replace(/:\d+$/, '')], competitors: [], country: who.country, language: who.language },
    profile: { category: who.category, place: who.place, summary: who.summary, byAi: who.byAi },
    ask: { country: askCountry, language: who.language || 'en' },
    topics: topicsFrom(picked, looked), freeTopic: '',
    others: othersOf(who.candidates, vols.map, picked).map((o) => Object.assign(o, { looked })),
    run: null, preview: null, report: null, work: {}, paid: null, recheck: null, parent: '', email: ''
  };
  await save(check);
  await kv.setJSON('vrdom:' + n.host, { id: check.id, at: check.at }, DOMAIN_CACHE_S);
  await count('start');
  return { id: check.id };
}

/* ---------- questions and tasks ---------- */

const PROBE = {
  en: (b, p) => `What is ${b}${p ? ' in ' + p : ''}? What do they offer and what are they known for?`,
  tr: (b, p) => `${b}${p ? ' (' + p + ')' : ''} nedir? Ne sunuyorlar ve neyle tanınıyorlar?`,
  de: (b, p) => `Was ist ${b}${p ? ' in ' + p : ''}? Was bieten sie an und wofür sind sie bekannt?`,
  fr: (b, p) => `Qu'est-ce que ${b}${p ? ' à ' + p : ''} ? Que proposent-ils et pour quoi sont-ils connus ?`,
  es: (b, p) => `¿Qué es ${b}${p ? ' en ' + p : ''}? ¿Qué ofrecen y por qué son conocidos?`,
  it: (b, p) => `Che cos'è ${b}${p ? ' a ' + p : ''}? Cosa offrono e per cosa sono conosciuti?`,
  nl: (b, p) => `Wat is ${b}${p ? ' in ' + p : ''}? Wat bieden ze aan en waar staan ze om bekend?`,
  pt: (b, p) => `O que é ${b}${p ? ' em ' + p : ''}? O que oferecem e pelo que são conhecidos?`
};
function probeQuestion(check) {
  const f = PROBE[check.ask.language] || PROBE.en;
  return f(check.project.brand, check.profile.place || '');
}

// A unit is one thing to ask: a topic's Google search (q "k"), its question (q "0"), the question asked a second time
// (q "1", paid only) or the question about the business by name (topic "b", paid only).
function unitsFor(check, phase) {
  const units = [];
  const topics = phase === 'free' ? check.topics.filter((t) => t.id === check.freeTopic) : check.topics;
  for (const t of topics) {
    units.push({ id: t.id + '.k', k: t.id, q: 'k', text: t.keyword || t.question });
    units.push({ id: t.id + '.0', k: t.id, q: '0', text: t.question });
    if (phase === 'full') units.push({ id: t.id + '.1', k: t.id, q: '1', text: t.question });
  }
  if (phase === 'full') units.push({ id: 'b.0', k: 'b', q: '0', text: probeQuestion(check) });
  return units;
}
function tasksFor(units, list, have) {
  const tasks = [];
  for (const u of units) for (const e of list) {
    const search = SEARCH.includes(e);
    if (u.k === 'b' ? search : (u.q === 'k') !== search) continue;
    if (have && have[u.id + '|' + e]) continue;
    tasks.push(u.id + '|' + e + '|0');
  }
  return tasks;
}

// Starts a phase: writes the units and the queue. change(check) may adjust the record first and returns false to stop.
async function begin(id, phase, list, have, change) {
  let tasks = null;
  const check = await update(id, (c) => {
    if (change && change(c) === false) return false;
    const units = unitsFor(c, phase);
    tasks = tasksFor(units, list, have);
    c.phase = phase;
    c.status = 'running';
    c.run = { engines: list, units, total: tasks.length + Object.keys(have || {}).length, at: Date.now() };
    c.work = {};
  });
  if (!check || !tasks) return check;
  await kv.del('vrq:' + id);
  for (let i = 0; i < tasks.length; i += 200) await kv.rpush('vrq:' + id, ...tasks.slice(i, i + 200));
  await kv.expire('vrq:' + id, 7 * 86400);
  await touch(id);
  await kv.sadd('vr:active', id);
  return check;
}

// The free check: one search on the free engines. opts: { topic, question, brand, country }.
// The visitor picks one of the searches and may reword its question. A question about something else becomes a search
// of its own, and a new country or a new search gets its numbers looked up before the engines are asked.
async function runFree(id, opts) {
  opts = opts || {};
  const now = await get(id);
  if (!now) return { error: 'This check no longer exists.', code: 'gone' };
  if (now.status !== 'draft') return { ok: true, already: true };
  const list = engines.freeEngines();
  if (!list.length) return { error: 'The AI engines cannot be reached right now. Try again in a few minutes.', code: 'engines' };
  const brand = clean(opts.brand, 60);
  if ((brand || now.project.brand).length < 2) return { error: 'Type the name of your business.', code: 'brand' };
  const question = clean(opts.question, 170);
  if (/https?:\/\/|www\./i.test(question)) return { error: 'Write the question as a customer would ask it, without links.', code: 'question' };
  if (question.length < 8 && !now.topics.length) return { error: 'Write the question a customer would ask.', code: 'question' };
  const cap = parseInt(process.env.VR_FREE_PER_DAY || '', 10) || 150;
  const used = await kv.incr('vrfree:' + day());
  if (used === 1) await kv.expire('vrfree:' + day(), 3 * 86400);
  if (used > cap) return { error: 'Today\'s free checks are all taken. Come back tomorrow.', code: 'limit' };
  const choose = (c) => {
    if (brand.length >= 2 && brand !== c.project.brand) { c.project.brand = brand; c.project.aliases = []; c.profile.byAi = false; }
    const country = validCountry(opts.country);
    if (country) c.ask.country = country;
    let topic = c.topics.find((t) => t.id === opts.topic);
    if (question.length >= 8) {
      if (!topic) {
        // a question of their own takes the first place; the suggested searches move down
        topic = { id: 't0', keyword: keywordFrom(question), question, volume: null, looked: '', edited: true };
        c.topics = [topic].concat(c.topics.filter((t) => squash(t.question) !== squash(question)).slice(0, topicCount() - 1)).map((t, i) => Object.assign(t, { id: 't' + i }));
      } else if (squash(question) !== squash(topic.question)) {
        if (!sameSubject(topic, question)) { topic.keyword = keywordFrom(question); topic.volume = null; topic.looked = ''; }
        topic.question = question; topic.edited = true;
      }
    }
    if (!topic) topic = c.topics[0];
    c.freeTopic = topic.id;
  };
  // tried on a copy first, to see whether search numbers are missing for the choice
  const trial = JSON.parse(JSON.stringify(now));
  choose(trial);
  const vols = needVolumes(trial) ? await searchVolumes(keywordsOf(trial), trial.ask.country, trial.ask.language, 5000) : null;
  let already = false;
  const check = await begin(id, 'free', list, null, (c) => {
    if (c.status !== 'draft') { already = true; return false; }
    choose(c);
    setVolumes(c, vols);
  });
  if (!check) return { error: 'This check no longer exists.', code: 'gone' };
  if (!already) await count('asked');
  return { ok: true, already };
}

// The paid report: every topic on every engine, chat engines twice, and the question about the business by name.
// Answers from the free check are kept when they are less than a day old.
async function runFull(id) {
  const list = engines.enabled();
  if (!list.length) return { error: 'The AI engines cannot be reached right now.' };
  const now = await get(id);
  if (!now) return { error: 'gone' };
  if (!now.topics.length) return { error: 'This check has no searches yet.' };
  const all = await results(id);
  const have = {};
  for (const [field, r] of Object.entries(all)) {
    if (r && r.ok && Date.now() - (r.at || 0) < DAY) have[field] = true; else await kv.command('HDEL', 'vrres:' + id, field);
  }
  // searches that have no numbers yet (looked up for another country, or the service was away) are looked up now
  const vols = needVolumes(now) ? await searchVolumes(keywordsOf(now), now.ask.country, now.ask.language) : null;
  await begin(id, 'full', list, have, (c) => {
    if (c.status === 'running' && c.phase === 'full') return false;
    if (!c.freeTopic) c.freeTopic = c.topics[0].id;
    setVolumes(c, vols);
  });
  return { ok: true };
}

/* ---------- reading one answer ---------- */

const srcOf = (own) => (s) => ({ url: String(s.url || '').slice(0, 400), title: clean(s.title, 120), host: analyze.cleanDomain(s.host || s.url), own: analyze.hostMatches(s.host || s.url, own) });

function brandEntity(check) { return { name: check.project.brand, aliases: check.project.aliases || [], domains: check.project.domains || [] }; }

// Google's AI answers link business cards (a place on Google, not a page anyone wrote). They are not counted as
// pages the answer was built from; whether one of them is the business's own card is worth a note of its own.
const CARD = /^https?:\/\/(?:www\.|maps\.)?google\.[a-z.]{2,8}\/(?:searchviewer|maps|search|travel|localservices)\b/i;
const isCard = (s) => CARD.test(String((s && s.url) || ''));

function readAnswer(check, unit, engine, ans) {
  const own = (check.project.domains || []).map(analyze.cleanDomain);
  const { out: textNorm } = analyze.normMap(ans.text);
  const cards = (ans.sources || []).concat(ans.consulted || []).filter(isCard);
  ans = Object.assign({}, ans, { sources: (ans.sources || []).filter((s) => !isCard(s)), consulted: (ans.consulted || []).filter((s) => !isCard(s)) });
  const names = [check.project.brand].concat(check.project.aliases || []).filter((x) => String(x || '').trim().length >= 3);
  const b = analyze.detect(brandEntity(check), textNorm, ans.sources);
  const a = analyze.analyzeAnswer(check.project, ans);
  const consulted = (ans.consulted || []).slice(0, 14).map(srcOf(own));
  return {
    card: cards.some((s) => { const t = analyze.normMap(String(s.title || '')).out; return names.some((n) => analyze.findTerm(t, n) >= 0); }),
    p: unit.id, k: unit.k, q: unit.q, e: engine, ok: true, at: Date.now(), ms: ans.ms, model: ans.model,
    text: ans.text.slice(0, 6000), queries: (ans.queries || []).slice(0, 6),
    mentioned: b.mentioned, idx: b.index, cited: b.cited, citedUrls: b.citedUrls, snippet: a.snippet,
    sources: (ans.sources || []).slice(0, 14).map(srcOf(own)), consulted,
    read: consulted.some((s) => s.own), // opened your site while answering, whether or not it cited it
    named: [], rank: 0, of: 0
  };
}

// "Drakes Hotel | A Curious Group of Hotels" is "Drakes Hotel": what follows a bar or a dash is a tagline.
function bareName(name) {
  const first = String(name || '').split(/\s+[|•·]\s+|\s+[–—-]\s+/)[0].trim();
  return first.length >= 3 ? first : String(name || '').trim();
}

// The businesses an answer names, when no AI call could list them: bold names and names that open a list item.
function namedByShape(text) {
  const out = [];
  const add = (n) => { n = clean(n, 80).replace(/[:.,;]+$/, ''); if (n.length >= 3 && n.length <= 60 && /^[\p{Lu}\d]/u.test(n) && n.split(' ').length <= 7 && !out.includes(n)) out.push(n); };
  for (const m of String(text).matchAll(/\*\*([^*\n]{3,70})\*\*/g)) add(m[1]);
  for (const m of String(text).matchAll(/^\s*(?:[-*•]|\d+[.)])\s+\[?([^\n:(\[\]]{3,60}?)\]?(?:\s[-:(]|:|$)/gm)) add(m[1].replace(/\*+/g, ''));
  return out.slice(0, 12).map((name) => ({ name: bareName(name), kind: 'business' }));
}

// The names an answer gives the customer. A 'business' is someone the customer could choose in place of the business
// being checked, a 'directory' a listing or review site the answer points to. A name such providers only use, stock or
// belong to (an implant maker in an answer about dental clinics, a regulator) is neither, and is left out: counted as
// a rival it would top the list of every clinic that works with it.
const aOrAn = (w) => (/^[aeiou]/i.test(w) ? 'an ' : 'a ') + w;
const kindOf = (k) => { const v = String(k || '').toLowerCase(); return v === 'directory' ? 'directory' : v === 'other' ? 'other' : 'business'; };
async function extractNamed(check, unit, text, budgetMs) {
  let list = null;
  if (llm.available() && budgetMs > 4000) {
    try {
      const brand = check.project.brand;
      const category = check.profile.category;
      const j = await llm.generateJSON({
        budgetMs: Math.min(budgetMs, 16000), timeoutMs: Math.min(budgetMs, 14000),
        system: 'You read an AI assistant\'s answer to a customer question and list the names it gives the customer, each with what it is. Copy each name exactly as written in the answer. Never add a name that is not in the answer.',
        prompt: `The customer is choosing ${aOrAn(category || 'business like ' + brand)}. ${brand} is one.\nCustomer question: ${clean(unit.text, 200)}\n\nAnswer:\n${String(text).slice(0, 4500)}\n\n` +
          'Return {"named": [{"name": "...", "kind": "rival"}]} in the order they first appear, at most 14. kind is one of three words.\n' +
          `"rival": a provider the customer could choose instead of ${brand}. That is another ${category || 'business of the same kind'}, or a brand or product that does the same job for the customer.\n` +
          '"directory": a listing, review, booking, marketplace or comparison site the answer points the customer to.\n' +
          '"other": a name that is not a choice between such providers. That is a manufacturer, supplier, material, component, technology, software or method that these providers use or sell (an implant maker in an answer about dental clinics, a coffee roaster in an answer about cafes), and any association, regulator, certificate or award.\n' +
          'Leave out anything that is only a part of another option (its bar, restaurant, spa or room types), and leave out places, landmarks, generic terms and publications that are only cited as sources. ' +
          'A name is a proper name: a company, a brand or a product with a name of its own. A plain description of a product, such as "editable welcome book template", is not a name. Give the brand or seller behind it when the answer names one (for "Evolve\'s free welcome book template" that is "Evolve"), otherwise leave it out.',
        maxTokens: 600
      });
      const arr = Array.isArray(j) ? j : (j && j.named);
      if (Array.isArray(arr)) list = arr.map((x) => ({ name: bareName(clean(x && x.name, 80)), kind: kindOf(x && x.kind) })).filter((x) => x.kind !== 'other');
    } catch (e) { /* the shape of the answer is read instead */ }
  }
  return list || namedByShape(text);
}

// Orders the names by where they first appear, drops any that are not in the answer and puts the business in its place.
function placeNamed(check, row, list) {
  const { out: textNorm } = analyze.normMap(row.text);
  const mine = [check.project.brand].concat(check.project.aliases || []).map(squash).filter((x) => x.length >= 3);
  const seen = new Set();
  const named = [];
  for (const x of list || []) {
    const key = squash(x.name);
    if (key.length < 3 || seen.has(key)) continue;
    if (mine.some((m) => key === m || (m.length >= 5 && key.includes(m)))) continue; // that is the business itself
    const idx = analyze.findTerm(textNorm, x.name);
    if (idx < 0) continue;
    seen.add(key);
    named.push({ name: x.name, kind: x.kind, idx });
  }
  if (row.mentioned) named.push({ name: check.project.brand, kind: 'business', idx: row.idx, you: true });
  named.sort((a, b) => a.idx - b.idx);
  const biz = named.filter((x) => x.kind === 'business');
  row.named = named.slice(0, 14).map((x) => (x.you ? { name: x.name, kind: x.kind, you: true } : { name: x.name, kind: x.kind }));
  row.of = biz.length;
  row.rank = row.mentioned ? biz.findIndex((x) => x.you) + 1 : 0;
  row.nx = true;
  return row;
}

/* ---------- doing the work ---------- */

async function doTask(check, task, deadline) {
  const [uid, engine, attemptRaw] = String(task).split('|');
  const attempt = parseInt(attemptRaw, 10) || 0;
  const unit = ((check.run && check.run.units) || []).find((u) => u.id === uid);
  const field = uid + '|' + engine;
  if (!unit) return 'skip';
  if (!(await store.takeCalls(1))) { await kv.rpush('vrq:' + check.id, task); return 'budget'; }
  const timeoutMs = Math.min(40000, Math.max(5000, deadline - Date.now() - 2000));
  const base = { p: uid, k: unit.k, q: unit.q, e: engine };
  try {
    const ans = await engines.ask(engine, unit.text, { country: check.ask.country, language: check.ask.language, timeoutMs });
    if (ans.none) { await saveResult(check, field, Object.assign(base, { ok: true, none: true, at: Date.now(), ms: ans.ms, model: ans.model })); return 'ok'; }
    const row = readAnswer(check, unit, engine, ans);
    await saveResult(check, field, row); // shown at once; the names of the others follow
    if (unit.k !== 'b') {
      const list = await extractNamed(check, unit, ans.text, deadline - Date.now() - 1500);
      await saveResult(check, field, placeNamed(check, row, list));
    }
    return 'ok';
  } catch (e) {
    if (e.message === 'timed out' && timeoutMs < 40000) { await kv.rpush('vrq:' + check.id, uid + '|' + engine + '|' + attempt + '|w'); return 'retry'; }
    const kind = await alerts.report(alerts.ENGINE_SERVICE[engine] || engine, e, 'answers from ' + (engines.LABEL[engine] || engine));
    if (e.retry && kind !== 'account' && attempt + 1 < MAX_ATTEMPTS) { await kv.rpush('vrq:' + check.id, uid + '|' + engine + '|' + (attempt + 1)); return 'retry'; }
    await saveResult(check, field, Object.assign(base, { ok: false, at: Date.now(), kind, err: String(e.message || e).slice(0, 200) }));
    return 'failed';
  }
}

const canStart = (task, msLeft) => String(task).split('|')[3] !== 'w' || msLeft >= FULL_WINDOW_MS;

// Works on one check until the time is used or its queue is empty. Engines run side by side, each within its own
// limit of calls at the same time.
async function work(id, deadline) {
  if (!(await lock('run:' + id, 60))) return { busy: true };
  const out = { ok: 0, failed: 0, retry: 0, budget: false };
  try {
    const check = await get(id);
    if (!check || check.status !== 'running') return out;
    const running = new Set();
    const busy = {};
    let queue = [];
    let empty = false;
    const engineOf = (t) => String(t).split('|')[1];
    const free = (t) => (busy[engineOf(t)] || 0) < (engines.PARALLEL[engineOf(t)] || 2);
    for (;;) {
      if (out.budget || deadline - Date.now() < 9000) break;
      const msLeft = deadline - Date.now();
      if (!empty && queue.length < 36 && !queue.some((t) => free(t) && canStart(t, msLeft))) {
        const more = await kv.lpopN('vrq:' + id, 12);
        if (!more.length) empty = true; else queue.push(...more);
      }
      for (let i = 0; i < queue.length; i++) {
        const engine = engineOf(queue[i]);
        if (!free(queue[i]) || !canStart(queue[i], deadline - Date.now())) continue;
        const task = queue.splice(i, 1)[0];
        i--;
        busy[engine] = (busy[engine] || 0) + 1;
        const p = doTask(check, task, deadline).then((r) => {
          if (r === 'ok') out.ok++; else if (r === 'failed') out.failed++; else if (r === 'retry') out.retry++; else if (r === 'budget') out.budget = true;
        }).catch((e) => { console.error('[vr] task', e && e.message); out.failed++; }).finally(() => { busy[engine]--; running.delete(p); });
        running.add(p);
      }
      if (!running.size) {
        if (!empty && queue.length < 36) continue;
        break;
      }
      await Promise.race(running);
    }
    await Promise.all(running);
    if (queue.length) await kv.rpush('vrq:' + id, ...queue);
    if (out.ok || out.failed) await touch(id);
  } finally { await unlock('run:' + id); }
  return out;
}

// When every answer is in (or the rest has been quiet for three minutes) the phase ends: the free check gets its
// preview, the paid one moves on to the steps that build the report.
async function maybeFinish(id) {
  const check = await get(id);
  if (!check || check.status !== 'running') return false;
  if ((await kv.llen('vrq:' + id)) > 0) return false;
  const done = await kv.hlen('vrres:' + id);
  const quiet = Date.now() - (await lastProgress(check)) >= STALE_MS;
  if (done < check.run.total && !quiet) return false;
  if (!(await lock('run:' + id, 60))) return false; // a worker may still hold the last answers
  let ended = '';
  try {
    if ((await kv.llen('vrq:' + id)) > 0) return false;
    const rows = await rowsOf(id);
    const fresh = await update(id, (c) => {
      if (c.status !== 'running') return false;
      ended = c.phase;
      if (c.phase === 'free') { c.preview = previewOf(c, rows); c.status = 'preview'; }
      else { c.status = 'finalizing'; c.work = { step: 0, tries: 0, errors: {} }; }
    });
    if (!fresh || !ended) return false;
    if (ended === 'free') { await kv.srem('vr:active', id); await count('preview'); }
    // paid while the free check was still running: the full report starts now
    if (ended === 'free' && fresh.paid) { await unlock('run:' + id); await runFull(id); }
  } finally { await unlock('run:' + id); }
  return true;
}

/* ---------- numbers ---------- */

// 'both' named and cited, 'named', 'cited' (your site is a source but you are not named), 'absent', 'none' (Google
// showed no AI answer), 'failed'.
function stateOf(r) {
  if (!r) return 'pending';
  if (!r.ok) return 'failed';
  if (r.none) return 'none';
  return r.mentioned && r.cited ? 'both' : r.mentioned ? 'named' : r.cited ? 'cited' : 'absent';
}
const isNamed = (s) => s === 'both' || s === 'named';
const answered = (r) => r && r.ok && !r.none && r.k !== 'b';

// "Drakes", "Drakes Hotel" and "Drakes of Brighton" are one business: the shorter name is how the longer one starts.
// A single short word ("Grand") is not enough to go on, and neither is a long name that merely starts the same way.
const nameWords = (name) => analyze.norm(name).split(' ').filter((w) => w && w !== 'the');
function sameBusiness(a, b) {
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (!s.length || s.join('').length < 6 || !s.every((w, i) => l[i] === w)) return false;
  return s.length >= 2 || l.length <= 3;
}

// Every other business the answers name, with the spellings merged ("The Lumiar House" and "Lumiar House").
function registry(rows, kind) {
  const list = [];
  for (const r of rows.filter(answered)) {
    const seen = new Set();
    for (const x of r.named || []) {
      if (x.you || (x.kind || 'business') !== kind) continue;
      const key = squash(x.name);
      if (key.length < 3) continue;
      let hit = list.find((c) => c.keys.includes(key));
      if (!hit) hit = list.find((c) => c.keys.some((k) => { const [s, l] = k.length <= key.length ? [k, key] : [key, k]; return s.length >= 5 && l.includes(s) && s.length / l.length >= 0.6; }));
      const words = nameWords(x.name);
      if (!hit) hit = list.find((c) => c.words.some((w) => sameBusiness(w, words)));
      if (!hit) { hit = { keys: [], words: [], names: {}, n: 0, first: 0, topics: new Set() }; list.push(hit); }
      if (!hit.keys.includes(key)) { hit.keys.push(key); hit.words.push(words); }
      hit.names[x.name] = (hit.names[x.name] || 0) + 1;
      if (seen.has(hit)) continue;
      seen.add(hit);
      hit.n++;
      hit.topics.add(r.k);
      const biz = (r.named || []).filter((y) => (y.kind || 'business') === 'business');
      if (biz[0] && squash(biz[0].name) === key) hit.first++;
    }
  }
  return list.map((c) => ({ name: Object.entries(c.names).sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0], variants: Object.keys(c.names), n: c.n, first: c.first, topics: c.topics.size }))
    .sort((a, b) => b.n - a.n || b.first - a.first || a.name.localeCompare(b.name));
}

function tally(rows) {
  const ok = rows.filter(answered);
  const n = ok.length;
  const m = ok.filter((r) => r.mentioned).length;
  const c = ok.filter((r) => r.cited).length;
  const first = ok.filter((r) => r.mentioned && r.rank === 1).length;
  const rankSum = ok.reduce((a, r) => a + (r.mentioned && r.rank ? 1 / r.rank : 0), 0);
  const mention = n ? m / n : 0, cite = n ? c / n : 0, rank = n ? rankSum / n : 0;
  return {
    answers: n, named: m, cited: c, first,
    none: rows.filter((r) => r && r.ok && r.none).length, failed: rows.filter((r) => r && !r.ok && r.k !== 'b').length,
    mention, cite, rank,
    score: Math.round(100 * (0.5 * mention + 0.3 * cite + 0.2 * rank))
  };
}

function distinctSources(rows) {
  const urls = new Set();
  for (const r of rows.filter(answered)) for (const s of (r.sources || []).concat(r.consulted || [])) urls.add(s.url ? s.url.replace(/[?#].*$/, '').replace(/\/+$/, '') : s.host);
  return urls.size;
}
function topQueries(rows, n) {
  const count = {};
  for (const r of rows.filter(answered)) for (const q of r.queries || []) { const k = String(q).toLowerCase().replace(/\s+/g, ' ').trim(); if (k) { count[k] = count[k] || { q, n: 0 }; count[k].n++; } }
  return Object.values(count).sort((a, b) => b.n - a.n).slice(0, n || 12);
}

// What the free check shows, and how much the paid report holds (real counts, nothing invented).
function previewOf(check, rows) {
  const t = tally(rows);
  const found = findingsOf(check.site);
  const rivals = registry(rows, 'business');
  return {
    at: Date.now(), topic: check.freeTopic,
    answers: t.answers, named: t.named, cited: t.cited, none: t.none, failed: t.failed,
    rivals: rivals.slice(0, 6).map((r) => ({ name: r.name, n: r.n })),
    dirs: registry(rows, 'directory').slice(0, 4).map((r) => ({ name: r.name, n: r.n })),
    sources: distinctSources(rows), queries: topQueries(rows, 20).length,
    findings: found.length, worst: found[0] ? { title: found[0].title, detail: found[0].detail, sev: found[0].sev } : null,
    quick: found.filter((f) => ['robots_blocks_ai', 'meta_weak', 'llms_missing', 'org_schema_missing', 'faq_no_schema'].includes(f.code)).length,
    fixes: found.filter((f) => f.code !== 'thin_home' && f.code !== 'faq_no_schema').length // each of these becomes a fix; the answers add more
  };
}

/* ---------- the paid report, step by step ---------- */

const KNOWN_HOSTS = [
  [/(^|\.)(yelp|tripadvisor|trustpilot|booking|expedia|hotels|agoda|airbnb|opentable|thefork|zomato|foursquare|yell|bbb|angi|houzz|thumbtack|checkatrade|trustatrader|clutch|g2|capterra|getapp|sortlist|goodfirms|producthunt|whatclinic|doctify|healthgrades|zocdoc|avvo|justdial|glassdoor|indeed|treatwell|fresha|booksy|vrbo|kayak|hostelworld|viator|getyourguide|michelin|yellowpages)\./, 'Listing or review site'],
  [/(^|\.)(reddit|quora|stackexchange|stackoverflow|mumsnet)\./, 'Forum'],
  [/(^|\.)wikipedia\.org$/, 'Encyclopedia'],
  [/(^|\.)(youtube|instagram|facebook|tiktok|linkedin|x|twitter|pinterest|threads)\.(com|net)$/, 'Social network'],
  [/(^|\.)(google)\.[a-z.]+$/, 'Google']
];
const KIND = { rival: 'A rival\'s own site', listing: 'Listing or review site', article: 'Article or guide', forum: 'Forum', official: 'Official body', supplier: 'A supplier\'s site' };
// Pages nobody can be added to: the own website of another business. Being absent from them is not a gap.
const THEIRS = new Set([KIND.rival, KIND.supplier]);
// What can be done about a page the business is not on, by what the page is. Nothing for the kinds left out.
const PAGE_ACT = { [KIND.listing]: 'claim or create your listing', [KIND.forum]: 'answer the thread honestly, as the business', [KIND.official]: 'see whether its register or member list can include you', [KIND.article]: 'ask the editor to add you' };
function hostKind(host, rivalKeys, dirKeys) {
  const h = String(host || '').toLowerCase();
  for (const [re, label] of KNOWN_HOSTS) if (re.test(h)) return label;
  const key = h.replace(/^www\./, '').replace(/\.[a-z.]{2,8}$/, '').replace(/[^a-z0-9]/g, '');
  const near = (k) => k.includes(key) || key.includes(k);
  // a listing site the answers pointed customers to is one here too, whether or not the list above knows it
  if (key.length >= 5 && (dirKeys || []).some(near)) return KIND.listing;
  if (key.length >= 5 && rivalKeys.some(near)) return KIND.rival;
  return KIND.article;
}

// The pages no list knows are told apart by a model, from address and title alone: another provider's own website, a
// listing site, an article, a forum, an official body or a supplier. Without an answer in time they stay as they are.
async function sortPages(check, pages, ms) {
  const open = pages.filter((p) => p.kind === KIND.article);
  if (!open.length || !llm.available() || !(ms >= 3000)) return;
  const what = check.profile.category || 'business like ' + check.project.brand;
  try {
    const j = await llm.generateJSON({
      budgetMs: Math.min(ms, 12000), timeoutMs: Math.min(ms, 10000),
      system: 'You sort web pages by what they are, from their address and title alone. When you cannot tell, you say "article".',
      prompt: `A customer is choosing ${aOrAn(what)}. An AI assistant read these pages to answer them:\n` + open.map((p, i) => `${i + 1}. ${p.host}${p.title ? ' | ' + clean(p.title, 90) : ''}`).join('\n') +
        '\n\nReturn {"pages": [{"n": 1, "kind": "..."}]} with one kind for every page:\n' +
        `"rival": the own website of one ${what}, a provider the customer could choose\n` +
        '"listing": a directory, marketplace, booking, review or comparison site that lists many providers\n' +
        '"article": an article, blog post, guide or news page by a publisher\n' +
        '"forum": a forum or community thread\n' +
        '"official": a regulator, professional association, government or standards body\n' +
        '"supplier": the own website of a manufacturer, supplier or software maker whose products such providers use',
      maxTokens: 400
    });
    for (const x of (j && Array.isArray(j.pages) ? j.pages : [])) {
      const page = open[parseInt(x && x.n, 10) - 1];
      const kind = KIND[String((x && x.kind) || '').toLowerCase()];
      if (page && kind) page.kind = kind;
    }
  } catch (e) { console.error('[vr] page kinds', e.message); }
}

// The pages the engines read to answer, most used first. The ones we can open are read for the business and its rivals.
async function stepReading(check, rows, deadline) {
  const own = (check.project.domains || []).map(analyze.cleanDomain);
  const rivals = registry(rows, 'business').slice(0, 8);
  const rivalKeys = rivals.flatMap((r) => r.variants.map(squash)).filter((k) => k.length >= 5);
  const dirKeys = registry(rows, 'directory').flatMap((r) => r.variants.map(squash)).filter((k) => k.length >= 5);
  const map = new Map();
  for (const r of rows.filter(answered)) {
    const add = (s, cited) => {
      if (!s.host || s.own || analyze.hostMatches(s.host, own)) return;
      const redirect = /vertexaisearch\.cloud\.google|google\.com\/url/.test(s.url || '');
      const url = !s.url || redirect ? '' : s.url.replace(/#.*$/, '').replace(/[?&](utm_[a-z]+|srsltid|gclid|fbclid)=[^&]*/gi, '').replace(/[?&]$/, '');
      const key = url ? url.replace(/\/+$/, '').toLowerCase() : 'host:' + s.host;
      const p = map.get(key) || { url, host: s.host, title: s.title || '', answers: new Set(), cited: new Set(), engines: new Set() };
      p.answers.add(r.p + '|' + r.e); p.engines.add(r.e);
      if (cited) p.cited.add(r.p + '|' + r.e);
      if (!p.title && s.title) p.title = s.title;
      map.set(key, p);
    };
    for (const s of r.sources || []) add(s, true);
    for (const s of r.consulted || []) add(s, false);
  }
  // Some engines give only the site of a source, not the page. When another engine named a page on that site, the
  // two are counted together (most likely the same page); otherwise the site stands as its own row.
  for (const [key, p] of [...map.entries()]) {
    if (p.url) continue;
    const same = [...map.values()].filter((x) => x.url && x.host === p.host).sort((a, b) => b.answers.size - a.answers.size)[0];
    if (!same) continue;
    for (const a of p.answers) same.answers.add(a);
    for (const a of p.cited) same.cited.add(a);
    for (const e of p.engines) same.engines.add(e);
    map.delete(key);
  }
  const pages = [...map.values()].map((p) => ({ url: p.url, host: p.host, title: clean(p.title && p.title !== p.host ? p.title : '', 110), n: p.answers.size, cited: p.cited.size, engines: [...p.engines], kind: hostKind(p.host, rivalKeys, dirKeys), status: p.url ? 'pending' : 'host', you: null, rivals: [] }))
    .sort((a, b) => b.cited - a.cited || b.n - a.n || a.host.localeCompare(b.host)).slice(0, 14);
  const mine = brandEntity(check);
  const toOpen = pages.filter((p) => p.url && /^https?:\/\//i.test(p.url) && !/\.(pdf|docx?|xlsx?|pptx?|zip)$/i.test(p.url.split('?')[0])).slice(0, 10);
  const sorting = sortPages(check, pages, deadline - Date.now() - 2500);
  await Promise.all(toOpen.map(async (p) => {
    const ms = Math.min(7000, deadline - Date.now() - 1500);
    if (ms < 2000) { p.status = 'skipped'; return; }
    let host = '';
    try { host = new URL(p.url).host; } catch (e) { p.status = 'unreachable'; return; }
    const r = await fetcher.getText(p.url, { allowedHosts: [host, 'www.' + host.replace(/^www\./, '')], timeoutMs: ms, maxBytes: 900000 });
    if (!r.ok || !r.text) { p.status = [401, 403, 429, 451, 503].includes(r.status) ? 'refused' : 'unreachable'; return; }
    const body = String(r.text).replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ');
    const { out: textNorm } = analyze.normMap(auditLib.stripTags(body).slice(0, 400000));
    if (textNorm.length < 200) { p.status = 'empty'; return; }
    p.status = 'read';
    p.you = analyze.detect(mine, textNorm, []).mentioned;
    p.rivals = rivals.filter((rv) => rv.variants.some((v) => analyze.findTerm(textNorm, v) >= 0)).map((rv) => rv.name).slice(0, 6);
    if (!p.title) { const t = String(r.text).match(/<title\b[^>]*>([\s\S]*?)<\/title>/i); if (t) p.title = clean(auditLib.stripTags(t[1]), 110); }
  }));
  await sorting;
  for (const p of pages) { if (p.status === 'pending') p.status = 'skipped'; p.theirs = THEIRS.has(p.kind); }
  const read = pages.filter((p) => p.status === 'read');
  // a rival is on its own website as a matter of course, so who is "on the most pages" is counted on the others
  const count = {};
  for (const p of read.filter((x) => !x.theirs)) for (const name of p.rivals) count[name] = (count[name] || 0) + 1;
  const top = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
  return { pages, opened: read.length, theirs: read.filter((p) => p.theirs).length, you: read.filter((p) => p.you).length, top: top ? { name: top[0], n: top[1] } : null };
}

async function stepAudit(check, deadline) {
  if (!check.site.read.ok) return null;
  const host = check.host.replace(/:\d+$/, '');
  const a = await auditLib.auditSite({ url: check.url, domains: [host, 'www.' + host] }, [{ publishedPath: '/', title: '' }], { maxPages: 8, budgetMs: Math.max(4000, Math.min(15000, deadline - Date.now() - 3000)) });
  return {
    at: a.at, score: a.score, origin: a.origin, site: a.site,
    pages: a.pages.slice(0, 8).map((p) => ({ path: p.path, ok: p.ok, status: p.status, title: clean(p.title, 120), description: clean(p.description, 200), words: p.words || 0, h1: (p.h1 || []).slice(0, 1), schemaTypes: (p.schemaTypes || []).slice(0, 6), issues: p.issues || [], score: p.score, noindex: !!p.noindex, error: p.error || '' }))
  };
}

// What the engines say when asked about the business by name, read against the website's own words.
async function stepInsights(check, rows, deadline) {
  const out = { probe: null, says: null };
  const probes = rows.filter((r) => r && r.k === 'b');
  const okProbes = probes.filter((r) => r.ok && !r.none && r.text);
  const fallback = () => okProbes.map((r) => ({
    e: r.e,
    knows: (r.mentioned || r.cited) && !/\b(could ?n[o']t find|no (reliable |specific |verified )?information|not aware of|unable to (find|locate)|don'?t have (any )?(specific )?information|no results)\b/i.test(r.text.slice(0, 500)) ? (r.cited ? 'yes' : 'partly') : 'no',
    says: clean(r.text.replace(/[#*_`>]/g, ''), 220)
  }));
  const budget = () => Math.max(3000, Math.min(22000, deadline - Date.now() - 2500));
  const jobs = [];
  if (okProbes.length && llm.available()) {
    jobs.push(llm.generateJSON({
      budgetMs: budget(), timeoutMs: Math.min(20000, budget()),
      system: 'You compare what AI assistants say about a business with what the business says about itself on its own website. Judge only from the texts given. Never invent. No em dashes.',
      prompt: `Business: ${check.project.brand}${check.profile.category ? ', a ' + check.profile.category : ''}${check.profile.place ? ' in ' + check.profile.place : ''}\nWebsite: ${check.host}\n` +
        `What the website says: ${clean(check.site.title, 160)}. ${clean(check.site.description, 300)} ${clean(check.site.text, 1600)}\n\n` +
        okProbes.map((r) => `Answer from ${r.e}:\n${clean(r.text, 1100)}`).join('\n\n') +
        '\n\nReturn {"engines": [{"engine": "the engine id exactly as given", "knows": "yes, partly, no or other", "says": "one plain sentence under 160 characters on what this answer says the business is"}], ' +
        '"check": [{"claim": "a specific statement about the business from an answer, under 140 characters", "engine": "engine id", "why": "contradicts or not on site"}]}\n' +
        '"knows" is yes when the answer describes this business correctly, partly when it is vague or hedged, no when it says it cannot find the business, and other when it describes a different business with a similar name. ' +
        '"check" lists at most 4 statements, such as prices, addresses, opening hours, founding years, awards or services, that contradict the website text or that the website text does not support.',
      maxTokens: 900
    }).then((j) => {
      const byId = {};
      for (const x of (j && Array.isArray(j.engines) ? j.engines : [])) if (x && x.engine) byId[String(x.engine).toLowerCase()] = x;
      out.probe = {
        engines: okProbes.map((r) => { const x = byId[r.e]; return { e: r.e, knows: x && ['yes', 'partly', 'no', 'other'].includes(String(x.knows)) ? String(x.knows) : fallback().find((f) => f.e === r.e).knows, says: clean(x && x.says, 200) || clean(r.text.replace(/[#*_`>]/g, ''), 200) }; }),
        check: (j && Array.isArray(j.check) ? j.check : []).map((c) => ({ claim: clean(c && c.claim, 180), engine: okProbes.some((r) => r.e === String(c && c.engine).toLowerCase()) ? String(c.engine).toLowerCase() : '', why: /contradict/i.test(String(c && c.why)) ? 'contradicts' : 'unsupported' })).filter((c) => c.claim.length > 8).slice(0, 4),
        judged: true
      };
    }).catch((e) => { console.error('[vr] probe', e.message); }));
  }
  jobs.push(insights.describe({ project: check.project }, rows.filter(answered)).then((d) => { out.says = d; }).catch((e) => { console.error('[vr] says', e.message); }));
  await Promise.all(jobs);
  if (!out.probe && probes.length) out.probe = { engines: fallback(), check: [], judged: false };
  if (out.probe) for (const r of probes) if (!okProbes.includes(r)) out.probe.engines.push({ e: r.e, knows: 'failed', says: '' });
  return out;
}

// Drafts for the fix kit, written only from the website's own words.
async function stepAssets(check, rows, audit, deadline) {
  const out = {};
  const p = check.project;
  const s = check.site;
  if (!llm.available() || !s.read.ok) return out;
  const page = { path: '/', title: s.title, description: s.description, h1: s.h1, text: s.text, lang: s.lang };
  const weakest = weakestTopic(check, rows);
  const budget = () => Math.max(3000, Math.min(24000, deadline - Date.now() - 2500));
  const lang = fixes.langName(s.lang || p.language);
  const facts = `Business: ${p.brand}${check.profile.category ? ', a ' + check.profile.category : ''}${check.profile.place ? ' in ' + check.profile.place : ''}\nWebsite: ${check.url}\nTitle: ${clean(s.title, 160)}\nDescription: ${clean(s.description, 300)}\nText on the home page: ${clean(s.text, 2600)}`;
  const RULES = 'Write plainly. Never invent facts, prices, awards, numbers or guarantees that are not in the source text. No emojis, no exclamation marks, no em dashes.';
  const safe = (name, promise) => promise.then((v) => { out[name] = v; }).catch((e) => { console.error('[vr] asset ' + name, e.message); });
  await Promise.all([
    safe('faq', fixes.suggestFaq(p, page, check.topics.map((t) => t.question))),
    safe('meta', fixes.suggestMeta(p, page, weakest ? weakest.keyword : '')),
    weakest ? safe('page', fixes.suggestNewPage(p, weakest.keyword, [weakest.question], s.text)) : null,
    safe('about', llm.generateJSON({
      budgetMs: budget(), timeoutMs: Math.min(22000, budget()),
      system: `You write the short factual description of a business that AI assistants can quote, and you copy its contact facts. ${RULES}`,
      prompt: `${facts}\n\nReturn {"about": "50 to 75 words in ${lang}: who the business is, what it offers, where and for whom, in the third person, starting with the business name", ` +
        '"type": "one of Organization, LocalBusiness, ProfessionalService, Dentist, MedicalClinic, BeautySalon, HealthAndBeautyBusiness, Restaurant, Store, RealEstateAgent, LegalService, EducationalOrganization", ' +
        '"phone": "", "email": "", "street": "", "city": "", "region": "", "postal": "", "country": ""}\nFill the contact fields only with values written in the text above. Leave a field empty when the text does not give it.',
      maxTokens: 500
    }).then((j) => ({ about: clean(j.about, 600), type: clean(j.type, 40), phone: clean(j.phone, 40), email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(j.email || '')) ? clean(j.email, 120) : '', street: clean(j.street, 160), city: clean(j.city, 80), region: clean(j.region, 80), postal: clean(j.postal, 20), country: clean(j.country, 60) }))),
    safe('pitch', llm.generate({
      timeoutMs: Math.min(22000, budget()),
      system: `You write a short, polite email from a business owner to the editor of a web page that lists options in the owner's field. ${RULES}`,
      prompt: `${facts}\n\nWrite the email in ${lang}, under 110 words. It asks the editor to consider adding ${p.brand} to their page, and gives two or three facts from the text above that would help their readers. No flattery and no promises. Start with a greeting, end with [your name]. Use [their page] where the page title goes. Return only the email text.`,
      maxTokens: 400
    }).then((t) => String(t || '').replace(/[–—]/g, ', ').trim().slice(0, 1200)))
  ].filter(Boolean));
  return out;
}

function topicNumbers(check, rows) {
  return check.topics.map((t) => {
    const rs = rows.filter((r) => r && r.k === t.id);
    const ok = rs.filter(answered);
    return { id: t.id, question: t.question, keyword: t.keyword, volume: typeof t.volume === 'number' ? t.volume : null, answers: ok.length, named: ok.filter((r) => r.mentioned).length, cited: ok.filter((r) => r.cited).length };
  });
}
// The search to work on first: where the most searches end with an answer that leaves the business out. Without
// search numbers it is the search with the smallest share of answers naming the business.
function weakestTopic(check, rows) {
  const list = topicNumbers(check, rows).filter((t) => t.answers);
  if (!list.length) return check.topics[0] || null;
  const missed = (t) => (t.volume || 0) * (1 - t.named / t.answers);
  if (list.some((t) => missed(t) > 0)) return list.sort((a, b) => missed(b) - missed(a) || a.named / a.answers - b.named / b.answers)[0];
  return list.sort((a, b) => a.named / a.answers - b.named / b.answers || b.answers - a.answers)[0];
}

// The demand behind a report: monthly Google searches in the customers' country. top is the most searched search, gap
// the one where the most searches meet an answer without the business. Nothing here says how often AI is asked.
function demandOf(check, matrix) {
  const rows = check.topics.map((t) => { const m = (matrix || []).find((x) => x.topic === t.id) || { named: 0, answers: 0 }; return { topic: t.id, keyword: t.keyword, volume: typeof t.volume === 'number' ? t.volume : null, named: m.named, answers: m.answers }; });
  const known = rows.filter((r) => r.volume != null);
  const out = { country: check.ask.country, known: known.length, of: rows.length, total: known.reduce((a, r) => a + r.volume, 0), top: null, gap: null };
  if (!known.length) return out;
  out.top = known.slice().sort((a, b) => b.volume - a.volume)[0];
  const missed = (r) => r.volume * (1 - r.named / r.answers);
  const gap = known.filter((r) => r.answers && r.named < r.answers && r.volume > 0).sort((a, b) => missed(b) - missed(a))[0];
  out.gap = gap || null;
  return out;
}

/* ---------- the report ---------- */

function ladderOf(check, t, probe) {
  const s = check.site;
  const searchBots = auditLib.BOTS.filter((b) => b.kind === 'search');
  const blocked = s.blockedBots.filter((ua) => searchBots.some((b) => b.ua === ua));
  const open = searchBots.length - blocked.length;
  const rungs = [];
  // p: how much of the rung holds, 0 to 1 (drawn as the filled part of its edge)
  rungs.push({
    id: 'readable', name: 'Readable', q: 'Can AI crawlers open and read your site?',
    state: !s.read.ok || s.words < 120 || blocked.length >= 3 ? 'no' : blocked.length || s.words < 300 ? 'partly' : 'yes',
    p: !s.read.ok ? 0 : (open / searchBots.length) * (s.words >= 300 ? 1 : s.words >= 120 ? 0.6 : 0.2),
    evidence: !s.read.ok ? 'Your site refused our reader, so crawlers likely meet the same wall.' : `${s.words.toLocaleString('en-US')} words in the page code, ${open} of ${searchBots.length} AI search crawlers allowed in.`
  });
  const pe = ((probe && probe.engines) || []).filter((x) => x.knows !== 'failed');
  const yes = pe.filter((x) => x.knows === 'yes').length, partly = pe.filter((x) => x.knows === 'partly').length, other = pe.filter((x) => x.knows === 'other').length;
  rungs.push({
    id: 'known', name: 'Known', q: 'Does AI know who you are when asked by name?',
    state: !pe.length ? 'unknown' : yes >= Math.ceil(pe.length * 0.75) ? 'yes' : yes + partly > 0 ? 'partly' : 'no',
    p: pe.length ? (yes + 0.5 * partly) / pe.length : 0,
    evidence: !pe.length ? 'The engines could not be asked about you by name this time.' : `${yes} of ${pe.length} engines describe you correctly when asked by name` + (other ? `, ${other} ${other === 1 ? 'confuses' : 'confuse'} you with another business.` : '.')
  });
  const n = t.answers;
  rungs.push({ id: 'named', name: 'Named', q: 'Does AI name you when customers ask for what you sell?', state: !n ? 'unknown' : t.mention >= 0.5 ? 'yes' : t.named ? 'partly' : 'no', p: t.mention, evidence: `Named in ${t.named} of ${n} answers.` });
  rungs.push({ id: 'cited', name: 'Cited', q: 'Does AI use your website as a source?', state: !n ? 'unknown' : t.cite >= 0.3 ? 'yes' : t.cited ? 'partly' : 'no', p: t.cite, evidence: `Your site is a source in ${t.cited} of ${n} answers.` });
  rungs.push({ id: 'first', name: 'First', q: 'Are you the first name in the answer?', state: !n ? 'unknown' : t.first / n >= 0.3 ? 'yes' : t.first ? 'partly' : 'no', p: n ? t.first / n : 0, evidence: `First name in ${t.first} of ${n} answers.` });
  for (const r of rungs) r.p = Math.round(Math.max(0, Math.min(1, r.p || 0)) * 100) / 100;
  const start = rungs.find((r) => r.state === 'no' || r.state === 'partly');
  return { rungs, start: start ? start.id : '' };
}

function matrixOf(check, rows, list) {
  return check.topics.map((t) => {
    const cells = list.map((e) => {
      const search = SEARCH.includes(e);
      const units = search ? ['k'] : ['0', '1'];
      return { e, samples: units.map((q) => stateOf(rows.find((r) => r && r.k === t.id && r.q === q && r.e === e))) };
    });
    const flat = cells.flatMap((c) => c.samples).filter((s) => !['none', 'failed', 'pending'].includes(s));
    return { topic: t.id, cells, named: flat.filter(isNamed).length, answers: flat.length };
  });
}

const jsonLd = (nodes) => JSON.stringify({ '@context': 'https://schema.org', '@graph': nodes.filter(Boolean) }, null, 2);

// The fix kit: what to change, why (from this site's own findings), who does it, how long it takes, and the text or
// code to paste. Biggest win for the least work first.
function fixesOf(check, rows, ctx) {
  const { reading, audit, assets, probe, t } = ctx;
  const s = check.site;
  const p = check.project;
  const found = findingsOf(s);
  const has = (code) => found.find((f) => f.code === code);
  const out = [];
  const add = (f) => out.push(Object.assign({ who: 'web', minutes: 15, impact: 2, steps: [], asset: null, ai: false, note: '' }, f));
  const weakest = weakestTopic(check, rows);

  if (has('blocked')) add({ id: 'blocked', rung: 'readable', impact: 3, minutes: 30, title: 'Let crawlers through your firewall', why: `${check.host} answered our reader with ${s.read.status ? 'HTTP ' + s.read.status : s.read.error}. A wall that turns every bot away also stops the crawlers that fetch pages for AI answers.`, steps: ['Open your firewall or bot protection settings (Cloudflare, Sucuri, your host).', 'Allow verified AI search crawlers: OAI-SearchBot, ChatGPT-User, PerplexityBot, Claude-SearchBot, Googlebot and Bingbot.', 'Run this check again to confirm the site opens.'] });
  const rb = has('robots_blocks_ai');
  if (rb) add({ id: 'robots', rung: 'readable', impact: 3, minutes: 5, title: 'Let AI search crawlers into robots.txt', why: `Your robots.txt shuts out ${andList(rb.bots)}. ${rb.bots.length === 1 ? 'This crawler fetches' : 'These crawlers fetch'} pages when someone asks an AI engine a question, so a block here keeps you out of the answer.`, steps: ['Open robots.txt at the root of your site.', rb.bots.length === 1 ? 'Remove the Disallow rule for this crawler, or add the lines below above your other rules.' : 'Remove the Disallow rules for these crawlers, or add the lines below above your other rules.', 'Training crawlers (GPTBot, ClaudeBot, Google-Extended) are a separate choice. Blocking them does not hide you from answers.'], asset: { kind: 'code', lang: 'robots.txt', label: 'Lines for robots.txt', body: fixes.robotsLines(rb.bots).trim() } });
  if (has('empty_html')) add({ id: 'empty', rung: 'readable', impact: 3, minutes: 240, title: 'Put your words in the page code', why: `A crawler that opens your home page reads ${s.words} words. ${s.appShell ? 'The rest is drawn by JavaScript, which most AI crawlers do not run.' : 'There is almost nothing to quote.'}`, steps: ['Ask your web person to render the page on the server (server-side rendering or static export) so the text is in the HTML.', 'Check it yourself: open the page, choose View Source and search for a sentence from your home page.', 'Until then, AI engines know you only from what other sites say.'] });
  if (has('not_https')) add({ id: 'https', rung: 'readable', impact: 2, minutes: 30, title: 'Move the site to HTTPS', why: 'The site opens over plain HTTP. Engines prefer sources they can verify.', steps: ['Turn on the free certificate at your host.', 'Redirect every http address to its https version.'] });

  const org = assets && assets.about;
  if (has('org_schema_missing')) {
    const info = { type: org && org.type, name: p.brand, url: check.url, logo: fixes.abs(s.og.image || s.icon, check.url), description: (org && org.about) || s.description, phone: org && org.phone, email: org && org.email, street: org && org.street, city: org && org.city, region: org && org.region, postal: org && org.postal, country: org && org.country, sameAs: s.socials };
    add({ id: 'org', rung: 'known', impact: 3, minutes: 10, title: 'Say who you are in the format engines read', why: 'Your home page has no Organization markup. An engine has to guess your name, what you are and where from loose text, and guesses are where mix-ups start.', steps: ['Paste the block below into the <head> of your home page.', 'Add your phone, address and opening hours if they are missing from it.', 'Test it at validator.schema.org.'], ai: !!org, asset: { kind: 'code', lang: 'JSON-LD', label: 'Organization markup', body: '<script type="application/ld+json">\n' + jsonLd([fixes.orgSchema(info), fixes.websiteSchema(info)]) + '\n</script>' } });
  }
  const knows = ((probe && probe.engines) || []).filter((x) => x.knows !== 'failed');
  const unknown = knows.filter((x) => x.knows === 'no' || x.knows === 'other' || x.knows === 'partly');
  if (org && org.about && (unknown.length || !s.description)) add({ id: 'about', rung: 'known', impact: unknown.length ? 3 : 2, minutes: 10, who: 'you', title: 'Give AI one paragraph it can quote about you', why: unknown.length ? `${andList(unknown.map((x) => engines.LABEL[x.e] || x.e))} could not say clearly who you are. Engines repeat the plainest description they find, so write it for them.` : 'Engines repeat the plainest description of a business they can find. Yours is spread across the page.', steps: ['Put this paragraph near the top of your home page or About page, as plain text.', 'Use the same wording on your Google Business Profile and directory listings, so every source agrees.'], ai: true, asset: { kind: 'text', lang: 'Text', label: 'About paragraph', body: org.about } });

  // Pages the engines read and the business is not on. Another business's own website is not a gap, and nothing can be
  // asked of a social network or an encyclopedia, so the steps name only pages where something can be done.
  const read = ((reading && reading.pages) || []).filter((x) => x.status === 'read');
  const open = read.filter((x) => !x.theirs);
  const missing = open.filter((x) => x.you === false && PAGE_ACT[x.kind]);
  if (missing.length) {
    const withRivals = missing.filter((x) => x.rivals.length);
    const list = (withRivals.length ? withRivals : missing).slice(0, 4);
    const theirs = read.length - open.length;
    const onThem = open.filter((x) => x.you).length;
    const count = theirs
      ? `Of the ${read.length} we could open, ${theirs === 1 ? 'one is another business\'s own website' : (NUMBER[theirs] || theirs) + ' are other businesses\' own websites'}. On the other ${open.length} you are named ${onThem ? 'on ' + onThem : 'on none'}.`
      : `Of the ${read.length} we could open, you are on ${onThem}.`;
    add({ id: 'listings', rung: 'named', impact: 3, minutes: 45, who: 'you', title: 'Get onto the pages AI reads', why: `The engines built their answers from ${reading.pages.length} pages. ${count}` + (reading.top ? ` ${reading.top.name} is on ${reading.top.n}.` : '') + ' An engine can only name businesses it finds in what it reads.', steps: list.map((x) => `${x.host}${x.rivals.length ? ' names ' + andList(x.rivals.slice(0, 3)) + ', not you' : ' does not mention you'}: ${PAGE_ACT[x.kind]}.`), ai: !!(assets && assets.pitch), asset: assets && assets.pitch ? { kind: 'text', lang: 'Email', label: 'Note to an editor', body: assets.pitch } : null, links: list.map((x) => ({ url: x.url, host: x.host })) });
  }
  if (weakest && weakest.answers && weakest.named < weakest.answers) {
    const pg = assets && assets.page;
    const lead = `For the search "${weakest.keyword}"${weakest.volume ? ` (about ${weakest.volume.toLocaleString('en-US')} Google searches a month in ${COUNTRY[check.ask.country] || 'your customers\' country'})` : ''} you are named in ${weakest.named} of ${weakest.answers} answers.`;
    // Is one of the pages we read on the site already about this search? Its words in the address, title or main heading.
    const pagesRead = ((audit && audit.pages) || []).filter((x) => x.ok);
    const own = kwLib.matchPage(weakest.keyword, pagesRead);
    const faqText = pg ? (pg.faq || []).map((x) => `${x.q}\n${x.a}`).join('\n\n') : '';
    if (own && own.score >= 0.75) {
      const which = own.path === '/' ? 'Your home page' : 'Your page ' + own.path;
      add({ id: 'page', rung: 'named', impact: 3, minutes: 45, who: 'you', title: 'Make your page for this search the one AI quotes', why: `${lead} ${which} is already about this search, so a new page is not what is missing. Engines lift the plain answer they find near the top of a page, and they name the businesses they meet on the pages they read.`, steps: [`Put the customer question on that page as a heading: "${weakest.question}"`, 'Answer it in the first two sentences under that heading, as plain text, then add the detail, prices or steps a customer needs.'].concat(missing.length ? ['Then work on the pages the engines read, the fix above: most of these answers are built from them.'] : []), ai: !!pg, asset: pg ? { kind: 'text', lang: 'Draft', label: 'Section draft', body: `${pg.intro}\n\n${faqText}`.trim() } : null });
    } else {
      const seen = pagesRead.length > 1 ? `None of the ${pagesRead.length} pages we read on your site is about it, so engines have nothing of yours to lift.` : 'A page that answers it in your own words gives engines something of yours to lift.';
      add({ id: 'page', rung: 'named', impact: 3, minutes: 90, who: 'you', title: 'Publish a page for the search you are missing', why: `${lead} ${seen}`, steps: [`Create one page for this search, with the customer question as its heading: "${weakest.question}"`, 'Answer it in the first two sentences, then add detail, prices or steps a customer needs.', 'Link to it from your home page.'], ai: !!pg, asset: pg ? { kind: 'text', lang: 'Draft', label: 'Page draft', body: `Title: ${pg.title}\nAddress: /${pg.slug}\n\n${pg.intro}\n\n${faqText}` } : null });
    }
  }
  const faq = assets && assets.faq;
  if (faq && faq.length >= 2) add({ id: 'faq', rung: 'cited', impact: 2, minutes: 20, title: 'Answer customer questions in a marked-up FAQ', why: has('faq_no_schema') ? `Your home page answers ${s.faqCount} questions without FAQ markup, so engines cannot tell question from answer.` : 'Engines quote short question and answer pairs more readily than long copy. Yours are drafted from what your own page says.', steps: ['Add these questions and answers to your home page or a FAQ page as visible text.', 'Paste the markup below into the <head> of that page.', 'Correct anything that is not exactly right before you publish.'], ai: true, asset: { kind: 'code', lang: 'JSON-LD', label: 'FAQ markup', body: '<script type="application/ld+json">\n' + jsonLd([fixes.faqSchema(faq)]) + '\n</script>' }, extra: { label: 'Questions and answers', body: faq.map((x) => `${x.q}\n${x.a}`).join('\n\n') } });
  const meta = assets && assets.meta;
  if (has('meta_weak')) add({ id: 'meta', rung: 'cited', impact: 2, minutes: 5, title: 'Rewrite the home page title and description', why: `${!s.description ? 'The home page has no meta description.' : `The description is ${s.description.length} characters and the title ${s.title.length}.`} This is the line an engine shows or quotes when it cites you.`, steps: ['Replace the title and meta description of your home page with the lines below.'], ai: !!(meta && meta.title), asset: meta && meta.title ? { kind: 'text', lang: 'Text', label: 'Title and description', body: `Title: ${meta.title}\nDescription: ${meta.description}` } : null });
  if (has('sitemap_missing')) add({ id: 'sitemap', rung: 'readable', impact: 1, minutes: 15, title: 'Add a sitemap.xml', why: 'There is no sitemap at /sitemap.xml, so crawlers find new pages slowly or not at all.', steps: ['Turn on the sitemap in your site builder or SEO plugin.', 'Add its address to robots.txt as a Sitemap line.'] });
  if (has('llms_missing')) add({ id: 'llms', rung: 'readable', impact: 1, minutes: 10, title: 'Add an llms.txt', why: 'There is no llms.txt. It is a short plain-text guide to your site for AI crawlers.', note: 'No engine has confirmed that it uses llms.txt yet. It costs ten minutes, so it is here, but do the fixes above first.', steps: ['Save the text below as llms.txt at the root of your site.'], asset: { kind: 'code', lang: 'llms.txt', label: 'llms.txt', body: fixes.llmsTxt(p, audit || { origin: check.url, pages: [], site: { homeDescription: s.description } }).trim() } });
  if (t.named && t.first < t.named && t.answers) add({ id: 'first', rung: 'first', impact: 1, minutes: 60, who: 'you', title: 'Give engines a reason to put you first', why: `You are named in ${t.named} answers but lead ${t.first}. Engines order names by how often and how clearly sources back them.`, steps: ['Ask recent customers for reviews on the listing sites in your reading list.', 'State what you are best at in one sentence on your home page, and repeat it on your listings.'] });
  return out.sort((a, b) => b.impact - a.impact || a.minutes - b.minutes).map((f, i) => Object.assign(f, { n: i + 1 }));
}

function compose(check, rows) {
  const w = check.work || {};
  const list = (check.run && check.run.engines) || [];
  const t = tally(rows);
  const probe = (w.insights && w.insights.probe) || null;
  const ladder = ladderOf(check, t, probe);
  const rivals = registry(rows, 'business');
  const s = check.site;
  const matrix = matrixOf(check, rows, list);
  return {
    at: Date.now(), engines: list, ask: check.ask,
    counts: { answers: t.answers, named: t.named, cited: t.cited, first: t.first, none: t.none, failed: t.failed },
    score: t.score, parts: { mention: t.mention, cite: t.cite, rank: t.rank },
    ladder: ladder.rungs, start: ladder.start,
    matrix,
    demand: demandOf(check, matrix),
    voice: [{ name: check.project.brand, n: t.named, you: true }].concat(rivals.slice(0, 8).map((r) => ({ name: r.name, n: r.n, first: r.first }))).sort((a, b) => b.n - a.n || (a.you ? -1 : 1)),
    dirs: registry(rows, 'directory').slice(0, 5).map((r) => ({ name: r.name, n: r.n })),
    reading: w.reading || null,
    queries: topQueries(rows, 10),
    probe, says: (w.insights && w.insights.says) || null,
    crawler: { ok: s.read.ok, status: s.read.status, words: s.words, sample: s.sample, title: s.title, description: s.description, appShell: !!s.appShell },
    bots: auditLib.BOTS.map((b) => ({ ua: b.ua, engine: b.engine, kind: b.kind, blocked: s.blockedBots.includes(b.ua) })),
    files: { robots: s.robots, llms: s.llms, sitemap: s.sitemap, https: s.https, schema: s.schemaTypes },
    audit: w.audit ? { score: w.audit.score, pages: w.audit.pages.map((p) => ({ path: p.path, ok: p.ok, words: p.words, issues: (p.issues || []).map((k) => (auditLib.PAGE_RULES[k] || { text: k }).text) })) } : null,
    fixes: fixesOf(check, rows, { reading: w.reading, audit: w.audit, assets: w.assets, probe, t }),
    skipped: Object.keys((w.errors) || {})
  };
}

// One step of the report per call, so each stays well inside the 60 second limit of a function. The slow part runs
// on a copy; its result is written under the record's lock.
async function finalizeStep(id, deadline) {
  if (!(await lock('fin:' + id, 75))) return { busy: true };
  try {
    const check = await get(id);
    if (!check || check.status !== 'finalizing') return { done: true };
    const w = check.work || { step: 0, tries: 0, errors: {} };
    const step = FIN_STEPS[w.step] || 'compose';
    const rows = await rowsOf(id);
    let value = null, failed = null;
    try {
      if (step === 'reading') value = await stepReading(check, rows, deadline);
      else if (step === 'audit') value = await stepAudit(check, deadline);
      else if (step === 'insights') value = await stepInsights(check, rows, deadline);
      else if (step === 'assets') value = await stepAssets(check, rows, w.audit, deadline);
    } catch (e) { console.error('[vr] step ' + step, e && e.message); failed = String((e && e.message) || e).slice(0, 160); }
    let done = false;
    const fresh = await update(id, (c) => {
      if (c.status !== 'finalizing') return false;
      const cw = c.work || (c.work = { step: 0, tries: 0, errors: {} });
      if ((FIN_STEPS[cw.step] || 'compose') !== step) return false; // another worker moved it on
      if (failed) {
        cw.tries = (cw.tries || 0) + 1;
        if (cw.tries >= 2) { cw.errors = cw.errors || {}; cw.errors[step] = failed; cw.step++; cw.tries = 0; }
        return;
      }
      if (step !== 'compose') { cw[step] = value; cw.step++; cw.tries = 0; return; }
      c.report = compose(c, rows);
      c.status = 'done';
      c.doneAt = Date.now();
      if (c.paid && !c.parent && !c.recheck) c.recheck = { dueAt: Date.now() + RECHECK_AFTER, id: '' };
      done = true;
    });
    if (!done || !fresh) return { step };
    await kv.srem('vr:active', id);
    await count(fresh.parent ? 'recheck_built' : 'report_built');
    if (fresh.parent) await linkRecheck(fresh); else if (fresh.recheck && !fresh.recheck.id) await kv.sadd('vr:due', id);
    try { await sendReady(fresh); } catch (e) { console.error('[vr] ready email', e.message); }
    return { done: true };
  } finally { await unlock('fin:' + id); }
}

// Called by the open page and by the cron: a slice of whatever work the check still needs.
async function pump(id, budgetMs) {
  const deadline = Date.now() + (budgetMs || 45000);
  const check = await get(id);
  if (!check) return { gone: true };
  if (check.status === 'running') {
    const r = await work(id, deadline);
    await maybeFinish(id);
    return { status: 'running', busy: !!r.busy, budget: !!r.budget };
  }
  if (check.status === 'finalizing') { const r = await finalizeStep(id, deadline); return { status: 'finalizing', busy: !!r.busy }; }
  return { status: check.status };
}

/* ---------- payment, email, re-check ---------- */

// Marks a check as paid and starts the full report. info: { by: 'polar' | 'key', checkoutId, orderId, email, amount }.
async function markPaid(id, info) {
  info = info || {};
  let first = false;
  const check = await update(id, (c) => {
    if (c.paid) return false;
    first = true;
    c.paid = { at: Date.now(), by: info.by || 'polar', checkoutId: String(info.checkoutId || ''), orderId: String(info.orderId || ''), amount: info.amount || price() };
    if (info.email && !c.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(info.email))) c.email = String(info.email).toLowerCase().slice(0, 160);
  });
  if (!check) return { error: 'gone' };
  if (!first) return { ok: true, already: true };
  await count(info.by === 'key' ? 'opened_by_key' : 'paid');
  await kv.expire('vrres:' + id, PAID_TTL);
  // a free check still running carries on; the full report starts when it ends (see maybeFinish)
  if (check.status === 'running') return { ok: true, waiting: true };
  if (!check.topics.length) return { ok: true, waiting: true };
  const r = await runFull(id);
  return r.error ? { ok: true, waiting: true, why: r.error } : { ok: true };
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function sendReady(check) {
  if (!check.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(check.email) || !check.report) return;
  const url = where.site() + '/check/' + check.id;
  const c = check.report.counts;
  const again = !!check.parent;
  const subject = again ? `Your 30-day re-check for ${check.project.brand} is ready` : `Your AI visibility report for ${check.project.brand}`;
  const line = `AI named ${check.project.brand} in ${c.named} of ${c.answers} answers.`;
  const keep = 'This link is your report. Keep it: there is no account or password.';
  const later = again ? '' : ' In 30 days we ask the same questions again and send you the before and after.';
  await email.send({
    as: 'AI Visibility Report', to: check.email, subject,
    text: `${line}\n\nOpen your report: ${url}\n\n${keep}${later}`,
    html: `<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#0F1433;max-width:560px"><h2 style="margin:0 0 8px;font-size:21px">${esc(line)}</h2><p style="font-size:14.5px;color:#535A7E;margin:0 0 16px">${again ? 'The same questions, asked again. Your before and after is on the page.' : 'Every answer word for word, the pages AI read, and your fix kit.'}</p><p><a href="${esc(url)}" style="display:inline-block;background:#FFE14D;color:#1B1600;padding:11px 18px;border-radius:10px;text-decoration:none;font-weight:700">Open your report</a></p><p style="font-size:12.5px;color:#535A7E">${keep}${later}</p></div>`
  });
}

async function setEmail(id, address) {
  const e = String(address || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) || e.length > 160) return { error: 'That email address does not look right.' };
  const check = await update(id, (c) => { c.email = e; });
  if (!check) return { error: 'This check no longer exists.' };
  // the report was ready before the address came in: send the link now
  if (check.status === 'done' && check.paid) { try { await sendReady(check); } catch (err) { console.error('[vr] ready email', err.message); } }
  return { ok: true };
}

// The same questions asked again as a new check that points back to the first one.
async function startRecheck(id, reason) {
  const parent = await get(id);
  if (!parent || !parent.paid || parent.status !== 'done' || parent.parent) return { error: 'This report is not ready for a re-check.' };
  if (parent.recheck && parent.recheck.id) return { ok: true, id: parent.recheck.id, already: true };
  if (reason !== 'due' && Date.now() - (parent.doneAt || parent.at) < RECHECK_EARLY) return { error: 'The re-check opens 14 days after the report. AI answers take a few weeks to move.' };
  if (!engines.enabled().length) return { error: 'The AI engines cannot be reached right now.' };
  if (!(await lock('re:' + id, 60))) return { error: 'The re-check is starting. Reload in a moment.' };
  try {
    const child = JSON.parse(JSON.stringify(parent));
    Object.assign(child, { id: random(16), at: Date.now(), status: 'draft', phase: '', run: null, preview: null, report: null, work: {}, recheck: null, parent: parent.id, doneAt: 0, compare: null });
    child.paid = Object.assign({}, parent.paid, { at: Date.now(), by: 'recheck' });
    // the site is read again, so fixes made since the first report count
    try { const read = await readSite(parent.url, parent.host); if (read.site && read.reachable) child.site = read.site; } catch (e) { /* the earlier reading stands */ }
    await save(child);
    await update(id, (c) => { c.recheck = Object.assign({}, c.recheck, { id: child.id, startedAt: Date.now() }); });
    await kv.srem('vr:due', id);
    await runFull(child.id);
    return { ok: true, id: child.id };
  } finally { await unlock('re:' + id); }
}

async function linkRecheck(child) {
  const parent = await get(child.parent);
  if (!parent || !parent.report || !child.report) return;
  const a = parent.report, b = child.report;
  const compare = {
    at: parent.doneAt || parent.at, id: parent.id,
    score: [a.score, b.score], named: [a.counts.named, b.counts.named], answers: [a.counts.answers, b.counts.answers], cited: [a.counts.cited, b.counts.cited], first: [a.counts.first, b.counts.first],
    ladder: b.ladder.map((r) => ({ id: r.id, name: r.name, was: (a.ladder.find((x) => x.id === r.id) || {}).state || 'unknown', now: r.state })),
    topics: b.matrix.map((m) => { const old = a.matrix.find((x) => x.topic === m.topic) || { named: 0, answers: 0 }; return { topic: m.topic, was: [old.named, old.answers], now: [m.named, m.answers] }; }),
    fixes: [a.fixes.length, b.fixes.length]
  };
  await update(child.id, (c) => { c.compare = compare; });
  child.compare = compare;
  await update(parent.id, (c) => { c.recheck = Object.assign({}, c.recheck, { id: child.id, doneAt: Date.now() }); });
}

// The cron: checks nobody has open keep moving, and re-checks that are due start.
async function tick(opts) {
  opts = opts || {};
  const deadline = Date.now() + (opts.budgetMs || 45000);
  if (!(await lock('tick', 58))) return { skipped: 'another tick is running' };
  const out = { worked: 0, started: 0 };
  try {
    const ids = await kv.smembers('vr:active');
    const list = (await Promise.all(ids.map((id) => get(id)))).filter(Boolean);
    for (const id of ids) if (!list.some((c) => c.id === id)) await kv.srem('vr:active', id); // expired
    const stamps = await Promise.all(list.map((c) => lastProgress(c)));
    const order = list.map((c, i) => ({ c, at: stamps[i] })).sort((a, b) => a.at - b.at);
    for (const { c } of order) {
      if (deadline - Date.now() < 15000) break;
      if (!['running', 'finalizing'].includes(c.status)) { await kv.srem('vr:active', c.id); continue; }
      await pump(c.id, deadline - Date.now());
      out.worked++;
    }
    if (deadline - Date.now() > 20000) {
      for (const id of (await kv.smembers('vr:due')).slice(0, 40)) {
        if (out.started >= 2) break;
        const c = await get(id);
        if (!c || !c.recheck || c.recheck.id) { await kv.srem('vr:due', id); continue; }
        if (c.recheck.dueAt > (opts.now || Date.now())) continue;
        const r = await startRecheck(id, 'due');
        if (r.ok) out.started++; else await kv.srem('vr:due', id);
      }
    }
  } finally { await unlock('tick'); }
  return out;
}

module.exports = {
  ID_RE, COUNTRY, FIN_STEPS, SEARCH, RECHECK_EARLY, RECHECK_AFTER, DAY, price, topicCount, NUMBER,
  normalizeUrl, URL_ERRORS, readSite, findingsOf, understand, keywordFrom, sameBusiness, nameWords, bareName, readAnswer, searchVolumes, pickTopics, othersOf, alike, sameSubject, demandOf, CANDIDATES,
  get, save, update, results, rowsOf, start, runFree, runFull, pump, work, maybeFinish, finalizeStep, tick,
  markPaid, setEmail, sendReady, startRecheck, count, stats,
  stateOf, isNamed, registry, tally, previewOf, compose, matrixOf, ladderOf, fixesOf, topicNumbers, extractNamed, placeNamed, namedByShape, hostKind, sortPages, KIND, probeQuestion, unitsFor, tasksFor, andList
};
