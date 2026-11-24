// Polar webhook. Uses the Web Request handler so the raw body is available for the signature check
// (Standard Webhooks headers: webhook-id, webhook-timestamp, webhook-signature).
import billing from './_lib/billing.js';
import store from './_lib/store.js';
import log from './_lib/log.js';

export async function POST(request) {
  const raw = await request.text();
  const deps = { getUser: store.getUser, saveUser: store.saveUser, enforce: (user) => store.enforceLimit(user) };
  try {
    // only subscription events of AI SEO Deck's plans change anything; every other event is answered and ignored
    const r = await billing.handleWebhook(raw, request.headers, deps);
    return Response.json(r.body, { status: r.status });
  } catch (e) {
    log.error('[billing webhook]', e && e.stack);
    return Response.json({ error: 'failed' }, { status: 500 });
  }
}

export function GET() {
  return Response.json({ ok: true, endpoint: 'billing webhook (Polar)' });
}
