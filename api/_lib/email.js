'use strict';
// Email via Resend. When RESEND_API_KEY is missing the message is logged and dropped.

function enabled() { return !!process.env.RESEND_API_KEY; }

// The sender. `as` puts another name on the same address.
function sender(as) {
  const from = process.env.EMAIL_FROM || 'AI Visibility Report <hello@silitlabs.com>';
  const name = String(as || '').replace(/[<>"\r\n]/g, '').trim();
  if (!name) return from;
  const m = from.match(/<([^<>\s]+)>/);
  return name + ' <' + (m ? m[1] : from.trim()) + '>';
}

async function send({ to, subject, html, text, as }) {
  const from = sender(as);
  if (!process.env.RESEND_API_KEY) {
    console.log('[email skipped]', to, subject);
    return { skipped: true };
  }
  const base = (process.env.RESEND_API_BASE || 'https://api.resend.com').replace(/\/+$/, '');
  const res = await fetch(base + '/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: Array.isArray(to) ? to : [to], subject, html, text }),
    signal: AbortSignal.timeout(10000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const err = new Error('Email failed: ' + (data.message || res.status)); err.status = res.status; throw err; }
  return data;
}

module.exports = { enabled, send, sender };
