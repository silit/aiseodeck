'use strict';
// Server-rendered pages, in the same look as the home page: Archivo and Martian Mono, dark by default with a
// light theme. Colours carry meaning everywhere: marker yellow = the brand was named, blue = the brand's site was
// cited, rose = a rival took the place.
const { PLANS, FREE, QUESTIONS } = require('./plans');
const { LABEL, LONG, ORDER } = require('./engines');
const { PAGE_RULES, BOTS } = require('./audit');
const { engineCounts, verdict } = require('./analyze');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x) => Math.round((x || 0) * 100) + '%';
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');
const num = (n) => (n == null ? '' : Number(n).toLocaleString('en-US'));

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
const SHORT = { openai: 'GPT', aio: 'AIO', aimode: 'Mode', gemini: 'Gemini', perplexity: 'Pplx', claude: 'Claude', grok: 'Grok' };
const siteHref = (site, extra) => '/app/site?id=' + encodeURIComponent(site.id) + (extra ? '&' + extra : '');
const kwHref = (site, k, extra) => '/app/keyword?id=' + encodeURIComponent(site.id) + '&k=' + encodeURIComponent(k.id) + (extra ? '&' + extra : '');

const CSS = `
:root{--bg:#1E2336;--bg2:#22283C;--panel:#272E45;--panel2:#2D3550;--lift:#343C59;--line:#3A4363;--line2:#313957;--ink:#E3E6F1;--muted:#A4AAC4;--faint:#8087A6;
--mark:#F3D46E;--mark-ink:#2A2200;--mark-ring:transparent;--mark-text:#F3D46E;--cite:#93B3F2;--cite-soft:rgba(147,179,242,.15);--rival:#EE9DB0;--good:#74D3AA;--good-soft:rgba(116,211,170,.14);--bad:#EE8C8C;--bad-soft:rgba(238,140,140,.14);--warn:#EDC57A;--warn-soft:rgba(237,197,122,.14);
--shadow:0 24px 60px -36px rgba(8,10,25,.6);--sans:"Archivo","Archivo Variable",system-ui,-apple-system,"Segoe UI",Arial,sans-serif;--mono:"Martian Mono","Martian Mono Variable",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color-scheme:dark}
@media (prefers-color-scheme:light){:root{--bg:#F3F5FB;--bg2:#ECEFF8;--panel:#FFFFFF;--panel2:#F7F8FD;--lift:#E8EBF8;--line:#D9DEEE;--line2:#E6E9F4;--ink:#0F1433;--muted:#535A7E;--faint:#868CAE;
--mark:#FFE14D;--mark-ink:#1B1600;--mark-ring:rgba(27,22,0,.18);--mark-text:#8F6E00;--cite:#2F5BFF;--cite-soft:#E6ECFF;--rival:#C2335A;--good:#138A5A;--good-soft:#E2F5EB;--bad:#C93C34;--bad-soft:#FBE8E6;--warn:#9A6400;--warn-soft:#FFF3D6;--shadow:0 24px 60px -36px rgba(15,20,51,.35);color-scheme:light}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 var(--sans);-webkit-font-smoothing:antialiased;padding-bottom:56px}
body::before{content:"";position:fixed;inset:0 0 auto;height:env(safe-area-inset-top,0px);z-index:30;background:var(--bg)}
.wrap{max-width:1240px;margin:0 auto;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
a{color:var(--cite);text-underline-offset:3px}
:focus-visible{outline:2px solid var(--mark);outline-offset:2px;border-radius:6px}
h1,h2,h3{margin:0;line-height:1.1;text-wrap:balance;font-stretch:110%}
h1{font-size:clamp(28px,3.4vw,40px);font-weight:800;letter-spacing:-.03em}
h2{font-size:20px;font-weight:760;letter-spacing:-.02em}
h3{font-size:16px;font-weight:700;letter-spacing:-.01em;font-stretch:104%}
p{margin:0}
.muted{color:var(--muted)}.faint{color:var(--faint)}.small{font-size:13.5px}.tiny{font-size:12.5px}
.mono{font-family:var(--mono);font-stretch:87.5%;font-size:.88em;letter-spacing:-.01em}
.top{position:sticky;top:env(safe-area-inset-top,0px);z-index:20;background:color-mix(in srgb,var(--bg) 86%,transparent);backdrop-filter:saturate(1.4) blur(14px);-webkit-backdrop-filter:saturate(1.4) blur(14px);border-bottom:1px solid var(--line2);margin-bottom:30px}
.top .wrap{display:flex;justify-content:space-between;align-items:center;gap:14px;padding-top:12px;padding-bottom:12px}
.brand{display:inline-flex;align-items:center;gap:10px;font-weight:800;font-size:17px;letter-spacing:-.02em;color:var(--ink);text-decoration:none;font-stretch:112%;white-space:nowrap}
.logo{width:26px;height:26px;flex:none}
.top nav{display:flex;gap:20px;font-size:14.5px;font-weight:600;align-items:center}.top nav a{color:var(--muted);text-decoration:none;white-space:nowrap}.top nav a:hover,.top nav a[aria-current=page]{color:var(--ink)}
.btn{font:inherit;font-weight:700;font-size:14.5px;border-radius:11px;padding:10px 16px;cursor:pointer;border:1px solid var(--line);background:var(--panel);color:var(--ink);text-decoration:none;display:inline-flex;gap:8px;align-items:center;justify-content:center;line-height:1.2;transition:background .15s,border-color .15s}
.btn:hover{border-color:var(--faint);background:var(--panel2)}
.btn.primary{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.btn.mark{background:var(--mark);color:var(--mark-ink);border-color:var(--mark)}
.btn.mark:hover{filter:brightness(1.06)}
.btn.ghost{background:transparent}
.btn.danger{color:var(--bad)}
.btn.sm{padding:7px 12px;font-size:13px;border-radius:9px}
.btn[disabled]{opacity:.45;cursor:not-allowed}
.actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:22px;min-width:0}
.stack{display:grid;gap:16px;align-content:start}
.notice{border-radius:12px;padding:13px 16px;background:var(--cite-soft);margin-bottom:18px;font-size:14.5px;border:1px solid transparent}
.notice.bad{background:var(--bad-soft)}.notice.warn{background:var(--warn-soft)}.notice.good{background:var(--good-soft)}
.pill{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;border-radius:999px;padding:3px 10px;background:var(--lift);color:var(--muted);white-space:nowrap;border:1px solid transparent}
.pill.good{background:var(--good-soft);color:var(--good)}.pill.bad{background:var(--bad-soft);color:var(--bad)}.pill.warn{background:var(--warn-soft);color:var(--warn)}
.pill.named{background:var(--mark);color:var(--mark-ink)}.pill.cite{background:var(--cite-soft);color:var(--cite)}.pill.none{background:transparent;border-color:var(--line);color:var(--muted)}.pill.na{background:transparent;border:1px dashed var(--line);color:var(--faint)}
.fields{display:grid;gap:16px}.field{display:grid;gap:6px;min-width:0}
label{font-size:13.5px;font-weight:700}
.hint{font-size:12.5px;color:var(--muted)}
input[type=text],input[type=email],input[type=url],input[type=tel],input[type=search],select,textarea{width:100%;font:inherit;font-size:14.5px;color:var(--ink);background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:10px 12px}
input:focus,select:focus,textarea:focus{border-color:var(--cite);outline:none}
textarea{min-height:110px;resize:vertical;line-height:1.5}
textarea.code{font-family:var(--mono);font-stretch:87.5%;font-size:12px;min-height:220px}
.check{display:flex;gap:10px;align-items:flex-start;font-size:14.5px;font-weight:400}.check input{margin-top:4px;accent-color:var(--cite);width:16px;height:16px;flex:none}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px;align-items:start}
footer{margin-top:56px;padding-top:18px;border-top:1px solid var(--line2);font-size:13px;color:var(--faint);display:flex;flex-wrap:wrap;gap:8px 22px}
footer a{color:var(--muted)}
.empty{padding:40px 22px;text-align:center;display:grid;gap:12px;justify-items:center}
.empty p{max-width:54ch;color:var(--muted)}
.head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:14px 20px;margin-bottom:22px}
.head .meta{color:var(--muted);font-size:14px;margin-top:8px;display:flex;flex-wrap:wrap;gap:4px 16px}
.back{display:inline-flex;align-items:center;gap:6px;font-size:13.5px;font-weight:600;color:var(--muted);text-decoration:none;margin-bottom:12px}
.back:hover{color:var(--ink)}

/* stat strip */
.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));background:var(--panel);border:1px solid var(--line);border-radius:18px;margin-bottom:24px;overflow:hidden}
.stat{padding:18px 20px;display:grid;gap:6px;align-content:start;border-left:1px solid var(--line2);min-width:0}
.stat:first-child{border-left:0}
.stat .k{font-size:13px;color:var(--muted);font-weight:600}
.stat .v{font-size:34px;font-weight:800;letter-spacing:-.035em;line-height:1;font-stretch:115%;font-variant-numeric:tabular-nums}
.stat .v small{font-size:17px;color:var(--faint);font-weight:700;letter-spacing:-.01em}
.stat .s{font-size:13px;color:var(--muted)}
.stat .s b{font-weight:700}
.up{color:var(--good);font-weight:700}.down{color:var(--bad);font-weight:700}.flat{color:var(--faint);font-weight:700}
@media(max-width:900px){.stats{grid-template-columns:repeat(2,minmax(0,1fr))}.stat:nth-child(3){border-left:0}.stat:nth-child(n+3){border-top:1px solid var(--line2)}}

/* tabs */
.tabs{display:flex;gap:2px;border-bottom:1px solid var(--line2);margin-bottom:22px;overflow-x:auto;scrollbar-width:none}
.tabs a{padding:11px 14px;font-weight:700;font-size:14.5px;color:var(--muted);text-decoration:none;border-bottom:2px solid transparent;white-space:nowrap}
.tabs a:hover{color:var(--ink)}
.tabs a[aria-current=page]{color:var(--ink);border-bottom-color:var(--mark)}

/* the deck: one row per keyword, one column per engine */
.addkw{display:flex;gap:10px;align-items:center;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:8px 8px 8px 16px;margin-bottom:14px;flex-wrap:wrap}
.addkw svg{color:var(--faint);flex:none}
.addkw input{flex:1 1 240px;border:0;background:transparent;padding:8px 0;font-size:16px;font-weight:600}
.addkw input:focus{border:0}
.addkw .hint{flex-basis:100%;padding:0 0 6px}
.deck{background:var(--panel);border:1px solid var(--line);border-radius:18px;overflow-x:auto}
table.kt{border-collapse:collapse;width:100%;min-width:860px;font-variant-numeric:tabular-nums}
.kt th{font-size:12.5px;color:var(--faint);font-weight:600;text-align:center;padding:14px 6px 12px;white-space:nowrap}
.kt th.l,.kt td.k{text-align:left;padding-left:20px}
.kt th:last-child,.kt td:last-child{padding-right:20px}
.kt th.r,.kt td.r{text-align:right}
.kt th.lock{color:var(--faint);font-weight:500}
.kt td{border-top:1px solid var(--line2);padding:13px 6px;text-align:center;font-size:14.5px}
.kt tbody tr{transition:background .12s}
.kt tbody tr:hover{background:var(--panel2)}
.kt td.k{font-weight:700;font-size:15px}
.kt td.k a{color:var(--ink);text-decoration:none}
.kt td.k a:hover{text-decoration:underline;text-decoration-color:var(--faint)}
.kt td.k .sub{display:block;font-weight:500;font-size:12.5px;color:var(--faint);margin-top:2px}
.kt td.vol{color:var(--muted);text-align:right}
.c{width:14px;height:14px;border-radius:50%;display:inline-block;vertical-align:middle}
.c.st-n{background:var(--mark);box-shadow:0 0 0 1px var(--mark-ring)}
.c.st-b{background:var(--mark);box-shadow:0 0 0 3px var(--panel),0 0 0 5px var(--cite)}
.c.st-i{box-shadow:inset 0 0 0 2.5px var(--cite)}
.c.st-o{width:6px;height:6px;background:var(--faint);opacity:.75}
.c.st-x{width:12px;height:2px;border-radius:2px;background:var(--line)}
.c.st-f{width:12px;height:12px;border:1.5px dashed var(--faint)}
.c.st-w{width:8px;height:8px;background:var(--line)}
.c.st-run{width:8px;height:8px;background:var(--cite);animation:pulse 1.4s ease-in-out infinite}
.c.st-lock{width:auto;height:auto;border-radius:0;color:var(--faint)}
@keyframes pulse{50%{opacity:.3}}
.vis{display:inline-flex;align-items:center;gap:10px;justify-content:flex-end;font-weight:700}
.vis i{display:block;width:60px;height:6px;border-radius:999px;background:var(--line2);overflow:hidden;position:relative}
.vis i::after{content:"";position:absolute;inset:0;width:var(--w);background:var(--mark);border-radius:inherit}
.trend{display:inline-flex;align-items:center;gap:8px;justify-content:flex-end;font-size:13px}
.legend{display:flex;flex-wrap:wrap;gap:8px 20px;font-size:13px;color:var(--muted);margin-top:14px}
.legend span{display:inline-flex;align-items:center;gap:8px}
.upsell{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;background:var(--panel);border:1px dashed var(--line);border-radius:14px;padding:12px 16px;margin-top:14px;font-size:14px}
@media(max-width:700px){
  .deck{overflow:visible}
  table.kt{min-width:0}
  .kt thead{display:none}
  .kt tbody,.kt tr{display:block}
  .kt tr{display:flex;flex-wrap:wrap;align-items:center;padding:15px 16px 13px;border-top:1px solid var(--line2)}
  .kt tr:first-child{border-top:0}
  .kt tr::before{content:"";flex-basis:100%;height:0;order:2}
  .kt td{border:0;padding:0}
  .kt td.k{order:1;flex:1 1 0;min-width:0;padding:0 12px 12px 0}
  .kt td.vol{order:1;margin-left:auto;padding:0 0 12px;font-size:13px}
  .kt td.vol:not(:empty)::after{content:" a month"}
  .kt td[data-e]{order:3;flex:1 0 0;display:grid;grid-template-rows:18px auto;justify-items:center;align-items:center;gap:4px;padding-bottom:12px}
  .kt td[data-e]::after{content:attr(data-e);font-size:10.5px;color:var(--faint);font-weight:600;white-space:nowrap}
  .kt td.visc{order:4;flex:1 1 50%;text-align:left}
  .kt td.visc .vis{justify-content:flex-start}
  .kt td.tr{order:4;flex:1 1 50%}
}

/* keyword page */
.verdict{display:grid;grid-template-columns:auto minmax(0,1fr) minmax(220px,340px);gap:18px 28px;align-items:center;padding:22px;margin-bottom:22px}
.big{font-size:64px;line-height:.9;font-weight:820;letter-spacing:-.045em;font-stretch:118%;font-variant-numeric:tabular-nums}
.big small{font-size:28px;color:var(--faint);font-weight:700;letter-spacing:-.02em}
.verdict.yes .big{color:var(--mark-text)}
.vt{display:grid;gap:8px;min-width:0}
.vt strong{font-size:20px;font-weight:750;letter-spacing:-.015em;font-stretch:106%}
.facts{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:14px;color:var(--muted)}
.facts b{color:var(--ink);font-weight:700}
@media(max-width:900px){.verdict{grid-template-columns:auto minmax(0,1fr)}.verdict .chart{grid-column:1/-1}}
.lanes{list-style:none;margin:0;padding:0}
.lane{border-top:1px solid var(--line2);padding:16px 0}
.lane:first-child{border-top:0;padding-top:4px}
.lane .lh{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.lane .lh b{font-size:15px;min-width:110px}
.sig{width:10px;height:10px;border-radius:50%;background:var(--line);flex:none}
.sig.st-b,.sig.st-n{background:var(--mark);box-shadow:0 0 0 4px rgba(243,212,110,.14)}
.sig.st-i{background:transparent;box-shadow:inset 0 0 0 2.5px var(--cite)}
.sig.st-o{background:transparent;box-shadow:inset 0 0 0 2px var(--faint)}
.answer{display:grid;gap:7px;padding:10px 0 10px 20px;border-left:2px solid var(--line2);margin-left:4px}
.answer + .answer{margin-top:8px}
.answer .ask{font-size:13px;color:var(--faint);font-weight:600}
.answer .ask b{color:var(--muted);font-weight:600}
.quote{font-size:15px;line-height:1.6;max-width:80ch}
mark{color:var(--mark-ink);padding:0 2px;border-radius:3px;background:var(--mark)}
.rival-name{color:var(--rival);text-decoration:underline dotted 1.5px;text-underline-offset:3px}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{font-size:12.5px;border:1px solid var(--line);border-radius:999px;padding:2px 10px;color:var(--muted);text-decoration:none;white-space:nowrap;max-width:280px;overflow:hidden;text-overflow:ellipsis;background:transparent}
a.chip:hover{color:var(--ink);border-color:var(--faint)}
.chip.own{background:var(--cite-soft);border-color:transparent;color:var(--cite);font-weight:700}
.q{font-family:var(--mono);font-stretch:87.5%;font-size:12px;color:var(--muted);border:1px solid var(--line);border-radius:8px;padding:5px 9px;background:var(--bg)}
details summary{cursor:pointer;font-size:13px;color:var(--muted);font-weight:600}
details[open] summary{margin-bottom:8px}
.grid2{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,.75fr);gap:22px;align-items:start}
@media(max-width:1000px){.grid2{grid-template-columns:1fr}}

/* fix plan */
.plan-card{padding:0;overflow:hidden}
.plan-head{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid var(--line2)}
.fx{list-style:none;margin:0;padding:0}
.fx>li{display:grid;grid-template-columns:26px minmax(0,1fr);gap:14px;padding:18px 22px;border-top:1px solid var(--line2)}
.fx>li:first-child{border-top:0}
.tick{width:22px;height:22px;border-radius:7px;border:1.5px solid var(--line);display:grid;place-items:center;margin-top:1px}
.fx>li.done .tick{background:var(--good);border-color:var(--good);color:#06261A}
.fx>li.manual .tick{border-style:dashed}
.fx h3{font-size:15.5px;font-stretch:100%}
.fx p.d{font-size:14px;color:var(--muted);margin-top:4px}
.diff{display:grid;gap:8px;margin-top:12px;font-size:14px}
.diff>div{display:grid;grid-template-columns:64px minmax(0,1fr);gap:10px;align-items:baseline}
.diff span.l{color:var(--faint);font-size:12.5px}
.diff s{color:var(--faint);text-decoration-color:var(--bad)}
.plan-foot{display:flex;flex-wrap:wrap;gap:12px 18px;align-items:center;padding:18px 22px;border-top:1px solid var(--line);background:var(--bg2)}
.plan-foot p{font-size:14px;color:var(--muted);flex:1 1 260px}
.qa{display:grid;gap:4px;padding:8px 0;border-top:1px solid var(--line2);font-size:14px}
.qa:first-child{border-top:0}
.qa b{font-weight:700}
.include{display:flex;gap:8px;align-items:center;font-size:13px;font-weight:600;color:var(--muted);margin-top:10px}
.include input{accent-color:var(--good);width:15px;height:15px}

/* lists */
ul.plain{list-style:none;margin:0;padding:0;display:grid}
ul.plain>li{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:12px 0;border-top:1px solid var(--line2);flex-wrap:wrap}
ul.plain>li:first-child{border-top:0}
.rk{list-style:none;margin:0;padding:0}
.rk li{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:14px;align-items:center;padding:10px 0;border-top:1px solid var(--line2);font-variant-numeric:tabular-nums}
.rk li:first-child{border-top:0}
.rk .kwt{font-weight:600;min-width:0;overflow-wrap:anywhere;line-height:1.35}
.rk .vol{color:var(--muted);font-size:13.5px;text-align:right;white-space:nowrap}
.track{font:inherit;font-size:13px;font-weight:700;border-radius:9px;border:1px solid var(--line);background:var(--bg);color:var(--ink);padding:6px 12px;cursor:pointer;min-width:86px}
.track:hover{border-color:var(--faint)}
.track.on{background:var(--mark);border-color:var(--mark);color:var(--mark-ink);cursor:default}
@media(max-width:560px){.rk li{grid-template-columns:minmax(0,1fr) auto}.rk .vol{grid-column:1;grid-row:2;text-align:left}.rk form,.rk .track{grid-column:2;grid-row:1/span 2}}
.rows{display:grid;gap:10px}
.row{display:grid;grid-template-columns:minmax(110px,180px) 1fr auto;gap:12px;align-items:center;font-size:14px}
.bar{height:8px;border-radius:999px;background:var(--line2);overflow:hidden;display:flex}
.bar i{display:block;height:100%}
.bar i.named{background:var(--mark)}.bar i.cited{background:var(--cite)}.bar i.rival{background:var(--rival);opacity:.8}.bar i.host{background:var(--faint)}
.row .v{color:var(--muted);font-variant-numeric:tabular-nums;font-size:13px;white-space:nowrap}
.row .host{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--mono);font-stretch:87.5%;font-size:12.5px}
.checkrow{display:grid;grid-template-columns:26px 1fr auto;gap:12px;align-items:start;padding:14px 0;border-top:1px solid var(--line2)}
.checkrow:first-child{border-top:0}
.ico{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-size:13px;font-weight:800}
.ico.ok{background:var(--good-soft);color:var(--good)}.ico.no{background:var(--bad-soft);color:var(--bad)}
.tablewrap{overflow-x:auto}
table.list{border-collapse:collapse;width:100%;min-width:720px;font-size:14px}
.list th{font-size:12.5px;color:var(--faint);text-align:left;font-weight:600;padding:0 10px 10px}
.list td{padding:11px 10px;border-top:1px solid var(--line2);vertical-align:top}
.score{font-weight:800;font-variant-numeric:tabular-nums}
.score.low{color:var(--bad)}.score.mid{color:var(--warn)}.score.high{color:var(--good)}
pre.copy{white-space:pre-wrap;word-break:break-word;background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:12px;font-family:var(--mono);font-stretch:87.5%;font-size:12px;margin:0;max-height:320px;overflow:auto}
.sent{display:flex;height:8px;border-radius:999px;overflow:hidden;background:var(--line2)}
.sent i{display:block;height:100%}.sent .pos{background:var(--good)}.sent .neu{background:var(--faint)}.sent .neg{background:var(--bad)}
.checkit{background:var(--warn-soft);border-radius:12px;padding:12px 14px;display:grid;gap:6px}
.checkit ul{margin:0;padding-left:18px;font-size:13.5px;display:grid;gap:4px}
ul.gaps{list-style:none;margin:0;padding:0;display:grid}
ul.gaps li{display:flex;justify-content:space-between;gap:14px;align-items:center;padding:14px 0;border-top:1px solid var(--line2);flex-wrap:wrap}
ul.gaps li:first-child{border-top:0}
.gq{display:grid;gap:3px;min-width:0;flex:1 1 320px}
.gq a{color:var(--ink);font-weight:700;text-decoration:none}
.gq a:hover{text-decoration:underline}
svg.chart{width:100%;height:auto;display:block}
svg.chart .gl{stroke:var(--line2);stroke-width:1}
svg.chart .ax{font-size:11px;fill:var(--faint);font-family:var(--sans)}
svg.chart .ln{fill:none;stroke:var(--mark);stroke-width:2.4;stroke-linejoin:round;stroke-linecap:round}
svg.chart .pt{fill:var(--panel);stroke:var(--mark);stroke-width:1.8}
svg.chart .fut{stroke:var(--faint);stroke-width:1.6;stroke-dasharray:4 5;fill:none}
.progress{height:6px;border-radius:999px;background:var(--line2);overflow:hidden;margin-top:10px}
.progress i{display:block;height:100%;background:var(--cite);transition:width .6s ease}

/* sites */
.sites{display:grid;gap:14px}
.site{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:18px 26px;align-items:center}
.site .nm{display:grid;gap:6px;min-width:0}
.site .nm h2{font-size:19px}
.site .num{text-align:right}
.site .num b{display:block;font-size:30px;font-weight:800;letter-spacing:-.03em;line-height:1;font-stretch:115%}
.engs{display:flex;flex-wrap:wrap;gap:6px 12px;margin-top:4px}
.engs span{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);font-weight:600}
.engs .c{width:10px;height:10px}.engs .c.st-b{box-shadow:0 0 0 2px var(--panel),0 0 0 3.5px var(--cite)}
@media(max-width:640px){.site{grid-template-columns:1fr auto}.site .go{grid-column:1/-1}}

/* setup */
.steps{display:grid;gap:18px}
.step h2{display:flex;gap:12px;align-items:center}
.step h2 span{width:28px;height:28px;border-radius:50%;background:var(--mark);color:var(--mark-ink);display:grid;place-items:center;font-size:14px;flex:none;font-stretch:100%}
.picklist{display:grid;gap:0}
.pick{display:grid;grid-template-columns:20px minmax(0,1fr) auto;gap:12px;align-items:center;padding:10px 0;border-top:1px solid var(--line2);font-size:14.5px;font-weight:400}
.pick:first-child{border-top:0}
.pick input{accent-color:var(--cite);width:16px;height:16px;margin:0}
.pick .vol{color:var(--muted);font-size:13px;white-space:nowrap;font-variant-numeric:tabular-nums}
.pick .src{font-size:11.5px;font-weight:700;color:var(--cite);margin-left:8px}
.plans{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px}
.plan{border:1px solid var(--line);border-radius:16px;padding:18px;display:flex;flex-direction:column;gap:8px;background:var(--bg2)}
.plan.current{border-color:var(--mark);box-shadow:inset 0 0 0 1px var(--mark)}
.plan .price{font-size:28px;font-weight:800;letter-spacing:-.03em;font-stretch:112%}
.plan form{margin-top:auto;padding-top:6px}
@media (prefers-reduced-motion:reduce){.c.st-run{animation:none}.progress i{transition:none}.btn,.kt tbody tr{transition:none}}
`;

