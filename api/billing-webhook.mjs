// Polar webhook for the AI Visibility Report. Uses the Web Request handler so the raw body is available for the
// signature check (Standard Webhooks headers: webhook-id, webhook-timestamp, webhook-signature).
// order.paid opens a report, also when the buyer never came back to the page; order.refunded closes it.
// Every other event, and every order that is not a report, is answered and ignored.
import billing from './_lib/billing.js';
import vrpay from './_lib/vr/pay.js';

export async function POST(request) {
  const raw = await request.text();
  try {
    const o = await vrpay.handleWebhook(raw, request.headers, { verify: billing.polar.verify });
    return Response.json(o.body, { status: o.status });
  } catch (e) {
    console.error('[vr] billing webhook', e && e.stack);
    return Response.json({ error: 'failed' }, { status: 500 });
  }
}

export function GET() {
  return Response.json({ ok: true, endpoint: 'billing webhook (Polar), AI Visibility Report' });
}
