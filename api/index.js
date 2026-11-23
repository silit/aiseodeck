/*
 * AI SEO Deck: is your brand named and cited by ChatGPT, Gemini and Claude, and what on your
 * Webflow site keeps it out of their answers. Single serverless entry point; vercel.json rewrites
 * every non-static path here with the original path in req.query.path.
 */
'use strict';

const wf = require('./_lib/webflow');
const store = require('./_lib/store');
const jobs = require('./_lib/jobs');
const html = require('./_lib/html');
const engines = require('./_lib/engines');
const fixes = require('./_lib/fixes');
const llm = require('./_lib/llm');
const auditLib = require('./_lib/audit');
const fetcher = require('./_lib/fetcher');
const billing = require('./_lib/billing');
const email = require('./_lib/email');
const kwLib = require('./_lib/keywords');
const alerts = require('./_lib/alerts');
const analyze = require('./_lib/analyze');
const insights = require('./_lib/insights');
const vr = require('./_lib/vr/http');
const { limitsFor, QUESTIONS, PLANS } = require('./_lib/plans');
const { seal, open, random, timingEqual } = require('./_lib/crypto');
const crypto = require('crypto');
const net = require('net');

const ENV = () => ({
  clientId: process.env.WEBFLOW_CLIENT_ID || '',
  clientSecret: process.env.WEBFLOW_CLIENT_SECRET || '',
  appUrl: (process.env.APP_URL || '').replace(/\/+$/, ''),
  cronSecret: process.env.CRON_SECRET || ''
});
const SESSION_TTL = 30 * 86400;
const COOKIE = 'ad_session';

/* ---------- http helpers ---------- */
function send(res, status, body, headers) {
  const h = Object.assign({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }, headers || {});
  res.statusCode = status;
  for (const k of Object.keys(h)) res.setHeader(k, h[k]);
  res.end(body);
}
function json(res, status, obj) { send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json' }); }
function redirect(res, location, headers) { send(res, 302, '', Object.assign({ Location: location }, headers || {})); }
function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) { try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch (e) { /* bad cookie */ } }
  });
  return out;
}
function cookie(name, value, maxAge) {
  const parts = [name + '=' + encodeURIComponent(value), 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Secure'];
  if (maxAge != null) parts.push('Max-Age=' + maxAge);
  return parts.join('; ');
}
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
  // keep repeated fields (checkbox lists) as arrays
  const out = {};
  for (const [k, v] of new URLSearchParams(raw)) { if (k in out) out[k] = [].concat(out[k], v); else out[k] = v; }
  return out;
}
const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
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
// Notices passed in redirect URLs are signed for their user, so nobody can put their own text on our pages.
function noticeSig(userId, t) { return crypto.createHmac('sha256', process.env.SESSION_SECRET || 'aiseodeck').update('notice:' + userId + ':' + t).digest('hex').slice(0, 16); }
function noticeQuery(user, text) { const t = String(text || '').slice(0, 400); return 'notice=' + encodeURIComponent(t) + '&ns=' + noticeSig(user.id, t); }
function noticeFrom(q, user) {
  if (!q.notice || !q.ns || !user) return '';
  const t = String(q.notice);
  return timingEqual(String(q.ns), noticeSig(user.id, t)) ? t : '';
}
function sameOrigin(req) {
  const origin = req.headers.origin || req.headers.referer || '';
  if (!origin) return true;
  try { return new URL(origin).host === new URL(ENV().appUrl || 'http://local').host || new URL(origin).host === req.headers.host; } catch (e) { return false; }
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
const tooMany = (res, back) => send(res, 429, html.errorPage('Too many requests', 'Please wait a minute and try again.', back || '/'), { 'Retry-After': '60' });
const LOGIN_TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const REPORT_TOKEN_RE = /^[A-Za-z0-9_-]{8,64}$/;
const hostOfUrl = (u) => { try { return new URL(u).host; } catch (e) { return ''; } };
const siteHosts = (site) => [hostOfUrl(site.url)].concat(site.domains || []).filter(Boolean);
const siteUrl = (site, extra) => '/app/site?id=' + encodeURIComponent(site.id) + (extra ? '&' + extra : '');

/* ---------- auth ---------- */
async function currentUser(req) {
  const c = parseCookies(req);
  const s = c[COOKIE] ? open(c[COOKIE]) : null;
  if (!s || !s.u || (s.exp && s.exp < Date.now())) return null;
  const user = await store.getUser(s.u);
  if (user) user._limits = limitsFor(user);
  return user;
}
const sessionCookie = (userId) => cookie(COOKIE, seal({ u: userId, exp: Date.now() + SESSION_TTL * 1000 }), SESSION_TTL);

// A plan picked on the home page ("solo:monthly"), carried through Webflow sign in to the start page.
function wantedPlan(plan, interval) {
  const p = String(plan || '').toLowerCase();
  return PLANS[p] ? p + ':' + (interval === 'yearly' ? 'yearly' : 'monthly') : '';
}
function startUrl(want, kw) {
  const [plan, interval] = String(want).split(':');
  return '/app/start?plan=' + plan + '&interval=' + interval + (kw ? '&kw=' + encodeURIComponent(kw) : '');
}
const withNotice = (url, user, text) => url + (url.includes('?') ? '&' : '?') + noticeQuery(user, text);

// /auth?kw=... comes from the keyword box on the home page: the keyword waits in a cookie until the site is set up.
// /auth?plan=solo&interval=monthly comes from a "Start free trial" button: after Webflow it opens the start page.
async function handleAuth(req, res) {
  const env = ENV();
  const q = queryOf(req);
  const kw = kwLib.clean(q.kw || '');
  const want = wantedPlan(q.plan, q.interval);
  if ((kw || want) && (await currentUser(req))) return redirect(res, want ? startUrl(want, kw) : '/app?kw=' + encodeURIComponent(kw));
  if (!env.clientId || !env.appUrl) { console.error('[aiseodeck] WEBFLOW_CLIENT_ID or APP_URL is missing'); return send(res, 503, html.errorPage('Connecting is paused', 'Connecting to Webflow is not available right now. Try again in a few minutes.', '/')); }
  const state = random(16);
  const cookies = [cookie('ad_state', state, 600)];
  if (kw) cookies.push(cookie('ad_kw', kw, 3600));
  if (want) cookies.push(cookie('ad_plan', want, 3600));
  redirect(res, wf.authorizeUrl({ clientId: env.clientId, redirectUri: env.appUrl + '/callback', state }), { 'Set-Cookie': cookies });
}

async function handleCallback(req, res) {
  const env = ENV();
  const q = queryOf(req);
  const c = parseCookies(req);
  if (q.error) {
    const why = q.error === 'access_denied' ? 'You cancelled on the Webflow screen, so AI SEO Deck has no access and nothing was stored.' : 'Webflow returned "' + String(q.error).replace(/[^a-z_]/gi, '').slice(0, 40) + '".';
    return send(res, 400, html.errorPage('Authorization cancelled', why + ' You can connect any time from the home page.', '/'));
  }
  if (!q.code || String(q.code).length > 512) return send(res, 400, html.errorPage('Missing code', 'Webflow did not return an authorization code.', '/'));
  const fromAuthLink = !!q.state;
  if (fromAuthLink && (!c.ad_state || !timingEqual(q.state, c.ad_state))) return send(res, 400, html.errorPage('Sign in expired', 'This sign in did not match the one we started, or it took longer than 10 minutes. Please start again.', '/auth'));
  if (!localRateOk('cb:' + clientIp(req), 20, 60000)) return tooMany(res, '/');
  let token;
  try { token = await wf.exchangeCode({ clientId: env.clientId, clientSecret: env.clientSecret, code: q.code, redirectUri: fromAuthLink ? env.appUrl + '/callback' : null }); }
  catch (e) { return send(res, 400, html.errorPage('Could not connect to Webflow', 'Webflow did not accept the authorization (' + e.message + '). Please start again.', '/auth')); }
  let info;
  try { info = await wf.authorizedBy(token); } catch (e) { return send(res, 400, html.errorPage('Could not read your Webflow user', e.message, '/')); }
  if (!info || !info.id) return send(res, 400, html.errorPage('Could not read your Webflow user', 'Webflow returned no user id.', '/'));

  let user = await store.getUser(info.id);
  if (!user) user = store.newUser(info);
  user.email = info.email || user.email;
  const conn = store.addConnection(user, token, info.email || '');
  let metas = [];
  try { metas = await wf.listSites(token); } catch (e) { metas = []; }
  const notices = [];
  let added = 0;
  for (const meta of metas) {
    const existing = await store.getSite(meta.id);
    if (existing && existing.userId !== user.id) { notices.push(`${meta.displayName || meta.id} is already connected by another account.`); continue; }
    const site = existing || store.newSite(meta, user.id, conn.id);
    if (existing) { store.refreshMeta(site, meta); site.connectionId = conn.id; }
    await store.saveSite(site);
    if (!user.siteIds.includes(site.id)) { user.siteIds.push(site.id); added++; }
  }
  // A new authorization can replace an older one: drop connections left with no sites.
  for (const old of user.connections.filter((x) => x.id !== conn.id)) {
    const still = (await store.getSites(user.siteIds)).some((s) => s.connectionId === old.id);
    if (!still) { const removed = await store.removeConnection(user, old.id); if (removed) await wf.revokeToken({ clientId: env.clientId, clientSecret: env.clientSecret, token: store.tokenOf(removed) }); }
  }
  const kw = kwLib.clean(c.ad_kw || '');
  const want = wantedPlan(...String(c.ad_plan || '').split(':'));
  // the start page comes first; notices about sites wait on the account and show on the next page
  if (want && notices.length) user.notice = notices.join(' ');
  await store.saveUser(user);
  res.setHeader('Set-Cookie', [sessionCookie(user.id), cookie('ad_state', '', 0), cookie('ad_kw', '', 0), cookie('ad_plan', '', 0)]);
  if (want) return redirect(res, startUrl(want, kw));
  const kwq = kw ? '&kw=' + encodeURIComponent(kw) : '';
  // One new site and nothing set up yet: go straight to its setup
  const sites = await store.getSites(user.siteIds);
  const notReady = sites.filter((s) => !s.project.ready);
  if (!notices.length && sites.length === 1 && notReady.length === 1) return redirect(res, '/app/setup?id=' + encodeURIComponent(notReady[0].id) + kwq);
  redirect(res, '/app?' + (notices.length ? noticeQuery(user, notices.join(' ')) : added ? 'added=' + added : '') + kwq);
}

/* ---------- helpers for site pages ---------- */
async function ownedSite(user, id) {
  if (!id || !(user.siteIds || []).includes(String(id))) return null;
  const site = await store.getSite(String(id));
  return site && site.userId === user.id ? site : null;
}
const notFound = (res) => send(res, 404, html.errorPage('Site not found', 'This site is not connected to your account. It may have been removed or disconnected in Webflow.', '/app'));

function splitList(v, max, each) {
  return String(v || '').split(/[,\n]/).map((x) => x.trim()).filter(Boolean).slice(0, max).map((x) => x.slice(0, each || 80));
}
// Rivals are names. A website typed after a comma is left out: the app asks nobody to type a website address.
function parseRivals(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const name = line.split(',')[0].trim().slice(0, 80);
    if (name.length >= 2 && !out.some((r) => r.name.toLowerCase() === name.toLowerCase())) out.push({ name, domain: '' });
    if (out.length >= 5) break;
  }
  return out;
}
function applyProjectFields(site, b) {
  const p = site.project;
  const brand = String(b.brand || '').trim().slice(0, 80);
  if (brand.length >= 2) p.brand = brand;
  p.aliases = splitList(b.aliases, 6, 80).filter((a) => a.length >= 2);
  // the site's addresses are not a field: they come from Webflow (store.refreshMeta)
  p.competitors = parseRivals(b.rivals);
  p.country = /^[A-Z]{2}$/.test(String(b.country || '')) ? String(b.country) : '';
  p.language = /^[a-z]{2}$/.test(String(b.language || '')) ? String(b.language) : (p.language || 'en');
}
const KW_SOURCES = ['manual', 'idea', 'aio', 'search'];
const newKeyword = (text, source) => ({ id: random(6).replace(/[^A-Za-z0-9]/g, 'x'), text, questions: [], volume: null, source: KW_SOURCES.includes(source) ? source : 'manual', page: '', at: Date.now(), fixedAt: null });
const kwInput = (v) => kwLib.cleanList(String(v || '').split(/[\n,]/), 60);

