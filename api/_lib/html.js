'use strict';
// Server-rendered pages. One CSS block with light and dark tokens.
// Semantics used everywhere: marker yellow = the brand was named, link blue = the brand's site was cited.
const { PLANS, FREE } = require('./plans');
const { LABEL, LONG, ORDER } = require('./engines');
const { PAGE_RULES, BOTS } = require('./audit');
const { norm } = require('./analyze');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x) => Math.round((x || 0) * 100) + '%';
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');

function ago(ts, now) {
  if (!ts) return 'never';
  const s = Math.max(0, Math.floor(((now || Date.now()) - ts) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  return plural(Math.floor(s / 86400), 'day') + ' ago';
}
function until(ts, now) {
  if (!ts) return '';
  const s = Math.floor((ts - (now || Date.now())) / 1000);
  if (s <= 0) return 'soon';
  if (s < 3600) return 'in ' + Math.max(1, Math.floor(s / 60)) + ' min';
  if (s < 86400) return 'in ' + Math.floor(s / 3600) + ' h';
  return 'in ' + plural(Math.round(s / 86400), 'day');
}
const hostOf = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch (e) { return String(u || ''); } };

const CSS = `
:root{--paper:#F5F6F8;--surface:#FFFFFF;--ink:#10162B;--muted:#5C6478;--line:#E2E5EC;--soft:#EEF0F4;--mark:#FFE066;--mark-ink:#10162B;--cite:#2D5BFF;--cite-soft:#E7EDFF;--slate:#8A93A6;--good:#1C8F5A;--good-soft:#E2F5EB;--bad:#C93C34;--bad-soft:#FBE8E6;--warn:#9A6400;--warn-soft:#FFF3D6;--focus:#2D5BFF;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--paper:#0D1120;--surface:#151A2C;--ink:#EAEDF6;--muted:#9AA3B8;--line:#262D44;--soft:#1C2236;--mark:#FFD84D;--mark-ink:#10162B;--cite:#7D9BFF;--cite-soft:#1D2750;--slate:#6B748C;--good:#4FD08F;--good-soft:#14301F;--bad:#FF8077;--bad-soft:#3A1D1B;--warn:#FFC25C;--warn-soft:#352A12;--focus:#7D9BFF;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.55 "Schibsted Grotesk",system-ui,-apple-system,"Segoe UI",Arial,sans-serif;padding:0 max(16px,env(safe-area-inset-left)) 56px max(16px,env(safe-area-inset-right));-webkit-font-smoothing:antialiased}
.wrap{max-width:1180px;margin:0 auto}
a{color:var(--cite);text-underline-offset:3px}
a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
h1,h2,h3{margin:0;line-height:1.12;letter-spacing:-.02em;font-weight:800;text-wrap:balance}
h1{font-size:clamp(26px,3.2vw,36px)}h2{font-size:21px}h3{font-size:16px;font-weight:700;letter-spacing:-.01em}
p{margin:0}
.muted{color:var(--muted)}.small{font-size:13.5px}.tiny{font-size:12.5px}
.top{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:18px 0;margin-bottom:26px;border-bottom:1px solid var(--line)}
.brand{display:inline-flex;align-items:center;gap:10px;font-weight:800;font-size:19px;letter-spacing:-.02em;color:var(--ink);text-decoration:none}
.logo{width:28px;height:28px;flex:none}
.top nav{display:flex;gap:18px;font-size:14.5px;font-weight:600}.top nav a{color:var(--ink);text-decoration:none}.top nav a:hover{color:var(--cite)}
.btn{font:inherit;font-weight:700;font-size:14.5px;border-radius:10px;padding:10px 16px;cursor:pointer;border:1px solid var(--line);background:var(--surface);color:var(--ink);text-decoration:none;display:inline-flex;gap:8px;align-items:center;justify-content:center;line-height:1.2}
.btn:hover{border-color:var(--slate)}
.btn.primary{background:var(--ink);color:var(--paper);border-color:var(--ink)}
.btn.primary:hover{opacity:.92}
.btn.mark{background:var(--mark);color:var(--mark-ink);border-color:var(--mark)}
.btn.ghost{background:transparent}
.btn.danger{color:var(--bad)}
.btn.sm{padding:7px 11px;font-size:13px;border-radius:8px}
.btn[disabled]{opacity:.5;cursor:not-allowed}
.actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.panel{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:22px;min-width:0}
.stack{display:grid;gap:18px;align-content:start}
.notice{border-radius:12px;padding:13px 16px;background:var(--cite-soft);margin-bottom:18px;font-size:14.5px}
.notice.bad{background:var(--bad-soft)}.notice.warn{background:var(--warn-soft)}.notice.good{background:var(--good-soft)}
.pill{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;border-radius:999px;padding:3px 10px;background:var(--soft);color:var(--muted);white-space:nowrap}
.pill.good{background:var(--good-soft);color:var(--good)}.pill.bad{background:var(--bad-soft);color:var(--bad)}.pill.warn{background:var(--warn-soft);color:var(--warn)}.pill.mark{background:var(--mark);color:var(--mark-ink)}.pill.cite{background:var(--cite-soft);color:var(--cite)}
.fields{display:grid;gap:16px}.field{display:grid;gap:6px;min-width:0}
label{font-size:13.5px;font-weight:700}
.hint{font-size:12.5px;color:var(--muted)}
input[type=text],input[type=email],input[type=url],input[type=tel],select,textarea{width:100%;font:inherit;font-size:14.5px;color:var(--ink);background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:10px 12px}
textarea{min-height:110px;resize:vertical;line-height:1.5}
textarea.code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px;min-height:220px}
.check{display:flex;gap:10px;align-items:flex-start;font-size:14.5px;font-weight:400}.check input{margin-top:4px;accent-color:var(--cite);width:16px;height:16px;flex:none}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px;align-items:start}
footer{margin-top:48px;padding-top:18px;border-top:1px solid var(--line);font-size:13px;color:var(--muted);display:flex;flex-wrap:wrap;gap:8px 22px}
footer a{color:var(--muted)}
.empty{padding:36px 22px;text-align:center;display:grid;gap:12px;justify-items:center}
.empty p{max-width:52ch;color:var(--muted)}

/* site header and summary */
.sitehead{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:14px;margin-bottom:20px}
.sitehead .meta{color:var(--muted);font-size:14px;margin-top:6px}
.summary{display:grid;grid-template-columns:minmax(220px,260px) 1fr 1fr;gap:18px;align-items:stretch;margin-bottom:22px}
@media(max-width:980px){.summary{grid-template-columns:1fr 1fr}.summary .ringbox{grid-column:1/-1}}
@media(max-width:640px){.summary{grid-template-columns:1fr}}
.ringbox{display:grid;justify-items:center;gap:10px;text-align:center}
.ring{width:200px;height:200px;max-width:100%}
.ring .n{font-weight:800;font-size:46px;letter-spacing:-.04em;fill:var(--ink)}
.ring .l{font-size:12.5px;fill:var(--muted)}
.facts{display:grid;gap:12px;align-content:start}
.fact{display:flex;gap:12px;align-items:baseline;font-size:15px}
.fact b{font-size:22px;letter-spacing:-.02em;font-weight:800;min-width:2.2ch;text-align:right}
.swatch{display:inline-block;width:11px;height:11px;border-radius:50%;margin-right:2px;vertical-align:baseline}
.swatch.named{background:var(--mark);box-shadow:0 0 0 1px rgba(16,22,43,.35)}
.swatch.cited{box-shadow:inset 0 0 0 2.5px var(--cite)}
.rows{display:grid;gap:10px}
.row{display:grid;grid-template-columns:96px 1fr auto;gap:10px;align-items:center;font-size:14px}
.bar{height:10px;border-radius:999px;background:var(--soft);overflow:hidden;display:flex}
.bar i{display:block;height:100%}
.bar i.named{background:var(--mark)}.bar i.cited{background:var(--cite)}.bar i.rival{background:var(--slate)}
.row .v{color:var(--muted);font-variant-numeric:tabular-nums;font-size:13px;white-space:nowrap}

/* tabs */
.tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);margin-bottom:20px;overflow-x:auto}
@media(max-width:640px){.tabs{flex-wrap:wrap;overflow:visible}.tabs a{padding:9px 10px}}
.tabs a{padding:10px 14px;font-weight:700;font-size:14.5px;color:var(--muted);text-decoration:none;border-bottom:3px solid transparent;white-space:nowrap}
.tabs a[aria-current=page]{color:var(--ink);border-bottom-color:var(--ink)}

/* answer grid */
.gridwrap{overflow-x:auto}
table.grid{border-collapse:separate;border-spacing:0;width:100%;min-width:560px}
.grid th{font-size:13px;font-weight:700;color:var(--muted);text-align:center;padding:0 6px 10px}
.grid th:first-child{text-align:left}
.grid td{padding:7px 6px;border-top:1px solid var(--line);vertical-align:middle;text-align:center}
.grid td.q{text-align:left;font-size:14.5px;max-width:520px}
.grid tr:hover td{background:var(--paper)}
.cell{width:30px;height:30px;border-radius:50%;display:inline-grid;place-items:center;font-weight:800;font-size:12.5px;text-decoration:none;color:var(--mark-ink)}
.cell.named{background:var(--mark)}
.cell.both{background:var(--mark);box-shadow:inset 0 0 0 3px var(--cite)}
.cell.cited{box-shadow:inset 0 0 0 3px var(--cite)}
.cell.none::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--slate);opacity:.55}
.cell.failed{border:1.5px dashed var(--slate)}
.cell.pending{background:var(--soft);animation:pulse 1.6s ease-in-out infinite}
@keyframes pulse{50%{opacity:.45}}
@media (prefers-reduced-motion:reduce){.cell.pending{animation:none}}
.legend{display:flex;flex-wrap:wrap;gap:8px 18px;font-size:13px;color:var(--muted);margin-bottom:14px;align-items:center}
.legend .cell{width:18px;height:18px;vertical-align:middle;margin-right:6px}
.legend .cell.both{box-shadow:inset 0 0 0 2.5px var(--cite)}.legend .cell.cited{box-shadow:inset 0 0 0 2.5px var(--cite)}
.legend .cell.none::before{width:5px;height:5px}
@media(max-width:640px){table.grid{min-width:0}.grid thead{display:none}.grid tbody tr{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;padding:12px 0;border-top:1px solid var(--line)}.grid td{border:0;padding:0}.grid td.q{flex-basis:100%;max-width:none}.grid td[data-e]::before{content:attr(data-e);font-size:12.5px;color:var(--muted);margin-right:8px;vertical-align:middle}.grid tr:hover td{background:none}}

/* transcripts */
.answer{border-top:1px solid var(--line);padding:18px 0;display:grid;gap:10px}
.answer:first-child{border-top:0;padding-top:0}
.answer .who{display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:13.5px;font-weight:700}
.quote{font-family:Newsreader,Georgia,"Times New Roman",serif;font-size:17.5px;line-height:1.6;max-width:72ch}
mark{background:linear-gradient(transparent 12%,var(--mark) 12%,var(--mark) 88%,transparent 88%);color:inherit;padding:0 2px;border-radius:2px}
.rival-name{text-decoration:underline dotted var(--slate) 2px;text-underline-offset:3px}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{font-size:12.5px;border:1px solid var(--line);border-radius:999px;padding:2px 9px;color:var(--muted);text-decoration:none;white-space:nowrap;max-width:260px;overflow:hidden;text-overflow:ellipsis}
.chip.own{background:var(--cite-soft);border-color:transparent;color:var(--cite);font-weight:700}
.prompt-h{font-size:17px;font-weight:800;letter-spacing:-.01em;margin:26px 0 8px}

/* lists */
ul.plain{list-style:none;margin:0;padding:0;display:grid}
ul.plain>li{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:12px 0;border-top:1px solid var(--line);flex-wrap:wrap}
ul.plain>li:first-child{border-top:0}
.checkrow{display:grid;grid-template-columns:26px 1fr auto;gap:12px;align-items:start;padding:14px 0;border-top:1px solid var(--line)}
.checkrow:first-child{border-top:0}
.ico{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-size:13px;font-weight:800}
.ico.ok{background:var(--good-soft);color:var(--good)}.ico.no{background:var(--bad-soft);color:var(--bad)}.ico.meh{background:var(--warn-soft);color:var(--warn)}
.tablewrap{overflow-x:auto}
table.list{border-collapse:collapse;width:100%;min-width:720px;font-size:14px}
.list th{font-size:12.5px;color:var(--muted);text-align:left;font-weight:700;padding:0 10px 10px}
.list td{padding:11px 10px;border-top:1px solid var(--line);vertical-align:top}
.score{font-weight:800;font-variant-numeric:tabular-nums}
.score.low{color:var(--bad)}.score.mid{color:var(--warn)}.score.high{color:var(--good)}
pre.copy{white-space:pre-wrap;word-break:break-word;background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:12px;font-size:12.5px;margin:0;max-height:320px;overflow:auto}

/* sites list */
.sites{display:grid;gap:14px}
.site{display:grid;grid-template-columns:72px 1fr auto;gap:18px;align-items:center}
.site .ring{width:72px;height:72px}
.site .ring .n{font-size:30px}
@media(max-width:640px){.site{grid-template-columns:56px 1fr}.site .go{grid-column:1/-1}}

/* setup */
.steps{display:grid;gap:18px;counter-reset:step}
.step h2{display:flex;gap:12px;align-items:center}
.step h2::before{counter-increment:step;content:counter(step);width:30px;height:30px;border-radius:50%;background:var(--ink);color:var(--paper);display:grid;place-items:center;font-size:15px;flex:none}
.suggest{display:grid;gap:8px}
.cell.na::before{content:"";width:10px;height:2px;border-radius:2px;background:var(--line)}
.cell.lock{color:var(--slate);background:repeating-linear-gradient(135deg,var(--soft) 0 4px,transparent 4px 8px)}
.grid th.locked{color:var(--slate);font-weight:600;white-space:nowrap}
.legend .cell.na::before{width:8px}
.upsell{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;background:var(--paper);border:1px dashed var(--line);border-radius:12px;padding:12px 14px;margin-top:14px;font-size:14px}
.duo{display:grid;grid-template-columns:1.3fr 1fr 1fr;gap:18px;margin-bottom:22px;align-items:stretch}
@media(max-width:1100px){.duo{grid-template-columns:1fr 1fr}.duo>:first-child{grid-column:1/-1}}
@media(max-width:700px){.duo{grid-template-columns:1fr}}
svg.trend{width:100%;height:auto;display:block}
svg.trend .gl{stroke:var(--line);stroke-width:1}
svg.trend .ax{font-size:11px;fill:var(--muted)}
svg.trend .ln{fill:none;stroke:var(--ink);stroke-width:2.2;stroke-linejoin:round;stroke-linecap:round}
svg.trend .ar{fill:var(--mark);opacity:.28}
svg.trend .pt{fill:var(--surface);stroke:var(--ink);stroke-width:1.6}
svg.trend .last{fill:var(--mark);stroke:var(--ink);stroke-width:1.8}
svg.trend .fut{stroke:var(--slate);stroke-width:1.6;stroke-dasharray:4 5;fill:none}
svg.trend .nx{fill:var(--surface);stroke:var(--slate);stroke-width:1.6;stroke-dasharray:3 3}
.deltas{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.delta{background:var(--soft);border-radius:10px;padding:10px 12px;display:grid;gap:2px;min-width:0}
.delta b{font-size:20px;letter-spacing:-.01em;line-height:1.15}
.delta em{font-style:normal;font-size:12px;font-weight:600}
.delta em.up{color:var(--good)}.delta em.down{color:var(--bad)}.delta em.flat{color:var(--muted)}
.sent{display:flex;height:12px;border-radius:999px;overflow:hidden;background:var(--soft)}
.sent i{display:block;height:100%}.sent .pos{background:var(--good)}.sent .neu{background:var(--slate);opacity:.6}.sent .neg{background:var(--bad)}
.chip.word{color:var(--ink);background:var(--paper)}
.checkit{background:var(--warn-soft);border-radius:10px;padding:10px 12px;display:grid;gap:6px}
.checkit ul{margin:0;padding-left:18px;font-size:13.5px;display:grid;gap:4px}
ul.gaps{list-style:none;margin:0;padding:0;display:grid}
ul.gaps li{display:flex;justify-content:space-between;gap:14px;align-items:center;padding:14px 0;border-top:1px solid var(--line);flex-wrap:wrap}
ul.gaps li:first-child{border-top:0}
.gq{display:grid;gap:3px;min-width:0;flex:1 1 320px}
.howto{background:var(--paper);border-radius:12px;padding:12px 14px}
.howto ol{margin:6px 0 0;padding:0;list-style:none;counter-reset:h;display:grid;gap:4px}
.howto li{counter-increment:h;display:grid;grid-template-columns:18px minmax(0,1fr)}
.howto li::before{content:counter(h) '.';font-weight:600;color:var(--muted)}
.row.wide{grid-template-columns:minmax(120px,190px) 1fr auto}
.row .host{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chips.eng{margin-top:8px}
.chips.eng .chip{font-size:12px;padding:1px 8px}
.chips.eng .chip.on{background:var(--mark);border-color:var(--mark);color:var(--mark-ink);font-weight:700}
.progress{height:8px;border-radius:999px;background:var(--soft);overflow:hidden;margin-top:10px}
.progress i{display:block;height:100%;background:var(--cite);transition:width .6s ease}
@media (prefers-reduced-motion:reduce){.progress i{transition:none}}
.plans{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px}
.plan{border:1px solid var(--line);border-radius:14px;padding:16px;display:grid;gap:8px;align-content:start}
.plan.current{border-color:var(--ink);box-shadow:inset 0 0 0 1px var(--ink)}
.plan .price{font-size:26px;font-weight:800;letter-spacing:-.02em}
`;

const LOGO = `<svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="var(--ink)"/><circle cx="11" cy="11" r="4" fill="var(--mark)"/><circle cx="21" cy="11" r="4" fill="none" stroke="var(--cite)" stroke-width="2.4"/><circle cx="11" cy="21" r="2" fill="var(--slate)"/><circle cx="21" cy="21" r="4" fill="var(--mark)" stroke="var(--cite)" stroke-width="2.4"/></svg>`;

function layout(title, body, opts) {
  opts = opts || {};
  const nav = opts.user
    ? `<nav aria-label="Main"><a href="/app">Sites</a><a href="/app/settings">Settings</a><a href="/logout">Sign out</a></nav>`
    : `<nav aria-label="Main"><a href="/">Home</a><a href="/docs">Docs</a><a href="/login">Sign in</a></nav>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${esc(title)}</title>
<link rel="icon" href="/favicon.png"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500&family=Schibsted+Grotesk:wght@400;500;600;700;800&display=swap">
<style>${CSS}</style></head><body><div class="wrap">
<header class="top"><a class="brand" href="${opts.user ? '/app' : (opts.brandName ? '#' : '/')}">${opts.brandName ? '' : LOGO}<span>${opts.brandName ? esc(opts.brandName) : 'AI SEO Deck'}</span></a>${opts.plain ? '' : nav}</header>
${body}
<footer>${opts.footer || '<span>AI SEO Deck by Silit Labs</span><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/docs">Docs</a><span>Not affiliated with Webflow, OpenAI, Google, Perplexity, Anthropic or xAI.</span>'}</footer>
</div>${opts.script ? `<script>${opts.script}</script>` : ''}</body></html>`;
}

function errorPage(title, message, back) {
  return layout(title, `<div class="panel stack" role="alert"><h1>${esc(title)}</h1><p>${esc(message)}</p><div class="actions"><a class="btn" href="${esc(back || '/app')}">Go back</a></div></div>`);
}
function loginPage(q) {
  const msg = q.sent ? '<div class="notice good">If that email belongs to an AI SEO Deck account, a sign in link is on its way. It works once and expires in 15 minutes.</div>'
    : q.bad ? '<div class="notice bad">That email address does not look right.</div>' : '';
  return layout('Sign in · AI SEO Deck', `${msg}<div class="cols">
<div class="panel stack"><h1>Sign in</h1><p class="muted">Enter the email of your Webflow account. We send you a one-time sign in link.</p>
<form method="post" action="/login" class="fields"><div class="field"><label for="email">Email</label><input type="email" id="email" name="email" required autocomplete="email"></div>
<div class="actions"><button class="btn primary" type="submit">Email me a sign in link</button></div></form></div>
<div class="panel stack"><h2>New here?</h2><p class="muted">Connect your Webflow site. You choose which sites AI SEO Deck can read; it only writes to Webflow when you press Apply on a fix.</p>
<div class="actions"><a class="btn mark" href="/auth">Connect Webflow</a></div></div></div>`);
}
function loginConfirm(token) {
  return layout('Sign in · AI SEO Deck', `<div class="panel stack"><h1>Sign in to AI SEO Deck</h1><p class="muted">Press the button to finish signing in.</p>
<form method="post" action="/l/${esc(token)}"><button class="btn primary" type="submit">Sign in</button></form></div>`);
}

/* ---------- answer ring and grid ---------- */

function cellState(r) {
  if (!r) return 'pending';
  if (!r.ok) return 'failed';
  if (r.none) return 'na';
  if (r.mentioned && r.cited) return 'both';
  if (r.mentioned) return 'named';
  if (r.cited) return 'cited';
  return 'none';
}

// Every answer is one dot around the score: yellow named, blue ring cited, grey not named.
function ringSvg(states, score, size, label) {
  size = size || 200;
  const c = size / 2;
  const r = size / 2 - 14;
  const n = Math.max(states.length, 1);
  const circ = 2 * Math.PI * r;
  const dot = Math.max(2.2, Math.min(7, (circ / n) * 0.36));
  const dots = states.map((s, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const x = (c + r * Math.cos(a)).toFixed(1), y = (c + r * Math.sin(a)).toFixed(1);
    if (s === 'named') return `<circle cx="${x}" cy="${y}" r="${dot}" fill="var(--mark)"/>`;
    if (s === 'both') return `<circle cx="${x}" cy="${y}" r="${dot}" fill="var(--mark)" stroke="var(--cite)" stroke-width="${Math.max(1.2, dot * 0.45).toFixed(1)}"/>`;
    if (s === 'cited') return `<circle cx="${x}" cy="${y}" r="${(dot * 0.85).toFixed(1)}" fill="none" stroke="var(--cite)" stroke-width="${Math.max(1.2, dot * 0.4).toFixed(1)}"/>`;
    if (s === 'pending' || s === 'na') return `<circle cx="${x}" cy="${y}" r="${(dot * 0.6).toFixed(1)}" fill="var(--line)"/>`;
    if (s === 'failed') return `<circle cx="${x}" cy="${y}" r="${(dot * 0.6).toFixed(1)}" fill="none" stroke="var(--slate)" stroke-width="1" stroke-dasharray="2 2"/>`;
    return `<circle cx="${x}" cy="${y}" r="${(dot * 0.5).toFixed(1)}" fill="var(--slate)" opacity=".55"/>`;
  }).join('');
  const big = size >= 120;
  return `<svg class="ring" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(label || ('Visibility score ' + (score == null ? 'not measured yet' : score + ' out of 100')))}">${dots}
<text x="${c}" y="${big ? c + 8 : c + 10}" text-anchor="middle" class="n">${score == null ? '-' : score}</text>${big ? `<text x="${c}" y="${c + 32}" text-anchor="middle" class="l">visibility score</text>` : ''}</svg>`;
}

// results: { "promptId|engine": result }, prompts: [{ id, text }], engines: ["openai", ...]
function statesOf(prompts, engines, results) {
  const out = [];
  for (const p of prompts) for (const e of engines) out.push(cellState(results[p.id + '|' + e]));
  return out;
}

const LOCK = '<svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><rect x="4" y="10" width="16" height="11" rx="3" fill="currentColor"/></svg>';
function gridHtml(site, prompts, engines, results, linkBase, locked) {
  if (!prompts.length) return '<div class="empty"><h3>No questions yet</h3><p>Add the questions your customers ask AI assistants, then run a check.</p><a class="btn primary" href="/app/site?id=' + encodeURIComponent(site.id) + '&tab=setup">Add questions</a></div>';
  locked = locked || [];
  const head = engines.map((e) => `<th scope="col" title="${esc(LONG[e] || e)}">${esc(LABEL[e] || e)}</th>`).join('')
    + locked.map((e) => `<th scope="col" class="locked" title="${esc(LONG[e] || e)}: paid plans">${LOCK} ${esc(LABEL[e] || e)}</th>`).join('');
  const rows = prompts.map((p) => `<tr><td class="q">${esc(p.text)}</td>${engines.map((e) => {
    const r = results[p.id + '|' + e];
    const s = cellState(r);
    const title = s === 'pending' ? 'Waiting for the answer' : s === 'failed' ? 'Could not read this answer' : s === 'na' ? 'Google showed no AI answer for this question' : s === 'none' ? 'Not named' : (s === 'cited' ? 'Site cited, brand not named' : `Named${r.rank ? ' #' + r.rank + (r.of > 1 ? ' of ' + r.of + ' brands' : '') : ''}${s === 'both' ? ', site cited' : ''}`);
    const inner = (s === 'named' || s === 'both') && r.rank ? r.rank : '';
    const href = s === 'pending' || s === 'na' || !linkBase ? '' : `${linkBase}#a-${encodeURIComponent(p.id)}-${e}`;
    return `<td data-e="${esc(LABEL[e] || e)}">${href ? `<a class="cell ${s}" href="${href}" title="${esc(title)}" aria-label="${esc(LABEL[e] + ': ' + title)}">${inner}</a>` : `<span class="cell ${s}" title="${esc(title)}" aria-label="${esc(LABEL[e] + ': ' + title)}"></span>`}</td>`;
  }).join('')}${locked.map((e) => `<td data-e="${esc(LABEL[e] || e)}"><span class="cell lock" title="${esc(LONG[e] || e)} is part of the paid plans" aria-label="${esc(LABEL[e])}: paid plans">${LOCK}</span></td>`).join('')}</tr>`).join('');
  const upsell = locked.length ? `<div class="upsell"><p><b>${plural(locked.length, 'more AI engine')}</b> answer these questions too: ${locked.map((e) => esc(LONG[e] || e)).join(', ')}.</p><a class="btn mark sm" href="/app/settings#plan">See every AI</a></div>` : '';
  return `<div class="legend" aria-hidden="true"><span><span class="cell named"></span>Named (number = place among the brands you track)</span><span><span class="cell both"></span>Named and your site cited</span><span><span class="cell cited"></span>Site cited, not named</span><span><span class="cell none"></span>Not named</span>${engines.some((e) => e === 'aio' || e === 'aimode') ? '<span><span class="cell na"></span>No AI answer from Google</span>' : ''}</div>
