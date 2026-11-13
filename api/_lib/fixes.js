'use strict';
// Suggestions the user reviews before anything is written to Webflow: meta titles and descriptions,
// JSON-LD schema (Organization, WebSite, FAQPage), FAQ answers, prompt ideas, llms.txt and robots.txt lines.
const llm = require('./llm');
const { BOTS } = require('./audit');

const clean = (s, max) => String(s || '').replace(/[–—]/g, ', ').replace(/\s+/g, ' ').trim().slice(0, max || 500);
const LANG_NAMES = { en: 'English', tr: 'Turkish', de: 'German', fr: 'French', es: 'Spanish', it: 'Italian', nl: 'Dutch', pt: 'Portuguese', pl: 'Polish', ar: 'Arabic', ru: 'Russian', sv: 'Swedish', da: 'Danish', no: 'Norwegian', fi: 'Finnish', cs: 'Czech', hu: 'Hungarian', ro: 'Romanian', el: 'Greek', ja: 'Japanese', ko: 'Korean', zh: 'Chinese' };
const langName = (code) => LANG_NAMES[String(code || 'en').slice(0, 2).toLowerCase()] || 'English';

const RULES = 'Write plainly. Never invent facts, prices, awards, numbers or guarantees that are not in the source text. No emojis, no exclamation marks, no em dashes.';

/* ---------- keyword ideas and the questions behind a keyword ---------- */
const lowerKw = (k) => clean(k, 80).toLowerCase().replace(/[?!.,;:]+$/g, '').trim();

// Search keywords people use to find what the business sells, from its homepage.
async function suggestKeywords(project, home, count) {
  const lang = langName(project.language);
  const j = await llm.generateJSON({
    system: `You are an SEO specialist who picks the keywords a business should track in Google and AI search. ${RULES}`,
    prompt: `Business: ${project.brand}\nWebsite: ${(project.domains || [])[0] || ''}\nMarket: ${project.country || 'not given'}\nCompetitors: ${(project.competitors || []).map((c) => c.name).join(', ') || 'not given'}\nHome page title: ${clean(home.title, 200)}\nHome page description: ${clean(home.description, 300)}\nHome page text: ${clean(home.text, 2500)}\n\n` +
      `List ${count || 12} search keywords, written in ${lang}, that potential customers type into Google or ChatGPT when they look for what this business sells. ` +
      'Each keyword is 2 to 5 words, lowercase, the way people search. Mix: the main service or product with the city or country when the business is local, best or top searches, price and cost searches, comparisons and alternatives, and problem-first searches. ' +
      `Do not include ${project.brand} or other brand names. Return {"keywords": ["..."]}.`,
    maxTokens: 700
  });
  const list = Array.isArray(j) ? j : (j && j.keywords) || [];
  // searches with the brand in them name it by definition, so they tell nothing about visibility
  const squash = (x) => String(x || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9]/g, '');
  const brands = [project.brand].concat(project.aliases || []).map(squash).filter((x) => x.length >= 3);
  const out = [];
  for (const k of list) { const t = lowerKw(k); if (t.length >= 3 && !out.includes(t) && !brands.some((b) => squash(t).includes(b))) out.push(t); }
  return out.slice(0, count || 12);
}

// For each keyword, the questions a customer would ask an AI assistant. Returns { keyword: [questions] }.
async function questionsFor(project, keywords, perKeyword) {
  const kws = (keywords || []).slice(0, 25);
  if (!kws.length) return {};
  const n = perKeyword || 2;
  const lang = langName(project.language);
  const j = await llm.generateJSON({
    system: `You write the questions real customers type into ChatGPT, Gemini or Perplexity. ${RULES}`,
    prompt: `Business: ${project.brand}\nMarket: ${project.country || 'not given'}\nKeywords:\n${kws.map((k) => '- ' + k).join('\n')}\n\n` +
      `For each keyword write ${n} different questions in ${lang} that a potential customer would ask an AI assistant while searching for it: one asking which provider or option is best, and one about price, how to choose or what to expect. ` +
      `Keep the place or product from the keyword. Do not name ${project.brand} or any brand. Each under 120 characters. Return {"items": [{"keyword": "...", "questions": ["...", "..."]}]}.`,
    maxTokens: 260 + kws.length * 110
  });
  const items = Array.isArray(j) ? j : (j && j.items) || [];
  const out = {};
  for (const it of items) {
    const k = lowerKw(it && it.keyword);
    const qs = (Array.isArray(it && it.questions) ? it.questions : []).map((q) => clean(q, 200)).filter((q) => q.length >= 8).slice(0, n);
    const match = kws.find((x) => lowerKw(x) === k);
    if (match && qs.length) out[match] = qs;
  }
  return out;
}

