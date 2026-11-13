'use strict';
// Background work, driven by one cron address (every few minutes) and by the dashboard while a run is open:
// start runs that are due, ask the engines, finish runs (summary, history, email), refresh old audits.
const store = require('./store');
const engines = require('./engines');
const analyze = require('./analyze');
const auditLib = require('./audit');
const wf = require('./webflow');
const email = require('./email');
const { limitsFor, DAY } = require('./plans');

const insights = require('./insights');
const STALE_MS = 3 * 60000; // a run with no tasks left and no progress for this long is finished as it is
const MAX_ATTEMPTS = 3;

const appUrl = () => (process.env.APP_URL || '').replace(/\/+$/, '');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x) => Math.round((x || 0) * 100) + '%';

/* ---------- starting runs ---------- */

// Prompts this site may use now: the plan's pool minus what the user's older tracked sites use.
async function allowedPrompts(site, user, limits) {
  const sites = (await store.getSites(user.siteIds || [])).filter((s) => s.tracked).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  let left = limits.prompts;
  for (const s of sites) {
    const n = (s.prompts || []).length;
    if (s.id === site.id) return Math.max(0, Math.min(n, left));
    left -= n;
  }
  return Math.max(0, Math.min((site.prompts || []).length, left));
}

async function startRun(site, user, reason) {
  const limits = limitsFor(user);
  const list = engines.forLimits(limits);
  if (!list.length) return { error: 'No AI engine is set up yet.' };
  const n = await allowedPrompts(site, user, limits);
  if (!n) return { error: 'No prompts to check. Add prompts first, or stay within your plan\'s prompt limit.' };
  const runSite = Object.assign({}, site, { prompts: (site.prompts || []).slice(0, n) });
  const run = await store.createRun(runSite, user, list, reason);
  await store.updateSite(site.id, (s) => {
    s.sched.runId = run.id;
    if (reason === 'manual') s.sched.lastManualAt = Date.now();
  });
  return { run };
}

