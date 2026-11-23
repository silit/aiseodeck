'use strict';
// Minimal Webflow Data API client (v2) with 429 backoff. Every piece of site data the app uses comes through here:
// the app never requests a customer's published website.
// Scopes: read sites and pages, write page SEO settings, read and write CMS items (drafts).

const API_BASE = () => (process.env.WEBFLOW_API_BASE || 'https://api.webflow.com').replace(/\/+$/, '');
const AUTH_BASE = () => (process.env.WEBFLOW_AUTH_BASE || 'https://webflow.com').replace(/\/+$/, '');

const SCOPES = ['authorized_user:read', 'sites:read', 'pages:read', 'pages:write', 'cms:read', 'cms:write'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_RETRIES = 3;
const RETRY_BASE_MS = () => parseInt(process.env.WEBFLOW_RETRY_BASE_MS || '', 10) || 2000;
const MAX_WAIT_MS = 10000; // the longest a request waits before trying again

// How many more calls Webflow takes this minute for a token, as its last answer said (X-RateLimit-Remaining).
// Kept in memory for a minute. null when Webflow has not said.
const budget = new Map();
function noteBudget(token, res) {
  const n = parseInt(res.headers.get('x-ratelimit-remaining') || '', 10);
  if (!Number.isFinite(n)) return;
  if (budget.size > 500) budget.clear();
  budget.set(token, { n, at: Date.now() });
}
function callsLeft(token) {
  const b = budget.get(token);
  return b && Date.now() - b.at < 60000 ? b.n : null;
}

// path starts with /v2/ (the one exception is named where it is used: resolveIdToken)
// opts.once: one attempt, no waiting when Webflow asks to slow down. opts.timeoutMs: how long to wait for the answer.
async function request(token, method, path, body, attempt, opts) {
  attempt = attempt || 0;
  opts = opts || {};
  const res = await fetch(API_BASE() + path, {
    method,
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(opts.timeoutMs || 20000)
  });
  noteBudget(token, res);
  // Rate limited (429). Webflow says how long to wait (Retry-After); without that, twice as long as the time
  // before (2, 4, 8 seconds). The call is never tried again sooner than Webflow asks: when the wait is longer than
  // ten seconds, or after three more tries, it stops and the error says how long Webflow asked to wait.
  let retryAfter = 0;
  if (res.status === 429) {
    const asked = parseInt(res.headers.get('retry-after') || '', 10);
    retryAfter = Number.isFinite(asked) && asked > 0 ? asked : 0;
    const wait = retryAfter ? retryAfter * 1000 : RETRY_BASE_MS() * Math.pow(2, attempt);
    if (!opts.once && attempt < MAX_RETRIES && wait <= MAX_WAIT_MS) {
      await sleep(wait);
      return request(token, method, path, body, attempt + 1, opts);
    }
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error((data && (data.message || data.msg || data.error)) || ('Webflow API error ' + res.status));
    err.status = res.status;
    err.data = data;
    if (res.status === 429) err.retryAfter = retryAfter || 60;
    throw err;
  }
  return data;
}
const call = (token, method, path, body) => request(token, method, '/v2' + path, body);

// The scopes are joined by a space written as %20, as Webflow's OAuth documentation writes them. URLSearchParams
// writes a space as "+", and every "+" it writes is a space (a plus sign in a value becomes %2B).
function authorizeUrl({ clientId, redirectUri, state }) {
  return AUTH_BASE() + '/oauth/authorize?' + new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope: SCOPES.join(' '), state
  }).toString().replace(/\+/g, '%20');
}

// One token request per authorization code (codes are single use and are never retried or logged).
// Every authorization starts at the app's own /auth address, which names the redirect address, so the same
// address is named here, as Webflow requires.
async function exchangeCode({ clientId, clientSecret, code, redirectUri }) {
  const body = { client_id: clientId, client_secret: clientSecret, code, grant_type: 'authorization_code', redirect_uri: redirectUri };
  const res = await fetch(API_BASE() + '/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const err = new Error((data && (data.error_description || data.message || data.error)) || ('Token exchange failed (' + res.status + ')'));
    err.status = res.status;
    throw err;
  }
  return data.access_token;
}