// Writes the questions and monthly searches of new keywords. Without an AI provider a keyword is asked as itself.
async function prepareKeywords(siteId, user, ids) {
  const site = await store.getSite(siteId);
  if (!site) return;
  const kws = (site.keywords || []).filter((k) => ids.includes(k.id));
  if (!kws.length) return;
  const qs = {};
  let vols = {};
  // The questions (in batches of 20) and the monthly searches are fetched side by side, so the page answers in time.
  const asks = [];
  if (llm.available()) {
    for (let i = 0; i < kws.length; i += 20) {
      const batch = kws.slice(i, i + 20).map((k) => k.text);
      asks.push(fixes.questionsFor(site.project, batch, QUESTIONS, { budgetMs: 30000 }).then((f) => { Object.assign(qs, f); }, (e) => { console.error('[aiseodeck] questions', e.message); }));
    }
  }
  const needVol = kws.filter((k) => k.volume == null).map((k) => k.text);
  if (needVol.length && kwLib.available() && (await store.rateOk('labs:' + user.id, 80, 86400))) {
    asks.push(kwLib.volumes(needVol, site.project.country, site.project.language).then((v) => { vols = v; }, async (e) => { console.error('[aiseodeck] volumes', e.message); await alerts.report('dataforseo', e, 'monthly searches'); }));
  }
  await Promise.all(asks);
  await store.updateSite(siteId, (s) => {
    for (const k of s.keywords || []) {
      if (!ids.includes(k.id)) continue;
      if (!(k.questions || []).length) k.questions = qs[k.text] && qs[k.text].length ? qs[k.text] : [k.text];
      if (vols[k.text] && vols[k.text].volume != null) k.volume = vols[k.text].volume;
    }
  });
}

// The free first check of keywords just added, within the month's allowance; otherwise they wait for the schedule.
async function checkNewKeywords(site, user, ids) {
  const limits = user._limits || limitsFor(user);
  if (!site.project.ready || !site.tracked || !site.sched.firstRunDone) return '';
  const used = store.usageOf(user).newChecks;
  if (used + ids.length > limits.newChecks) return 'New keywords this month are past your plan\'s allowance for instant checks, so they are checked with the next scheduled check.';
  const r = await jobs.startRun(site, user, 'new', { keywordIds: ids });
  if (r.error) return r.error;
  await store.addUsage(user.id, 'newChecks', ids.length);
  return '';
}

function canRun(site, limits, usage) {
  if (site.sched && site.sched.runId) return { ok: false, why: '' };
  const n = (site.keywords || []).length;
  if (!n) return { ok: false, why: 'Add keywords first.' };
  if (!engines.enabled().length) return { ok: false, why: 'No AI engine is connected yet.' };
  if (!site.tracked) return { ok: false, why: site.pausedByUser ? 'Tracking is paused. Resume it in Settings.' : 'Your plan has no free site slot for this site.' };
  if (!site.sched.firstRunDone) return { ok: true, cost: 0 };
  if (!limits.rechecks) return { ok: false, why: 'Checks on demand are part of the paid plans. Every keyword is still checked on schedule.' };
  const left = Math.max(0, limits.rechecks - ((usage && usage.rechecks) || 0));
  if (left < n) return { ok: false, why: `Checking all ${n} keywords needs ${n} keyword checks; ${left} are left this month. Check single keywords from their page.` };
  return { ok: true, cost: n, left };
}
function canCheckKeyword(site, limits, usage) {
  if (site.sched && site.sched.runId) return { ok: false, why: 'A check is running. This keyword can be checked again when it is done.' };
  if (!engines.enabled().length) return { ok: false, why: 'No AI engine is connected yet.' };
  if (!site.tracked) return { ok: false, why: site.pausedByUser ? 'Tracking is paused. Resume it in Settings.' : 'Your plan has no free site slot for this site.' };
  if (!limits.rechecks) return { ok: false, why: 'Checks on demand are part of the paid plans. This keyword is still checked on schedule.' };
  const left = Math.max(0, limits.rechecks - ((usage && usage.rechecks) || 0));
  if (!left) return { ok: false, why: `You used this month's ${limits.rechecks} keyword checks. The scheduled check still runs.` };
  return { ok: true, left };
}
async function runProgress(site) {
  if (!site.sched || !site.sched.runId) return { progress: null, running: [] };
  const active = await store.getRun(site.sched.runId);
  return { progress: { total: active ? active.total : 0, done: await store.resultCount(site.sched.runId) }, running: active ? (active.keywords || []).map((k) => k.id) : [] };
}
// The page a keyword should rank with: the one the user chose, or the best match among the audited pages.
function targetFor(k, audit) {
  if (!audit || k.page === 'new') return null;
  const pages = audit.pages || [];
  if (k.page) {
    const row = pages.find((p) => p.path === k.page);
    if (row) return { path: row.path, pageId: row.pageId || '', static: !!row.pageId, score: 1, row };
  }
  const m = kwLib.matchPage(k.text, pages);
  return m ? Object.assign(m, { row: pages.find((p) => p.path === m.path) }) : null;
}
function backUrl(site, back, extra) {
  const b = String(back || '');
  if (b.startsWith('k:') && (site.keywords || []).some((k) => k.id === b.slice(2))) return '/app/keyword?id=' + encodeURIComponent(site.id) + '&k=' + encodeURIComponent(b.slice(2)) + (extra ? '&' + extra : '') + '#related';
  return siteUrl(site, 'tab=' + (['discover', 'keywords', 'insights', 'settings', 'audit'].includes(b) ? b : 'keywords') + (extra ? '&' + extra : ''));
}

/* ---------- app pages ---------- */
async function handleApp(req, res, user) {
  const q = queryOf(req);
  await store.enforceLimit(user);
  const sites = await store.getSites(user.siteIds || []);
  const kw = kwLib.clean(q.kw || '');
  if (kw) {
    // a keyword from the home page: open the one site it can go to
    const ready = sites.filter((s) => s.project.ready);
    if (ready.length === 1) return redirect(res, siteUrl(ready[0], 'tab=keywords&kw=' + encodeURIComponent(kw)));
    if (!ready.length && sites.length === 1) return redirect(res, '/app/setup?id=' + encodeURIComponent(sites[0].id) + '&kw=' + encodeURIComponent(kw));
  }
  let notice = html.esc(noticeFrom(q, user));
  const added = parseInt(q.added, 10);
  if (added > 0) notice = `${added} site${added === 1 ? '' : 's'} connected. Set one up to start checking.`;
  if (kw && !notice) notice = `Open a site to track "${html.esc(kw)}".`;
  if (user.notice) { notice = html.esc(user.notice); delete user.notice; await store.saveUser(user); }
  send(res, 200, html.dashboard(user, sites, user._limits, notice, { enginesOn: engines.enabled(), trialDays: user._limits.plan === 'free' && billing.trialEligible(user) ? billing.trialDays() : 0 }));
}

// Where someone goes once the plan question is settled: the setup of their one new site, or the sites list.
function afterStart(sites, kw) {
  const ready = sites.filter((s) => s.project.ready);
  const kwq = kw ? 'kw=' + encodeURIComponent(kw) : '';
  if (!ready.length && sites.length === 1) return '/app/setup?id=' + encodeURIComponent(sites[0].id) + (kwq ? '&' + kwq : '');
  return '/app' + (kwq ? '?' + kwq : '');
}

// After "Start free trial" on the home page and Webflow sign in: what the plan costs and when, before the payment page.
async function handleStart(req, res, user) {
  const q = queryOf(req);
  const plan = PLANS[q.plan] ? q.plan : 'solo';
  let interval = q.interval === 'yearly' ? 'yearly' : 'monthly';
  const kw = kwLib.clean(q.kw || '');
  const next = afterStart(await store.getSites(user.siteIds || []), kw);
  if (user._limits.plan !== 'free' || billing.hasLiveSubscription(user)) return redirect(res, next);
  if (!(await billing.canCheckout(user))) return redirect(res, withNotice(next, user, 'Paid plans open soon. You are on the free plan for now: 3 keywords, checked on ' + html.freeEnginesText() + '.'));
  // only what can be bought: the other billing period when this one has no product, or the free plan
  const offers = await billing.offers();
  if (!offers.includes(plan + ':' + interval)) interval = interval === 'yearly' ? 'monthly' : 'yearly';
  if (!offers.includes(plan + ':' + interval)) return redirect(res, withNotice(next, user, `The ${PLANS[plan].name} plan is not open yet. You are on the free plan for now: 3 keywords, checked on ` + html.freeEnginesText() + '.'));
  const notice = user.notice ? html.esc(user.notice) : '';
  if (user.notice) { delete user.notice; await store.saveUser(user); }
  send(res, 200, html.startPage(user, { plan, interval, kw, next, notice, offers, trialDays: billing.trialEligible(user) ? billing.trialDays() : 0 }));
}

// The site's name, addresses and languages, read from Webflow again (GET /v2/sites/:site_id) and kept.
// Answers { site } with the saved site, or { error } when Webflow could not be asked.
async function refreshFromWebflow(user, site) {
  const token = store.tokenForSite(user, site);
  if (!token) return { error: Object.assign(new Error('This site has no Webflow connection.'), { status: 401 }) };
  let meta;
  try { meta = await wf.getSite(token, site.id); } catch (e) { return { error: e }; }
  if (!meta || !meta.id) return { error: new Error('Webflow returned no site.') };
  return { site: (await store.updateSite(site.id, (s) => { store.refreshMeta(s, meta); })) || site };
}
const META_FRESH_MS = 5 * 60000;

async function handleSetupPage(req, res, user) {
  const q = queryOf(req);
  let site = await ownedSite(user, q.id);
  if (!site) return notFound(res);
  // the addresses shown on this page come from Webflow, so they are read again unless they were read just now
  if (!site.metaAt || Date.now() - site.metaAt > META_FRESH_MS) site = (await refreshFromWebflow(user, site)).site || site;
  // the keyword language starts as the language of the site's primary locale in Webflow
  if (!site.project.language && site.locale && /^[a-z]{2}/i.test(site.locale.tag || '')) site.project.language = site.locale.tag.slice(0, 2).toLowerCase();
  send(res, 200, html.setupPage(user, site, user._limits, { usedElsewhere: await store.keywordCount(user, site.id), notice: html.esc(noticeFrom(q, user)), prefill: kwLib.clean(q.kw || '') }));
}

// "Refresh from Webflow" on setup and on the site's settings: reads the site again and goes back.
async function handleSiteRefresh(req, res, user) {
  const b = await readBody(req);
  const site = await ownedSite(user, b.id);
  if (!site) return notFound(res);
  const back = b.back === 'setup' ? '/app/setup?id=' + encodeURIComponent(site.id) : siteUrl(site, 'tab=settings');
  const r = await refreshFromWebflow(user, site);
  if (r.error) return webflowFailed(res, user, site, r.error, back, 'Webflow could not be read: ');
  redirect(res, back + '&' + noticeQuery(user, 'Read from Webflow just now.'));
}

