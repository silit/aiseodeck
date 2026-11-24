'use strict';
// Plans and what each one allows. Keywords are a pool shared by all of a user's sites.
// Each keyword is asked as QUESTIONS customer questions on every chat engine (ChatGPT, Gemini, Claude, Grok);
// Google AI Overviews and AI Mode get the keyword itself. With all 6 engines: 10 answers a check.
// (Perplexity is kept in the code for a later release and stays off until PERPLEXITY_ENABLED=1.)
const DAY = 86400000;
const QUESTIONS = 2;

const PLANS = {
  solo: { name: 'Solo', sites: 1, keywords: 10, rechecks: 10, monthly: 19, yearly: 190 },
  studio: { name: 'Studio', sites: 5, keywords: 30, rechecks: 30, monthly: 49, yearly: 490 },
  agency: { name: 'Agency', sites: 20, keywords: 100, rechecks: 100, monthly: 149, yearly: 1490 }
};
const FREE = { name: 'Free', sites: 1, keywords: 3, rechecks: 0 };

// Days of the free trial on paid plans. Polar takes the card at checkout and charges when the trial ends,
// unless the customer cancels first. TRIAL_DAYS=0 turns the trial off.
function trialDays() {
  const n = parseInt(process.env.TRIAL_DAYS, 10);
  return Number.isFinite(n) && n >= 0 && n <= 30 ? n : 7;
}

// The access code (COMPLIMENTARY_CODE, at least 16 characters; '' when none is set). An account that enters it on
// its Account page gets the same complimentary Agency access as the addresses below. It is there for the Marketplace
// review team when the reviewing account is not on an @webflow.com address, and for partners.
function accessCode() {
  const c = String(process.env.COMPLIMENTARY_CODE || '').trim();
  return c.length >= 16 ? c : '';
}
function complimentary(user) {
  // an access code was entered on this account (user.comp is written in one place: the Account page's code form)
  if (user && user.comp && user.comp.plan === 'agency') return true;
  // "@webflow.com" is always included so the Marketplace review team gets the highest tier.
  const list = ['@webflow.com'].concat(String(process.env.COMPLIMENTARY_EMAILS || '').toLowerCase().split(',').map((x) => x.trim()).filter(Boolean));
  const email = String((user && user.email) || '').toLowerCase();
  return !!email && list.some((e) => (e.startsWith('@') ? email.endsWith(e) : email === e));
}

// Everything the app checks before doing paid work.
function limitsFor(user) {
  let plan = user && user.plan && PLANS[user.plan] ? user.plan : 'free';
  if (complimentary(user)) plan = 'agency';
  const p = plan === 'free' ? FREE : PLANS[plan];
  const paid = plan !== 'free';
  const lim = {
    plan,
    name: p.name,
    sites: p.sites,
    keywords: p.keywords,
    questions: QUESTIONS,
    allEngines: paid, // free: the engines in engines.freeEngines() (ChatGPT, Google AI Overviews and Gemini); paid: every engine
    everyMs: (paid ? 7 : 30) * DAY,
    rechecks: p.rechecks, // keyword checks on demand per account and month
    newChecks: p.keywords, // free first checks of newly added keywords per month
    auditPages: { free: 20, solo: 100, studio: 150, agency: 250 }[plan],
    canApply: paid, // writing fixes to Webflow
    whiteLabel: plan === 'studio' || plan === 'agency',
    complimentary: complimentary(user) && !(user.plan && PLANS[user.plan])
  };
  // Manual overrides we can set on a user record (support, partners)
  if (user && user.limitOverride) {
    const o = user.limitOverride;
    if (o.sites > lim.sites) lim.sites = o.sites;
    if (o.keywords > lim.keywords) lim.keywords = o.keywords;
    if (o.rechecks > lim.rechecks) lim.rechecks = o.rechecks;
  }
  return lim;
}

module.exports = { PLANS, FREE, DAY, QUESTIONS, limitsFor, complimentary, accessCode, trialDays };
