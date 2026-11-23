'use strict';
// The paid services behind AI SEO Deck (the AI engines, keyword data and the writing of fixes) can fail. Customers get
// plain words for each failure, never a provider's own message. When a service refuses our account (the credit ran
// out, a key stopped working), the owner gets an email, at most once every 6 hours per service.

const kv = require('./kv');
const email = require('./email');

const SERVICES = {
  openai: { name: 'OpenAI', fix: 'https://platform.openai.com/settings/organization/billing/overview' },
  anthropic: { name: 'Anthropic (Claude)', fix: 'https://console.anthropic.com/settings/billing' },
  gemini: { name: 'Google Gemini', fix: 'https://aistudio.google.com/apikey' },
  xai: { name: 'xAI (Grok)', fix: 'https://console.x.ai/team/default/billing' },
  dataforseo: { name: 'DataForSEO', fix: 'https://app.dataforseo.com' },
  perplexity: { name: 'Perplexity', fix: 'https://www.perplexity.ai/account/api' }
};
// which service answers for each engine
const ENGINE_SERVICE = { openai: 'openai', aio: 'dataforseo', aimode: 'dataforseo', gemini: 'gemini', claude: 'anthropic', grok: 'xai', perplexity: 'perplexity' };
const EVERY_S = 6 * 3600;

const BUSY = /rate[ -]?limit|too many requests|overloaded|temporarily|try again later|resource has been exhausted|network error|could not be reached|fetch failed|econnreset|socket hang up/i;
const ACCOUNT = /\bcredits?\b|balance|funds|insufficient[_ ]quota|exceeded your current quota|payment required|billing|spending limit|not authori[sz]ed|unauthori[sz]ed|authentication|api[ _-]?key|permission[ _]denied|account (is |has been )?(blocked|suspended|disabled|deactivated)/i;

// 'account': the service refused our account and the owner must act. 'busy': a rate limit, an overload or the network,
// which passes. 'timeout': no answer in time. 'other': anything else.
function kindOf(e) {
  if (!e) return 'other';
  if (e.kind) return e.kind;
  const msg = String(e.message || e);
  const st = Number(e.status) || 0;
  if (/timed out|timeout/i.test(msg)) return 'timeout';
  if (BUSY.test(msg)) return 'busy';
  if (ACCOUNT.test(msg)) return 'account';
  if (st === 401 || st === 402 || st === 403 || (st >= 40100 && st < 40400)) return 'account'; // DataForSEO codes are 5 digits
  if (st === 429 || st === 529 || (st >= 500 && st < 600) || st >= 50000) return 'busy';
  return 'other';
}

const ENGINE_TEXT = {
  account: 'This engine could not answer right now. It is asked again at the next check.',
  busy: 'This engine was busy. It is asked again at the next check.',
  timeout: 'This engine took too long to answer. It is asked again at the next check.',
  other: 'This engine did not answer this time. It is asked again at the next check.'
};
// The words a customer sees for an engine answer that could not be read (older results only kept the raw message).
function engineText(result) {
  const r = result || {};
  return ENGINE_TEXT[r.kind || kindOf({ message: r.err || '' })] || ENGINE_TEXT.other;
}
const KEYWORD_DATA_TEXT = 'Keyword data is not available right now. Try again in a little while.';
const WRITING_TEXT = 'The writing service is not available right now. Try again in a few minutes.';
// Our own errors meant for customers carry public: true; anything else gets the fallback words.
function publicText(e, fallback) { return e && e.public ? String(e.message) : fallback; }

function ownerEmail() { return String(process.env.ALERT_EMAIL || 'info@silitlabs.com').trim(); }
const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Notes a failed call to a paid service and returns its kind. When the service refused our account, the owner is
// emailed (once every 6 hours per service). Never throws.
async function report(service, e, where) {
  const kind = kindOf(e);
  if (kind !== 'account') return kind;
  const s = SERVICES[service] || { name: String(service), fix: '' };
  const detail = String((e && e.message) || e || '').replace(/\s+/g, ' ').slice(0, 300);
  console.error('[vr] ' + s.name + ' refused our account (' + (where || 'call') + '): ' + detail);
  try {
    if (!(await kv.setNX('alert:' + service, { at: Date.now(), where: where || '' }, EVERY_S))) return kind; // told already
    const lines = [
      'Calls to ' + s.name + ' are failing because the service refused our account' + (where ? ' (' + where + ')' : '') + ':',
      detail,
      'This usually means the credit ran out or the API key stopped working. Top up or check the key' + (s.fix ? ': ' + s.fix : '.'),
      'Until then customers see "' + ENGINE_TEXT.account + '" where this service is used, and everything else keeps working.',
      'You get this email at most once every 6 hours per service.'
    ];
    await email.send({
      to: ownerEmail(),
      subject: 'AI Visibility Report: ' + s.name + ' needs attention',
      text: lines.join('\n\n'),
      html: lines.map((l, i) => (i === 1 ? '<p><code>' + escHtml(l) + '</code></p>' : '<p>' + escHtml(l).replace(/(https:\/\/\S+?)([.:]?)$/, '<a href="$1">$1</a>$2') + '</p>')).join('')
    });
  } catch (err) { console.error('[vr] alert email failed', err && err.message); }
  return kind;
}

module.exports = { SERVICES, ENGINE_SERVICE, kindOf, engineText, publicText, report, ownerEmail, KEYWORD_DATA_TEXT, WRITING_TEXT, ENGINE_TEXT };