<div class="gridwrap"><table class="grid"><thead><tr><th scope="col">Question</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>${upsell}`;
}

/* ---------- trend, insights, rivals ---------- */

// Score over time as a small line chart; history is newest first.
function trendSvg(history) {
  const pts = (history || []).filter((h) => typeof h.score === 'number').slice(0, 12).reverse();
  if (pts.length < 2) return '';
  const W = 560, H = 150, L = 34, R = 14, T = 14, B = 26;
  const x = (i) => L + (i * (W - L - R)) / (pts.length - 1);
  const y = (v) => T + ((100 - v) * (H - T - B)) / 100;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.score).toFixed(1)}`).join(' ');
  const area = d + ` L${x(pts.length - 1).toFixed(1)} ${H - B} L${x(0).toFixed(1)} ${H - B} Z`;
  const day = (t) => new Date(t).toISOString().slice(5, 10).replace('-', '/');
  const grid = [0, 50, 100].map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="gl"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" class="ax">${v}</text>`).join('');
  const dots = pts.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.score).toFixed(1)}" r="${i === pts.length - 1 ? 5 : 3.2}" class="${i === pts.length - 1 ? 'last' : 'pt'}"><title>${esc(day(p.at))}: ${p.score}/100</title></circle>`).join('');
  return `<svg class="trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="Visibility score over the last ${pts.length} checks, from ${pts[0].score} to ${pts[pts.length - 1].score}">${grid}<path d="${area}" class="ar"/><path d="${d}" class="ln"/>${dots}
<text x="${L}" y="${H - 6}" class="ax">${esc(day(pts[0].at))}</text><text x="${W - R}" y="${H - 6}" text-anchor="end" class="ax">${esc(day(pts[pts.length - 1].at))}</text></svg>`;
}