const LOGO = `<svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="var(--ink)"/><circle cx="11" cy="11" r="4" fill="var(--mark)"/><circle cx="21" cy="11" r="4" fill="none" stroke="var(--cite)" stroke-width="2.4"/><circle cx="11" cy="21" r="2" fill="var(--faint)"/><circle cx="21" cy="21" r="4" fill="var(--mark)" stroke="var(--cite)" stroke-width="2.4"/></svg>`;
const SEARCH_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
const LOCK = '<svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><rect x="4" y="10" width="16" height="11" rx="3" fill="currentColor"/></svg>';
const CHECK = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
const FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&family=Martian+Mono:wdth,wght@75..112.5,300..600&display=swap">';

function layout(title, body, opts) {
  opts = opts || {};
  const cur = (p) => (opts.nav === p ? ' aria-current="page"' : '');
  const nav = opts.user
    ? `<nav aria-label="Main"><a href="/app"${cur('sites')}>Sites</a><a href="/app/settings"${cur('settings')}>Settings</a><a href="/logout">Sign out</a></nav>`
    : `<nav aria-label="Main"><a href="/">Home</a><a href="/docs">Docs</a><a href="/login">Sign in</a></nav>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${esc(title)}</title>
<meta name="theme-color" content="#1E2336"><link rel="icon" href="/favicon.png">${FONTS}
<style>${CSS}</style></head><body>
<header class="top"><div class="wrap"><a class="brand" href="${opts.user ? '/app' : (opts.brandName ? '#' : '/')}">${opts.brandName ? '' : LOGO}<span>${opts.brandName ? esc(opts.brandName) : 'AI SEO Deck'}</span></a>${opts.plain ? '' : nav}</div></header>
<main class="wrap">${body}
<footer>${opts.footer || '<span>AI SEO Deck by Silit Labs</span><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/docs">Docs</a><span>Not affiliated with Webflow, OpenAI, Google, Perplexity, Anthropic or xAI.</span>'}</footer>
</main>${opts.script ? `<script>${opts.script}</script>` : ''}</body></html>`;
}
const noticeHtml = (n, cls) => (n ? `<div class="notice${cls ? ' ' + cls : ''}" role="status">${n}</div>` : '');

