/*
 * AI SEO Deck: is your brand named and cited by ChatGPT, Perplexity and Gemini, and what on your
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
const { limitsFor } = require('./_lib/plans');
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

async function handleAuth(req, res) {
  const env = ENV();
  if (!env.clientId || !env.appUrl) return send(res, 500, html.errorPage('Not configured', 'WEBFLOW_CLIENT_ID and APP_URL must be set.', '/'));
  const state = random(16);
  redirect(res, wf.authorizeUrl({ clientId: env.clientId, redirectUri: env.appUrl + '/callback', state }), { 'Set-Cookie': cookie('ad_state', state, 600) });
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
  await store.saveUser(user);
  res.setHeader('Set-Cookie', [sessionCookie(user.id), cookie('ad_state', '', 0)]);
  // One new site and nothing set up yet: go straight to its setup
  const sites = await store.getSites(user.siteIds);
  const notReady = sites.filter((s) => !s.project.ready);
  if (!notices.length && sites.length === 1 && notReady.length === 1) return redirect(res, '/app/setup?id=' + encodeURIComponent(notReady[0].id));
  redirect(res, '/app' + (notices.length ? '?' + noticeQuery(user, notices.join(' ')) : added ? '?added=' + added : ''));
}

/* ---------- helpers for site pages ---------- */
async function ownedSite(user, id) {
  if (!id || !(user.siteIds || []).includes(String(id))) return null;
  const site = await store.getSite(String(id));
  return site && site.userId === user.id ? site : null;
}
const notFound = (res) => send(res, 404, html.errorPage('Site not found', 'That site is not connected to your account.'));