// The trend panel: the line, then what moved since the check before. With one check it shows the starting point.
function trendPanel(history, site) {
  const pts = (history || []).filter((h) => typeof h.score === 'number');
  const n = Math.min(12, pts.length);
  const head = `<div class="actions" style="justify-content:space-between"><h3>Visibility over time</h3><span class="tiny muted">${n ? plural(n, 'check') : ''}</span></div>`;
  const nextAt = site && site.sched && site.sched.nextRunAt;
  const nextTxt = nextAt ? new Date(nextAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '';
  if (pts.length >= 2) {
    const a = pts[0], b = pts[1];
    const pc = (v) => Math.round((v || 0) * 100);
    const cell = (label, now, before, unit) => {
      const dl = now - before;
      const cls = dl > 0 ? 'up' : dl < 0 ? 'down' : 'flat';
      const txt = dl ? (dl > 0 ? '+' : '-') + Math.abs(dl) + (unit ? ' pts' : '') : 'no change';
      return `<div class="delta"><span class="tiny muted">${label}</span><b>${now}${unit}</b><em class="${cls}">${txt}</em></div>`;
    };
    return `${head}${trendSvg(history)}<div class="deltas">${cell('Score', a.score, b.score, '')}${cell('Answers naming you', pc(a.mentionRate), pc(b.mentionRate), '%')}${cell('Answers citing you', pc(a.citationRate), pc(b.citationRate), '%')}</div><p class="tiny muted">Change since the check before.${nextTxt ? ' Next check ' + esc(nextTxt) + '.' : ''}</p>`;
  }
  const s = pts.length ? pts[0].score : site && site.latest ? site.latest.score : null;
  if (s == null) return head + '<p class="small muted">The line starts with the first check.</p>';
  const W = 560, H = 150, L = 34, R = 14, T = 14, B = 26;
  const y = (v) => T + ((100 - v) * (H - T - B)) / 100;
  const grid = [0, 50, 100].map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="gl"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" class="ax">${v}</text>`).join('');
  const x0 = L + 10, x1 = W - R - 8, yy = y(s).toFixed(1);
  const svg = `<svg class="trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="First check: visibility score ${s} of 100">${grid}<line x1="${x0}" x2="${x1}" y1="${yy}" y2="${yy}" class="fut"/><circle cx="${x1}" cy="${yy}" r="5" class="nx"/><circle cx="${x0}" cy="${yy}" r="5" class="last"/><text x="${x0}" y="${H - 6}" class="ax">First check</text>${nextTxt ? `<text x="${W - R}" y="${H - 6}" text-anchor="end" class="ax">Next ${esc(nextTxt)}</text>` : ''}</svg>`;
  return `${head}${svg}<p class="small muted">This is your starting line: ${s} out of 100. Every check adds a point, so you see what your changes do.</p>`;
}

function insightsHtml(latest) {
  const ins = latest && latest.insights;
  if (!ins) return `<h3>How AI describes you</h3><p class="small muted">${latest && latest.mentionRate ? 'Appears after the next check.' : 'Once the AI names you, you will see the words it uses for you and whether it sounds positive.'}</p>`;
  const s = ins.sentiment || {};
  const tot = (s.positive || 0) + (s.neutral || 0) + (s.negative || 0) || 1;
  const seg = (k, cls) => s[k] ? `<i class="${cls}" style="width:${((s[k] / tot) * 100).toFixed(1)}%" title="${esc(k)}: ${s[k]}"></i>` : '';
  return `<h3>How AI describes you</h3>
<div class="sent" role="img" aria-label="${s.positive || 0} positive, ${s.neutral || 0} neutral, ${s.negative || 0} negative">${seg('positive', 'pos')}${seg('neutral', 'neu')}${seg('negative', 'neg')}</div>
<p class="tiny muted">${s.positive || 0} positive, ${s.neutral || 0} neutral, ${s.negative || 0} negative, from ${plural(ins.basedOn || 0, 'answer')} that name you.</p>
${(ins.descriptors || []).length ? `<div class="chips">${ins.descriptors.map((x) => `<span class="chip word">${esc(x)}</span>`).join('')}</div>` : ''}
${(ins.check || []).length ? `<div class="checkit"><b class="small">Worth checking</b><ul>${ins.check.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><p class="tiny muted">AI repeats what it reads. If something is wrong, fix it on your site and on the pages listed under Sources.</p></div>` : ''}`;
}

function andList(a) { a = (a || []).filter(Boolean); return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
function gapsHtml(site, latest) {
  const gaps = (latest && latest.gaps) || [];
  if (!latest) return '<div class="panel empty"><h3>Nothing to compare yet</h3><p>After the first check, this lists the questions where the AI recommends a rival and not you.</p></div>';
  if (!(site.project.competitors || []).length) return `<div class="panel empty"><h3>Add your rivals first</h3><p>Tell us who you compete with and we show every question where the AI picks them instead of you.</p><a class="btn primary" href="/app/site?id=${encodeURIComponent(site.id)}&tab=setup">Add rivals</a></div>`;
  if (!gaps.length) return '<div class="panel empty"><h3>No rival beats you in the last check</h3><p>Every answer that names a rival also names you, or names nobody. Keep adding questions to find new ground.</p></div>';
  return `<div class="panel stack"><div><h2>Where rivals win</h2><p class="small muted" style="margin-top:6px">The AI names a rival and not you for these questions. Start at the top: these are the widest gaps.</p></div>
<ul class="gaps">${gaps.map((g) => `<li><div class="gq"><b>${esc(g.text)}</b><span class="small muted">${esc(andList(g.rivals))} named instead. ${g.named ? `You are named by ${g.named} of ${plural(g.answered, 'AI engine')} here.` : 'No AI engine names you here.'}</span></div>
<div class="chips" aria-label="AI engines where a rival wins"><span class="tiny muted">Rival wins on</span>${g.engines.map((e) => `<span class="chip">${esc(LABEL[e] || e)}</span>`).join('')}</div></li>`).join('')}</ul>
<div class="howto"><b class="small">How to win these back</b><ol class="small"><li>Answer the question clearly on one page of your site, in the words people use. Add it as a FAQ with schema from the Site audit tab.</li><li>Open Sources and get listed or reviewed on the sites the AI cites for these questions.</li><li>Run the check again after you publish.</li></ol></div></div>`;
}

// Highlights the brand (marker) and rivals (dotted underline) inside an answer, in one pass over the escaped text.
function highlight(text, project) {
  const own = [project.brand].concat(project.aliases || []).concat(project.domains || []).filter((t) => String(t || '').trim().length >= 3);
  const rivals = (project.competitors || []).map((c) => c.name).filter((t) => String(t || '').trim().length >= 3);
  const kind = new Map();
  for (const t of rivals) kind.set(t.toLowerCase(), 'rival');
  for (const t of own) kind.set(t.toLowerCase(), 'own');
  const terms = [...kind.keys()].sort((a, b) => b.length - a.length);
  const escaped = esc(text);
  if (!terms.length) return escaped;
  const pat = (t) => esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s\\-]*');
  const re = new RegExp(terms.map((t) => '(' + pat(t) + ')').join('|'), 'gi');
  return escaped.replace(re, (m, ...groups) => {
    const i = groups.findIndex((g, n) => n < terms.length && g !== undefined);
    return kind.get(terms[i]) === 'own' ? `<mark>${m}</mark>` : `<span class="rival-name">${m}</span>`;
  });
}

/* ---------- dashboard ---------- */

function siteStatus(site, limits) {
  if (!site.project || !site.project.ready) return '<span class="pill warn">Not set up</span>';
  if (site.sched && site.sched.runId) return '<span class="pill cite">Checking now</span>';
  if (site.tracked) return '<span class="pill good">Tracking</span>';
  if (site.pausedByUser) return '<span class="pill">Paused</span>';
  return `<span class="pill warn">Waiting for a free slot</span>`;
}

function dashboard(user, sites, limits, notice, opts) {
  opts = opts || {};
  const now = Date.now();
  const list = sites.length ? sites.map((s) => {
    const l = s.latest;
    const ready = s.project && s.project.ready;
    const ring = ringSvg(l ? new Array(Math.min(60, l.ok || 0)).fill('none').map((x, i) => (i < Math.round((l.ok || 0) * l.mentionRate) ? 'named' : 'none')) : [], l ? l.score : null, 72, l ? `Visibility score ${l.score}` : 'Not checked yet');
    const engs = l ? Object.entries(l.byEngine || {}).filter(([, v]) => v.n).sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0])) : [];
    const strip = engs.length ? `<div class="chips eng">${engs.map(([e, v]) => `<span class="chip${v.m ? ' on' : ''}" title="${esc(LONG[e] || e)}: ${v.m ? 'names you' : 'does not name you yet'}">${esc(LABEL[e] || e)}</span>`).join('')}</div>` : '';
    const line = l ? `Named in <b>${Math.round(l.mentionRate * l.ok)}</b> of ${l.ok} answers, site cited in <b>${Math.round(l.citationRate * l.ok)}</b>. Checked ${ago(l.finishedAt || l.at, now)}.${strip}`
      : ready ? (s.sched && s.sched.runId ? 'The first check is running.' : 'No check yet.') : 'Pick your brand, rivals and questions to start.';
    return `<div class="panel site">${ring}<div class="stack" style="gap:6px"><div class="actions" style="gap:10px"><h2 style="font-size:19px">${esc(s.name)}</h2>${siteStatus(s, limits)}</div>
<p class="small muted">${esc(hostOf(s.url))}${s.audit ? `, site audit ${s.audit.score}/100` : ''}</p><p class="small">${line}</p></div>
<div class="go">${ready ? `<a class="btn" href="/app/site?id=${encodeURIComponent(s.id)}">Open</a>` : `<a class="btn mark" href="/app/setup?id=${encodeURIComponent(s.id)}">Set up</a>`}</div></div>`;
  }).join('') : `<div class="panel empty"><h2>No Webflow sites yet</h2><p>Connect Webflow and choose the sites AI SEO Deck may read.</p><a class="btn mark" href="/auth">Connect Webflow</a></div>`;
  const engineNote = opts.enginesOn && !opts.enginesOn.length ? '<div class="notice warn">No AI engine is connected on the server yet, so checks cannot run. If you run this app, add an engine API key.</div>' : '';
  return layout('Sites · AI SEO Deck', `${notice ? `<div class="notice">${notice}</div>` : ''}${engineNote}
<div class="sitehead"><div><h1>Your sites</h1><p class="meta">${esc(limits.name)} plan: ${plural(limits.sites, 'site')}, ${plural(limits.prompts, 'question')} checked ${limits.plan === 'free' ? 'every month on ChatGPT, Google AI Overviews and Perplexity' : 'every week on every AI engine'}.</p></div>
<div class="actions"><a class="btn" href="/auth">Add Webflow sites</a>${limits.plan === 'free' ? '<a class="btn primary" href="/app/settings#plan">Upgrade</a>' : ''}</div></div>
<div class="sites">${list}</div>`, { user });
}

