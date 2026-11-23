// AI SEO Deck inside the Webflow Designer: the page that is open, its keyword, what to fix, and a title and
// description set on the page in place when the user presses Apply.
// The title and description shown as "now" are the ones the Designer has at this moment (Designer API). The
// headings, text and image findings come from Site health, which reads the page through the Webflow Data API.
// Talks to the app with a Webflow ID token; nothing else identifies the user.
(function () {
  'use strict';
  var API = 'https://aiseodeck.silitlabs.com';
  var app = document.getElementById('app');
  var S = {
    view: 'page',
    info: null,
    ctx: null,
    meta: null, // what is in the two fields of the editor
    ai: null, // the last title and description the AI wrote, to label them as a suggestion
    busy: '',
    msg: null
  };
  // The SVG namespace, read from the empty <svg> element of index.html.
  var SVG_NS = document.getElementById('svgns').namespaceURI;

  /* ---------- small helpers ---------- */
  function h(tag, attrs) {
    var el = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) {
      c.forEach(function (x) {
        add(el, x);
      });
      return;
    }
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  function svg(d, cls) {
    var s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('viewBox', '0 0 16 16');
    s.setAttribute('aria-hidden', 'true');
    if (cls) s.setAttribute('class', cls);
    var p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    s.appendChild(p);
    return s;
  }
  var ICON = {
    n: 'M3.5 8.5l3 3 6-7',
    b: 'M3.5 8.5l3 3 6-7',
    i: 'M6.5 9.5l3-3M5.5 7.5l-1 1a2.1 2.1 0 003 3l1-1M10.5 8.5l1-1a2.1 2.1 0 00-3-3l-1 1',
    o: 'M4.5 4.5l7 7M11.5 4.5l-7 7',
    x: 'M4 8h8',
    f: 'M8 4.5v4.2M8 11.3h.01'
  };
  var WORD = {
    n: 'names you',
    b: 'names you and links your site',
    i: 'links your site, does not name you',
    o: 'does not name you',
    x: 'shows no AI answer',
    f: 'could not be read',
    w: 'not checked yet'
  };
  function mark(st, label) {
    var m = h('span', { class: 'm st-' + st, role: 'img', 'aria-label': label, title: label });
    if (ICON[st]) m.appendChild(svg(ICON[st]));
    return m;
  }
  function logo() {
    var s = document.createElementNS(SVG_NS, 'svg');
    s.setAttribute('viewBox', '0 0 32 32');
    s.setAttribute('width', '20');
    s.setAttribute('height', '20');
    s.setAttribute('aria-hidden', 'true');
    var parts = [
      ['rect', { width: 32, height: 32, rx: 9, fill: '#ECEDF2' }],
      ['circle', { cx: 11, cy: 11, r: 4, fill: '#E8C300' }],
      ['circle', { cx: 21, cy: 11, r: 4, fill: 'none', stroke: '#2F5BFF', 'stroke-width': 2.4 }],
      ['circle', { cx: 11, cy: 21, r: 2, fill: '#8A93B8' }],
      ['circle', { cx: 21, cy: 21, r: 4, fill: '#E8C300', stroke: '#2F5BFF', 'stroke-width': 2.4 }]
    ];
    parts.forEach(function (part) {
      var el = document.createElementNS(SVG_NS, part[0]);
      Object.keys(part[1]).forEach(function (k) {
        el.setAttribute(k, String(part[1][k]));
      });
      s.appendChild(el);
    });
    return s;
  }
  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many || one + 's');
  }
  function ago(ts) {
    if (!ts) return 'some time ago';
    var sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (sec < 60) return 'just now';
    if (sec < 3600) return Math.floor(sec / 60) + ' min ago';
    if (sec < 86400) return Math.floor(sec / 3600) + ' h ago';
    return plural(Math.floor(sec / 86400), 'day') + ' ago';
  }
  function andList(a) {
    return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
  }
  // Links to AI SEO Deck open in a new browser tab only when the user clicks them.
  function link(url, cls, text) {
    return h('a', { class: cls, href: url, target: '_blank', rel: 'noopener noreferrer' }, text);
  }
  function notify(type, message) {
    try {
      webflow.notify({ type: type, message: message });
    } catch (e) {
      /* the message shows in the panel too */
    }
  }

  /* ---------- Webflow and the app ---------- */
  async function pageInfo() {
    var site = await webflow.getSiteInfo();
    var page = await webflow.getCurrentPage();
    var info = {
      siteId: site.siteId,
      siteName: site.siteName,
      domain: '',
      page: page,
      pageId: page ? page.id : '',
      name: '',
      path: '/',
      title: '',
      description: '',
      template: false,
      isPage: !!(page && page.type === 'Page')
    };
    var d =
      (site.domains || []).filter(function (x) {
        return x.default;
      })[0] || (site.domains || [])[0];
    info.domain =
      d && d.url
        ? String(d.url)
            .replace(/^https?:\/\//, '')
            .replace(/\/$/, '')
        : '';
    if (info.isPage) {
      var safe = function (p, dflt) {
        return p.then(
          function (v) {
            return v;
          },
          function () {
            return dflt;
          }
        );
      };
      info.name = await safe(page.getName(), '');
      var home = await safe(page.isHomepage(), false);
      var pp = await safe(page.getPublishPath(), null);
      var slug = await safe(page.getSlug(), '');
      info.path = home ? '/' : pp ? (pp.charAt(0) === '/' ? pp : '/' + pp) : '/' + slug;
      info.title = (await safe(page.getTitle(), '')) || '';
      info.description = (await safe(page.getDescription(), '')) || '';
      info.template = !!(await safe(page.getCollectionId(), null));
    }
    return info;
  }
  // Every request carries a fresh ID token from the Designer. The token is short lived and is not kept.
  async function call(route, body) {
    var token;
    try {
      token = await webflow.getIdToken();
    } catch (e) {
      return {
        error: 'The Designer did not confirm who is using this panel. Close the app and open it again.'
      };
    }
    var payload = Object.assign(
      { idToken: token, siteId: S.info.siteId, pageId: S.info.pageId, path: S.info.path },
      body || {}
    );
    var res;
    try {
      res = await fetch(API + '/ext/' + route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      return { error: 'AI SEO Deck could not be reached. Check your connection and try again.' };
    }
    var j = {};
    try {
      j = await res.json();
    } catch (e) {
      j = {};
    }
    if (!res.ok && !j.error) j.error = 'AI SEO Deck could not answer. Try again in a minute.';
    return j;
  }
  async function load() {
    S.view = 'page';
    S.msg = null;
    S.meta = null;
    S.ai = null;
    render(h('p', { class: 'loading', text: 'Reading this page…' }));
    try {
      S.info = await pageInfo();
    } catch (e) {
      S.ctx = { error: 'The Designer did not give the page details. Switch to a page and try again.' };
      return draw();
    }
    if (!S.info.isPage) {
      S.ctx = { error: 'Open a page in the Designer to see its fixes.' };
      return draw();
    }
    S.ctx = await call('context');
    draw();
  }

  /* ---------- screens ---------- */
  function render(node) {
    app.textContent = '';
    add(app, node);
  }
  function top(withBack, title) {
    if (withBack)
      return h(
        'header',
        { class: 'top' },
        h(
          'button',
          {
            class: 'back',
            type: 'button',
            'aria-label': 'Back to this page',
            onclick: function () {
              S.view = 'page';
              S.msg = null;
              draw();
            }
          },
          svg('M10 3.5L5.5 8l4.5 4.5')
        ),
        h('b', { text: title }),
        h('span', { class: 'path', title: S.info.path, text: S.info.path })
      );
    var c = S.ctx && S.ctx.site;
    return h(
      'header',
      { class: 'top' },
      logo(),
      h('b', { text: 'AI SEO Deck' }),
      c && c.score != null
        ? h('span', {
            class: 'pill',
            title: 'Share of AI answers that name you, across all your keywords',
            text: 'Site ' + c.score + '%'
          })
        : null
    );
  }
  function msgBox() {
    return S.msg
      ? h('div', {
          class: 'msg ' + S.msg.kind,
          role: S.msg.kind === 'err' ? 'alert' : 'status',
          text: S.msg.text
        })
      : null;
  }

  function draw() {
    var c = S.ctx || {};
    if (c.connect) {
      return render([
        top(),
        h(
          'div',
          { class: 'body' },
          h(
            'div',
            { class: 'card' },
            h('h2', { text: 'Connect this site to AI SEO Deck' }),
            h('p', {
              text: 'AI SEO Deck has nothing to show for this site here. If the site is not connected yet, connect it and choose your keywords, then come back. If it is connected, press Try again.'
            }),
            h(
              'div',
              { class: 'row' },
              link(c.connectUrl, 'btn mark', 'Connect'),
              h('button', { class: 'btn', type: 'button', onclick: load }, 'Try again')
            )
          )
        )
      ]);
    }
    if (c.error && !c.ok) {
      return render([
        top(),
        h(
          'div',
          { class: 'body' },
          h('div', { class: 'msg err', role: 'alert', text: c.error }),
          h('button', { class: 'btn', type: 'button', onclick: load }, 'Try again')
        )
      ]);
    }
    if (!c.site.ready) {
      return render([
        top(),
        h(
          'div',
          { class: 'body' },
          h(
            'div',
            { class: 'card' },
            h('h2', { text: 'Finish the setup' }),
            h('p', {
              text: 'Add your brand, rivals and keywords in AI SEO Deck. The first check runs right after.'
            }),
            link(c.site.setupUrl, 'btn mark', 'Open the setup')
          )
        )
      ]);
    }
    if (S.view === 'meta') return drawMeta();
    return drawPage();
  }

  function keywordCard(k) {
    var c = S.ctx;
    var named = c.engines
      .filter(function (e) {
        var s = k.states[e.id];
        return s === 'n' || s === 'b';
      })
      .map(function (e) {
        return e.label;
      });
    var line = !k.checked
      ? 'Not checked yet. It is checked with the next scheduled check.'
      : !k.answered
        ? 'No AI answer could be read yet.'
        : named.length === 0
          ? 'No engine names ' + c.site.name + ' yet.'
          : named.length === 1
            ? 'Only ' + named[0] + ' names ' + c.site.name + '.'
            : named.length + ' of ' + k.answered + ' engines name ' + c.site.name + '.';
    if (k.lostTo && k.lostTo.length) line += ' ' + andList(k.lostTo) + ' named instead.';
    var strip = h(
      'div',
      { class: 'strip' },
      c.engines.map(function (e) {
        var st = k.states[e.id] || 'w';
        return mark(st, e.label + ': ' + (WORD[st] || st));
      }),
      k.checked ? h('span', { class: 'n', text: k.named + ' of ' + k.answered }) : null
    );
    return h(
      'section',
      { class: 'card', 'aria-label': 'Keyword ' + k.text },
      h(
        'div',
        { class: 'kwhead' },
        h('span', { class: 'k', text: 'Keyword for this page' }),
        h('h2', { text: k.text })
      ),
      strip,
      h('p', { text: line })
    );
  }

  // What the title and description of the open page need, from the values the Designer has now.
  function metaState() {
    var r = S.ctx && S.ctx.rules;
    var t = (S.info.title || '').trim(),
      d = (S.info.description || '').trim();
    var out = { title: '', description: '', titleLength: t.length, descriptionLength: d.length };
    if (!t) out.title = 'missing';
    else if (r && (t.length < r.title.min || t.length > r.title.max)) out.title = 'length';
    if (!d) out.description = 'missing';
    else if (r && (d.length < r.description.min || d.length > r.description.max)) out.description = 'length';
    return out;
  }
  function aim(kind) {
    var r = S.ctx && S.ctx.rules;
    return r ? 'Aim for ' + r[kind].aimMin + ' to ' + r[kind].aimMax + ' characters' : '';
  }
  function isTemplate() {
    return !!(S.info.template || (S.ctx.page && S.ctx.page.template));
  }
  function openEditor() {
    S.view = 'meta';
    S.msg = null;
    draw();
  }
  function fixItems() {
    var p = S.ctx.page,
      items = [];
    if (isTemplate()) {
      items.push({
        info: true,
        title: 'Collection template',
        note: 'The title and description of collection pages come from the template settings in Webflow.'
      });
    } else {
      var m = metaState();
      if (m.title)
        items.push({
          title: m.title === 'missing' ? 'No SEO title' : 'Title length',
          note:
            (m.title === 'missing'
              ? 'Webflow shows the page name instead. '
              : m.titleLength + ' characters now. ') +
            aim('title') +
            (aim('title') ? ', with the keyword.' : ''),
          cta: m.title === 'missing' ? 'Write' : 'Fix',
          run: openEditor
        });
      if (m.description)
        items.push({
          title: m.description === 'missing' ? 'No meta description' : 'Description length',
          note:
            (m.description === 'missing' ? '' : m.descriptionLength + ' characters now. ') +
            aim('description') +
            (aim('description') ? '.' : ''),
          cta: m.description === 'missing' ? 'Write' : 'Fix',
          run: openEditor
        });
      if (!m.title && !m.description)
        items.push({ ok: true, title: 'Title and description are fine', cta: 'Edit', run: openEditor });
    }
    // the findings Site health made when it read this page from Webflow
    (p.issues || []).forEach(function (x) {
      if (['title_missing', 'title_length', 'desc_missing', 'desc_length'].indexOf(x.code) > -1) return;
      items.push({ title: x.label, note: x.text });
    });
    (p.unknown || []).forEach(function (x) {
      items.push({
        info: true,
        title: x.label + ': not determined',
        note: x.text
      });
    });
    return items;
  }

  function drawPage() {
    var c = S.ctx,
      p = c.page;
    var body = h('div', { class: 'body' });
    add(
      body,
      h(
        'div',
        { class: 'here' },
        h('span', { class: 'k', text: 'This page' }),
        h('span', { class: 'nm', text: S.info.name || p.path }),
        h('span', { class: 'p', text: p.path })
      )
    );
    add(body, msgBox());
    if (c.keywords.length)
      c.keywords.forEach(function (k) {
        add(body, keywordCard(k));
      });
    else
      add(
        body,
        h(
          'section',
          { class: 'card' },
          h('h2', { text: 'No keyword is tracked for this page' }),
          h('p', {
            text: 'Track the search this page should win, and AI SEO Deck checks it on every AI engine in your plan.'
          }),
          link(c.site.keywordsUrl, 'btn', 'Add a keyword')
        )
      );
    var items = fixItems();
    var todo = items.filter(function (x) {
      return !x.ok && !x.info;
    }).length;
    var list = h(
      'ul',
      { class: 'fixes' },
      items.map(function (it) {
        var kind = it.ok ? 'good' : it.info ? 'info' : 'warn';
        var ic = h('span', { class: 'ic ' + kind }, svg(it.ok ? 'M5 8.3l2 2 4-4.3' : 'M8 4.8v3.6M8 11h.01'));
        var circle = document.createElementNS(SVG_NS, 'circle');
        circle.setAttribute('cx', '8');
        circle.setAttribute('cy', '8');
        circle.setAttribute('r', '6.5');
        ic.firstChild.insertBefore(circle, ic.firstChild.firstChild);
        return h(
          'li',
          null,
          ic,
          h(
            'span',
            { class: 'tx' },
            h('b', { text: it.title }),
            it.note ? h('span', { class: 'nt', text: it.note }) : null
          ),
          it.cta
            ? h('button', { class: it.ok ? 'btn' : 'btn mark', type: 'button', onclick: it.run }, it.cta)
            : null
        );
      })
    );
    add(
      body,
      h(
        'section',
        { class: 'sec', 'aria-labelledby': 'fixh' },
        h(
          'div',
          { class: 'hd' },
          h('h2', { id: 'fixh', text: 'Fix this page' }),
          h('span', { text: todo ? plural(todo, 'thing') + ' to fix' : 'Nothing to fix' })
        ),
        list,
        h(
          'p',
          { class: 'note' },
          'Title and description: as the Designer has them now. ',
          p.audited
            ? 'Headings, text and images: read from Webflow by Site health ' +
                ago(p.readAt || p.auditAt) +
                '. '
            : 'Headings, text and images are checked by Site health, which has not read this page yet. ',
          link(c.site.healthUrl, '', p.audited ? 'Refresh in Site health' : 'Open Site health'),
          ' ',
          h('button', { class: 'linkbtn', type: 'button', onclick: load }, 'Read this page again')
        )
      )
    );
    var report = c.keywords[0] ? c.keywords[0].url : c.site.url;
    render([
      top(),
      body,
      h(
        'footer',
        { class: 'foot' },
        link(report, 'btn wide', 'Open the full report'),
        h('span', {
          class: 'note',
          text: c.plan.canApply
            ? 'Fixes go into this page in the Designer. Publish the site when you are ready.'
            : 'Applying fixes is part of the paid plans. You can write and copy them on the free plan.'
        })
      )
    ]);
  }

  // How long a field is, and whether that is inside the length to aim for.
  function counter(n, kind) {
    var r = S.ctx && S.ctx.rules;
    if (!r) return h('span', { class: 'count ok', text: plural(n, 'character') });
    var ok = n >= r[kind].aimMin && n <= r[kind].aimMax;
    return h('span', {
      class: 'count' + (ok ? ' ok' : ''),
      text: plural(n, 'character') + ', aim for ' + r[kind].aimMin + ' to ' + r[kind].aimMax
    });
  }

  function drawMeta() {
    var c = S.ctx;
    var template = isTemplate();
    var m = S.meta || { title: S.info.title || '', description: S.info.description || '' };
    var title = h('input', { type: 'text', id: 'mt', maxlength: '90', value: m.title });
    var desc = h('textarea', { id: 'md', maxlength: '200', rows: '4' });
    desc.value = m.description;
    var tCount = h('span'),
      dCount = h('span');
    var tTag = h('span', { class: 'tag', text: 'Suggested by AI' }),
      dTag = h('span', { class: 'tag', text: 'Suggested by AI' });
    var serpT = h('span', { class: 't' }),
      serpD = h('span', { class: 'd' });
    function sync() {
      S.meta = { title: title.value, description: desc.value };
      tCount.replaceWith((tCount = counter(title.value.length, 'title')));
      dCount.replaceWith((dCount = counter(desc.value.length, 'description')));
      // the label stays only while the field holds exactly what the AI wrote
      tTag.hidden = !(S.ai && S.ai.title === title.value);
      dTag.hidden = !(S.ai && S.ai.description === desc.value);
      serpT.textContent = title.value || S.info.name || 'Page title';
      serpD.textContent = desc.value || 'The description shows here.';
    }
    title.addEventListener('input', sync);
    desc.addEventListener('input', sync);
    var busy = S.busy;
    var write = h(
      'button',
      {
        class: 'btn',
        type: 'button',
        disabled: !!busy || template,
        onclick: async function () {
          S.busy = 'write';
          S.msg = { kind: 'info', text: 'Writing from this page, this takes a few seconds…' };
          drawMeta();
          var r = await call('suggest', { what: 'meta', keywordId: c.keywords[0] ? c.keywords[0].id : '' });
          S.busy = '';
          if (r.ok) {
            S.meta = { title: r.meta.title, description: r.meta.description };
            S.ai = { title: r.meta.title, description: r.meta.description };
            S.msg = {
              kind: 'ok',
              text:
                (r.keyword
                  ? 'Written by AI for the keyword ' + r.keyword + ', from the text of this page in Webflow.'
                  : 'Written by AI from the text of this page in Webflow.') +
                ' It is a suggestion: nothing is changed until you press Apply.'
            };
          } else S.msg = { kind: 'err', text: r.error || 'No suggestion this time.' };
          drawMeta();
        }
      },
      S.ai ? 'Write again' : 'Write with AI'
    );
    var apply = h(
      'button',
      {
        class: 'btn mark',
        type: 'button',
        disabled: !!busy || !c.plan.canApply || template,
        onclick: async function () {
          var t = title.value.replace(/\s+/g, ' ').trim(),
            d = desc.value.replace(/\s+/g, ' ').trim();
          if (t.length < 5 || d.length < 20) {
            S.msg = {
              kind: 'err',
              text: 'Write a title of at least 5 characters and a description of at least 20.'
            };
            return drawMeta();
          }
          S.busy = 'apply';
          drawMeta();
          try {
            await S.info.page.setTitle(t);
            await S.info.page.setDescription(d);
          } catch (e) {
            S.busy = '';
            S.msg = {
              kind: 'err',
              text: 'The Designer did not take the change. Switch to Design mode and try again.'
            };
            return drawMeta();
          }
          // tells the app that this keyword got a fix; the app reads the page's values from Webflow itself
          await call('applied', { keywordId: c.keywords[0] ? c.keywords[0].id : '' });
          S.busy = '';
          notify('Success', 'Title and description set. Publish the site to make them live.');
          await load();
          if (S.ctx && S.ctx.ok && S.ctx.site.ready) {
            S.msg = {
              kind: 'ok',
              text: 'Title and description set on this page. Publish the site to make them live.'
            };
            drawPage();
          }
        }
      },
      busy === 'apply' ? 'Applying…' : 'Apply to this page'
    );
    var body = h(
      'form',
      {
        class: 'body',
        onsubmit: function (e) {
          e.preventDefault();
        }
      },
      msgBox(),
      template
        ? h('div', {
            class: 'msg info',
            text: 'This is a Collection template. Its title and description usually come from collection fields; change them in the template settings in Webflow.'
          })
        : null,
      h(
        'div',
        { class: 'now', 'aria-label': 'On this page now' },
        h('span', { class: 'k', text: 'On this page now, in the Designer' }),
        h('span', { class: 'v', text: (S.info.title || '').trim() || '(no SEO title)' }),
        h('span', { class: 'v sub', text: (S.info.description || '').trim() || '(no meta description)' })
      ),
      h(
        'div',
        { class: 'field' },
        h('div', { class: 'lh' }, h('label', { for: 'mt', text: 'New title' }), tTag),
        title,
        tCount
      ),
      h(
        'div',
        { class: 'field' },
        h('div', { class: 'lh' }, h('label', { for: 'md', text: 'New description' }), dTag),
        desc,
        dCount
      ),
      h(
        'div',
        { class: 'field' },
        h('span', { class: 'flabel', text: 'How the new values can show in search' }),
        h(
          'div',
          { class: 'serp' },
          h('span', {
            class: 'u',
            text:
              (S.info.domain || 'yoursite.com') +
              (S.info.path === '/' ? '' : ' › ' + S.info.path.replace(/^\//, '').replace(/\//g, ' › '))
          }),
          serpT,
          serpD
        )
      ),
      !c.plan.canApply
        ? h(
            'div',
            { class: 'msg info' },
            'Applying is part of the paid plans. Copy the text into Page settings, or ',
            h(
              'a',
              { href: c.plan.upgradeUrl, target: '_blank', rel: 'noopener noreferrer' },
              'see the plans'
            ),
            '.'
          )
        : null
    );
    render([
      top(true, 'Title and description'),
      body,
      h(
        'footer',
        { class: 'foot' },
        h('div', { class: 'row' }, apply, write),
        h('span', {
          class: 'note',
          text: 'Apply sets the two values on this page in the Designer. Publish the site when you are ready.'
        })
      )
    ]);
    sync();
  }

  /* ---------- start ---------- */
  if (typeof webflow === 'undefined') {
    render(h('p', { class: 'empty', text: 'Open AI SEO Deck from the Apps panel in the Webflow Designer.' }));
    return;
  }
  (async function () {
    try {
      await webflow.setExtensionSize({ width: 320, height: 600 });
    } catch (e) {
      try {
        await webflow.setExtensionSize('comfortable');
      } catch (e2) {
        /* keeps the size from the manifest */
      }
    }
    try {
      webflow.subscribe('currentpage', function () {
        load();
      });
    } catch (e) {
      /* the panel still works for the page it opened on */
    }
    load();
  })();
})();
