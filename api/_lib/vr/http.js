'use strict';
// The public addresses of the AI Visibility Report. No account and no session: the id in the address of a check is
// what gives access to it, so it is long and random, never listed anywhere, and its pages are kept out of search.
// Visitors use these addresses at silitlabs.com, which passes them on to /_vr here (see where.js and vercel.json).
//   GET  /ai-visibility-report           the landing page
//   GET  /ai-visibility-report/sample    the sample report (a made-up business)
//   POST /check/start                    { url } -> { id }
//   GET  /check/{id}                     the check, in whatever stage it is
//   GET  /check/{id}/state               the same as JSON, read by the open page
//   POST /check/{id}/run | pump | unlock | confirm | email | recheck
const crypto = require('crypto');
const core = require('./core');
const state = require('./state');
const pay = require('./pay');
const pages = require('./pages');
const where = require('./where');
const store = require('../store');
const kv = require('../kv');

const ipKey = (ip) => crypto.createHmac('sha256', process.env.SESSION_SECRET || 'aiseodeck').update('vrip:' + ip).digest('hex').slice(0, 20);
const CACHED = { 'Cache-Control': 'public, max-age=300, s-maxage=3600' };

function csp(nonce) {
  return ["default-src 'none'", "script-src 'nonce-" + nonce + "'", "style-src 'unsafe-inline' https://fonts.googleapis.com", 'font-src https://fonts.gstatic.com', "img-src 'self' data:", "connect-src 'self'", "form-action 'self'", "base-uri 'none'", "frame-ancestors 'none'"].join('; ');
}

async function publicOf(check, extra) {
  const rows = await core.rowsOf(check.id);
  return state.publicState(check, rows, Object.assign({ canPay: await pay.enabled() }, extra || {}));
}