/* ---------- setup ---------- */

const COUNTRIES = [['', 'Anywhere'], ['US', 'United States'], ['GB', 'United Kingdom'], ['IE', 'Ireland'], ['CA', 'Canada'], ['AU', 'Australia'], ['DE', 'Germany'], ['FR', 'France'], ['NL', 'Netherlands'], ['ES', 'Spain'], ['IT', 'Italy'], ['TR', 'Türkiye'], ['AE', 'United Arab Emirates'], ['SA', 'Saudi Arabia'], ['PL', 'Poland'], ['SE', 'Sweden'], ['IN', 'India'], ['BR', 'Brazil'], ['MX', 'Mexico']];
const LANGS = [['en', 'English'], ['tr', 'Turkish'], ['de', 'German'], ['fr', 'French'], ['es', 'Spanish'], ['it', 'Italian'], ['nl', 'Dutch'], ['pt', 'Portuguese'], ['pl', 'Polish'], ['ar', 'Arabic'], ['sv', 'Swedish']];
const options = (list, v) => list.map(([k, t]) => `<option value="${esc(k)}"${k === v ? ' selected' : ''}>${esc(t)}</option>`).join('');
const rivalLines = (p) => (p.competitors || []).map((c) => c.name + (c.domain ? ', ' + c.domain : '')).join('\n');