function errorPage(title, message, back) {
  return layout(title, `<div class="panel stack" role="alert" style="max-width:640px"><h1>${esc(title)}</h1><p class="muted">${esc(message)}</p><div class="actions"><a class="btn" href="${esc(back || '/app')}">Go back</a></div></div>`);
}
function loginPage(q) {
  const msg = q.sent ? noticeHtml('If that email belongs to an AI SEO Deck account, a sign in link is on its way. It works once and expires in 15 minutes.', 'good')
    : q.bad ? noticeHtml('That email address does not look right.', 'bad') : '';
  return layout('Sign in · AI SEO Deck', `${msg}<div class="cols">
<div class="panel stack"><h1>Sign in</h1><p class="muted">Enter the email of your Webflow account. We send you a one-time sign in link.</p>
<form method="post" action="/login" class="fields"><div class="field"><label for="email">Email</label><input type="email" id="email" name="email" required autocomplete="email"></div>
<div class="actions"><button class="btn primary" type="submit">Email me a sign in link</button></div></form></div>
<div class="panel stack"><h2>New here?</h2><p class="muted">Connect your Webflow site and add the keywords your customers search for. AI SEO Deck reads only the sites you choose, and writes to Webflow only when you press Apply.</p>
<div class="actions"><a class="btn mark" href="/auth">Connect Webflow</a></div></div></div>`);
}
function loginConfirm(token) {
  return layout('Sign in · AI SEO Deck', `<div class="panel stack" style="max-width:560px"><h1>Sign in to AI SEO Deck</h1><p class="muted">Press the button to finish signing in.</p>
<form method="post" action="/l/${esc(token)}"><button class="btn primary" type="submit">Sign in</button></form></div>`);
}

/* ---------- small pieces ---------- */

const STATE_TEXT = { b: 'Named and your site cited', n: 'Named', i: 'Your site cited, not named', o: 'Not named', x: 'No AI answer on Google', f: 'Could not be read', w: 'Not checked yet', run: 'Checking now' };
function dot(state, engine) {
  const label = (LONG[engine] || engine || '') + ': ' + (STATE_TEXT[state] || state);
  return `<i class="c st-${esc(state)}" role="img" aria-label="${esc(label)}" title="${esc(label)}"></i>`;
}
function sparkline(trend, w, h) {
  const pts = (trend || []).map((p) => p[1]).filter((v) => typeof v === 'number');
  if (pts.length < 2) return '';
  w = w || 60; h = h || 20;
  const min = Math.min(...pts) - 4, max = Math.max(...pts) + 4;
  const d = pts.map((p, i) => (i ? 'L' : 'M') + ((i * w) / (pts.length - 1)).toFixed(1) + ' ' + (h - ((p - min) / (max - min || 1)) * h).toFixed(1)).join(' ');
  const up = pts[pts.length - 1] >= pts[0];
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}" fill="none" stroke="var(--${up ? 'good' : 'bad'})" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
function delta(trend) {
  const t = trend || [];
  if (t.length < 2) return '';
  const d = t[t.length - 1][1] - t[0][1];
  return `<span class="${d > 0 ? 'up' : d < 0 ? 'down' : 'flat'}">${d > 0 ? '+' : ''}${d}</span>`;
}
// A line of visibility over time, 0 to 100%. points: [[at, value]], oldest first.
function lineChart(points, opts) {
  opts = opts || {};
  const pts = (points || []).filter((p) => typeof p[1] === 'number').slice(-12);
  const W = opts.w || 520, H = opts.h || 150, L = 42, R = 12, T = 12, B = 24;
  const y = (v) => T + ((100 - v) * (H - T - B)) / 100;
  const day = (t) => new Date(t).toISOString().slice(5, 10).replace('-', '/');
  const grid = [0, 50, 100].map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="gl"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" class="ax">${v}%</text>`).join('');
  if (!pts.length) return '';
  if (pts.length === 1) {
    const yy = y(pts[0][1]).toFixed(1);
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="First check: ${pts[0][1]}% of answers name you">${grid}<line x1="${L + 10}" x2="${W - R - 8}" y1="${yy}" y2="${yy}" class="fut"/><circle cx="${L + 10}" cy="${yy}" r="5" class="pt"/><text x="${L + 10}" y="${H - 6}" class="ax">First check</text>${opts.next ? `<text x="${W - R}" y="${H - 6}" text-anchor="end" class="ax">Next ${esc(opts.next)}</text>` : ''}</svg>`;
  }
  const x = (i) => L + (i * (W - L - R)) / (pts.length - 1);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p[1]).toFixed(1)}`).join(' ');
  const area = d + ` L${x(pts.length - 1).toFixed(1)} ${H - B} L${x(0).toFixed(1)} ${H - B} Z`;
  const dots = pts.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p[1]).toFixed(1)}" r="${i === pts.length - 1 ? 4.5 : 3}" class="pt"><title>${esc(day(p[0]))}: ${p[1]}%</title></circle>`).join('');
  const gid = 'g' + Math.random().toString(36).slice(2, 8);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Share of answers that name you, from ${pts[0][1]}% to ${pts[pts.length - 1][1]}% over ${pts.length} checks"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--mark);stop-opacity:.32"/><stop offset="1" style="stop-color:var(--mark);stop-opacity:0"/></linearGradient></defs>${grid}<path d="${area}" fill="url(#${gid})"/><path d="${d}" class="ln"/>${dots}<text x="${L}" y="${H - 6}" class="ax">${esc(day(pts[0][0]))}</text><text x="${W - R}" y="${H - 6}" text-anchor="end" class="ax">${esc(day(pts[pts.length - 1][0]))}</text></svg>`;
}
function verdictText(sum, brand) {
  const k = engineCounts(sum);
  const v = verdict(sum);
  if (v === 'none') return 'No AI answer could be read yet.';
  if (v === 'yes') return `Yes. ${k.named} of ${plural(k.answered, 'AI engine')} name ${brand || 'you'}.`;
  if (v === 'some') return `Sometimes. ${k.named} of ${plural(k.answered, 'AI engine')} name ${brand || 'you'}.`;
  return `No. None of the ${plural(k.answered, 'AI engine')} name ${brand || 'you'} yet.`;
}

// Highlights the brand (marker) and rivals (rose) inside an answer, in one pass over the escaped text.
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

/* ---------- the deck ---------- */

// opts: { engines (the plan's engines), locked, link (true on the app, false on public reports), running: [keyword ids being checked] }
function deckTable(site, opts) {
  opts = opts || {};
  const kws = site.keywords || [];
  const engines = (opts.engines || []).slice().sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  const locked = opts.locked || [];
  const running = opts.running || [];
  const head = engines.map((e) => `<th scope="col" title="${esc(LONG[e] || e)}">${esc(LABEL[e] || e)}</th>`).join('')
    + locked.map((e) => `<th scope="col" class="lock" title="${esc(LONG[e] || e)}: paid plans">${LOCK} ${esc(LABEL[e] || e)}</th>`).join('');
  const rows = kws.map((k) => {
    const s = site.kw && site.kw[k.id];
    const checking = running.includes(k.id);
    const cells = engines.map((e) => {
      const st = s && s.eng && s.eng[e] ? s.eng[e] : checking ? 'run' : 'w';
      return `<td data-e="${esc(SHORT[e] || e)}">${dot(st, e)}</td>`;
    }).join('') + locked.map((e) => `<td data-e="${esc(SHORT[e] || e)}"><span class="c st-lock" title="${esc(LONG[e] || e)} is part of the paid plans" aria-label="${esc(LABEL[e])}: paid plans">${LOCK}</span></td>`).join('');
    const vis = s ? Math.round((s.vis || 0) * 100) : null;
    const name = opts.link === false ? esc(k.text) : `<a href="${esc(kwHref(site, k))}">${esc(k.text)}</a>`;
    const sub = k.page ? `<span class="sub">${esc(k.page)}</span>` : '';
    return `<tr><td class="k">${name}${sub}</td><td class="vol r">${k.volume == null ? '' : num(k.volume)}</td>${cells}
