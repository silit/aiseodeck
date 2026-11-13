'use strict';
// Data access on top of kv. Keys:
//   user:{id}             user record (connections hold encrypted Webflow tokens)
//   users:all             set of user ids
//   email:{address}       user id for an email (sign in by email link)
//   login:{sha256}        one-time sign in link, 15 minutes
//   site:{id}             site record: project settings, prompts, schedule, latest results summary
//   sites:all             set of tracked site ids (the scheduler walks this)
//   run:{id}              one check run (prompts x engines) with a snapshot of the project
//   rq:{runId}            tasks still to do for a run ("promptId|engine|attempt")
//   res:{runId}           hash of results, field "promptId|engine"
//   runs:active           set of run ids with work left
//   hist:{siteId}         run summaries, newest first
//   audit:{siteId}        latest site audit
//   draft:{siteId}:{key}  fix suggestions waiting for review (14 days)
//   report:{token}        siteId for public report links
//   calls:{day}           engine calls made that day (cost guard)
const kv = require('./kv');
const { seal, open, random, sha256 } = require('./crypto');
const { limitsFor } = require('./plans');

const HISTORY_KEEP = 52;
const RESULTS_KEEP = 8; // runs whose full answers stay readable
const day = (t) => new Date(t || Date.now()).toISOString().slice(0, 10);

/* ---------- users ---------- */
async function getUser(id) { return kv.getJSON('user:' + id); }
async function saveUser(user) {
  user.updatedAt = Date.now();
  const copy = Object.assign({}, user);
  delete copy._limits;
  await kv.setJSON('user:' + user.id, copy);
  await kv.sadd('users:all', user.id);
  if (user.email) await kv.setJSON('email:' + String(user.email).toLowerCase(), { u: user.id });
  return user;
}
async function findUserByEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return null;
  const idx = await kv.getJSON('email:' + e);
  if (idx && idx.u) {
    const u = await getUser(idx.u);
    if (u && String(u.email || '').toLowerCase() === e) return u;
  }
  return null;
}
async function createLoginToken(userId) {
  const t = random(24);
  await kv.setJSON('login:' + sha256(t), { u: userId, at: Date.now() }, 900);
  return t;
}
async function peekLoginToken(t) { return t ? kv.getJSON('login:' + sha256(t)) : null; }
async function consumeLoginToken(t) { return t ? kv.getDelJSON('login:' + sha256(t)) : null; }
async function loginRateOk(email) { return kv.setNX('loginrl:' + String(email).toLowerCase(), { at: Date.now() }, 60); }
async function rateOk(key, max, windowSec) {
  const n = await kv.incr('rl:' + key);
  if (n === 1) await kv.expire('rl:' + key, windowSec);
  return n <= max;
}
async function allUserIds() { return kv.smembers('users:all'); }

function newUser(info) {
  return {
    id: info.id,
    email: info.email || '',
    name: [info.firstName, info.lastName].filter(Boolean).join(' '),
    plan: 'free',
    createdAt: Date.now(),
    settings: { digest: true, brand: '', reportEmail: info.email || '' },
    connections: [],
    siteIds: []
  };
}
function addConnection(user, token, label) {
  const conn = { id: random(8), tokenEnc: seal({ t: token }), label: label || '', authorizedAt: Date.now() };
  user.connections.push(conn);
  return conn;
}
function tokenOf(conn) {
  if (!conn || !conn.tokenEnc) return null;
  const o = open(conn.tokenEnc);
  return o ? o.t : null;
}
function tokenForSite(user, site) {
  const conn = (user.connections || []).find((c) => c.id === site.connectionId);
  return conn ? tokenOf(conn) : null;
}

/* ---------- sites ---------- */
function primaryUrl(meta) {
  const domains = (meta.customDomains || []).map((d) => d.url).filter(Boolean);
  const host = domains[0] || (meta.shortName ? meta.shortName + '.webflow.io' : '');
  const scheme = process.env.SITE_URL_SCHEME || 'https';
  return host ? scheme + '://' + host : '';
}
const bareHost = (u) => String(u || '').replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '').replace(/^www\./i, '').toLowerCase();