// Keyword ideas from the homepage and the keywords where Google's AI Overviews already cite the site, with volumes.
async function discoverFor(site, user) {
  const t0 = Date.now();
  const out = { at: t0, cited: [], ideas: [], error: '' };
  const p = site.project;
  const labs = kwLib.available() && (await store.rateOk('labs:' + user.id, 80, 86400));
  // The cited keywords and the ideas are looked up side by side, so the page answers in time.
  const cited = labs ? (async () => {
    const dom = (p.domains || [])[0] || hostOfUrl(site.url);
    try { out.cited = (await kwLib.inAiOverviews(dom, p.country, p.language, 40)).map((x) => ({ keyword: x.keyword, volume: x.volume })); }
    catch (e) { await alerts.report('dataforseo', e, 'keywords cited in AI Overviews'); out.error = alerts.KEYWORD_DATA_TEXT; }
  })() : Promise.resolve();
  let ideas = [];
  if (llm.available() && (await store.rateOk('suggest:' + user.id, 20, 3600))) {
    const r = site.url ? await fetcher.getText(site.url + '/', { allowedHosts: siteHosts(site), timeoutMs: 8000 }) : { ok: false };
    const home = r.ok ? auditLib.readPage(r.text) : { title: site.name, description: '', text: '' };
    try { ideas = await fixes.suggestKeywords(p, home, 12, { budgetMs: 30000 }); } catch (e) { console.error('[aiseodeck] keyword ideas', e.message); }
  }
  await cited;
  if (ideas.length) {
    try {
      let vols = {};
      // the searches of the ideas only while the page still has time; without them the ideas still show
      const left = 50000 - (Date.now() - t0);
      if (labs && ideas.length && left > 4000) { try { vols = await kwLib.volumes(ideas, p.country, p.language, Math.min(20000, left)); } catch (e) { await alerts.report('dataforseo', e, 'monthly searches'); vols = {}; } }
      out.ideas = ideas.filter((k) => !out.cited.some((c) => c.keyword === k)).map((k) => ({ keyword: k, volume: vols[k] ? vols[k].volume : null }));
    } catch (e) { console.error('[aiseodeck] keyword ideas', e.message); }
  }
  return out;
}

async function handleSetupSuggest(req, res, user) {
  const b = await readBody(req);
  const site = await ownedSite(user, b.id);
  if (!site) return json(res, 404, { ideas: [], cited: [] });
  if (site.discover && site.discover.at > Date.now() - 7 * 86400000 && (site.discover.ideas || []).concat(site.discover.cited || []).length) return json(res, 200, { ideas: site.discover.ideas || [], cited: site.discover.cited || [] });
  const d = await discoverFor(site, user);
  await store.updateSite(site.id, (s) => { s.discover = d; });
  json(res, 200, { ideas: d.ideas, cited: d.cited });
}

async function handleSetupSave(req, res, user) {
  const b = await readBody(req);
  const site = await ownedSite(user, b.id);
  if (!site) return notFound(res);
  const limits = user._limits;
  const room = Math.max(0, limits.keywords - (await store.keywordCount(user, site.id)));
  const picked = kwLib.cleanList(list(b.pick).concat(String(b.own || '').split(/[\n,]/)), 200);
  const kept = picked.slice(0, room);
  const disc = site.discover || {};
  const sourceOf = (t) => ((disc.cited || []).some((x) => x.keyword === t) ? 'aio' : (disc.ideas || []).some((x) => x.keyword === t) ? 'idea' : 'manual');
  const volOf = (t) => { const x = (disc.cited || []).concat(disc.ideas || []).find((y) => y.keyword === t); return x && x.volume != null ? x.volume : null; };
  let fresh = [];
  let updated = await store.updateSite(site.id, (s) => {
    applyProjectFields(s, b);
    const old = s.keywords || [];
    s.keywords = kept.map((t) => old.find((o) => o.text === t) || Object.assign(newKeyword(t, sourceOf(t)), { volume: volOf(t) }));
    fresh = s.keywords.filter((k) => !old.includes(k)).map((k) => k.id);
    for (const id of Object.keys(s.kw || {})) if (!s.keywords.some((k) => k.id === id)) delete s.kw[id];
    s.project.ready = true;
    s.pausedByUser = false;
  });
  if (!updated) return notFound(res);
  if (fresh.length) await prepareKeywords(site.id, user, fresh);
  await store.enforceLimit(user);
  updated = await store.getSite(site.id);
  const notes = [];
  if (picked.length > kept.length) notes.push(`Your plan tracks ${limits.keywords} keywords across your sites, so ${picked.length - kept.length} were left out.`);
  if (!updated.tracked) notes.push(`Your plan tracks ${limits.sites} site${limits.sites === 1 ? '' : 's'}. Pause another site or upgrade to check this one.`);
  else if (updated.keywords.length && !updated.sched.runId && !updated.sched.firstRunDone) {
    const r = await jobs.startRun(updated, user, 'first');
    if (r.error) notes.push(r.error);
  }
  redirect(res, siteUrl(updated, 'tab=keywords' + (notes.length ? '&' + noticeQuery(user, notes.join(' ')) : '')));
}

// What the sidebar of a site's pages shows: the plan, keywords in use, checks left, and the audit for Site health.
async function sideData(user, audit) {
  const limits = user._limits;
  const usage = store.usageOf(user);
  return { limits, used: await store.keywordCount(user), checksLeft: limits.rechecks ? Math.max(0, limits.rechecks - ((usage && usage.rechecks) || 0)) : null, audit: audit || null };
}

async function handleSitePage(req, res, user) {
  const q = queryOf(req);
  const site = await ownedSite(user, q.id);
  if (!site) return notFound(res);
  if (!site.project.ready) return redirect(res, '/app/setup?id=' + encodeURIComponent(site.id) + (q.kw ? '&kw=' + encodeURIComponent(kwLib.clean(q.kw)) : ''));
  const tab = ['overview', 'keywords', 'discover', 'insights', 'audit', 'settings'].includes(q.tab) ? q.tab : (q.tab === 'setup' ? 'settings' : q.tab === 'rivals' || q.tab === 'sources' ? 'insights' : q.kw ? 'keywords' : 'overview');
  const limits = user._limits;
  const { progress, running } = await runProgress(site);
  const hist = await store.history(site.id, 12);
  const audit = await store.getAudit(site.id);
  let notice = html.esc(noticeFrom(q, user));
  if (q.saved) notice = 'Saved.';
  const side = await sideData(user, audit);
  const room = Math.max(0, limits.keywords - side.used);
  send(res, 200, html.sitePage(user, site, {
    tab, limits, progress, running, history: hist, audit, side, notice, room, prefill: kwLib.clean(q.kw || ''),
    engines: engines.forLimits(limits), locked: engines.lockedFor(limits), canRun: canRun(site, limits, store.usageOf(user)),
    trialDays: limits.plan === 'free' && billing.trialEligible(user) ? billing.trialDays() : 0
  }));
}

async function handleRun(req, res, user) {
  const b = await readBody(req);
  const site = await ownedSite(user, b.id);
  if (!site) return notFound(res);
  const can = canRun(site, user._limits, store.usageOf(user));
  if (!can.ok) return redirect(res, siteUrl(site, can.why ? noticeQuery(user, can.why) : ''));
  const r = await jobs.startRun(site, user, site.sched.firstRunDone ? 'manual' : 'first');
  if (!r.error && can.cost) await store.addUsage(user.id, 'rechecks', can.cost);
  redirect(res, siteUrl(site, r.error ? noticeQuery(user, r.error) : ''));
}

// Called by an open site or keyword page while a check is going: does a slice of the work, reports progress.
async function handlePump(req, res, user) {
  const b = await readBody(req);
  const site = await ownedSite(user, b.id);
  if (!site) return json(res, 404, { error: 'not found' });
  const runId = site.sched && site.sched.runId;
  if (!runId) return json(res, 200, { idle: true });
  if (!localRateOk('pump:' + user.id, 40, 60000) || !(await store.rateOk('pump:' + user.id, 120, 600))) return json(res, 200, { busy: true });
  // up to 50 seconds of work per request (the function may run 60): slow engines get their full 40 seconds
  const r = await jobs.workRun(runId, Date.now() + 50000);
  const finished = await jobs.maybeFinish(runId, Date.now());
  const run = await store.getRun(runId);
  json(res, 200, { finished, busy: !!r.busy, budget: !!r.budget, total: run ? run.total : 0, done: run ? await store.resultCount(runId) : 0 });
}

// Read by an open page every few seconds while a pump request works, so the progress bar keeps moving.
async function handleProgress(req, res, user) {
  const site = await ownedSite(user, queryOf(req).id);
  if (!site) return json(res, 404, { error: 'not found' });
  const runId = site.sched && site.sched.runId;
  if (!runId) return json(res, 200, { idle: true });
  if (!localRateOk('progress:' + user.id, 60, 60000)) return json(res, 200, { busy: true });
  const run = await store.getRun(runId);
  json(res, 200, { total: run ? run.total : 0, done: run ? await store.resultCount(runId) : 0 });
}

async function handleSiteSettings(req, res, user) {
  const b = await readBody(req);
  const site = await ownedSite(user, b.id);
  if (!site) return notFound(res);
  const biz = {
    type: html.BUSINESS_TYPES.some(([k]) => k === b.btype) ? b.btype : 'Organization',
    phone: String(b.phone || '').trim().slice(0, 40),
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.bemail || '').trim()) ? String(b.bemail).trim().slice(0, 120) : '',
    street: String(b.street || '').trim().slice(0, 160),
    city: String(b.city || '').trim().slice(0, 80),
    country: String(b.bcountry || '').trim().slice(0, 60)
  };
  await store.updateSite(site.id, (s) => { applyProjectFields(s, b); s.project.business = biz; });
  redirect(res, siteUrl(site, 'tab=settings&saved=1'));
}

/* ---------- keywords ---------- */
async function handleKeywordsAdd(req, res, user) {
  const b = await readBody(req);
  const site = await ownedSite(user, b.id);
  if (!site) return notFound(res);
  const limits = user._limits;
  const texts = kwInput(b.text);
  const existing = (site.keywords || []).map((k) => k.text);
  const fresh = texts.filter((t) => !existing.includes(t));
  const room = Math.max(0, limits.keywords - (await store.keywordCount(user)));
  const add = fresh.slice(0, room);
  const notes = [];
  if (texts.length && !fresh.length) notes.push(texts.length === 1 ? `"${texts[0]}" is already tracked.` : 'Those keywords are already tracked.');
  if (fresh.length > add.length) notes.push(`Your plan tracks ${limits.keywords} keywords across your sites${add.length ? `, so ${fresh.length - add.length} were left out` : ''}. Remove a keyword or upgrade to add more.`);
  if (!add.length) return redirect(res, backUrl(site, b.back, notes.length ? noticeQuery(user, notes.join(' ')) : ''));
  const made = add.map((t) => newKeyword(t, b.source));
  await store.updateSite(site.id, (s) => { s.keywords = (s.keywords || []).concat(made.filter((k) => !s.keywords.some((o) => o.text === k.text))); });
  await prepareKeywords(site.id, user, made.map((k) => k.id));
  const fresher = await store.getSite(site.id);
  const why = await checkNewKeywords(fresher, user, made.map((k) => k.id));
  if (why) notes.push(why);
  // one keyword typed in: open it, the answers come in there
  if (made.length === 1 && (b.back === 'keywords' || !b.back)) return redirect(res, '/app/keyword?id=' + encodeURIComponent(site.id) + '&k=' + encodeURIComponent(made[0].id) + (notes.length ? '&' + noticeQuery(user, notes.join(' ')) : ''));
  notes.unshift(made.length === 1 ? `Tracking "${made[0].text}".` : `Tracking ${made.length} new keywords.`);
  redirect(res, backUrl(site, b.back, noticeQuery(user, notes.join(' '))));
}

