'use strict';
// Site health: what AI SEO Deck knows about the pages of a connected site. All of it is read through the
// Webflow Data API, with the scopes the user granted, and nothing is requested from the published website:
//   GET /v2/sites/:site_id/pages   the page list, with each page's SEO and Open Graph settings   (pages:read)
//   GET /v2/pages/:page_id/dom     the text, headings and images of a static page                (pages:read)
// What the API does not give is not reported: structured data, robots.txt, llms.txt and the sitemap.

const wf = require('./webflow');
const { readFragment } = require('./pagetext');

// A title or description shorter than `min` or longer than `max` is a finding. `aimMin` to `aimMax` is the length
// the editors suggest while writing. The Designer panel gets these numbers from here, so every screen agrees.
const LIMITS = { title: { min: 20, max: 65, aimMin: 35, aimMax: 60 }, description: { min: 60, max: 165, aimMin: 120, aimMax: 155 } };
// One finding per rule. `w` is what it takes off a page's 100 points.
const RULES = {
  title_missing: { w: 20, text: 'No SEO title: Webflow shows the page name instead' },
  title_length: { w: 6, text: `SEO title is shorter than ${LIMITS.title.min} or longer than ${LIMITS.title.max} characters` },
  desc_missing: { w: 20, text: 'No meta description' },
  desc_length: { w: 6, text: `Meta description is shorter than ${LIMITS.description.min} or longer than ${LIMITS.description.max} characters` },
  og_missing: { w: 6, text: 'Open Graph title or description is missing' },
  h1_missing: { w: 12, text: 'No H1 heading' },
  h1_multiple: { w: 5, text: 'More than one H1 heading' },
  thin: { w: 10, text: 'Less than 300 words: little for an AI engine to quote' },
  alt_missing: { w: 6, text: 'Images without alt text' }
};
const THIN_WORDS = 300;
// Pages Webflow makes for itself: nobody searches for them.
const UTILITY = /^\/(401|404|search|password|style-?guide|licen[cs]es?|changelog)(\/|$)/i;
const INHERIT = '__wf_reserved_inherit';
const DECORATIVE = '__wf_reserved_decorative';
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const piece = (t) => (t && t.html ? String(t.html) : '<p>' + esc((t && t.text) || '') + '</p>') + '\n';

// The nodes Webflow returns for a page, written out as plain HTML so that one reader serves them.
// An image whose alt text is "decorative" or "the asset's own" counts as having one: the first is a choice, and
// the second is kept with the asset, which this read does not open. Text inside a component is not in the nodes;
// only the text set on the instance is, so the number of instances is kept to say what could not be read.
function domToHtml(nodes) {
  let html = '';
  let components = 0;
  let imagesInherit = 0;
  for (const n of nodes || []) {
    if (!n || typeof n !== 'object') continue;
    if (n.type === 'text') html += piece(n.text);
    else if (n.type === 'image') {
      const alt = n.image ? n.image.alt : null;
      if (alt === INHERIT) { imagesInherit++; html += '<img alt="">\n'; }
      else if (alt === DECORATIVE) html += '<img alt="">\n';
      else if (alt != null && String(alt).trim()) html += '<img alt="' + esc(alt) + '">\n';
      else html += '<img>\n';
    } else if (n.type === 'component-instance') {
      components++;
      for (const o of n.propertyOverrides || []) if (o && o.text) html += piece(o.text);
    }
  }
  return { html, components, imagesInherit };
}

// The content of one static page, read from Webflow now. Throws what the Webflow client throws.
async function readContent(token, pageId, maxNodes) {
  const dom = await wf.pageDom(token, pageId, maxNodes || 600);
  const { html, components, imagesInherit } = domToHtml(dom.nodes);
  const f = readFragment(html);
  return { text: f.text, words: f.words, h1: f.h1, headings: f.headings, faq: f.faq, images: f.images, imagesNoAlt: f.imagesNoAlt, imagesInherit, components, truncated: !!dom.truncated, lastUpdated: dom.lastUpdated || null, readAt: Date.now() };
}

// The findings of a row. A finding that cannot be told, because part of the page's text is inside components or
// the page was too long to read in full, goes to `unknown` instead of being reported as a fact.
function check(row) {
  const issues = [];
  const unknown = [];
  if (!row.title) issues.push('title_missing'); else if (!row.template && (row.title.length < LIMITS.title.min || row.title.length > LIMITS.title.max)) issues.push('title_length');
  if (!row.description) issues.push('desc_missing'); else if (!row.template && (row.description.length < LIMITS.description.min || row.description.length > LIMITS.description.max)) issues.push('desc_length');
  if (!row.og || !row.og.title || !row.og.description) issues.push('og_missing');
  if (row.content && !row.template) {
    const partial = row.components > 0 || row.truncated;
    if (row.h1Count > 1) issues.push('h1_multiple');
    else if (!row.h1Count) (partial ? unknown : issues).push('h1_missing');
    if (row.words < THIN_WORDS) (partial ? unknown : issues).push('thin');
    if (row.imagesNoAlt > 0) issues.push('alt_missing');
  }
  return { issues, unknown, score: Math.max(0, 100 - issues.reduce((a, k) => a + RULES[k].w, 0)) };
}

