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

// path starts with /v2/ (the one exception is named where it is used: resolveIdToken)
async function request(token, method, path, body, attempt) {
  attempt = attempt || 0;
  const res = await fetch(API_BASE() + path, {
    method,
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000)
  });
  // Rate limited: wait as long as Webflow says, or twice as long as the time before (2, 4, 8 seconds), and give
  // up after three more tries.
  if (res.status === 429 && attempt < MAX_RETRIES) {
    const wait = parseInt(res.headers.get('retry-after') || '0', 10) * 1000 || RETRY_BASE_MS() * Math.pow(2, attempt);
    await sleep(Math.min(wait, 10000));
    return request(token, method, path, body, attempt + 1);
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error((data && (data.message || data.msg || data.error)) || ('Webflow API error ' + res.status));
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}
const call = (token, method, path, body) => request(token, method, '/v2' + path, body);

function authorizeUrl({ clientId, redirectUri, state }) {
  return AUTH_BASE() + '/oauth/authorize?' + new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope: SCOPES.join(' '), state
  }).toString();
}

// One token request per authorization code (codes are single use and are never retried or logged).
// Webflow wants redirect_uri here only when the authorization link had one: our own /auth link
// sends it, the Marketplace install link does not.
async function exchangeCode({ clientId, clientSecret, code, redirectUri }) {
  const body = { client_id: clientId, client_secret: clientSecret, code, grant_type: 'authorization_code' };
  if (redirectUri) body.redirect_uri = redirectUri;
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

// Revokes an access token at Webflow (disconnect and account deletion). Best effort.
async function revokeToken({ clientId, clientSecret, token }) {
  if (!clientId || !clientSecret || !token) return false;
  try {
    const res = await fetch(API_BASE() + '/oauth/revoke_authorization', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, access_token: token })
    });
    const data = await res.json().catch(() => ({}));
    return !!(res.ok && data && data.didRevoke !== false);
  } catch (e) { return false; }
}

const isRevoked = (e) => !!e && e.status === 401;
const authorizedBy = (token) => call(token, 'GET', '/token/authorized_by');
// Who opened the panel inside the Designer: an ID token from webflow.getIdToken(), which only a token of this app
// can resolve. Answers { id, email, firstName, lastName, siteId }.
// Webflow offers this endpoint on the /beta path only; it is the documented way for a Hybrid App to verify the ID token.
const resolveIdToken = (token, idToken) => request(token, 'POST', '/beta/token/resolve', { idToken });
async function tokenStatus(token) {
  try { await authorizedBy(token); return 'ok'; } catch (e) { return isRevoked(e) ? 'revoked' : 'unknown'; }
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
  SCOPES, call, authorizeUrl, exchangeCode, revokeToken, isRevoked, authorizedBy, resolveIdToken, tokenStatus, listSites, getSite,
  listPages, getPage, pageDom, updatePageSeo, listCollections, getCollection, createDraftItem
};
