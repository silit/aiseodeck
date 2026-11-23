'use strict';
// Reads a customer's public pages (HTML, robots.txt, llms.txt, sitemap.xml) for the site audit.
// Only the site's own hosts are fetched, redirects are followed only on those hosts, private and
// special addresses are refused inside the DNS lookup itself (no DNS rebinding), bodies are capped.
const net = require('net');
const dns = require('dns');
const http = require('http');
const https = require('https');
const zlib = require('zlib');

const UA = 'Mozilla/5.0 (compatible; AISEODeck/1.0; +https://aiseodeck.silitlabs.com/docs#bot)';

function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b, c] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113);
  }
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase();
    if (x.startsWith('::ffff:')) return privateIp(x.slice(7));
    return x === '::1' || x === '::' || x.startsWith('64:ff9b:') || x.startsWith('fc') || x.startsWith('fd') ||
      x.startsWith('fe8') || x.startsWith('fe9') || x.startsWith('fea') || x.startsWith('feb') || x.startsWith('ff') || x.startsWith('2001:db8:');
  }
  return true;
}
const allowPrivate = () => process.env.ALLOW_PRIVATE_FETCH === '1';
const blocked = () => Object.assign(new Error('blocked address'), { code: 'EBLOCKED' });

function safeLookup(hostname, options, cb) {
  if (typeof options === 'function') { cb = options; options = {}; }
  const opts = typeof options === 'number' ? { family: options } : Object.assign({}, options);
  dns.lookup(hostname, Object.assign({}, opts, { all: true }), (err, addrs) => {
    if (err) return cb(err);
    const list = (addrs || []).filter(Boolean);
    if (!list.length) return cb(Object.assign(new Error('no address'), { code: 'ENOTFOUND' }));
    if (!allowPrivate() && list.some((a) => privateIp(a.address))) return cb(blocked());
    if (opts.all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}

const bare = (h) => String(h || '').toLowerCase().replace(/^www\./, '');
function hostAllowed(u, allowed) {
  const h = bare(u.host);
  return allowed.some((a) => bare(a) === h);
}

function once(url, deadline, maxBytes) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const h = u.hostname.replace(/^\[|\]$/g, '');
    if (!allowPrivate() && net.isIP(h) && privateIp(h)) return reject(blocked());
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, { method: 'GET', lookup: safeLookup, headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,text/plain,application/xml;q=0.9,*/*;q=0.5', 'Accept-Encoding': 'gzip, deflate, br' } }, (res) => {
      const status = res.statusCode;
      if (status >= 300 && status < 400 && res.headers.location) { res.resume(); return resolve({ status, location: res.headers.location }); }
      let stream = res;
      const enc = String(res.headers['content-encoding'] || '').toLowerCase();
      if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
      else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
      else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
      const chunks = [];
      let size = 0;
      stream.on('data', (c) => {
        size += c.length;
        if (size > maxBytes) { chunks.push(c.slice(0, Math.max(0, maxBytes - (size - c.length)))); res.destroy(); stream.destroy && stream.destroy(); finish(true); return; }
        chunks.push(c);
      });
      let done = false;
      function finish(truncated) {
        if (done) return; done = true;
        resolve({ status, contentType: String(res.headers['content-type'] || ''), text: Buffer.concat(chunks).toString('utf8'), truncated: !!truncated });
      }
      stream.on('end', () => finish(false));
      stream.on('error', (e) => { if (!done) { done = true; reject(e); } });
    });
    const timer = setTimeout(() => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })), Math.max(1, deadline - Date.now()));
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.on('close', () => clearTimeout(timer));
    req.end();
  });
}

// GET a page on one of `allowedHosts`. Never throws: { ok, status, url, contentType, text, error }.
async function getText(url, { timeoutMs = 10000, maxBytes = 1500000, allowedHosts = [] } = {}) {
  const deadline = Date.now() + timeoutMs;
  let current = url;
  try {
    for (let hops = 0; hops <= 5; hops++) {
      const u = new URL(current);
      if (!/^https?:$/.test(u.protocol) || !hostAllowed(u, allowedHosts)) return { ok: false, status: 0, url: current, error: 'not one of the site\'s domains' };
      const r = await once(current, deadline, maxBytes);
      if (r.location) { current = new URL(r.location, current).toString(); continue; }
      return { ok: r.status >= 200 && r.status < 300, status: r.status, url: current, contentType: r.contentType, text: r.text, truncated: r.truncated };
    }
    return { ok: false, status: 0, url: current, error: 'too many redirects' };
  } catch (e) {
    return { ok: false, status: 0, url: current, error: e.code === 'EBLOCKED' ? 'blocked address' : e.code === 'ETIMEOUT' ? 'timed out' : (e.code || e.message || 'error') };
  }
}

module.exports = { getText, privateIp, UA };
