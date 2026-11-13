'use strict';
// Plans and what each one allows. Prompts are a pool shared by all of a user's sites.
const DAY = 86400000;

const PLANS = {
  solo: { name: 'Solo', sites: 1, prompts: 25, monthly: 29, yearly: 290 },
  studio: { name: 'Studio', sites: 5, prompts: 75, monthly: 79, yearly: 790 },
  agency: { name: 'Agency', sites: 20, prompts: 200, monthly: 199, yearly: 1990 }
};
const FREE = { name: 'Free', sites: 1, prompts: 5 };

function complimentary(user) {
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
    prompts: p.prompts,
    allEngines: paid, // free: ChatGPT, Google AI Overviews and Perplexity; paid: every engine
    everyMs: (paid ? 7 : 30) * DAY,
    manualPerMonth: paid ? 2 : 0, // extra checks on demand per site and month (the first run after setup is always allowed)
    auditPages: { free: 20, solo: 100, studio: 150, agency: 250 }[plan],
    canApply: paid, // writing fixes to Webflow
    whiteLabel: plan === 'studio' || plan === 'agency',
    complimentary: complimentary(user) && !(user.plan && PLANS[user.plan])
  };
  // Manual overrides we can set on a user record (support, partners)
  if (user && user.limitOverride) {
    const o = user.limitOverride;
    if (o.sites > lim.sites) lim.sites = o.sites;
    if (o.prompts > lim.prompts) lim.prompts = o.prompts;
  }
  return lim;
}

module.exports = { PLANS, FREE, DAY, limitsFor, complimentary };
