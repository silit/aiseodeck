'use strict';
// Background work, driven by one cron address (every few minutes) and by the dashboard while a run is open:
// start runs that are due, ask the engines, finish runs (summary, history, email), refresh old audits.
const store = require('./store');
const engines = require('./engines');
const alerts = require('./alerts');
const analyze = require('./analyze');
const auditLib = require('./audit');
const wf = require('./webflow');
const email = require('./email');
const { limitsFor, DAY } = require('./plans');

const insights = require('./insights');
const STALE_MS = 3 * 60000; // a run with no tasks left and no progress for this long is finished as it is
const MAX_ATTEMPTS = 3;
// An answer cut short by our own time window is tried again with "|w" on its task id, and then only starts
// when the window can give it the full 40 seconds (slow engines such as Google AI Mode or Grok need it).
const FULL_WINDOW_MS = 43000; // 40 seconds for the answer, 3 to spare
const windowRetry = (uid, engine, attempt) => uid + '|' + engine + '|' + attempt + '|w';
const canStartTask = (task, msLeft) => String(task).split('|')[3] !== 'w' || msLeft >= FULL_WINDOW_MS;

const appUrl = () => (process.env.APP_URL || '').replace(/\/+$/, '');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x) => Math.round((x || 0) * 100) + '%';

/* ---------- starting runs ---------- */

// How many of this site's keywords the plan covers now: the plan's pool minus what the user's older tracked sites use.
async function allowedKeywords(site, user, limits) {
  const sites = (await store.getSites(user.siteIds || [])).filter((s) => s.tracked).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  let left = limits.keywords;
  for (const s of sites) {
    const n = (s.keywords || []).length;
    if (s.id === site.id) return Math.max(0, Math.min(n, left));
    left -= n;
  }
  return Math.max(0, Math.min((site.keywords || []).length, left));
}

// opts.keywordIds: check only these keywords (a keyword check on demand, or keywords just added). While another
// check of the site is running they wait and start right after it.
async function startRun(site, user, reason, opts) {
  opts = opts || {};
  const limits = limitsFor(user);
  const list = engines.forLimits(limits);
  if (!list.length) return { error: 'No AI engine is set up yet.' };
  const allowed = (site.keywords || []).slice(0, await allowedKeywords(site, user, limits));
  const only = opts.keywordIds ? allowed.filter((k) => opts.keywordIds.includes(k.id)) : allowed;
  if (!only.length) return { error: opts.keywordIds ? 'This keyword is over your plan\'s keyword limit, so it is not checked.' : 'No keywords to check. Add keywords first, or stay within your plan\'s keyword limit.' };
  if (site.sched && site.sched.runId) {
    if (!opts.keywordIds) return { error: 'A check is already running.' };
    await store.updateSite(site.id, (s) => { s.sched.pendingKw = [...new Set((s.sched.pendingKw || []).concat(only.map((k) => k.id)))]; });
    return { queued: true };
  }
  const partial = !!opts.keywordIds;
  const run = await store.createRun(site, user, list, reason, only, partial);
  await store.updateSite(site.id, (s) => {
    s.sched.runId = run.id;
    s.sched.pendingKw = (s.sched.pendingKw || []).filter((id) => !only.some((k) => k.id === id));
  });
  return { run };
}

async function scheduleDue(now, max) {
  const ids = await store.allSiteIds();
  const sites = await store.getSites(ids);
  let started = 0;
  for (const site of sites) {
    if (started >= (max || 20)) break;
    if (!site.tracked || !site.project || !site.project.ready || !(site.keywords || []).length) continue;
    if (site.sched.runId) continue;
    if (site.sched.nextRunAt && site.sched.nextRunAt > now) continue;
    const user = await store.getUser(site.userId);
    if (!user) continue;
    // Our checks do not touch Webflow, so an uninstalled app would never be noticed: ask Webflow first.
    const token = store.tokenForSite(user, site);
    const st = token ? await wf.tokenStatus(token) : 'revoked';
    if (st === 'revoked') {
      const removed = await store.confirmRevoked(user, site.connectionId, now);
      if (removed) { user.notice = 'Webflow access for ' + (removed.label || 'one connection') + ' was removed (the app was uninstalled or access was revoked), so its sites were deleted from AI SEO Deck. Connect again to bring them back.'; await store.saveUser(user); }
      else await store.updateSite(site.id, (s) => { s.sched.nextRunAt = now + 15 * 60000; });
      continue;
    }
    if (st === 'ok' && store.clearRevoked(user, site.connectionId)) await store.saveUser(user);
    const r = await startRun(site, user, site.sched.firstRunDone ? 'scheduled' : 'first');
    if (r.run) started++;
    else await store.updateSite(site.id, (s) => { s.sched.nextRunAt = now + DAY; s.sched.note = r.error; }); // try again tomorrow
  }
  return started;
}