async function keywordContext(user, siteId, kid) {
  const site = await ownedSite(user, siteId);
  if (!site) return {};
  const k = (site.keywords || []).find((x) => x.id === String(kid || ''));
  return { site, k };
}
const kwUrl = (site, k, extra) => '/app/keyword?id=' + encodeURIComponent(site.id) + '&k=' + encodeURIComponent(k.id) + (extra ? '&' + extra : '');

async function handleKeywordPage(req, res, user) {
  const q = queryOf(req);
  const { site, k } = await keywordContext(user, q.id, q.k);
  if (!site) return notFound(res);
  if (!k) return redirect(res, siteUrl(site, 'tab=keywords&' + noticeQuery(user, 'That keyword is no longer tracked.')));
  const limits = user._limits;
  const sum = site.kw && site.kw[k.id];
  const { progress, running } = await runProgress(site);
  let run = null, results = {};
  const runId = running.includes(k.id) && !sum ? site.sched.runId : sum && sum.runId;
  if (runId) { run = await store.getRun(runId); results = await store.results(runId); }
  const audit = await store.getAudit(site.id);
  const target = targetFor(k, audit);
  const draft = (await store.getDraft(site.id, 'kwfix:' + k.id)) || {};
  const related = await store.getDraft(site.id, 'rel:' + k.id);
  let collections = [];
  const token = store.tokenForSite(user, site);
  if (token && (draft.at || k.page === 'new' || (audit && !target))) { try { collections = (await wf.listCollections(token, site.id)).slice(0, 30); } catch (e) { collections = []; } }
  send(res, 200, html.keywordPage(user, site, k, {
    notice: html.esc(noticeFrom(q, user)), limits, progress, running, run, results, target, draft, related: related ? related.list : null, collections,
    pages: audit ? audit.pages : null, origin: audit ? audit.origin : (site.url || ''), engines: engines.forLimits(limits), locked: run ? [] : engines.lockedFor(limits),
    labs: kwLib.available(), canCheck: canCheckKeyword(site, limits, store.usageOf(user)), side: await sideData(user, audit)
  }));
}

async function handleKeywordCheck(req, res, user) {
  const b = await readBody(req);
  const { site, k } = await keywordContext(user, b.id, b.k);
  if (!site) return notFound(res);
  if (!k) return redirect(res, siteUrl(site, 'tab=keywords'));
  const can = canCheckKeyword(site, user._limits, store.usageOf(user));
  if (!can.ok) return redirect(res, kwUrl(site, k, noticeQuery(user, can.why)));
  const r = await jobs.startRun(site, user, 'recheck', { keywordIds: [k.id] });
  if (r.error) return redirect(res, kwUrl(site, k, noticeQuery(user, r.error)));
  await store.addUsage(user.id, 'rechecks', 1);
  redirect(res, kwUrl(site, k));
}

async function handleKeywordQuestions(req, res, user) {
  const b = await readBody(req);
  const { site, k } = await keywordContext(user, b.id, b.k);
  if (!site) return notFound(res);
  if (!k) return redirect(res, siteUrl(site, 'tab=keywords'));
  const qs = [];
  for (const l of String(b.questions || '').split('\n')) { const t = l.replace(/\s+/g, ' ').trim().slice(0, 200); if (t.length >= 4 && !qs.includes(t)) qs.push(t); }
  await store.updateSite(site.id, (s) => { const x = s.keywords.find((y) => y.id === k.id); if (x) x.questions = qs.slice(0, QUESTIONS).length ? qs.slice(0, QUESTIONS) : [x.text]; });
  redirect(res, kwUrl(site, k, noticeQuery(user, qs.length > QUESTIONS ? `Saved the first ${QUESTIONS} questions. They are used from the next check.` : 'Questions saved. They are used from the next check.')));
}

async function handleKeywordRemove(req, res, user) {
  const b = await readBody(req);
  const { site, k } = await keywordContext(user, b.id, b.k);
  if (!site) return notFound(res);
  if (!k || b.sure !== '1') return redirect(res, k ? kwUrl(site, k) : siteUrl(site, 'tab=keywords'));
  await store.updateSite(site.id, (s) => {
    s.keywords = (s.keywords || []).filter((x) => x.id !== k.id);
    delete s.kw[k.id];
    s.sched.pendingKw = (s.sched.pendingKw || []).filter((id) => id !== k.id);
    if (s.latest) {
      const sum = analyze.siteSummary(s.project, s.keywords, s.kw);
      Object.assign(s.latest, sum, { gaps: insights.gaps(s.keywords, s.kw) });
    }
  });
  redirect(res, siteUrl(site, 'tab=keywords&' + noticeQuery(user, `Stopped tracking "${k.text}".`)));
}

async function handleKeywordTarget(req, res, user) {
  const b = await readBody(req);
  const { site, k } = await keywordContext(user, b.id, b.k);
  if (!site) return notFound(res);
  if (!k) return redirect(res, siteUrl(site, 'tab=keywords'));
  const audit = await store.getAudit(site.id);
  const path = String(b.path || '');
  const ok = path === 'new' || path === '' || ((audit && audit.pages) || []).some((p) => p.path === path);
  if (!ok) return redirect(res, kwUrl(site, k));
  await store.updateSite(site.id, (s) => { const x = s.keywords.find((y) => y.id === k.id); if (x) x.page = path; });
  await store.saveDraft(site.id, 'kwfix:' + k.id, {});
  redirect(res, kwUrl(site, k));
}

// Writes the fixes for a keyword from the page itself (or a new page from the site's own text).
async function handleKeywordPlan(req, res, user) {
  const b = await readBody(req);
  const { site, k } = await keywordContext(user, b.id, b.k);
  if (!site) return notFound(res);
  if (!k) return redirect(res, siteUrl(site, 'tab=keywords'));
  const back = (t) => redirect(res, kwUrl(site, k, noticeQuery(user, t)));
  if (!llm.available()) return back('Writing fixes needs an AI provider, which is not connected yet.');
  if (!(await store.rateOk('fixai:' + user.id, 30, 3600))) return back('That is a lot of suggestions for one hour. Try again a bit later.');
  const audit = await store.getAudit(site.id);
  if (!audit) return back('Run the site audit first, so we know your pages.');
  const target = targetFor(k, audit);
  const allowed = siteHosts(site).concat(hostOfUrl(audit.origin));
  const draft = { at: Date.now() };
  try {
    if (!target) {
      const paths = ['/'].concat((audit.pages || []).filter((p) => p.ok && p.path !== '/' && !p.noindex).slice(0, 3).map((p) => p.path));
      const reads = await Promise.all(paths.map((p) => fetcher.getText(audit.origin + p, { allowedHosts: allowed, timeoutMs: 7000 })));
      const source = reads.filter((r) => r.ok).map((r) => '\n' + auditLib.readPage(r.text).text.slice(0, 2500)).join('');
      if (source.trim().length < 200) return back('Your pages have too little text to draft from. Add content first.');
      draft.newPage = await fixes.suggestNewPage(site.project, k.text, k.questions, source);
    } else {
      const r = await fetcher.getText(audit.origin + target.path, { allowedHosts: allowed, timeoutMs: 9000 });
      if (!r.ok) return back('The page could not be read right now (' + (r.error || 'HTTP ' + r.status) + ').');
      const page = Object.assign(auditLib.readPage(r.text), { path: target.path });
      const qs = (k.questions || []).concat(((site.kw[k.id] || {}).queries || []).slice(0, 3));
      const [meta, faq] = await Promise.all([fixes.suggestMeta(site.project, page, k.text), fixes.suggestFaq(site.project, page, qs).catch(() => [])]);
      draft.meta = meta; draft.faq = faq; draft.path = target.path;
    }
  } catch (e) { return back('No suggestion this time. ' + alerts.publicText(e, alerts.WRITING_TEXT)); }
  await store.saveDraft(site.id, 'kwfix:' + k.id, draft);
  redirect(res, kwUrl(site, k, noticeQuery(user, 'Fixes ready. Review them, change what you like, then apply.')));
}

// Webflow Localization: AI SEO Deck reads, checks and writes the primary language only. Webflow writes the primary locale
// when no locale is named and refuses a primary locale id ("The provided locale must be a secondary locale"), so writes
// never name a locale. The locales are read fresh before a write and kept on the site for the notes.
async function primaryLocale(token, site) {
  try {
    const loc = store.localeOf(await wf.getSite(token, site.id));
    if (JSON.stringify(loc) !== JSON.stringify(site.locale || null)) { site.locale = loc; await store.updateSite(site.id, (s) => { s.locale = loc; }); }
    return loc;
  } catch (e) {
    if (wf.isRevoked(e)) throw e;
    return site.locale || null;
  }
}

async function addCmsItems(token, site, collectionId, items, cmsLocaleId) {
  const cols = await wf.listCollections(token, site.id);
  const col = cols.find((c) => c.id === String(collectionId || ''));
  if (!col) return { error: 'Pick one of this site\'s CMS collections.' };
  const full = await wf.getCollection(token, col.id);
  const fields = (full && full.fields) || [];
  const textField = fields.find((f) => /answer|antwort|cevap|reponse|respuesta|body|content|post|text/i.test(f.displayName || f.slug || '') && ['RichText', 'PlainText'].includes(f.type) && !['name', 'slug'].includes(f.slug))
    || fields.find((f) => f.type === 'RichText') || fields.find((f) => f.type === 'PlainText' && !['name', 'slug'].includes(f.slug));
  if (!textField) return { error: `${col.displayName} has no text field. Add a Rich text field, then try again.` };
  let made = 0;
  for (const it of items) {
    const slug = (it.slug || it.name).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) + '-' + random(3).toLowerCase().replace(/[^a-z0-9]/g, 'x');
    await wf.createDraftItem(token, col.id, { name: it.name, slug, [textField.slug]: textField.type === 'RichText' ? it.html : it.text }, cmsLocaleId);
    made++;
  }
  return { made, name: col.displayName };
}

