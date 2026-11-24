'use strict';
// Reads the content the Webflow API returns for a page (the HTML of its text nodes): headings, words, images
// and the questions the page answers. Small and dependency free. It reads what Webflow gave and requests nothing.

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
function decode(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e) => {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
    return ENT[e.toLowerCase()] != null ? ENT[e.toLowerCase()] : m;
  });
}
const stripTags = (h) => decode(String(h || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

// The HTML without what is never page text: comments, and scripts, styles, noscript, SVG and templates
// with all they hold. They are taken out in the order a browser meets them, so what starts first wins:
// a "<!--" inside a script is not a comment, and a "<script" inside a comment is not a script. One that
// is never closed runs to the end, as it does in a browser.
const HIDDEN_END = {};
for (const tag of ['script', 'style', 'noscript', 'svg', 'template']) HIDDEN_END[tag] = new RegExp('</' + tag + '\\s*>', 'gi');
function visibleHtml(html) {
  html = String(html || '');
  const start = /<!--|<(script|style|noscript|svg|template)\b/gi;
  let out = '', at = 0, m;
  while ((m = start.exec(html))) {
    let end;
    if (m[1]) {
      const close = HIDDEN_END[m[1].toLowerCase()];
      close.lastIndex = start.lastIndex;
      const c = close.exec(html);
      end = c ? c.index + c[0].length : html.length;
    } else {
      const c = html.indexOf('-->', m.index + 4);
      end = c < 0 ? html.length : c + 3;
    }
    out += html.slice(at, m.index) + ' ';
    at = end;
    start.lastIndex = end;
  }
  return out + html.slice(at);
}

// What a piece of page HTML says: its H1s and other headings, its words, its images and how many have no alt
// attribute, and the questions it answers (a heading that ends in a question mark and the text under it, or a
// <details> block with its summary).
function readFragment(html) {
  const body = visibleHtml(html);
  const out = { h1: [], headings: [], words: 0, text: '', images: 0, imagesNoAlt: 0, faq: [] };
  const hRe = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  const marks = [];
  let m;
  while ((m = hRe.exec(body))) {
    const text = stripTags(m[2]);
    if (!text) continue;
    if (m[1] === '1') out.h1.push(text);
    out.headings.push({ level: +m[1], text: text.slice(0, 200) });
    marks.push({ level: +m[1], text, start: m.index, end: m.index + m[0].length });
  }
  const text = stripTags(body);
  out.words = text ? text.split(/\s+/).length : 0;
  out.text = text.slice(0, 6000);
  for (const img of body.match(/<img\b[^>]*>/gi) || []) { out.images++; if (!/\salt\s*=/i.test(img)) out.imagesNoAlt++; }
  for (let i = 0; i < marks.length; i++) {
    const q = marks[i];
    if (q.level < 2 || !/\?\s*$/.test(q.text)) continue;
    const next = marks[i + 1] ? marks[i + 1].start : Math.min(body.length, q.end + 4000);
    const a = stripTags(body.slice(q.end, next)).slice(0, 700);
    if (a.length >= 20) out.faq.push({ q: q.text.slice(0, 200), a });
  }
  const detRe = /<details\b[^>]*>\s*<summary\b[^>]*>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/gi;
  while ((m = detRe.exec(body))) {
    const q = stripTags(m[1]); const a = stripTags(m[2]).slice(0, 700);
    if (q && a.length >= 20 && !out.faq.some((f) => f.q === q)) out.faq.push({ q: q.slice(0, 200), a });
  }
  out.faq = out.faq.slice(0, 20);
  return out;
}

module.exports = { decode, stripTags, visibleHtml, readFragment };