/* ---------- doing the work ---------- */

async function doTask(run, task, deadline) {
  const [uid, engine, attemptRaw] = String(task).split('|');
  const attempt = parseInt(attemptRaw, 10) || 0;
  const unit = (run.units || []).find((u) => u.id === uid);
  const field = uid + '|' + engine;
  if (!unit) return 'skip';
  if (!(await store.takeCalls(1))) { await store.requeue(run.id, task); return 'budget'; }
  const timeoutMs = Math.min(40000, Math.max(5000, (deadline || Date.now() + 40000) - Date.now() - 2000));
  const base = { p: uid, k: unit.k, q: unit.q, e: engine };
  try {
    const ans = await engines.ask(engine, unit.text, { country: run.project.country, language: run.project.language, timeoutMs });
    if (ans.none) { // Google showed no AI answer for this search
      await store.saveResult(run.id, field, Object.assign(base, { ok: true, none: true, at: Date.now(), ms: ans.ms, model: ans.model }));
      return 'ok';
    }
    const a = analyze.analyzeAnswer(run.project, ans);
    await store.saveResult(run.id, field, Object.assign(base, { ok: true, at: Date.now(), ms: ans.ms, model: ans.model, text: ans.text.slice(0, 1500), queries: (ans.queries || []).slice(0, 6) }, a));
    return 'ok';
  } catch (e) {
    // a timeout caused by our own short time window is not the engine's fault: try again without counting it
    if (e.message === 'timed out' && timeoutMs < 40000) { await store.requeue(run.id, windowRetry(uid, engine, attempt)); return 'retry'; }
    // a refused account (credit ran out, key stopped working) tells the owner and is not tried again in this check
    const kind = await alerts.report(alerts.ENGINE_SERVICE[engine] || engine, e, 'answers from ' + (engines.LABEL[engine] || engine));
    if (e.retry && kind !== 'account' && attempt + 1 < MAX_ATTEMPTS) { await store.requeue(run.id, uid + '|' + engine + '|' + (attempt + 1)); return 'retry'; }
    await store.saveResult(run.id, field, Object.assign(base, { ok: false, at: Date.now(), kind, err: String(e.message || e).slice(0, 200) }));
    return 'failed';
  }
}

// Works on one run until the time budget is used or its queue is empty. Engines run in parallel, each
// within its own limit of calls at the same time.
async function workRun(runId, deadline) {
  if (!(await store.lock('run:' + runId, 60))) return { busy: true };
  const out = { ok: 0, failed: 0, retry: 0, budget: false };
  try {
    const run = await store.getRun(runId);
    if (!run || run.status !== 'running') { await store.endRun(runId); return out; }
    const running = new Set();
    const busy = {};
    let queue = [];
    let empty = false;
    const engineOf = (t) => String(t).split('|')[1];
    const free = (t) => (busy[engineOf(t)] || 0) < (engines.PARALLEL[engineOf(t)] || 2);
    for (;;) {
      if (out.budget || deadline - Date.now() < 12000) break; // not enough time left to wait for another answer
      const msLeft = deadline - Date.now();
      // take more when nothing taken can start now (its engine is busy, or it waits for a full window)
      if (!empty && queue.length < 36 && !queue.some((t) => free(t) && canStartTask(t, msLeft))) {
        const more = await store.takeTasks(runId, 12);
        if (!more.length) empty = true; else queue.push(...more);
      }
      // start what each engine's limit of parallel calls allows
      for (let i = 0; i < queue.length; i++) {
        const engine = engineOf(queue[i]);
        if (!free(queue[i])) continue;
        if (!canStartTask(queue[i], deadline - Date.now())) continue; // waits for a window long enough to finish
        const task = queue.splice(i, 1)[0];
        i--;
        busy[engine] = (busy[engine] || 0) + 1;
        const p = doTask(run, task, deadline).then((r) => {
          if (r === 'ok') out.ok++; else if (r === 'failed') out.failed++; else if (r === 'retry') out.retry++; else if (r === 'budget') out.budget = true;
        }).catch(() => { out.failed++; }).finally(() => { busy[engine]--; running.delete(p); });
        running.add(p);
      }
      if (!running.size) {
        if (!empty && queue.length < 36) continue; // take more tasks
        break; // nothing left that can start in this window: the rest goes back to the queue
      }
      await Promise.race(running); // a slot frees up
    }
    await Promise.all(running);
    // tasks taken but not started go back to the queue
    if (queue.length) await store.requeue(runId, ...queue);
    if (out.ok || out.failed) { run.lastProgressAt = Date.now(); await store.saveRun(run); }
  } finally {
    await store.unlock('run:' + runId);
  }
  return out;
}