// The app never revokes its own authorization at Webflow (POST /oauth/revoke_authorization is not called anywhere):
// access to Webflow ends when the user uninstalls the app in Webflow. The app notices by a 401 and stops.
const isRevoked = (e) => !!e && e.status === 401;
const authorizedBy = (token) => call(token, 'GET', '/token/authorized_by');
// Who opened the panel inside the Designer: an ID token from webflow.getIdToken(), which only a token of this app
// can resolve. Answers { id, email, firstName, lastName, siteId }.
// Webflow offers this endpoint on the /beta path only; it is the documented way for a Hybrid App to verify the ID token.
const resolveIdToken = (token, idToken) => request(token, 'POST', '/beta/token/resolve', { idToken });
// Does Webflow still accept this token? One short question (GET /v2/token/authorized_by: one attempt, at most
// eight seconds). 'ok', 'revoked' (Webflow answered 401), or 'unknown' when Webflow did not say: no answer, an
// error, or a request to slow down. 'unknown' never removes anything.
const TOKEN_STATUS_TIMEOUT_MS = 8000;
async function tokenStatus(token) {
  try {
    await request(token, 'GET', '/v2/token/authorized_by', null, 0, { once: true, timeoutMs: TOKEN_STATUS_TIMEOUT_MS });
    return 'ok';
  } catch (e) { return isRevoked(e) ? 'revoked' : 'unknown'; }
}
const listSites = async (token) => ((await call(token, 'GET', '/sites')) || {}).sites || [];
const getSite = (token, siteId) => call(token, 'GET', '/sites/' + siteId);

async function listPages(token, siteId, max) {
  const pages = [];
  let offset = 0;
  while (pages.length < (max || 500)) {
    const data = await call(token, 'GET', `/sites/${siteId}/pages?limit=100&offset=${offset}`);
    const batch = (data && data.pages) || [];
    pages.push(...batch);
    const total = data && data.pagination ? data.pagination.total : batch.length;
    offset += batch.length;
    if (!batch.length || offset >= total) break;
  }
  return pages;
}

// SEO title and description of a static page (Webflow ignores slug changes for home and templates; we never send a slug).
// localeId is only for a secondary locale: without it Webflow writes the primary one, and it refuses a primary locale id.
async function updatePageSeo(token, pageId, { title, description, ogTitle, ogDescription }, localeId) {
  const body = { seo: {} };
  if (title != null) body.seo.title = title;
  if (description != null) body.seo.description = description;
  if (ogTitle != null || ogDescription != null) {
    body.openGraph = {};
    if (ogTitle != null) { body.openGraph.title = ogTitle; body.openGraph.titleCopied = false; }
    if (ogDescription != null) { body.openGraph.description = ogDescription; body.openGraph.descriptionCopied = false; }
  }
  return call(token, 'PUT', '/pages/' + pageId + (localeId ? '?localeId=' + encodeURIComponent(localeId) : ''), body);
}

// One page's settings (title, SEO and Open Graph fields, the site it belongs to).
const getPage = (token, pageId) => call(token, 'GET', '/pages/' + encodeURIComponent(pageId));

// The content of a static page as Webflow holds it: its text nodes (with their HTML), images (with alt text) and
// component instances. 100 nodes a call, up to `max` nodes. This is how the app reads what a page says.
async function pageDom(token, pageId, max) {
  const cap = max || 600;
  const nodes = [];
  let offset = 0;
  let total = 0;
  let lastUpdated = null;
  while (nodes.length < cap) {
    const d = await call(token, 'GET', `/pages/${encodeURIComponent(pageId)}/dom?limit=100&offset=${offset}`);
    const batch = (d && d.nodes) || [];
    nodes.push(...batch);
    total = d && d.pagination && typeof d.pagination.total === 'number' ? d.pagination.total : nodes.length;
    lastUpdated = (d && d.lastUpdated) || lastUpdated;
    offset += batch.length;
    if (!batch.length || offset >= total) break;
  }
  return { nodes: nodes.slice(0, cap), total, truncated: total > cap, lastUpdated };
}

async function listCollections(token, siteId) {
  const data = await call(token, 'GET', `/sites/${siteId}/collections`);
  return (data && data.collections) || [];
}
const getCollection = (token, collectionId) => call(token, 'GET', `/collections/${collectionId}`);
// New CMS items are always created as drafts: the user reviews and publishes them in Webflow.
// cmsLocaleId is only for a secondary locale: without it the item is created in the primary one.
const createDraftItem = (token, collectionId, fieldData, cmsLocaleId) => call(token, 'POST', `/collections/${collectionId}/items`, Object.assign({ isArchived: false, isDraft: true, fieldData }, cmsLocaleId ? { cmsLocaleId } : {}));

module.exports = {
  SCOPES, call, callsLeft, authorizeUrl, exchangeCode, isRevoked, authorizedBy, resolveIdToken, tokenStatus, listSites, getSite,
  listPages, getPage, pageDom, updatePageSeo, listCollections, getCollection, createDraftItem
};