<td class="visc r">${vis == null ? `<span class="tiny faint">${checking ? 'Checking' : 'Waiting'}</span>` : `<span class="vis"><i style="--w:${vis}%"></i>${vis}%</span>`}</td>
<td class="tr r"><span class="trend">${s ? sparkline(s.trend) + delta(s.trend) : ''}</span></td></tr>`;
  }).join('');
  const legend = `<div class="legend" aria-hidden="true"><span><i class="c st-n"></i>Named</span><span><i class="c st-b"></i>Named and your site cited</span><span><i class="c st-i"></i>Your site cited, not named</span><span><i class="c st-o"></i>Not named</span>${engines.some((e) => e === 'aio' || e === 'aimode') ? '<span><i class="c st-x"></i>No AI answer on Google</span>' : ''}</div>`;
  const upsell = locked.length ? `<div class="upsell"><p><b>${plural(locked.length, 'more AI engine')}</b> answer for these keywords too: ${locked.map((e) => esc(LONG[e] || e)).join(', ')}.</p>${opts.link === false ? '' : '<a class="btn mark sm" href="/app/settings#plan">See every AI</a>'}</div>` : '';
  return `<div class="deck"><table class="kt"><thead><tr><th scope="col" class="l">Keyword</th><th scope="col" class="r">Searches a month</th>${head}<th scope="col" class="r">Visible</th><th scope="col" class="r">Trend</th></tr></thead><tbody>${rows}</tbody></table></div>${legend}${upsell}`;
}

function statStrip(site, history, limits) {
  const l = site.latest;
  const kws = (site.keywords || []).length;
  const hist = (history || []).filter((h) => typeof h.score === 'number');
  const prev = hist[1];
  const d = l && prev ? l.score - prev.score : null;
  const top = l ? (l.voice || []).filter((v) => !v.own && v.n > 0)[0] : null;
  const trend = hist.slice(0, 8).reverse().map((h) => [h.at, h.score]);
  if (!l) {
    return `<div class="stats"><div class="stat"><span class="k">Visible in AI answers</span><span class="v">-</span><span class="s">${site.sched && site.sched.runId ? 'The first check is running.' : 'No check yet.'}</span></div>
<div class="stat"><span class="k">Keywords</span><span class="v">${kws}<small>/${limits ? limits.keywords : ''}</small></span><span class="s">on your plan</span></div>
<div class="stat"><span class="k">AI engines</span><span class="v">${limits && limits.allEngines ? 7 : 3}</span><span class="s">${limits && limits.allEngines ? 'every week' : 'every month on the free plan'}</span></div>
<div class="stat"><span class="k">How long it takes</span><span class="v">2<small> min</small></span><span class="s">for a few keywords, while this page is open</span></div></div>`;
  }
  return `<div class="stats">
<div class="stat"><span class="k">Visible in AI answers</span><span class="v">${l.score}<small>%</small></span><span class="s">${d == null ? 'of the answers for your keywords' : `<span class="${d > 0 ? 'up' : d < 0 ? 'down' : 'flat'}">${d > 0 ? '+' : ''}${d}</span> since the check before`} ${sparkline(trend, 54, 16)}</span></div>
<div class="stat"><span class="k">Keywords where AI names you</span><span class="v">${l.kwNamed || 0}<small>/${l.keywords || 0}</small></span><span class="s">at least one engine names you</span></div>
<div class="stat"><span class="k">Your site cited</span><span class="v">${Math.round((l.citationRate || 0) * 100)}<small>%</small></span><span class="s">of answers link to your site</span></div>
<div class="stat"><span class="k">Rival named most</span><span class="v" style="font-size:22px;line-height:1.15;padding-top:6px">${top ? esc(top.name) : '-'}</span><span class="s">${top ? `in ${pct(top.share)} of brand mentions` : 'Add rivals in Settings to compare'}</span></div></div>`;
}

/* ---------- sites ---------- */

function siteStatus(site) {
  if (!site.project || !site.project.ready) return '<span class="pill warn">Not set up</span>';
  if (site.sched && site.sched.runId) return '<span class="pill cite">Checking now</span>';
  if (site.tracked) return '<span class="pill good">Tracking</span>';
  if (site.pausedByUser) return '<span class="pill">Paused</span>';
  return '<span class="pill warn">Waiting for a free slot</span>';
}

function dashboard(user, sites, limits, notice, opts) {
  opts = opts || {};
  const now = Date.now();
  const used = sites.reduce((a, s) => a + (s.keywords || []).length, 0);
  const list = sites.length ? sites.map((s) => {
    const l = s.latest;
    const ready = s.project && s.project.ready;
    const bars = l ? ORDER.filter((e) => l.byEngine && l.byEngine[e] && (l.byEngine[e].k || l.byEngine[e].kx)).map((e) => { const b = l.byEngine[e]; const st = b.km ? (b.kc ? 'b' : 'n') : b.kc ? 'i' : b.k ? 'o' : 'x'; return `<span title="${esc(LONG[e])}: names you for ${b.km} of ${plural(b.k, 'keyword')}">${dot(st, e)}${esc(LABEL[e])} ${b.k ? b.km + '/' + b.k : ''}</span>`; }).join('') : '';
    const line = l ? `Named for ${l.kwNamed || 0} of ${plural(l.keywords || 0, 'keyword')}. Checked ${ago(l.finishedAt || l.at, now)}.` : ready ? (s.sched && s.sched.runId ? 'The first check is running.' : 'No check yet.') : 'Add your brand, rivals and keywords to start.';
    return `<div class="panel site"><div class="nm"><div class="actions" style="gap:10px"><h2>${esc(s.name)}</h2>${siteStatus(s)}</div>
<p class="small muted">${esc(hostOf(s.url))}${s.audit ? `, site audit ${s.audit.score}/100` : ''}</p><p class="small">${line}</p>${bars ? `<div class="engs">${bars}</div>` : ''}</div>
<div class="num">${l ? `<b>${l.score}%</b><span class="tiny muted">visible in AI answers</span>` : ''}</div>
<div class="go">${ready ? `<a class="btn" href="${esc(siteHref(s))}">Open</a>` : `<a class="btn mark" href="/app/setup?id=${encodeURIComponent(s.id)}">Set up</a>`}</div></div>`;
  }).join('') : `<div class="panel empty"><h2>No Webflow sites yet</h2><p>Connect Webflow and choose the sites AI SEO Deck may read.</p><a class="btn mark" href="/auth">Connect Webflow</a></div>`;
  const engineNote = opts.enginesOn && !opts.enginesOn.length ? noticeHtml('No AI engine is connected on the server yet, so checks cannot run. If you run this app, add an engine API key.', 'warn') : '';
  return layout('Sites · AI SEO Deck', `${noticeHtml(notice)}${engineNote}
<div class="head"><div><h1>Your sites</h1><p class="meta"><span>${esc(limits.name)} plan</span><span>${used} of ${plural(limits.keywords, 'keyword')} in use</span><span>${limits.plan === 'free' ? 'Checked every month on ChatGPT, Google AI Overviews and Perplexity' : 'Checked every week on every AI engine'}</span></p></div>
<div class="actions"><a class="btn" href="/auth">Add Webflow sites</a>${limits.plan === 'free' ? '<a class="btn mark" href="/app/settings#plan">Upgrade</a>' : ''}</div></div>
<div class="sites">${list}</div>`, { user, nav: 'sites' });
}

/* ---------- setup ---------- */

const COUNTRIES = [['', 'Anywhere'], ['US', 'United States'], ['GB', 'United Kingdom'], ['IE', 'Ireland'], ['CA', 'Canada'], ['AU', 'Australia'], ['DE', 'Germany'], ['FR', 'France'], ['NL', 'Netherlands'], ['ES', 'Spain'], ['IT', 'Italy'], ['TR', 'Türkiye'], ['AE', 'United Arab Emirates'], ['SA', 'Saudi Arabia'], ['PL', 'Poland'], ['SE', 'Sweden'], ['IN', 'India'], ['BR', 'Brazil'], ['MX', 'Mexico']];
const LANGS = [['en', 'English'], ['tr', 'Turkish'], ['de', 'German'], ['fr', 'French'], ['es', 'Spanish'], ['it', 'Italian'], ['nl', 'Dutch'], ['pt', 'Portuguese'], ['pl', 'Polish'], ['ar', 'Arabic'], ['sv', 'Swedish']];
const options = (list, v) => list.map(([k, t]) => `<option value="${esc(k)}"${k === v ? ' selected' : ''}>${esc(t)}</option>`).join('');
const rivalLines = (p) => (p.competitors || []).map((c) => c.name + (c.domain ? ', ' + c.domain : '')).join('\n');

// The keyword picker on setup: ideas and keywords already cited in AI Overviews come from /app/setup/suggest.
const SUGGEST_JS = (room) => `
(function(){var box=document.getElementById('sugg');if(!box)return;var form=document.getElementById('setup');var room=${room};
function vol(v){return v==null?'':Number(v).toLocaleString('en-US')+' a month';}
function row(it,checked){var l=document.createElement('label');l.className='pick';var c=document.createElement('input');c.type='checkbox';c.name='pick';c.value=it.keyword;c.checked=checked;
var t=document.createElement('span');t.textContent=it.keyword;if(it.src){var s=document.createElement('span');s.className='src';s.textContent=it.src;t.appendChild(s);}
var v=document.createElement('span');v.className='vol';v.textContent=vol(it.volume);l.appendChild(c);l.appendChild(t);l.appendChild(v);return l;}
var fd=new URLSearchParams();fd.append('id',form.elements.id.value);
fetch('/app/setup/suggest',{method:'POST',body:fd,headers:{'Content-Type':'application/x-www-form-urlencoded'}}).then(function(r){return r.json()}).then(function(j){
box.innerHTML='';var list=(j.cited||[]).map(function(x){return {keyword:x.keyword,volume:x.volume,src:'Cited in AI Overviews'};}).concat(j.ideas||[]);
if(!list.length){box.innerHTML='<p class="hint">No ideas came back. Type your own keywords below.</p>';return;}
var n=0;list.forEach(function(it){box.appendChild(row(it,n<Math.min(room,5)));n++;});
}).catch(function(){box.innerHTML='<p class="hint">Ideas could not be loaded. Type your own keywords below.</p>';});})();`;

function setupPage(user, site, limits, opts) {
  opts = opts || {};
  const p = site.project;
  const room = Math.max(0, limits.keywords - (opts.usedElsewhere || 0));
  const current = (site.keywords || []).map((k) => k.text);
  const prefill = current.concat(opts.prefill && !current.includes(opts.prefill) ? [opts.prefill] : []);
  return layout('Set up ' + site.name + ' · AI SEO Deck', `${noticeHtml(opts.notice)}
