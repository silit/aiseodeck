'use strict';
// Minimal Webflow Data API client (v2 and the v2 beta paths) with 429 backoff.
// Scopes: read sites and pages, write page SEO settings and JSON-LD schema, read and write CMS items (FAQ drafts).

const API_BASE = () => (process.env.WEBFLOW_API_BASE || 'https://api.webflow.com').replace(/\/+$/, '');
const AUTH_BASE = () => (process.env.WEBFLOW_AUTH_BASE || 'https://webflow.com').replace(/\/+$/, '');

const SCOPES = ['authorized_user:read', 'sites:read', 'pages:read', 'pages:write', 'cms:read', 'cms:write'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_RETRIES = 3;
const RETRY_BASE_MS = () => parseInt(process.env.WEBFLOW_RETRY_BASE_MS || '', 10) || 2000;

// path starts with /v2/ or /beta/
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
const beta = (token, method, path, body) => request(token, method, '/beta' + path, body);

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
const resolveIdToken = (token, idToken) => beta(token, 'POST', '/token/resolve', { idToken });
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

// JSON-LD schema markup (Data API v2 beta). One JSON-LD value per page; several types go in an @graph.
// The API writes and reads the primary locale when localeId is left out; its localeId names a secondary locale, which
// AI SEO Deck never writes. So the primary locale is targeted by leaving it out, as Webflow documents.
const getSchema = (token, pageId, secondaryLocaleId) => beta(token, 'GET', `/pages/${pageId}/schema-markup` + (secondaryLocaleId ? '?localeId=' + encodeURIComponent(secondaryLocaleId) : ''));
const putSchema = (token, pageId, jsonLdSchema, secondaryLocaleId) => beta(token, 'PUT', `/pages/${pageId}/schema-markup` + (secondaryLocaleId ? '?localeId=' + encodeURIComponent(secondaryLocaleId) : ''), { jsonLdSchema });
async function querySchemas(token, siteId, pageIds) {
  const out = [];
  for (let i = 0; i < pageIds.length; i += 100) {
    const d = await beta(token, 'POST', `/sites/${siteId}/pages/schema-markup/query`, { pages: pageIds.slice(i, i + 100).map((id) => ({ id })) });
    out.push(...((d && d.pages) || []));
  }
  return out;
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
  SCOPES, call, beta, authorizeUrl, exchangeCode, revokeToken, isRevoked, authorizedBy, resolveIdToken, tokenStatus, listSites, getSite,
  listPages, updatePageSeo, getSchema, putSchema, querySchemas, listCollections, getCollection, createDraftItem
};
