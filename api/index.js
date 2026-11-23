/*
 * AI Visibility Report, by Silit Labs: what AI assistants tell customers about a business, for any website.
 * No account and no sign-in. Visitors read it at silitlabs.com: that site's Vercel project passes
 * /ai-visibility-report and /check on to /_vr on this project (the rewrites are in vercel.json of both
 * repositories). This is the single serverless entry point; vercel.json sends every path here with the original
 * path in req.query.path.
 */
'use strict';

const net = require('net');
const vr = require('./_lib/vr/http');
const where = require('./_lib/vr/where');
const pages = require('./_lib/vr/pages');
const { timingEqual } = require('./_lib/crypto');

/* ---------- http helpers ---------- */
function send(res, status, body, headers) {
  const h = Object.assign({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }, headers || {});
  res.statusCode = status;
  for (const k of Object.keys(h)) res.setHeader(k, h[k]);
  res.end(body);
}
function json(res, status, obj) { send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json' }); }
function redirect(res, location, headers) { send(res, 302, '', Object.assign({ Location: location }, headers || {})); }
async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
    return Object.fromEntries(new URLSearchParams(String(req.body)));
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 300000) break; chunks.push(chunk); }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (String(req.headers['content-type'] || '').includes('application/json')) { try { return JSON.parse(raw); } catch (e) { return {}; } }
  const out = {};
  for (const [k, v] of new URLSearchParams(raw)) { if (k in out) out[k] = [].concat(out[k], v); else out[k] = v; }
  return out;
}
function pathOf(req) {
  const u = new URL(req.url, 'http://local');
  const p = (req.query && req.query.path) ? String(req.query.path) : u.pathname.replace(/^\/api\/?/, '');
  return '/' + p.replace(/^\/+/, '').replace(/\/+$/, '');
}
function queryOf(req) {
  const u = new URL(req.url, 'http://local');
  const q = Object.fromEntries(u.searchParams);
  if (req.query) for (const k of Object.keys(req.query)) if (q[k] === undefined && k !== 'path') q[k] = req.query[k];
  delete q.path;
  return q;
}
// A request with no Origin, or one sent from a page of this same host. Pages are read at the site's address, and
// requests from there are let in by where.fromSite (see _lib/vr/http.js).
function sameOrigin(req) {
  const origin = req.headers.origin || req.headers.referer || '';
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch (e) { return false; }
}
function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = fwd || String(req.headers['x-real-ip'] || '') || (req.socket && req.socket.remoteAddress) || 'unknown';
  if (!net.isIPv6(ip)) return ip;
  if (/^::ffff:/i.test(ip) && net.isIPv4(ip.slice(7))) return ip.slice(7);
  return ip.split(':').slice(0, 4).join(':') + '::/64';
}
const localHits = new Map();
function localRateOk(key, max, windowMs) {
  const now = Date.now();
  if (localHits.size > 5000) localHits.clear();
  const h = localHits.get(key);
  if (!h || h.until <= now) { localHits.set(key, { n: 1, until: now + windowMs }); return true; }
  h.n++;
  return h.n <= max;
}

/* ---------- cron ---------- */
// Vercel Cron sends "Authorization: Bearer <CRON_SECRET>"; a manual call may use the x-cron-secret header.
// The secret is never taken from the address, so it cannot end up in a request log.
function cronAuthorized(req) {
  const secret = process.env.CRON_SECRET || '';
  if (!secret) return false;
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const given = String(req.headers['x-cron-secret'] || bearer || '');
  return !!given && timingEqual(given, secret);
}

/* ---------- router ---------- */
module.exports = async function handler(req, res) {
  const path = pathOf(req);
  const method = (req.method || 'GET').toUpperCase();
  try {
    if (path === '/health') return send(res, 200, 'ok', { 'Content-Type': 'text/plain' });
    // the report: the landing page, the sample, and every check
    if (vr.isOurs(path)) return await vr.handle(req, res, path, method, { send, json, redirect, readBody, queryOf, clientIp, localRateOk, sameOrigin });
    if (path.startsWith('/cron/')) {
      if (!cronAuthorized(req)) return json(res, 401, { error: 'unauthorized' });
      if (path === '/cron/vr') return json(res, 200, await vr.tick({ budgetMs: 45000 }));
      if (path === '/cron/vrstats') return json(res, 200, { days: await vr.stats(parseInt(queryOf(req).days, 10) || 30) });
      return json(res, 404, { error: 'unknown job' });
    }
    // nothing else lives here: the public address of the report is on the site
    if (path === '/') return redirect(res, where.home());
    return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8', 'X-Robots-Tag': 'noindex' });
  } catch (e) {
    console.error('[vr] request failed', e && e.stack);
    return send(res, 500, pages.errorPage('Something went wrong', 'Something went wrong on our side. Please try again in a minute.'));
  }
};
