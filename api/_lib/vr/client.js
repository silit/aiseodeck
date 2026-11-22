/* AI Visibility Report: what runs in the browser. It starts a check from the form, keeps a running check moving
 * (one request does a slice of the work, another reads the state), writes each answer onto its sheet as it arrives,
 * lines the pen notes up with the marks they explain, and handles the small things: tabs, copy buttons, the done
 * boxes of the fix kit. Rendering itself lives in view.js, shared with the server. */
(function () {
  'use strict';
  var V = window.VRView;
  var B = window.__VR || {};
  var D = document;
  var app = D.getElementById('app');
  var st = B.state || null;
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var api = B.api || http();
  var go = B.go || function (url) { window.location.assign(url); };
  var timers = [];
  var run = 0; // every open() starts a new run; loops of an older run stop themselves

  function http() {
    function call(method, path, body) {
      return fetch(path, { method: method, headers: body ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' }, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' })
        .then(function (r) { return r.json().catch(function () { return { error: 'Something went wrong on our side. Try again in a minute.' }; }); });
    }
    return {
      start: function (url) { return call('POST', '/check/start', { url: url }); },
      state: function (id) { return call('GET', '/check/' + id + '/state'); },
      run: function (id, d) { return call('POST', '/check/' + id + '/run', d); },
      pump: function (id) { return call('POST', '/check/' + id + '/pump', {}); },
      unlock: function (id) { return call('POST', '/check/' + id + '/unlock', {}); },
      email: function (id, e) { return call('POST', '/check/' + id + '/email', { email: e }); },
      recheck: function (id) { return call('POST', '/check/' + id + '/recheck', {}); },
      confirm: function (id, c) { return call('POST', '/check/' + id + '/confirm', { checkout_id: c }); }
    };
  }
  function later(fn, ms) { var t = setTimeout(fn, ms); timers.push(t); return t; }
  function $(sel, root) { return (root || D).querySelector(sel); }
  function $$(sel, root) { return [].slice.call((root || D).querySelectorAll(sel)); }
  function html(s) { var d = D.createElement('div'); d.innerHTML = s; return d; }
  function msg(form, text, ok) { var m = $('.form-msg', form); if (m) { m.textContent = text || ''; m.className = 'form-msg' + (ok ? ' ok' : ''); } }

  /* ---------- pen notes: each one sits beside the mark it explains ---------- */
  function placeNotes(scope) {
    var wide = window.matchMedia('(min-width: 1021px)').matches && !window.matchMedia('print').matches;
    $$('.take', scope || D).forEach(function (take) {
      var notes = $('.notes', take);
      if (!notes) return;
      var items = [].slice.call(notes.children);
      if (!wide || !take.offsetParent) { notes.classList.remove('placed'); notes.style.minHeight = ''; items.forEach(function (li) { li.style.top = ''; }); return; }
      notes.classList.add('placed');
      var base = notes.getBoundingClientRect().top;
      var last = -100;
      var want = [];
      items.forEach(function (li) {
        var a = $('[data-anchor="' + li.getAttribute('data-on') + '"]', take) || $('[data-anchor="top"]', take);
        // a mark below the visible part of a shortened answer has nothing to point at
        var clip = a && a.closest('.answer');
        li.hidden = !!(a && clip && clip.scrollHeight > clip.clientHeight + 2 && a.getBoundingClientRect().top > clip.getBoundingClientRect().bottom - 24);
        if (li.hidden || !li.offsetHeight) return;
        want.push({ li: li, y: a ? a.getBoundingClientRect().top - base - 3 : 0 });
      });
      // top to bottom in the order of the marks, each pushed down just enough to clear the one above
      want.sort(function (p, q) { return p.y - q.y; }).forEach(function (w) {
        var y = Math.max(w.y, last + 14, 10);
        w.li.style.top = Math.round(y) + 'px';
        last = y + w.li.offsetHeight;
      });
      notes.style.minHeight = Math.round(last + 6) + 'px';
    });
  }
  var resizeT;
  window.addEventListener('resize', function () { clearTimeout(resizeT); resizeT = setTimeout(function () { placeNotes(); }, 120); });
  if (D.fonts && D.fonts.ready) D.fonts.ready.then(function () { placeNotes(); });
  window.addEventListener('load', function () { placeNotes(); });

  /* ---------- tabs ---------- */
  function selectTab(tab, focus) {
    var list = tab.parentNode;
    $$('.tab', list).forEach(function (t) {
      var on = t === tab;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      var p = D.getElementById(t.getAttribute('aria-controls'));
      if (p) p.hidden = !on;
    });
    if (focus) tab.focus();
    if (tab.scrollIntoView && list.scrollWidth > list.clientWidth) { list.scrollLeft = Math.max(0, tab.offsetLeft - 24); }
    placeNotes(list.parentNode);
  }
  D.addEventListener('keydown', function (e) {
    var tab = e.target.closest && e.target.closest('.tab');
    if (!tab || ['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(e.key) < 0) return;
    var tabs = $$('.tab', tab.parentNode), i = tabs.indexOf(tab);
    var n = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    e.preventDefault();
    picked = true;
    selectTab(tabs[n], true);
  });

  /* ---------- copy ---------- */
  function copyText(text, btn) {
    var label = btn && $('span', btn);
    var done = function (ok) { if (!label) return; var old = label.getAttribute('data-l') || label.textContent; label.setAttribute('data-l', old); label.textContent = ok ? 'Copied' : 'Select and copy'; setTimeout(function () { label.textContent = old; }, 1800); };
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); }); return; }
    done(false);
  }

  /* ---------- the fix kit's done boxes (kept in this browser only) ---------- */
  function doneKey() { return 'vr-done:' + (st && st.id); }
  function readDone() { try { return JSON.parse(window.localStorage.getItem(doneKey()) || '[]') || []; } catch (e) { return []; } }
  function writeDone(list) { try { window.localStorage.setItem(doneKey(), JSON.stringify(list)); } catch (e) { /* private window: the boxes still work for this visit */ } }
  function showDone(list) {
    $$('.fix').forEach(function (f) { var on = list.indexOf(f.getAttribute('data-fix')) >= 0; f.classList.toggle('is-done', on); var c = $('[data-done]', f); if (c) c.checked = on; });
    var n = $('[data-done-count]');
    if (n) n.textContent = $$('.fix.is-done').length;
  }

  /* ---------- clicks and forms ---------- */
  var picked = false; // the visitor chose a tab themselves: stop switching tabs for them
  D.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target : e.target.parentNode;
    var el;
    if ((el = t.closest('.tab'))) { picked = true; selectTab(el); return; }
    if ((el = t.closest('.ask-b'))) {
      var panel = el.closest('.panel'), k = el.getAttribute('data-take');
      $$('.ask-b', panel).forEach(function (b) { b.setAttribute('aria-pressed', b === el ? 'true' : 'false'); });
      $$('.take', panel).forEach(function (tk, i) { tk.hidden = String(i) !== k; });
      placeNotes(panel);
      return;
    }
    if ((el = t.closest('.dm-k'))) {
      // a search named above the table: open its answers and go there
      var topic = D.getElementById(el.getAttribute('href').slice(1));
      if (topic) { e.preventDefault(); topic.open = true; topic.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }); placeNotes(topic); }
      return;
    }
    if ((el = t.closest('[data-copy]'))) { var pre = D.getElementById(el.getAttribute('data-copy')); if (pre) copyText(pre.textContent, el); return; }
    if ((el = t.closest('[data-copy-brief]'))) { if (st && st.report) copyText(V.brief(st), el); return; }
    if ((el = t.closest('[data-copy-link]'))) { copyText(window.location.href.replace(/[?#].*$/, ''), el); return; }
    if ((el = t.closest('[data-print]'))) { window.print(); return; }
    if ((el = t.closest('[data-replay]'))) { playHero(true); return; }
    if ((el = t.closest('.toc a, .top3 a'))) { var sec = D.getElementById(el.getAttribute('href').slice(1)); if (sec) { e.preventDefault(); sec.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }); } }
  });
  // The search picked on the first screen brings its question with it; a question the visitor reworded is kept for
  // as long as the page is open, so trying another search does not lose it.
  var worded = {};
  D.addEventListener('change', function (e) {
    var c = e.target;
    if (!c.getAttribute) return;
    if (c.name === 'topic' && c.type === 'radio') {
      var q = $('#vr-q');
      if (!q) return;
      worded[q.getAttribute('data-topic')] = q.value;
      q.setAttribute('data-topic', c.value);
      q.value = worded[c.value] != null ? worded[c.value] : c.getAttribute('data-q');
      return;
    }
    if (c.id === 'vr-country') {
      // the search numbers on the page are for the country we guessed; another country gets its own when the check starts
      var list = $('.kw-list'), note = D.getElementById('vr-stale');
      if (!list || !note || !$('.vol', list)) return;
      var moved = c.value !== list.getAttribute('data-country');
      list.parentNode.classList.toggle('stale', moved);
      note.hidden = !moved;
      note.textContent = moved ? 'Those numbers were for ' + list.getAttribute('data-name') + '. We look them up for ' + c.options[c.selectedIndex].text + ' when the check starts.' : '';
      return;
    }
    if (!c.getAttribute('data-done')) return;
    var list = readDone(), id = c.getAttribute('data-done'), i = list.indexOf(id);
    if (c.checked && i < 0) list.push(id);
    if (!c.checked && i >= 0) list.splice(i, 1);
    writeDone(list);
    showDone(list);
  });
  D.addEventListener('toggle', function (e) { if (e.target && e.target.tagName === 'DETAILS') placeNotes(e.target); }, true);
  // a printed report holds every answer: folded parts are opened for the print and folded again after
  var folded = [];
  window.addEventListener('beforeprint', function () { folded = $$('details:not([open])'); folded.forEach(function (d) { d.open = true; }); placeNotes(); });
  window.addEventListener('afterprint', function () { folded.forEach(function (d) { d.open = false; }); folded = []; placeNotes(); });

  D.addEventListener('submit', function (e) {
    var f = e.target;
    if (f.classList.contains('go')) { e.preventDefault(); startCheck(f); return; }
    var act = f.getAttribute('data-act');
    if (!act) return;
    e.preventDefault();
    var btn = $('button[type=submit]', f);
    var busy = function (on) { if (btn) btn.disabled = !!on; };
    if (act === 'run') {
      var q = $('#vr-q', f), brand = $('#vr-brand', f);
      if (brand.value.trim().length < 2) { msg(f, 'Type the name of your business.'); brand.focus(); return; }
      if (q.value.trim().length < 8) { msg(f, 'Write the question a customer would ask, in a full sentence.'); q.focus(); return; }
      busy(true); msg(f, '');
      // the search that is picked, and its question as it now reads; the server decides whether a reworded
      // question still belongs to that search
      var pick = $('input[name=topic]:checked', f);
      api.run(st.id, { topic: pick ? pick.value : q.getAttribute('data-topic') || '', question: q.value.trim(), brand: brand.value.trim(), country: $('#vr-country', f).value }).then(function (r) {
        if (r && r.error) { busy(false); msg(f, r.error); return; }
        refresh(true);
      }, function () { busy(false); msg(f, 'We could not reach the server. Check your connection and try again.'); });
    } else if (act === 'unlock') {
      busy(true); msg(f, '');
      api.unlock(st.id).then(function (r) {
        if (r && r.url) { go(r.url); return; }
        busy(false);
        if (r && r.started) { refresh(true); return; }
        msg(f, (r && r.error) || 'The checkout could not be opened. Try again in a minute.');
      }, function () { busy(false); msg(f, 'We could not reach the server. Check your connection and try again.'); });
    } else if (act === 'email') {
      var input = $('input[type=email]', f);
      busy(true); msg(f, '');
      api.email(st.id, input.value.trim()).then(function (r) {
        busy(false);
        if (r && r.error) { msg(f, r.error); return; }
        var p = D.createElement('p'); p.className = 'mail-set'; p.textContent = 'Saved. We will write to ' + input.value.trim() + '.';
        f.parentNode.replaceChild(p, f);
      }, function () { busy(false); msg(f, 'We could not reach the server. Try again.'); });
    } else if (act === 'recheck') {
      busy(true); msg(f, '');
      api.recheck(st.id).then(function (r) { if (r && r.id) { go('/check/' + r.id); return; } busy(false); msg(f, (r && r.error) || 'The re-check could not be started.'); }, function () { busy(false); msg(f, 'We could not reach the server. Try again.'); });
    }
  });

  /* ---------- starting a check from the landing form ---------- */
  function startCheck(f) {
    var input = $('input[name=url]', f), btn = $('button[type=submit]', f);
    var steps = $$('.reading li', f);
    var url = input.value.trim();
    if (!url) { msg(f, 'Type your website address, like yourbusiness.com.'); input.focus(); return; }
    msg(f, '');
    btn.disabled = true;
    f.classList.add('busy');
    var list = $('.reading', f);
    if (list) list.hidden = false;
    var i = 0, tick;
    var host = url.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
    if (steps[0]) steps[0].textContent = 'Opening ' + host;
    function step() { steps.forEach(function (li, k) { li.className = k < i ? 'done' : k === i ? 'now' : ''; }); if (i < steps.length - 1) { i++; tick = setTimeout(step, 2200); } }
    step();
    var stop = function () { clearTimeout(tick); btn.disabled = false; f.classList.remove('busy'); if (list) list.hidden = true; };
    api.start(url).then(function (r) {
      if (r && r.id) { steps.forEach(function (li) { li.className = 'done'; }); go('/check/' + r.id); return; }
      stop(); msg(f, (r && r.error) || 'Something went wrong. Try again in a minute.'); input.focus();
    }, function () { stop(); msg(f, 'We could not reach the server. Check your connection and try again.'); });
  }

  /* ---------- writing an answer onto its sheet ---------- */
  function freshen(take) {
    if (reduce) return;
    $$('.answer > *', take).forEach(function (el, i) { el.style.setProperty('--n', Math.min(i, 9)); });
    $$('.note', take).forEach(function (el, i) { el.style.setProperty('--n', i); });
    take.classList.add('fresh');
    later(function () { take.classList.remove('fresh'); }, 4200);
  }
  // Replaces one take and its tab with the look of the given slots, without touching the other sheets.
  function swapSlot(stackEl, groups, sdata, id, animate) {
    var temp = html(V.stack(groups, sdata, { id: stackEl.getAttribute('data-stack') }));
    var oldTake = $('.take[data-slot="' + id + '"]', stackEl), newTake = $('.take[data-slot="' + id + '"]', temp);
    if (!oldTake || !newTake) return null;
    newTake.hidden = oldTake.hidden;
    oldTake.parentNode.replaceChild(newTake, oldTake);
    var panel = newTake.closest('.panel');
    var tab = D.getElementById(panel.getAttribute('aria-labelledby'));
    var ntab = $('#' + tab.id, temp);
    if (ntab) { var sel = tab.getAttribute('aria-selected'); tab.className = ntab.className; tab.innerHTML = ntab.innerHTML; tab.setAttribute('aria-selected', sel); }
    if (animate) freshen(newTake);
    placeNotes(stackEl);
    return tab;
  }

  /* ---------- a check in progress ---------- */
  function sig(a) { return a.state === 'pending' ? 'p' : a.state + (a.ready === false ? ':w' : ''); }
  function settled(a, since) { return a.state !== 'pending' && (a.ready !== false || Date.now() - since > 5000); }

  function refresh(scrollTop) {
    return api.state(st.id).then(function (n) {
      if (!n || n.error || !n.stage) return;
      open(n, scrollTop);
    });
  }

  function watchAsking(my) {
    var shown = {}, onPage = {}, firstSeen = {}, queue = [], revealing = false, fails = 0, t0 = Date.now(), ending = false;
    (st.slots || []).forEach(function (a) { shown[a.id] = onPage[a.id] = a.state !== 'pending'; });
    var live = function () { return my === run; };
    function pump() { if (!live() || ending) return; api.pump(st.id).then(function (r) { later(pump, r && r.busy ? 2500 : 700); }, function () { later(pump, 4000); }); }
    function next() {
      if (!live()) return;
      if (!queue.length) { revealing = false; return; }
      revealing = true;
      var a = queue.shift();
      var stackEl = $('.stack[data-stack="free"]');
      if (!stackEl) { revealing = false; return; }
      onPage[a.id] = true;
      var tab = swapSlot(stackEl, V.freeGroups(st), st, a.id, true);
      if (tab && !picked) selectTab(tab);
      var tally = D.getElementById('vr-tally');
      if (tally) tally.textContent = V.tallyText(visible());
      later(next, reduce ? 300 : 3000);
    }
    // what is on the page: answers not yet revealed still count as pending
    function visible() { return { slots: (st.slots || []).map(function (a) { return onPage[a.id] ? a : { id: a.id, state: 'pending', e: a.e }; }) }; }
    function poll() {
      if (!live()) return;
      api.state(st.id).then(function (n) {
        if (!live()) return;
        if (!n || !n.stage) { fails++; later(poll, 2500); return; }
        fails = 0;
        var slots = n.slots || [];
        st.slots = (st.slots || []).map(function (old) {
          var a = slots.filter(function (x) { return x.id === old.id; })[0] || old;
          if (a.state !== 'pending' && !firstSeen[a.id]) firstSeen[a.id] = Date.now();
          if (!shown[a.id] && settled(a, firstSeen[a.id] || Date.now())) { shown[a.id] = true; queue.push(a); return a; }
          return shown[a.id] ? a : old;
        });
        if (queue.length && !revealing) next();
        if (n.stage !== 'asking') {
          ending = true;
          var wait = function () { if (!live()) return; if (queue.length || revealing) { later(wait, 500); return; } later(function () { if (live()) open(n); }, reduce ? 0 : 1300); };
          // anything still unrevealed at the end is shown now
          slots.forEach(function (a) { if (!shown[a.id] && a.state !== 'pending') { shown[a.id] = true; queue.push(a); } });
          st.slots = slots;
          if (queue.length && !revealing) next();
          wait();
          return;
        }
        if (Date.now() - t0 > 150000 && !$('.slow')) { var p = D.createElement('p'); p.className = 'tiny center slow'; p.textContent = 'The engines are slow right now. Keep this page open, or come back to this address in a few minutes.'; app.appendChild(p); }
        later(poll, 1500);
      }, function () { fails++; later(poll, Math.min(8000, 1500 * fails)); });
    }
    pump();
    later(poll, 900);
  }

  function watchBuilding(my) {
    var live = function () { return my === run; };
    function pump() { if (!live()) return; api.pump(st.id).then(function (r) { later(pump, r && r.busy ? 3000 : 800); }, function () { later(pump, 5000); }); }
    function poll() {
      if (!live()) return;
      api.state(st.id).then(function (n) {
        if (!live()) return;
        if (!n || !n.stage) { later(poll, 4000); return; }
        if (n.stage !== 'building') { open(n, true); return; }
        st = n;
        var temp = html(V.building(n));
        ['.lead', '.steps'].forEach(function (sel) { var a = $(sel, app), b = $(sel, temp); if (a && b) a.innerHTML = b.innerHTML; });
        var side = $('.build-side', app), nside = $('.build-side', temp);
        if (side && nside) { var m = $('.scroll', side), nm = $('.scroll', nside); if (m && nm) m.innerHTML = nm.innerHTML; else if (!m && nm) { side.insertBefore(nm, side.firstChild); var lg = $('.legend', nside); if (lg) side.insertBefore(lg, nm.nextSibling); } }
        later(poll, 2500);
      }, function () { later(poll, 5000); });
    }
    pump();
    later(poll, 1500);
  }

  function hydrate() {
    placeNotes();
    if (st && st.stage === 'report') {
      showDone(readDone());
      if ('IntersectionObserver' in window) {
        var links = {};
        $$('.toc a').forEach(function (a) { links[a.getAttribute('href').slice(1)] = a; });
        var io = new IntersectionObserver(function (entries) {
          entries.forEach(function (en) { if (en.isIntersecting && links[en.target.id]) { $$('.toc a.on').forEach(function (a) { a.classList.remove('on'); }); links[en.target.id].classList.add('on'); } });
        }, { rootMargin: '-30% 0px -60% 0px' });
        $$('.sec').forEach(function (s) { io.observe(s); });
      }
    }
  }

  // Shows a check in whatever stage it is in and keeps it moving.
  function open(n, scrollTop) {
    run++;
    timers.forEach(clearTimeout); timers = [];
    var keep = st && n && st.id === n.id && $('.stack[data-stack="free"] .tab[aria-selected=true]');
    var active = keep ? $$('.stack[data-stack="free"] .tab').indexOf(keep) : 0;
    st = n;
    if (st.stage === 'asking') picked = false;
    if (app) {
      app.innerHTML = V.app(st);
      app.setAttribute('data-stage', st.stage);
      var tabs = $$('.stack[data-stack="free"] .tab');
      if (active > 0 && tabs[active]) selectTab(tabs[active]);
    }
    if (scrollTop) window.scrollTo(0, 0);
    hydrate();
    loops();
  }
  // Back from the checkout before the payment is final: ask until it is, then open the report.
  function watchPaying(my) {
    var tries = 0;
    function ask() {
      if (my !== run) return;
      api.confirm(st.id, st.paying).then(function (r) {
        if (my !== run) return;
        if (r && r.ok) { refresh(true); return; }
        if (++tries < 60) later(ask, 3000);
      }, function () { if (++tries < 60) later(ask, 5000); });
    }
    later(ask, 2500);
  }
  function loops() {
    if (!st || B.still) return;
    if (st.stage === 'asking') watchAsking(run);
    else if (st.stage === 'building') watchBuilding(run);
    else if (st.stage === 'preview' && st.paying && api.confirm) watchPaying(run);
  }

  /* ---------- the landing page's sample: three answers arriving ---------- */
  var heroPlayed = false;
  function playHero(force) {
    var box = D.getElementById('hero-demo');
    if (!box || !B.hero) return;
    if (heroPlayed && !force) return;
    heroPlayed = true;
    var my = ++run;
    timers.forEach(clearTimeout); timers = [];
    var full = B.hero, slots = full.slots;
    var blank = function (a) { return { id: a.id, topic: a.topic, q: a.q, e: a.e, state: 'pending', asked: a.asked }; };
    var view = {}; for (var k in full) view[k] = full[k];
    view.slots = slots.map(blank);
    box.innerHTML = V.stack(V.freeGroups(view), view, { id: 'hero' });
    box.classList.add('ready');
    placeNotes(box);
    picked = false;
    slots.forEach(function (a, i) {
      later(function () {
        if (my !== run) return;
        view.slots[i] = a;
        var tab = swapSlot($('.stack', box), V.freeGroups(view), view, a.id, true);
        if (tab && !picked) selectTab(tab);
      }, 1100 + i * 3600);
    });
  }
  function initLanding() {
    var box = D.getElementById('hero-demo');
    if (!box || !B.hero) return;
    if (reduce || !('IntersectionObserver' in window)) { box.classList.add('ready'); return; } // the finished sample is already on the page
    var io = new IntersectionObserver(function (entries) { if (entries[0].isIntersecting) { io.disconnect(); playHero(); } }, { threshold: 0.35 });
    io.observe(box);
  }

  window.VRApp = { open: open, placeNotes: placeNotes, playHero: playHero, state: function () { return st; } };
  if (B.page === 'landing') initLanding();
  if (st) { hydrate(); loops(); } else placeNotes();
})();