async function scheduleDue(now, max) {
  const ids = await store.allSiteIds();
  const sites = await store.getSites(ids);
  let started = 0;
  for (const site of sites) {
    if (started >= (max || 20)) break;
    if (!site.tracked || !site.project || !site.project.ready || !(site.prompts || []).length) continue;
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
  const [pid, engine, attemptRaw] = String(task).split('|');
  const attempt = parseInt(attemptRaw, 10) || 0;
  const prompt = (run.prompts || []).find((p) => p.id === pid);
  const field = pid + '|' + engine;
  if (!prompt) return 'skip';
  if (!(await store.takeCalls(1))) { await store.requeue(run.id, task); return 'budget'; }
  const timeoutMs = Math.min(40000, Math.max(5000, (deadline || Date.now() + 40000) - Date.now() - 2000));
  try {
    const ans = await engines.ask(engine, prompt.text, { country: run.project.country, language: run.project.language, timeoutMs });
    if (ans.none) { // Google showed no AI answer for this question
      await store.saveResult(run.id, field, { p: pid, e: engine, ok: true, none: true, at: Date.now(), ms: ans.ms, model: ans.model });
      return 'ok';
    }
    const a = analyze.analyzeAnswer(run.project, ans);
    await store.saveResult(run.id, field, Object.assign({ p: pid, e: engine, ok: true, at: Date.now(), ms: ans.ms, model: ans.model, text: ans.text.slice(0, 1500), queries: (ans.queries || []).slice(0, 6) }, a));
    return 'ok';
  } catch (e) {
    // a timeout caused by our own short time window is not the engine's fault: try again without counting it
    if (e.message === 'timed out' && timeoutMs < 40000) { await store.requeue(run.id, pid + '|' + engine + '|' + attempt); return 'retry'; }
    if (e.retry && attempt + 1 < MAX_ATTEMPTS) { await store.requeue(run.id, pid + '|' + engine + '|' + (attempt + 1)); return 'retry'; }
    await store.saveResult(run.id, field, { p: pid, e: engine, ok: false, at: Date.now(), err: String(e.message || e).slice(0, 200) });
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
    for (;;) {
      if (out.budget || deadline - Date.now() < 12000) break; // not enough time left to wait for another answer
      if (!queue.length && !empty) {
        queue = await store.takeTasks(runId, 12);
        if (!queue.length) empty = true;
      }
      // start what each engine's limit of parallel calls allows
      for (let i = 0; i < queue.length; i++) {
        const engine = String(queue[i]).split('|')[1];
        if ((busy[engine] || 0) >= (engines.PARALLEL[engine] || 2)) continue;
        const task = queue.splice(i, 1)[0];
        i--;
        busy[engine] = (busy[engine] || 0) + 1;
        const p = doTask(run, task, deadline).then((r) => {
          if (r === 'ok') out.ok++; else if (r === 'failed') out.failed++; else if (r === 'retry') out.retry++; else if (r === 'budget') out.budget = true;
        }).catch(() => { out.failed++; }).finally(() => { busy[engine]--; running.delete(p); });
        running.add(p);
      }
      if (!running.size) {
        if (empty && !queue.length) break;
        continue;
      }
      await Promise.race(running); // a slot frees up
    }
    await Promise.all(running);
    // tasks taken but not started go back to the queue
    if (queue.length) for (const t of queue) await store.requeue(runId, t);
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
  if (!(await store.lock('finish:' + runId, 90))) return false; // another worker is finishing it
  try {
    const fresh = await store.getRun(runId);
    if (!fresh || fresh.status !== 'running') return false;
    await finishRun(fresh, now);
  } finally { await store.unlock('finish:' + runId); }
  return true;
}

async function finishRun(run, now) {
  now = now || Date.now();
  const res = await store.results(run.id);
  const list = Object.values(res).filter(Boolean);
  const summary = analyze.summarize(run.project, list);
  summary.gaps = insights.gaps(run, res);
  try { summary.insights = await insights.describe(run, list); } catch (e) { console.error('[aiseodeck] insights', e.message); }
  run.status = 'done';
  run.finishedAt = now;
  run.summary = summary;
  await store.saveRun(run);
  await store.endRun(run.id);
  const user = await store.getUser(run.userId);
  const limits = user ? limitsFor(user) : { everyMs: 7 * DAY };
  let prev = null;
  const site = await store.updateSite(run.siteId, (s) => {
    prev = s.latest;
    s.latest = Object.assign({ runId: run.id, at: run.at, finishedAt: now, engines: run.engines, prompts: run.prompts.length }, summary);
    s.sched.runId = '';
    s.sched.lastRunAt = now;
    s.sched.firstRunDone = true;
    s.sched.nextRunAt = now + limits.everyMs;
    delete s.sched.note;
  });
  if (!site) return null;
  await store.pushHistory(site.id, { runId: run.id, at: run.at, finishedAt: now, score: summary.score, mentionRate: summary.mentionRate, citationRate: summary.citationRate, avgRank: summary.avgRank, ok: summary.ok, total: summary.total, engines: run.engines, reason: run.reason });
  if (user && user.settings && user.settings.digest && run.reason !== 'manual' && !(await store.digestDone(run.id))) {
    try { await sendDigest(user, site, summary, prev); } catch (e) { console.error('[aiseodeck] digest email failed', e.message); }
  }
  return summary;
}

function digestHtml(site, s, prev) {
  const url = appUrl() + '/app/site?id=' + encodeURIComponent(site.id);
  const delta = prev && typeof prev.score === 'number' ? s.score - prev.score : null;
  const top = (s.voice || []).filter((v) => !v.own && v.n > 0).slice(0, 3).map((v) => esc(v.name) + ' (' + pct(v.share) + ')').join(', ');
  const hosts = (s.topHosts || []).slice(0, 5).map((h) => esc(h.host)).join(', ');
  return `<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#15131f;max-width:560px">
<p style="font-size:13px;color:#6b6780;margin:0 0 6px">AI SEO Deck weekly check</p>
<h2 style="margin:0 0 14px;font-size:20px">${esc(site.project.brand || site.name)}: AI visibility ${s.score}/100${delta == null ? '' : ` (${delta >= 0 ? '+' : ''}${delta})`}</h2>
<table style="border-collapse:collapse;font-size:14px;margin-bottom:14px"><tr><td style="padding:4px 14px 4px 0">Mentioned in</td><td><b>${pct(s.mentionRate)}</b> of answers</td></tr>
<tr><td style="padding:4px 14px 4px 0">Website cited in</td><td><b>${pct(s.citationRate)}</b> of answers</td></tr>
<tr><td style="padding:4px 14px 4px 0">Answers checked</td><td>${s.ok}${s.failed ? ` (${s.failed} could not be read)` : ''}</td></tr></table>
${top ? `<p style="font-size:14px;margin:0 0 8px">Competitors named most: ${top}</p>` : ''}
${hosts ? `<p style="font-size:14px;margin:0 0 14px">Sites the engines cite most for your questions: ${hosts}</p>` : ''}
<p><a href="${esc(url)}" style="display:inline-block;background:#6c4cf1;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">Open the full report</a></p>
<p style="font-size:12px;color:#6b6780">You get this email after each scheduled check. Turn it off in Settings.</p></div>`;
}
async function sendDigest(user, site, summary, prev) {
  const to = (user.settings && user.settings.reportEmail) || user.email;
  if (!to) return;
  await email.send({ to, subject: `AI visibility for ${site.project.brand || site.name}: ${summary.score}/100`, html: digestHtml(site, summary, prev), text: `AI visibility for ${site.project.brand || site.name}: ${summary.score}/100. Mentioned in ${pct(summary.mentionRate)} of answers, cited in ${pct(summary.citationRate)}. ${appUrl()}/app/site?id=${site.id}` });
}

/* ---------- audits ---------- */
async function runAudit(site, user, budgetMs) {
  if (!site.url) throw new Error('This site has no published address yet. Publish it in Webflow first.');
  const limits = limitsFor(user);
  const token = store.tokenForSite(user, site);
  let pages = [];
  if (token) { try { pages = await wf.listPages(token, site.id, 500); } catch (e) { if (wf.isRevoked(e)) throw e; pages = []; } }
  const audit = await auditLib.auditSite(site, pages, { maxPages: limits.auditPages, budgetMs: budgetMs || 35000 });
  await store.saveAudit(site.id, audit);
  const issues = audit.pages.reduce((a, p) => a + (p.issues || []).length, 0) + audit.siteIssues.length;
  await store.updateSite(site.id, (s) => { s.audit = { at: audit.at, score: audit.score, issues, pages: audit.pagesChecked }; });
  return audit;
}

/* ---------- the cron tick ---------- */
async function tick(opts) {
  opts = opts || {};
  const now = opts.now || Date.now();
  const deadline = now + (opts.budgetMs || 45000);
  if (!(await store.lock('tick', 58))) return { skipped: 'another tick is running' };
  const out = { started: 0, worked: 0, finished: 0, audits: 0 };
  try {
    out.started = await scheduleDue(now, 20);
    let ids = await store.activeRunIds();
    // oldest runs first, so every run keeps moving
    const runs = (await Promise.all(ids.map((id) => store.getRun(id)))).filter(Boolean).sort((a, b) => (a.at || 0) - (b.at || 0));
    for (const run of runs) {
      if (Date.now() > deadline - 15000) break;
      const share = Math.max(15000, Math.floor((deadline - Date.now()) / Math.max(1, runs.length)));
      const r = await workRun(run.id, Math.min(deadline, Date.now() + share));
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

module.exports = { tick, startRun, workRun, maybeFinish, finishRun, runAudit, scheduleDue, allowedPrompts, digestHtml };