function setupPage(user, site, limits, opts) {
  opts = opts || {};
  const p = site.project;
  const usedElsewhere = opts.usedElsewhere || 0;
  const room = Math.max(0, limits.prompts - usedElsewhere);
  const current = (site.prompts || []).map((x) => x.text);
  const script = `
(function(){var box=document.getElementById('sugg');if(!box)return;var form=document.getElementById('setup');
function add(list){box.innerHTML='';if(!list.length){box.innerHTML='<p class="hint">No ideas came back. Write your own questions below.</p>';return;}
list.forEach(function(t,i){var l=document.createElement('label');l.className='check';var c=document.createElement('input');c.type='checkbox';c.name='pick';c.value=t;c.checked=i<${Math.min(room, 8)};l.appendChild(c);l.appendChild(document.createTextNode(' '+t));box.appendChild(l);});}
var fd=new FormData();fd.append('id',form.elements.id.value);
fetch('/app/setup/suggest',{method:'POST',body:new URLSearchParams(fd),headers:{'Content-Type':'application/x-www-form-urlencoded'}}).then(function(r){return r.json()}).then(function(j){add(j.prompts||[]);}).catch(function(){box.innerHTML='<p class="hint">Ideas could not be loaded. Write your own questions below.</p>';});})();`;
  return layout('Set up ' + site.name + ' · AI SEO Deck', `${opts.notice ? `<div class="notice">${opts.notice}</div>` : ''}
<div class="sitehead"><div><h1>Set up ${esc(site.name)}</h1><p class="meta">Three short steps. You can change everything later.</p></div></div>
<form id="setup" method="post" action="/app/setup" class="steps"><input type="hidden" name="id" value="${esc(site.id)}">
<section class="panel step stack"><h2>Your brand</h2>
<div class="cols"><div class="field"><label for="brand">Brand name as people say it</label><input type="text" id="brand" name="brand" required maxlength="80" value="${esc(p.brand)}"><span class="hint">This is what we look for in AI answers.</span></div>
<div class="field"><label for="aliases">Other names (optional)</label><input type="text" id="aliases" name="aliases" maxlength="200" value="${esc((p.aliases || []).join(', '))}" placeholder="Short name, old name, product name"><span class="hint">Separate with commas.</span></div>
<div class="field"><label for="domains">Your website domains</label><input type="text" id="domains" name="domains" maxlength="300" value="${esc((p.domains || []).join(', '))}"><span class="hint">An answer that links to these counts as a citation.</span></div>
<div class="field"><label for="country">Where your customers are</label><select id="country" name="country">${options(COUNTRIES, p.country || '')}</select></div>
<div class="field"><label for="language">Language of the questions</label><select id="language" name="language">${options(LANGS, p.language || 'en')}</select></div></div></section>
<section class="panel step stack"><h2>Your rivals</h2><p class="muted">Up to 5 businesses you compete with, one per line: name, then website.</p>
<div class="field"><label for="rivals" class="tiny muted" style="font-weight:600">Rivals</label><textarea id="rivals" name="rivals" placeholder="Brightline Studio, brightline.com&#10;Northfield Co, northfield.co">${esc(rivalLines(p))}</textarea></div></section>
<section class="panel step stack"><h2>Questions your customers ask AI</h2><p class="muted">Your plan checks ${plural(room, 'question')} on this site. We suggest some from your homepage; tick the ones that fit and add your own.</p>
<div id="sugg" class="suggest" aria-live="polite"><p class="hint">Writing suggestions from your homepage…</p></div>
<div class="field"><label for="own">Your own questions, one per line</label><textarea id="own" name="own" placeholder="Best Webflow agency for SaaS startups in Berlin?">${esc(current.join('\n'))}</textarea></div>
<div class="actions"><button class="btn mark" type="submit">Save and run the first check</button><a class="btn ghost" href="/app">Cancel</a></div></section>
</form>`, { user, script });
}

/* ---------- site page ---------- */

function summaryHtml(site, latest, states, prev) {
  if (!latest) {
    return `<div class="summary"><div class="panel ringbox">${ringSvg(states, null)}<p class="small muted">${site.sched && site.sched.runId ? 'Your first check is running.' : 'No check yet.'}</p></div>
<div class="panel facts"><h3>What you will see</h3><p class="small muted">For every question and engine: whether you are named, where you rank among your rivals and whether your website is cited as a source.</p></div>
<div class="panel facts"><h3>How long it takes</h3><p class="small muted">A few minutes while this page is open. You also get an email when it is done.</p></div></div>`;
  }
  const ok = latest.ok || 0;
  const named = Math.round(latest.mentionRate * ok);
  const cited = Math.round(latest.citationRate * ok);
  const delta = prev && typeof prev.score === 'number' ? latest.score - prev.score : null;
  const engineRows = Object.entries(latest.byEngine || {}).sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0])).map(([e, v]) => {
    const w1 = v.n ? (v.m / v.n) * 100 : 0;
    const txt = v.n ? `${v.m} of ${v.n} named, ${v.c} cited` : 'no AI answer shown';
    return `<div class="row"><span title="${esc(LONG[e] || e)}">${esc(LABEL[e] || e)}</span><span class="bar" role="img" aria-label="${esc(`${LONG[e] || e}: ${txt}`)}"><i class="named" style="width:${w1.toFixed(1)}%"></i></span><span class="v">${txt}</span></div>`;
  }).join('');
  const engCount = Object.values(latest.byEngine || {}).filter((v) => v.n).length;
  const engNamed = Object.values(latest.byEngine || {}).filter((v) => v.m).length;
  return `<div class="summary">
<div class="panel ringbox">${ringSvg(states, latest.score)}<p class="small muted">${delta == null ? 'First measurement' : (delta === 0 ? 'Same as the check before' : `${delta > 0 ? '+' : ''}${delta} since the check before`)}</p></div>
<div class="panel stack" style="gap:14px;align-content:center"><div class="facts">
<p class="fact"><b>${named}</b><span><span class="swatch named"></span> of ${ok} answers name ${esc(site.project.brand)}</span></p>
<p class="fact"><b>${cited}</b><span><span class="swatch cited"></span> cite your website as a source</span></p>
<p class="fact"><b>${engNamed}</b><span>of ${plural(engCount, 'AI engine')} name you at least once</span></p>
<p class="fact"><b>${latest.avgRank ? '#' + latest.avgRank.toFixed(1).replace(/\.0$/, '') : '-'}</b><span>average place when named</span></p></div></div>
<div class="panel stack" style="gap:12px"><h3>By AI engine</h3><div class="rows">${engineRows}</div></div>
</div>`;
}
function voiceHtml(latest) {
  const voice = ((latest && latest.voice) || []).slice(0, 6).map((v) => `<div class="row"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(v.name)}">${v.own ? '<b>' + esc(v.name) + '</b>' : esc(v.name)}</span><span class="bar"><i class="${v.own ? 'named' : 'rival'}" style="width:${(v.share * 100).toFixed(1)}%"></i></span><span class="v">${pct(v.share)}</span></div>`).join('');
  return `<h3>Share of voice</h3><p class="tiny muted">Of the answers that name any brand you track.</p><div class="rows">${(latest && (latest.voice || []).length > 1) ? voice : '<p class="small muted">Add rivals in Setup to compare.</p>'}</div>`;
}

function progressHtml(site, progress) {
  if (!site.sched || !site.sched.runId) return '';
  const total = (progress && progress.total) || 0;
  const done = (progress && progress.done) || 0;
  const w = total ? Math.round((done / total) * 100) : 4;
  return `<div class="notice" id="progress" aria-live="polite"><b>Checking now.</b> <span id="pdone">${done}</span> of <span id="ptotal">${total}</span> answers read. Keep this page open to speed it up, or come back later; we email you when it is done.<div class="progress"><i id="pbar" style="width:${w}%"></i></div></div>`;
}
const PUMP = (siteId) => `
(function(){var id=${JSON.stringify(siteId)};var stop=false;
function step(){if(stop)return;fetch('/app/run/pump',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'id='+encodeURIComponent(id)}).then(function(r){return r.json()}).then(function(j){
if(j.total){document.getElementById('pdone').textContent=j.done;document.getElementById('ptotal').textContent=j.total;document.getElementById('pbar').style.width=Math.round(j.done/j.total*100)+'%';}
if(j.finished||j.idle){stop=true;location.reload();return;}if(j.budget){stop=true;var p=document.getElementById('progress');if(p)p.insertAdjacentHTML('beforeend','<p class=\"small\" style=\"margin-top:8px\">Checks are paused for a while. They continue automatically; you do not need to keep this page open.</p>');return;}setTimeout(step,j.busy?4000:600);}).catch(function(){setTimeout(step,8000);});}
step();})();`;

function tabsHtml(site, tab) {
  const t = (k, label) => `<a href="/app/site?id=${encodeURIComponent(site.id)}&tab=${k}"${tab === k ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<nav class="tabs" aria-label="Site sections">${t('answers', 'Answer grid')}${t('transcripts', 'What the AI said')}${t('rivals', 'Where rivals win')}${t('sources', 'Sources')}${t('audit', 'Site audit')}${t('setup', 'Setup')}</nav>`;
}

