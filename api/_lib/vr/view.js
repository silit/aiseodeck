/* AI Visibility Report: every piece of the pages, as plain functions from data to HTML. The same file runs on the
 * server (first paint, the sample report) and in the browser (the live check), so the two can never drift apart.
 * Colours carry meaning everywhere: marker yellow = the business was named, a rose underline = a rival was named,
 * blue = the business's own site was a source. Pen notes in the margin say what the marks mean.
 * A report is built on searches: each is shown the way it is typed into Google, with how often it is made in a month
 * where that is known, and with the question the chat engines got for it. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VRView = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var plural = function (n, one, many) { return n + ' ' + (n === 1 ? one : many || one + 's'); };
  var ordinal = function (n) { var s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  var andList = function (a) { a = (a || []).filter(Boolean); return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; };
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var dayOf = function (ts) { if (!ts) return ''; var d = new Date(ts); return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); };
  var when = function (ts) { if (!ts) return ''; var d = new Date(ts); return dayOf(ts) + ', ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ' UTC'; };
  var NUMBER = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  var word = function (n) { return NUMBER[n] || String(n); };
  var isNamed = function (s) { return s === 'both' || s === 'named'; };
  var counted = function (s) { return s === 'both' || s === 'named' || s === 'cited' || s === 'absent'; };

  var ARROW = '<svg class="arr" viewBox="0 0 44 22" aria-hidden="true"><path d="M42 5C30 2 14 5 4 15"/><path d="M4 15l9-1M4 15l2-9"/></svg>';
  var ICON = {
    lock: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 7V5a3.5 3.5 0 017 0v2M3.5 7h9v6.5h-9z"/></svg>',
    copy: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 5.5v-3h8v8h-3M2.5 5.5h8v8h-8z"/></svg>',
    out: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5H3.5v9h9V10M9 3.5h3.5V7M12.5 3.5L7 9"/></svg>'
  };

  function engine(st, e) {
    var list = st.engines || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === e) return list[i];
    return { id: e, name: e, short: e, search: e === 'aio' || e === 'aimode' };
  }
  var from = function (st) { return st.ask && st.ask.countryName ? st.ask.countryName : 'the United States'; };

  /* ---------- a search and how often it is made ---------- */

  var num = function (n) { return Number(n).toLocaleString('en-US'); };
  var counts = function (t) { return !!t && typeof t.volume === 'number' && t.volume >= 10; };
  var SEARCH_ICON = '<svg class="kw-i" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.4"/><path d="M10.4 10.4L14 14"/></svg>';
  // A search the way it is typed into Google.
  function kw(text) { return '<span class="kw-t">' + SEARCH_ICON + '<span>' + esc(text) + '</span></span>'; }
  // Google searches a month: a number, "too few to measure", or nothing at all when nobody looked it up.
  function volHtml(t, cls) {
    if (!t || !t.measured) return '';
    var c = 'vol' + (cls ? ' ' + cls : '');
    return counts(t) ? '<span class="' + c + '">' + num(t.volume) + '<small> a month</small></span>' : '<span class="' + c + ' none">too few to measure</span>';
  }
  function volWords(t) {
    if (!t || !t.measured) return '';
    return counts(t) ? 'about ' + num(t.volume) + ' searches a month' : 'too few searches to measure';
  }
  var topicOf = function (st, id) { return (st.topics || []).filter(function (x) { return x.id === id; })[0] || null; };
  var measuredAny = function (st) { return (st.topics || []).some(function (t) { return t.measured; }); };
  var namedIn = function (m) { return !m.answers ? 'no answer came back' : m.named ? 'named in ' + m.named + ' of ' + m.answers : 'named in none of ' + m.answers; };

  /* ---------- one answer, marked up ---------- */

  function segsHtml(segs, seen) {
    return (segs || []).map(function (s) {
      if (!s.m) return esc(s.x);
      var first = !seen[s.m];
      seen[s.m] = true;
      var anchor = first ? ' data-anchor="' + s.m + '"' : '';
      if (s.m === 'you') return '<mark class="you"' + anchor + '>' + esc(s.x) + '</mark>';
      return '<span class="' + (s.m === 'rival' ? 'rival' : 'dir') + '"' + anchor + '>' + esc(s.x) + '</span>';
    }).join('');
  }
  function answerHtml(a) {
    var out = '', inList = false, seen = {};
    (a.blocks || []).forEach(function (b) {
      if (b.t === 'li') { if (!inList) { out += '<ul>'; inList = true; } out += '<li>' + segsHtml(b.segs, seen) + '</li>'; return; }
      if (inList) { out += '</ul>'; inList = false; }
      out += (b.t === 'h' ? '<p class="ah">' : '<p>') + segsHtml(b.segs, seen) + '</p>';
    });
    if (inList) out += '</ul>';
    return out;
  }

  // The pen notes for one answer: what the marks mean for this business. At most four, the ones that matter most.
  function notesFor(a, st) {
    var notes = [];
    var biz = (a.named || []).filter(function (x) { return (x.kind || 'business') === 'business'; });
    var rivals = biz.filter(function (x) { return !x.you; });
    var dirs = (a.named || []).filter(function (x) { return x.kind === 'directory'; });
    if (a.state === 'pending') return notes;
    if (a.state === 'failed') return [{ on: 'top', text: 'This engine did not answer. It is not counted.' }];
    if (a.state === 'none') return [{ on: 'top', text: 'Google showed no AI answer for this search. Nothing to win or lose here today.' }];
    if (a.topic === 'b') {
      if (a.cited) notes.push({ on: 'srcs', text: 'It learned this from your own site.' });
      else if (a.pages) notes.push({ on: 'srcs', text: 'None of this comes from your site. Other pages are telling AI who you are.' });
      return notes;
    }
    if (a.you) {
      notes.push({ on: 'you', text: a.of <= 1 ? 'You. The only name in the answer.' : a.rank === 1 ? 'You, named first of ' + a.of + '.' : 'You, named ' + ordinal(a.rank) + ' of ' + a.of + '.' });
      if (a.rank > 1 && rivals[0]) notes.push({ on: 'rival', text: rivals[0].name + ' comes before you.' });
    } else if (rivals.length) {
      notes.push({ on: 'rival', text: 'You are not in this answer. ' + (rivals.length === 1 ? rivals[0].name + ' is.' : plural(rivals.length, 'other') + ' are, ' + rivals[0].name + ' first.') });
    } else if (a.ready) {
      notes.push({ on: 'top', text: 'No business is named here at all. Nothing lost, nothing won.' });
    }
    if (dirs.length) notes.push({ on: 'dir', text: 'It sends the customer to ' + andList(dirs.slice(0, 2).map(function (d) { return d.name; })) + '. Are you listed there?' });
    if (a.card) notes.push({ on: 'srcs', text: 'Google shows your own business card with this answer.' });
    if (a.cited) notes.push({ on: 'srcs', text: 'Your site is one of its sources.' });
    else if (a.read) notes.push({ on: 'srcs', text: 'It opened your site, then chose not to cite it.' });
    else if (a.pages) notes.push({ on: 'srcs', text: 'Built from ' + plural(a.pages, 'page') + '. None of them is yours.' });
    if (a.queries && a.queries.length && notes.length < 4) notes.push({ on: 'qs', text: 'It did not search for the question. It searched for this.' });
    return notes.slice(0, 4);
  }
  function notesHtml(notes) {
    if (!notes.length) return '<ol class="notes" hidden></ol>';
    return '<ol class="notes">' + notes.map(function (n) { return '<li class="note" data-on="' + n.on + '">' + ARROW + '<span>' + esc(n.text) + '</span></li>'; }).join('') + '</ol>';
  }

  function askedLine(a, st) {
    var e = engine(st, a.e);
    if (a.topic === 'b') return '<p class="ask"><span class="ask-by">Someone asks about you by name</span>' + esc(a.asked) + '</p>';
    if (e.search) return '<p class="ask search"><span class="ask-by">A customer searches Google for</span>' + esc(a.asked) + '</p>';
    return '<p class="ask"><span class="ask-by">A customer asks</span>' + esc(a.asked) + '</p>';
  }

  // One sheet: who answered, the question, the answer with its marks, and the work behind it.
  function sheet(a, st) {
    var e = engine(st, a.e);
    var head = '<header class="sheet-head"><div class="sheet-who"><b>' + esc(e.name) + '</b><span>asked from ' + esc(from(st)) + (st.ask && st.ask.languageName ? ', in ' + esc(st.ask.languageName) : '') + '</span></div>' +
      (a.at ? '<time datetime="' + new Date(a.at).toISOString() + '">' + when(a.at) + '</time>' : '') + '</header>';
    var body;
    if (a.state === 'pending') {
      body = '<div class="talk">' + askedLine(a, st) + '<div class="answer waiting" data-anchor="top"><p class="wait"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>' +
        esc(e.search ? 'Google is working on this search.' : e.short + ' is searching the web before it answers.') + '</p></div></div>';
    } else if (a.state === 'none') {
      body = '<div class="talk">' + askedLine(a, st) + '<div class="answer empty" data-anchor="top"><p>No AI answer on this search. Google showed regular results only.</p></div></div>';
    } else if (a.state === 'failed') {
      body = '<div class="talk">' + askedLine(a, st) + '<div class="answer empty" data-anchor="top"><p>' + esc(e.short) + ' did not answer this time.</p></div></div>';
    } else {
      var shown = '';
      if (a.queries && a.queries.length) shown += '<div class="shown-row" data-anchor="qs"><p class="shown-h">Before it answered, it searched the web for</p><ul class="chips">' + a.queries.map(function (q) { return '<li>' + esc(q) + '</li>'; }).join('') + '</ul></div>';
      if (a.sources && a.sources.length) {
        shown += '<div class="shown-row" data-anchor="srcs"><p class="shown-h">It cited ' + plural(a.cites || a.sources.length, 'page') + (a.pages > (a.cites || 0) ? ' and read ' + (a.pages - a.cites) + ' more' : '') + '</p><ul class="srcs">' +
          a.sources.map(function (s) { var label = esc(s.host) + (s.own ? '<span class="own-tag">your site</span>' : ''); return '<li' + (s.own ? ' class="own"' : '') + '>' + (s.url ? '<a href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer nofollow">' + label + '</a>' : label) + '</li>'; }).join('') + '</ul></div>';
      } else if (a.pages) {
        shown += '<div class="shown-row" data-anchor="srcs"><p class="shown-h">It read ' + plural(a.pages, 'page') + ' and cited none</p></div>';
      }
      body = '<div class="talk">' + askedLine(a, st) + '<div class="answer" data-anchor="top">' + answerHtml(a) + (a.more ? '<p class="more">The answer goes on. This is its first part.</p>' : '') + '</div>' +
        (shown ? '<div class="shown">' + shown + '</div>' : '') + '</div>';
    }
    return '<div class="take" data-slot="' + esc(a.id) + '" data-state="' + a.state + '"' + (a.ready === false ? ' data-wait="1"' : '') + '><article class="sheet">' + head + body + '</article>' + notesHtml(notesFor(a, st)) + '</div>';
  }

  /* ---------- a stack of sheets with index tabs ---------- */

  function tabState(answers) {
    var live = answers.filter(function (a) { return counted(a.state); });
    if (answers.every(function (a) { return a.state === 'pending'; })) return 'pending';
    if (!live.length) return answers.some(function (a) { return a.state === 'none'; }) ? 'none' : answers.some(function (a) { return a.state === 'pending'; }) ? 'pending' : 'failed';
    var k = live.filter(function (a) { return isNamed(a.state); }).length;
    if (k === live.length) return 'named';
    if (k) return 'half';
    return live.some(function (a) { return a.state === 'cited'; }) ? 'cited' : 'absent';
  }
  var TAB_WORDS = { pending: 'still answering', named: 'named you', half: 'named you in one of two answers', absent: 'did not name you', cited: 'used your site but did not name you', none: 'no AI answer', failed: 'did not answer' };

  // groups: [{ e, answers: [answer, ...] }]. One tab per engine; an engine asked twice has two takes behind its tab.
  function stack(groups, st, o) {
    o = o || {};
    var id = o.id || 'stk';
    var active = Math.max(0, Math.min(groups.length - 1, o.active || 0));
    var tabs = groups.map(function (g, i) {
      var e = engine(st, g.e), state = tabState(g.answers);
      var pips = g.answers.length > 1 ? '<span class="pips" aria-hidden="true">' + g.answers.map(function (a) { return '<i class="pip ' + (isNamed(a.state) ? 'on' : a.state === 'pending' ? 'wait' : counted(a.state) ? 'off' : 'na') + '"></i>'; }).join('') + '</span>' : '';
      return '<button type="button" class="tab is-' + state + '" role="tab" id="' + id + '-t' + i + '" aria-controls="' + id + '-p' + i + '" aria-selected="' + (i === active) + '" tabindex="' + (i === active ? 0 : -1) + '" data-e="' + esc(g.e) + '">' +
        '<span class="tab-n">' + esc(e.short) + '</span>' + pips + '<span class="sr"> ' + TAB_WORDS[state] + '</span></button>';
    }).join('');
    var panels = groups.map(function (g, i) {
      var takes = g.answers.map(function (a) { return sheet(a, st); });
      var both = g.answers.length > 1;
      var differ = both && isNamed(g.answers[0].state) !== isNamed(g.answers[1].state) && counted(g.answers[0].state) && counted(g.answers[1].state);
      var toggle = both ? '<div class="asks" role="group" aria-label="Which ask"><button type="button" class="ask-b" aria-pressed="true" data-take="0">First ask</button><button type="button" class="ask-b" aria-pressed="false" data-take="1">Second ask</button>' +
        (differ ? '<span class="asks-note">Same question, asked twice. The answers disagree about you.</span>' : '<span class="asks-note">Same question, asked twice.</span>') + '</div>' : '';
      return '<div class="panel" role="tabpanel" id="' + id + '-p' + i + '" aria-labelledby="' + id + '-t' + i + '"' + (i === active ? '' : ' hidden') + '>' + toggle +
        takes.map(function (t, k) { return k ? t.replace('<div class="take"', '<div class="take" hidden') : t; }).join('') + '</div>';
    }).join('');
    var twice = groups.some(function (g) { return g.answers.length > 1; });
    return '<div class="stack' + (twice ? ' twice' : '') + '" data-stack="' + id + '"><div class="tabs" role="tablist" aria-label="AI engines asked">' + tabs + '</div><div class="panels">' + panels + '</div></div>';
  }

  // The free check: one tab per engine, one answer each.
  function freeGroups(st) { return (st.slots || []).map(function (a) { return { e: a.e, answers: [a] }; }); }

  /* ---------- small pieces ---------- */

  function crawlerSheet(c, host) {
    var raw;
    if (!c.read && c.read !== undefined) raw = '<p class="raw-x none">' + (c.status ? 'HTTP ' + c.status : 'No answer') + '. The site turned our reader away.</p>';
    else raw = (c.title ? '<p class="raw-t">' + esc(c.title) + '</p>' : '<p class="raw-t none">(no page title)</p>') +
      (c.sample ? '<p class="raw-x">' + esc(c.sample) + (c.words > 55 ? ' …' : '') + '</p>' : '<p class="raw-x none">(no text)</p>');
    var words = c.words || 0;
    var note = c.read === false ? 'A wall that stops our reader stops AI crawlers too.'
      : words < 120 ? 'This is all a crawler gets. AI cannot quote what it cannot read.'
        : words < 300 ? 'Readable, but thin. Under 300 words leaves little to quote.'
          : 'Good. Your words are in the page itself, so crawlers can read them.';
    return '<div class="take crawl" data-state="' + (c.read === false || words < 120 ? 'bad' : words < 300 ? 'thin' : 'ok') + '"><article class="sheet plain"><header class="sheet-head"><div class="sheet-who"><b>What an AI crawler reads</b><span>on ' + esc(host) + ', without running JavaScript</span></div></header>' +
      '<div class="raw" data-anchor="top">' + raw + '</div><p class="raw-n">' + (c.read === false ? 'nothing read' : words.toLocaleString('en-US') + ' ' + (words === 1 ? 'word' : 'words') + ' in the page code') + '</p></article>' +
      notesHtml([{ on: 'top', text: note }]) + '</div>';
  }

  function emailForm(st, text, button) {
    if (st.email) return '<p class="mail-set">We will write to ' + esc(st.email) + '.</p>';
    return '<form class="mail" data-act="email"><label for="vr-mail">' + esc(text) + '</label><div class="mail-row"><input id="vr-mail" name="email" type="email" autocomplete="email" inputmode="email" placeholder="you@yourbusiness.com" required><button class="btn" type="submit">' + esc(button || 'Send me the link') + '</button></div><p class="form-msg" role="status" aria-live="polite"></p></form>';
  }

  var PIP = function (s) { return '<i class="pip ' + (isNamed(s) ? 'on' : s === 'pending' ? 'wait' : counted(s) ? 'off' : 'na') + '"></i>'; };
  function matrixHtml(st, matrix) {
    var list = (matrix[0] && matrix[0].cells) || [];
    var vols = measuredAny(st);
    var head = '<tr><th scope="col" class="mq">Search</th>' + (vols ? '<th scope="col" class="mv">Searches a month</th>' : '') + list.map(function (c) { return '<th scope="col">' + esc(engine(st, c.e).short) + '</th>'; }).join('') + '<th scope="col" class="mt">Named</th></tr>';
    var rows = matrix.map(function (m) {
      var t = topicOf(st, m.topic) || { keyword: '' };
      var v = !t.measured ? '' : counts(t) ? num(t.volume) : '<span aria-hidden="true">&lt;10</span><span class="sr">too few to measure</span>';
      return '<tr><th scope="row" class="mq">' + kw(t.keyword) + '</th>' + (vols ? '<td class="mv">' + v + '</td>' : '') + m.cells.map(function (c) {
        var words = c.samples.map(function (s) { return isNamed(s) ? 'named' : s === 'pending' ? 'waiting' : counted(s) ? 'not named' : s === 'none' ? 'no AI answer' : 'no answer'; }).join(', ');
        return '<td><span class="pips" aria-hidden="true">' + c.samples.map(PIP).join('') + '</span><span class="sr">' + words + '</span></td>';
      }).join('') + '<td class="mt">' + (m.answers ? m.named + ' of ' + m.answers : '') + '</td></tr>';
    }).join('');
    return '<div class="scroll"><table class="matrix' + (vols ? ' has-v' : '') + '"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="legend"><span><i class="pip on"></i> named you</span><span><i class="pip off"></i> answered without you</span><span><i class="pip na"></i> no AI answer</span><span>Two dots: the same question asked twice.</span>' +
      (vols ? '<span>Searches a month: on Google, in ' + esc(from(st)) + '.</span>' : '') + '</p>';
  }

  /* ---------- stage: what we read, and the search to check ---------- */

  function draft(st) {
    var s = st.site;
    var free = (st.engines || []).filter(function (e) { return e.free; });
    var names = andList(free.map(function (e) { return e.name; })) || 'the AI engines';
    var first = st.topics[0];
    var vols = measuredAny(st);
    var max = Math.max.apply(null, st.topics.map(function (t) { return counts(t) ? t.volume : 0; }).concat([1]));
    var countries = (st.countries || []).map(function (c) { return '<option value="' + c[0] + '"' + (c[0] === st.ask.country ? ' selected' : '') + '>' + esc(c[1]) + '</option>'; }).join('');
    var h1 = s.read ? 'We read ' + esc(s.host) + '. Is this you?' : 'We could not read ' + esc(s.host) + '. We can still ask AI about you.';
    var sub = s.read ? (first ? 'Check what we understood, pick the search to check, and we put it to ' + esc(names) + '.' : 'Check what we understood, write the question, and we put it to ' + esc(names) + '.')
      : 'Your site turned our reader away, which is a finding in itself. Tell us who you are and we ask the engines.';
    // each search is a row to pick; the line under it is its share of the most searched one
    var rows = st.topics.map(function (t, i) {
      return '<label class="kw"' + (vols ? ' style="--w:' + (counts(t) ? Math.max(2, Math.round(t.volume / max * 100)) : 0) + '%"' : '') + '><input type="radio" name="topic" value="' + esc(t.id) + '" data-q="' + esc(t.question) + '"' + (i === 0 ? ' checked' : '') + '>' + kw(t.keyword) + volHtml(t) + '</label>';
    }).join('');
    var left = (st.others || []).filter(counts).slice(0, 4);
    var gets = function (list, what) { return list.length ? esc(andList(list.map(function (e) { return e.search ? e.name : e.short; }))) + (list.length === 1 ? ' gets ' : ' get ') + what + '. ' : ''; };
    var searches = first ? '<fieldset class="field searches"><legend>The search to check</legend>' +
      '<p class="hint">What your customers type into Google, taken from your home page.' + (vols ? '<span class="vol-note"> The numbers are Google searches a month in ' + esc(from(st)) + ', most searched first.</span>' : '') + '</p>' +
      '<div class="kw-list" data-country="' + esc(st.ask.country) + '" data-name="' + esc(from(st)) + '">' + rows + '</div>' +
      '<p class="hint stale" id="vr-stale" hidden></p>' +
      (left.length ? '<p class="hint left-out">Left out, because fewer people search them: ' + left.map(function (o) { return esc(o.keyword) + ' (' + num(o.volume) + ')'; }).join(', ') + '.</p>' : '') + '</fieldset>' : '';
    var question = first
      ? '<div class="field"><label for="vr-q">How a customer asks AI for it</label><textarea id="vr-q" name="question" rows="3" maxlength="170" required data-topic="' + esc(first.id) + '">' + esc(first.question) + '</textarea>' +
        '<p class="hint">' + gets(free.filter(function (e) { return e.search; }), 'the search as it is typed') + gets(free.filter(function (e) { return !e.search; }), 'this question') + 'Change it to the way your customers talk.</p></div>'
      : '<div class="field"><label for="vr-q">The question a customer asks AI</label><textarea id="vr-q" name="question" rows="3" maxlength="170" required data-topic=""></textarea>' +
        '<p class="hint">Write it the way a customer who has never heard of you would ask. No brand names.</p></div>';
    return '<section class="stage draft"><div class="lead"><h1>' + h1 + '</h1><p class="sub">' + sub + '</p></div><div class="draft-grid">' +
      '<form class="sheet form" data-act="run" novalidate>' +
      '<div class="field"><label for="vr-brand">Your business</label><input id="vr-brand" name="brand" value="' + esc(s.brand) + '" maxlength="60" autocomplete="organization" required>' +
      (s.summary ? '<p class="hint">' + esc(s.summary) + '</p>' : '') + '</div>' +
      '<div class="field"><label for="vr-country">Your customers are in</label><select id="vr-country" name="country">' + countries + '</select>' +
      '<p class="hint pen">Not always where you are. A hotel in Lisbon is searched for from London.</p></div>' +
      searches + question +
      '<p class="form-msg" role="alert"></p>' +
      '<button class="btn mark big" type="submit">Ask ' + esc(names) + '</button>' +
      '<p class="tiny">Free: one ' + (first ? 'search' : 'question') + ', ' + plural(free.length || 3, 'AI engine') + ', asked once. About a minute.</p></form>' +
      '<div class="draft-side"><p class="side-h">Your first finding, before anything is asked</p>' + crawlerSheet({ read: s.read, status: s.status, words: s.words, sample: s.sample, title: s.title }, s.host) + '</div>' +
      '</div></section>';
  }

  // The search a free check is about, and how often it is made.
  function searchStrip(st) {
    var t = topicOf(st, st.freeTopic) || (st.topics || []).filter(function (x) { return x.free; })[0];
    if (!t) return '';
    var v = volWords(t);
    return '<p class="searched"><span class="searched-l">The search</span>' + kw(t.keyword) + (v ? '<span class="searched-v">' + v + ' on Google in ' + esc(from(st)) + '</span>' : '') + '</p>';
  }

  /* ---------- stage: the engines are answering ---------- */

  function tallyText(st) {
    var slots = st.slots || [];
    var done = slots.filter(function (a) { return a.state !== 'pending'; });
    var live = done.filter(function (a) { return counted(a.state); });
    var named = live.filter(function (a) { return isNamed(a.state); }).length;
    if (!done.length) return 'Waiting for the first answer.';
    if (done.length < slots.length) return plural(done.length, 'answer') + ' of ' + slots.length + ' in. Named in ' + named + ' so far.';
    return 'All ' + slots.length + ' answers are in.';
  }
  function asking(st) {
    return '<section class="stage asking"><div class="lead"><h1>Asking the AI engines</h1><p class="sub" id="vr-tally" aria-live="polite">' + esc(tallyText(st)) + '</p>' + searchStrip(st) + '</div>' +
      stack(freeGroups(st), st, { id: 'free' }) +
      '<p class="tiny center">Each engine searches the web before it answers, so this takes 20 to 60 seconds. Stay on this page.</p></section>';
  }

  /* ---------- stage: the free result ---------- */

  function verdict(st) {
    var slots = st.slots || [];
    var live = slots.filter(function (a) { return counted(a.state); });
    var named = live.filter(function (a) { return isNamed(a.state); });
    var missed = live.filter(function (a) { return !isNamed(a.state); });
    var rivals = (st.preview && st.preview.rivals) || [];
    var n = live.length;
    if (!n) return { h: 'No AI answer came back for this search.', sub: 'Google showed no AI answer and the other engines did not reply. Check a different search, or come back later.' };
    if (named.length === n) return { h: n === 1 ? 'The AI engine named you.' : 'All ' + n + ' AI engines named you.', sub: 'One answer is luck. AI changes its mind between asks, so the full report asks every chat engine twice, on ' + word(st.topics.length || 5) + ' searches.' };
    if (named.length) return { h: named.length + ' of ' + n + ' AI engines named you. ' + andList(missed.map(function (a) { return engine(st, a.e).short; })) + ' did not.', sub: 'Open each sheet to read the answer word for word. The notes in the margin say what the marks mean for you.' };
    if (rivals.length) return { h: 'None of the ' + n + ' AI engines named you. They named ' + plural(rivals.length, 'other business', 'other businesses') + '.', sub: 'These are the answers your customers get today. The margin notes show who took your place and where the answer came from.' };
    return { h: 'None of the ' + n + ' AI engines named you, or anyone else.', sub: 'For this search the engines give general advice and name no business. Try a search that asks for a provider.' };
  }

  function unlock(st) {
    var p = st.preview || {};
    var lk = st.locked || { engines: [], topics: [] };
    var chat = (st.engines || []).filter(function (e) { return !e.search; }).length || 4;
    var search = (st.engines || []).filter(function (e) { return e.search; }).length;
    var total = (st.topics.length || 3) * (chat * 2 + search);
    var known = (st.topics || []).filter(counts);
    var sum = known.reduce(function (a, t) { return a + t.volume; }, 0);
    var rows = [
      ['All ' + plural(st.topics.length || 3, 'search', 'searches') + ' on ' + plural((st.engines || []).length || 6, 'AI engine'), total + ' answers. Each chat engine is asked twice, because AI changes its mind between asks.' + (lk.engines.length ? ' Adds ' + esc(andList(lk.engines)) + '.' : '') +
        (lk.topics.length ? '<span class="more-q">Your other ' + (lk.topics.length === 1 ? 'search' : word(lk.topics.length) + ' searches') + ':</span><ul class="more-qs">' + lk.topics.map(function (t) { return '<li>' + kw(t.keyword) + volHtml(t) + '</li>'; }).join('') + '</ul>' : '')],
      sum ? ['Where the most searches end without you', 'These ' + word(st.topics.length) + ' searches are made about ' + num(sum) + ' times a month on Google in ' + esc(from(st)) + '. The report weighs each gap by how often its search is made, so you close the biggest one first.'] : null,
      ['The pages AI read', (p.sources ? plural(p.sources, 'page') + ' fed this one search alone. ' : '') + 'We open them and tell you which ones name your rivals and not you.'],
      ['Does AI know you by name', 'Each engine is asked what ' + esc(st.site.brand) + ' is. You see where it is right, where it is vague and where it mixes you up.'],
      ['Your fix kit', (p.fixes ? plural(p.fixes, 'fix', 'fixes') + ' found on your site so far, and more once every answer is in. ' : '') + 'Each comes with the text or code to paste and a brief for your web person.'],
      ['A re-check in 30 days', 'The same searches, asked again, with your before and after.']
    ].filter(Boolean);
    var cta = st.paying ? '<div class="buy paying"><p class="paying-t"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>Your payment is being confirmed. This page opens your report the moment it is.</p></div>'
      : st.canPay
      ? '<form data-act="unlock" class="buy"><button class="btn mark big" type="submit">Get the full report for ' + esc(st.price.label) + '</button><p class="tiny">One payment through Polar. No subscription and no account. Ready about four minutes later. Every sale is final.</p><p class="form-msg" role="alert"></p></form>'
      : '<div class="buy soon">' + emailForm(st, 'The full report opens for sale shortly. Leave your email and we send you the link when it does.', 'Tell me') + '</div>';
    return '<section class="unlock" id="full"><div class="unlock-text"><h2>The full report</h2><p class="sub">You have seen one search on ' + plural((st.slots || []).length, 'engine') + ', asked once. Here is what the rest holds, with real numbers from your check.</p>' + cta + '</div>' +
      '<ul class="holds">' + rows.map(function (r) { return '<li><span class="hold-lock">' + ICON.lock + '</span><div><b>' + r[0] + '</b><div class="hold-t">' + r[1] + '</div></div></li>'; }).join('') + '</ul></section>';
  }

  function preview(st) {
    var v = verdict(st);
    var p = st.preview || {};
    var also = '';
    if (p.rivals && p.rivals.length) {
      also = '<section class="also"><h2>Named in these answers</h2><ul class="voice">' + p.rivals.map(function (r) { return '<li><span class="rival">' + esc(r.name) + '</span><span class="vn">in ' + plural(r.n, 'answer') + '</span></li>'; }).join('') +
        '<li class="' + (p.named ? 'me' : 'me out') + '"><mark class="you">' + esc(st.site.brand) + '</mark><span class="vn">in ' + plural(p.named || 0, 'answer') + '</span></li></ul>' +
        (p.dirs && p.dirs.length ? '<p class="tiny">The engines also sent the customer to ' + esc(andList(p.dirs.map(function (d) { return d.name; }))) + '.</p>' : '') + '</section>';
    }
    var f = st.findings || {};
    var finding = '<section class="finding"><h2>What a crawler sees on your site</h2><div class="finding-grid">' + crawlerSheet({ read: st.site.read, status: st.site.status, words: st.site.words, sample: st.site.sample, title: st.site.title }, st.site.host) +
      (f.first ? '<div class="found"><p class="found-n">' + (f.n > 1 ? 'First of ' + f.n + ' things we found on your site' : 'One thing we found on your site') + '</p><h3>' + esc(f.first.title) + '</h3><p>' + esc(f.first.detail) + '</p>' + (f.n > 1 ? '<p class="tiny">The other ' + (f.n - 1) + ' are in the full report, each with its fix.</p>' : '') + '</div>'
        : '<div class="found"><h3>Nothing on your site blocks AI crawlers</h3><p>Your page opens, the text is in the code and no AI search crawler is shut out. What is left is being named, and that is decided on other sites.</p></div>') + '</div></section>';
    return '<section class="stage preview"><div class="lead"><h1>' + esc(v.h) + '</h1><p class="sub">' + esc(v.sub) + '</p>' + searchStrip(st) + '</div>' +
      stack(freeGroups(st), st, { id: 'free' }) + also + finding + unlock(st) + '</section>';
  }

  /* ---------- stage: the paid report is being built ---------- */

  var STEP_TEXT = { answers: 'Asking every engine, twice', reading: 'Opening the pages the engines read', audit: 'Reading your site the way a crawler does', insights: 'Comparing what AI says with what you say', assets: 'Writing your fix kit', compose: 'Putting the report together' };
  function building(st) {
    var p = st.progress || { done: 0, total: 0, step: 'answers', steps: ['answers'] };
    var at = p.steps.indexOf(p.step);
    var steps = p.steps.map(function (s, i) {
      var cls = i < at ? 'done' : i === at ? 'now' : '';
      var extra = s === 'answers' && p.total ? ' <span class="step-n">' + p.done + ' of ' + p.total + '</span>' : '';
      return '<li class="' + cls + '"' + (i === at ? ' aria-current="step"' : '') + '><span>' + STEP_TEXT[s] + extra + '</span></li>';
    }).join('');
    return '<section class="stage building"><div class="lead"><h1>Building your report</h1><p class="sub" aria-live="polite">' + (p.step === 'answers' ? p.done + ' of ' + p.total + ' answers are in. This takes three to five minutes.' : STEP_TEXT[p.step] + '.') + '</p></div>' +
      '<div class="build-grid"><ol class="steps">' + steps + '</ol><div class="build-side">' + (st.matrix && st.matrix.length ? matrixHtml(st, st.matrix) : '') +
      '<div class="leave"><p>You can close this page. The address in your browser is your report, so keep it.</p>' + emailForm(st, 'Or leave an email and we send the link when it is ready.') + '</div></div></div></section>';
  }

  /* ---------- stage: the report ---------- */

  var RUNG_WORD = { yes: 'Yes', partly: 'Partly', no: 'No', unknown: 'Not measured' };
  function ladderHtml(r) {
    return '<ol class="ladder">' + r.ladder.map(function (x, i) {
      return '<li class="rung is-' + x.state + (x.id === r.start ? ' start' : '') + '" style="--i:' + i + ';--p:' + Math.round(Math.max(x.state === 'partly' ? 0.08 : 0, x.p == null ? (x.state === 'yes' ? 1 : x.state === 'partly' ? 0.5 : 0) : x.p) * 100) + '%"><div class="rung-top"><span class="rung-name">' + esc(x.name) + '</span><span class="rung-state">' + RUNG_WORD[x.state] + '</span></div>' +
        '<p class="rung-q">' + esc(x.q) + '</p><p class="rung-e">' + esc(x.evidence) + '</p>' + (x.id === r.start ? '<p class="note inline">' + ARROW + '<span>Start here. The rungs above depend on this one.</span></p>' : '') + '</li>';
    }).join('') + '</ol>';
  }

  function scoreHtml(r) {
    var parts = [['Named', r.parts.mention, 50], ['Cited', r.parts.cite, 30], ['Placed early', r.parts.rank, 20]];
    return '<div class="score"><p class="score-n"><b>' + r.score + '</b><span>of 100</span></p><div class="score-parts">' + parts.map(function (p) {
      return '<div class="sp"><span class="sp-l">' + p[0] + '</span><span class="sp-bar"><i style="width:' + Math.round(p[1] * 100) + '%"></i></span><span class="sp-w">' + Math.round(p[1] * 100) + '%, worth ' + p[2] + '</span></div>';
    }).join('') + '</div></div>';
  }

  function topicGroups(st, topic) {
    var list = (st.report.engines || []);
    return list.map(function (e) {
      var search = engine(st, e).search;
      var qs = search ? ['k'] : ['0', '1'];
      var answers = qs.map(function (q) { return (st.answers || []).filter(function (a) { return a.topic === topic.id && a.e === e && a.q === q; })[0]; }).filter(Boolean);
      return answers.length ? { e: e, answers: answers } : null;
    }).filter(Boolean);
  }
  function askLinks(t) {
    var x = encodeURIComponent(t.question), k = encodeURIComponent(t.keyword || t.question);
    var links = [['ChatGPT', 'https://chatgpt.com/?q=' + x], ['Google AI Mode', 'https://www.google.com/search?udm=50&q=' + k], ['Claude', 'https://claude.ai/new?q=' + x], ['Perplexity', 'https://www.perplexity.ai/search?q=' + x]];
    return '<p class="askit">Do not take our word for it. Ask it yourself: ' + links.map(function (l) { return '<a href="' + l[1] + '" target="_blank" rel="noopener noreferrer">' + l[0] + '</a>'; }).join(', ') + '. Your answer may differ. That is the point of asking twice.</p>';
  }

  function voiceHtml(st, r) {
    var max = Math.max.apply(null, r.voice.map(function (v) { return v.n; }).concat([1]));
    var total = r.counts.answers || 1;
    return '<ul class="bars">' + r.voice.map(function (v) {
      return '<li class="' + (v.you ? 'me' : '') + '"><span class="bar-name">' + (v.you ? '<mark class="you">' + esc(v.name) + '</mark>' : '<span class="rival">' + esc(v.name) + '</span>') + '</span>' +
        '<span class="bar"><i style="width:' + Math.max(v.n ? 3 : 0, Math.round(v.n / max * 100)) + '%"></i></span><span class="bar-n">' + v.n + ' of ' + total + (v.first ? '<small>first in ' + v.first + '</small>' : '') + '</span></li>';
    }).join('') + '</ul>';
  }

  var PAGE_STATUS = { read: '', refused: 'would not open for us', unreachable: 'could not be reached', empty: 'opened empty', skipped: 'not opened', host: 'address not given by the engine' };
  function readingHtml(st, rd) {
    if (!rd || !rd.pages || !rd.pages.length) return '<p class="empty-note">The engines cited no pages for these searches, or this step could not be completed.</p>';
    var rows = rd.pages.map(function (p) {
      // another business's own website is not a page to be on, so being absent from it is not marked as a gap
      var who = p.status !== 'read' ? '<span class="na">' + PAGE_STATUS[p.status] + '</span>'
        : p.theirs && !p.you ? '<span class="na">their own website</span>'
        : (p.you ? '<mark class="you">you are on it</mark>' : '<span class="miss">you are not on it</span>') + (p.rivals && p.rivals.length ? '<span class="on-it">names ' + p.rivals.slice(0, 3).map(function (n) { return '<span class="rival">' + esc(n) + '</span>'; }).join(', ') + (p.rivals.length > 3 ? ' and ' + (p.rivals.length - 3) + ' more' : '') + '</span>' : '');
      var title = esc(p.title || p.host);
      return '<li class="page' + (p.status === 'read' && !p.you && !p.theirs ? ' gap' : '') + '"><div class="page-main">' + (p.url ? '<a href="' + esc(p.url) + '" target="_blank" rel="noopener noreferrer nofollow">' + title + '</a>' : '<span>' + title + '</span>') +
        '<span class="page-host">' + esc(p.host) + ', ' + esc(p.kind.charAt(0).toLowerCase() + p.kind.slice(1)) + '</span></div><div class="page-use">used in ' + plural(p.n, 'answer') + (p.cited ? ', cited in ' + p.cited : '') + '</div><div class="page-who">' + who + '</div></li>';
    }).join('');
    var theirs = rd.theirs || 0;
    var onOthers = rd.pages.filter(function (p) { return p.status === 'read' && !p.theirs && p.you; }).length;
    var sum = rd.opened ? 'We could open ' + rd.opened + ' of these ' + rd.pages.length + ' pages.' +
      (theirs ? ' ' + (theirs === 1 ? 'One is' : theirs + ' are') + ' the own website of another business, where nobody else is listed. On the other ' + (rd.opened - theirs) + ' you are named on ' + (onOthers || 'none') + '.' : ' You are on ' + rd.you + '.') +
      (rd.top ? ' ' + esc(rd.top.name) + ' is on ' + rd.top.n + '.' : '') : 'None of these pages would open for our reader, so we could not check who is on them.';
    return '<p class="sum">' + sum + '</p><ul class="pages">' + rows + '</ul>';
  }

  // The tone of the answers that name the business. Left out when it could not be read: three zeros say nothing.
  function tone(s) {
    var n = s.sentiment || {};
    if (!((n.positive || 0) + (n.neutral || 0) + (n.negative || 0))) return '';
    return '<p class="tiny">From the ' + plural(s.basedOn, 'answer') + ' that name you: ' + (n.positive || 0) + ' positive, ' + (n.neutral || 0) + ' neutral, ' + (n.negative || 0) + ' negative.</p>';
  }

  var KNOWS = { yes: ['Knows you', 'ok'], partly: ['Vague', 'mid'], no: ['Does not know you', 'bad'], other: ['Mixes you up', 'bad'], failed: ['Did not answer', 'na'] };
  function knownHtml(st, r) {
    var out = '';
    var p = r.probe;
    if (p && p.engines && p.engines.length) {
      out += '<ul class="knows">' + p.engines.map(function (x) {
        var k = KNOWS[x.knows] || KNOWS.failed;
        return '<li class="know is-' + k[1] + '"><div class="know-top"><b>' + esc(engine(st, x.e).short) + '</b><span class="know-state">' + k[0] + '</span></div>' + (x.says ? '<p class="quote">' + esc(x.says) + '</p>' : '') + '</li>';
      }).join('') + '</ul>';
      if (p.check && p.check.length) {
        out += '<div class="claims"><h3>Check these claims</h3><p class="tiny">AI said these about you. Your website does not back them up. If one is wrong, a customer has already heard it.</p><ul>' + p.check.map(function (c) {
          return '<li><span class="claim">' + esc(c.claim) + '</span><span class="claim-by">' + (c.engine ? esc(engine(st, c.engine).short) + ', ' : '') + (c.why === 'contradicts' ? 'contradicts your site' : 'not on your site') + '</span></li>';
        }).join('') + '</ul></div>';
      }
    } else out += '<p class="empty-note">The engines could not be asked about you by name this time.</p>';
    var s = r.says;
    if (s && (s.descriptors || []).length) {
      out += '<div class="says"><h3>The words AI uses for you</h3><ul class="chips big">' + s.descriptors.map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul>' +
        tone(s) + '</div>';
    }
    return out;
  }

  function botsHtml(r) {
    var row = function (b) { return '<tr class="' + (b.blocked ? 'blocked' : '') + '"><th scope="row">' + esc(b.ua) + '</th><td>' + esc(b.engine) + '</td><td class="bot-s">' + (b.blocked ? 'Shut out' : 'Allowed') + '</td></tr>'; };
    var search = r.bots.filter(function (b) { return b.kind === 'search'; });
    var train = r.bots.filter(function (b) { return b.kind !== 'search'; });
    var f = r.files;
    return '<div class="scroll"><table class="bots"><thead><tr><th scope="col">Crawler</th><th scope="col">Works for</th><th scope="col">Your robots.txt</th></tr></thead>' +
      '<tbody><tr class="grp"><th colspan="3" scope="colgroup">Fetch pages for AI answers. Keep these allowed.</th></tr>' + search.map(row).join('') +
      '<tr class="grp"><th colspan="3" scope="colgroup">Collect text to train models. Blocking these is your choice and does not hide you from answers.</th></tr>' + train.map(row).join('') + '</tbody></table></div>' +
      '<ul class="files"><li class="' + (f.https ? 'ok' : 'bad') + '">HTTPS ' + (f.https ? 'on' : 'off') + '</li><li class="' + (f.robots === 'found' ? 'ok' : 'mid') + '">robots.txt ' + (f.robots === 'found' ? 'found' : f.robots === 'none' ? 'not there' : 'unreachable') + '</li><li class="' + (f.sitemap ? 'ok' : 'bad') + '">sitemap.xml ' + (f.sitemap ? 'found' : 'missing') + '</li><li class="' + (f.llms ? 'ok' : 'mid') + '">llms.txt ' + (f.llms ? 'found' : 'missing') + '</li><li class="' + ((f.schema || []).length ? 'ok' : 'bad') + '">Structured data ' + ((f.schema || []).length ? esc(f.schema.slice(0, 4).join(', ')) : 'none') + '</li></ul>';
  }

  var WHO = { you: 'You', web: 'Your web person' };
  var RUNG_NAME = { readable: 'Readable', known: 'Known', named: 'Named', cited: 'Cited', first: 'First' };
  var mins = function (m) { return m >= 120 ? Math.round(m / 60) + ' hours' : m >= 60 ? 'about an hour' : m + ' minutes'; };
  function codeBlock(asset, id) {
    return '<div class="asset"><div class="asset-top"><span>' + esc(asset.label) + '</span><button type="button" class="copy" data-copy="' + id + '">' + ICON.copy + '<span>Copy</span></button></div><pre class="' + (asset.kind === 'code' ? 'code' : 'text') + '" id="' + id + '" tabindex="0">' + esc(asset.body) + '</pre></div>';
  }
  function fixesHtml(st, r) {
    if (!r.fixes.length) return '<p class="empty-note">We found nothing to fix. That is rare. The re-check in 30 days will show whether it holds.</p>';
    var total = r.fixes.reduce(function (a, f) { return a + f.minutes; }, 0);
    var quick = r.fixes.filter(function (f) { return f.minutes <= 15; }).length;
    var items = r.fixes.map(function (f) {
      var id = 'fx-' + f.id;
      return '<li class="fix" id="' + id + '" data-fix="' + esc(f.id) + '"><div class="fix-head"><span class="fix-n">' + f.n + '</span><div class="fix-title"><h3>' + esc(f.title) + '</h3><p class="fix-meta"><span class="who w-' + f.who + '">' + WHO[f.who] + '</span><span>' + mins(f.minutes) + '</span><span>lifts the ' + RUNG_NAME[f.rung] + ' rung</span></p></div>' +
        '<label class="done"><input type="checkbox" data-done="' + esc(f.id) + '"><span>Done</span></label></div>' +
        '<p class="fix-why">' + esc(f.why) + '</p>' + (f.steps.length ? '<ol class="fix-steps">' + f.steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' : '') +
        (f.note ? '<p class="fix-note">' + esc(f.note) + '</p>' : '') +
        (f.asset ? codeBlock(f.asset, id + '-a') : '') + (f.extra ? codeBlock({ label: f.extra.label, body: f.extra.body, kind: 'text' }, id + '-b') : '') +
        (f.ai ? '<p class="ai-note">Drafted by AI from the words on your own site. Read it before you publish it.</p>' : '') + '</li>';
    }).join('');
    return '<p class="sum">' + plural(r.fixes.length, 'fix', 'fixes') + ', biggest win for the least work first. ' + (quick ? quick + ' take 15 minutes or less. ' : '') + 'All of it is about ' + mins(total) + ' of work.</p>' +
      '<div class="fix-bar"><span class="fix-prog" aria-live="polite"><b data-done-count>0</b> of ' + r.fixes.length + ' done</span><button type="button" class="btn sm" data-copy-brief>' + ICON.copy + '<span>Copy the brief for my web person</span></button></div>' +
      '<ol class="fixes">' + items + '</ol>';
  }

  function compareHtml(st) {
    var c = st.compare;
    if (!c) return '';
    var d = function (a, b) { var x = b - a; return '<span class="delta ' + (x > 0 ? 'up' : x < 0 ? 'down' : '') + '">' + (x > 0 ? '+' : '') + x + '</span>'; };
    return '<section class="compare"><h2>Then and now</h2><p class="sub">The same searches, first asked on ' + dayOf(c.at) + '. <a href="/check/' + esc(c.id) + '">Open the first report</a>.</p><ul class="cmp">' +
      '<li><span>Score</span><b>' + c.score[0] + ' to ' + c.score[1] + '</b>' + d(c.score[0], c.score[1]) + '</li>' +
      '<li><span>Named</span><b>' + c.named[0] + ' of ' + c.answers[0] + ' to ' + c.named[1] + ' of ' + c.answers[1] + '</b>' + d(c.named[0], c.named[1]) + '</li>' +
      '<li><span>Cited</span><b>' + c.cited[0] + ' to ' + c.cited[1] + '</b>' + d(c.cited[0], c.cited[1]) + '</li>' +
      '<li><span>Named first</span><b>' + c.first[0] + ' to ' + c.first[1] + '</b>' + d(c.first[0], c.first[1]) + '</li></ul>' +
      '<ul class="cmp-rungs">' + c.ladder.map(function (r) { return '<li class="' + (r.was !== r.now ? 'moved' : '') + '"><b>' + esc(r.name) + '</b> ' + RUNG_WORD[r.was].toLowerCase() + (r.was !== r.now ? ' to ' + RUNG_WORD[r.now].toLowerCase() : ', no change') + '</li>'; }).join('') + '</ul></section>';
  }

  function recheckHtml(st) {
    var rc = st.recheck;
    if (st.parent) return '';
    if (!rc) return '';
    if (rc.id) return '<section class="again"><h2>Your re-check is ready</h2><p class="sub">The same searches, asked again.</p><a class="btn mark" href="/check/' + esc(rc.id) + '">Open the before and after</a></section>';
    if (rc.running) return '<section class="again"><h2>Your re-check is running</h2><p class="sub">The same searches are being asked again. Reload in a few minutes.</p></section>';
    return '<section class="again"><h2>Your re-check</h2><p class="sub">On ' + dayOf(rc.dueAt) + ' we ask the same searches again and show the before and after. It is part of this report.</p>' +
      emailForm(st, 'Leave an email and we send it to you.', 'Email it to me') +
      (rc.open ? '<form data-act="recheck" class="again-now"><button class="btn" type="submit">Run the re-check now</button><p class="tiny">You have one. AI answers take a few weeks to move, so it tells you most after your fixes have been live for a while.</p><p class="form-msg" role="alert"></p></form>' : '<p class="tiny">Fixed things sooner? From ' + dayOf(rc.earlyAt) + ' you can start it yourself.</p>') + '</section>';
  }

  // Where the searches are made and where the business is missing: the three rows worth knowing before the table.
  // With search numbers the gap is the search where the most searches end in an answer without the business.
  function demandHtml(st, r) {
    var rows = r.matrix.filter(function (m) { return m.answers; });
    if (rows.length < 2) return '';
    var share = function (m) { return m.named / m.answers; };
    var by = rows.slice().sort(function (a, b) { return share(b) - share(a); });
    var best = by[0], worst = by[by.length - 1];
    var row = function (id) { return r.matrix.filter(function (m) { return m.topic === id; })[0]; };
    var d = r.demand || {};
    var top = d.top && row(d.top.topic), gap = d.gap && row(d.gap.topic);
    if (!top) {
      if (best === worst || best.named === worst.named) return '';
      return '<p class="sum">You do best on ' + kw((topicOf(st, best.topic) || {}).keyword) + ' (' + best.named + ' of ' + best.answers + ') and worst on ' + kw((topicOf(st, worst.topic) || {}).keyword) + ' (' + worst.named + ' of ' + worst.answers + ').</p>';
    }
    var item = function (label, m, cls, note) {
      var t = topicOf(st, m.topic) || {};
      var at = (st.topics || []).indexOf(t) + 1;
      return '<li' + (cls ? ' class="' + cls + '"' : '') + '><span class="dm-l">' + label + '</span><a class="dm-k" href="#q' + at + '">' + kw(t.keyword) + '</a><span class="dm-f">' + volHtml(t) + '<span class="dm-n">' + namedIn(m) + '</span></span>' +
        (note ? '<p class="note inline">' + ARROW + '<span>' + note + '</span></p>' : '') + '</li>';
    };
    var items = [];
    var why = 'More searches end without you here than anywhere else.';
    if (gap && gap === top) items.push(item('Most searched, and your biggest gap', top, 'gap', why));
    else {
      items.push(item('Most searched', top, '', ''));
      if (gap) items.push(item('Biggest gap', gap, 'gap', why));
    }
    if (best.named && best !== top && best !== gap) items.push(item('Best result', best, 'won', ''));
    // the search with the fewest answers naming the business is not always the one to fix first
    var aside = gap && worst !== gap && share(worst) < share(gap)
      ? '<p class="tiny dm-aside">You are named least on ' + esc((topicOf(st, worst.topic) || {}).keyword) + ' (' + worst.named + ' of ' + worst.answers + '), but fewer people search it, so it is not the first gap to close.</p>' : '';
    return '<ul class="demand">' + items.join('') + '</ul>' + aside;
  }

  function report(st) {
    var r = st.report;
    var c = r.counts;
    var start = r.ladder.filter(function (x) { return x.id === r.start; })[0];
    var headline = 'AI names ' + st.site.brand + ' in ' + c.named + ' of ' + c.answers + ' answers';
    var sub = start ? 'Start with the ' + start.name + ' rung. ' + start.evidence : 'Every rung holds. The fix kit below is about staying there.';
    var chat = r.engines.filter(function (e) { return !engine(st, e).search; });
    var topics = st.topics.map(function (t, i) {
      var m = r.matrix.filter(function (x) { return x.topic === t.id; })[0] || { named: 0, answers: 0 };
      return '<details class="topic" id="q' + (i + 1) + '"' + (i === 0 ? ' open' : '') + '><summary><h3>' + kw(t.keyword) + '</h3><span class="topic-f">' + volHtml(t, 'topic-v') + '<span class="topic-n' + (m.named ? '' : ' zero') + '">named in <b>' + m.named + ' of ' + m.answers + '</b></span></span></summary>' +
        '<p class="topic-k">Google got this search as it is typed. The chat engines got it as a question: <q>' + esc(t.question) + '</q></p>' +
        stack(topicGroups(st, t), st, { id: 'q' + i }) + askLinks(t) + '</details>';
    }).join('');
    var d = r.demand || {};
    // the searches that were weighed and not asked: each is a page that could be written
    var spare = (st.others || []).filter(function (o) { return o.measured; });
    var others = spare.some(counts) ? '<div class="others"><h3>Searches we weighed and did not ask</h3><p class="tiny">We found ' + word(st.topics.length + (st.others || []).length) + ' searches on your home page and asked the ' + word(st.topics.length) + ' made most often. These came next. Each one is a page you could write.</p><ul class="kw-more">' +
      spare.map(function (o) { return '<li>' + kw(o.keyword) + volHtml(o) + '</li>'; }).join('') + '</ul></div>' : '';
    var probes = (st.answers || []).filter(function (a) { return a.topic === 'b' && a.state !== 'failed'; });
    var toc = [['ladder', 'Where you stand'], ['answers', 'Every answer'], ['rivals', 'Who gets named'], ['reading', 'Pages AI read'], ['known', 'About you'], ['crawler', 'Crawler view'], ['fixes', 'Fix kit'], ['method', 'Method']];
    return '<section class="stage report">' +
      '<header class="rep-head"><p class="rep-meta">AI visibility report for ' + esc(st.site.host) + ', ' + dayOf(r.at) + (st.parent ? ' (re-check)' : '') + '</p><h1>' + esc(headline) + '</h1><p class="sub">' + esc(sub) + '</p>' +
      '<div class="rep-facts">' + scoreHtml(r) + '<ul class="facts"><li><span>Searches</span>' + st.topics.length + (d.known && d.total ? ', made about ' + num(d.total) + ' times a month on Google' : '') + '</li><li><span>Asked from</span>' + esc(from(st)) + (st.ask.languageName ? ', in ' + esc(st.ask.languageName) : '') + '</li><li><span>Engines</span>' + esc(andList(r.engines.map(function (e) { return engine(st, e).short; }))) + '</li><li><span>Answers</span>' + c.answers + ' read' + (c.none ? ', ' + c.none + ' with no AI answer' : '') + (c.failed ? ', ' + c.failed + ' not answered' : '') + '</li></ul>' +
      '<div class="rep-acts"><button type="button" class="btn sm" data-copy-link>' + ICON.copy + '<span>Copy the link</span></button><button type="button" class="btn sm" data-print>Save as PDF</button></div></div></header>' +
      compareHtml(st) +
      (r.fixes.length ? '<section class="top3"><h2>If you only do three things</h2><ol>' + r.fixes.slice(0, 3).map(function (f) { return '<li><a href="#fx-' + esc(f.id) + '">' + esc(f.title) + '<small>' + WHO[f.who] + ', ' + mins(f.minutes) + '</small></a></li>'; }).join('') + '</ol></section>' : '') +
      '<nav class="toc" aria-label="Report sections"><ul>' + toc.map(function (t) { return '<li><a href="#' + t[0] + '">' + t[1] + '</a></li>'; }).join('') + '</ul></nav>' +
      '<section class="sec" id="ladder"><h2>Where you stand</h2><p class="sub">Being recommended by AI is a ladder. Each rung rests on the one below it, so the lowest one that wobbles is where to start.</p>' + ladderHtml(r) + '</section>' +
      '<section class="sec" id="answers"><h2>Every answer, word for word</h2><p class="sub">Yellow marker is you. A rose underline is someone named in your place. Each chat engine was asked twice: a full tab means it named you both times, a half tab once.</p>' + demandHtml(st, r) + matrixHtml(st, r.matrix) + topics + others + '</section>' +
      '<section class="sec" id="rivals"><h2>Who gets named instead</h2><p class="sub">Out of ' + plural(c.answers, 'answer') + ', how many name each business.</p>' + voiceHtml(st, r) +
      (r.dirs && r.dirs.length ? '<p class="tiny">The engines also pointed customers to ' + esc(andList(r.dirs.map(function (d) { return d.name + ' (' + d.n + ')'; }))) + '. A listing there puts you in front of the engine and the customer.</p>' : '') + '</section>' +
      '<section class="sec" id="reading"><h2>The pages AI read</h2><p class="sub">An engine has no opinions. It reads a handful of pages and repeats who is on them. These are the pages behind your answers, and whether you are on them.</p>' + readingHtml(st, r.reading) +
      (r.queries && r.queries.length ? '<div class="fanout"><h3>The searches behind the answers</h3><p class="tiny">The engines did not search for your customers\' questions. They searched for these, so these are the searches to be found for.</p><ul class="chips">' + r.queries.map(function (q) { return '<li>' + esc(q.q) + (q.n > 1 ? '<b>' + q.n + '</b>' : '') + '</li>'; }).join('') + '</ul></div>' : '') + '</section>' +
      '<section class="sec" id="known"><h2>What AI says about you</h2><p class="sub">We also asked each engine about you by name' + (chat.length ? ' (' + esc(andList(chat.map(function (e) { return engine(st, e).short; }))) + ')' : '') + '. Being unknown and being unrecommended are different problems with different fixes.</p>' + knownHtml(st, r) +
      (probes.length ? '<details class="probes"><summary>Read the full answers about you</summary>' + stack(probes.map(function (a) { return { e: a.e, answers: [a] }; }), st, { id: 'known' }) + '</details>' : '') + '</section>' +
      '<section class="sec" id="crawler"><h2>What a crawler sees</h2><p class="sub">Most AI crawlers read the page code and do not run JavaScript. This is your home page through their eyes, and which crawlers your robots.txt lets in.</p><div class="crawl-grid">' + crawlerSheet({ read: r.crawler.ok, status: r.crawler.status, words: r.crawler.words, sample: r.crawler.sample, title: r.crawler.title }, st.site.host) + '<div class="crawl-side">' + botsHtml(r) + '</div></div>' +
      (r.audit && r.audit.pages.length > 1 ? '<details class="audit"><summary>' + plural(r.audit.pages.length, 'page') + ' of your site, read one by one</summary><ul class="audit-pages">' + r.audit.pages.map(function (p) { return '<li><b>' + esc(p.path) + '</b><span>' + (p.ok ? (p.words || 0) + ' words' : 'did not open') + '</span>' + (p.issues.length ? '<ul>' + p.issues.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>' : '<span class="fine">nothing to fix</span>') + '</li>'; }).join('') + '</ul></details>' : '') + '</section>' +
      '<section class="sec" id="fixes"><h2>Your fix kit</h2>' + fixesHtml(st, r) + '</section>' +
      '<section class="sec" id="method"><h2>How we measured, and what this cannot tell you</h2><ul class="method">' +
      '<li>' + c.answers + ' answers were collected on ' + dayOf(r.at) + ', asked from ' + esc(from(st)) + ', each in a fresh session with no chat history.</li>' +
      '<li>Google got each search the way people type it. The chat engines got the same search as a question, the way a customer writes it. Each chat engine was asked twice.</li>' +
      (d.known ? '<li>The searches come from your home page. We kept the ones made most often on Google in ' + esc(from(st)) + '. The numbers are monthly estimates from Google Ads keyword data, so read them as sizes, not as exact counts.</li>'
        : '<li>The searches come from your home page. Their search numbers could not be looked up this time, so they are in the order we found them.</li>') +
      '<li>The score is 50% how often you are named, 30% how often your site is cited and 20% how early your name comes.</li>' +
      '<li>AI answers shift by the day, the place and the person. Read this as a snapshot. The re-check shows the direction.</li>' +
      '<li>' + (d.known ? 'Every number of searches here is for Google. ' : '') + 'Nobody outside the AI companies knows how often an AI is asked something. Any tool that shows that number is guessing, so we do not show one.</li>' +
      (r.skipped && r.skipped.length ? '<li>One part of this report could not be completed this time: ' + esc(r.skipped.join(', ')) + '.</li>' : '') + '</ul></section>' +
      recheckHtml(st) + '<p class="print-only">Made with AI Visibility Report by Silit Labs: ' + esc(st.home || '') + '</p></section>';
  }

  function closed(st) {
    return '<section class="stage"><div class="lead"><h1>This report is closed</h1><p class="sub">The payment for it was refunded. You can run a new free check any time.</p><a class="btn mark" href="/ai-visibility-report">Check a website</a></div></section>';
  }

  // The page body for whatever stage the check is in.
  function app(st) {
    if (st.stage === 'draft') return draft(st);
    if (st.stage === 'asking') return asking(st);
    if (st.stage === 'preview') return preview(st);
    if (st.stage === 'building') return building(st);
    if (st.stage === 'report' && st.report) return report(st);
    return closed(st);
  }

  // The plain-text brief a business owner forwards to whoever looks after the website.
  function brief(st) {
    var r = st.report;
    var lines = ['Website fixes for ' + st.site.host, 'From the AI visibility report of ' + dayOf(r.at) + '. AI engines named us in ' + r.counts.named + ' of ' + r.counts.answers + ' answers.', ''];
    var vols = measuredAny(st);
    lines.push('Searches checked' + (vols ? ', with Google searches a month in ' + from(st) : '') + ':');
    (st.topics || []).forEach(function (t) {
      var m = r.matrix.filter(function (x) { return x.topic === t.id; })[0];
      lines.push('- ' + t.keyword + (t.measured ? ' (' + (counts(t) ? num(t.volume) : 'too few to measure') + ')' : '') + (m && m.answers ? ': ' + namedIn(m) + ' answers' : ''));
    });
    lines.push('');
    r.fixes.forEach(function (f) {
      lines.push(f.n + '. ' + f.title + ' (' + WHO[f.who].toLowerCase() + ', ' + mins(f.minutes) + ')');
      lines.push('Why: ' + f.why);
      f.steps.forEach(function (s) { lines.push('- ' + s); });
      if (f.asset) { lines.push('', f.asset.label + ':', f.asset.body); }
      if (f.extra) { lines.push('', f.extra.label + ':', f.extra.body); }
      lines.push('');
    });
    return lines.join('\n');
  }

  return { esc: esc, plural: plural, andList: andList, dayOf: dayOf, when: when, app: app, draft: draft, asking: asking, preview: preview, building: building, report: report, sheet: sheet, stack: stack, freeGroups: freeGroups, tallyText: tallyText, verdict: verdict, notesFor: notesFor, crawlerSheet: crawlerSheet, matrixHtml: matrixHtml, brief: brief, tabState: tabState, kw: kw, volHtml: volHtml, searchStrip: searchStrip, demandHtml: demandHtml };
});
