'use strict';
// Paid plans through Polar (merchant of record). See polar.js for the API and webhook details.
const crypto = require('crypto');
const kv = require('./kv');
const { PLANS } = require('./plans');

const ACTIVE = ['active', 'on_trial', 'past_due'];

// While only the Polar sandbox is set up, checkout is open only to the emails in BILLING_TEST_EMAILS.
function isTester(user) {
  const list = String(process.env.BILLING_TEST_EMAILS || '').toLowerCase().split(',').map((x) => x.trim()).filter(Boolean);
  if (!list.length || !user) return false;
  return list.includes(String(user.email || '').trim().toLowerCase());
}
function sign(userId) {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET || 'aiseodeck').update('billing:' + userId).digest('hex').slice(0, 24);
}

const polar = require('./polar')({ PLANS, ACTIVE, sign, isTester, kv });

async function canCheckout(user) {
  const m = await polar.mode();
  return m === 'live' || (m === 'test' && isTester(user));
}
function hasLiveSubscription(user) {
  const b = user && user.billing;
  return !!(b && b.subscriptionId && ACTIVE.includes(b.status));
}
async function cancelSubscription(user) { return hasLiveSubscription(user) ? polar.cancelSubscription(user) : true; }

module.exports = {
  PLANS, ACTIVE, isTester, sign, canCheckout, hasLiveSubscription, cancelSubscription,
  mode: () => polar.mode(),
  checkoutUrl: (user, plan, interval, appUrl) => polar.checkoutUrl(user, plan, interval, appUrl),
  portalUrl: (user, appUrl) => polar.portalUrl(user, appUrl),
  handleWebhook: (raw, headers, deps) => polar.handleWebhook(raw, headers, deps),
  polar,
  _reset: () => polar._reset()
};
