'use strict';
// Paid plans through Polar (merchant of record). See polar.js for the API and webhook details.
const crypto = require('crypto');
const kv = require('./kv');
const { PLANS, trialDays } = require('./plans');

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
  // Nothing to sell until at least one AI engine can answer: a trial would start and then charge for no checks
  if (!require('./engines').enabled().length) return false;
  const m = await polar.mode();
  return m === 'live' || (m === 'test' && isTester(user));
}
function hasLiveSubscription(user) {
  const b = user && user.billing;
  return !!(b && b.subscriptionId && ACTIVE.includes(b.status));
}
// One free trial per account: never for someone who already had a trial or any subscription.
// Polar's "Prevent trial abuse" setting also blocks a second trial with the same email or card.
function trialEligible(user) {
  if (!user || !trialDays()) return false;
  if (user.trialUsedAt) return false;
  return !(user.billing && user.billing.subscriptionId);
}
async function cancelSubscription(user) { return hasLiveSubscription(user) ? polar.cancelSubscription(user) : true; }

module.exports = {
  PLANS, ACTIVE, isTester, sign, canCheckout, hasLiveSubscription, trialEligible, trialDays, cancelSubscription,
  mode: () => polar.mode(),
  // opts: { next: 'setup' | 'settings', kw }. The trial is added when the account can still have one.
  checkoutUrl: (user, plan, interval, appUrl, opts) => polar.checkoutUrl(user, plan, interval, appUrl, Object.assign({}, opts, { trialDays: trialEligible(user) ? trialDays() : 0 })),
  syncCheckout: (user, checkoutId, deps) => polar.syncCheckout(user, checkoutId, deps),
  portalUrl: (user, appUrl) => polar.portalUrl(user, appUrl),
  handleWebhook: (raw, headers, deps) => polar.handleWebhook(raw, headers, deps),
  polar,
  _reset: () => polar._reset()
};
