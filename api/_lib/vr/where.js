'use strict';
// Where the AI Visibility Report lives. Visitors read it at silitlabs.com: that site's Vercel project passes
// /ai-visibility-report and /check on to /_vr on this app (see the rewrites in vercel.json of both repos), and this
// app's own addresses for them redirect to the site. So every link the report prints, emails or hands to the
// checkout points at the site, never at this host. The visitor's IP address still arrives in x-forwarded-for.
// Env: VR_URL (optional, default https://silitlabs.com). APP_URL stays the address of AI SEO Deck itself.
const trim = (s) => String(s || '').trim().replace(/\/+$/, '');
const PATH = '/ai-visibility-report';
const site = () => trim(process.env.VR_URL) || 'https://silitlabs.com';
const app = () => trim(process.env.APP_URL) || 'https://aiseodeck.silitlabs.com';
const home = () => site() + PATH;
const hostOf = (url) => { try { return new URL(url).host.toLowerCase().replace(/^www\./, ''); } catch (e) { return ''; } };
// Was this request sent from a page of the site? (The Origin of the report's own forms and buttons.)
function fromSite(req) {
  const from = hostOf((req && req.headers && (req.headers.origin || req.headers.referer)) || '');
  return !!from && from === hostOf(site());
}

module.exports = { PATH, site, app, home, fromSite };
