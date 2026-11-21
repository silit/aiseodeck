// Builds one self-contained HTML page that plays the whole AI Visibility Report as a click-through preview: the landing
// page, the question screen, a live check, the free result, the report being built and the full report. It uses the
// real styles, the real rendering (view.js) and the real browser code (client.js); only the server is replaced by a
// script that answers from the frozen sample (api/_lib/vr/sample.json). No network, nothing is asked or charged.
// The page has no <html>/<head>/<body> of its own, so it can be published as a preview artifact as it is.
// Run: node scripts/vr-preview.js [output file]
const fs = require('fs');
const path = require('path');
const pages = require('../api/_lib/vr/pages.js');

const sample = pages.sample();
if (!sample) { console.error('Run node scripts/vr-sample.js first.'); process.exit(1); }
const out = process.argv[2] || path.join(__dirname, '../preview/ai-visibility-report.html');

const BAR_CSS = `
.pv{background:var(--ink);color:var(--desk);font-size:13.5px;line-height:1.4}
.pv .wrap{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;padding-block:9px}
.pv p{font-weight:600;flex:1 1 260px;min-width:0}
.pv p span{font-weight:500;opacity:.8}
.pv-nav{display:flex;gap:5px;overflow-x:auto;scrollbar-width:none;max-width:100%}
.pv-nav::-webkit-scrollbar{display:none}
.pv-nav button{flex:none;font:650 12.5px/1 var(--sans);padding:8px 11px;border-radius:999px;border:1px solid color-mix(in srgb,var(--desk) 35%,transparent);background:transparent;color:inherit;cursor:pointer;white-space:nowrap}
.pv-nav button[aria-pressed=true]{background:var(--mark);color:var(--mark-ink);border-color:var(--mark)}
.pv-msg{position:fixed;left:50%;bottom:calc(18px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);background:var(--ink);color:var(--desk);font-size:13.5px;font-weight:600;padding:10px 16px;border-radius:999px;z-index:40;box-shadow:var(--shadow);max-width:calc(100% - 32px);text-align:center}
`;

// Stands in for the server: every stage is cut from the sample, with answers and steps arriving on a clock.
const DEMO_BEFORE = function (S) {
  var clone = function (o) { return JSON.parse(JSON.stringify(o)); };
  var stage = 'draft', askedAt = 0, buildAt = 0;
  var ARRIVE = [1500, 4100, 6700];
  var STEPS = ['answers', 'reading', 'audit', 'insights', 'assets', 'compose'];
  // every answer in the table of the report, plus the by-name question each chat engine gets
  var CELLS = 0, CHAT = S.report.engines.filter(function (e) { return ['aio', 'aimode'].indexOf(e.id || e) < 0; }).length;
  S.report.report.matrix.forEach(function (row) { row.cells.forEach(function (c) { CELLS += c.samples.length; }); });
  var TOTAL = CELLS + CHAT, PER = 250, STEP_MS = 1400;
  var withId = function (o) { o.id = 'demo'; return o; };
  var blank = function (a) { return { id: a.id, topic: a.topic, q: a.q, e: a.e, state: 'pending', asked: a.asked }; };
  function preview() { var p = withId(clone(S.preview)); p.canPay = true; return p; }
  function asking() {
    var p = withId(clone(S.preview)), el = Date.now() - askedAt, all = true;
    p.slots = p.slots.map(function (a, i) { if (el >= ARRIVE[i]) return a; all = false; return blank(a); });
    if (all) { stage = 'preview'; return preview(); }
    p.stage = 'asking'; delete p.preview; delete p.findings; delete p.locked;
    return p;
  }
  // the table of the report with only the first `done` answers filled in, the three free ones first
  function matrix(done) {
    var m = clone(S.report.report.matrix), order = [];
    m.forEach(function (row, r) { row.cells.forEach(function (c, k) { c.samples.forEach(function (s, i) { order.push({ r: r, k: k, i: i, free: r === 0 && i === 0 && ['openai', 'aio', 'gemini'].indexOf(c.e) >= 0 }); }); }); });
    order.sort(function (a, b) { return (b.free ? 1 : 0) - (a.free ? 1 : 0); });
    order.forEach(function (o, n) { if (n >= done) m[o.r].cells[o.k].samples[o.i] = 'pending'; });
    m.forEach(function (row) { var flat = []; row.cells.forEach(function (c) { flat = flat.concat(c.samples); }); row.named = flat.filter(function (s) { return s === 'both' || s === 'named'; }).length; row.answers = flat.filter(function (s) { return ['both', 'named', 'cited', 'absent'].indexOf(s) >= 0; }).length; });
    return m;
  }
  function building() {
    var el = Date.now() - buildAt;
    var done = Math.min(TOTAL, 3 + Math.floor(el / PER));
    var after = el - (TOTAL - 3) * PER;
    if (done >= TOTAL && after > 5 * STEP_MS) { stage = 'report'; return report(); }
    var p = withId(clone(S.preview));
    p.stage = 'building'; p.paid = true; p.engines = clone(S.report.engines);
    p.progress = { done: done, total: TOTAL, step: done < TOTAL ? 'answers' : STEPS[Math.min(5, 1 + Math.floor(after / STEP_MS))], steps: STEPS };
    p.matrix = matrix(done);
    delete p.findings; delete p.locked;
    return p;
  }
  function report() { return withId(clone(S.report)); }
  function state() {
    if (stage === 'draft') return withId(clone(S.draft));
    if (stage === 'asking') return asking();
    if (stage === 'preview') return preview();
    if (stage === 'building') return building();
    return report();
  }
  var soon = function (v, ms) { return new Promise(function (res) { setTimeout(function () { res(v); }, ms || 120); }); };
  var demo = {
    set: function (s) { stage = s; if (s === 'asking') askedAt = Date.now(); if (s === 'building') buildAt = Date.now(); },
    stage: function () { return stage; },
    state: state
  };
  window.__VRDemo = demo;
  window.__VR = {
    page: 'landing', demo: true,
    hero: { engines: S.preview.engines, ask: S.preview.ask, site: S.preview.site, topics: S.preview.topics, slots: S.preview.slots },
    api: {
      start: function () { demo.set('draft'); return soon({ id: 'demo' }, 5600); },
      state: function () { return soon(state()); },
      run: function () { demo.set('asking'); return soon({ ok: true }, 350); },
      pump: function () { return soon({ status: stage }, 900); },
      unlock: function () { demo.set('building'); return soon({ started: true }, 500); },
      email: function () { return soon({ ok: true }, 300); },
      confirm: function () { return soon({ ok: false }); },
      recheck: function () { return soon({ error: 'This is a preview. In a real report the re-check opens 14 days after it is built.' }, 300); }
    },
    go: function (url) { window.__VRDemo.go(url); }
  };
};