async function maybeFinish(runId, now) {
  const run = await store.getRun(runId);
  if (!run) { await store.endRun(runId); return false; }
  if (run.status !== 'running') { await store.endRun(runId); return false; }
  const left = await store.tasksLeft(runId);
  if (left > 0) return false;
  const done = await store.resultCount(runId);
  if (done < run.total && now - (run.lastProgressAt || run.at) < STALE_MS) return false; // answers still coming in
  // A worker on this run (an open page or the background job) may have its last answers in flight, taken off
  // the queue: never finish under it, or those answers are lost and the run ends without them.
  if (!(await store.lock('run:' + runId, 60))) return false;
  try {
    if ((await store.tasksLeft(runId)) > 0) return false; // its work went back to the queue
    const fresh = await store.getRun(runId);
    if (!fresh || fresh.status !== 'running') return false;
    if ((await store.resultCount(runId)) < fresh.total && now - (fresh.lastProgressAt || fresh.at) < STALE_MS) return false;
    if (!(await store.lock('finish:' + runId, 90))) return false; // another worker is finishing it
    try {
      await finishRun(fresh, now);
    } finally { await store.unlock('finish:' + runId); }
  } finally { await store.unlock('run:' + runId); }
  return true;
}

// Writes each checked keyword's new summary (and a point on its trend), then adds up the site.
async function finishRun(run, now) {
  now = now || Date.now();
  const res = await store.results(run.id);
  const list = Object.values(res).filter(Boolean);
  const sums = {};
  for (const k of run.keywords || []) sums[k.id] = analyze.keywordSummary(run.project, run.engines, list.filter((r) => r.k === k.id));
  let described = null;
  if (!run.partial) { try { described = await insights.describe(run, list); } catch (e) { console.error('[aiseodeck] insights', e.message); } }
  run.status = 'done';
  run.finishedAt = now;
  run.summary = { keywords: Object.keys(sums).length, ok: list.filter((r) => r.ok && !r.none).length, total: list.length };
  await store.saveRun(run);
  await store.endRun(run.id);
  const user = await store.getUser(run.userId);
  const limits = user ? limitsFor(user) : { everyMs: 7 * DAY };
  let prev = null;
  let pending = [];
  const site = await store.updateSite(run.siteId, (s) => {
    prev = s.latest;
    const ids = new Set((s.keywords || []).map((k) => k.id));
    for (const [id, sum] of Object.entries(sums)) {
      if (!ids.has(id)) continue; // removed while it was being checked
      const trend = (((s.kw[id] && s.kw[id].trend) || []).concat([[now, Math.round(sum.vis * 100)]])).slice(-12);
      s.kw[id] = Object.assign(sum, { at: now, runId: run.id, trend });
    }
    for (const id of Object.keys(s.kw)) if (!ids.has(id)) delete s.kw[id];
    const summary = analyze.siteSummary(s.project, s.keywords, s.kw);
    summary.gaps = insights.gaps(s.keywords, s.kw);
    summary.insights = described || (s.latest && s.latest.insights) || null;
    s.latest = Object.assign({ runId: run.id, at: run.at, finishedAt: now, engines: run.engines, partial: !!run.partial }, summary);
    s.sched.runId = '';
    if (!run.partial) {
      s.sched.lastRunAt = now;
      s.sched.firstRunDone = true;
      s.sched.nextRunAt = now + limits.everyMs;
      delete s.sched.note;
    }
    pending = (s.sched.pendingKw || []).slice();
  });
  if (!site) return null;
  const keep = Object.values(site.kw || {}).map((k) => k.runId).filter(Boolean);
  const l = site.latest;
  if (run.partial) await store.expireRun(run.id, 90);
  else await store.pushHistory(site.id, { runId: run.id, at: run.at, finishedAt: now, score: l.score, mentionRate: l.mentionRate, citationRate: l.citationRate, avgRank: l.avgRank, ok: l.ok, total: l.total, keywords: l.keywords, kwNamed: l.kwNamed, engines: run.engines, reason: run.reason }, keep);
  // keywords added while this check was running
  if (pending.length && user) { try { await startRun(site, user, 'new', { keywordIds: pending }); } catch (e) { console.error('[aiseodeck] pending keywords', e.message); } }
  if (!run.partial && user && user.settings && user.settings.digest && run.reason !== 'manual' && !(await store.digestDone(run.id))) {
    try { await sendDigest(user, site, l, prev); } catch (e) { console.error('[aiseodeck] digest email failed', e.message); }
  }
  return l;
}