/* ---------- meta title and description ---------- */
async function suggestMeta(project, page, keyword) {
  const lang = page.lang ? langName(page.lang) : langName(project.language);
  const focus = keyword ? `Main keyword for this page: "${clean(keyword, 80)}". Use it, or its natural wording, near the start of the title and once in the description.\n` : '';
  const j = await llm.generateJSON({
    system: `You write search and AI-friendly page titles and meta descriptions. ${RULES}`,
    prompt: `Brand: ${project.brand}\nPage URL path: ${page.path}\nCurrent title: ${clean(page.title, 200) || '(none)'}\nCurrent description: ${clean(page.description, 300) || '(none)'}\nMain heading: ${clean((page.h1 || [])[0], 200)}\nPage text: ${clean(page.text, 3000)}\n\n${focus}` +
      `Write in ${lang}: a title of 35 to 60 characters that says what the page offers (add " | ${project.brand}" only if it fits), and a meta description of 120 to 155 characters that answers what the page is about and who it is for. Return {"title": "...", "description": "..."}.`,
    maxTokens: 400
  });
  return { title: clean(j.title, 70), description: clean(j.description, 170) };
}

/* ---------- FAQ answers from the page's own content ---------- */
async function suggestFaq(project, page, questions) {
  const lang = page.lang ? langName(page.lang) : langName(project.language);
  const j = await llm.generateJSON({
    system: `You write short FAQ answers for a business website, only from the facts on the page. ${RULES}`,
    prompt: `Brand: ${project.brand}\nPage path: ${page.path}\nPage text: ${clean(page.text, 5000)}\n\nQuestions people ask AI assistants about this topic:\n${(questions || []).slice(0, 10).map((q) => '- ' + clean(q, 200)).join('\n') || '- (none given)'}\n\n` +
      `Write 4 to 6 questions and answers in ${lang} that this page can answer from its own text. Rewrite questions so they fit the business when needed. Each answer 2 to 4 sentences, first sentence answers directly. Skip anything the page does not support. Return {"faq": [{"q": "...", "a": "..."}]}.`,
    maxTokens: 1400
  });
  const list = Array.isArray(j) ? j : (j && j.faq) || [];
  return list.map((x) => ({ q: clean(x.q, 200), a: clean(x.a, 900) })).filter((x) => x.q && x.a).slice(0, 8);
}

/* ---------- a new page for a keyword the site does not cover yet ---------- */
// source: text from the site's own pages. Returns { title, slug, intro, faq: [{ q, a }] } for a CMS draft.
async function suggestNewPage(project, keyword, questions, source) {
  const lang = langName(project.language);
  const j = await llm.generateJSON({
    system: `You draft a web page for a business, using only facts from its own website. ${RULES}`,
    prompt: `Brand: ${project.brand}\nKeyword the page should answer: ${clean(keyword, 80)}\nQuestions customers ask about it:\n${(questions || []).slice(0, 4).map((q) => '- ' + clean(q, 200)).join('\n') || '- (none given)'}\nFacts from the business website:\n${clean(source, 6000)}\n\n` +
      `Write in ${lang}: a page title of 35 to 60 characters with the keyword, a URL slug of 2 to 6 words, an intro of 2 to 3 sentences that says what ${project.brand} offers for this keyword, and 3 to 5 questions with answers of 2 to 4 sentences. ` +
      'Only use facts from the website text; where it says nothing, write what the reader should ask the business instead of inventing details. Return {"title": "...", "slug": "...", "intro": "...", "faq": [{"q": "...", "a": "..."}]}.',
    maxTokens: 1400
  });
  const faq = (Array.isArray(j.faq) ? j.faq : []).map((x) => ({ q: clean(x && x.q, 200), a: clean(x && x.a, 900) })).filter((x) => x.q && x.a).slice(0, 6);
  const slug = String(j.slug || keyword).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return { title: clean(j.title, 70) || clean(keyword, 70), slug, intro: clean(j.intro, 600), faq };
}

/* ---------- JSON-LD ---------- */
const ORG_TYPES = ['Organization', 'LocalBusiness', 'ProfessionalService', 'Dentist', 'MedicalClinic', 'BeautySalon', 'HealthAndBeautyBusiness', 'Restaurant', 'Store', 'RealEstateAgent', 'LegalService', 'EducationalOrganization'];