// One click: the fixes the user kept go to Webflow as unpublished changes and CMS drafts.
async function handleKeywordApply(req, res, user) {
  const b = await readBody(req);
  const { site, k } = await keywordContext(user, b.id, b.k);
  if (!site) return notFound(res);
  if (!k) return redirect(res, siteUrl(site, 'tab=keywords'));
  const back = (t) => redirect(res, kwUrl(site, k, noticeQuery(user, t)));
  if (!user._limits.canApply) return back('Applying to Webflow is part of the paid plans. Copy the text into Webflow instead.');
  const token = store.tokenForSite(user, site);
  if (!token) return back('The Webflow connection for this site is missing. Connect again.');
  const draft = (await store.getDraft(site.id, 'kwfix:' + k.id)) || {};
  const done = [];
  try {
    await primaryLocale(token, site);
    if (b.what === 'newpage') {
      const np = draft.newPage;
      if (!np) return back('Draft the page first.');
      const htmlBody = '<p>' + html.esc(np.intro) + '</p>' + np.faq.map((x) => '<h3>' + html.esc(x.q) + '</h3><p>' + html.esc(x.a) + '</p>').join('');
      const text = np.intro + '\n\n' + np.faq.map((x) => x.q + '\n' + x.a).join('\n\n');
      const r = await addCmsItems(token, site, b.collection, [{ name: np.title, slug: np.slug, html: htmlBody, text }]);
      if (r.error) return back(r.error);
      done.push(`a draft page in ${r.name}`);
    } else {
      const audit = await store.getAudit(site.id);
      const target = targetFor(k, audit);
      if (!target) return back('Choose the page for this keyword first.');
      const row = target.row;
      const pairs = parseFaq(b.faq);
      if (b.do_meta === '1') {
        const title = String(b.title || '').replace(/\s+/g, ' ').trim().slice(0, 90);
        const description = String(b.description || '').replace(/\s+/g, ' ').trim().slice(0, 200);
        if (title.length < 5 || description.length < 20) return back('Write a title of at least 5 characters and a description of at least 20.');
        if (target.pageId) {
          await wf.updatePageSeo(token, target.pageId, { title, description });
          row.title = title; row.description = description;
          row.issues = (row.issues || []).filter((x) => !/^(title|desc)_/.test(x));
          done.push('the title and description');
        }
        draft.meta = { title, description };
      }
      if (b.do_schema === '1' && pairs.length && target.pageId) {
        if (pairs.length < 2) return back('FAQ schema needs at least two questions and answers.');
        let existing = null;
        try { const s = await wf.getSchema(token, target.pageId); existing = s && (s.jsonLdSchema || null); } catch (e) { existing = null; }
        await wf.putSchema(token, target.pageId, fixes.mergeSchema(existing, [fixes.faqSchema(pairs)]));
        row.schemaTypes = [...new Set((row.schemaTypes || []).concat('FAQPage'))];
        row.issues = (row.issues || []).filter((x) => x !== 'schema_missing' && x !== 'faq_no_schema');
        done.push('FAQ schema');
      }
      if (b.do_cms === '1' && pairs.length) {
        const r = await addCmsItems(token, site, b.collection, pairs.map((p) => ({ name: p.q, html: '<p>' + html.esc(p.a) + '</p>', text: p.a })));
        if (r.error) return back(r.error);
        done.push(`${r.made} answer${r.made === 1 ? '' : 's'} as drafts in ${r.name}`);
      }
      if (pairs.length) draft.faq = pairs;
      if (audit) await store.saveAudit(site.id, audit);
    }
  } catch (e) { return webflowFailed(res, user, site, e, kwUrl(site, k)); }
  if (!done.length) return back('Nothing was selected to apply.');
  await store.saveDraft(site.id, 'kwfix:' + k.id, draft);
  await store.updateSite(site.id, (s) => { const x = s.keywords.find((y) => y.id === k.id); if (x) x.fixedAt = Date.now(); });
  back(`Applied ${andList(done)}. Publish your site in Webflow, then check the keyword again.`);
}
function andList(a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }

/* ---------- the panel inside the Webflow Designer (Designer Extension) ---------- */
// The panel is a static page that Webflow serves from its own address. It proves who opened it with a Webflow ID
// token, which only a token of this app can resolve, so no cookie or session of ours crosses over.
const appBase = () => ENV().appUrl || 'https://aiseodeck.silitlabs.com';