function digestHtml(site, s, prev) {
  const url = appUrl() + '/app/site?id=' + encodeURIComponent(site.id);
  const delta = prev && typeof prev.score === 'number' && !prev.partial ? s.score - prev.score : null;
  const kws = (site.keywords || []).filter((k) => site.kw[k.id]);
  const rows = kws.map((k) => ({ k, v: Math.round((site.kw[k.id].vis || 0) * 100), t: site.kw[k.id].trend || [] }))
    .sort((a, b) => b.v - a.v).slice(0, 8)
    .map(({ k, v, t }) => {
      const d = t.length > 1 ? t[t.length - 1][1] - t[t.length - 2][1] : null;
      return `<tr><td style="padding:6px 14px 6px 0;border-top:1px solid #E3E6F2">${esc(k.text)}</td><td style="padding:6px 0;border-top:1px solid #E3E6F2;text-align:right;font-weight:700">${v}%</td><td style="padding:6px 0 6px 10px;border-top:1px solid #E3E6F2;text-align:right;color:${d > 0 ? '#138A5A' : d < 0 ? '#C93C34' : '#6B7194'}">${d == null ? '' : (d > 0 ? '+' : '') + d}</td></tr>`;
    }).join('');
  const top = (s.voice || []).filter((v) => !v.own && v.n > 0).slice(0, 3).map((v) => esc(v.name) + ' (' + pct(v.share) + ')').join(', ');
  return `<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#0F1433;max-width:560px">
<p style="font-size:13px;color:#5A6080;margin:0 0 6px">AI SEO Deck scheduled check</p>
<h2 style="margin:0 0 8px;font-size:21px">${esc(site.project.brand || site.name)}: visible in ${s.score}% of AI answers${delta == null ? '' : ` (${delta >= 0 ? '+' : ''}${delta})`}</h2>
<p style="font-size:14px;margin:0 0 14px;color:#5A6080">Named by at least one AI engine for ${s.kwNamed || 0} of ${s.keywords || 0} keywords. Your site was cited in ${pct(s.citationRate)} of answers.</p>
${rows ? `<table style="border-collapse:collapse;font-size:14px;margin-bottom:14px;min-width:320px"><tr><th style="text-align:left;font-size:12px;color:#5A6080;padding-bottom:4px">Keyword</th><th style="text-align:right;font-size:12px;color:#5A6080">Visible</th><th></th></tr>${rows}</table>` : ''}
${top ? `<p style="font-size:14px;margin:0 0 14px">Rivals named most: ${top}</p>` : ''}
<p><a href="${esc(url)}" style="display:inline-block;background:#FFE45C;color:#1B1600;padding:10px 16px;border-radius:10px;text-decoration:none;font-weight:700">Open your deck</a></p>
<p style="font-size:12px;color:#5A6080">You get this email after each scheduled check. Turn it off on your Account page in AI SEO Deck.</p></div>`;
}
async function sendDigest(user, site, summary, prev) {
  const to = (user.settings && user.settings.reportEmail) || user.email;
  if (!to) return;
  await email.send({ to, subject: `AI visibility for ${site.project.brand || site.name}: ${summary.score}% of answers`, html: digestHtml(site, summary, prev), text: `AI visibility for ${site.project.brand || site.name}: named in ${summary.score}% of AI answers for ${summary.keywords || 0} keywords, cited in ${pct(summary.citationRate)}. ${appUrl()}/app/site?id=${site.id}` });
}

