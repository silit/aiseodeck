'use strict';
// The look of the AI Visibility Report: sheets of paper on a desk. The desk follows the visitor's theme (a light
// desk by day, a navy one by night); the sheets stay paper white in both, so marker yellow always sits on paper.
// Type has three voices: Montserrat is ours, Literata is what the AI said, Shantell Sans is the pen in the margin.

const DARK = `--desk:#1B2147;--dot:rgba(170,182,255,.085);--ink:#F2F4FF;--ink2:#C5CAEE;--faint:#A4ABDB;--line:#3B4682;--panel:#252D5F;--panel2:#2C356D;--pen:#FFE9A3;
--rose:#FF9DB1;--blue:#9DB9FF;--good:#5DE3A9;--bad:#FF9A93;--warn:#F1CC83;--good-soft:rgba(93,227,169,.16);--bad-soft:rgba(255,154,147,.16);--warn-soft:rgba(241,204,131,.16);--rose-soft:rgba(255,157,177,.16);--blue-soft:rgba(157,185,255,.16);
--paper:#FAFAFE;--shadow:0 1px 0 rgba(0,0,0,.22),0 28px 54px -28px rgba(3,5,22,.85);--top:rgba(27,33,71,.86);color-scheme:dark`;

const CSS = `
:root{--desk:#E9EDF7;--dot:rgba(15,20,51,.075);--ink:#0F1433;--ink2:#3F466E;--faint:#5B628C;--line:#CFD5EA;--panel:#F6F7FC;--panel2:#FFFFFF;--pen:#23329A;
--rose:#B92D55;--blue:#2A52E8;--good:#0F7D51;--bad:#C2362F;--warn:#8A5A00;--good-soft:#DDF3E7;--bad-soft:#FBE4E2;--warn-soft:#FFF0CC;--rose-soft:#FBE3EA;--blue-soft:#E2E9FF;
--paper:#FFFFFF;--paper-ink:#141A44;--paper-muted:#4A5180;--paper-faint:#666D99;--paper-line:#DEE2F2;--paper-dim:#ECEEF8;--bubble:#EDF0FB;
--mark:#FFE14D;--mark-ink:#1B1600;--mark-edge:#DDBC14;--mark-soft:#FFF6BF;--p-rose:#C2335A;--p-blue:#2A52E8;--p-pen:#23329A;--p-good:#0F7D51;--p-bad:#C2362F;--code:#141A44;--code-ink:#E9ECFF;
--shadow:0 1px 0 rgba(15,20,51,.05),0 24px 46px -30px rgba(15,20,51,.45);--top:rgba(233,237,247,.88);
--sans:"Montserrat",system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;--serif:"Literata",Georgia,"Times New Roman",serif;--hand:"Shantell Sans","Segoe Print","Bradley Hand","Comic Sans MS",cursive;--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;
color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${DARK}}}
:root[data-theme="dark"]{${DARK}}
*,*::before,*::after{box-sizing:border-box}
[hidden]{display:none!important}
html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}
body{margin:0;background:var(--desk);background-image:radial-gradient(var(--dot) 1.1px,transparent 1.2px);background-size:22px 22px;color:var(--ink);font:450 16px/1.6 var(--sans);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
body::before{content:"";position:fixed;inset:0 0 auto;height:env(safe-area-inset-top,0px);z-index:30;background:var(--desk)}
.wrap{max-width:1180px;margin:0 auto;padding-left:max(18px,env(safe-area-inset-left,0px));padding-right:max(18px,env(safe-area-inset-right,0px))}
a{color:var(--blue);text-underline-offset:3px}
:focus-visible{outline:2.5px solid var(--blue);outline-offset:3px;border-radius:6px}
h1,h2,h3,p{margin:0}
h1,h2,h3{text-wrap:balance;letter-spacing:-.022em}
h1{font-size:clamp(31px,4.9vw,58px);line-height:1.03;font-weight:800;letter-spacing:-.032em}
h2{font-size:clamp(24px,3vw,35px);line-height:1.1;font-weight:780}
h3{font-size:18px;line-height:1.3;font-weight:700;letter-spacing:-.012em}
.sub{font-size:clamp(16px,1.5vw,18px);line-height:1.55;color:var(--ink2);max-width:64ch;text-wrap:pretty}
.tiny{font-size:13.5px;line-height:1.5;color:var(--faint)}
.center{text-align:center}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.scroll{overflow-x:auto;max-width:100%;position:relative}
mark.you{color:var(--mark-ink);background:linear-gradient(100deg,transparent .5%,var(--mark) 3%,var(--mark) 96%,transparent 99.5%) no-repeat 0 60%/100% 82%;padding:0 .2em;margin:0 -.2em;border-radius:.3em .9em .35em .8em/.8em .3em .9em .35em;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.rival{text-decoration:underline;text-decoration-color:var(--p-rose);text-decoration-thickness:2.2px;text-underline-offset:3.5px;text-decoration-skip-ink:none}
.dir{text-decoration:underline dotted;text-decoration-color:var(--p-blue);text-decoration-thickness:2px;text-underline-offset:3.5px}
/* a search the way it is typed into Google, and how often it is made in a month */
.kw-t{display:inline-flex;align-items:baseline;gap:.5em;min-width:0;font:500 14px/1.35 var(--mono);letter-spacing:-.01em;overflow-wrap:anywhere}
.kw-i{width:.92em;height:.92em;flex:none;align-self:center;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;opacity:.55}
.vol{font:750 13.5px/1.2 var(--sans);font-variant-numeric:tabular-nums;white-space:nowrap}
.vol small{font-size:12px;font-weight:550;opacity:.72}
.vol.none{font-weight:550;font-size:12.5px;opacity:.72}

/* top bar */
.top{position:sticky;top:env(safe-area-inset-top,0px);z-index:20;background:var(--top);backdrop-filter:saturate(1.3) blur(12px);-webkit-backdrop-filter:saturate(1.3) blur(12px);border-bottom:1px solid var(--line)}
.top .wrap{display:flex;justify-content:space-between;align-items:center;gap:14px;padding-block:11px}
.brand{display:inline-flex;align-items:center;gap:10px;color:var(--ink);text-decoration:none;font-weight:800;font-size:16.5px;letter-spacing:-.014em;white-space:nowrap}
.brand svg{width:27px;height:27px;flex:none}
.brand small{font-weight:600;font-size:13.5px;color:var(--faint);letter-spacing:0;border-left:1px solid var(--line);padding-left:10px}
.top nav{display:flex;gap:20px;align-items:center;font-size:14.5px;font-weight:600}
.top nav a{color:var(--ink2);text-decoration:none;white-space:nowrap}
.top nav a:hover{color:var(--ink)}
@media (max-width:700px){.top nav a.hide-s,.brand small{display:none}}

/* buttons and fields */
.btn{font:inherit;font-weight:700;font-size:15px;line-height:1.2;border-radius:12px;padding:12px 18px;cursor:pointer;border:1px solid var(--line);background:var(--panel2);color:var(--ink);text-decoration:none;display:inline-flex;gap:8px;align-items:center;justify-content:center;transition:transform .12s,filter .12s,border-color .12s}
.btn:hover{border-color:var(--faint)}
.btn:active{transform:translateY(1px)}
.btn.mark{background:var(--mark);color:var(--mark-ink);border-color:var(--mark-edge);box-shadow:0 2px 0 var(--mark-edge)}
.btn.mark:hover{filter:brightness(1.05)}
.btn.mark:active{box-shadow:none;transform:translateY(2px)}
.btn.big{font-size:17px;padding:16px 24px;border-radius:14px}
.btn.sm{font-size:13.5px;padding:8px 12px;border-radius:10px}
.btn[disabled]{opacity:.6;cursor:progress}
.btn svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linejoin:round;stroke-linecap:round}
input,select,textarea{font:inherit;font-size:16px;color:var(--paper-ink);background:var(--paper);border:1.5px solid var(--paper-line);border-radius:11px;padding:12px 13px;width:100%;min-width:0}
textarea{resize:vertical;font-family:var(--serif);font-size:17px;line-height:1.45}
input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2.5px solid var(--p-blue);outline-offset:1px;border-color:var(--p-blue)}
label{font-weight:700;font-size:14px}
.form-msg{font-size:14px;font-weight:600;color:var(--bad);min-height:0}
.form-msg:empty{display:none}
.form-msg.ok{color:var(--good)}

/* stages */
main{display:block;padding-bottom:90px;min-height:72vh}
.asking>.tiny{margin-top:34px}
.stage{padding-top:clamp(28px,5vw,56px)}
.lead{display:grid;gap:14px;margin-bottom:clamp(24px,4vw,40px);max-width:920px}
.sec{margin-top:clamp(56px,8vw,96px);scroll-margin-top:76px}
.sec>h2+.sub{margin-top:12px}
.sec>.sub{margin-bottom:26px}
.sec>h2+.sum,.sec>h2+.empty-note{margin-top:14px}
.sum{font-size:17px;font-weight:600;margin-bottom:18px;max-width:70ch}
.sum q{quotes:none;font-family:var(--serif);font-style:italic;font-weight:500}
.empty-note{color:var(--ink2);background:var(--panel);border:1px dashed var(--line);border-radius:12px;padding:14px 16px}

/* a sheet of paper */
.sheet{background:var(--paper);color:var(--paper-ink);border:1px solid var(--paper-line);border-top:4px solid var(--paper-line);border-radius:3px 14px 14px 14px;box-shadow:var(--shadow);min-width:0}
.take[data-state=named]>.sheet,.take[data-state=both]>.sheet{border-top-color:var(--mark)}
.take[data-state=cited]>.sheet{border-top-color:var(--p-blue)}
.sheet-head{display:flex;justify-content:space-between;gap:4px 16px;align-items:flex-start;padding:13px 22px 11px;border-bottom:1px dashed var(--paper-line);font-size:13px;line-height:1.4;color:var(--paper-muted)}
.sheet-who{display:grid;gap:1px;min-width:0}
.sheet-who b{font-size:15.5px;color:var(--paper-ink);font-weight:800;letter-spacing:-.01em}
.sheet-head time{font-variant-numeric:tabular-nums;font-size:12px;color:var(--paper-faint);white-space:nowrap;padding-top:3px}
@media (max-width:520px){.sheet-head{flex-direction:column}.sheet-head time{padding-top:0}}
.talk{padding:20px 22px 20px}
.ask{margin:0 0 18px auto;width:fit-content;max-width:88%;background:var(--bubble);border-radius:16px 16px 4px 16px;padding:10px 15px 11px;font-size:15.5px;line-height:1.42;font-weight:550}
.ask-by{display:block;font-size:12px;color:var(--paper-muted);font-weight:650;margin-bottom:2px}
.ask.search{font-family:var(--mono);font-size:14px;font-weight:500;border-radius:999px;padding:9px 16px 10px}
.ask.search .ask-by{font-family:var(--sans)}
.answer{font-family:var(--serif);font-size:16.5px;line-height:1.63;font-optical-sizing:auto}
.answer p{margin:0 0 .85em}
.answer ul{margin:0 0 .9em;padding-left:1.15em}
.answer li{margin:.32em 0;padding-left:.15em}
.answer .ah{font-family:var(--sans);font-weight:750;font-size:14.5px;margin-top:1.15em;letter-spacing:-.01em}
.answer>:last-child{margin-bottom:0}
.answer .more{font-family:var(--sans);font-size:13px;color:var(--paper-faint);margin-top:1em}
.answer.empty{font-family:var(--sans);font-size:15px;color:var(--paper-muted);padding:18px 0 8px}
.answer.waiting{padding:10px 0 26px}
.wait{font-family:var(--sans);font-size:15px;color:var(--paper-muted);display:flex;gap:10px;align-items:center}
.dots{display:inline-flex;gap:4px}
.dots i{width:7px;height:7px;border-radius:50%;background:var(--paper-faint);animation:dot 1.2s infinite ease-in-out}
.dots i:nth-child(2){animation-delay:.15s}.dots i:nth-child(3){animation-delay:.3s}
@keyframes dot{0%,60%,100%{opacity:.25;transform:none}30%{opacity:1;transform:translateY(-3px)}}
.shown{margin-top:20px;padding-top:14px;border-top:1px dashed var(--paper-line);display:grid;gap:13px}
.shown-h{font-size:12.5px;font-weight:700;color:var(--paper-muted);margin-bottom:6px}
.chips{list-style:none;display:flex;flex-wrap:wrap;gap:6px;padding:0;margin:0}
.chips li{font:500 12.5px/1.35 var(--mono);background:var(--paper-dim);color:var(--paper-ink);border-radius:7px;padding:4px 9px}
.chips li b{margin-left:7px;font-weight:700;color:var(--paper-muted)}
.srcs{list-style:none;display:flex;flex-wrap:wrap;gap:4px 14px;padding:0;margin:0;font-size:13.5px}
.srcs a,.srcs li{color:var(--paper-muted)}
.srcs a:hover{color:var(--p-blue)}
.srcs .own,.srcs .own a{color:var(--p-blue);font-weight:700}
.own-tag{font-size:11.5px;font-weight:700;background:var(--p-blue);color:#fff;border-radius:5px;padding:1px 6px;margin-left:6px;white-space:nowrap}

/* pen notes in the margin */
.take{display:grid;grid-template-columns:minmax(0,1fr) var(--margin,218px);column-gap:var(--gap,34px);align-items:start;position:relative}
.take[hidden]{display:none}
.notes{list-style:none;margin:0;padding:0;position:relative;font-family:var(--hand);font-variation-settings:"INFM" 55,"BNCE" 4;color:var(--pen);min-height:1px}
.note{position:relative;font-size:17px;line-height:1.28;font-weight:500;margin:26px 0 0;transform:rotate(-1.4deg);transform-origin:0 50%}
.note:nth-child(even){transform:rotate(1.1deg)}
.notes.placed .note{position:absolute;left:0;right:0;margin:0}
.arr{position:absolute;left:-36px;top:1px;width:31px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.note.inline{margin:12px 0 0 34px;font-family:var(--hand);font-variation-settings:"INFM" 55;color:var(--pen)}
@media (max-width:1020px){
  .stack,.take{--margin:0px;--gap:0px}
  .take{display:block}
  .notes{margin:16px 4px 0 40px}
  .note,.notes.placed .note{position:relative;margin:0 0 11px;top:auto!important}
  .arr{transform:rotate(58deg);left:-36px;top:-2px}
}
.take.fresh .answer>*{animation:rise .5s both;animation-delay:calc(var(--n,0)*70ms)}
.take.fresh mark.you{background-size:0% 82%;animation:swipe .6s cubic-bezier(.3,.7,.2,1) .75s forwards}
.take.fresh .rival,.take.fresh .dir{text-decoration-color:transparent;animation:under .4s 1.2s forwards}
.take.fresh .note{opacity:0;animation:jot .5s cubic-bezier(.2,.8,.2,1) forwards;animation-delay:calc(1.5s + var(--n,0)*.22s)}
.take.fresh .shown{animation:rise .5s .9s both}
@keyframes rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes swipe{to{background-size:100% 82%}}
@keyframes under{to{text-decoration-color:var(--p-rose)}}
.take.fresh .dir{animation-name:underb}
@keyframes underb{to{text-decoration-color:var(--p-blue)}}
@keyframes jot{from{opacity:0;translate:10px 0}to{opacity:1;translate:0 0}}

/* index tabs on a stack of sheets */
.stack{min-width:0}
.tabs{display:flex;gap:5px;padding:6px 10px 0 2px;overflow-x:auto;scrollbar-width:none;position:relative;z-index:2;max-width:calc(100% - var(--tabs-inset,0px))}
.tabs::-webkit-scrollbar{display:none}
.tab{flex:none;font:650 13.5px/1 var(--sans);padding:11px 14px 12px;border:1px solid var(--paper-line);border-bottom:0;border-radius:10px 10px 0 0;background:var(--paper-dim);color:var(--paper-muted);cursor:pointer;display:inline-flex;gap:8px;align-items:center;transform:translateY(5px);transition:transform .16s}
.tab:hover{transform:translateY(2px)}
.tab[aria-selected=true]{transform:none;color:var(--paper-ink);font-weight:800;background:var(--paper)}
.tab.is-named{background:var(--mark);color:var(--mark-ink);border-color:var(--mark-edge)}
.tab.is-half{background:linear-gradient(108deg,var(--mark) 0 52%,var(--paper-dim) 52% 100%);color:var(--mark-ink)}
.tab.is-half[aria-selected=true]{background:linear-gradient(108deg,var(--mark) 0 52%,var(--paper) 52% 100%)}
.tab.is-cited{box-shadow:inset 0 3px 0 var(--p-blue)}
.tab.is-none,.tab.is-failed{border-style:dashed;color:var(--paper-faint)}
.tab.is-pending .tab-n::after{content:"";display:inline-block;width:1.1em;text-align:left;animation:ell 1.2s steps(4,end) infinite}
@keyframes ell{0%{content:""}25%{content:"."}50%{content:".."}75%{content:"..."}}
.tab:focus-visible{outline-offset:-3px}
.panels{position:relative;z-index:0}
/* the other answers wait underneath, like a stack of paper */
.stack:not(.twice) .take>.sheet{position:relative}
.stack:not(.twice) .take>.sheet::before,.stack:not(.twice) .take>.sheet::after{content:"";position:absolute;z-index:-1;inset:16px -1px -8px -1px;background:var(--paper);border:1px solid var(--paper-line);border-radius:3px 14px 14px 14px;box-shadow:var(--shadow);transform:rotate(.9deg);transform-origin:50% 100%;opacity:.85}
.stack:not(.twice) .take>.sheet::after{transform:rotate(-.7deg) translateY(1px);opacity:.6}
.stack{margin-bottom:14px}
@media (max-width:1020px){.stack:not(.twice) .take>.sheet::before{transform:none;inset:12px 7px -6px 7px}.stack:not(.twice) .take>.sheet::after{transform:none;inset:12px 14px -11px 14px}}
.panel[hidden]{display:none}
.pips{display:inline-flex;gap:3px;align-items:center}
.pip{width:11px;height:11px;border-radius:50%;border:1.6px solid currentColor;display:inline-block;flex:none;opacity:.55}
.pip.on{background:var(--mark);border-color:var(--mark-ink);opacity:1}
.tab.is-named .pip.on,.tab.is-half .pip.on{background:var(--mark-ink)}
.pip.na{border:0;width:9px;height:2px;border-radius:2px;background:currentColor;opacity:.45}
.pip.wait{border:0;background:currentColor;opacity:.2;transform:scale(.45);animation:pulse 1.3s infinite ease-in-out}
@keyframes pulse{0%,100%{opacity:.14}50%{opacity:.42}}
.asks{display:flex;flex-wrap:wrap;gap:6px 8px;align-items:center;margin:0 0 12px;padding-top:14px}
.ask-b{font:650 13px/1 var(--sans);padding:8px 12px;border-radius:999px;border:1px solid var(--line);background:transparent;color:var(--ink2);cursor:pointer}
.ask-b[aria-pressed=true]{background:var(--ink);color:var(--desk);border-color:var(--ink)}
.asks-note{font-size:13.5px;color:var(--faint);margin-left:4px}
.panel>.asks+.take>.sheet{border-radius:14px}

/* the form that starts a free check */
.go{display:grid;gap:10px;max-width:520px}
.go-row{display:flex;gap:8px;background:var(--paper);border:1.5px solid var(--paper-line);border-radius:16px;padding:6px;box-shadow:var(--shadow)}
.go-row:focus-within{border-color:var(--p-blue)}
.go-row input{border:0;background:transparent;padding:12px 12px;font-size:17px;font-weight:550}
.go-row input:focus-visible{outline:none}
.go-row .btn{flex:none;border-radius:11px}
@media (max-width:480px){.go-row{flex-direction:column}.go-row .btn{width:100%}}
.reading{list-style:none;margin:6px 0 0;padding:0;display:grid;gap:7px;font-size:15px;font-weight:600;color:var(--ink2)}
.reading li{display:flex;gap:10px;align-items:center;opacity:.4;transition:opacity .3s}
.reading li.now,.reading li.done{opacity:1}
.reading li::before{content:"";width:9px;height:9px;border-radius:50%;border:1.8px solid currentColor;flex:none}
.reading li.done::before{background:var(--mark);border-color:var(--mark-edge)}
.reading li.now::before{animation:dot 1.1s infinite}

/* stage: what we read */
.draft-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.06fr);gap:36px 44px;align-items:start}
@media (max-width:900px){.draft-grid{grid-template-columns:minmax(0,1fr)}}
.form.sheet{padding:24px 24px 26px;display:grid;gap:20px;border-radius:14px;border-top-width:1px;color-scheme:light}
.field{display:grid;gap:7px}
.hint{font-size:13.5px;line-height:1.5;color:var(--paper-muted)}
.hint.pen{font-family:var(--hand);font-variation-settings:"INFM" 55;font-size:16px;color:var(--p-pen);line-height:1.3}
.searches{border:0;margin:0;padding:0;min-width:0;display:block}
.searches legend{padding:0;font-weight:700;font-size:14px}
.searches .hint{margin-top:7px}
.kw-list{display:grid;gap:6px;margin-top:10px}
.kw{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:5px 10px;align-items:center;padding:10px 12px;border:1.5px solid var(--paper-line);border-radius:11px;cursor:pointer;font-weight:500;color:var(--paper-ink)}
.kw:hover{border-color:var(--paper-faint)}
.kw:has(input:checked){border-color:var(--mark-edge);background:var(--mark-soft)}
.kw input{width:17px;height:17px;margin:0;padding:0;border:0;border-radius:50%;accent-color:var(--p-blue)}
.kw[style]::after{content:"";grid-column:2/-1;height:3px;border-radius:2px;background:linear-gradient(to right,var(--mark-edge) var(--w,0%),var(--paper-dim) var(--w,0%))}
.kw:has(input:checked)[style]::after{background:linear-gradient(to right,var(--mark-ink) var(--w,0%),rgba(27,22,0,.13) var(--w,0%))}
.searches.stale .vol{visibility:hidden}
.searches.stale .kw::after,.searches.stale .vol-note,.searches.stale .left-out{display:none}
.hint.stale{font-weight:600;color:var(--paper-ink)}
.left-out{font-size:12.5px}
.searched{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;font-size:14.5px;font-weight:550;color:var(--ink2)}
.searched-l{font-size:13px;font-weight:700;color:var(--faint)}
.searched .kw-t{background:var(--panel2);color:var(--ink);border:1px solid var(--line);border-radius:999px;padding:6px 14px 7px 12px;font-size:14.5px}
.form.sheet .btn.big{width:100%}
.form.sheet .tiny{color:var(--paper-faint);text-align:center;margin-top:-8px}
.side-h{font-size:14px;font-weight:700;color:var(--ink2);margin-bottom:14px}
.draft-side .take,.finding-grid .take,.crawl-grid .take{--margin:170px}
@media (max-width:1020px){.draft-side .take,.finding-grid .take,.crawl-grid .take{--margin:0px}}

/* what a crawler reads */
.sheet.plain{border-radius:14px;border-top-width:1px}
.raw{padding:18px 22px 6px;font-family:var(--mono);font-size:13.5px;line-height:1.62;color:var(--paper-ink);display:grid;gap:10px}
.raw-t{font-weight:700}
.raw-x{color:var(--paper-muted);overflow-wrap:anywhere}
.raw .none{color:var(--p-bad);font-style:italic}
.raw-n{padding:10px 22px 16px;font-size:13px;font-weight:700;color:var(--paper-muted);font-variant-numeric:tabular-nums}
.take.crawl[data-state=bad] .sheet{border-color:var(--p-bad);border-style:dashed}
.take.crawl[data-state=bad] .raw{min-height:120px}

/* stage: the free result */
.also{margin-top:clamp(40px,6vw,64px)}
.also h2,.finding h2{font-size:clamp(21px,2.4vw,26px);margin-bottom:16px}
.voice{list-style:none;padding:0;margin:0 0 12px;display:flex;flex-wrap:wrap;gap:10px}
.voice li{background:var(--paper);color:var(--paper-ink);border:1px solid var(--paper-line);border-radius:12px;padding:10px 14px;display:grid;gap:1px;font-weight:700;font-size:15.5px}
.voice .vn{font-size:12.5px;font-weight:600;color:var(--paper-muted)}
.voice .me.out mark.you{background:none;color:inherit;text-decoration:line-through;text-decoration-color:var(--paper-faint)}
.finding{margin-top:clamp(40px,6vw,64px)}
.finding-grid,.crawl-grid{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:30px 44px;align-items:start}
@media (max-width:900px){.finding-grid,.crawl-grid{grid-template-columns:minmax(0,1fr)}}
.found{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:20px 22px;display:grid;gap:9px}
.found-n{font-size:13.5px;font-weight:700;color:var(--warn)}
.found p{color:var(--ink2)}
.unlock{margin-top:clamp(48px,7vw,84px);display:grid;grid-template-columns:minmax(0,.92fr) minmax(0,1.1fr);gap:30px 52px;align-items:start;background:var(--panel);border:1px solid var(--line);border-radius:22px;padding:clamp(22px,4vw,44px);scroll-margin-top:80px}
@media (max-width:900px){.unlock{grid-template-columns:minmax(0,1fr)}}
.unlock-text{display:grid;gap:14px;position:sticky;top:86px}
@media (max-width:900px){.unlock-text{position:static}}
.buy{display:grid;gap:10px;justify-items:start;margin-top:8px}
.holds{list-style:none;margin:0;padding:0;display:grid;gap:0}
.holds li{display:grid;grid-template-columns:30px minmax(0,1fr);gap:12px;padding:15px 0;border-top:1px dashed var(--line)}
.holds li:first-child{border-top:0;padding-top:0}
.holds b{font-size:16.5px;font-weight:750;letter-spacing:-.01em}
.holds p{color:var(--ink2);font-size:15px;line-height:1.5;margin-top:2px}
.hold-t{color:var(--ink2);font-size:15px;line-height:1.5;margin-top:2px}
.more-q{display:block;margin-top:8px;font-weight:650;font-size:13.5px}
.more-qs{list-style:none;margin:6px 0 0;padding:0;display:grid;gap:0;max-width:440px}
.more-qs li{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:baseline;gap:2px 14px;padding:6px 0;border-top:1px dashed var(--line);color:var(--ink)}
.more-qs li:first-child{border-top:0}
.more-qs .kw-t{font-size:13.5px}
.hold-lock{width:30px;height:30px;border-radius:9px;background:var(--panel2);border:1px solid var(--line);display:grid;place-items:center;color:var(--faint)}
.hold-lock svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linejoin:round}
.paying-t{display:flex;gap:12px;align-items:center;font-weight:650;background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.paying-t .dots i{background:var(--ink2)}
.plan.paid .tiny{color:var(--paper-muted)}
.mail{display:grid;gap:8px;max-width:460px}
.mail label{font-weight:600;font-size:14.5px;color:var(--ink2)}
.mail-row{display:flex;gap:8px;flex-wrap:wrap}
.mail-row input{flex:1 1 200px}
.mail-set{font-size:14.5px;font-weight:600;color:var(--good)}

/* stage: building */
.build-grid{display:grid;grid-template-columns:minmax(0,340px) minmax(0,1fr);gap:30px 48px;align-items:start}
@media (max-width:860px){.build-grid{grid-template-columns:minmax(0,1fr)}}
.steps{list-style:none;margin:0;padding:0;display:grid;gap:0;counter-reset:st}
.steps li{counter-increment:st;display:grid;grid-template-columns:30px minmax(0,1fr);gap:12px;align-items:center;line-height:1.35;padding:11px 0;font-weight:600;color:var(--faint);border-top:1px dashed var(--line)}
.steps li:first-child{border-top:0}
.steps li::before{content:counter(st);width:28px;height:28px;border-radius:50%;border:1.5px solid var(--line);display:grid;place-items:center;font-size:13px;font-weight:700}
.steps li.done{color:var(--ink2)}
.steps li.done::before{content:"";background:var(--mark) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M4 8.5l2.6 2.6L12 5.6' fill='none' stroke='%231B1600' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/16px no-repeat;border-color:var(--mark-edge)}
.steps li.now{color:var(--ink)}
.steps li.now::before{border-color:var(--ink);animation:dot 1.3s infinite}
.step-n{font-variant-numeric:tabular-nums;font-weight:700;color:var(--ink2);margin-left:6px;white-space:nowrap}
.build-side{display:grid;grid-template-columns:minmax(0,1fr);gap:26px;min-width:0}
.leave{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px 20px;display:grid;gap:12px}
.leave>p{font-weight:600}

/* the question by engine table */
.matrix{border-collapse:separate;border-spacing:0;width:100%;min-width:520px;background:var(--paper);color:var(--paper-ink);border:1px solid var(--paper-line);border-radius:14px;overflow:hidden;font-size:14.5px}
.matrix th,.matrix td{padding:12px 10px;text-align:center;border-top:1px solid var(--paper-line)}
.matrix thead th{border-top:0;font-size:12.5px;font-weight:700;color:var(--paper-muted);line-height:1.25}
.matrix.has-v{min-width:620px}
.matrix .mq{text-align:left;font-weight:500;line-height:1.35;min-width:170px;padding-left:16px}
.matrix .mq .kw-t{font-size:13.5px}
.matrix thead .mq{font-family:var(--sans);font-size:12.5px;font-weight:700}
.matrix .mv{text-align:right;font-weight:750;font-variant-numeric:tabular-nums;white-space:nowrap;padding-right:14px}
.matrix thead .mv{white-space:normal;min-width:76px;font-weight:700}
.matrix .mt{font-weight:800;white-space:nowrap;font-variant-numeric:tabular-nums}
.matrix .pips{justify-content:center;color:var(--paper-faint)}
.matrix .pip{width:13px;height:13px}
.matrix .pip.na{width:11px;height:2px}
.legend{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:13px;color:var(--faint);margin-top:10px;align-items:center}
.legend span{display:inline-flex;gap:6px;align-items:center}
.legend .pip.on{border-color:var(--mark-edge)}

/* the report */
.rep-head{display:grid;gap:14px}
.rep-meta{font-size:14px;font-weight:650;color:var(--faint)}
.rep-acts{display:flex;gap:8px;flex-wrap:wrap}
.print-only{display:none}
.rep-facts{display:flex;flex-wrap:wrap;gap:22px 40px;align-items:center;margin-top:12px;padding:20px 22px;background:var(--panel);border:1px solid var(--line);border-radius:16px}
.score{display:flex;gap:22px;align-items:center;flex-wrap:wrap}
.score-n{display:flex;align-items:baseline;gap:7px}
.score-n b{font-size:50px;line-height:1;font-weight:800;letter-spacing:-.04em;font-variant-numeric:tabular-nums}
.score-n span{font-size:14px;font-weight:650;color:var(--faint)}
.score-parts{display:grid;gap:6px;min-width:250px}
.sp{display:grid;grid-template-columns:96px minmax(60px,1fr) auto;gap:10px;align-items:center;font-size:13px}
.sp-l{font-weight:700}
.sp-bar{height:8px;border-radius:5px;background:var(--line);overflow:hidden}
.sp-bar i{display:block;height:100%;background:var(--mark);border-radius:5px;box-shadow:inset 0 0 0 1px var(--mark-edge)}
.sp-w{color:var(--faint);font-variant-numeric:tabular-nums;white-space:nowrap}
.facts{list-style:none;margin:0;padding:0;display:grid;gap:5px;font-size:14.5px;font-weight:600;flex:1 1 260px}
.facts li{display:grid;grid-template-columns:92px minmax(0,1fr);gap:0 8px;align-items:baseline}.facts span{font-weight:650;color:var(--faint);font-size:13px}
.top3{margin-top:22px;display:grid;gap:10px}
.top3 h2{font-size:17px;letter-spacing:-.01em}
.top3 ol{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,250px),1fr));gap:10px;counter-reset:t3}
.top3 li{counter-increment:t3}
.top3 a{display:grid;grid-template-columns:30px minmax(0,1fr);gap:4px 12px;align-items:start;height:100%;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px;color:var(--ink);text-decoration:none;font-weight:700;line-height:1.3}
.top3 a:hover{border-color:var(--faint)}
.top3 a::before{content:counter(t3);grid-row:span 2;width:30px;height:30px;border-radius:50%;background:var(--mark);color:var(--mark-ink);border:1px solid var(--mark-edge);display:grid;place-items:center;font-size:14px;font-weight:800}
.top3 small{font-size:13px;font-weight:600;color:var(--faint)}
.toc{position:sticky;top:calc(env(safe-area-inset-top,0px) + 52px);z-index:10;margin-top:26px;background:var(--top);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid var(--line);border-radius:12px}
.toc ul{list-style:none;display:flex;gap:2px;margin:0;padding:5px;overflow-x:auto;scrollbar-width:none}
.toc ul::-webkit-scrollbar{display:none}
.toc a{display:block;white-space:nowrap;padding:7px 11px;border-radius:8px;font-size:13.5px;font-weight:650;color:var(--ink2);text-decoration:none}
.toc a:hover,.toc a.on{background:var(--panel2);color:var(--ink)}

.ladder{list-style:none;margin:8px 0 0;padding:84px 0 0;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px}
.rung{background:var(--panel) linear-gradient(90deg,var(--mark) var(--p,0%),var(--line) 0) top/100% 5px no-repeat;border:1px solid var(--line);border-top:0;border-radius:5px 5px 14px 14px;padding:18px 14px 16px;display:grid;gap:6px;align-content:start;transform:translateY(calc(var(--i)*-21px));min-width:0}
.rung-top{display:flex;justify-content:space-between;gap:8px;align-items:baseline;flex-wrap:wrap}
.rung-name{font-weight:800;font-size:18px;letter-spacing:-.02em}
.rung-state{font-size:12.5px;font-weight:750;border-radius:999px;padding:3px 9px;background:var(--line);white-space:nowrap}
.rung-q{font-size:13.5px;line-height:1.4;color:var(--ink2);font-weight:550}
.rung-e{font-size:13px;line-height:1.45;color:var(--faint)}
.rung.is-yes .rung-state{background:var(--mark);color:var(--mark-ink)}
.rung.is-partly .rung-state{background:var(--warn-soft);color:var(--warn)}
.rung.is-no{background-image:linear-gradient(var(--bad),var(--bad));border-style:dashed}
.rung.is-no .rung-state{background:var(--bad-soft);color:var(--bad)}
.rung.start{background-color:var(--panel2);box-shadow:0 0 0 2px var(--pen)}
.rung .note.inline{margin:6px 0 0 30px;font-size:16px}
.rung .note.inline .arr{transform:rotate(58deg);left:-32px;top:-3px}
@media (max-width:900px){.ladder{grid-template-columns:minmax(0,1fr);gap:8px;padding-top:0}.rung{transform:none;margin-left:calc(var(--i)*10px)}}

.topic{margin-top:14px;scroll-margin-top:110px;border-top:1px solid var(--line)}
.matrix+.legend+.topic,.legend+.topic{margin-top:34px}
.topic>summary{width:auto;list-style:none;display:flex;justify-content:space-between;align-items:baseline;gap:8px 24px;flex-wrap:wrap;padding:18px 0 16px;color:var(--ink);cursor:pointer}
.topic>summary::-webkit-details-marker{display:none}
.topic>summary h3{font-size:clamp(16px,1.9vw,20px);line-height:1.3;letter-spacing:0;flex:1 1 300px;min-width:0;display:flex;align-items:baseline}
.topic>summary h3 .kw-t{font-size:inherit;font-weight:600}
.topic>summary h3 .kw-i{display:none}
.topic>summary h3::before{flex:none}
.topic-f{display:inline-flex;flex-wrap:wrap;gap:6px 10px;align-items:center}
.topic-v{font-size:13.5px;color:var(--ink2);border:1px solid var(--line);background:var(--panel2);border-radius:999px;padding:4px 11px}
.topic>summary h3::before{content:"";display:inline-block;width:.5em;height:.5em;border-right:2.5px solid var(--faint);border-bottom:2.5px solid var(--faint);transform:rotate(-45deg);margin-right:.7em;vertical-align:.12em;transition:transform .15s}
.topic[open]>summary h3::before{transform:rotate(45deg)}
.topic[open]>summary{margin-bottom:0}
.topic-n{font-family:var(--sans);font-size:13.5px;font-weight:650;color:var(--mark-ink);background:var(--mark);border-radius:999px;padding:4px 11px;white-space:nowrap}
.topic-n.zero{background:var(--panel2);color:var(--ink2);border:1px solid var(--line)}
.topic-k{font-size:13.5px;color:var(--faint);margin:0 0 14px;max-width:86ch}
.topic-k q{quotes:none;font-family:var(--serif);font-style:italic;font-size:15.5px;color:var(--ink)}
/* where the searches are made and where the business is missing */
.demand{list-style:none;margin:0 0 14px;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,270px),1fr));gap:12px}
.demand li{background:var(--panel);border:1px solid var(--line);border-left:4px solid var(--line);border-radius:4px 14px 14px 4px;padding:13px 16px 15px;display:grid;gap:7px;align-content:start;min-width:0}
.demand li.gap{border-left-color:var(--rose)}
.demand li.won{border-left-color:var(--mark-edge)}
.dm-l{font-size:12.5px;font-weight:700;color:var(--faint)}
.dm-k{color:var(--ink);text-decoration:none;justify-self:start;max-width:100%}
.dm-k .kw-t{font-size:15px;font-weight:600}
.dm-k:hover .kw-t>span{text-decoration:underline;text-underline-offset:3px}
.dm-f{display:flex;flex-wrap:wrap;gap:4px 14px;align-items:baseline}
.dm-n{font-size:13.5px;font-weight:650;color:var(--ink2)}
.demand .note.inline{margin:4px 0 0 34px;font-size:16px;transform:rotate(-1deg)}
.demand .note.inline .arr{transform:rotate(58deg);left:-32px;top:-3px}
.dm-aside{margin:0 0 22px;max-width:78ch}
.demand+.scroll{margin-top:22px}
.others{margin-top:30px;padding-top:24px;border-top:1px solid var(--line)}
.others .tiny{margin-top:6px;max-width:74ch}
.kw-more{list-style:none;margin:14px 0 0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:0 36px;max-width:880px}
.kw-more li{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:baseline;gap:2px 14px;padding:9px 0;border-bottom:1px dashed var(--line)}
.topic[open]{padding-bottom:26px}
.askit{margin-top:16px;font-size:14px;color:var(--faint);max-width:70ch}

.bars{list-style:none;margin:0;padding:0;display:grid;gap:9px;max-width:820px}
.bars li{display:grid;grid-template-columns:minmax(120px,240px) minmax(60px,1fr) 110px;gap:14px;align-items:center;background:var(--paper);color:var(--paper-ink);border:1px solid var(--paper-line);border-radius:12px;padding:11px 16px}
.bar-name{font-weight:700;font-size:15.5px;min-width:0;overflow-wrap:anywhere}
.bar{height:10px;background:var(--paper-dim);border-radius:6px;overflow:hidden}
.bar i{display:block;height:100%;background:var(--p-rose);border-radius:6px}
.bars .me .bar i{background:var(--mark);box-shadow:inset 0 0 0 1px var(--mark-edge)}
.bar-n{font-size:13.5px;font-weight:700;text-align:right;font-variant-numeric:tabular-nums;line-height:1.25}
.bar-n small{display:block;font-weight:600;color:var(--paper-muted);font-size:12px}
@media (max-width:560px){.bars li{grid-template-columns:minmax(0,1fr) auto;row-gap:8px}.bars .bar{grid-column:1/-1;grid-row:2}}

.pages{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.page{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,.62fr) minmax(0,1fr);gap:8px 20px;align-items:center;background:var(--paper);color:var(--paper-ink);border:1px solid var(--paper-line);border-left:4px solid var(--paper-line);border-radius:4px 12px 12px 4px;padding:12px 16px}
.page.gap{border-left-color:var(--p-rose)}
.page-main{display:grid;gap:2px;min-width:0}
.page-main a,.page-main>span:first-child{font-weight:700;font-size:15px;color:var(--paper-ink);text-decoration-color:var(--paper-line);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.page-main a:hover{color:var(--p-blue)}
.page-host{font-size:12.5px;color:var(--paper-muted)}
.page-use{font-size:13px;color:var(--paper-muted);font-variant-numeric:tabular-nums}
.page-who{display:flex;flex-wrap:wrap;gap:4px 10px;font-size:13.5px;align-items:baseline}
.page-who .miss{font-weight:750;color:var(--p-rose)}
.page-who mark.you{font-weight:750}
.page-who .on-it,.page-who .na{color:var(--paper-muted)}
@media (max-width:760px){.page{grid-template-columns:minmax(0,1fr)}}
.fanout,.says,.claims{margin-top:30px;display:grid;gap:9px}
.fanout .chips li,.chips.big li{background:var(--panel2);color:var(--ink);border:1px solid var(--line);font-size:13.5px;padding:6px 11px}
.fanout .chips li b{color:var(--faint)}
.chips.big li{font-family:var(--serif);font-style:italic;font-size:15.5px;border-radius:999px}

.knows{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,250px),1fr));gap:12px}
.know{background:var(--paper);color:var(--paper-ink);border:1px solid var(--paper-line);border-top:4px solid var(--paper-line);border-radius:3px 12px 12px 12px;padding:14px 16px 16px;display:grid;gap:8px;align-content:start}
.know-top{display:flex;justify-content:space-between;gap:10px;align-items:baseline}
.know-state{font-size:12.5px;font-weight:750;border-radius:999px;padding:3px 9px;background:var(--paper-dim);white-space:nowrap}
.know.is-ok{border-top-color:var(--mark)}.know.is-ok .know-state{background:var(--mark);color:var(--mark-ink)}
.know.is-mid .know-state{background:#FFF0CC;color:#7A4E00}
.know.is-bad{border-top-color:var(--p-bad)}.know.is-bad .know-state{background:#FBE4E2;color:var(--p-bad)}
.quote{font-family:var(--serif);font-size:15.5px;line-height:1.5;color:var(--paper-muted)}
.claims ul{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.claims li{background:var(--warn-soft);border-radius:12px;padding:11px 15px;display:grid;gap:2px}
.claim{font-family:var(--serif);font-size:16px;line-height:1.45;font-weight:500}
.claim-by{font-size:12.5px;font-weight:650;color:var(--warn)}
details{margin-top:22px}
summary{cursor:pointer;font-weight:700;font-size:15px;color:var(--blue);padding:6px 0;width:fit-content}
details[open]>summary{margin-bottom:12px}

.crawl-side{display:grid;grid-template-columns:minmax(0,1fr);gap:14px;min-width:0}
.bots{border-collapse:separate;border-spacing:0;width:100%;min-width:430px;font-size:13.5px;background:var(--paper);color:var(--paper-ink);border:1px solid var(--paper-line);border-radius:12px;overflow:hidden}
.bots th,.bots td{text-align:left;padding:8px 12px;border-top:1px solid var(--paper-line);font-weight:500}
.bots thead th{border-top:0;font-size:12px;font-weight:700;color:var(--paper-muted)}
.bots tbody th{font-family:var(--mono);font-size:12.5px;font-weight:600}
.bots .grp th{font-family:var(--sans);font-size:12.5px;font-weight:700;background:var(--paper-dim);color:var(--paper-muted)}
.bot-s{font-weight:700;color:var(--p-good);white-space:nowrap}
.bots .blocked .bot-s{color:var(--p-bad)}
.bots .blocked th{text-decoration:line-through;text-decoration-color:var(--p-bad)}
.files{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:7px;font-size:13px;font-weight:650}
.files li{border-radius:999px;padding:5px 11px;background:var(--panel);border:1px solid var(--line)}
.files .ok{background:var(--good-soft);color:var(--good);border-color:transparent}
.files .bad{background:var(--bad-soft);color:var(--bad);border-color:transparent}
.files .mid{background:var(--warn-soft);color:var(--warn);border-color:transparent}
.audit-pages{list-style:none;margin:0;padding:0;display:grid;gap:8px;font-size:14px}
.audit-pages>li{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 14px;display:flex;flex-wrap:wrap;gap:4px 14px;align-items:baseline}
.audit-pages b{font-family:var(--mono);font-size:13px}
.audit-pages span{color:var(--faint);font-size:13px}
.audit-pages ul{flex-basis:100%;margin:2px 0 0;padding-left:18px;color:var(--ink2)}
.audit-pages .fine{color:var(--good)}

.fix-bar{display:flex;flex-wrap:wrap;gap:10px 18px;justify-content:space-between;align-items:center;margin-bottom:16px}
.fix-prog{font-size:14.5px;font-weight:650;color:var(--ink2)}
.fixes{list-style:none;margin:0;padding:0;display:grid;gap:14px}
.fix{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:20px 22px 22px;display:grid;gap:13px;min-width:0;scroll-margin-top:110px}
.fix.is-done{opacity:.62}
.fix.is-done h3{text-decoration:line-through;text-decoration-thickness:1.5px}
.fix-head{display:grid;grid-template-columns:38px minmax(0,1fr) auto;gap:14px;align-items:start}
.fix-n{width:38px;height:38px;border-radius:50%;background:var(--mark);color:var(--mark-ink);border:1px solid var(--mark-edge);display:grid;place-items:center;font-weight:800;font-size:16px;font-variant-numeric:tabular-nums}
.fix-title{display:grid;gap:5px;min-width:0}
.fix-meta{display:flex;flex-wrap:wrap;gap:5px 7px;font-size:12.5px;font-weight:650;color:var(--ink2)}
.fix-meta span{border:1px solid var(--line);border-radius:999px;padding:2px 9px;white-space:nowrap}
.fix-meta .w-you{background:var(--blue-soft);border-color:transparent;color:var(--blue)}
.done{display:inline-flex;gap:7px;align-items:center;font-size:13.5px;font-weight:650;cursor:pointer;color:var(--ink2);white-space:nowrap}
.done input{width:19px;height:19px;padding:0;accent-color:#DDBC14}
.fix-why{color:var(--ink2);max-width:76ch}
.fix-steps{margin:0;padding-left:22px;display:grid;gap:5px;max-width:76ch}
.fix-note{font-family:var(--hand);font-variation-settings:"INFM" 55;color:var(--pen);font-size:16.5px;line-height:1.3;max-width:70ch}
.asset{border-radius:12px;overflow:hidden;border:1px solid var(--line);min-width:0}
.asset-top{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:7px 8px 7px 14px;background:var(--panel2);font-size:13px;font-weight:700}
.copy{font:inherit;font-size:13px;font-weight:700;display:inline-flex;gap:6px;align-items:center;border:1px solid var(--line);background:transparent;color:var(--ink);border-radius:8px;padding:6px 10px;cursor:pointer}
.copy:hover{border-color:var(--faint)}
.copy svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linejoin:round}
.asset pre{margin:0;padding:15px 16px;max-height:340px;overflow:auto;font:12.8px/1.6 var(--mono);background:var(--code);color:var(--code-ink);white-space:pre;tab-size:2}
.asset pre.text{white-space:pre-wrap;font-family:var(--serif);font-size:15.5px;line-height:1.55;background:var(--paper);color:var(--paper-ink)}
.ai-note{font-size:13px;color:var(--faint)}
@media (max-width:560px){.fix-head{grid-template-columns:38px minmax(0,1fr)}.done{grid-column:2}}

.method{margin:16px 0 0;padding-left:20px;display:grid;gap:9px;max-width:78ch;color:var(--ink2)}
.again,.compare{margin-top:clamp(48px,7vw,80px);background:var(--panel);border:1px solid var(--line);border-radius:20px;padding:clamp(20px,3.6vw,36px);display:grid;gap:14px;justify-items:start}
.again-now{display:grid;gap:8px;justify-items:start}
.cmp{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr));gap:10px;width:100%}
.cmp li{background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:12px 14px;display:grid;gap:2px}
.cmp span{font-size:13px;font-weight:650;color:var(--faint)}
.cmp b{font-size:17px;font-variant-numeric:tabular-nums}
.delta{font-size:13.5px;font-weight:750}
.delta.up{color:var(--good)}.delta.down{color:var(--bad)}
.cmp-rungs{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:6px 16px;font-size:14px;color:var(--ink2)}
.cmp-rungs .moved{color:var(--ink);font-weight:650}

/* landing */
.hero{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr);gap:40px 56px;align-items:start;padding-top:clamp(30px,5.5vw,68px)}
.hero-text{display:grid;gap:20px;padding-top:clamp(0px,2vw,26px)}
.hero h1{font-size:clamp(36px,5.6vw,68px)}
.hero .stack{--margin:186px;--gap:32px}
.hero .answer{max-height:21.5em;overflow:hidden;-webkit-mask-image:linear-gradient(#000 calc(100% - 3.4em),transparent);mask-image:linear-gradient(#000 calc(100% - 3.4em),transparent)}
.hero .shown,.hero .note[data-on=srcs],.hero .note[data-on=qs],.hero .note[data-on=dir]{display:none}
@media (max-width:1020px){.hero .stack{--margin:0px;--gap:0px}}
.hero-demo{min-width:0}
.hero .take>.sheet{min-height:585px}
#hero-demo{min-height:600px}
.js #hero-demo:not(.ready){visibility:hidden}
.demo-cap{font-size:13px;color:var(--faint);margin-top:14px;display:flex;gap:12px;flex-wrap:wrap;align-items:center}
.demo-cap button{font:inherit;font-weight:700;font-size:13px;color:var(--blue);background:none;border:0;padding:0;cursor:pointer;text-decoration:underline;text-underline-offset:3px}
@media (max-width:1020px){.hero{grid-template-columns:minmax(0,1fr)}}
.band{margin-top:clamp(64px,9vw,120px);scroll-margin-top:70px}
.band>h2{max-width:20ch}
.band>.sub{margin-top:14px}
.skip{list-style:none;margin:34px 0 0;padding:0;display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:16px}
.skip>li{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:22px;display:grid;gap:10px;align-content:start;min-width:0;grid-column:span 2}
.skip h3{font-size:19px}
.skip p{color:var(--ink2);font-size:15.5px}
.skip .show{margin-top:8px;min-width:0}
@media (max-width:960px){.skip{grid-template-columns:repeat(2,minmax(0,1fr))}.skip>li{grid-column:auto}}
@media (max-width:640px){.skip{grid-template-columns:minmax(0,1fr)}}
.mini-kw{display:grid;gap:6px}
.mini-kw span{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:1px 12px;align-items:baseline;background:var(--paper);color:var(--paper-ink);border:1px solid var(--paper-line);border-left:4px solid var(--paper-line);border-radius:3px 9px 9px 3px;padding:8px 12px}
.mini-kw b{font:500 13px/1.35 var(--mono)}
.mini-kw i{font-style:normal;font-weight:750;font-size:13px;font-variant-numeric:tabular-nums;white-space:nowrap}
.mini-kw em{grid-column:1/-1;font-style:normal;font-size:12.5px;font-weight:600;color:var(--paper-muted)}
.mini-kw .gap{border-left-color:var(--p-rose)}
.mini-kw .gap em{color:var(--p-rose)}
.mini-tabs{display:flex;gap:5px;flex-wrap:wrap}
.mini-tabs .tab{transform:none;cursor:default;border-bottom:1px solid var(--paper-line);border-radius:9px}
.mini-pages{list-style:none;margin:0;padding:0;display:grid;gap:6px;font-size:13.5px}
.mini-pages li{display:flex;justify-content:space-between;gap:10px;background:var(--paper);color:var(--paper-ink);border:1px solid var(--paper-line);border-left:4px solid var(--paper-line);border-radius:3px 9px 9px 3px;padding:8px 12px;font-weight:650}
.mini-pages .gap{border-left-color:var(--p-rose)}
.mini-pages .gap span{color:var(--p-rose)}
.mini-raw{background:var(--paper);color:var(--paper-ink);border:1.5px dashed var(--p-bad);border-radius:10px;padding:14px;font:13px/1.5 var(--mono);min-height:92px;display:grid;align-content:space-between}
.mini-raw b{color:var(--p-bad);font-family:var(--sans);font-size:12.5px}
.mini-rungs{display:flex;gap:5px;align-items:flex-end}
.mini-rungs span{flex:1;border-radius:3px 3px 8px 8px;border:1px solid var(--line);border-top:4px solid var(--line);background:var(--panel2);font-size:12px;font-weight:750;padding:6px 6px 8px;text-align:center}
.mini-rungs span:nth-child(2){margin-bottom:10px}.mini-rungs span:nth-child(3){margin-bottom:20px}.mini-rungs span:nth-child(4){margin-bottom:30px}.mini-rungs span:nth-child(5){margin-bottom:40px}
.mini-rungs .y{border-top-color:var(--mark)}
.mini-rungs .n{border-top-color:var(--bad);border-style:dashed;border-top-style:solid}
.where{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-weight:650;font-size:14.5px}
.where span{background:var(--paper);color:var(--paper-ink);border:1px solid var(--paper-line);border-radius:999px;padding:6px 12px}
.where i{font-style:normal;color:var(--faint)}
.price{margin-top:clamp(64px,9vw,120px);display:grid;grid-template-columns:minmax(0,.86fr) minmax(0,1fr);gap:16px;align-items:start;scroll-margin-top:70px}
@media (max-width:860px){.price{grid-template-columns:minmax(0,1fr)}}
.plan{border-radius:22px;padding:clamp(22px,3.6vw,36px);display:grid;gap:14px;align-content:start;background:var(--panel);border:1px solid var(--line)}
.plan.paid{background:var(--paper);color:var(--paper-ink);border:1px solid var(--paper-line);border-top:6px solid var(--mark);box-shadow:var(--shadow);border-radius:4px 22px 22px 22px}
.plan-price{font-size:46px;font-weight:800;letter-spacing:-.04em;line-height:1}
.plan-price small{font-size:15px;font-weight:650;letter-spacing:0;margin-left:8px;color:var(--faint)}
.plan.paid .plan-price small{color:var(--paper-muted)}
.plan ul{margin:0;padding-left:20px;display:grid;gap:8px}
.plan.paid li::marker{color:var(--mark-edge)}
.plan .btn{justify-self:start;margin-top:6px}
.cant{margin-top:34px;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:14px 40px;max-width:980px}
.cant div{display:grid;gap:6px;border-top:2px solid var(--ink);padding-top:14px}
.cant p{color:var(--ink2);font-size:15.5px}
.faq{margin-top:28px;max-width:820px;border-top:1px solid var(--line)}
.faq details{margin:0;border-bottom:1px solid var(--line)}
.faq summary{width:auto;color:var(--ink);font-size:17.5px;font-weight:700;padding:16px 0;letter-spacing:-.01em}
.faq details p{color:var(--ink2);padding:0 0 18px;max-width:70ch}
.last{margin-top:clamp(64px,9vw,120px);display:grid;gap:22px;justify-items:start;padding:clamp(26px,5vw,60px);border-radius:26px;background:var(--panel);border:1px solid var(--line)}
.foot{margin-top:80px;border-top:1px solid var(--line);padding:26px 0 40px;font-size:14px;color:var(--faint)}
.foot .wrap{display:flex;flex-wrap:wrap;gap:10px 26px;justify-content:space-between}
.foot a{color:var(--ink2)}
.foot nav{display:flex;flex-wrap:wrap;gap:8px 20px}
.sample-bar{background:var(--mark);color:var(--mark-ink);font-size:14px;font-weight:650;padding-block:9px;text-align:center}
.sample-bar a{color:inherit}
.err{padding-top:clamp(48px,9vw,110px);display:grid;gap:18px;justify-items:start}

@media (prefers-reduced-motion:reduce){.tab.is-pending .tab-n::after{content:"..."}html{scroll-behavior:auto}*,*::before,*::after{animation:none!important;transition:none!important}.take.fresh mark.you{background-size:100% 82%}.take.fresh .rival{text-decoration-color:var(--p-rose)}.take.fresh .dir{text-decoration-color:var(--p-blue)}.take.fresh .note{opacity:1}}
@media print{
  :root{--desk:#fff;--dot:transparent;--ink:#0F1433;--ink2:#333A60;--faint:#555C82;--line:#C9CEE2;--panel:#F7F8FC;--panel2:#fff;--pen:#23329A;--shadow:none}
  body{background:#fff;font-size:11.5pt}
  .top,.toc,.foot,.btn,.copy,.done,.asks,.again,.mail,.askit,.fix-bar,.sample-bar{display:none!important}
  .sec,.topic,.fix,.page,.rung,.know{break-inside:avoid}
  .take{display:block}.notes{margin:10px 0 0 40px}.note,.notes.placed .note{position:relative;top:auto!important;margin:0 0 8px}
  .tab{transform:none}.asset pre{max-height:none;white-space:pre-wrap}
  .rep-acts{display:none}
  .print-only{display:block;margin-top:30px;font-size:10pt;color:#555C82}
}
[data-demo] [data-print]{display:none}
`;

module.exports = { CSS };