<div class="head"><div><h1>Set up ${esc(site.name)}</h1><p class="meta"><span>Three short steps. You can change everything later.</span></p></div></div>
<form id="setup" method="post" action="/app/setup" class="steps"><input type="hidden" name="id" value="${esc(site.id)}">
<section class="panel step stack"><h2><span>1</span>Your brand</h2>
<div class="cols"><div class="field"><label for="brand">Brand name as people say it</label><input type="text" id="brand" name="brand" required maxlength="80" value="${esc(p.brand)}"><span class="hint">This is what we look for in AI answers.</span></div>
<div class="field"><label for="aliases">Other names (optional)</label><input type="text" id="aliases" name="aliases" maxlength="200" value="${esc((p.aliases || []).join(', '))}" placeholder="Short name, old name, product name"><span class="hint">Separate with commas.</span></div>
<div class="field"><label for="domains">Your website domains</label><input type="text" id="domains" name="domains" maxlength="300" value="${esc((p.domains || []).join(', '))}"><span class="hint">An answer that links to these counts as a citation.</span></div>
<div class="field"><label for="country">Where your customers are</label><select id="country" name="country">${options(COUNTRIES, p.country || '')}</select></div>
<div class="field"><label for="language">Language of your keywords</label><select id="language" name="language">${options(LANGS, p.language || 'en')}</select></div></div></section>
<section class="panel step stack"><h2><span>2</span>Your rivals</h2><p class="muted">Up to 5 businesses you compete with, one per line: name, then website. We show where the AI recommends them instead of you.</p>
<div class="field"><label for="rivals" class="tiny muted" style="font-weight:600">Rivals</label><textarea id="rivals" name="rivals" placeholder="Brightline Studio, brightline.com&#10;Northfield Co, northfield.co">${esc(rivalLines(p))}</textarea></div></section>
<section class="panel step stack"><h2><span>3</span>Keywords to track</h2><p class="muted">Your plan tracks ${plural(room, 'keyword')} here. Each keyword is asked the way people ask, on every AI engine in your plan. Tick the ideas that fit and add your own.</p>
<div id="sugg" class="picklist" aria-live="polite"><p class="hint">Finding keywords for your site…</p></div>
<div class="field"><label for="own">Your own keywords, one per line</label><textarea id="own" name="own" placeholder="crm for small business&#10;webflow agency in london">${esc(prefill.join('\n'))}</textarea></div>
<div class="actions"><button class="btn mark" type="submit">Save and run the first check</button><a class="btn ghost" href="/app">Cancel</a></div></section>
</form>`, { user, nav: 'sites', script: SUGGEST_JS(room) });
}

/* ---------- site page ---------- */

function progressHtml(site, progress) {
  if (!site.sched || !site.sched.runId) return '';
  const total = (progress && progress.total) || 0;
  const done = (progress && progress.done) || 0;
  const w = total ? Math.round((done / total) * 100) : 4;
  return `<div class="notice" id="progress" aria-live="polite"><b>Checking now.</b> <span id="pdone">${done}</span> of <span id="ptotal">${total}</span> AI answers read. Keep this page open to speed it up, or come back later.<div class="progress"><i id="pbar" style="width:${w}%"></i></div></div>`;
}
const PUMP = (siteId) => `
(function(){var id=${JSON.stringify(siteId)};var stop=false;
function step(){if(stop)return;fetch('/app/run/pump',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'id='+encodeURIComponent(id)}).then(function(r){return r.json()}).then(function(j){
var d=document.getElementById('pdone');if(j.total&&d){d.textContent=j.done;document.getElementById('ptotal').textContent=j.total;document.getElementById('pbar').style.width=Math.round(j.done/j.total*100)+'%';}
if(j.finished||j.idle){stop=true;location.reload();return;}if(j.budget){stop=true;var p=document.getElementById('progress');if(p)p.insertAdjacentHTML('beforeend','<p class="small" style="margin-top:8px">Checks are paused for a while. They continue on their own; you do not need to keep this page open.</p>');return;}setTimeout(step,j.busy?4000:600);}).catch(function(){setTimeout(step,8000);});}
step();})();`;

function tabsHtml(site, tab) {
  const t = (k, label) => `<a href="${esc(siteHref(site, 'tab=' + k))}"${tab === k ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<nav class="tabs" aria-label="Site sections">${t('keywords', 'Keywords')}${t('discover', 'Discover')}${t('insights', 'Rivals and sources')}${t('audit', 'Site audit')}${t('settings', 'Settings')}</nav>`;
}

function addKeywordForm(site, opts) {
  opts = opts || {};
  return `<form class="addkw" method="post" action="/app/keywords"><input type="hidden" name="id" value="${esc(site.id)}"><input type="hidden" name="back" value="keywords">${SEARCH_ICON}
<label for="newkw" class="tiny" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Add keywords</label><input type="text" id="newkw" name="text" maxlength="400" placeholder="Add a keyword, for example crm for small business" value="${esc(opts.prefill || '')}" autocomplete="off" required>
<button class="btn mark" type="submit">Add and check</button>
<span class="hint">${opts.room > 0 ? `${plural(opts.room, 'keyword')} left on your plan. Separate several with commas. ` : 'Your plan\'s keywords are all in use. Remove one or upgrade to add more. '}<a href="${esc(siteHref(site, 'tab=discover'))}">Find keyword ideas</a></span></form>`;
}

function keywordsTab(site, d) {
  if (!(site.keywords || []).length) return `${addKeywordForm(site, { room: d.room, prefill: d.prefill })}<div class="panel empty"><h2>Add your first keyword</h2><p>Type what your customers search for, like a service and a city. We ask every AI engine in your plan and show whether they name you.</p><a class="btn" href="${esc(siteHref(site, 'tab=discover'))}">Find keyword ideas</a></div>`;
  return `${addKeywordForm(site, { room: d.room, prefill: d.prefill })}${deckTable(site, { engines: d.engines, locked: d.locked, running: d.running })}`;
}

function trackButton(site, keyword, tracked, back, source) {
  if (tracked) return '<span class="track on" aria-label="Already tracked">Tracking</span>';
  return `<form method="post" action="/app/keywords"><input type="hidden" name="id" value="${esc(site.id)}"><input type="hidden" name="text" value="${esc(keyword)}"><input type="hidden" name="back" value="${esc(back)}"><input type="hidden" name="source" value="${esc(source || 'idea')}"><button class="track" type="submit" aria-label="Track ${esc(keyword)}">Track</button></form>`;
}
function relatedList(site, items, tracked, back, source) {
  return `<ul class="rk">${items.map((it) => `<li><span class="kwt" title="${esc(it.keyword)}">${esc(it.keyword)}</span><span class="vol">${it.volume == null ? '' : num(it.volume) + ' a month'}</span>${trackButton(site, it.keyword, tracked.includes(it.keyword), back, source)}</li>`).join('')}</ul>`;
}

function discoverTab(site, d) {
  const disc = site.discover || {};
  const tracked = (site.keywords || []).map((k) => k.text);
  const cited = disc.cited || [];
  const ideas = disc.ideas || [];
  const qs = ((site.latest && site.latest.topQueries) || []).map((q) => ({ keyword: q.q, volume: null })).filter((x) => x.keyword.length <= 80).slice(0, 12);
  const refresh = `<form method="post" action="/app/discover"><input type="hidden" name="id" value="${esc(site.id)}"><button class="btn sm" type="submit">${disc.at ? 'Look again' : 'Find keywords'}</button></form>`;
  return `<div class="cols" style="align-items:start">
<section class="panel stack"><div class="actions" style="justify-content:space-between"><h2>Cited in Google AI Overviews</h2>${refresh}</div>
<p class="small muted">Keywords where Google's AI Overviews already use your site as a source${disc.at ? `, found ${ago(disc.at)}` : ''}. Track them to see what the other AI engines say.</p>
${cited.length ? relatedList(site, cited, tracked, 'discover', 'aio') : `<p class="small muted">${disc.at ? (disc.error ? esc(disc.error) : 'None found yet. Google cites sites that answer a search clearly on one page; the fixes on each keyword help.') : 'Press Find keywords to look it up.'}</p>`}</section>
<section class="panel stack"><h2>Keyword ideas for your site</h2><p class="small muted">Searches people make when they look for what you sell, written from your homepage, with monthly searches when we have them.</p>
${ideas.length ? relatedList(site, ideas, tracked, 'discover', 'idea') : `<p class="small muted">${disc.at ? 'No ideas came back this time.' : 'Press Find keywords to write ideas from your homepage.'}</p>`}</section>
<section class="panel stack"><h2>What the AI searched for</h2><p class="small muted">The web searches the AI engines ran while answering for your keywords. These are the keywords that decide which pages get read.</p>
${qs.length ? relatedList(site, qs, tracked, 'discover', 'search') : '<p class="small muted">Appears after the first check.</p>'}</section></div>`;
}

function insightsHtml(latest) {
  const ins = latest && latest.insights;
  if (!ins) return `<h2>How AI describes you</h2><p class="small muted">${latest && latest.mentionRate ? 'Appears after the next weekly check.' : 'Once the AI names you, you will see the words it uses for you and whether it sounds positive.'}</p>`;
  const s = ins.sentiment || {};
  const tot = (s.positive || 0) + (s.neutral || 0) + (s.negative || 0) || 1;
  const seg = (k, cls) => (s[k] ? `<i class="${cls}" style="width:${((s[k] / tot) * 100).toFixed(1)}%" title="${esc(k)}: ${s[k]}"></i>` : '');
  return `<h2>How AI describes you</h2>
<div class="sent" role="img" aria-label="${s.positive || 0} positive, ${s.neutral || 0} neutral, ${s.negative || 0} negative">${seg('positive', 'pos')}${seg('neutral', 'neu')}${seg('negative', 'neg')}</div>
<p class="tiny muted">${s.positive || 0} positive, ${s.neutral || 0} neutral, ${s.negative || 0} negative, from ${plural(ins.basedOn || 0, 'answer')} that name you.</p>
${(ins.descriptors || []).length ? `<div class="chips">${ins.descriptors.map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div>` : ''}
${(ins.check || []).length ? `<div class="checkit"><b class="small">Worth checking</b><ul>${ins.check.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><p class="tiny muted">AI repeats what it reads. If something is wrong, fix it on your site and on the sites listed under Sources.</p></div>` : ''}`;
}
function andList(a) { a = (a || []).filter(Boolean); return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }

function insightsTab(site) {
  const l = site.latest;
  if (!l) return '<div class="panel empty"><h2>Nothing to compare yet</h2><p>After the first check, this shows where rivals win, how the AI describes you and which websites it relies on.</p></div>';
  const gaps = l.gaps || [];
  const kwById = Object.fromEntries((site.keywords || []).map((k) => [k.id, k]));
  const gapsBlock = !(site.project.competitors || []).length
    ? `<p class="small muted">Add your rivals in Settings to see the keywords where the AI picks them instead of you.</p><div class="actions"><a class="btn sm" href="${esc(siteHref(site, 'tab=settings'))}">Add rivals</a></div>`
    : gaps.length ? `<ul class="gaps">${gaps.map((g) => `<li><div class="gq">${kwById[g.k] ? `<a href="${esc(kwHref(site, kwById[g.k]))}">${esc(g.text)}</a>` : `<b>${esc(g.text)}</b>`}<span class="small muted"><span class="rival-name">${esc(andList(g.rivals))}</span> named instead. ${g.named ? `You are named by ${g.named} of ${plural(g.answered, 'engine')}.` : 'No engine names you here.'}</span></div><div class="chips">${g.engines.map((e) => `<span class="chip">${esc(LABEL[e] || e)}</span>`).join('')}</div></li>`).join('')}</ul>`
      : '<p class="small muted">No rival beats you in the latest answers. Add more keywords to find new ground.</p>';
  const voice = (l.voice || []).slice(0, 6);
  const voiceBlock = voice.length > 1 ? `<div class="rows">${voice.map((v) => `<div class="row"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(v.name)}">${v.own ? '<b>' + esc(v.name) + '</b>' : esc(v.name)}</span><span class="bar"><i class="${v.own ? 'named' : 'rival'}" style="width:${(v.share * 100).toFixed(1)}%"></i></span><span class="v">${pct(v.share)}</span></div>`).join('')}</div>` : '<p class="small muted">Add rivals in Settings to compare.</p>';
  const hosts = l.topHosts || [];
  const max = Math.max(1, ...hosts.map((h) => h.n));
  const own = l.ownCited || [];
  return `<div class="grid2"><div class="stack">
<section class="panel stack"><div><h2>Where rivals win</h2><p class="small muted" style="margin-top:6px">Keywords where an AI engine names a rival and not you. Widest gaps first.</p></div>${gapsBlock}</section>
<section class="panel stack"><div><h2>Websites the AI relies on</h2><p class="small muted" style="margin-top:6px">Reviews, directories and articles the engines cite for your keywords. Being listed or mentioned there is the fastest way into the answers. Your own site is left out.</p></div>
${hosts.length ? `<div class="rows">${hosts.map((h) => `<div class="row"><span class="host" title="${esc(h.host)}">${esc(h.host)}</span><span class="bar"><i class="host" style="width:${((h.n / max) * 100).toFixed(1)}%"></i></span><span class="v">${plural(h.n, 'answer')}</span></div>`).join('')}</div>` : '<p class="small muted">No sources were reported yet.</p>'}</section></div>
<div class="stack"><section class="panel stack">${insightsHtml(l)}</section>
<section class="panel stack"><h2>Share of voice</h2><p class="tiny muted">Of the answers that name any brand you track.</p>${voiceBlock}</section>
<section class="panel stack"><h2>Your pages the AI cites</h2>${own.length ? `<ul class="plain">${own.map((u) => `<li><a href="${esc(u.url)}" target="_blank" rel="noopener" class="small">${esc(u.url.replace(/^https?:\/\/(www\.)?/, ''))}</a><span class="small muted">${plural(u.n, 'answer')}</span></li>`).join('')}</ul>` : '<p class="small muted">None of your pages was cited yet. Clear answer pages and structured data help; open a keyword to see its fixes.</p>'}</section></div></div>`;
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
function issueLabel(k) {
  return { title_missing: 'No title', title_length: 'Title length', desc_missing: 'No description', desc_length: 'Description length', h1_missing: 'No H1', h1_multiple: 'Several H1', schema_missing: 'No schema', schema_invalid: 'Broken schema', faq_no_schema: 'FAQ without schema', og_missing: 'Social preview', thin: 'Thin content', alt_missing: 'Alt text', lang_missing: 'No language' }[k] || k;
}

function auditHtml(site, audit) {
  const id = encodeURIComponent(site.id);
  if (!audit) return `<div class="panel empty"><h2>Find what keeps AI engines from citing you</h2><p>The audit reads your live pages, robots.txt, llms.txt and sitemap, then lists fixes. It also matches each keyword to its best page.</p>
<form method="post" action="/app/site/audit"><input type="hidden" name="id" value="${esc(site.id)}"><button class="btn primary" type="submit">Run the site audit</button></form><p class="tiny muted">Takes up to a minute.</p></div>`;
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

const BUSINESS_TYPES = [['Organization', 'Company or brand'], ['LocalBusiness', 'Local business'], ['ProfessionalService', 'Agency or professional service'], ['Dentist', 'Dental clinic'], ['MedicalClinic', 'Medical clinic'], ['BeautySalon', 'Beauty salon'], ['HealthAndBeautyBusiness', 'Health and beauty'], ['Restaurant', 'Restaurant'], ['Store', 'Shop'], ['RealEstateAgent', 'Real estate'], ['LegalService', 'Legal service'], ['EducationalOrganization', 'School or course']];

function settingsTab(site, limits) {
  const p = site.project;
  const biz = p.business || {};
  const id = esc(site.id);
  return `<div class="cols">
<form class="panel stack" method="post" action="/app/site/settings"><input type="hidden" name="id" value="${id}"><h2>Brand and rivals</h2>
<div class="field"><label for="brand">Brand name</label><input type="text" id="brand" name="brand" required maxlength="80" value="${esc(p.brand)}"></div>
<div class="field"><label for="aliases">Other names</label><input type="text" id="aliases" name="aliases" maxlength="200" value="${esc((p.aliases || []).join(', '))}"></div>
<div class="field"><label for="domains">Website domains</label><input type="text" id="domains" name="domains" maxlength="300" value="${esc((p.domains || []).join(', '))}"></div>
<div class="field"><label for="rivals">Rivals, one per line: name, website</label><textarea id="rivals" name="rivals">${esc(rivalLines(p))}</textarea></div>
<div class="cols" style="gap:12px"><div class="field"><label for="country">Customers in</label><select id="country" name="country">${options(COUNTRIES, p.country || '')}</select></div>
<div class="field"><label for="language">Keyword language</label><select id="language" name="language">${options(LANGS, p.language || 'en')}</select></div></div>
<h3 style="margin-top:6px">Business details for structured data</h3><p class="tiny muted">Used in the Organization schema on your homepage. Leave empty what you do not want to publish.</p>
<div class="field"><label for="btype">Type of business</label><select id="btype" name="btype">${options(BUSINESS_TYPES, biz.type || 'Organization')}</select></div>
<div class="cols" style="gap:12px"><div class="field"><label for="phone">Phone</label><input type="tel" id="phone" name="phone" maxlength="40" value="${esc(biz.phone || '')}"></div><div class="field"><label for="bemail">Public email</label><input type="email" id="bemail" name="bemail" maxlength="120" value="${esc(biz.email || '')}"></div></div>
<div class="field"><label for="street">Street address</label><input type="text" id="street" name="street" maxlength="160" value="${esc(biz.street || '')}"></div>
<div class="cols" style="gap:12px"><div class="field"><label for="city">City</label><input type="text" id="city" name="city" maxlength="80" value="${esc(biz.city || '')}"></div><div class="field"><label for="bcountry">Country</label><input type="text" id="bcountry" name="bcountry" maxlength="60" value="${esc(biz.country || '')}"></div></div>
<div class="actions"><button class="btn primary" type="submit">Save</button></div></form>
<div class="panel stack"><h2>Tracking</h2><p class="small muted">${site.tracked ? `Every keyword is checked automatically ${limits.plan === 'free' ? 'every month' : 'every week'}${site.sched.nextRunAt ? ', next ' + until(site.sched.nextRunAt) : ''}.` : (site.pausedByUser ? 'Paused. Nothing is checked until you resume.' : 'Waiting for a free slot in your plan.')}</p>
<form method="post" action="/app/site/track"><input type="hidden" name="id" value="${id}"><input type="hidden" name="on" value="${site.tracked ? '0' : '1'}"><button class="btn" type="submit">${site.tracked ? 'Pause tracking' : 'Resume tracking'}</button></form>
<h3 style="margin-top:8px">Client report link</h3><p class="small muted">A read-only page with the visibility, the trend and the keyword deck. Anyone with the link can open it.</p>
${site.settings.reportToken ? `<pre class="copy">${esc((process.env.APP_URL || '').replace(/\/+$/, '') + '/r/' + site.settings.reportToken)}</pre>` : ''}
<form method="post" action="/app/site/report" class="actions"><input type="hidden" name="id" value="${id}">${site.settings.reportToken ? '<button class="btn sm" name="action" value="rotate" type="submit">Replace the link</button>' : '<button class="btn sm" type="submit">Create a report link</button>'}</form>
<h3 style="margin-top:8px">Remove this site</h3><p class="small muted">Deletes its keywords, answers and audit from AI SEO Deck. Nothing changes in Webflow.</p>
<form method="post" action="/app/site/remove" onsubmit="return this.querySelector('[name=sure]').checked"><input type="hidden" name="id" value="${id}"><label class="check"><input type="checkbox" name="sure" value="1"> I want to remove ${esc(site.name)}</label><button class="btn sm danger" type="submit" style="margin-top:10px">Remove site</button></form></div>
</div>`;
}

function sitePage(user, site, d) {
  const tab = d.tab || 'keywords';
  let body = '';
  if (tab === 'keywords') body = keywordsTab(site, d);
  else if (tab === 'discover') body = discoverTab(site, d);
  else if (tab === 'insights') body = insightsTab(site);
  else if (tab === 'audit') body = auditHtml(site, d.audit);
  else body = settingsTab(site, d.limits);
  const can = d.canRun || {};
  const runBtn = site.sched && site.sched.runId ? '' : `<form method="post" action="/app/site/run"><input type="hidden" name="id" value="${esc(site.id)}"><button class="btn" type="submit"${can.ok ? '' : ' disabled'}>Check all keywords now</button></form>`;
  const meta = [`<span>${esc(hostOf(site.url))}</span>`, `<span>${plural((site.keywords || []).length, 'keyword')}</span>`];
  if (site.latest) meta.push(`<span>checked ${esc(ago(site.latest.finishedAt || site.latest.at))}</span>`);
  if (site.tracked && site.sched.nextRunAt && !site.sched.runId) meta.push(`<span>next check ${esc(until(site.sched.nextRunAt))}</span>`);
  return layout(site.name + ' · AI SEO Deck', `${noticeHtml(d.notice)}${progressHtml(site, d.progress)}
<div class="head"><div><h1>${esc(site.project.brand || site.name)}</h1><p class="meta">${meta.join('')}</p></div><div class="actions">${runBtn}${!can.ok && can.why ? `<span class="tiny muted" style="max-width:280px">${esc(can.why)}</span>` : (can.ok && can.cost ? `<span class="tiny muted">Uses ${plural(can.cost, 'keyword check')} of ${can.left} left this month</span>` : '')}</div></div>
${statStrip(site, d.history, d.limits)}
${tabsHtml(site, tab)}
${body}`, { user, nav: 'sites', script: site.sched && site.sched.runId ? PUMP(site.id) : '' });
}

/* ---------- keyword page ---------- */

function answerBlock(r, unitText, isKeyword, project) {
  const st = !r ? 'w' : !r.ok ? 'f' : r.none ? 'x' : r.mentioned && r.cited ? 'b' : r.mentioned ? 'n' : r.cited ? 'i' : 'o';
  const tag = st === 'b' ? `<span class="pill named">Named${r.rank ? ' #' + r.rank : ''}</span><span class="pill cite">Site cited</span>`
    : st === 'n' ? `<span class="pill named">Named${r.rank ? ' #' + r.rank : ''}</span>` : st === 'i' ? '<span class="pill cite">Site cited</span>'
      : st === 'f' ? '<span class="pill bad">Could not read</span>' : st === 'x' ? '<span class="pill na">No AI answer</span>' : st === 'w' ? '<span class="pill na">Not checked yet</span>' : '<span class="pill none">Not named</span>';
  const own = project.domains || [];
  const chips = (r && r.sources || []).map((x) => {
    const isOwn = own.some((dm) => x.host === dm || String(x.host || '').endsWith('.' + dm));
    return x.url && /^https?:\/\//.test(x.url) && !/vertexaisearch|grounding-api/.test(x.url) ? `<a class="chip${isOwn ? ' own' : ''}" href="${esc(x.url)}" rel="noopener nofollow" target="_blank" title="${esc(x.title || x.url)}">${esc(x.host)}</a>` : `<span class="chip${isOwn ? ' own' : ''}">${esc(x.host)}</span>`;
  }).join('');
  const body = !r ? '' : r.none ? '<p class="small muted">Google showed regular results only for this search, without an AI answer.</p>' : r.ok ? `<p class="quote">${highlight(r.snippet || '', project)}</p>` : `<p class="small muted">${esc(r.err || 'The engine did not answer.')}</p>`;
  const searched = r && r.ok && (r.queries || []).length ? `<div class="chips"><span class="tiny faint">Searched</span>${r.queries.map((q) => `<span class="q">${esc(q)}</span>`).join('')}</div>` : '';
  const full = r && r.ok && r.text && r.text.length > (r.snippet || '').length + 40 ? `<details><summary>Full answer</summary><p class="quote" style="white-space:pre-line">${highlight(r.text, project)}</p></details>` : '';
  return `<div class="answer"><p class="ask">${isKeyword ? 'Search' : 'Asked'} <b>${esc(unitText)}</b></p><div class="actions" style="gap:6px">${tag}</div>${body}${searched}${chips ? `<div class="chips" aria-label="Sources">${chips}</div>` : ''}${full}</div>`;
}

function lanesHtml(site, k, d) {
  const sum = site.kw && site.kw[k.id];
  const run = d.run;
  const res = d.results || {};
  const engs = (run && run.engines) || d.engines || [];
  if (!engs.length) return '<p class="small muted">No AI engine is set up yet.</p>';
  const units = run ? (run.units || []).filter((u) => u.k === k.id) : [];
  return `<ul class="lanes">${engs.slice().sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)).map((e) => {
    const st = sum && sum.eng && sum.eng[e] ? sum.eng[e] : 'w';
    const mine = units.filter((u) => (u.q === 'k') === (e === 'aio' || e === 'aimode'));
    const answers = mine.map((u) => answerBlock(res[u.id + '|' + e], u.text, u.q === 'k', site.project)).join('');
    const label = { b: 'Names you and cites your site', n: 'Names you', i: 'Cites your site, does not name you', o: 'Does not name you', x: 'No AI answer on Google', f: 'Could not be read', w: d.checking ? 'Checking now' : 'Not checked yet' }[st] || '';
    return `<li class="lane" id="e-${esc(e)}"><div class="lh"><span class="sig st-${esc(st)}" aria-hidden="true"></span><b>${esc(LONG[e] || e)}</b><span class="small muted">${esc(label)}</span></div>${answers || (run ? '' : '<p class="small muted" style="margin-left:24px">Answers appear after the first check.</p>')}</li>`;
  }).join('')}${(d.locked || []).map((e) => `<li class="lane"><div class="lh"><span class="c st-lock" aria-hidden="true">${LOCK}</span><b>${esc(LONG[e] || e)}</b><span class="small muted">Part of the paid plans</span></div></li>`).join('')}</ul>`;
}

function faqLines(pairs) { return (pairs || []).map((x) => 'Q: ' + x.q + '\nA: ' + x.a).join('\n\n'); }

// The plan of fixes for one keyword: the page, title and description, answers with FAQ schema, where the AI looks.
function fixPlan(site, k, d) {
  const sum = site.kw && site.kw[k.id];
  const id = esc(site.id);
  const target = d.target; // { path, pageId, static, score, row } or null
  const draft = d.draft || {};
  const can = d.limits.canApply;
  const hosts = (sum && sum.hosts || []).slice(0, 6);
  const whereItem = `<li class="manual"><span class="tick" aria-hidden="true"></span><div><h3>Be where the AI looks</h3><p class="d">${hosts.length ? 'The engines cited these sites for this keyword. Reviews, listings and articles there move you into the answers.' : 'After the first check, this lists the sites the engines cite for this keyword.'}</p>${hosts.length ? `<div class="chips" style="margin-top:10px">${hosts.map(([h, n]) => `<span class="q">${esc(h)} <span class="faint">${n}</span></span>`).join('')}</div>` : ''}</div></li>`;
  const pageOptions = (d.pages || []).filter((p) => p.ok !== false && !p.error).slice(0, 80).map((p) => `<option value="${esc(p.path)}"${target && target.path === p.path ? ' selected' : ''}>${esc(p.path)}${p.pageId ? '' : ' (CMS)'}</option>`).join('');
  const pagePicker = d.pages && d.pages.length ? `<form method="post" action="/app/keyword/page" class="actions" style="gap:8px"><input type="hidden" name="id" value="${id}"><input type="hidden" name="k" value="${esc(k.id)}"><select name="path" aria-label="Page for this keyword" style="width:auto;max-width:260px">${target ? '' : '<option value="">Choose a page</option>'}${pageOptions}<option value="new"${k.page === 'new' ? ' selected' : ''}>A new page in the CMS</option></select><button class="btn sm" type="submit">Use</button></form>` : '';
  const head = `<div class="plan-head"><div><h2>What to do</h2><p class="small muted" style="margin-top:4px">${target ? `Best page: <a href="${esc(d.origin + target.path)}" target="_blank" rel="noopener">${esc(target.path)}</a>${k.page === target.path ? '' : ' (matched by its title and address)'}` : k.page === 'new' ? 'A new page, drafted in your CMS' : d.pages ? 'No page on your site matches this keyword yet.' : 'Run the site audit to match a page.'}</p></div>${pagePicker}</div>`;
  if (!d.pages) {
    return `<section class="panel plan-card">${head}<ul class="fx"><li><span class="tick" aria-hidden="true"></span><div><h3>Find the best page for this keyword</h3><p class="d">The site audit reads your pages and matches each keyword to the one that should rank. It takes up to a minute.</p>