async function handle(req, res, path, method, h) {
  const { send, json, redirect } = h;
  const ip = h.clientIp(req);

  if (path === pages.PATH) return send(res, 200, pages.landing(), CACHED);
  if (path === pages.PATH + '/sample') return send(res, 200, pages.samplePage(), CACHED);
  if (path.startsWith(pages.PATH + '/')) return send(res, 404, pages.errorPage('Not found', 'There is nothing at this address.'));
  if (path === '/check') return redirect(res, pages.PATH);

  // the pages are read at the site's address, so that is where their forms and buttons post from
  if (method === 'POST' && !h.sameOrigin(req) && !where.fromSite(req)) return json(res, 403, { error: 'Cross-site request blocked.' });

  if (path === '/check/start') {
    if (method !== 'POST') return redirect(res, pages.PATH);
    if (!h.localRateOk('vrs:' + ip, 8, 60000)) return json(res, 429, { error: 'Too many checks at once. Wait a minute and try again.' });
    const b = await h.readBody(req);
    return json(res, 200, await core.start(String((b && b.url) || ''), { ip: ipKey(ip) }));
  }

  const m = path.match(/^\/check\/([A-Za-z0-9_-]{16,40})(?:\/([a-z]+))?$/);
  if (!m) return send(res, 404, pages.errorPage('Check not found', 'This address does not lead to a check.'));
  const id = m[1], action = m[2] || '';

  if (method === 'GET' && !action) {
    if (!h.localRateOk('vrv:' + ip, 90, 60000)) return send(res, 429, pages.errorPage('Too many requests', 'Wait a minute and reload.'), { 'Retry-After': '60' });
    const q = h.queryOf(req);
    let paying = '';
    if (q.checkout_id) {
      // back from the checkout: read it at Polar so the report starts before the webhook arrives
      let r = { ok: false };
      try { r = await pay.confirm(id, q.checkout_id); } catch (e) { console.error('[vr] confirm', e.message); r = { ok: false, pending: true }; }
      if (r.ok || !r.pending) return redirect(res, '/check/' + id);
      paying = String(q.checkout_id);
    } else if (q.key) {
      await pay.unlockByKey(id, q.key);
      return redirect(res, '/check/' + id);
    }
    const check = await core.get(id);
    if (!check) return send(res, 404, pages.errorPage('Check not found', 'This check no longer exists. Free checks are kept for 30 days.'));
    const nonce = crypto.randomBytes(16).toString('base64');
    const st = await publicOf(check, { paying });
    return send(res, 200, pages.checkPage(st, { nonce }), { 'X-Robots-Tag': 'noindex, nofollow', 'Content-Security-Policy': csp(nonce), 'Referrer-Policy': 'same-origin' });
  }

  if (method === 'GET' && action === 'state') {
    if (!h.localRateOk('vrst:' + id, 120, 60000)) return json(res, 429, { error: 'slow down' });
    const check = await core.get(id);
    if (!check) return json(res, 404, { error: 'This check no longer exists.' });
    return json(res, 200, await publicOf(check));
  }
  if (method !== 'POST') return send(res, 404, pages.errorPage('Not found', 'There is nothing at this address.'));

  if (action === 'pump') {
    if (!h.localRateOk('vrp:' + id, 40, 60000) || !(await store.rateOk('vrpump:' + id, 400, 3600))) return json(res, 200, { busy: true });
    // up to 45 seconds of work per request (the function may run 60)
    return json(res, 200, await core.pump(id, 45000));
  }
  const b = (await h.readBody(req)) || {};
  if (action === 'run') {
    if (!h.localRateOk('vrr:' + ip, 10, 60000)) return json(res, 429, { error: 'Too many requests. Wait a minute.' });
    return json(res, 200, await core.runFree(id, { topic: String(b.topic || ''), question: String(b.question || ''), brand: String(b.brand || ''), country: String(b.country || '') }));
  }
  if (action === 'unlock') {
    if (!h.localRateOk('vru:' + ip, 8, 60000)) return json(res, 429, { error: 'Too many requests. Wait a minute.' });
    const check = await core.get(id);
    if (!check) return json(res, 404, { error: 'This check no longer exists.' });
    if (check.paid) return json(res, 200, { started: true });
    if (!(await pay.enabled())) return json(res, 200, { error: 'The full report is not on sale yet. Leave your email and we will tell you when it opens.' });
    try { const url = await pay.checkoutUrl(check, where.site()); await core.count('checkout'); return json(res, 200, { url }); }
    catch (e) { console.error('[vr] checkout', e.message); return json(res, 200, { error: 'The checkout could not be opened. Try again in a minute.' }); }
  }
  if (action === 'confirm') {
    if (!h.localRateOk('vrc:' + id, 30, 60000)) return json(res, 200, { ok: false, pending: true });
    try { const r = await pay.confirm(id, String(b.checkout_id || '')); return json(res, 200, { ok: !!r.ok, pending: !!r.pending }); }
    catch (e) { console.error('[vr] confirm', e.message); return json(res, 200, { ok: false, pending: true }); }
  }
  if (action === 'email') {
    if (!h.localRateOk('vre:' + ip, 6, 60000)) return json(res, 429, { error: 'Too many requests. Wait a minute.' });
    const r = await core.setEmail(id, b.email);
    // not on sale yet: remember who asked, so they can be told when it opens
    if (r.ok && !(await pay.enabled())) await kv.sadd('vr:wait', id);
    return json(res, 200, r);
  }
  if (action === 'recheck') {
    if (!h.localRateOk('vrk:' + ip, 4, 60000)) return json(res, 429, { error: 'Too many requests. Wait a minute.' });
    const r = await core.startRecheck(id, 'manual');
    return json(res, 200, r.id ? { id: r.id } : r);
  }
  return json(res, 404, { error: 'unknown action' });
}

const isOurs = (path) => path === pages.PATH || path.startsWith(pages.PATH + '/') || path === '/check' || path.startsWith('/check/');
const tick = (opts) => core.tick(opts || { budgetMs: 45000 });
const stats = (days) => core.stats(days);

module.exports = { handle, isOurs, tick, stats };