function transcriptsHtml(site, prompts, engines, results) {
  const project = site.project;
  const blocks = prompts.map((p) => {
    const items = engines.map((e) => {
      const r = results[p.id + '|' + e];
      if (!r) return '';
      const s = cellState(r);
      const tag = s === 'both' ? `<span class="pill mark">Named${r.rank ? ' #' + r.rank : ''}</span><span class="pill cite">Site cited</span>` : s === 'named' ? `<span class="pill mark">Named${r.rank ? ' #' + r.rank : ''}</span>` : s === 'cited' ? '<span class="pill cite">Site cited</span>' : s === 'failed' ? '<span class="pill bad">Could not read</span>' : s === 'na' ? '<span class="pill">No AI answer from Google</span>' : '<span class="pill">Not named</span>';
      const own = (project.domains || []);
      const chips = (r.sources || []).map((x) => {
        const isOwn = own.some((d) => x.host === d || String(x.host || '').endsWith('.' + d));
        return x.url && /^https?:\/\//.test(x.url) && !/vertexaisearch|grounding-api/.test(x.url) ? `<a class="chip${isOwn ? ' own' : ''}" href="${esc(x.url)}" rel="noopener nofollow" target="_blank" title="${esc(x.title || x.url)}">${esc(x.host)}</a>` : `<span class="chip${isOwn ? ' own' : ''}">${esc(x.host)}</span>`;
      }).join('');
      return `<article class="answer" id="a-${esc(p.id)}-${esc(e)}"><div class="who">${esc(LABEL[e] || e)} ${tag}</div>
${r.none ? '<p class="small muted">Google showed regular results only for this question, without an AI answer.</p>' : r.ok ? `<p class="quote">${highlight(r.snippet || '', project)}</p>` : `<p class="small muted">${esc(r.err || 'The engine did not answer.')}</p>`}${r.ok && (r.queries || []).length ? `<p class="tiny muted">Searched for: ${r.queries.map(esc).join('; ')}</p>` : ''}
${chips ? `<div class="chips" aria-label="Sources">${chips}</div>` : ''}${r.ok && r.text && r.text.length > (r.snippet || '').length + 40 ? `<details><summary class="small">Full answer</summary><p class="quote" style="font-size:16px;margin-top:8px;white-space:pre-line">${highlight(r.text, project)}</p></details>` : ''}</article>`;
    }).join('');
    return items ? `<h3 class="prompt-h">${esc(p.text)}</h3><div class="panel">${items}</div>` : '';
  }).join('');
  return blocks || '<div class="panel empty"><h3>No answers yet</h3><p>Answers appear here after the first check.</p></div>';
}

function sourcesHtml(latest) {
  const hosts = (latest && latest.topHosts) || [];
  if (!hosts.length) return '<div class="panel empty"><h3>No sources yet</h3><p>After a check, this lists the websites the AI engines rely on for your questions.</p></div>';
  const max = Math.max(...hosts.map((h) => h.n), 1);
  const own = (latest.ownCited || []);
  const qs = (latest.topQueries || []);
  return `<div class="cols"><div class="panel stack"><h2>Websites the AI relies on for your questions</h2><p class="small muted">Being mentioned on these sites (reviews, directories, articles, lists) is the fastest way into the answers. Your own site is left out.</p>
<div class="rows">${hosts.map((h) => `<div class="row wide"><span class="host" title="${esc(h.host)}">${esc(h.host)}</span><span class="bar"><i class="rival" style="width:${((h.n / max) * 100).toFixed(1)}%"></i></span><span class="v">${plural(h.n, 'answer')}</span></div>`).join('')}</div></div>
<div class="stack"><div class="panel stack"><h2>Your pages the AI cites</h2>${own.length ? `<ul class="plain">${own.map((u) => `<li><a href="${esc(u.url)}" target="_blank" rel="noopener" class="small">${esc(u.url.replace(/^https?:\/\/(www\.)?/, ''))}</a><span class="small muted">${plural(u.n, 'answer')}</span></li>`).join('')}</ul>` : '<p class="small muted">None of your pages was cited in the last check. Clear answer pages and structured data from the Site audit help.</p>'}</div>
<div class="panel stack"><h2>What the AI searched for</h2><p class="small muted">The web searches the engines ran to answer your questions. Pages that match these searches get read first.</p>${qs.length ? `<div class="chips">${qs.map((q) => `<span class="chip">${esc(q.q)}${q.n > 1 ? ` <b>${q.n}</b>` : ''}</span>`).join('')}</div>` : '<p class="small muted">No searches were reported in the last check.</p>'}</div></div></div>`;
}

function scoreClass(n) { return n == null ? '' : n >= 80 ? 'high' : n >= 55 ? 'mid' : 'low'; }

const SITE_CHECKS = {
  robots_blocks_ai: { title: 'AI crawlers are blocked in robots.txt', fix: 'Allow the answer engines below in Site settings > SEO > robots.txt, then publish.' },
  llms_missing: { title: 'No llms.txt file', fix: 'Download the file we wrote from your pages and upload it in Site settings > SEO > LLMs.txt, then publish.' },
  sitemap_missing: { title: 'No sitemap.xml', fix: 'Turn on the auto-generated sitemap in Site settings > SEO > Sitemap, then publish.' },
  org_schema_missing: { title: 'Your homepage does not say who you are (Organization schema)', fix: 'Open the homepage fix and apply the Organization schema.' },
  not_https: { title: 'The site is not served over HTTPS', fix: 'Turn on SSL in Site settings > Publishing.' },
  home_unreachable: { title: 'The homepage could not be read', fix: 'Check that the site is published and reachable.' }
};

function auditHtml(site, audit, limits) {
  const id = encodeURIComponent(site.id);
  if (!audit) return `<div class="panel empty"><h3>Find out what keeps AI engines from citing you</h3><p>The audit reads your live pages, robots.txt, llms.txt and sitemap, then lists fixes. Most can be applied to Webflow in one click.</p>
<form method="post" action="/app/site/audit"><input type="hidden" name="id" value="${esc(site.id)}"><button class="btn primary" type="submit">Run the site audit</button></form><p class="tiny">Takes up to a minute.</p></div>`;
  const s = audit.site || {};
  const checks = [
    { ok: !(s.blockedBots || []).some((b) => (BOTS.find((x) => x.ua === b) || {}).kind === 'search'), code: 'robots_blocks_ai', okText: 'AI search crawlers can read the site' },
    { ok: !!s.llms, code: 'llms_missing', okText: 'llms.txt is published' },
    { ok: !!s.sitemap, code: 'sitemap_missing', okText: 'sitemap.xml is published' },
    { ok: !!s.orgSchema, code: 'org_schema_missing', okText: 'The homepage says who you are (Organization schema)' }
  ];
  const checkRows = checks.map((c) => {
    const info = SITE_CHECKS[c.code];
    let extra = '';
    if (!c.ok && c.code === 'llms_missing') extra = `<a class="btn sm" href="/app/llms?id=${id}">Download llms.txt</a>`;
    if (!c.ok && c.code === 'org_schema_missing') { const home = (audit.pages || []).find((p) => p.path === '/' && p.pageId); if (home) extra = `<a class="btn sm" href="/app/fix?id=${id}&page=${encodeURIComponent('/')}">Fix</a>`; }
    const blocked = c.code === 'robots_blocks_ai' && !c.ok ? `<pre class="copy" style="margin-top:8px">${esc(require('./fixes').robotsLines(s.blockedBots))}</pre>` : '';
    return `<div class="checkrow"><span class="ico ${c.ok ? 'ok' : 'no'}" aria-hidden="true">${c.ok ? '✓' : '!'}</span><div><b>${esc(c.ok ? c.okText : info.title)}</b>${c.ok ? '' : `<p class="small muted">${esc(info.fix)}</p>${blocked}`}</div><div>${extra}</div></div>`;
  }).join('');
  const rows = (audit.pages || []).map((p) => {
    const issues = (p.issues || []).map((k) => `<span class="pill ${PAGE_RULES[k] && PAGE_RULES[k].w >= 10 ? 'bad' : 'warn'}" title="${esc(PAGE_RULES[k] ? PAGE_RULES[k].text : k)}">${esc(issueLabel(k))}</span>`).join(' ');
    return `<tr><td><a href="${esc(audit.origin + p.path)}" target="_blank" rel="noopener">${esc(p.path)}</a><div class="tiny muted">${esc((p.title || p.name || '').slice(0, 70))}</div></td>
<td><span class="score ${scoreClass(p.score)}">${p.score == null ? '-' : p.score}</span></td><td>${p.error ? `<span class="small muted">${esc(p.error)}</span>` : (issues || '<span class="pill good">All good</span>')}${p.noindex ? ' <span class="pill">noindex</span>' : ''}</td>
<td>${p.pageId && !p.error ? `<a class="btn sm" href="/app/fix?id=${id}&page=${encodeURIComponent(p.path)}">Fix</a>` : (p.template ? '<span class="tiny muted">CMS template</span>' : (!p.error ? '<span class="tiny muted">CMS page</span>' : ''))}</td></tr>`;
  }).join('');
  return `<div class="cols" style="margin-bottom:18px"><div class="panel stack"><div class="actions" style="justify-content:space-between"><h2>AI readiness <span class="score ${scoreClass(audit.score)}">${audit.score}/100</span></h2>
<form method="post" action="/app/site/audit"><input type="hidden" name="id" value="${esc(site.id)}"><button class="btn sm" type="submit">Run again</button></form></div>
<p class="small muted">${plural(audit.pagesChecked, 'page')} read ${ago(audit.at)}${audit.complete ? '' : ` (${audit.pagesListed - audit.pagesChecked} more next time)`}.</p>${checkRows}</div></div>
<div class="panel"><div class="tablewrap"><table class="list"><thead><tr><th>Page</th><th>Score</th><th>What to fix</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
<p class="tiny muted" style="margin-top:10px">Fixes for CMS pages are made in the collection template in Webflow. Static pages can be fixed here.</p></div>`;
}
function issueLabel(k) {
  return { title_missing: 'No title', title_length: 'Title length', desc_missing: 'No description', desc_length: 'Description length', h1_missing: 'No H1', h1_multiple: 'Several H1', schema_missing: 'No schema', schema_invalid: 'Broken schema', faq_no_schema: 'FAQ without schema', og_missing: 'Social preview', thin: 'Thin content', alt_missing: 'Alt text', lang_missing: 'No language' }[k] || k;
}

const BUSINESS_TYPES = [['Organization', 'Company or brand'], ['LocalBusiness', 'Local business'], ['ProfessionalService', 'Agency or professional service'], ['Dentist', 'Dental clinic'], ['MedicalClinic', 'Medical clinic'], ['BeautySalon', 'Beauty salon'], ['HealthAndBeautyBusiness', 'Health and beauty'], ['Restaurant', 'Restaurant'], ['Store', 'Shop'], ['RealEstateAgent', 'Real estate'], ['LegalService', 'Legal service'], ['EducationalOrganization', 'School or course']];