<form method="post" action="/app/site/audit" style="margin-top:12px"><input type="hidden" name="id" value="${id}"><input type="hidden" name="back" value="${esc(k.id)}"><button class="btn sm primary" type="submit">Run the site audit</button></form></div></li>${whereItem}</ul></section>`;
  }
  const writeBtn = (label) => `<form method="post" action="/app/keyword/plan" class="actions" id="writeplan"><input type="hidden" name="id" value="${id}"><input type="hidden" name="k" value="${esc(k.id)}"><button class="btn sm${draft.at ? '' : ' mark'}" type="submit">${label}</button><span class="tiny muted" id="writing" hidden>Writing from your page, this takes a few seconds…</span></form>`;
  const collections = (d.collections || []).map((c) => `<option value="${esc(c.id)}">${esc(c.displayName || c.slug)}</option>`).join('');
  // A keyword with no page: draft a new CMS page
  if (!target || k.page === 'new') {
    const np = draft.newPage;
    const items = np ? `<li><span class="tick" aria-hidden="true"></span><div><h3>${esc(np.title)}</h3><p class="d">/${esc(np.slug)}</p><p class="d" style="color:var(--ink)">${esc(np.intro)}</p><div style="margin-top:10px">${np.faq.map((x) => `<div class="qa"><b>${esc(x.q)}</b><span class="muted">${esc(x.a)}</span></div>`).join('')}</div></div></li>` : `<li><span class="tick" aria-hidden="true"></span><div><h3>A page for this keyword</h3><p class="d">No page answers this search yet. We draft one from what your site already says: a title, an intro and answers to the questions people ask. It goes to your CMS as a draft for you to finish.</p></div></li>`;
    const foot = np ? `<form method="post" action="/app/keyword/apply" class="plan-foot"><input type="hidden" name="id" value="${id}"><input type="hidden" name="k" value="${esc(k.id)}"><input type="hidden" name="what" value="newpage">