/* ---------- audits ---------- */
async function runAudit(site, user, budgetMs) {
  if (!site.url) throw new Error('This site has no published address yet. Publish it in Webflow first.');
  const limits = limitsFor(user);
  const token = store.tokenForSite(user, site);
  let pages = [];
  if (token) { try { pages = await wf.listPages(token, site.id, 500); } catch (e) { if (wf.isRevoked(e)) throw e; pages = []; } }
  // the site's languages (Webflow Localization), for the notes next to every Apply button
  let locale;
  if (token) { try { locale = store.localeOf(await wf.getSite(token, site.id)); } catch (e) { if (wf.isRevoked(e)) throw e; } }
  const audit = await auditLib.auditSite(site, pages, { maxPages: limits.auditPages, budgetMs: budgetMs || 35000 });
  await store.saveAudit(site.id, audit);
  const issues = audit.pages.reduce((a, p) => a + (p.issues || []).length, 0) + audit.siteIssues.length;
  await store.updateSite(site.id, (s) => { s.audit = { at: audit.at, score: audit.score, issues, pages: audit.pagesChecked }; if (locale !== undefined) s.locale = locale; });
  return audit;
}

/* ---------- the cron tick ---------- */
// budgetMs: the usual length of a tick. maxMs: the most it may take (the function may run 60 seconds).
async function tick(opts) {
  opts = opts || {};
  const startedAt = Date.now();
  const now = opts.now || startedAt;
  const deadline = startedAt + (opts.budgetMs || 45000);
  if (!(await store.lock('tick', 58))) return { skipped: 'another tick is running' };
  const out = { started: 0, worked: 0, finished: 0, audits: 0 };
  try {
    out.started = await scheduleDue(now, 20);
    let ids = await store.activeRunIds();
    // The run that moved least recently goes first and may use the whole window, so in turn every run gets a
    // window long enough for slow engines (Google AI Mode, Grok), even when scheduling took a few seconds.
    const runs = (await Promise.all(ids.map((id) => store.getRun(id)))).filter(Boolean)
      .sort((a, b) => (a.lastProgressAt || a.at || 0) - (b.lastProgressAt || b.at || 0));
    const workEnd = Math.min(startedAt + (opts.maxMs || 52000), Math.max(deadline, Date.now() + FULL_WINDOW_MS + 1000));
    for (const run of runs) {
      if (Date.now() > workEnd - 15000) break;
      const r = await workRun(run.id, workEnd);
      if (r.budget) { out.budget = true; break; }
      out.worked += (r.ok || 0) + (r.failed || 0);
    }
    for (const id of await store.activeRunIds()) if (await maybeFinish(id, Date.now())) out.finished++;
    // one audit older than a week, when there is time left
    if (Date.now() < deadline - 25000) {
      const sites = await store.getSites(await store.allSiteIds());
      const due = sites.filter((s) => s.tracked && (!s.audit || now - s.audit.at > 7 * DAY)).sort((a, b) => ((a.audit && a.audit.at) || 0) - ((b.audit && b.audit.at) || 0))[0];
      if (due) {
        const user = await store.getUser(due.userId);
        if (user) { try { await runAudit(due, user, Math.min(30000, deadline - Date.now() - 3000)); out.audits++; } catch (e) { console.error('[aiseodeck] audit failed', e.message); } }
      }
    }
  } finally {
    await store.unlock('tick');
  }
  return out;
}

module.exports = { tick, startRun, workRun, maybeFinish, finishRun, runAudit, scheduleDue, allowedKeywords, digestHtml, canStartTask, windowRetry, FULL_WINDOW_MS };