function newSite(meta, userId, connectionId) {
  const url = primaryUrl(meta);
  const domains = (meta.customDomains || []).map((d) => bareHost(d.url)).filter(Boolean);
  if (meta.shortName) domains.push(meta.shortName + '.webflow.io');
  return {
    id: meta.id,
    userId,
    connectionId,
    name: meta.displayName || meta.shortName || meta.id,
    shortName: meta.shortName || '',
    domains: (meta.customDomains || []).map((d) => d.url).filter(Boolean),
    url,
    createdAt: Date.now(),
    tracked: false,
    pausedByUser: false,
    project: { brand: meta.displayName || '', aliases: [], domains: [...new Set(domains)], competitors: [], country: '', language: '', ready: false },
    prompts: [],
    sched: { lastRunAt: null, nextRunAt: null, runId: '', lastManualAt: null, firstRunDone: false },
    latest: null,
    audit: null,
    settings: { reportToken: '', digest: true }
  };
}
function refreshMeta(site, meta) {
  site.name = meta.displayName || site.name;
  site.shortName = meta.shortName || site.shortName;
  site.domains = (meta.customDomains || []).map((d) => d.url).filter(Boolean);
  site.url = primaryUrl(meta) || site.url;
  return site;
}
async function getSite(id) { return kv.getJSON('site:' + id); }
async function getSites(ids) { return ids && ids.length ? (await kv.mgetJSON(ids.map((id) => 'site:' + id))).filter(Boolean) : []; }
async function saveSite(site) {
  site.updatedAt = Date.now();
  await kv.setJSON('site:' + site.id, site);
  if (site.tracked) await kv.sadd('sites:all', site.id); else await kv.srem('sites:all', site.id);
  return site;
}
// Read the latest record, change it, write it back only if it still exists (a removed site stays removed).
async function updateSite(id, fn) {
  const fresh = await getSite(id);
  if (!fresh) return null;
  fn(fresh);
  fresh.updatedAt = Date.now();
  if (!(await kv.setJSONIfExists('site:' + id, fresh))) return null;
  if (fresh.tracked) await kv.sadd('sites:all', id); else await kv.srem('sites:all', id);
  return fresh;
}
async function allSiteIds() { return kv.smembers('sites:all'); }
async function deleteSite(site) {
  const hist = await kv.lrangeJSON('hist:' + site.id, HISTORY_KEEP);
  const runIds = hist.map((h) => h.runId).filter(Boolean);
  if (site.sched && site.sched.runId) runIds.push(site.sched.runId);
  for (const r of runIds) { await kv.del('run:' + r, 'rq:' + r, 'res:' + r); await kv.srem('runs:active', r); }
  if (site.settings && site.settings.reportToken) await kv.del('report:' + site.settings.reportToken);
  await kv.del('site:' + site.id, 'hist:' + site.id, 'audit:' + site.id);
  await kv.srem('sites:all', site.id);
}

// Keeps at most `limit` sites tracked: tracked sites keep their place (oldest first), then sites that
// were waiting for a free slot fill it; sites the user paused stay paused.
async function enforceLimit(user) {
  const limit = limitsFor(user).sites;
  const sites = await getSites(user.siteIds || []);
  const byAge = (a, b) => (a.createdAt || 0) - (b.createdAt || 0);
  const on = sites.filter((s) => s.tracked).sort(byAge);
  const waiting = sites.filter((s) => !s.tracked && !s.pausedByUser && s.project && s.project.ready).sort(byAge);
  let changed = 0;
  for (let i = limit; i < on.length; i++) { await updateSite(on[i].id, (s) => { s.tracked = false; }); changed++; }
  for (let i = 0, free = limit - Math.min(on.length, limit); i < waiting.length && i < free; i++) { await updateSite(waiting[i].id, (s) => { s.tracked = true; }); changed++; }
  return changed;
}

// Removes a Webflow connection and every site that came with it.
async function removeConnection(user, connId) {
  const conn = (user.connections || []).find((c) => c.id === connId);
  if (!conn) return null;
  user.connections = user.connections.filter((c) => c.id !== connId);
  const sites = await getSites(user.siteIds || []);
  const gone = sites.filter((s) => s.connectionId === connId);
  for (const site of gone) await deleteSite(site);
  user.siteIds = (user.siteIds || []).filter((id) => !gone.some((s) => s.id === id));
  conn._sites = gone.map((s) => s.name);
  return conn;
}
// Webflow answered 401: delete only after a second 401 at least REVOKE_CONFIRM_MS later.
async function confirmRevoked(user, connId, now) {
  now = now || Date.now();
  const conn = (user.connections || []).find((c) => c.id === connId);
  if (!conn) return null;
  const raw = process.env.REVOKE_CONFIRM_MS;
  const wait = raw != null && raw !== '' && !isNaN(parseInt(raw, 10)) ? parseInt(raw, 10) : 600000;
  if (!conn.revokedSince) {
    conn.revokedSince = now;
    if (wait > 0) { await saveUser(user); return null; }
  }
  if (now - conn.revokedSince < wait) return null;
  return removeConnection(user, connId);
}
function clearRevoked(user, connId) {
  const conn = (user.connections || []).find((c) => c.id === connId);
  if (conn && conn.revokedSince) { delete conn.revokedSince; return true; }
  return false;
}

// Prompts used by all of a user's sites (the plan's prompt limit is a shared pool)
async function promptCount(user, exceptSiteId) {
  const sites = await getSites(user.siteIds || []);
  return sites.filter((s) => s.id !== exceptSiteId).reduce((a, s) => a + (s.prompts || []).length, 0);
}

