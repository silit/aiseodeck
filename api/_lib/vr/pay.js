'use strict';
// One payment for one report, through Polar (merchant of record), the payment account for every Silit Labs product.
// Env: POLAR_ACCESS_TOKEN and POLAR_API_BASE (shared with the plans), POLAR_REPORT_PRODUCT_ID (the one-time product;
//      when unset, the product whose name contains "AI Visibility Report" or whose metadata says app = aiseodeck and
//      kind = report is used), VR_UNLOCK_KEY (optional: opens a report without a payment, for our own tests).
// Token scopes: products:read, checkouts:read, checkouts:write.
const crypto = require('crypto');
const kv = require('../kv');
const core = require('./core');
const { timingEqual } = require('../crypto');

const API_VERSION = '2026-10';

function cfg() {
  return {
    token: String(process.env.POLAR_ACCESS_TOKEN || '').trim(),
    base: (process.env.POLAR_API_BASE || 'https://api.polar.sh').trim().replace(/\/+$/, ''),
    product: String(process.env.POLAR_REPORT_PRODUCT_ID || '').trim()
  };
}
const sign = (id) => crypto.createHmac('sha256', process.env.SESSION_SECRET || 'aiseodeck').update('vr:' + id).digest('hex').slice(0, 24);

async function api(method, path, body) {
  const c = cfg();
  const res = await fetch(c.base + path, {
    method,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.token, 'Polar-Version': API_VERSION },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    let msg = data && data.detail;
    if (Array.isArray(msg)) msg = msg.map((d) => (Array.isArray(d.loc) ? d.loc.slice(1).join('.') + ': ' : '') + d.msg).join('; ');
    throw Object.assign(new Error('Polar: ' + (msg || (data && data.error) || res.status)), { status: res.status });
  }
  return data;
}

let cache = null;
async function productId() {
  const c = cfg();
  if (c.product) return c.product;
  if (!c.token) return '';
  if (cache && cache.at > Date.now() - 3600000) return cache.id;
  let found = '';
  try {
    const d = await api('GET', '/v1/products/?is_archived=false&is_recurring=false&limit=100');
    for (const p of d.items || []) {
      const meta = p.metadata || {};
      if (/ai\s*visibility\s*report/i.test(String(p.name || '')) || (String(meta.app || '').toLowerCase() === 'aiseodeck' && String(meta.kind || '').toLowerCase() === 'report')) { found = p.id; break; }
    }
  } catch (e) { console.error('[vr] polar products', e.message); return ''; }
  if (found) cache = { at: Date.now(), id: found };
  return found;
}
// Can a report be bought right now?
async function enabled() { return !!(cfg().token && (await productId())); }

async function checkoutUrl(check, appUrl) {
  const pid = await productId();
  if (!pid) throw new Error('The report product is not set up.');
  const body = {
    products: [pid],
    // Polar puts the checkout id in place of {CHECKOUT_ID}, so the page can open the report the moment the buyer is back
    success_url: appUrl + '/check/' + check.id + '?checkout_id={CHECKOUT_ID}',
    return_url: appUrl + '/check/' + check.id,
    metadata: { app: 'aiseodeck', kind: 'report', check_id: check.id, sig: sign(check.id) }
  };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(check.email || ''))) body.customer_email = check.email;
  const d = await api('POST', '/v1/checkouts/', body);
  if (!d.url) throw new Error('Polar did not return a checkout link.');
  if (d.id) await kv.setJSON('vrco:' + d.id, { id: check.id }, 30 * 86400);
  return d.url;
}

const isOurs = (meta, id) => !!meta && String(meta.check_id || '') === String(id) && meta.sig === sign(String(id));

// The buyer is back from the checkout: read it at Polar, so the report opens before the webhook arrives.
async function confirm(id, checkoutId) {
  const cid = String(checkoutId || '');
  if (!cfg().token || !/^[A-Za-z0-9-]{8,64}$/.test(cid)) return { ok: false, why: 'no checkout' };
  const co = await api('GET', '/v1/checkouts/' + encodeURIComponent(cid));
  if (!isOurs(co.metadata, id)) return { ok: false, why: 'another check' };
  if (co.status !== 'succeeded') return { ok: false, pending: co.status === 'confirmed', why: co.status || 'unknown' };
  const r = await core.markPaid(id, { by: 'polar', checkoutId: cid, orderId: co.order_id || '', email: co.customer_email || '', amount: co.total_amount || co.amount || 0 });
  return { ok: !r.error, already: !!r.already };
}

// Webhook events for orders. deps.verify(raw, headers) is the Standard Webhooks check shared with the plans.
// order.paid opens the report (also when the buyer never came back to the page); order.refunded closes it.
async function handleWebhook(raw, headers, deps) {
  if (!deps.verify(raw, headers)) return { status: 401, body: { error: 'bad signature' } };
  let evt;
  try { evt = JSON.parse(raw); } catch (e) { return { status: 400, body: { error: 'bad json' } }; }
  const type = String((evt && evt.type) || '');
  const data = (evt && evt.data) || {};
  if (type !== 'order.paid' && type !== 'order.refunded') return { status: 202, body: { ignored: type || 'unknown' } };
  let id = '';
  const meta = data.metadata || {};
  if (meta.check_id && isOurs(meta, meta.check_id)) id = String(meta.check_id);
  if (!id && data.checkout_id) { const m = await kv.getJSON('vrco:' + data.checkout_id); id = (m && m.id) || ''; }
  if (!id) return { status: 202, body: { ignored: 'not a report' } };
  if (type === 'order.refunded') {
    const c = await core.update(id, (x) => { if (!x.paid || x.paid.refundedAt) return false; x.paid.refundedAt = Date.now(); });
    return { status: 200, body: { ok: true, refunded: !!c } };
  }
  const r = await core.markPaid(id, { by: 'polar', checkoutId: data.checkout_id || '', orderId: data.id || '', email: (data.customer && data.customer.email) || '', amount: data.total_amount || data.net_amount || 0 });
  if (r.error) return { status: 202, body: { ignored: 'check gone' } };
  return { status: 200, body: { ok: true, already: !!r.already } };
}

// Our own key opens a report without a payment (tests, or a customer we owe one).
async function unlockByKey(id, key) {
  const want = String(process.env.VR_UNLOCK_KEY || '');
  if (!want || want.length < 12 || !key || !timingEqual(String(key), want)) return { ok: false };
  const r = await core.markPaid(id, { by: 'key', amount: 0 });
  return { ok: !r.error };
}

module.exports = { enabled, productId, checkoutUrl, confirm, handleWebhook, unlockByKey, sign, _reset: () => { cache = null; } };