// Webflow serves the panel from the extension's own address, https://<client id>.webflow-ext.com, and that is
// the only origin whose pages may call /ext/* and read the answers. EXT_ORIGINS names others (comma separated),
// for a second registration of the app. Any other origin, or none, is refused before anything is read or done.
function extOrigins() {
  const own = ENV().clientId ? ['https://' + ENV().clientId + '.webflow-ext.com'] : [];
  return own.concat(String(process.env.EXT_ORIGINS || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean));
}
function extHeaders(req, res) {
  const origin = String(req.headers.origin || '');
  res.setHeader('Vary', 'Origin');
  if (!origin || !extOrigins().includes(origin)) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '600');
  return true;
}
async function extAuth(b) {
  const siteId = String(b.siteId || '');
  const idToken = String(b.idToken || '');
  if (!/^[A-Za-z0-9_-]{2,64}$/.test(siteId) || !idToken || idToken.length > 6000) return { status: 400, error: 'Bad request.' };
  if (!localRateOk('ext:' + siteId, 90, 60000)) return { status: 429, error: 'Too many requests. Wait a minute.' };
  const site = await store.getSite(siteId);
  const owner = site && site.userId ? await store.getUser(site.userId) : null;
  const token = owner ? store.tokenForSite(owner, site) : null;
  if (!site || !token) return { connect: true };
  let who;
  try { who = await wf.resolveIdToken(token, idToken); }
  catch (e) { return wf.isRevoked(e) || e.status === 403 ? { status: 401, error: 'Webflow did not accept this session. Close and open the app again.' } : { status: 502, error: 'Webflow could not be reached. Try again.' }; }
  // the token names the site it was made on; without a site, only the account that connected the site may use it
  if (!who || (who.siteId ? who.siteId !== siteId : who.id !== owner.id)) return { status: 403, error: 'This panel belongs to another site.' };
  owner._limits = limitsFor(owner);
  return { site, owner, token, who };
}
const extPath = (b) => { let p = String(b.path || '').trim().replace(/[?#].*$/, ''); if (!p.startsWith('/')) p = '/' + p; p = p.replace(/\/+$/, ''); return !p || p === '/index' ? '/' : p; };
function extRow(audit, b) {
  const pages = (audit && audit.pages) || [];
  return (b.pageId && pages.find((p) => p.pageId === String(b.pageId))) || pages.find((p) => p.path === extPath(b)) || null;
}
function pageKeywords(site, audit, path) {
  return (site.keywords || []).filter((k) => { const t = targetFor(k, audit); return t ? t.path === path : k.page === path; });
}
async function markFixed(site, keywordId) {
  if (!keywordId) return;
  await store.updateSite(site.id, (s) => { const x = (s.keywords || []).find((y) => y.id === String(keywordId)); if (x) x.fixedAt = Date.now(); });
}

async function extContext(a, b) {
  const { site, owner } = a;
  const audit = await store.getAudit(site.id);
  const row = extRow(audit, b);
  const path = row ? row.path : extPath(b);
  const link = (p) => appBase() + p;
  return {
    ok: true,
    site: { name: site.project.brand || site.name, score: site.latest ? site.latest.score : null, keywords: (site.keywords || []).length, ready: !!site.project.ready, url: link(siteUrl(site)), setupUrl: link('/app/setup?id=' + encodeURIComponent(site.id)), healthUrl: link(siteUrl(site, 'tab=audit')), keywordsUrl: link(siteUrl(site, 'tab=keywords')) },
    plan: { name: owner._limits.name, canApply: !!owner._limits.canApply, upgradeUrl: link('/app/settings#plan') },
    page: {
      path, pageId: (row && row.pageId) || String(b.pageId || '') || null, audited: !!row, auditAt: audit ? audit.at : null, score: row ? row.score : null, template: !!(row && row.template),
      title: row ? row.title || '' : '', description: row ? row.description || '' : '', faqFound: row ? (row.faq || []).length : 0, schemaTypes: row ? row.schemaTypes || [] : [],
      issues: row ? (row.issues || []).map((code) => ({ code, label: html.issueLabel(code), text: (auditLib.PAGE_RULES[code] || {}).text || '', w: (auditLib.PAGE_RULES[code] || {}).w || 0 })) : []
    },
    keywords: pageKeywords(site, audit, path).slice(0, 3).map((k) => {
      const s = site.kw && site.kw[k.id];
      const kc = analyze.engineCounts(s);
      return { id: k.id, text: k.text, volume: k.volume == null ? null : k.volume, named: kc.named, answered: kc.answered, checked: !!s, states: (s && s.eng) || {}, vis: s ? Math.round((s.vis || 0) * 100) : null,
        lostTo: [...new Set(Object.values((s && s.lost) || {}).flat())].slice(0, 2), fixedAt: k.fixedAt || null, url: link(kwUrl(site, k)) };
    }),
    engines: engines.forLimits(owner._limits).map((e) => ({ id: e, label: engines.LABEL[e] || e }))
  };
}

async function extSuggest(a, b) {
  const { site, owner } = a;
  if (!llm.available()) return { error: 'Writing needs an AI provider, which is not connected yet.' };
  if (!(await store.rateOk('suggest:' + owner.id, 20, 3600))) return { status: 429, error: 'That is a lot of suggestions for one hour. Try again later.' };
  const audit = await store.getAudit(site.id);
  const row = extRow(audit, b);
  const path = row ? row.path : extPath(b);
  const origin = audit && audit.origin ? audit.origin : String(site.url || '').replace(/\/+$/, '');
  const r = await fetcher.getText(origin + path, { allowedHosts: siteHosts(site).concat(hostOfUrl(origin)), timeoutMs: 9000 });
  if (!r.ok) return { error: 'The published page could not be read. Publish it first, then try again.' };
  const page = Object.assign(auditLib.readPage(r.text), { path });
  const k = (site.keywords || []).find((x) => x.id === String(b.keywordId || '')) || pageKeywords(site, audit, path)[0] || null;
  try {
    if (b.what === 'faq') {
      const qs = k ? (k.questions || []).concat(((site.kw && site.kw[k.id]) || {}).queries || []).slice(0, 6) : (site.keywords || []).flatMap((x) => x.questions || []).slice(0, 8);
      const faq = await fixes.suggestFaq(site.project, page, qs);
      if (!faq.length) return { error: 'The page does not have enough content to answer questions. Add content first.' };
      return { ok: true, faq };
    }
    return { ok: true, meta: await fixes.suggestMeta(site.project, page, k ? k.text : undefined), keyword: k ? k.text : null };
  } catch (e) { return { error: 'No suggestion this time. ' + alerts.publicText(e, alerts.WRITING_TEXT) }; }
}

// FAQ schema goes through the Data API (the Designer has no schema call); the title and description are set by the
// panel itself in the Designer and only reported here.
async function extFaq(a, b) {
  const { site, owner, token } = a;
  if (!owner._limits.canApply) return { status: 402, error: 'Applying to Webflow is part of the paid plans.' };
  const pairs = (Array.isArray(b.faq) ? b.faq : []).map((x) => ({ q: String((x && x.q) || '').replace(/\s+/g, ' ').trim().slice(0, 200), a: String((x && x.a) || '').replace(/\s+/g, ' ').trim().slice(0, 900) })).filter((x) => x.q && x.a).slice(0, 20);
  if (pairs.length < 2) return { status: 400, error: 'FAQ schema needs at least two questions and answers.' };
  const audit = await store.getAudit(site.id);
  const row = extRow(audit, b);
  const pageId = String(b.pageId || (row && row.pageId) || '');
  if (!/^[A-Za-z0-9_-]{2,64}$/.test(pageId)) return { status: 400, error: 'This page cannot take schema from here.' };
  if (!(row && row.pageId === pageId)) {
    // a page the audit has not read yet: make sure it belongs to this site
    try { const p = await wf.call(token, 'GET', '/pages/' + encodeURIComponent(pageId)); if (!p || p.siteId !== site.id) return { status: 403, error: 'This page belongs to another site.' }; }
    catch (e) { return { status: 403, error: 'This page could not be checked.' }; }
  }
  try {
    let existing = null;
    try { const s = await wf.getSchema(token, pageId); existing = s && (s.jsonLdSchema || null); } catch (e) { existing = null; }
    await wf.putSchema(token, pageId, fixes.mergeSchema(existing, [fixes.faqSchema(pairs)]));
  } catch (e) { return { error: 'Webflow did not accept the change: ' + String(e.message || 'unknown error').slice(0, 160) }; }
  if (row) {
    row.schemaTypes = [...new Set((row.schemaTypes || []).concat('FAQPage'))];
    row.issues = (row.issues || []).filter((x) => x !== 'schema_missing' && x !== 'faq_no_schema');
    await store.saveAudit(site.id, audit);
  }
  await markFixed(site, b.keywordId);
  return { ok: true };
}

async function extApplied(a, b) {
  const { site } = a;
  const audit = await store.getAudit(site.id);
  const row = extRow(audit, b);
  const title = String(b.title || '').replace(/\s+/g, ' ').trim().slice(0, 90);
  const description = String(b.description || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (row && title) {
    row.title = title;
    if (description) row.description = description;
    row.issues = (row.issues || []).filter((x) => !/^(title|desc)_/.test(x));
    await store.saveAudit(site.id, audit);
  }
  await markFixed(site, b.keywordId);
  return { ok: true };
}

async function handleExt(req, res, path, method) {
  if (!extHeaders(req, res)) {
    // one line, so that a changed panel address shows up in the logs instead of as a silent failure
    console.log('[aiseodeck] panel: refused origin ' + String(req.headers.origin || '(none)').slice(0, 120));
    return json(res, 403, { error: 'This address may not call the panel.' });
  }
  if (method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (method !== 'POST') return json(res, 405, { error: 'Use POST.' });
  try {
    const b = await readBody(req);
    const a = await extAuth(b);
    if (a.connect) return json(res, 200, { connect: true, connectUrl: appBase() + '/auth' });
    if (a.error) return json(res, a.status || 400, { error: a.error });
    let out;
    if (path === '/ext/context') out = await extContext(a, b);
    else if (path === '/ext/suggest') out = await extSuggest(a, b);
    else if (path === '/ext/faq') out = await extFaq(a, b);
    else if (path === '/ext/applied') out = await extApplied(a, b);
    else return json(res, 404, { error: 'Unknown request.' });
    return json(res, out.status || 200, out);
  } catch (e) {
    console.error('[aiseodeck] panel', e && e.stack);
    return json(res, 500, { error: 'Something went wrong on our side. Try again in a minute.' });
  }
}

async function handleKeywordRelated(req, res, user) {
  const b = await readBody(req);
  const { site, k } = await keywordContext(user, b.id, b.k);
  if (!site) return notFound(res);
  if (!k) return redirect(res, siteUrl(site, 'tab=keywords'));
  if (!kwLib.available()) return redirect(res, kwUrl(site, k, noticeQuery(user, 'Keyword data is not connected on the server yet.')));
  if (!(await store.rateOk('labs:' + user.id, 80, 86400))) return redirect(res, kwUrl(site, k, noticeQuery(user, 'That is a lot of keyword lookups for one day. Try again tomorrow.')));
  let items = [];
  try { items = await kwLib.related(k.text, site.project.country, site.project.language, 15); }
  catch (e) { await alerts.report('dataforseo', e, 'related searches'); return redirect(res, kwUrl(site, k, noticeQuery(user, alerts.KEYWORD_DATA_TEXT))); }
  await store.saveDraft(site.id, 'rel:' + k.id, { list: items, at: Date.now() });
  redirect(res, kwUrl(site, k) + '#related');
}

async function handleDiscover(req, res, user) {
  const b = await readBody(req);
  const site = await ownedSite(user, b.id);
  if (!site) return notFound(res);
  if (!(await store.rateOk('discover:' + site.id, 6, 86400))) return redirect(res, siteUrl(site, 'tab=discover&' + noticeQuery(user, 'Keywords were looked up several times today. Try again tomorrow.')));
  const d = await discoverFor(site, user);
  await store.updateSite(site.id, (s) => { s.discover = d; });
  redirect(res, siteUrl(site, 'tab=discover'));
}

async function handleTrack(req, res, user) {
  const b = await readBody(req);
  const site = await ownedSite(user, b.id);
  if (!site) return notFound(res);
  const on = b.on === '1';
  if (on && !site.tracked) {
    const count = (await store.getSites(user.siteIds || [])).filter((s) => s.tracked).length;
    if (count >= user._limits.sites) return redirect(res, siteUrl(site, 'tab=settings&' + noticeQuery(user, `Your plan tracks ${user._limits.sites} site${user._limits.sites === 1 ? '' : 's'}. Pause another site or upgrade.`)));
  }
  await store.updateSite(site.id, (s) => { s.tracked = on; s.pausedByUser = !on; });
  redirect(res, siteUrl(site, 'tab=settings&saved=1'));
}

async function handleAudit(req, res, user) {
  const b = await readBody(req);
  const site = await ownedSite(user, b.id);
  if (!site) return notFound(res);
  const k = b.back && (site.keywords || []).find((x) => x.id === String(b.back));
  const backTo = (extra) => (k ? kwUrl(site, k, extra) : siteUrl(site, 'tab=audit' + (extra ? '&' + extra : '')));
  if (!(await store.rateOk('audit:' + site.id, 3, 600))) return redirect(res, backTo(noticeQuery(user, 'The audit ran a moment ago. Try again in a few minutes.')));
  try { await jobs.runAudit(site, user, 40000); }
  catch (e) { return redirect(res, backTo(noticeQuery(user, 'The audit could not finish: ' + e.message))); }
  redirect(res, backTo(k ? noticeQuery(user, 'Your pages are read. The best page for this keyword is shown below.') : ''));
}

async function handleLlms(req, res, user) {
  const q = queryOf(req);
  const site = await ownedSite(user, q.id);
  if (!site) return notFound(res);
  const audit = await store.getAudit(site.id);
  if (!audit) return redirect(res, siteUrl(site, 'tab=audit'));
  send(res, 200, fixes.llmsTxt(site.project, audit), { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': 'attachment; filename="llms.txt"' });
}

/* ---------- fixes ---------- */
async function fixContext(user, siteId, path) {
  const site = await ownedSite(user, siteId);
  if (!site) return { error: 'site' };
  const audit = await store.getAudit(site.id);
  const row = audit && (audit.pages || []).find((p) => p.path === String(path || ''));
  if (!row || !row.pageId) return { site, error: 'page' };
  return { site, audit, row, token: store.tokenForSite(user, site) };
}
const draftKey = (path) => 'fix:' + crypto.createHash('sha1').update(String(path)).digest('hex').slice(0, 16);
const fixUrl = (site, path, extra) => '/app/fix?id=' + encodeURIComponent(site.id) + '&page=' + encodeURIComponent(path) + (extra ? '&' + extra : '');

async function webflowFailed(res, user, site, e, back, lead) {
  if (wf.isRevoked(e)) {
    const removed = await store.confirmRevoked(user, site.connectionId, Date.now());
    if (removed) { user.notice = 'Webflow access was removed for ' + (removed.label || 'one connection') + ', so its sites were deleted from AI SEO Deck. Connect again to bring them back.'; await store.saveUser(user); return redirect(res, '/app'); }
    return redirect(res, back + '&' + noticeQuery(user, 'Webflow refused the change. Check that AI SEO Deck still has access to this site, then try again.'));
  }
  return redirect(res, back + '&' + noticeQuery(user, (lead || 'Webflow did not accept the change: ') + e.message));
}

function proposedSchema(site, row, audit, faqPairs, existing) {
  const nodes = [];
  if (row.path === '/') {
    const p = site.project;
    const biz = p.business || {};
    const info = { type: biz.type || 'Organization', name: p.brand || site.name, url: audit.origin + '/', logo: fixes.abs(audit.site.ogImage || audit.site.icon, audit.origin), description: row.description || '', phone: biz.phone, email: biz.email, street: biz.street, city: biz.city, country: biz.country, sameAs: audit.site.socials || [] };
    nodes.push(fixes.orgSchema(info), fixes.websiteSchema(info));
  }
  if (faqPairs && faqPairs.length >= 2) nodes.push(fixes.faqSchema(faqPairs));
  return fixes.mergeSchema(existing, nodes);
}

async function handleFixPage(req, res, user) {
  const q = queryOf(req);
  const ctx = await fixContext(user, q.id, q.page);
  if (ctx.error === 'site') return notFound(res);
  if (ctx.error) return redirect(res, siteUrl(ctx.site, 'tab=audit&' + noticeQuery(user, 'Run the audit first, then open a static page to fix it.')));
  const { site, audit, row, token } = ctx;
  const draft = (await store.getDraft(site.id, draftKey(row.path))) || {};
  let existing = null;
  let existingTypes = [];
  let collections = [];
  if (token) {
    try { const s = await wf.getSchema(token, row.pageId); existing = s && (s.jsonLdSchema || null); } catch (e) { existing = null; }
    try { collections = (await wf.listCollections(token, site.id)).slice(0, 30); } catch (e) { collections = []; }
  }
  if (existing) existingTypes = auditLib.readPage('<script type="application/ld+json">' + JSON.stringify(existing) + '</script>').schemaTypes;
  const faqPairs = draft.faq && draft.faq.length ? draft.faq : (row.faq || []);
  send(res, 200, html.fixPage(user, site, row, { draft, limits: user._limits, notice: html.esc(noticeFrom(q, user)), existingTypes, collections, proposedSchema: proposedSchema(site, row, audit, faqPairs, existing), side: await sideData(user, audit) }));
}

async function handleFixSuggest(req, res, user) {
  const b = await readBody(req);
  const ctx = await fixContext(user, b.id, b.path);
  if (ctx.error === 'site') return notFound(res);
  if (ctx.error) return redirect(res, '/app');
  const { site, audit, row } = ctx;
  const back = fixUrl(site, row.path);
  if (!llm.available()) return redirect(res, back + '&' + noticeQuery(user, 'Suggestions need an AI provider, which is not connected yet.'));
  if (!(await store.rateOk('fixai:' + user.id, 30, 3600))) return redirect(res, back + '&' + noticeQuery(user, 'That is a lot of suggestions for one hour. Try again a bit later.'));
  const r = await fetcher.getText(audit.origin + row.path, { allowedHosts: siteHosts(site).concat(hostOfUrl(audit.origin)), timeoutMs: 9000 });
  if (!r.ok) return redirect(res, back + '&' + noticeQuery(user, 'The page could not be read right now (' + (r.error || 'HTTP ' + r.status) + ').'));
  const page = Object.assign(auditLib.readPage(r.text), { path: row.path });
  const key = draftKey(row.path);
  const draft = (await store.getDraft(site.id, key)) || {};
  try {
    if (b.what === 'faq') {
      const qs = (site.keywords || []).flatMap((k) => k.questions || []);
      draft.faq = await fixes.suggestFaq(site.project, page, qs);
      if (!draft.faq.length) return redirect(res, back + '&' + noticeQuery(user, 'The page does not have enough content to answer questions. Add content first.'));
    } else {
      draft.meta = await fixes.suggestMeta(site.project, page);
    }
  } catch (e) {
    return redirect(res, back + '&' + noticeQuery(user, 'No suggestion this time. ' + alerts.publicText(e, alerts.WRITING_TEXT)));
  }
  await store.saveDraft(site.id, key, draft);
  redirect(res, back + '&' + noticeQuery(user, 'Suggestion ready. Review it, change what you like, then apply.'));
}

async function handleFixMeta(req, res, user) {
  const b = await readBody(req);
  const ctx = await fixContext(user, b.id, b.path);
  if (ctx.error === 'site') return notFound(res);
  if (ctx.error) return redirect(res, '/app');
  const { site, audit, row, token } = ctx;
  const back = fixUrl(site, row.path);
  if (!user._limits.canApply) return redirect(res, back + '&' + noticeQuery(user, 'Applying to Webflow is part of the paid plans. Copy the text into Webflow page settings instead.'));
  const title = String(b.title || '').replace(/\s+/g, ' ').trim().slice(0, 90);
  const description = String(b.description || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (title.length < 5 || description.length < 20) return redirect(res, back + '&' + noticeQuery(user, 'Write a title of at least 5 characters and a description of at least 20.'));
  if (!token) return redirect(res, back + '&' + noticeQuery(user, 'The Webflow connection for this site is missing. Connect again.'));
  try { await primaryLocale(token, site); await wf.updatePageSeo(token, row.pageId, { title, description }); }
  catch (e) { return webflowFailed(res, user, site, e, back); }
  // reflect the change in the stored audit until the next run
  row.title = title; row.description = description;
  row.issues = (row.issues || []).filter((k) => !/^(title|desc)_/.test(k));
  if (title.length < 20 || title.length > 65) row.issues.push('title_length');
  if (description.length < 60 || description.length > 165) row.issues.push('desc_length');
  row.score = auditLib.checkPage({ title, description, h1: row.h1 || ['x'], schemaTypes: row.schemaTypes || [], schemaErrors: 0, faq: row.faq || [], og: { title: row.og && row.og.title, description: row.og && row.og.description, image: row.og && row.og.image }, words: row.words || 0, imagesNoAlt: row.imagesNoAlt || 0, lang: row.lang || 'x' }).score;
  await store.saveAudit(site.id, audit);
  redirect(res, back + '&' + noticeQuery(user, 'Saved to Webflow. Publish your site in Webflow to make it live.'));
}

function parseFaq(text) {
  const out = [];
  let cur = null;
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (/^q\s*[:.)-]/i.test(line)) { if (cur && cur.q && cur.a) out.push(cur); cur = { q: line.replace(/^q\s*[:.)-]\s*/i, ''), a: '' }; }
    else if (/^a\s*[:.)-]/i.test(line) && cur) cur.a = line.replace(/^a\s*[:.)-]\s*/i, '');
    else if (line && cur && cur.a) cur.a += ' ' + line;
  }
  if (cur && cur.q && cur.a) out.push(cur);
  return out.map((x) => ({ q: x.q.slice(0, 200), a: x.a.slice(0, 900) })).slice(0, 20);
}

async function handleFixFaq(req, res, user) {
  const b = await readBody(req);
  const ctx = await fixContext(user, b.id, b.path);
  if (ctx.error === 'site') return notFound(res);
  if (ctx.error) return redirect(res, '/app');
  const { site, row, token } = ctx;
  const back = fixUrl(site, row.path);
  const pairs = parseFaq(b.faq);
  const key = draftKey(row.path);
  const draft = (await store.getDraft(site.id, key)) || {};
  draft.faq = pairs;
  await store.saveDraft(site.id, key, draft);
  if (b.action !== 'cms') return redirect(res, back + '&' + noticeQuery(user, pairs.length ? `${pairs.length} questions saved. The schema below now includes them.` : 'No questions found. Use lines starting with Q: and A:.'));
  if (!user._limits.canApply) return redirect(res, back + '&' + noticeQuery(user, 'Adding CMS items is part of the paid plans.'));
  if (!pairs.length) return redirect(res, back + '&' + noticeQuery(user, 'Write at least one question and answer first.'));
  try {
    const loc = await primaryLocale(token, site);
    const cols = await wf.listCollections(token, site.id);
    const col = cols.find((c) => c.id === String(b.collection || ''));
    if (!col) return redirect(res, back + '&' + noticeQuery(user, 'Pick one of this site\'s CMS collections.'));
    const full = await wf.getCollection(token, col.id);
    const fields = (full && full.fields) || [];
    const answerField = fields.find((f) => /answer|antwort|cevap|reponse|respuesta/i.test(f.displayName || f.slug || '') && ['RichText', 'PlainText'].includes(f.type))
      || fields.find((f) => f.type === 'RichText') || fields.find((f) => f.type === 'PlainText' && !['name', 'slug'].includes(f.slug));
    if (!answerField) return redirect(res, back + '&' + noticeQuery(user, `${col.displayName} has no text field for the answer. Add a Rich text field, then try again.`));
    let made = 0;
    for (const pr of pairs) {
      const slug = pr.q.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) + '-' + random(3).toLowerCase().replace(/[^a-z0-9]/g, 'x');
      const value = answerField.type === 'RichText' ? '<p>' + html.esc(pr.a) + '</p>' : pr.a;
      await wf.createDraftItem(token, col.id, { name: pr.q, slug, [answerField.slug]: value });
      made++;
    }
    redirect(res, back + '&' + noticeQuery(user, `Added ${made} draft item${made === 1 ? '' : 's'} to ${col.displayName}. Review and publish them in Webflow.`));
  } catch (e) { return webflowFailed(res, user, site, e, back); }
}

async function handleFixSchema(req, res, user) {
  const b = await readBody(req);
  const ctx = await fixContext(user, b.id, b.path);
  if (ctx.error === 'site') return notFound(res);
  if (ctx.error) return redirect(res, '/app');
  const { site, audit, row, token } = ctx;
  const back = fixUrl(site, row.path);
  if (!user._limits.canApply) return redirect(res, back + '&' + noticeQuery(user, 'Applying to Webflow is part of the paid plans. Copy the code into the page settings in Webflow instead.'));
  const raw = String(b.schema || '');
  if (raw.length > 60000) return redirect(res, back + '&' + noticeQuery(user, 'The structured data is too long (Webflow takes up to 60 KB).'));
  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) { return redirect(res, back + '&' + noticeQuery(user, 'That is not valid JSON: ' + e.message)); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return redirect(res, back + '&' + noticeQuery(user, 'The structured data must be one JSON object.'));
  if (!token) return redirect(res, back + '&' + noticeQuery(user, 'The Webflow connection for this site is missing. Connect again.'));
  try { await wf.putSchema(token, row.pageId, parsed); }
  catch (e) { return webflowFailed(res, user, site, e, back); }
  const types = auditLib.readPage('<script type="application/ld+json">' + JSON.stringify(parsed) + '</script>').schemaTypes;
  row.schemaTypes = types;
  row.issues = (row.issues || []).filter((k) => !(k === 'schema_missing' || k === 'schema_invalid' || (k === 'faq_no_schema' && types.includes('FAQPage'))));
  if (row.path === '/' && types.some((t) => fixes.ORG_TYPES.includes(t))) { audit.site.orgSchema = true; audit.siteIssues = (audit.siteIssues || []).filter((x) => x.code !== 'org_schema_missing'); }
  await store.saveAudit(site.id, audit);
  redirect(res, back + '&' + noticeQuery(user, 'Structured data saved to Webflow. Publish your site in Webflow to make it live.'));
}

/* ---------- site management ---------- */
async function handleReportLink(req, res, user) {
  const b = await readBody(req);
  const site = await ownedSite(user, b.id);
  if (!site) return notFound(res);
  if (b.action === 'rotate' && site.settings.reportToken) {
    await store.deleteReport(site.settings.reportToken);
    site.settings.reportToken = '';
    await store.updateSite(site.id, (s) => { s.settings.reportToken = ''; });
  }
  await store.ensureReportToken(site);
  redirect(res, siteUrl(site, 'tab=setup'));
}
async function handleSiteRemove(req, res, user) {
  const b = await readBody(req);
  const site = await ownedSite(user, b.id);
  if (!site) return notFound(res);
  if (b.sure !== '1') return redirect(res, siteUrl(site, 'tab=setup'));
  await store.deleteSite(site);
  user.siteIds = user.siteIds.filter((id) => id !== site.id);
  await store.saveUser(user);
  await store.enforceLimit(user);
  redirect(res, '/app?' + noticeQuery(user, site.name + ' removed from AI SEO Deck.'));
}

/* ---------- account ---------- */
async function handleSettingsPage(req, res, user) {
  const q = queryOf(req);
  const sites = await store.getSites(user.siteIds || []);
  const notice = q.upgraded ? 'Thanks! Your plan updates as soon as the payment is confirmed, usually within a minute.' : (q.saved ? 'Saved.' : html.esc(noticeFrom(q, user)));
  const canBuy = await billing.canCheckout(user);
  send(res, 200, html.settingsPage(user, sites, user._limits, notice, {
    billing: canBuy, offers: canBuy ? await billing.offers() : [], providerName: 'Polar', usage: store.usageOf(user),
    live: billing.hasLiveSubscription(user), trialDays: billing.trialEligible(user) ? billing.trialDays() : 0
  }));
}
async function handleSettingsSave(req, res, user) {
  const b = await readBody(req);
  const addr = String(b.reportEmail || '').trim().toLowerCase();
  if (addr && (addr.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr))) return send(res, 400, html.errorPage('Check the email', 'That email address does not look right.', '/app/settings'));
  user.settings = user.settings || {};
  user.settings.reportEmail = addr;
  user.settings.digest = b.digest === '1' || b.digest === 'on';
  if (user._limits.whiteLabel) user.settings.brand = String(b.agency || '').trim().slice(0, 80);
  await store.saveUser(user);
  redirect(res, '/app/settings?saved=1');
}
async function handleCheckout(req, res, user) {
  const b = await readBody(req);
  if (!(await billing.canCheckout(user))) return send(res, 503, html.errorPage('Upgrades are not open yet', 'Write to info@silitlabs.com and we will raise your limits.', '/app/settings'));
  // A second checkout would start a second subscription: plan changes go through the billing portal
  if (billing.hasLiveSubscription(user)) return redirect(res, '/app/billing/portal');
  const opts = b.from === 'start' ? { next: 'setup', kw: kwLib.clean(b.kw || '') } : { next: 'settings' };
  try { redirect(res, await billing.checkoutUrl(user, String(b.plan || ''), String(b.interval || ''), ENV().appUrl, opts)); }
  catch (e) { console.error('[billing] checkout', e.message); send(res, 502, html.errorPage('Could not open checkout', 'The payment page could not be opened right now. Try again in a minute, or write to info@silitlabs.com.', '/app/settings')); }
}

// Polar's success page sends the customer here with the checkout id. The plan is switched on from the checkout
// itself, so it is on before the webhook arrives; while Polar is still finishing, the page waits a few seconds.
async function handleBillingReturn(req, res, user) {
  const q = queryOf(req);
  const kw = kwLib.clean(q.kw || '');
  const tries = Math.min(10, parseInt(q.t, 10) || 0);
  const paid = () => user.plan && user.plan !== 'free' && billing.hasLiveSubscription(user);
  if (!paid() && q.checkout_id) {
    try { await billing.syncCheckout(user, String(q.checkout_id), { saveUser: store.saveUser, enforce: (u) => store.enforceLimit(u) }); }
    catch (e) { console.error('[billing] return', e.message); }
  }
  if (!paid() && q.checkout_id && tries < 5) {
    const again = new URLSearchParams();
    for (const k of ['next', 'kw', 'checkout_id']) if (q[k]) again.set(k, String(q[k]).slice(0, 120));
    again.set('t', String(tries + 1));
    return send(res, 200, html.waitPage(user, 'Switching your plan on','Polar is confirming your checkout. This takes a few seconds.', '/app/billing/return?' + again.toString()));
  }
  user._limits = limitsFor(user);
  const b = user.billing || {};
  const name = (PLANS[user.plan] || {}).name || 'your plan';
  const text = !paid() ? 'Thanks! Your plan switches on as soon as Polar confirms the checkout, usually within a minute.'
    : b.status === 'on_trial' && b.trialEnd ? `Your ${name} trial is on until ${html.longDay(b.trialEnd)}. All ${html.allEnginesCount()} AI engines and ${user._limits.keywords} keywords are open.`
      : `You are on ${name}. All ${html.allEnginesCount()} AI engines and ${user._limits.keywords} keywords are open.`;
  if (q.next === 'setup') return redirect(res, withNotice(afterStart(await store.getSites(user.siteIds || []), kw), user, text));
  redirect(res, '/app/settings?' + noticeQuery(user, text));
}
async function handlePortal(req, res, user) {
  const url = await billing.portalUrl(user, ENV().appUrl);
  redirect(res, url || '/app/settings#plan');
}
async function handleDelete(req, res, user) {
  const b = await readBody(req);
  if (b.sure !== '1') return redirect(res, '/app/settings');
  const env = ENV();
  if (billing.hasLiveSubscription(user)) {
    try { await billing.cancelSubscription(user); }
    catch (e) { return send(res, 502, html.errorPage('Cancel your plan first', 'We could not cancel your subscription automatically. Use Manage billing on your Account page, then delete your account.', '/app/settings#plan')); }
  }
  for (const c of user.connections || []) await wf.revokeToken({ clientId: env.clientId, clientSecret: env.clientSecret, token: store.tokenOf(c) });
  await store.deleteUser(user);
  res.setHeader('Set-Cookie', [cookie(COOKIE, '', 0)]);
  redirect(res, '/?deleted=1');
}
async function handleDisconnect(req, res, user) {
  const env = ENV();
  const b = await readBody(req);
  const removed = await store.removeConnection(user, String(b.id || ''));
  if (!removed) return send(res, 404, html.errorPage('Connection not found', 'That Webflow connection is not on your account.', '/app/settings'));
  await wf.revokeToken({ clientId: env.clientId, clientSecret: env.clientSecret, token: store.tokenOf(removed) });
  await store.saveUser(user);
  redirect(res, '/app/settings?' + noticeQuery(user, `Disconnected ${removed.label || 'Webflow'}: access revoked and ${removed._sites.length} site(s) removed.`));
}

/* ---------- sign in by email link ---------- */
async function handleLoginPage(req, res) {
  if (await currentUser(req)) return redirect(res, '/app');
  send(res, 200, html.loginPage(queryOf(req)));
}
async function handleLoginPost(req, res) {
  const b = await readBody(req);
  const addr = String(b.email || '').trim().toLowerCase();
  if (addr.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) return redirect(res, '/login?bad=1');
  const ip = clientIp(req);
  if (localRateOk('login:' + ip, 30, 600000) && (await store.rateOk('login-ip:' + ip, 10, 600))) {
    const user = await store.findUserByEmail(addr);
    if (user && (await store.loginRateOk(addr)) && (await store.rateOk('login-all', 300, 3600))) {
      const t = await store.createLoginToken(user.id);
      const link = ENV().appUrl + '/l/' + t;
      try {
        await email.send({ to: user.email, subject: 'Your AI SEO Deck sign in link',
          html: `<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#10162B"><p>Click to sign in to AI SEO Deck. The link works once and expires in 15 minutes.</p><p><a href="${html.esc(link)}" style="display:inline-block;background:#10162B;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">Sign in to AI SEO Deck</a></p><p style="color:#5C6478;font-size:13px">If you did not ask for this, ignore this email.</p></div>`,
          text: 'Sign in to AI SEO Deck (works once, expires in 15 minutes): ' + link });
      } catch (e) { console.error('[aiseodeck] login email failed', e.message); }
    }
  }
  redirect(res, '/login?sent=1');
}
async function handleLoginLink(req, res, token, method) {
  const expired = () => send(res, 400, html.errorPage('Link expired', 'This sign in link was already used or is older than 15 minutes. Ask for a new one.', '/login'));
  if (!LOGIN_TOKEN_RE.test(token)) return expired();
  if (!localRateOk('l:' + clientIp(req), 30, 60000)) return tooMany(res, '/login');
  if (method === 'POST') {
    if (!sameOrigin(req)) return send(res, 403, html.errorPage('Blocked', 'Cross-site request blocked.', '/login'));
    const rec = await store.consumeLoginToken(token);
    const user = rec && (await store.getUser(rec.u));
    if (!user) return expired();
    res.setHeader('Set-Cookie', [sessionCookie(user.id)]);
    return redirect(res, '/app');
  }
  if (!(await store.peekLoginToken(token))) return expired();
  send(res, 200, html.loginConfirm(token));
}

/* ---------- public report ---------- */
async function handleReport(req, res, token) {
  const gone = () => send(res, 404, html.errorPage('Report not found', 'This report link is no longer valid.', '/'));
  if (!REPORT_TOKEN_RE.test(token)) return gone();
  if (!localRateOk('r:' + clientIp(req), 60, 60000)) return tooMany(res, '/');
  const siteId = await store.siteIdForReport(token);
  const site = siteId ? await store.getSite(siteId) : null;
  if (!site || site.settings.reportToken !== token) return gone();
  const owner = await store.getUser(site.userId);
  const hist = await store.history(site.id, 12);
  const used = [...new Set(Object.values(site.kw || {}).flatMap((x) => Object.keys((x && x.eng) || {})))];
  send(res, 200, html.reportPage(owner, site, { engines: used.length ? used : (site.latest && site.latest.engines) || [], history: hist, whiteLabel: owner ? limitsFor(owner).whiteLabel : false }),
    { 'X-Robots-Tag': 'noindex', 'Cache-Control': 'public, max-age=0, s-maxage=120' });
}

/* ---------- cron ---------- */
function cronAuthorized(req) {
  const env = ENV();
  if (!env.cronSecret) return false;
  // Vercel Cron sends "Authorization: Bearer <CRON_SECRET>"; cron-job.org and manual calls use x-cron-secret
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const given = req.headers['x-cron-secret'] || bearer || queryOf(req).key || '';
  return !!given && timingEqual(given, env.cronSecret);
}

/* ---------- router ---------- */
module.exports = async function handler(req, res) {
  const path = pathOf(req);
  const method = (req.method || 'GET').toUpperCase();
  try {
    if (path === '/health') return send(res, 200, 'ok', { 'Content-Type': 'text/plain' });
    if (path === '/auth') return await handleAuth(req, res);
    if (path === '/callback') return await handleCallback(req, res);
    if (path === '/login' && method === 'POST') return await handleLoginPost(req, res);
    if (path === '/login') return await handleLoginPage(req, res);
    if (path.startsWith('/l/')) return await handleLoginLink(req, res, path.slice(3), method);
    if (path === '/logout') { res.setHeader('Set-Cookie', [cookie(COOKIE, '', 0)]); return redirect(res, '/'); }
    if (path.startsWith('/r/')) return await handleReport(req, res, path.slice(3));
    // the AI Visibility Report: any website, no account (see _lib/vr)
    if (vr.isOurs(path)) return await vr.handle(req, res, path, method, { send, json, redirect, readBody, queryOf, clientIp, localRateOk, sameOrigin });
    if (path.startsWith('/ext/')) return await handleExt(req, res, path, method);
    if (path.startsWith('/cron/')) {
      if (!cronAuthorized(req)) return json(res, 401, { error: 'unauthorized' });
      if (path === '/cron/tick') return json(res, 200, await jobs.tick({ budgetMs: 45000 }));
      if (path === '/cron/vr') return json(res, 200, await vr.tick({ budgetMs: 45000 }));
      if (path === '/cron/vrstats') return json(res, 200, { days: await vr.stats(parseInt(queryOf(req).days, 10) || 30) });
      return json(res, 404, { error: 'unknown job' });
    }
    if (path === '/app' || path.startsWith('/app/')) {
      const user = await currentUser(req);
      if (!user) return (method === 'POST' && path === '/app/run/pump') || path === '/app/run/progress' ? json(res, 401, { error: 'signed out' }) : redirect(res, '/login');
      if (method === 'POST' && !sameOrigin(req)) return send(res, 403, html.errorPage('Blocked', 'Cross-site request blocked.'));
      const r = method + ' ' + path;
      if (r === 'GET /app') return await handleApp(req, res, user);
      if (r === 'GET /app/setup') return await handleSetupPage(req, res, user);
      if (r === 'POST /app/setup') return await handleSetupSave(req, res, user);
      if (r === 'POST /app/setup/suggest') return await handleSetupSuggest(req, res, user);
      if (r === 'GET /app/site') return await handleSitePage(req, res, user);
      if (r === 'POST /app/site/run') return await handleRun(req, res, user);
      if (r === 'POST /app/run/pump') return await handlePump(req, res, user);
      if (r === 'GET /app/run/progress') return await handleProgress(req, res, user);
      if (r === 'POST /app/site/settings') return await handleSiteSettings(req, res, user);
      if (r === 'POST /app/site/refresh') return await handleSiteRefresh(req, res, user);
      if (r === 'POST /app/keywords') return await handleKeywordsAdd(req, res, user);
      if (r === 'GET /app/keyword') return await handleKeywordPage(req, res, user);
      if (r === 'POST /app/keyword/check') return await handleKeywordCheck(req, res, user);
      if (r === 'POST /app/keyword/questions') return await handleKeywordQuestions(req, res, user);
      if (r === 'POST /app/keyword/remove') return await handleKeywordRemove(req, res, user);
      if (r === 'POST /app/keyword/page') return await handleKeywordTarget(req, res, user);
      if (r === 'POST /app/keyword/plan') return await handleKeywordPlan(req, res, user);
      if (r === 'POST /app/keyword/apply') return await handleKeywordApply(req, res, user);
      if (r === 'POST /app/keyword/related') return await handleKeywordRelated(req, res, user);
      if (r === 'POST /app/discover') return await handleDiscover(req, res, user);
      if (r === 'POST /app/site/track') return await handleTrack(req, res, user);
      if (r === 'POST /app/site/audit') return await handleAudit(req, res, user);
      if (r === 'POST /app/site/report') return await handleReportLink(req, res, user);
      if (r === 'POST /app/site/remove') return await handleSiteRemove(req, res, user);
      if (r === 'GET /app/llms') return await handleLlms(req, res, user);
      if (r === 'GET /app/fix') return await handleFixPage(req, res, user);
      if (r === 'POST /app/fix/suggest') return await handleFixSuggest(req, res, user);
      if (r === 'POST /app/fix/meta') return await handleFixMeta(req, res, user);
      if (r === 'POST /app/fix/faq') return await handleFixFaq(req, res, user);
      if (r === 'POST /app/fix/schema') return await handleFixSchema(req, res, user);
      if (r === 'GET /app/settings') return await handleSettingsPage(req, res, user);
      if (r === 'POST /app/settings') return await handleSettingsSave(req, res, user);
      if (r === 'GET /app/start') return await handleStart(req, res, user);
      if (r === 'POST /app/billing/checkout') return await handleCheckout(req, res, user);
      if (r === 'GET /app/billing/return') return await handleBillingReturn(req, res, user);
      if (r === 'GET /app/billing/portal') return await handlePortal(req, res, user);
      if (r === 'POST /app/delete') return await handleDelete(req, res, user);
      if (r === 'POST /app/connection/remove') return await handleDisconnect(req, res, user);
    }
    return send(res, 404, html.errorPage('Not found', 'There is nothing at this address.', '/'));
  } catch (e) {
    console.error('[aiseodeck]', e && e.stack);
    return send(res, 500, html.errorPage('Something went wrong', 'Something went wrong on our side. Please try again in a minute.', '/'));
  }
};
module.exports._test = { parseFaq, parseRivals, canRun, canCheckKeyword, targetFor };