/* ---------- runs ---------- */
async function createRun(site, user, engines, reason) {
  const id = random(10);
  const prompts = (site.prompts || []).map((p) => ({ id: p.id, text: p.text }));
  const p = site.project;
  const run = {
    id, siteId: site.id, userId: user.id, at: Date.now(), reason: reason || 'scheduled', status: 'running',
    engines, prompts, total: prompts.length * engines.length, lastProgressAt: Date.now(),
    project: { brand: p.brand, aliases: p.aliases || [], domains: p.domains || [], competitors: p.competitors || [], country: p.country || '', language: p.language || '' }
  };
  await kv.setJSON('run:' + id, run);
  const tasks = [];
  for (const pr of prompts) for (const e of engines) tasks.push(pr.id + '|' + e + '|0');
  for (let i = 0; i < tasks.length; i += 200) await kv.rpush('rq:' + id, ...tasks.slice(i, i + 200));
  await kv.sadd('runs:active', id);
  return run;
}
async function getRun(id) { return id ? kv.getJSON('run:' + id) : null; }
async function saveRun(run) { return kv.setJSON('run:' + run.id, run); }
async function activeRunIds() { return kv.smembers('runs:active'); }
async function takeTasks(runId, n) { return kv.lpopN('rq:' + runId, n); }
async function requeue(runId, task) { return kv.rpush('rq:' + runId, task); }
async function tasksLeft(runId) { return kv.llen('rq:' + runId); }
async function saveResult(runId, field, result) { return kv.hsetJSON('res:' + runId, field, result); }
async function results(runId) { return runId ? kv.hgetallJSON('res:' + runId) : {}; }
async function resultCount(runId) { return kv.hlen('res:' + runId); }
async function endRun(runId) { await kv.srem('runs:active', runId); await kv.del('rq:' + runId); }
async function pushHistory(siteId, entry) {
  await kv.lpushJSON('hist:' + siteId, entry);
  const all = await kv.lrangeJSON('hist:' + siteId, HISTORY_KEEP + 5);
  // Full answers are kept for the latest runs only; older runs keep their summary
  for (const old of all.slice(RESULTS_KEEP)) if (old.runId) { await kv.del('res:' + old.runId); await kv.del('run:' + old.runId); }
  if (all.length > HISTORY_KEEP) await kv.command('LTRIM', 'hist:' + siteId, '0', String(HISTORY_KEEP - 1));
}
async function history(siteId, n) { return kv.lrangeJSON('hist:' + siteId, n || HISTORY_KEEP); }

// Cost guard: at most MAX_DAILY_CALLS engine calls per day across all users.
async function takeCalls(n) {
  const max = parseInt(process.env.MAX_DAILY_CALLS || '', 10) || 1500;
  const key = 'calls:' + day();
  const used = await kv.incrBy(key, n);
  if (used === n) await kv.expire(key, 3 * 86400);
  if (used > max) { await kv.incrBy(key, -n); return false; }
  return true;
}
async function callsToday() { return parseInt((await kv.command('GET', 'calls:' + day())) || '0', 10) || 0; }

/* ---------- audits, drafts, reports ---------- */
async function getAudit(siteId) { return kv.getJSON('audit:' + siteId); }
async function saveAudit(siteId, audit) { return kv.setJSON('audit:' + siteId, audit); }
async function getDraft(siteId, key) { return kv.getJSON(`draft:${siteId}:${key}`); }
async function saveDraft(siteId, key, value) { return kv.setJSON(`draft:${siteId}:${key}`, value, 14 * 86400); }

async function ensureReportToken(site) {
  if (site.settings.reportToken) return site.settings.reportToken;
  const t = random(12);
  await kv.setJSON('report:' + t, { siteId: site.id });
  await updateSite(site.id, (s) => { s.settings.reportToken = t; });
  site.settings.reportToken = t;
  return t;
}
async function siteIdForReport(token) { const r = await kv.getJSON('report:' + token); return r ? r.siteId : null; }
async function deleteReport(token) { return token ? kv.del('report:' + token) : 0; }

async function deleteUser(user) {
  for (const s of await getSites(user.siteIds || [])) if (s.userId === user.id) await deleteSite(s);
  await kv.del('user:' + user.id);
  await kv.srem('users:all', user.id);
  if (user.email) await kv.del('email:' + String(user.email).toLowerCase());
}

async function digestDone(runId) { return !(await kv.setNX('digest:' + runId, { at: Date.now() }, 30 * 86400)); }
async function lock(name, ttl) { return kv.setNX('lock:' + name, { at: Date.now() }, ttl || 55); }
async function unlock(name) { return kv.del('lock:' + name); }

module.exports = {
  day, HISTORY_KEEP, RESULTS_KEEP,
  getUser, saveUser, findUserByEmail, createLoginToken, peekLoginToken, consumeLoginToken, loginRateOk, rateOk, allUserIds, newUser, addConnection, tokenOf, tokenForSite,
  primaryUrl, bareHost, newSite, refreshMeta, getSite, getSites, saveSite, updateSite, allSiteIds, deleteSite, enforceLimit, removeConnection, confirmRevoked, clearRevoked, promptCount,
  createRun, getRun, saveRun, activeRunIds, takeTasks, requeue, tasksLeft, saveResult, results, resultCount, endRun, pushHistory, history, takeCalls, callsToday,
  getAudit, saveAudit, getDraft, saveDraft, ensureReportToken, siteIdForReport, deleteReport, deleteUser, digestDone, lock, unlock
};