function abs(url, origin) { try { return url ? new URL(url, origin).toString() : ''; } catch (e) { return ''; } }

// info: { type, name, url, logo, description, phone, email, street, city, region, postal, country, sameAs[] }
function orgSchema(info) {
  const type = ORG_TYPES.includes(info.type) ? info.type : 'Organization';
  const o = { '@type': type, '@id': info.url.replace(/\/+$/, '') + '/#organization', name: info.name, url: info.url };
  if (info.logo) o.logo = info.logo;
  if (info.logo && type !== 'Organization') o.image = info.logo;
  if (info.description) o.description = clean(info.description, 300);
  if (info.phone) o.telephone = clean(info.phone, 40);
  if (info.email) o.email = clean(info.email, 120);
  if (info.street || info.city || info.country) {
    o.address = { '@type': 'PostalAddress' };
    if (info.street) o.address.streetAddress = clean(info.street, 160);
    if (info.city) o.address.addressLocality = clean(info.city, 80);
    if (info.region) o.address.addressRegion = clean(info.region, 80);
    if (info.postal) o.address.postalCode = clean(info.postal, 20);
    if (info.country) o.address.addressCountry = clean(info.country, 60);
  }
  const same = (info.sameAs || []).filter((u) => /^https:\/\//.test(u)).slice(0, 10);
  if (same.length) o.sameAs = same;
  return o;
}
function websiteSchema(info) {
  return { '@type': 'WebSite', '@id': info.url.replace(/\/+$/, '') + '/#website', name: info.name, url: info.url, publisher: { '@id': info.url.replace(/\/+$/, '') + '/#organization' } };
}
function faqSchema(pairs) {
  return { '@type': 'FAQPage', mainEntity: pairs.filter((p) => p.q && p.a).slice(0, 20).map((p) => ({ '@type': 'Question', name: clean(p.q, 300), acceptedAnswer: { '@type': 'Answer', text: clean(p.a, 1500) } })) };
}

const typesOf = (n) => (Array.isArray(n['@type']) ? n['@type'] : [n['@type']]).filter(Boolean);
// Combines what the page already has with our nodes in one @graph. A node of the same type as one of
// ours is replaced (the user saw both and chose ours); every other existing node is kept as it is.
function mergeSchema(existing, nodes) {
  const ours = nodes.filter(Boolean);
  let current = [];
  if (existing && typeof existing === 'object') {
    if (Array.isArray(existing)) current = existing.slice();
    else if (Array.isArray(existing['@graph'])) current = existing['@graph'].slice();
    else { const c = Object.assign({}, existing); delete c['@context']; current = [c]; }
  }
  const ourTypes = new Set(ours.flatMap(typesOf));
  const kept = current.filter((n) => n && typeof n === 'object' && !typesOf(n).some((t) => ourTypes.has(t) || (ORG_TYPES.includes(t) && ours.some((o) => typesOf(o).some((x) => ORG_TYPES.includes(x))))));
  return { '@context': 'https://schema.org', '@graph': kept.concat(ours) };
}

/* ---------- llms.txt and robots.txt ---------- */
function llmsTxt(project, audit) {
  const origin = audit.origin;
  const home = (audit.pages || []).find((p) => p.path === '/') || {};
  const lines = [`# ${project.brand}`, '', `> ${clean(home.description || audit.site.homeDescription || '', 300) || clean(project.brand, 100)}`, ''];
  const pages = (audit.pages || []).filter((p) => p.ok && !p.noindex && p.path !== '/').slice(0, 40);
  if (pages.length) {
    lines.push('## Pages', '');
    for (const p of pages) lines.push(`- [${clean(p.title || p.name || p.path, 90)}](${origin}${p.path})${p.description ? ': ' + clean(p.description, 160) : ''}`);
    lines.push('');
  }
  lines.push('## Contact', '', `- Website: ${origin}`);
  return lines.join('\n') + '\n';
}
function robotsLines(blocked) {
  const out = [];
  for (const ua of blocked || []) {
    const b = BOTS.find((x) => x.ua === ua);
    if (b && b.kind === 'search') out.push(`User-agent: ${ua}`, 'Allow: /', '');
  }
  return out.join('\n');
}

module.exports = { suggestKeywords, questionsFor, suggestMeta, suggestFaq, suggestNewPage, orgSchema, websiteSchema, faqSchema, mergeSchema, llmsTxt, robotsLines, ORG_TYPES, abs, langName, LANG_NAMES };
