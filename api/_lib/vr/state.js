'use strict';
// What the browser gets for a check: only what its stage may show. Nothing from the paid report leaves the server
// before the check is paid. Answers are sent as plain blocks with the business, its rivals and listing sites marked,
// so the page never has to parse an engine's markdown. Every search carries how often it is made on Google in a
// month: a number, null with measured true when there are too few to count, or measured false when nobody looked.
const analyze = require('../analyze');
const engines = require('../engines');
const core = require('./core');

const MAX_CHARS = 1900;
const LANG = { en: 'English', tr: 'Turkish', de: 'German', fr: 'French', es: 'Spanish', it: 'Italian', nl: 'Dutch', pt: 'Portuguese', pl: 'Polish', ar: 'Arabic', sv: 'Swedish', da: 'Danish', no: 'Norwegian', fi: 'Finnish', el: 'Greek', ja: 'Japanese', ko: 'Korean', zh: 'Chinese', ru: 'Russian' };
const money = (cents) => '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });

/* ---------- an engine's markdown as plain blocks ---------- */

// [{ t: 'p' | 'li' | 'h', s: text }], and whether the answer was cut at MAX_CHARS.
function toBlocks(text, maxChars) {
  let t = String(text || '').replace(/\r/g, '');
  t = t.replace(/【[^】]*】/g, '').replace(/\[\^?\d+\]/g, '')
    .replace(/\(\s*\[[^\]]+\]\(https?:[^)\s]+\)(?:\s*,\s*\[[^\]]+\]\(https?:[^)\s]+\))*\s*\)/g, '') // ([site](url)) source chips
    .replace(/\[([^\]]+)\]\(https?:[^)\s]+\)/g, (m, label) => (/^(https?:\/\/|www\.)|^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(label.trim()) ? '' : label))
    .replace(/\(?\bhttps?:\/\/[^\s)]+\)?/g, '')
    .replace(/\(\s*\)/g, '');
  const blocks = [];
  let para = [];
  const flush = () => { if (para.length) { blocks.push({ t: 'p', s: para.join(' ') }); para = []; } };
  for (const raw of t.split('\n')) {
    let line = raw.trim();
    if (!line) { flush(); continue; }
    if (/^[\s|:-]+$/.test(line)) { if (!/\|/.test(line)) flush(); continue; } // a rule, or the line under a table header
    let type = 'p';
    let m;
    const wasBold = /^(\*\*|__).+\1:?$/.test(line);
    if ((m = line.match(/^#{1,6}\s+(.*)$/))) { type = 'h'; line = m[1]; }
    else if ((m = line.match(/^(?:[-*•+]|\d+[.)])\s+(.*)$/))) { type = 'li'; line = m[1]; }
    else if (/^\|.*\|$/.test(line)) { type = 'li'; line = line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()).filter(Boolean).join(', '); }
    else if ((m = line.match(/^>\s?(.*)$/))) line = m[1];
    line = line.replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,;:!?]|$)/g, '$1$2').replace(/`([^`]+)`/g, '$1').replace(/\*\*|__/g, '')
      .replace(/\s+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();
    if (!line) continue;
    if (type === 'p' && wasBold && line.length < 80) type = 'h';
    if (type === 'p') para.push(line); else { flush(); blocks.push({ t: type, s: line }); }
  }
  flush();
  const max = maxChars || MAX_CHARS;
  const out = [];
  let used = 0, more = false;
  for (const b of blocks) {
    if (used + b.s.length <= max) { out.push(b); used += b.s.length; continue; }
    const room = max - used;
    if (room > 160) {
      const cut = b.s.slice(0, room);
      const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
      out.push({ t: b.t, s: (end > 80 ? cut.slice(0, end + 1) : cut.slice(0, cut.lastIndexOf(' '))).trim() });
    }
    more = true;
    break;
  }
  return { blocks: out, more };
}

// Splits a block where a term is written: [{ x: text }, { x: 'Casa Aldora', m: 'you' }, ...].
// terms: [{ term, m }]. Where two overlap, the business wins over a rival, and the longer spelling over the shorter.
function segments(text, terms) {
  const { out, map } = analyze.normMap(text);
  const hay = ' ' + out + ' ';
  const hits = [];
  terms.forEach((t, order) => {
    const forms = [analyze.norm(t.term)];
    const compact = forms[0].replace(/ /g, '');
    if (compact !== forms[0] && compact.length >= 4) forms.push(compact);
    for (const f of forms) {
      if (f.length < 2) continue;
      let from = 0;
      for (;;) {
        const i = hay.indexOf(' ' + f + ' ', from);
        if (i < 0) break;
        const start = map[i], end = map[i + f.length - 1] + 1;
        if (start != null && end > start) hits.push({ start, end, m: t.m, order });
        from = i + f.length;
      }
    }
  });
  const rank = { you: 0, rival: 1, dir: 2 };
  hits.sort((a, b) => rank[a.m] - rank[b.m] || (b.end - b.start) - (a.end - a.start) || a.order - b.order);
  const taken = [];
  for (const h of hits) if (!taken.some((x) => h.start < x.end && x.start < h.end)) taken.push(h);
  taken.sort((a, b) => a.start - b.start);
  const segs = [];
  let at = 0;
  for (const h of taken) {
    if (h.start > at) segs.push({ x: text.slice(at, h.start) });
    segs.push({ x: text.slice(h.start, h.end), m: h.m });
    at = h.end;
  }
  if (at < text.length) segs.push({ x: text.slice(at) });
  return segs;
}

/* ---------- one answer ---------- */

function publicAnswer(check, row, unit) {
  const base = { id: row.p + '|' + row.e, topic: row.k, q: row.q, e: row.e, state: core.stateOf(row), at: row.at || 0, asked: unit ? unit.text : '' };
  if (!row.ok) return Object.assign(base, { failed: true });
  if (row.none) return base;
  const p = check.project;
  const terms = [p.brand].concat(p.aliases || []).filter((x) => String(x || '').trim().length >= 2).map((term) => ({ term, m: 'you' }))
    .concat((p.domains || []).map((term) => ({ term, m: 'you' })))
    .concat((row.named || []).filter((x) => !x.you).map((x) => ({ term: x.name, m: x.kind === 'directory' ? 'dir' : 'rival' })));
  const { blocks, more } = toBlocks(row.text);
  const all = (row.sources || []).concat((row.consulted || []).filter((s) => !(row.sources || []).some((c) => (c.url && c.url === s.url) || (!c.url && c.host === s.host))));
  return Object.assign(base, {
    ms: row.ms || 0,
    blocks: blocks.map((b) => ({ t: b.t, segs: segments(b.s, terms) })), more,
    you: !!row.mentioned, rank: row.rank || 0, of: row.of || 0, cited: !!row.cited, read: !!row.read, ready: !!row.nx || row.k === 'b',
    named: (row.named || []).slice(0, 12),
    sources: (row.sources || []).slice(0, 8).map((s) => ({ host: s.host, url: /^https?:\/\//i.test(s.url || '') && !/vertexaisearch\.cloud\.google/.test(s.url) ? s.url : '', title: s.title || '', own: !!s.own })),
    pages: all.length, cites: (row.sources || []).length,
    queries: (row.queries || []).slice(0, 5)
  });
}

/* ---------- the whole check ---------- */

function engineInfo(list, free) {
  return list.map((e) => ({ id: e, name: engines.LONG[e] || e, short: engines.LABEL[e] || e, search: core.SEARCH.includes(e), free: free.includes(e) }));
}
const maskEmail = (e) => { const m = String(e || '').match(/^(.)([^@]*)(@.+)$/); return m ? m[1] + '•••' + m[3] : ''; };
// A search and its monthly number, for the country the check asks from.
const searchOf = (check, t) => ({ keyword: t.keyword, volume: typeof t.volume === 'number' ? t.volume : null, measured: !!t.looked && t.looked === check.ask.country });

// opts: { canPay: checkout is set up, now }
function publicState(check, rows, opts) {
  opts = opts || {};
  const now = opts.now || Date.now();
  const free = engines.freeEngines();
  const all = engines.enabled();
  const paid = !!check.paid && !check.paid.refundedAt;
  const full = check.phase === 'full';
  // a refunded report is closed; everything else follows the check's status
  const stage = check.paid && check.paid.refundedAt ? 'closed' : check.status === 'draft' ? 'draft' : check.status === 'preview' ? 'preview' : check.status === 'done' ? 'report'
    : check.status === 'running' && !full ? 'asking' : 'building';
  const s = check.site;
  const cents = core.price();
  const st = {
    id: check.id, stage, paid, at: check.at, parent: check.parent || '',
    price: { cents, label: money(cents) }, canPay: !!opts.canPay,
    site: {
      host: check.host, url: check.url, brand: check.project.brand, category: check.profile.category, place: check.profile.place, summary: check.profile.summary, guessed: !!check.profile.byAi,
      read: !!s.read.ok, status: s.read.status || 0, words: s.words, sample: s.sample, appShell: !!s.appShell, title: s.title
    },
    ask: { country: check.ask.country, countryName: core.COUNTRY[check.ask.country] || '', language: check.ask.language, languageName: LANG[check.ask.language] || '' },
    topics: check.topics.map((t) => Object.assign({ id: t.id, question: t.question, free: t.id === check.freeTopic }, searchOf(check, t))),
    engines: engineInfo(stage === 'draft' ? all : ((check.run && full && check.run.engines) || all), (check.run && !full && check.run.engines) || free),
    email: maskEmail(check.email),
    home: (process.env.APP_URL || 'https://aiseodeck.silitlabs.com').replace(/\/+$/, '') + '/ai-visibility-report'
  };
  if (stage === 'closed') return st;
  if (opts.paying && !paid) st.paying = String(opts.paying); // back from the checkout, payment still being confirmed
  if (stage === 'draft') {
    st.countries = Object.keys(core.COUNTRY).map((c) => [c, core.COUNTRY[c].replace(/^the /, '')]);
    st.others = (check.others || []).map((o) => searchOf(check, o));
    return st;
  }
  const units = (check.run && check.run.units) || [];
  const unitOf = (r) => units.find((u) => u.id === r.p);
  const freeEngines = st.engines.filter((e) => e.free).map((e) => e.id);
  const freeRows = rows.filter((r) => r && r.k === check.freeTopic && (r.q === 'k' || r.q === '0') && freeEngines.includes(r.e));

  if (stage === 'asking' || stage === 'preview' || (stage === 'building' && !check.report)) {
    // the free answers stay on the page while the paid report is built
    st.freeTopic = check.freeTopic;
    st.slots = freeEngines.map((e) => {
      const q = core.SEARCH.includes(e) ? 'k' : '0';
      const row = freeRows.find((r) => r.e === e && r.q === q);
      const unit = units.find((u) => u.k === check.freeTopic && u.q === q) || { text: (check.topics.find((t) => t.id === check.freeTopic) || {})[q === 'k' ? 'keyword' : 'question'] || '' };
      return row ? publicAnswer(check, row, unit) : { id: check.freeTopic + '.' + q + '|' + e, topic: check.freeTopic, q, e, state: 'pending', asked: unit.text };
    });
  }
  if (stage === 'preview' || (stage === 'building' && check.preview)) st.preview = check.preview;
  if (stage === 'preview') {
    // the first finding is free; the rest are counted, not shown
    const found = core.findingsOf(s);
    st.findings = { n: found.length, first: found[0] ? { title: found[0].title, detail: found[0].detail, sev: found[0].sev } : null };
    st.locked = { engines: all.filter((e) => !freeEngines.includes(e)).map((e) => engines.LONG[e] || e), topics: check.topics.filter((t) => t.id !== check.freeTopic).map((t) => searchOf(check, t)) };
  }
  if (stage === 'building') {
    const total = (check.run && check.run.total) || 0;
    const done = rows.length;
    const step = check.status === 'finalizing' ? (core.FIN_STEPS[(check.work && check.work.step) || 0] || 'compose') : 'answers';
    st.progress = { done: Math.min(done, total), total, step, steps: ['answers'].concat(core.FIN_STEPS) };
    st.matrix = core.matrixOf(check, rows, (check.run && check.run.engines) || all);
  }
  if (stage === 'report' && paid && check.report) {
    st.report = check.report;
    st.others = (check.others || []).map((o) => searchOf(check, o));
    st.answers = rows.filter((r) => r && r.p).map((r) => publicAnswer(check, r, unitOf(r)));
    st.doneAt = check.doneAt || 0;
    st.compare = check.compare || null;
    const rc = check.recheck;
    if (rc && !check.parent) st.recheck = { dueAt: rc.dueAt || 0, id: rc.doneAt ? rc.id : '', running: !!(rc.id && !rc.doneAt), earlyAt: (check.doneAt || check.at) + core.RECHECK_EARLY, open: now >= (check.doneAt || check.at) + core.RECHECK_EARLY };
  }
  return st;
}

module.exports = { toBlocks, segments, publicAnswer, publicState, LANG, money };
