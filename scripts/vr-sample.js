// Builds api/_lib/vr/sample.json: the public sample report and the answers that play on the landing page.
// It runs the real pipeline once on the made-up hotel of test/vr-fixture.js (no network), so the sample always has
// exactly the shape of a real report. Run: node scripts/vr-sample.js
const fs = require('fs');
const path = require('path');
const fx = require('../test/vr-fixture.js');

(async () => {
  const redis = fx.mockRedis();
  fx.env(await redis.listen());
  fx.install();
  const core = require('../api/_lib/vr/core.js');
  const state = require('../api/_lib/vr/state.js');
  const snap = async (id) => state.publicState(await core.get(id), await core.rowsOf(id), { canPay: true });
  const until = async (id, status) => { for (let i = 0; i < 40; i++) { await core.pump(id, 30000); if ((await core.get(id)).status === status) return; } throw new Error('never reached ' + status); };

  const { id } = await core.start(fx.SITE, { ip: 'sample' });
  const out = { draft: await snap(id) };
  await core.runFree(id, { topic: 't0', question: fx.TOPICS[0].question, country: 'GB' });
  await until(id, 'preview');
  out.preview = await snap(id);
  await core.markPaid(id, { by: 'key' });
  await until(id, 'done');
  out.report = await snap(id);
  redis.server.close();

  // The hotel, its rivals and the publications are invented, so nothing in the sample links anywhere.
  const scrub = (v) => {
    if (Array.isArray(v)) return v.map(scrub);
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = k === 'url' && typeof v[k] === 'string' && !/casaaldora\.example/.test(v[k]) ? '' : scrub(v[k]); return o; }
    return v === id ? 'sample' : v;
  };
  const file = path.join(__dirname, '../api/_lib/vr/sample.json');
  fs.writeFileSync(file, JSON.stringify(scrub(out)));
  const r = out.report.report;
  console.log('sample written:', (fs.statSync(file).size / 1024).toFixed(0) + ' KB,', r.counts.named + ' of ' + r.counts.answers + ' answers name the hotel,', r.fixes.length + ' fixes');
})().catch((e) => { console.error(e); process.exit(1); });