function setupTab(site, limits, opts) {
  const p = site.project;
  const biz = p.business || {};
  const id = esc(site.id);
  const prompts = (site.prompts || []).map((x) => `<li><span>${esc(x.text)}</span><form method="post" action="/app/site/prompts"><input type="hidden" name="id" value="${id}"><input type="hidden" name="action" value="remove"><input type="hidden" name="pid" value="${esc(x.id)}"><button class="btn sm ghost" type="submit" aria-label="Remove question: ${esc(x.text)}">Remove</button></form></li>`).join('');
  return `<div class="cols">
<div class="panel stack"><h2>Questions</h2><p class="small muted">${plural((site.prompts || []).length, 'question')} on this site. Your plan allows ${limits.prompts} across all sites.</p>
<ul class="plain">${prompts || '<li class="muted">No questions yet.</li>'}</ul>
<form method="post" action="/app/site/prompts" class="fields"><input type="hidden" name="id" value="${id}"><input type="hidden" name="action" value="add">
<div class="field"><label for="newq">Add questions, one per line</label><textarea id="newq" name="text" style="min-height:80px" required></textarea></div><div class="actions"><button class="btn" type="submit">Add</button></div></form></div>
<form class="panel stack" method="post" action="/app/site/settings"><input type="hidden" name="id" value="${id}"><h2>Brand and rivals</h2>
<div class="field"><label for="brand">Brand name</label><input type="text" id="brand" name="brand" required maxlength="80" value="${esc(p.brand)}"></div>
<div class="field"><label for="aliases">Other names</label><input type="text" id="aliases" name="aliases" maxlength="200" value="${esc((p.aliases || []).join(', '))}"></div>
<div class="field"><label for="domains">Website domains</label><input type="text" id="domains" name="domains" maxlength="300" value="${esc((p.domains || []).join(', '))}"></div>
<div class="field"><label for="rivals">Rivals, one per line: name, website</label><textarea id="rivals" name="rivals">${esc(rivalLines(p))}</textarea></div>
<div class="cols" style="gap:12px"><div class="field"><label for="country">Customers in</label><select id="country" name="country">${options(COUNTRIES, p.country || '')}</select></div>
<div class="field"><label for="language">Question language</label><select id="language" name="language">${options(LANGS, p.language || 'en')}</select></div></div>
<h3 style="margin-top:6px">Business details for structured data</h3><p class="tiny muted">Used in the Organization schema on your homepage. Leave empty what you do not want to publish.</p>
<div class="field"><label for="btype">Type of business</label><select id="btype" name="btype">${options(BUSINESS_TYPES, biz.type || 'Organization')}</select></div>
<div class="cols" style="gap:12px"><div class="field"><label for="phone">Phone</label><input type="tel" id="phone" name="phone" maxlength="40" value="${esc(biz.phone || '')}"></div><div class="field"><label for="bemail">Public email</label><input type="email" id="bemail" name="bemail" maxlength="120" value="${esc(biz.email || '')}"></div></div>
<div class="field"><label for="street">Street address</label><input type="text" id="street" name="street" maxlength="160" value="${esc(biz.street || '')}"></div>
<div class="cols" style="gap:12px"><div class="field"><label for="city">City</label><input type="text" id="city" name="city" maxlength="80" value="${esc(biz.city || '')}"></div><div class="field"><label for="bcountry">Country</label><input type="text" id="bcountry" name="bcountry" maxlength="60" value="${esc(biz.country || '')}"></div></div>
<div class="actions"><button class="btn primary" type="submit">Save</button></div></form>
<div class="panel stack"><h2>Tracking</h2><p class="small muted">${site.tracked ? `Checked automatically ${limits.plan === 'free' ? 'every month' : 'every week'}${site.sched.nextRunAt ? ', next ' + until(site.sched.nextRunAt) : ''}.` : (site.pausedByUser ? 'Paused. Nothing is checked until you resume.' : 'Waiting for a free slot in your plan.')}</p>
<form method="post" action="/app/site/track"><input type="hidden" name="id" value="${id}"><input type="hidden" name="on" value="${site.tracked ? '0' : '1'}"><button class="btn" type="submit">${site.tracked ? 'Pause tracking' : 'Resume tracking'}</button></form>
<h3 style="margin-top:8px">Client report link</h3><p class="small muted">A read-only page with the score, the trend and the answer grid. Anyone with the link can open it.</p>
${site.settings.reportToken ? `<pre class="copy">${esc((process.env.APP_URL || '').replace(/\/+$/, '') + '/r/' + site.settings.reportToken)}</pre>` : ''}
<form method="post" action="/app/site/report" class="actions"><input type="hidden" name="id" value="${id}">${site.settings.reportToken ? '<button class="btn sm" name="action" value="rotate" type="submit">Replace the link</button>' : '<button class="btn sm" type="submit">Create a report link</button>'}</form>
<h3 style="margin-top:8px">Remove this site</h3><p class="small muted">Deletes its questions, answers and audit from AI SEO Deck. Nothing changes in Webflow.</p>
<form method="post" action="/app/site/remove" onsubmit="return this.querySelector('[name=sure]').checked"><input type="hidden" name="id" value="${id}"><label class="check"><input type="checkbox" name="sure" value="1"> I want to remove ${esc(site.name)}</label><button class="btn sm danger" type="submit" style="margin-top:10px">Remove site</button></form></div>
</div>`;
}

function sitePage(user, site, d) {
  const id = encodeURIComponent(site.id);
  const tab = d.tab || 'answers';
  const prompts = d.prompts || [];
  const engines = d.engines || [];
  const results = d.results || {};
  const states = statesOf(prompts, engines, results);
  let body = '';
  if (tab === 'answers') body = `<div class="panel">${gridHtml(site, prompts, engines, results, `/app/site?id=${id}&tab=transcripts`, d.locked)}</div>`;
  else if (tab === 'transcripts') body = transcriptsHtml(site, prompts, engines, results);
  else if (tab === 'rivals') body = gapsHtml(site, site.latest);
  else if (tab === 'sources') body = sourcesHtml(site.latest);
  else if (tab === 'audit') body = auditHtml(site, d.audit, d.limits);
  else body = setupTab(site, d.limits, d);
  const canManual = d.canRun;
  const runBtn = site.sched && site.sched.runId ? '' : `<form method="post" action="/app/site/run"><input type="hidden" name="id" value="${esc(site.id)}"><button class="btn primary" type="submit"${canManual.ok ? '' : ' disabled'}>Run a check now</button></form>`;
  const meta = [hostOf(site.url)];
  if (site.latest) meta.push('checked ' + ago(site.latest.finishedAt || site.latest.at));
  if (site.tracked && site.sched.nextRunAt && !site.sched.runId) meta.push('next check ' + until(site.sched.nextRunAt));
  return layout(site.name + ' · AI SEO Deck', `${d.notice ? `<div class="notice">${d.notice}</div>` : ''}${progressHtml(site, d.progress)}
<div class="sitehead"><div><h1>${esc(site.project.brand || site.name)}</h1><p class="meta">${meta.map(esc).join(', ')}</p></div><div class="actions">${runBtn}${!canManual.ok && canManual.why ? `<span class="tiny muted" style="max-width:260px">${esc(canManual.why)}</span>` : ''}</div></div>
${summaryHtml(site, site.latest, states, d.prev)}
${site.latest ? `<div class="duo"><div class="panel stack" style="gap:14px;align-content:start">${trendPanel(d.history, site)}</div><div class="panel stack" style="gap:10px">${insightsHtml(site.latest)}</div><div class="panel stack" style="gap:12px">${voiceHtml(site.latest)}</div></div>` : ''}
${tabsHtml(site, tab)}
${body}`, { user, script: site.sched && site.sched.runId ? PUMP(site.id) : '' });
}

/* ---------- fix page ---------- */

function counter(id, min, max) {
  return `<span class="hint" data-count="${id}" data-min="${min}" data-max="${max}"></span>`;
}
const COUNT_JS = `document.querySelectorAll('[data-count]').forEach(function(h){var i=document.getElementById(h.dataset.count);if(!i)return;function u(){var n=i.value.length;h.textContent=n+' characters, aim for '+h.dataset.min+' to '+h.dataset.max;h.style.color=(n<+h.dataset.min||n>+h.dataset.max)?'var(--warn)':'var(--muted)';}i.addEventListener('input',u);u();});
document.querySelectorAll('[data-copy]').forEach(function(b){b.addEventListener('click',function(){var t=document.getElementById(b.dataset.copy);var v=t.value||t.textContent;if(navigator.clipboard){navigator.clipboard.writeText(v).then(function(){b.textContent='Copied';},function(){t.select&&t.select();});}else if(t.select){t.select();}});});`;

function faqText(pairs) { return (pairs || []).map((x) => 'Q: ' + x.q + '\nA: ' + x.a).join('\n\n'); }

