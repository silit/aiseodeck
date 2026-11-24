'use strict';
// The one place the app writes to its logs. Every part of a message passes through redact(), which takes out
// what must not be in a log: email addresses, and anything long enough to be a token, a key or a code.

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const SECRET = /[A-Za-z0-9_-]{32,}/g;

function text(v) {
  if (v instanceof Error) return v.stack || v.message || String(v);
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch (e) { return String(v); }
}
function redact(v) {
  return String(text(v)).replace(EMAIL, '[email]').replace(SECRET, '[redacted]');
}
const error = (...parts) => console.error(...parts.map(redact));
const info = (...parts) => console.log(...parts.map(redact));

module.exports = { redact, error, info };