// After the real browser code has loaded: the bar that jumps between stages, and links that stay inside the preview.
const DEMO_AFTER = function () {
  var D = document, demo = window.__VRDemo, app = window.VRApp;
  var landing = D.getElementById('pv-landing'), check = D.getElementById('pv-check');
  var VIEWS = { acilis: 'landing', soru: 'draft', canli: 'asking', sonuc: 'preview', hazirlaniyor: 'building', rapor: 'report' };
  D.documentElement.setAttribute('data-demo', '1');
  function mark(name) {
    [].forEach.call(D.querySelectorAll('.pv-nav button'), function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-view') === name ? 'true' : 'false'); });
    try { if (('#' + name) !== window.location.hash) window.history.replaceState(null, '', '#' + name); } catch (e) { /* the frame may not allow it */ }
  }
  function nameOf(stage) { for (var k in VIEWS) if (VIEWS[k] === stage) return k; return 'acilis'; }
  function showLanding() { check.hidden = true; landing.hidden = false; mark('acilis'); window.scrollTo(0, 0); app.playHero(true); }
  function showCheck(stage) {
    if (stage) demo.set(stage);
    landing.hidden = true; check.hidden = false;
    app.open(demo.state(), true);
    mark(nameOf(demo.stage()));
  }
  demo.go = function (url) {
    if (/^\/check\//.test(url)) return showCheck();
    if (/\/sample$/.test(url)) return showCheck('report');
    showLanding();
  };
  function say(text) {
    var old = D.querySelector('.pv-msg'); if (old) old.remove();
    var m = D.createElement('div'); m.className = 'pv-msg'; m.setAttribute('role', 'status'); m.textContent = text;
    D.body.appendChild(m); setTimeout(function () { m.remove(); }, 2600);
  }
  D.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.pv-nav button');
    if (b) { var v = b.getAttribute('data-view'); if (v === 'acilis') showLanding(); else showCheck(VIEWS[v]); return; }
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    var href = a.getAttribute('href');
    if (/^https?:/.test(href)) return;
    if (href.charAt(0) === '#') {
      // a landing-page anchor clicked while a check is showing: go back to the landing page first
      var target = landing.querySelector(href);
      if (landing.hidden && target) { e.preventDefault(); showLanding(); target.scrollIntoView(); }
      return;
    }
    e.preventDefault();
    if (/\/sample$/.test(href)) return showCheck('report');
    if (href === '/ai-visibility-report') return showLanding();
    say('Bu bağlantı canlı sitede açılır.');
  }, true);
  // the stage shown follows the check as it moves on by itself
  setInterval(function () { if (!check.hidden) mark(nameOf((app.state() || {}).stage || demo.stage())); }, 700);
  var start = (window.location.hash || '').slice(1);
  if (VIEWS[start] && start !== 'acilis') showCheck(VIEWS[start]);
};

const bar = '<div class="pv"><div class="wrap"><p>Önizleme: yayında değil. <span>Veriler uydurma bir otele ait. Gerçek sürümde yazılan site okunur ve yapay zekalara sorulur.</span></p>' +
  '<div class="pv-nav" role="group" aria-label="Önizleme adımları">' +
  [['acilis', 'Açılış'], ['soru', 'Soru ekranı'], ['canli', 'Canlı kontrol'], ['sonuc', 'Ücretsiz sonuç'], ['hazirlaniyor', 'Rapor hazırlanıyor'], ['rapor', 'Tam rapor']]
    .map(([v, t], i) => '<button type="button" data-view="' + v + '" aria-pressed="' + (i === 0) + '">' + t + '</button>').join('') + '</div></div></div>';

const html = '<title>AI Visibility Report</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n' + pages.FONTS +
  '\n<style>' + pages.CSS + BAR_CSS + '</style>\n<script>document.documentElement.className="js"</script>\n' +
  bar + pages.top(pages.LANDING_NAV) +
  '<div id="pv-landing"><main>' + pages.landingBody() + '</main></div>' +
  '<div id="pv-check" hidden><main><div class="wrap" id="app"></div></main></div>' + pages.FOOT +
  '\n<script>' + pages.VIEW_SRC + '</script>' +
  '\n<script>(' + DEMO_BEFORE.toString() + ')(' + pages.safeJson(sample) + ');</script>' +
  '\n<script>' + pages.CLIENT_SRC + '</script>' +
  '\n<script>(' + DEMO_AFTER.toString() + ')();</script>\n';

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log('preview written:', out, (html.length / 1024).toFixed(0) + ' KB');