function fixPage(user, site, row, d) {
  const id = esc(site.id);
  const path = esc(row.path);
  const draft = d.draft || {};
  const meta = draft.meta || {};
  const lockNote = d.limits.canApply ? '' : '<p class="tiny muted">Applying to Webflow is part of the paid plans. You can copy the values on the free plan.</p>';
  const applyBtn = (label) => `<button class="btn primary" type="submit"${d.limits.canApply ? '' : ' disabled'}>${label}</button>`;
  const faqPairs = draft.faq && draft.faq.length ? draft.faq : (row.faq || []);
  const existingTypes = d.existingTypes || [];
  return layout('Fix ' + row.path + ' · AI SEO Deck', `${d.notice ? `<div class="notice">${d.notice}</div>` : ''}
<div class="sitehead"><div><h1>${row.path === '/' ? 'Fix the homepage' : 'Fix ' + esc(row.path)}</h1><p class="meta">${esc(site.name)}, page score ${row.score == null ? '-' : row.score}/100. Changes go to Webflow as unpublished edits: publish the site to make them live.</p></div><div class="actions"><a class="btn ghost" href="/app/site?id=${encodeURIComponent(site.id)}&tab=audit">Back to the audit</a></div></div>
<div class="stack">
<section class="panel stack"><h2>Title and description</h2><p class="small muted">What search engines and AI assistants read first about this page.</p>
<div class="cols"><div class="stack" style="gap:6px"><b class="small">Now</b><p>${esc(row.title || '(no title)')}</p><p class="small muted">${esc(row.description || '(no description)')}</p></div>
<form method="post" action="/app/fix/meta" class="fields"><input type="hidden" name="id" value="${id}"><input type="hidden" name="path" value="${path}">
<div class="field"><label for="mt">New title</label><input type="text" id="mt" name="title" maxlength="90" value="${esc(meta.title || row.title || '')}">${counter('mt', 35, 60)}</div>
<div class="field"><label for="md">New description</label><textarea id="md" name="description" style="min-height:90px" maxlength="200">${esc(meta.description || row.description || '')}</textarea>${counter('md', 120, 155)}</div>
<div class="actions">${applyBtn('Apply to Webflow')}</div>${lockNote}</form></div>
<form method="post" action="/app/fix/suggest" class="actions"><input type="hidden" name="id" value="${id}"><input type="hidden" name="path" value="${path}"><input type="hidden" name="what" value="meta"><button class="btn sm" type="submit">${meta.title ? 'Write another suggestion' : 'Write a suggestion with AI'}</button></form></section>

<section class="panel stack"><h2>Questions and answers</h2><p class="small muted">${row.faq && row.faq.length ? `We found ${plural(row.faq.length, 'question')} answered on this page.` : 'No questions were found on this page.'} Clear answers to real questions are what AI assistants quote.</p>
<form method="post" action="/app/fix/faq" class="fields"><input type="hidden" name="id" value="${id}"><input type="hidden" name="path" value="${path}">
<div class="field"><label for="faq">Questions and answers (Q: and A: lines)</label><textarea id="faq" name="faq" style="min-height:220px" placeholder="Q: How long does delivery take?&#10;A: Most orders arrive in 2 to 4 working days.">${esc(faqText(faqPairs))}</textarea><span class="hint">Every answer should also be visible on the page itself.</span></div>
<div class="actions"><button class="btn" name="action" value="save" type="submit">Save and use in the schema below</button>${d.collections && d.collections.length ? `<select name="collection" aria-label="CMS collection" style="width:auto">${d.collections.map((c) => `<option value="${esc(c.id)}">${esc(c.displayName || c.slug)}</option>`).join('')}</select><button class="btn" name="action" value="cms" type="submit"${d.limits.canApply ? '' : ' disabled'}>Add to CMS as drafts</button>` : ''}</div></form>
<form method="post" action="/app/fix/suggest" class="actions"><input type="hidden" name="id" value="${id}"><input type="hidden" name="path" value="${path}"><input type="hidden" name="what" value="faq"><button class="btn sm" type="submit">Write answers with AI from this page</button></form></section>

<section class="panel stack"><h2>Structured data (JSON-LD)</h2><p class="small muted">${existingTypes.length ? 'This page already has: ' + esc(existingTypes.join(', ')) + '. We keep those and add or replace only the types below.' : 'This page has no structured data yet.'}</p>
<form method="post" action="/app/fix/schema" class="fields"><input type="hidden" name="id" value="${id}"><input type="hidden" name="path" value="${path}">
<div class="field"><label for="schema">What will be written to Webflow</label><textarea id="schema" name="schema" class="code" spellcheck="false">${esc(JSON.stringify(d.proposedSchema || {}, null, 2))}</textarea>${row.path === '/' ? '<span class="hint">Business details come from Setup. Change them there and come back.</span>' : ''}</div>
<div class="actions">${applyBtn('Apply to Webflow')}<button class="btn ghost" type="button" data-copy="schema">Copy</button></div>${lockNote}</form></section>
</div>`, { user, script: COUNT_JS });
}

/* ---------- account settings ---------- */

function settingsPage(user, sites, limits, notice, opts) {
  opts = opts || {};
  const b = user.billing || {};
  const planCards = [['free', FREE]].concat(Object.entries(PLANS)).map(([k, p]) => {
    const current = limits.plan === k;
    const price = k === 'free' ? '$0' : '$' + p.monthly;
    const btn = k === 'free' || current ? '' : (opts.billing ? `<form method="post" action="/app/billing/checkout" class="actions"><input type="hidden" name="plan" value="${k}"><button class="btn ${k === 'solo' ? 'mark' : ''} sm" name="interval" value="monthly" type="submit">Monthly</button><button class="btn sm" name="interval" value="yearly" type="submit">Yearly, 2 months free</button></form>` : '');
    return `<div class="plan${current ? ' current' : ''}"><b>${esc(p.name)}${current ? ' <span class="pill good">Your plan</span>' : ''}</b><span class="price">${price}<span class="small muted" style="font-weight:500">${k === 'free' ? '' : ' a month'}</span></span>
<span class="small">${plural(p.sites, 'site')}, ${plural(p.prompts, 'question')}</span><span class="small muted">${k === 'free' ? 'Checked monthly on one engine. Audit and suggestions; apply by copying.' : 'Checked weekly on ChatGPT, Perplexity and Gemini. One-click fixes to Webflow.'}${k === 'studio' || k === 'agency' ? ' Client report links with your agency name.' : ''}</span>${btn}</div>`;
  }).join('');
  const conns = (user.connections || []).map((c) => `<li><span>${esc(c.label || 'Webflow')}<span class="tiny muted">, connected ${ago(c.authorizedAt)}</span></span><form method="post" action="/app/connection/remove"><input type="hidden" name="id" value="${esc(c.id)}"><button class="btn sm ghost" type="submit">Disconnect</button></form></li>`).join('');
  return layout('Settings · AI SEO Deck', `${notice ? `<div class="notice">${notice}</div>` : ''}
<div class="sitehead"><div><h1>Settings</h1><p class="meta">${esc(user.email)}</p></div></div>
<div class="stack">
<section class="panel stack" id="plan"><h2>Plan</h2>
${limits.complimentary ? '<p class="notice good">Your account has complimentary Agency access.</p>' : ''}
${b.subscriptionId ? `<p class="small">Subscription: <b>${esc(b.status || '')}</b>${b.renewsAt ? ', renews ' + esc(String(b.renewsAt).slice(0, 10)) : ''}${b.endsAt && !b.renewsAt ? ', ends ' + esc(String(b.endsAt).slice(0, 10)) : ''}. <a href="/app/billing/portal">Manage billing</a></p>` : ''}
${opts.billing ? '' : '<p class="small muted">Paid plans open soon. Write to info@silitlabs.com if you need more now.</p>'}
<div class="plans">${planCards}</div><p class="tiny muted">Payments are handled by ${esc(opts.providerName || 'Polar')}. Prices in US dollars; taxes may apply.</p></section>
<form class="panel stack" method="post" action="/app/settings"><h2>Emails and reports</h2>
<div class="field"><label for="reportEmail">Send reports to</label><input type="email" id="reportEmail" name="reportEmail" maxlength="254" value="${esc((user.settings && user.settings.reportEmail) || user.email || '')}"></div>
<label class="check"><input type="checkbox" name="digest" value="1"${user.settings && user.settings.digest ? ' checked' : ''}> Email me after every scheduled check</label>
<div class="field"><label for="agency">Agency name on client report links</label><input type="text" id="agency" name="agency" maxlength="80" value="${esc((user.settings && user.settings.brand) || '')}"${limits.whiteLabel ? '' : ' disabled'}><span class="hint">${limits.whiteLabel ? 'Replaces the AI SEO Deck name on report pages.' : 'Available on Studio and Agency.'}</span></div>
<div class="actions"><button class="btn primary" type="submit">Save</button></div></form>
<section class="panel stack"><h2>Webflow connections</h2><ul class="plain">${conns || '<li class="muted">None.</li>'}</ul><div class="actions"><a class="btn" href="/auth">Connect more sites</a></div></section>
<section class="panel stack"><h2>Delete account</h2><p class="small muted">Cancels a paid plan at the end of its period, revokes Webflow access and deletes everything we stored. Changes already applied to your Webflow sites stay.</p>
<form method="post" action="/app/delete" onsubmit="return this.querySelector('[name=sure]').checked"><label class="check"><input type="checkbox" name="sure" value="1"> Delete my account and all its data</label><button class="btn danger sm" type="submit" style="margin-top:10px">Delete account</button></form></section>
</div>`, { user });
}

/* ---------- public client report ---------- */

function reportPage(owner, site, d) {
  const brandName = owner && owner.settings && owner.settings.brand && d.whiteLabel ? owner.settings.brand : '';
  const prompts = d.prompts || [];
  const engines = d.engines || [];
  const results = d.results || {};
  const states = statesOf(prompts, engines, results);
  const trend = site.latest ? `<div class="duo"><div class="panel stack" style="gap:14px;align-content:start">${trendPanel(d.history, site)}</div><div class="panel stack" style="gap:10px">${insightsHtml(site.latest)}</div><div class="panel stack" style="gap:12px">${voiceHtml(site.latest)}</div></div>` : '';
  return layout('AI visibility report · ' + (site.project.brand || site.name), `<div class="sitehead"><div><h1>AI visibility of ${esc(site.project.brand || site.name)}</h1><p class="meta">${esc(hostOf(site.url))}${site.latest ? ', checked ' + esc(new Date(site.latest.finishedAt || site.latest.at).toISOString().slice(0, 10)) : ''}</p></div></div>
${summaryHtml(site, site.latest, states, d.prev)}
<div class="stack">${trend}<div class="panel"><h2 style="margin-bottom:14px">Answer grid</h2>${gridHtml(site, prompts, engines, results, '')}</div></div>`,
  { plain: true, brandName: brandName || '', footer: brandName ? `<span>Prepared by ${esc(brandName)}</span>` : '<span>Made with AI SEO Deck</span><a href="/">aiseodeck.silitlabs.com</a>' });
}

module.exports = { esc, layout, errorPage, loginPage, loginConfirm, dashboard, setupPage, sitePage, fixPage, settingsPage, reportPage, ringSvg, gridHtml, highlight, cellState, statesOf, BUSINESS_TYPES, COUNTRIES, LANGS };
