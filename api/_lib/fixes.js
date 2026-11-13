'use strict';
// Suggestions the user reviews before anything is written to Webflow: meta titles and descriptions,
// JSON-LD schema (Organization, WebSite, FAQPage), FAQ answers, prompt ideas, llms.txt and robots.txt lines.
const llm = require('./llm');
const { BOTS } = require('./audit');

const clean = (s, max) => String(s || '').replace(/[–—]/g, ', ').replace(/\s+/g, ' ').trim().slice(0, max || 500);
const LANG_NAMES = { en: 'English', tr: 'Turkish', de: 'German', fr: 'French', es: 'Spanish', it: 'Italian', nl: 'Dutch', pt: 'Portuguese', pl: 'Polish', ar: 'Arabic', ru: 'Russian', sv: 'Swedish', da: 'Danish', no: 'Norwegian', fi: 'Finnish', cs: 'Czech', hu: 'Hungarian', ro: 'Romanian', el: 'Greek', ja: 'Japanese', ko: 'Korean', zh: 'Chinese' };
const langName = (code) => LANG_NAMES[String(code || 'en').slice(0, 2).toLowerCase()] || 'English';

const RULES = 'Write plainly. Never invent facts, prices, awards, numbers or guarantees that are not in the source text. No emojis, no exclamation marks, no em dashes.';

/* ---------- prompt ideas ---------- */
async function suggestPrompts(project, home, count) {
  const lang = langName(project.language);
  const j = await llm.generateJSON({
    system: `You help a business find out whether AI assistants (ChatGPT, Perplexity, Gemini) recommend it. ${RULES}`,
    prompt: `Business: ${project.brand}\nWebsite: ${(project.domains || [])[0] || ''}\nMarket: ${project.country || 'not given'}\nCompetitors: ${(project.competitors || []).map((c) => c.name).join(', ') || 'not given'}\nHome page title: ${clean(home.title, 200)}\nHome page description: ${clean(home.description, 300)}\nHome page text: ${clean(home.text, 2500)}\n\n` +
      `List ${count || 12} questions that real potential customers type into ChatGPT when they look for what this business sells, written in ${lang}. ` +
      'Mix: best or top providers (with the city or country when the business is local), comparisons, prices and costs, how to choose, alternatives to a competitor, and problem-first questions. ' +
      `Do not name ${project.brand} in any question. Keep each under 120 characters. Return {"prompts": ["..."]}.`,
    maxTokens: 900
  });
  const list = Array.isArray(j) ? j : (j && j.prompts) || [];
  return list.map((p) => clean(p, 200)).filter((p) => p.length >= 8).slice(0, count || 12);
}

/* ---------- meta title and description ---------- */
async function suggestMeta(project, page) {
  const lang = page.lang ? langName(page.lang) : langName(project.language);
  const j = await llm.generateJSON({
    system: `You write search and AI-friendly page titles and meta descriptions. ${RULES}`,
    prompt: `Brand: ${project.brand}\nPage URL path: ${page.path}\nCurrent title: ${clean(page.title, 200) || '(none)'}\nCurrent description: ${clean(page.description, 300) || '(none)'}\nMain heading: ${clean((page.h1 || [])[0], 200)}\nPage text: ${clean(page.text, 3000)}\n\n` +
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

module.exports = { suggestPrompts, suggestMeta, suggestFaq, orgSchema, websiteSchema, faqSchema, mergeSchema, llmsTxt, robotsLines, ORG_TYPES, abs, langName, LANG_NAMES };