function splitList(v, max, each) {
  return String(v || '').split(/[,\n]/).map((x) => x.trim()).filter(Boolean).slice(0, max).map((x) => x.slice(0, each || 80));
}
function parseRivals(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const parts = line.split(',').map((x) => x.trim()).filter(Boolean);
    if (!parts.length) continue;
    const name = parts[0].slice(0, 80);
    const domain = parts[1] ? require('./_lib/analyze').cleanDomain(parts[1]).slice(0, 120) : '';
    if (name.length >= 2 && !out.some((r) => r.name.toLowerCase() === name.toLowerCase())) out.push({ name, domain });
    if (out.length >= 5) break;
  }
  return out;
}
function cleanPrompts(lines) {
  const out = [];
  for (const l of lines) {
    const t = String(l || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (t.length >= 8 && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out;
}
function applyProjectFields(site, b) {
  const p = site.project;
  const brand = String(b.brand || '').trim().slice(0, 80);
  if (brand.length >= 2) p.brand = brand;
  p.aliases = splitList(b.aliases, 6, 80).filter((a) => a.length >= 2);
  const doms = splitList(b.domains, 6, 120).map((d) => require('./_lib/analyze').cleanDomain(d)).filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d));
  if (doms.length) p.domains = [...new Set(doms)];
  p.competitors = parseRivals(b.rivals);
  p.country = /^[A-Z]{2}$/.test(String(b.country || '')) ? String(b.country) : '';
  p.language = /^[a-z]{2}$/.test(String(b.language || '')) ? String(b.language) : (p.language || 'en');
}

const monthOf = (t) => new Date(t || Date.now()).toISOString().slice(0, 7);
function manualUsed(site, now) { const m = site.sched && site.sched.manual; return m && m.month === monthOf(now) ? m.n || 0 : 0; }
function canRun(site, limits, now) {
  if (site.sched && site.sched.runId) return { ok: false, why: '' };
  if (!(site.prompts || []).length) return { ok: false, why: 'Add questions first.' };
  if (!engines.enabled().length) return { ok: false, why: 'No AI engine is connected yet.' };
  if (!site.tracked) return { ok: false, why: site.pausedByUser ? 'Tracking is paused. Resume it in Setup.' : 'Your plan has no free site slot for this site.' };
  if (!site.sched.firstRunDone) return { ok: true };
  if (!limits.manualPerMonth) return { ok: false, why: 'Checks on demand are part of the paid plans. The next automatic check runs on schedule.' };
  const used = manualUsed(site, now);
  if (used >= limits.manualPerMonth) return { ok: false, why: `You used this month's ${limits.manualPerMonth} extra checks. The weekly check still runs on schedule.` };
  return { ok: true, left: limits.manualPerMonth - used };
}

// The run whose answers we show: the one in progress when there is no finished run yet, else the latest finished one.
async function shownRun(site) {
  const activeId = site.sched && site.sched.runId;
  if (!site.latest && activeId) {
    const run = await store.getRun(activeId);
    if (run) return { run, results: await store.results(activeId) };
  }
  if (site.latest && site.latest.runId) {
    const run = await store.getRun(site.latest.runId);
    const results = await store.results(site.latest.runId);
    if (run) return { run, results };
    return { run: { prompts: site.prompts || [], engines: site.latest.engines || [] }, results };
  }
  return { run: { prompts: site.prompts || [], engines: [] }, results: {} };
}

/* ---------- app pages ---------- */
async function handleApp(req, res, user) {
  const q = queryOf(req);
  await store.enforceLimit(user);
  const sites = await store.getSites(user.siteIds || []);
  let notice = html.esc(noticeFrom(q, user));
  const added = parseInt(q.added, 10);
  if (added > 0) notice = `${added} site${added === 1 ? '' : 's'} connected. Set one up to start checking.`;
  if (user.notice) { notice = html.esc(user.notice); delete user.notice; await store.saveUser(user); }
  send(res, 200, html.dashboard(user, sites, user._limits, notice, { enginesOn: engines.enabled() }));
}

async function handleSetupPage(req, res, user) {
  const q = queryOf(req);
  const site = await ownedSite(user, q.id);
  if (!site) return notFound(res);
  if (!site.project.language && site.url) {
    const r = await fetcher.getText(site.url + '/', { allowedHosts: siteHosts(site), timeoutMs: 3500, maxBytes: 400000 });
    if (r.ok) { const lang = (auditLib.readPage(r.text).lang || '').slice(0, 2).toLowerCase(); if (/^[a-z]{2}$/.test(lang)) site.project.language = lang; }
  }
  send(res, 200, html.setupPage(user, site, user._limits, { usedElsewhere: await store.promptCount(user, site.id), notice: html.esc(noticeFrom(q, user)) }));
}

async function handleSetupSuggest(req, res, user) {
  const b = await readBody(req);
  const site = await ownedSite(user, b.id);
  if (!site) return json(res, 404, { prompts: [] });
  const cached = await store.getDraft(site.id, 'prompts');
  if (cached && cached.list && cached.list.length) return json(res, 200, { prompts: cached.list });
  if (!llm.available() || !(await store.rateOk('suggest:' + user.id, 20, 3600))) return json(res, 200, { prompts: [] });
  const r = site.url ? await fetcher.getText(site.url + '/', { allowedHosts: siteHosts(site), timeoutMs: 8000 }) : { ok: false };
  const home = r.ok ? auditLib.readPage(r.text) : { title: site.name, description: '', text: '' };
  try {
    const listOut = await fixes.suggestPrompts(site.project, home, 12);
    await store.saveDraft(site.id, 'prompts', { list: listOut, at: Date.now() });
    json(res, 200, { prompts: listOut });
  } catch (e) {
    console.error('[aiseodeck] suggest prompts', e.message);
    json(res, 200, { prompts: [] });
  }
}

async function handleSetupSave(req, res, user) {
  const b = await readBody(req);
  const site = await ownedSite(user, b.id);
  if (!site) return notFound(res);
  const limits = user._limits;
  const room = Math.max(0, limits.prompts - (await store.promptCount(user, site.id)));
  const picked = cleanPrompts(list(b.pick).concat(String(b.own || '').split('\n')));
  const kept = picked.slice(0, room);
  let updated = await store.updateSite(site.id, (s) => {
    applyProjectFields(s, b);
    const old = s.prompts || [];
    s.prompts = kept.map((t) => old.find((o) => o.text === t) || { id: random(6), text: t, at: Date.now() });
    s.project.ready = true;
    s.pausedByUser = false;
  });
  if (!updated) return notFound(res);
  await store.enforceLimit(user);
  updated = await store.getSite(site.id);
  const notes = [];
  if (picked.length > kept.length) notes.push(`Your plan allows ${limits.prompts} questions across your sites, so ${picked.length - kept.length} were left out.`);
  if (!updated.tracked) notes.push(`Your plan tracks ${limits.sites} site${limits.sites === 1 ? '' : 's'}. Pause another site or upgrade to check this one.`);
  else if (updated.prompts.length && !updated.sched.runId && !updated.sched.firstRunDone) {
    const r = await jobs.startRun(updated, user, 'first');
    if (r.error) notes.push(r.error);
  }
  redirect(res, siteUrl(updated, notes.length ? noticeQuery(user, notes.join(' ')) : ''));
}

async function handleSitePage(req, res, user) {
  const q = queryOf(req);
  const site = await ownedSite(user, q.id);
  if (!site) return notFound(res);
  if (!site.project.ready) return redirect(res, '/app/setup?id=' + encodeURIComponent(site.id));
  const tab = ['answers', 'transcripts', 'rivals', 'sources', 'audit', 'setup'].includes(q.tab) ? q.tab : 'answers';
  const shown = await shownRun(site);
  let progress = null;
  if (site.sched.runId) {
    const active = await store.getRun(site.sched.runId);
    progress = { total: active ? active.total : 0, done: await store.resultCount(site.sched.runId) };
  }
  const hist = await store.history(site.id, 12);
  const shownEngines = shown.run.engines || [];
  const locked = engines.lockedFor(user._limits).filter((e) => !shownEngines.includes(e));
  const audit = tab === 'audit' ? await store.getAudit(site.id) : null;
  let notice = html.esc(noticeFrom(q, user));
  if (q.saved) notice = 'Saved.';
  send(res, 200, html.sitePage(user, site, {
    tab, limits: user._limits, prompts: shown.run.prompts || [], engines: shownEngines, results: shown.results, progress, locked, history: hist,
    prev: hist[1] || null, audit, notice, canRun: canRun(site, user._limits, Date.now())
  }));
}

async function handleRun(req, res, user) {
  const b = await readBody(req);
  const site = await ownedSite(user, b.id);
  if (!site) return notFound(res);
  const can = canRun(site, user._limits, Date.now());
  if (!can.ok) return redirect(res, siteUrl(site, can.why ? noticeQuery(user, can.why) : ''));
  const manual = !!site.sched.firstRunDone;
  const r = await jobs.startRun(site, user, manual ? 'manual' : 'first');
  if (!r.error && manual) {
    const now = Date.now();
    await store.updateSite(site.id, (s) => { const n = manualUsed(s, now); s.sched.manual = { month: monthOf(now), n: n + 1 }; });
  }
  redirect(res, siteUrl(site, r.error ? noticeQuery(user, r.error) : ''));
}

// Called by the open site page while a run is going: does a slice of the work, reports progress.
async function handlePump(req, res, user) {
  const b = await readBody(req);
  const site = await ownedSite(user, b.id);
  if (!site) return json(res, 404, { error: 'not found' });
  const runId = site.sched && site.sched.runId;
  if (!runId) return json(res, 200, { idle: true });
  if (!localRateOk('pump:' + user.id, 40, 60000) || !(await store.rateOk('pump:' + user.id, 120, 600))) return json(res, 200, { busy: true });
  const r = await jobs.workRun(runId, Date.now() + 25000);
  const finished = await jobs.maybeFinish(runId, Date.now());
  const run = await store.getRun(runId);
  json(res, 200, { finished, busy: !!r.busy, budget: !!r.budget, total: run ? run.total : 0, done: run ? await store.resultCount(runId) : 0 });
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
  redirect(res, siteUrl(site, 'tab=setup&saved=1'));
}

async function handlePrompts(req, res, user) {
  const b = await readBody(req);
  const site = await ownedSite(user, b.id);
  if (!site) return notFound(res);
  let note = '';
  if (b.action === 'remove') {
    await store.updateSite(site.id, (s) => { s.prompts = (s.prompts || []).filter((p) => p.id !== String(b.pid)); });
  } else {
    const room = Math.max(0, user._limits.prompts - (await store.promptCount(user)));
    const existing = (site.prompts || []).map((p) => p.text.toLowerCase());
    const fresh = cleanPrompts(String(b.text || '').split('\n')).filter((t) => !existing.includes(t.toLowerCase()));
    const add = fresh.slice(0, room);
    if (fresh.length > add.length) note = `Your plan allows ${user._limits.prompts} questions across your sites. ${fresh.length - add.length} were not added.`;
    await store.updateSite(site.id, (s) => { s.prompts = (s.prompts || []).concat(add.map((t) => ({ id: random(6), text: t, at: Date.now() }))); });
  }
  redirect(res, siteUrl(site, 'tab=setup&' + (note ? noticeQuery(user, note) : 'saved=1')));
}

async function handleTrack(req, res, user) {
  const b = await readBody(req);
  const site = await ownedSite(user, b.id);
  if (!site) return notFound(res);
  const on = b.on === '1';
  if (on && !site.tracked) {
    const count = (await store.getSites(user.siteIds || [])).filter((s) => s.tracked).length;
    if (count >= user._limits.sites) return redirect(res, siteUrl(site, 'tab=setup&' + noticeQuery(user, `Your plan tracks ${user._limits.sites} site${user._limits.sites === 1 ? '' : 's'}. Pause another site or upgrade.`)));
  }
  await store.updateSite(site.id, (s) => { s.tracked = on; s.pausedByUser = !on; });
  redirect(res, siteUrl(site, 'tab=setup&saved=1'));
}

async function handleAudit(req, res, user) {
  const b = await readBody(req);
  const site = await ownedSite(user, b.id);
  if (!site) return notFound(res);
  if (!(await store.rateOk('audit:' + site.id, 3, 600))) return redirect(res, siteUrl(site, 'tab=audit&' + noticeQuery(user, 'The audit ran a moment ago. Try again in a few minutes.')));
  try { await jobs.runAudit(site, user, 40000); }
  catch (e) { return redirect(res, siteUrl(site, 'tab=audit&' + noticeQuery(user, 'The audit could not finish: ' + e.message))); }
  redirect(res, siteUrl(site, 'tab=audit'));
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

async function webflowFailed(res, user, site, e, back) {
  if (wf.isRevoked(e)) {
    const removed = await store.confirmRevoked(user, site.connectionId, Date.now());
    if (removed) { user.notice = 'Webflow access was removed for ' + (removed.label || 'one connection') + ', so its sites were deleted from AI SEO Deck. Connect again to bring them back.'; await store.saveUser(user); return redirect(res, '/app'); }
    return redirect(res, back + '&' + noticeQuery(user, 'Webflow refused the change. Check that AI SEO Deck still has access to this site, then try again.'));
  }
  return redirect(res, back + '&' + noticeQuery(user, 'Webflow did not accept the change: ' + e.message));
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
  send(res, 200, html.fixPage(user, site, row, { draft, limits: user._limits, notice: html.esc(noticeFrom(q, user)), existingTypes, collections, proposedSchema: proposedSchema(site, row, audit, faqPairs, existing) }));
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
      const qs = (site.prompts || []).map((p) => p.text);
      draft.faq = await fixes.suggestFaq(site.project, page, qs);
      if (!draft.faq.length) return redirect(res, back + '&' + noticeQuery(user, 'The page does not have enough content to answer questions. Add content first.'));
    } else {
      draft.meta = await fixes.suggestMeta(site.project, page);
    }
  } catch (e) {
    return redirect(res, back + '&' + noticeQuery(user, 'No suggestion this time: ' + e.message));
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
  try { await wf.updatePageSeo(token, row.pageId, { title, description }); }
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
  send(res, 200, html.settingsPage(user, sites, user._limits, notice, { billing: await billing.canCheckout(user), providerName: 'Polar' }));
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
  try { redirect(res, await billing.checkoutUrl(user, String(b.plan || ''), String(b.interval || ''), ENV().appUrl)); }
  catch (e) { console.error('[billing]', e.message); send(res, 502, html.errorPage('Could not open checkout', e.message, '/app/settings')); }
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
    catch (e) { return send(res, 502, html.errorPage('Cancel your plan first', 'We could not cancel your subscription automatically. Use Manage billing in Settings, then delete your account.', '/app/settings#plan')); }
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
  const shown = await shownRun(site);
  const hist = await store.history(site.id, 12);
  send(res, 200, html.reportPage(owner, site, { prompts: shown.run.prompts || [], engines: shown.run.engines || [], results: shown.results, history: hist, prev: hist[1] || null, whiteLabel: owner ? limitsFor(owner).whiteLabel : false }),
    { 'X-Robots-Tag': 'noindex', 'Cache-Control': 'public, max-age=0, s-maxage=120' });
}

/* ---------- cron ---------- */
function cronAuthorized(req) {
  const env = ENV();
  if (!env.cronSecret) return false;
  const given = req.headers['x-cron-secret'] || queryOf(req).key || '';
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
    if (path.startsWith('/cron/')) {
      if (!cronAuthorized(req)) return json(res, 401, { error: 'unauthorized' });
      if (path === '/cron/tick') return json(res, 200, await jobs.tick({ budgetMs: 45000 }));
      return json(res, 404, { error: 'unknown job' });
    }
    if (path === '/app' || path.startsWith('/app/')) {
      const user = await currentUser(req);
      if (!user) return method === 'POST' && path === '/app/run/pump' ? json(res, 401, { error: 'signed out' }) : redirect(res, '/login');
      if (method === 'POST' && !sameOrigin(req)) return send(res, 403, html.errorPage('Blocked', 'Cross-site request blocked.'));
      const r = method + ' ' + path;
      if (r === 'GET /app') return await handleApp(req, res, user);
      if (r === 'GET /app/setup') return await handleSetupPage(req, res, user);
      if (r === 'POST /app/setup') return await handleSetupSave(req, res, user);
      if (r === 'POST /app/setup/suggest') return await handleSetupSuggest(req, res, user);
      if (r === 'GET /app/site') return await handleSitePage(req, res, user);
      if (r === 'POST /app/site/run') return await handleRun(req, res, user);
      if (r === 'POST /app/run/pump') return await handlePump(req, res, user);
      if (r === 'POST /app/site/settings') return await handleSiteSettings(req, res, user);
      if (r === 'POST /app/site/prompts') return await handlePrompts(req, res, user);
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
      if (r === 'POST /app/billing/checkout') return await handleCheckout(req, res, user);
      if (r === 'GET /app/billing/portal') return await handlePortal(req, res, user);
      if (r === 'POST /app/delete') return await handleDelete(req, res, user);
      if (r === 'POST /app/connection/remove') return await handleDisconnect(req, res, user);
    }
    return send(res, 404, html.errorPage('Not found', 'There is nothing at this address.', '/'));
  } catch (e) {
    console.error('[aiseodeck]', e && e.stack);
    return send(res, 500, html.errorPage('Something went wrong', (e && e.message) || 'Unexpected error.', '/'));
  }
};
module.exports._test = { parseFaq, parseRivals, cleanPrompts, canRun, manualUsed };