<p>${collections ? 'Choose the collection for the draft. It needs a rich text field.' : 'Your site has no CMS collection to add the draft to.'}</p>${collections ? `<select name="collection" aria-label="CMS collection" style="width:auto">${collections}</select>` : ''}<button class="btn mark" type="submit"${can && collections ? '' : ' disabled'}>Add the draft to Webflow</button></form>` : `<div class="plan-foot"><p>Nothing is written to Webflow until you press Apply.</p>${writeBtn('Draft the page')}</div>`;
    return `<section class="panel plan-card">${head}<ul class="fx">${items}${whereItem}</ul>${foot}${can ? '' : '<p class="tiny muted" style="padding:0 22px 16px">Applying to Webflow is part of the paid plans. You can copy everything on the free plan.</p>'}</section>`;
  }
  const row = target.row || {};
  const meta = draft.meta || null;
  const faq = draft.faq || [];
  const isStatic = !!target.pageId;
  const titleItem = `<li><span class="tick" aria-hidden="true"></span><div><h3>Title and description</h3><p class="d">The first thing search engines and AI read about the page.</p>
${meta ? `<div class="diff"><div><span class="l">Now</span><s>${esc(row.title || '(no title)')}</s></div><div><span class="l">New</span><div class="fields" style="gap:8px"><input type="text" name="title" form="applyform" maxlength="90" value="${esc(meta.title)}" aria-label="New title"><textarea name="description" form="applyform" maxlength="200" style="min-height:70px" aria-label="New description">${esc(meta.description)}</textarea></div></div></div>
<label class="include"><input type="checkbox" name="do_meta" value="1" form="applyform" checked> Apply the new title and description</label>` : `<p class="small" style="margin-top:8px">Now: <b>${esc(row.title || '(no title)')}</b></p>`}</div></li>`;
  const faqItem = `<li><span class="tick" aria-hidden="true"></span><div><h3>Answers to what people ask</h3><p class="d">Answers written from your own page for the questions behind this keyword, added to the page as FAQ schema${collections ? ' and to your CMS as drafts' : ''}.</p>
${faq.length ? `<textarea name="faq" form="applyform" style="min-height:160px;margin-top:10px" aria-label="Questions and answers">${esc(faqLines(faq))}</textarea><span class="hint">Lines start with Q: and A:. Every answer should also be visible on the page.</span>
<label class="include"><input type="checkbox" name="do_schema" value="1" form="applyform" checked> Add them to the page as FAQ schema</label>${collections ? `<label class="include"><input type="checkbox" name="do_cms" value="1" form="applyform"> Also add them to <select name="collection" form="applyform" style="width:auto;padding:4px 8px;font-size:13px" aria-label="CMS collection">${collections}</select> as drafts</label>` : ''}` : ''}</div></li>`;
  const cmsNote = isStatic ? '' : '<p class="small" style="padding:0 22px 16px;color:var(--warn)">This is a CMS page. Copy the title and description into the collection item in Webflow; the answers can still go to your CMS as drafts.</p>';
  const foot = meta || faq.length
    ? `<form method="post" action="/app/keyword/apply" class="plan-foot" id="applyform"><input type="hidden" name="id" value="${id}"><input type="hidden" name="k" value="${esc(k.id)}"><input type="hidden" name="what" value="page">
<p>${k.fixedAt ? `Applied ${esc(ago(k.fixedAt))}. Publish in Webflow, then check the keyword again.` : 'Everything lands in Webflow as unpublished changes. Nothing goes live until you publish.'}</p><button class="btn mark" type="submit"${can ? '' : ' disabled'}>Apply to Webflow</button></form>${writeBtn('Write new suggestions').replace('class="actions"', 'class="actions" style="padding:0 22px 18px"')}`
    : `<div class="plan-foot"><p>We write the title, description and answers from the page itself. You review everything before it goes to Webflow.</p>${writeBtn('Write the fixes')}</div>`;
  return `<section class="panel plan-card">${head}<ul class="fx">${titleItem}${faqItem}${whereItem}</ul>${cmsNote}${foot}${can ? '' : '<p class="tiny muted" style="padding:0 22px 16px">Applying to Webflow is part of the paid plans. You can copy everything on the free plan.</p>'}</section>`;
}

function keywordPage(user, site, k, d) {
  const sum = site.kw && site.kw[k.id];
  const v = verdict(sum);
  const kc = engineCounts(sum);
  const tracked = (site.keywords || []).map((x) => x.text);
  const checking = !!(site.sched && site.sched.runId && (d.running || []).includes(k.id));
  const can = d.canCheck || {};
  const checkBtn = checking ? '' : `<form method="post" action="/app/keyword/check"><input type="hidden" name="id" value="${esc(site.id)}"><input type="hidden" name="k" value="${esc(k.id)}"><button class="btn" type="submit"${can.ok ? '' : ' disabled'}>Check again</button></form>`;
  const meta = [];
  if (k.volume != null) meta.push(`<span>${num(k.volume)} searches a month</span>`);
  if (sum) meta.push(`<span>checked ${esc(ago(sum.at))}</span>`);
  meta.push(`<span>${plural((k.questions || []).length || 1, 'question')} on each chat engine</span>`);
  const verdictBox = sum ? `<section class="panel verdict${v === 'yes' ? ' yes' : ''}"><div class="big">${kc.named}<small>/${kc.answered}</small></div>