// What the content read adds to a row, and the same fields taken back out of a row that has them.
const contentFields = (c) => ({ content: true, h1: (c.h1 || []).slice(0, 2), h1Count: c.h1Count != null ? c.h1Count : (c.h1 || []).length, words: c.words || 0, images: c.images || 0, imagesNoAlt: c.imagesNoAlt || 0, imagesInherit: c.imagesInherit || 0, components: c.components || 0, faq: (c.faq || []).slice(0, 8).map((f) => ({ q: String(f.q || '').slice(0, 200) })), truncated: !!c.truncated, contentAt: c.contentAt || c.readAt || Date.now() });

// One row of Site health for a page of the list. `content` is what readContent gave, a row read earlier in the
// same run, or null when the page's content was not read (a Collection template, or not yet).
function rowFor(meta, content, state) {
  const seo = meta.seo || {};
  const og = meta.openGraph || {};
  const title = String(seo.title || '').trim();
  const description = String(seo.description || '').trim();
  const row = {
    pageId: String(meta.id || ''),
    path: meta.publishedPath,
    name: String(meta.title || meta.slug || ''),
    template: !!meta.collectionId,
    title,
    description,
    og: { title: !!(og.titleCopied ? title : String(og.title || '').trim()), description: !!(og.descriptionCopied ? description : String(og.description || '').trim()) },
    updatedAt: meta.lastUpdated ? Date.parse(meta.lastUpdated) || null : null,
    metaAt: Date.now() // when these settings were read from Webflow
  };
  if (content) Object.assign(row, contentFields(content));
  else Object.assign(row, { content: false, h1: [], h1Count: 0, words: null, images: null, imagesNoAlt: null, faq: [] });
  if (state) row.state = state; // 'pending': content not read yet, 'unreadable': Webflow gave no content for this page
  const c = check(row);
  row.issues = c.issues;
  row.unknown = c.unknown;
  row.score = c.score;
  return row;
}

const listed = (pages) => (pages || []).filter((p) => p && p.id && !p.draft && !p.archived && typeof p.publishedPath === 'string' && p.publishedPath && !UTILITY.test(p.publishedPath));

// Reads the pages of a site from Webflow and says what to fix on each.
//   pages        the page list (wf.listPages)
//   opts.maxPages how many pages the plan covers
//   opts.budgetMs how long this call may take: what is not read in time stays "pending" and a later call
//                 with opts.resume (the audit this one continues) reads it
// Every page gets a row from its settings at once; the text of static pages is read two at a time.
async function auditSite(token, site, pages, opts) {
  opts = opts || {};
  const started = Date.now();
  const budget = opts.budgetMs || 35000;
  const all = listed(pages);
  all.sort((a, b) => (a.publishedPath === '/' ? -1 : b.publishedPath === '/' ? 1 : (!!a.collectionId - !!b.collectionId) || a.publishedPath.length - b.publishedPath.length || a.publishedPath.localeCompare(b.publishedPath)));
  const picked = all.slice(0, opts.maxPages || 20);
  const before = new Map(((opts.resume && opts.resume.pages) || []).filter((r) => r.content || r.state === 'unreadable').map((r) => [r.pageId, r]));
  const rows = new Array(picked.length).fill(null);
  let next = 0;
  let stop = false; // out of time, or Webflow asked to slow down more often than the client retries
  async function worker() {
    while (next < picked.length) {
      const i = next++;
      const meta = picked[i];
      if (meta.collectionId) { rows[i] = rowFor(meta, null); continue; }
      const kept = before.get(String(meta.id));
      if (kept) { rows[i] = kept.content ? rowFor(meta, kept) : rowFor(meta, null, 'unreadable'); continue; }
      if (stop || Date.now() - started > budget) { stop = true; rows[i] = rowFor(meta, null, 'pending'); continue; }
      try { rows[i] = rowFor(meta, await readContent(token, meta.id)); }
      catch (e) {
        if (wf.isRevoked(e)) throw e;
        if (e && e.status === 429) { stop = true; rows[i] = rowFor(meta, null, 'pending'); } else rows[i] = rowFor(meta, null, 'unreadable');
      }
    }
  }
  await Promise.all([worker(), worker()]);
  const pending = rows.filter((r) => r.state === 'pending').length;
  const scored = rows.filter((r) => typeof r.score === 'number');
  const home = rows.find((r) => r.path === '/') || null;
  return {
    at: opts.resume && opts.resume.at ? opts.resume.at : started, // when this read of the site started
    readAt: Date.now(), // when Webflow was last asked
    ms: Date.now() - started,
    source: 'webflow-data-api',
    score: scored.length ? Math.round(scored.reduce((a, r) => a + r.score, 0) / scored.length) : null,
    origin: String(site.url || '').replace(/\/+$/, ''), // for links to the pages; never requested
    site: { lang: (site.locale && site.locale.tag) || '', homeTitle: home ? home.title : '', homeDescription: home ? home.description : '' },
    siteIssues: [],
    pagesListed: all.length,
    pagesChecked: rows.length - pending,
    pending,
    overPlan: Math.max(0, all.length - picked.length),
    complete: pending === 0,
    pages: rows
  };
}

module.exports = { RULES, LIMITS, THIN_WORDS, domToHtml, readContent, check, rowFor, auditSite, listed };