<div class="vt"><strong>${esc(verdictText(sum, site.project.brand))}</strong><div class="facts"><span>Visible in <b>${Math.round((sum.vis || 0) * 100)}%</b> of ${plural(sum.n, 'answer')}</span><span>Your site cited in <b>${sum.c}</b></span>${sum.rank ? `<span>Average place <b>#${sum.rank}</b></span>` : ''}${(sum.rivals || []).length ? `<span>Rivals named: ${sum.rivals.slice(0, 3).map(([n, c]) => `<span class="rival-name">${esc(n)}</span> ${c}`).join(', ')}</span>` : ''}</div></div>
<div class="chart">${lineChart(sum.trend || [], { w: 340, h: 120, next: site.sched && site.sched.nextRunAt ? new Date(site.sched.nextRunAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '' })}</div></section>`
    : `<section class="panel verdict"><div class="big">-</div><div class="vt"><strong>${checking ? 'Asking the AI engines now.' : 'Not checked yet.'}</strong><p class="small muted">${checking ? 'Answers appear here in a minute or two. Keep the page open to speed it up.' : 'It is checked with the next scheduled check, or press Check again.'}</p></div></section>`;
  const searched = (sum && sum.queries || []).slice(0, 10).map((q) => ({ keyword: q, volume: null })).filter((x) => x.keyword.length <= 80);
  const related = d.related || null;
  const relBox = `<section class="panel stack"><h2>Related keywords</h2>
<div><h3 style="margin-bottom:6px">What the AI searched for</h3><p class="small muted" style="margin-bottom:8px">The web searches the engines ran before answering.</p>${searched.length ? relatedList(site, searched, tracked, 'k:' + k.id, 'search') : '<p class="small muted">Appears after the first check.</p>'}</div>
<div><h3 style="margin-bottom:6px">Searches related to this keyword</h3>${related ? (related.length ? relatedList(site, related, tracked, 'k:' + k.id, 'idea') : '<p class="small muted">No related searches found for this market.</p>') : `<form method="post" action="/app/keyword/related" class="actions"><input type="hidden" name="id" value="${esc(site.id)}"><input type="hidden" name="k" value="${esc(k.id)}"><button class="btn sm" type="submit"${d.labs ? '' : ' disabled'}>Show related searches</button>${d.labs ? '' : '<span class="tiny muted">Needs keyword data on the server.</span>'}</form>`}</div></section>`;
  const qBox = `<section class="panel stack"><h2>Questions we ask</h2><p class="small muted">The chat engines get these questions; Google AI Overviews and AI Mode get the keyword itself. Edit them to match how your customers ask.</p>
<form method="post" action="/app/keyword/questions" class="fields"><input type="hidden" name="id" value="${esc(site.id)}"><input type="hidden" name="k" value="${esc(k.id)}"><div class="field"><label for="qs">One question per line, up to ${QUESTIONS}</label><textarea id="qs" name="questions" style="min-height:90px">${esc((k.questions || []).join('\n'))}</textarea></div>
<div class="actions"><button class="btn sm" type="submit">Save questions</button></div></form>
<form method="post" action="/app/keyword/remove" onsubmit="return this.querySelector('[name=sure]').checked" style="border-top:1px solid var(--line2);padding-top:14px"><input type="hidden" name="id" value="${esc(site.id)}"><input type="hidden" name="k" value="${esc(k.id)}"><label class="check small"><input type="checkbox" name="sure" value="1"> Stop tracking this keyword</label><button class="btn sm danger" type="submit" style="margin-top:8px">Remove keyword</button></form></section>`;
  const script = (checking ? PUMP(site.id) : '') + `document.querySelectorAll('#writeplan').forEach(function(f){f.addEventListener('submit',function(){var b=f.querySelector('button');var w=f.querySelector('#writing');if(b){b.disabled=true;}if(w){w.hidden=false;}});});`;
  return layout(k.text + ' · AI SEO Deck', `${noticeHtml(d.notice)}${checking ? progressHtml(site, d.progress) : ''}
<a class="back" href="${esc(siteHref(site, 'tab=keywords'))}">${esc(site.project.brand || site.name)}, all keywords</a>
<div class="head"><div><h1>${esc(k.text)}</h1><p class="meta">${meta.join('')}</p></div><div class="actions">${checkBtn}${!checking && !can.ok && can.why ? `<span class="tiny muted" style="max-width:280px">${esc(can.why)}</span>` : (can.ok && can.left != null ? `<span class="tiny muted">${plural(can.left, 'keyword check')} left this month</span>` : '')}</div></div>
${verdictBox}
<div class="grid2"><div class="stack">${fixPlan(site, k, d)}<section class="panel stack"><h2>What each AI engine said</h2>${lanesHtml(site, k, Object.assign({ checking }, d))}</section></div>
<div class="stack">${relBox}${qBox}</div></div>`, { user, nav: 'sites', script });
}

/* ---------- page fix (from the audit) ---------- */

function counter(id, min, max) { return `<span class="hint" data-count="${id}" data-min="${min}" data-max="${max}"></span>`; }
const COUNT_JS = `document.querySelectorAll('[data-count]').forEach(function(h){var i=document.getElementById(h.dataset.count);if(!i)return;function u(){var n=i.value.length;h.textContent=n+' characters, aim for '+h.dataset.min+' to '+h.dataset.max;h.style.color=(n<+h.dataset.min||n>+h.dataset.max)?'var(--warn)':'var(--muted)';}i.addEventListener('input',u);u();});
document.querySelectorAll('[data-copy]').forEach(function(b){b.addEventListener('click',function(){var t=document.getElementById(b.dataset.copy);var v=t.value||t.textContent;if(navigator.clipboard){navigator.clipboard.writeText(v).then(function(){b.textContent='Copied';},function(){t.select&&t.select();});}else if(t.select){t.select();}});});`;

function fixPage(user, site, row, d) {
  const id = esc(site.id);
  const path = esc(row.path);
  const draft = d.draft || {};
  const meta = draft.meta || {};
  const lockNote = d.limits.canApply ? '' : '<p class="tiny muted">Applying to Webflow is part of the paid plans. You can copy the values on the free plan.</p>';
  const applyBtn = (label) => `<button class="btn primary" type="submit"${d.limits.canApply ? '' : ' disabled'}>${label}</button>`;
  const faqPairs = draft.faq && draft.faq.length ? draft.faq : (row.faq || []);
  const existingTypes = d.existingTypes || [];
  return layout('Fix ' + row.path + ' · AI SEO Deck', `${noticeHtml(d.notice)}
<a class="back" href="${esc(siteHref(site, 'tab=audit'))}">Back to the site audit</a>
<div class="head"><div><h1>${row.path === '/' ? 'Fix the homepage' : 'Fix ' + esc(row.path)}</h1><p class="meta"><span>${esc(site.name)}</span><span>page score ${row.score == null ? '-' : row.score}/100</span><span>changes go to Webflow as unpublished edits</span></p></div></div>
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
<div class="field"><label for="faq">Questions and answers (Q: and A: lines)</label><textarea id="faq" name="faq" style="min-height:220px" placeholder="Q: How long does delivery take?&#10;A: Most orders arrive in 2 to 4 working days.">${esc(faqLines(faqPairs))}</textarea><span class="hint">Every answer should also be visible on the page itself.</span></div>
<div class="actions"><button class="btn" name="action" value="save" type="submit">Save and use in the schema below</button>${d.collections && d.collections.length ? `<select name="collection" aria-label="CMS collection" style="width:auto">${d.collections.map((c) => `<option value="${esc(c.id)}">${esc(c.displayName || c.slug)}</option>`).join('')}</select><button class="btn" name="action" value="cms" type="submit"${d.limits.canApply ? '' : ' disabled'}>Add to CMS as drafts</button>` : ''}</div></form>
<form method="post" action="/app/fix/suggest" class="actions"><input type="hidden" name="id" value="${id}"><input type="hidden" name="path" value="${path}"><input type="hidden" name="what" value="faq"><button class="btn sm" type="submit">Write answers with AI from this page</button></form></section>
<section class="panel stack"><h2>Structured data (JSON-LD)</h2><p class="small muted">${existingTypes.length ? 'This page already has: ' + esc(existingTypes.join(', ')) + '. We keep those and add or replace only the types below.' : 'This page has no structured data yet.'}</p>
<form method="post" action="/app/fix/schema" class="fields"><input type="hidden" name="id" value="${id}"><input type="hidden" name="path" value="${path}">
<div class="field"><label for="schema">What will be written to Webflow</label><textarea id="schema" name="schema" class="code" spellcheck="false">${esc(JSON.stringify(d.proposedSchema || {}, null, 2))}</textarea>${row.path === '/' ? '<span class="hint">Business details come from the Settings tab. Change them there and come back.</span>' : ''}</div>
<div class="actions">${applyBtn('Apply to Webflow')}<button class="btn ghost" type="button" data-copy="schema">Copy</button></div>${lockNote}</form></section>
</div>`, { user, nav: 'sites', script: COUNT_JS });
}

/* ---------- account settings ---------- */

function settingsPage(user, sites, limits, notice, opts) {
  opts = opts || {};
  const b = user.billing || {};
  const usage = opts.usage || { rechecks: 0 };
  const used = sites.reduce((a, s) => a + (s.keywords || []).length, 0);
  const planCards = [['free', FREE]].concat(Object.entries(PLANS)).map(([k, p]) => {
    const current = limits.plan === k;
    const price = k === 'free' ? '$0' : '$' + p.monthly;
    const btn = k === 'free' || current ? '' : (opts.billing ? `<form method="post" action="/app/billing/checkout" class="actions"><input type="hidden" name="plan" value="${k}"><button class="btn ${k === 'solo' ? 'mark' : ''} sm" name="interval" value="monthly" type="submit">Monthly</button><button class="btn sm" name="interval" value="yearly" type="submit">Yearly, 2 months free</button></form>` : '');
    return `<div class="plan${current ? ' current' : ''}"><b>${esc(p.name)}${current ? ' <span class="pill good">Your plan</span>' : ''}</b><span class="price">${price}<span class="small muted" style="font-weight:500">${k === 'free' ? '' : ' a month'}</span></span>
<span class="small"><b>${p.keywords} keywords</b>, ${plural(p.sites, 'site')}</span><span class="small muted">${k === 'free' ? 'Checked monthly on ChatGPT, Google AI Overviews and Perplexity. Audit and suggestions; apply by copying.' : `Checked weekly on all 7 AI engines. One-click fixes to Webflow. ${p.rechecks} keyword checks on demand a month.`}${k === 'studio' || k === 'agency' ? ' Client report links with your agency name.' : ''}</span>${btn}</div>`;
  }).join('');
  const conns = (user.connections || []).map((c) => `<li><span>${esc(c.label || 'Webflow')}<span class="tiny muted">, connected ${ago(c.authorizedAt)}</span></span><form method="post" action="/app/connection/remove"><input type="hidden" name="id" value="${esc(c.id)}"><button class="btn sm ghost" type="submit">Disconnect</button></form></li>`).join('');
  return layout('Settings · AI SEO Deck', `${noticeHtml(notice)}
<div class="head"><div><h1>Settings</h1><p class="meta"><span>${esc(user.email)}</span></p></div></div>
<div class="stack">
<section class="panel stack" id="plan"><h2>Plan</h2>
${limits.complimentary ? noticeHtml('Your account has complimentary Agency access.', 'good') : ''}
<p class="small">${used} of ${plural(limits.keywords, 'keyword')} in use. ${limits.rechecks ? `${Math.max(0, limits.rechecks - (usage.rechecks || 0))} of ${limits.rechecks} keyword checks on demand left this month.` : ''}</p>
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
</div>`, { user, nav: 'settings' });
}

/* ---------- public client report ---------- */

function reportPage(owner, site, d) {
  const brandName = owner && owner.settings && owner.settings.brand && d.whiteLabel ? owner.settings.brand : '';
  return layout('AI visibility report · ' + (site.project.brand || site.name), `<div class="head"><div><h1>AI visibility of ${esc(site.project.brand || site.name)}</h1><p class="meta"><span>${esc(hostOf(site.url))}</span>${site.latest ? `<span>checked ${esc(new Date(site.latest.finishedAt || site.latest.at).toISOString().slice(0, 10))}</span>` : ''}</p></div></div>
${statStrip(site, d.history, null)}
${(site.keywords || []).length ? deckTable(site, { engines: d.engines, link: false }) : '<div class="panel empty"><p>No keywords yet.</p></div>'}`,
  { plain: true, brandName: brandName || '', footer: brandName ? `<span>Prepared by ${esc(brandName)}</span>` : '<span>Made with AI SEO Deck</span><a href="/">aiseodeck.silitlabs.com</a>' });
}

module.exports = { esc, layout, errorPage, loginPage, loginConfirm, dashboard, setupPage, sitePage, keywordPage, fixPage, settingsPage, reportPage, deckTable, highlight, lineChart, verdictText, BUSINESS_TYPES, COUNTRIES, LANGS };
