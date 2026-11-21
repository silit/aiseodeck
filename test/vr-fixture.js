// A made-up business and everything the AI Visibility Report needs to run without any network: a mock Redis, the
// business's website, canned answers from every AI engine, the pages those answers cite and the replies of the
// writing model. Used by test/vr.js and by scripts/vr-sample.js, which freezes one run of it as the public sample.
// Casa Aldora and every hotel and publication here are invented; their sites live on the reserved .example domain.
const http = require('http');

/* ---- mock Redis (Upstash REST subset) ---- */
function mockRedis() {
  const db = new Map();
  const ttl = new Map();
  const alive = (k) => { if (ttl.has(k) && ttl.get(k) < Date.now()) { db.delete(k); ttl.delete(k); } return db.has(k); };
  function exec(cmd) {
    const [c, ...a] = cmd;
    switch (String(c).toUpperCase()) {
      case 'GET': return alive(a[0]) ? db.get(a[0]) : null;
      case 'GETDEL': { const v = alive(a[0]) ? db.get(a[0]) : null; db.delete(a[0]); ttl.delete(a[0]); return v; }
      case 'MGET': return a.map((k) => (alive(k) ? db.get(k) : null));
      case 'SET': {
        const nx = a.includes('NX'); const xx = a.includes('XX'); const exI = a.indexOf('EX');
        if (nx && alive(a[0])) return null;
        if (xx && !alive(a[0])) return null;
        db.set(a[0], a[1]);
        if (exI > -1) ttl.set(a[0], Date.now() + parseInt(a[exI + 1], 10) * 1000); else ttl.delete(a[0]);
        return 'OK';
      }
      case 'DEL': { let n = 0; for (const k of a) { if (db.delete(k)) n++; ttl.delete(k); } return n; }
      case 'SADD': { const s = alive(a[0]) ? db.get(a[0]) : new Set(); let n = 0; for (const m of a.slice(1)) if (!s.has(m)) { s.add(m); n++; } db.set(a[0], s); return n; }
      case 'SREM': { const s = alive(a[0]) ? db.get(a[0]) : new Set(); let n = 0; for (const m of a.slice(1)) if (s.delete(m)) n++; db.set(a[0], s); return n; }
      case 'SMEMBERS': return alive(a[0]) ? [...db.get(a[0])] : [];
      case 'RPUSH': { const l = alive(a[0]) ? db.get(a[0]) : []; l.push(...a.slice(1)); db.set(a[0], l); return l.length; }
      case 'LPOP': {
        if (!alive(a[0])) return null;
        const l = db.get(a[0]);
        if (a[1] === undefined) { const v = l.shift(); if (!l.length) db.delete(a[0]); return v === undefined ? null : v; }
        const out = l.splice(0, parseInt(a[1], 10));
        if (!l.length) db.delete(a[0]);
        return out.length ? out : null;
      }
      case 'LLEN': return alive(a[0]) ? db.get(a[0]).length : 0;
      case 'INCR': { const v = (alive(a[0]) ? parseInt(db.get(a[0]), 10) : 0) + 1; db.set(a[0], String(v)); return v; }
      case 'INCRBY': { const v = (alive(a[0]) ? parseInt(db.get(a[0]), 10) : 0) + parseInt(a[1], 10); db.set(a[0], String(v)); return v; }
      case 'EXPIRE': if (db.has(a[0])) ttl.set(a[0], Date.now() + parseInt(a[1], 10) * 1000); return 1;
      case 'HSET': { const h = alive(a[0]) ? db.get(a[0]) : new Map(); let n = 0; for (let i = 1; i + 1 < a.length; i += 2) { if (!h.has(a[i])) n++; h.set(a[i], a[i + 1]); } db.set(a[0], h); return n; }
      case 'HDEL': { if (!alive(a[0])) return 0; let n = 0; for (const f of a.slice(1)) if (db.get(a[0]).delete(f)) n++; return n; }
      case 'HGETALL': { if (!alive(a[0])) return []; const out = []; for (const [k, v] of db.get(a[0])) out.push(k, v); return out; }
      case 'HLEN': return alive(a[0]) ? db.get(a[0]).size : 0;
      case 'HINCRBY': { const h = alive(a[0]) ? db.get(a[0]) : new Map(); const v = (parseInt(h.get(a[1]), 10) || 0) + parseInt(a[2], 10); h.set(a[1], String(v)); db.set(a[0], h); return v; }
      default: throw new Error('mock redis: unsupported ' + c);
    }
  }
  const server = http.createServer((req, res) => {
    const ch = [];
    req.on('data', (c) => ch.push(c));
    req.on('end', () => {
      let body = null;
      try { body = JSON.parse(Buffer.concat(ch).toString()); } catch (e) { body = null; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      try { res.end(JSON.stringify({ result: exec(body) })); } catch (e) { res.end(JSON.stringify({ error: e.message })); }
    });
  });
  return { server, db, ttl, listen: () => new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port))) };
}

/* ---- the business ---- */
const SITE = 'casaaldora.example';
const HOME_TEXT = 'Casa Aldora is a family-run boutique hotel in Alfama, the oldest quarter of Lisbon. Fourteen rooms fill a restored 18th-century townhouse on a quiet lane, a six-minute walk from Santa Apolónia station. ' +
  'Breakfast is included and served in the courtyard under two lemon trees. The roof terrace looks over the tiled rooftops to the Tagus river and is open to guests until midnight. ' +
  'Every room has air conditioning, a rain shower and windows that open. The rooms at the back face the courtyard and are the quietest in the house. Rooms start at 140 euros a night. ' +
  'We opened in 2016 and still answer every message ourselves. The castle, the cathedral and the best Fado houses are all less than ten minutes away on foot. ' +
  'Arriving by train or by taxi from the airport takes about twenty minutes. We keep luggage before check-in and after check-out, and we can book a transfer for you. ';
const pages = {
  '/': `<!doctype html><html lang="en"><head><title>Casa Aldora | Boutique hotel in Alfama, Lisbon</title><meta property="og:site_name" content="Casa Aldora"><meta property="og:image" content="/img/courtyard.jpg"><link rel="icon" href="/favicon.png"></head><body><h1>A quiet house in the oldest part of Lisbon</h1><p>${HOME_TEXT.repeat(3)}</p><p>Rua das Flores de Alfama 12, 1100-000 Lisboa. hello@casaaldora.example</p><a href="https://www.instagram.com/casaaldora.example">Instagram</a></body></html>`,
  '/rooms': `<!doctype html><html lang="en"><head><title>Rooms at Casa Aldora</title><meta name="description" content="Fourteen rooms in a restored Alfama townhouse, from courtyard doubles to the terrace suite. Breakfast included in every rate."></head><body><h1>Rooms</h1><p>${'Courtyard rooms are the quietest. Terrace rooms have the river view. '.repeat(30)}</p></body></html>`,
  '/location': '<!doctype html><html lang="en"><head><title>Where we are</title></head><body><h1>Location</h1><p>Six minutes from Santa Apolónia.</p></body></html>',
  '/robots.txt': 'User-agent: *\nAllow: /\n\nUser-agent: ClaudeBot\nDisallow: /\n\nUser-agent: Claude-SearchBot\nDisallow: /\n\nSitemap: https://casaaldora.example/sitemap.xml\n',
  '/sitemap.xml': '<?xml version="1.0"?><urlset><url><loc>https://casaaldora.example/</loc></url><url><loc>https://casaaldora.example/rooms</loc></url><url><loc>https://casaaldora.example/location</loc></url></urlset>'
};

/* ---- pages the engines read ---- */
const L = 'The Lumiar House', M = 'Hotel Marquês Azul', T = 'Travessa Nove Suites', S = 'Solar das Andorinhas', A = 'Almada Terrace Hotel', C = 'Casa Aldora';
const filler = ' Lisbon rewards slow travel. The old town is a maze of lanes, stairs and viewpoints, and a small hotel puts you in the middle of it. '.repeat(6);
const article = (title, names) => `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1><p>${names.map((n) => n + ' is one of the places we recommend.').join(' ')}${filler}</p></body></html>`;
const SOURCES = {
  'https://lisbonweekender.example/best-boutique-hotels-alfama': { title: 'The best boutique hotels in Alfama', html: article('The best boutique hotels in Alfama', [L, M, S, T]) },
  'https://citybreakjournal.example/lisbon/where-to-stay-alfama': { title: 'Where to stay in Alfama', html: article('Where to stay in Alfama', [L, S, M]) },
  'https://alfamaguide.example/hotels': { title: 'Hotels in Alfama: a local guide', html: article('Hotels in Alfama: a local guide', [C, L, M]) },
  'https://europeanstays.example/lisbon-small-hotels': { title: 'Small hotels in Lisbon we would go back to', html: article('Small hotels in Lisbon we would go back to', [C, T, L]) },
  'https://slowtravelnotes.example/lisbon-alfama-stays': { title: 'Alfama stays for slow travellers', html: article('Alfama stays for slow travellers', [L, S]) },
  'https://chiadoviews.example/rooftop-hotels-lisbon': { title: 'Lisbon hotels with a rooftop view', html: article('Lisbon hotels with a rooftop view', [A, M]) },
  'https://lumiarhouse.example/': { title: 'The Lumiar House, Alfama', html: article('The Lumiar House, Alfama', [L]) },
  'https://www.reddit.com/r/lisboa/comments/alfama_hotel_tips': { title: 'Alfama hotel tips for a weekend?', html: article('Alfama hotel tips for a weekend?', [M, L]) },
  'https://www.tripadvisor.com/Hotels-Alfama-Lisbon': { title: 'Hotels in Alfama, Lisbon', status: 403 },
  'https://www.booking.com/district/pt/lisbon/alfama.html': { title: 'Hotels in Alfama', status: 403 }
};
const src = (key) => { const url = Object.keys(SOURCES).find((u) => u.includes(key)); return { url, title: SOURCES[url].title, host: new URL(url).hostname.replace(/^www\./, '') }; };
const own = (path) => ({ url: 'https://' + SITE + (path || '/'), title: 'Casa Aldora', host: SITE });

// Stands in for fetcher.getText: the business's own site and the pages the engines cite.
async function getText(url) {
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, '');
  if (host === SITE) {
    const body = pages[u.pathname.replace(/\/+$/, '') || '/'];
    if (body == null) return { ok: false, status: 404, url, text: '', contentType: 'text/html' };
    return { ok: true, status: 200, url, contentType: /\.txt$/.test(u.pathname) ? 'text/plain' : /\.xml$/.test(u.pathname) ? 'application/xml' : 'text/html', text: body };
  }
  if (host === 'blocked.example') return { ok: false, status: 403, url, text: '', contentType: 'text/html' };
  if (host === 'nowhere.example') return { ok: false, status: 0, url, error: 'ENOTFOUND' };
  if (host === 'appshell.example') {
    if (u.pathname !== '/') return { ok: false, status: 404, url, text: '' };
    return { ok: true, status: 200, url, contentType: 'text/html', text: '<!doctype html><html><head><title>Loading</title></head><body><div id="root"></div><script>' + 'x'.repeat(16000) + '</script></body></html>' };
  }
  const key = Object.keys(SOURCES).find((k) => { const s = new URL(k); return s.hostname.replace(/^www\./, '') === host && s.pathname.replace(/\/+$/, '') === u.pathname.replace(/\/+$/, ''); });
  const page = key && SOURCES[key];
  if (!page) return { ok: false, status: 404, url, text: '' };
  if (page.status) return { ok: false, status: page.status, url, text: '' };
  return { ok: true, status: 200, url, contentType: 'text/html', text: page.html };
}

/* ---- the questions and what each engine answers ---- */
const TOPICS = [
  { question: 'What is a good boutique hotel in Alfama, Lisbon for a weekend?', keyword: 'boutique hotel alfama lisbon' },
  { question: 'Where should a couple stay in Lisbon with a view and walkable to everything?', keyword: 'romantic hotel lisbon with view' },
  { question: 'Which small hotels in Lisbon are quiet at night?', keyword: 'quiet hotel lisbon old town' },
  { question: 'I arrive in Lisbon by train late at night. Which hotel near Santa Apolónia station is easy to reach?', keyword: 'hotel near santa apolonia station lisbon' },
  { question: 'Which Lisbon hotels include breakfast and have a terrace?', keyword: 'lisbon hotel with terrace breakfast included' }
];
const PROFILE = { brand: 'Casa Aldora', aliases: [], category: 'boutique hotel', place: 'Alfama, Lisbon', country: '', customers_country: 'GB', language: 'en', summary: 'A family-run 14-room boutique hotel in a restored townhouse in Alfama, Lisbon.', topics: TOPICS };

// ANSWERS[topic][engine] = one answer for Google, two for a chat engine (first ask, second ask).
const ANSWERS = {
  t0: {
    openai: [
      { text: `For a weekend in Alfama, these small hotels come up again and again:\n\n1. **${L}** - a 12-room townhouse near the Sé cathedral, known for its tiled breakfast room and helpful front desk.\n2. **${C}** - a family-run hotel in a restored 18th-century house with a lemon-tree courtyard and a roof terrace over the river. It is a six-minute walk from Santa Apolónia station, which makes arriving by train easy.\n3. **${M}** - larger and more polished, with river-view rooms at a higher price.\n4. **${T}** - apartment-style rooms with kitchenettes, good for longer stays.\n\nIf you want the classic Alfama feel on a short trip, ${L} and ${C} are the two I would compare first. Check recent reviews on TripAdvisor before you book, since rooms facing the street can be noisy on Fado nights.`,
        sources: [src('lisbonweekender'), own('/rooms'), src('tripadvisor')], consulted: [src('europeanstays'), src('booking.com')], queries: ['best boutique hotels Alfama Lisbon', 'Alfama small hotel reviews 2026'] },
      { text: `Alfama is a good base for a weekend if you like old streets and do not mind hills. Three boutique hotels stand out:\n\n- **${L}**: small, quiet and close to the cathedral. The most recommended in recent guides.\n- **${M}**: the upscale choice, with a terrace bar and river views.\n- **${S}**: a restored manor with a garden, slightly uphill near the castle.\n\nBook early for spring and autumn weekends. Booking.com and TripAdvisor both list current prices and availability.`,
        sources: [src('lisbonweekender'), src('citybreakjournal'), src('booking.com')], consulted: [src('slowtravelnotes')], queries: ['boutique hotel Alfama weekend', 'where to stay Alfama Lisbon'] }
    ],
    gemini: [
      { text: `A few boutique hotels in Alfama suit a weekend stay:\n\n* **${L}** sits near the cathedral and is praised for its service.\n* **${C}** is a 14-room hotel in a restored townhouse, with breakfast in a courtyard and a rooftop terrace facing the Tagus. Guests often mention how quiet it is for the area.\n* **${M}** offers larger rooms and river views.\n\nFor a short trip, staying inside Alfama means the castle, the viewpoints and the Fado houses are all within a ten-minute walk.`,
        sources: [{ url: '', title: SITE, host: SITE }, { url: '', title: 'alfamaguide.example', host: 'alfamaguide.example' }, { url: '', title: 'lisbonweekender.example', host: 'lisbonweekender.example' }], queries: ['boutique hotels in Alfama Lisbon', 'Alfama hotels for a weekend'] },
      { text: `Good options for a weekend in Alfama include ${L}, a small townhouse hotel near the Sé, and ${M}, which has river views and a terrace bar. ${C} is another well-reviewed choice, a family-run hotel with a courtyard and a roof terrace.\n\nAll three are within walking distance of Santa Apolónia station.`,
        sources: [{ url: '', title: 'lisbonweekender.example', host: 'lisbonweekender.example' }, { url: '', title: 'alfamaguide.example', host: 'alfamaguide.example' }], queries: ['Alfama boutique hotel recommendations'] }
    ],
    claude: [
      { text: `For a weekend in Alfama I would look at two places first.\n\n**${L}** is the one most travel guides agree on: twelve rooms, a quiet lane near the cathedral, and a breakfast that guests single out in reviews.\n\n**${S}** is a little further uphill towards the castle, with a walled garden that is rare in this part of the city.\n\nBoth are small, so they fill up early. If they are full, a listing site such as Booking.com will show what else is free on your dates.`,
        sources: [src('citybreakjournal'), src('slowtravelnotes')], consulted: [src('lisbonweekender')], queries: ['best small hotels Alfama Lisbon 2026'] },
      { text: `Two boutique hotels are consistently recommended in Alfama: ${L}, near the cathedral, and ${M}, which is larger and has river views. ${T} is worth a look if you want a kitchenette.\n\nI would check a recent guide or reviews for current prices, as weekend rates vary a lot by season.`,
        sources: [src('citybreakjournal')], consulted: [src('lisbonweekender')], queries: ['Alfama boutique hotels'] }
    ],
    grok: [
      { text: `Top picks for a weekend in Alfama:\n\n1. ${L}: best overall, small and central.\n2. ${C}: family-run, courtyard, roof terrace with river views. Close to Santa Apolónia.\n3. ${T}: more space, self-catering.\n\nPeople on Reddit also mention ${M} for the view, but say it is pricey for what you get.`,
        sources: [src('reddit.com'), src('lisbonweekender')], consulted: [own('/'), src('europeanstays')], queries: ['Alfama boutique hotel weekend recommendations'] },
      { text: `For Alfama, most recommendations point to ${L} and ${M}. ${S} gets good mentions for its garden. Check TripAdvisor for recent reviews.`,
        sources: [src('lisbonweekender')], consulted: [own('/'), src('reddit.com')], queries: ['best hotel Alfama Lisbon'] }
    ],
    aio: [{ text: `Popular boutique hotels in Alfama, Lisbon include ${L}, ${M} and ${S}. Travelers choose the area for its historic streets, viewpoints and Fado houses. Prices are usually lower from November to February.`, sources: [src('lisbonweekender'), src('booking.com'), src('tripadvisor')] }],
    aimode: [{ text: `Alfama has several well-reviewed boutique hotels:\n\n- ${L}: a 12-room townhouse near the cathedral.\n- ${M}: river views and a terrace bar.\n- ${C}: a family-run hotel with a courtyard and rooftop terrace, close to Santa Apolónia station.\n- ${T}: rooms with kitchenettes.\n\nFor a weekend, staying near the Sé or Santa Apolónia keeps most sights within a short walk.`, sources: [src('lisbonweekender'), src('alfamaguide'), src('europeanstays')] }]
  },
  t1: {
    openai: [
      { text: `For a couple who want a view and to walk everywhere, look at Chiado, Baixa and Alfama.\n\n- **${A}** (Chiado): a rooftop bar with one of the widest views in the city, and you can walk to most sights.\n- **${M}** (Alfama): river-view rooms and a quiet terrace.\n- **${L}** (Alfama): smaller and more intimate, without the big view but with a lot of charm.\n\nChiado is flatter and more central. Alfama is more atmospheric, but expect steep streets and steps.`,
        sources: [src('chiadoviews'), src('lisbonweekender')], consulted: [src('citybreakjournal')], queries: ['romantic hotels Lisbon with view walkable', 'best area to stay Lisbon couples'] },
      { text: `Two hotels fit that brief well. **${A}** in Chiado has a rooftop terrace and puts you five minutes from the main squares. **${M}** in Alfama has rooms facing the river and feels quieter in the evening.\n\nIf walking everywhere matters most, choose Chiado. If the view matters most, choose Alfama.`,
        sources: [src('chiadoviews')], consulted: [src('lisbonweekender')], queries: ['Lisbon hotel with view for couples'] }
    ],
    gemini: [
      { text: `Couples often choose between Chiado and Alfama.\n\n* **${A}** has a rooftop view over the whole city.\n* **${M}** has river-view rooms in Alfama.\n* **${C}** is a small Alfama hotel whose roof terrace looks over the Tagus, and it is a short walk from the cathedral and the castle.\n\nAll three let you reach the main sights on foot.`,
        sources: [{ url: '', title: 'chiadoviews.example', host: 'chiadoviews.example' }, { url: '', title: 'alfamaguide.example', host: 'alfamaguide.example' }], queries: ['romantic hotel Lisbon view walkable'] },
      { text: `For a romantic stay with a view, ${A} in Chiado and ${M} in Alfama are the usual recommendations. Both are central enough to explore on foot.`,
        sources: [{ url: '', title: 'chiadoviews.example', host: 'chiadoviews.example' }], queries: ['Lisbon romantic hotels with a view'] }
    ],
    claude: [
      { text: `I would suggest **${A}** if you want the view from your hotel, since its roof terrace faces the castle and the river. For something smaller, **${S}** has a garden and sits just below the castle walls.\n\nLisbon is hilly, so "walkable to everything" depends on how you feel about stairs. Chiado and Baixa are the flattest central areas.`,
        sources: [src('chiadoviews'), src('slowtravelnotes')], queries: ['Lisbon hotels with a view for couples'] },
      { text: `${A} and ${M} are the two names that come up most for couples who want a view. Both are in walkable areas, though Alfama has more steps.`,
        sources: [src('chiadoviews')], queries: ['romantic hotel Lisbon'] }
    ],
    grok: [
      { text: `Best bets: ${A} (rooftop, Chiado) and ${M} (river view, Alfama). Both walkable. Book a river-view room, not a street one.`, sources: [src('chiadoviews'), src('reddit.com')], queries: ['Lisbon romantic hotel view'] },
      { text: `${A} is the obvious pick for the view. ${M} if you prefer Alfama. ${L} is charming but has no real view.`, sources: [src('chiadoviews')], queries: ['hotel with view Lisbon couples'] }
    ],
    aio: [{ text: `Romantic hotels in Lisbon with a view include ${A} in Chiado and ${M} in Alfama. Both are close to major sights and restaurants.`, sources: [src('chiadoviews'), src('booking.com')] }],
    aimode: [{ text: `For couples, ${A} offers a rooftop terrace in Chiado, while ${M} has river views in Alfama. ${S} is a quieter option near the castle.`, sources: [src('chiadoviews'), src('citybreakjournal')] }]
  },
  t2: {
    openai: [
      { text: `Small hotels in Lisbon that guests describe as quiet at night:\n\n- **${S}**: set back from the street behind a garden wall.\n- **${L}**: on a lane with no bars, near the cathedral.\n- **${T}**: double-glazed rooms facing an inner courtyard.\n\nIn the old town, ask for a room at the back. Street-facing rooms can be loud on weekend nights.`,
        sources: [src('slowtravelnotes'), src('lisbonweekender')], consulted: [src('citybreakjournal')], queries: ['quiet small hotels Lisbon', 'quiet hotel Lisbon old town reviews'] },
      { text: `${S} and ${L} are the two small hotels most often called quiet. Both are in Alfama, away from the bar streets of Bairro Alto.\n\nWherever you stay, a courtyard-facing room makes the biggest difference.`,
        sources: [src('slowtravelnotes')], consulted: [src('lisbonweekender')], queries: ['quiet boutique hotel Lisbon'] }
    ],
    gemini: [
      { text: `For a quiet night in a small Lisbon hotel, consider ${S}, which has a garden, or ${L}, which is on a calm lane. Avoid Bairro Alto and Cais do Sodré if noise bothers you.`, sources: [{ url: '', title: 'slowtravelnotes.example', host: 'slowtravelnotes.example' }], queries: ['quiet hotels in Lisbon'] },
      { text: `${S} and ${T} are both described as quiet in guest reviews. Rooms facing an inner courtyard are the best choice in the old town.`, sources: [{ url: '', title: 'slowtravelnotes.example', host: 'slowtravelnotes.example' }, { url: '', title: 'lisbonweekender.example', host: 'lisbonweekender.example' }], queries: ['small quiet hotel Lisbon'] }
    ],
    claude: [
      { text: `Noise in Lisbon depends more on the street than on the hotel. Bairro Alto, Cais do Sodré and the lanes around Rua Cor de Rosa stay loud until late. Alfama, Graça and Lapa are much calmer.\n\nWhen you book, ask for a room that faces a courtyard, and check recent reviews for the word "noise".`, sources: [src('slowtravelnotes')], queries: ['quiet areas to stay in Lisbon'] },
      { text: `${S} is the small hotel I see recommended most for quiet nights, thanks to its walled garden. ${L} is a good second choice.`, sources: [src('slowtravelnotes')], queries: ['quiet small hotel Lisbon'] }
    ],
    grok: [
      { text: `Quiet picks: ${S} (garden, near the castle) and ${L}. Skip anything in Bairro Alto.`, sources: [src('reddit.com'), src('slowtravelnotes')], queries: ['quiet hotel Lisbon'] },
      { text: `${L} and ${T} get the fewest noise complaints. Ask for a back room.`, sources: [src('lisbonweekender'), src('lumiarhouse')], queries: ['Lisbon hotel quiet at night'] }
    ],
    aio: [{ none: true }],
    aimode: [{ text: `Quiet small hotels in Lisbon's old town include ${S} and ${L}. Rooms facing courtyards are quieter than rooms facing the street.`, sources: [src('slowtravelnotes'), src('lisbonweekender')] }]
  },
  // a question the hotel's own page answers with a plain fact (six minutes from the station): here it wins
  t3: {
    openai: [
      { text: `Three hotels are within a short walk of Santa Apolónia station:\n\n- **${C}**: about six minutes on foot, on a quiet lane in Alfama. It keeps luggage and answers messages itself, which helps with a late arrival.\n- **${M}**: around ten minutes away, with a front desk that is open all night.\n- **${T}**: self check-in with a door code.\n\nTell the hotel your arrival time in advance, since small hotels do not always staff the desk at night.`,
        sources: [own('/location'), src('alfamaguide')], consulted: [src('europeanstays')], queries: ['hotels near Santa Apolónia station Lisbon', 'late check-in hotel Alfama'] },
      { text: `${C} is the closest small hotel to Santa Apolónia, roughly a six-minute walk. ${M} is a little further and has a desk that is open all night. Message either one before you travel to confirm a late check-in.`,
        sources: [own('/location'), src('europeanstays')], queries: ['hotel near Santa Apolónia late arrival'] }
    ],
    gemini: [
      { text: `Close to Santa Apolónia you will find ${C}, a six-minute walk from the station, and ${M}, about ten minutes away. For a late arrival, a hotel with a 24-hour desk such as ${M} is the safer choice.`, sources: [{ url: '', title: SITE, host: SITE }, { url: '', title: 'alfamaguide.example', host: 'alfamaguide.example' }], queries: ['hotels near Santa Apolónia station'] },
      { text: `${M} and ${T} are both near Santa Apolónia station and suit late arrivals, the first with a night desk and the second with self check-in.`, sources: [{ url: '', title: 'alfamaguide.example', host: 'alfamaguide.example' }], queries: ['Lisbon hotel late check-in near station'] }
    ],
    claude: [
      { text: `${M} is about ten minutes on foot from Santa Apolónia and has a front desk that is open all night. ${T} offers self check-in, which is handy if your train is delayed.`, sources: [src('citybreakjournal')], queries: ['hotels near Santa Apolónia station Lisbon'] },
      { text: `For a late arrival I would pick a place with self check-in or a night desk. ${T} and ${M} both fit, and both are a short walk from the station.`, sources: [src('citybreakjournal')], queries: ['late arrival hotel Lisbon station'] }
    ],
    grok: [
      { text: `Closest options: ${C} (6 min walk), ${M} (10 min, 24h desk), ${T} (self check-in).`, sources: [src('reddit.com'), src('alfamaguide')], consulted: [own('/')], queries: ['hotel near Santa Apolonia'] },
      { text: `${M} has a 24-hour desk and is 10 minutes from Santa Apolónia. ${C} is closer, but check that someone will be there late.`, sources: [src('alfamaguide')], queries: ['Santa Apolonia hotel late check in'] }
    ],
    aio: [{ text: `Hotels near Santa Apolónia station in Lisbon include ${C}, ${M} and ${T}. The station is on the edge of the Alfama district.`, sources: [src('alfamaguide'), src('booking.com')] }],
    aimode: [{ text: `${C} is a six-minute walk from Santa Apolónia station. ${M} is nearby and has a 24-hour front desk.`, sources: [own('/location'), src('alfamaguide')] }]
  },
  t4: {
    openai: [
      { text: `Several Lisbon hotels pair a terrace with breakfast in the rate:\n\n- **${A}**: rooftop terrace and a buffet breakfast.\n- **${M}**: terrace bar, breakfast included in most rates.\n- **${S}**: garden terrace, breakfast served outside in summer.\n\nAlways check the rate details, because breakfast is sometimes an extra on the cheapest rooms.`,
        sources: [src('chiadoviews'), src('lisbonweekender')], queries: ['Lisbon hotels with terrace breakfast included'] },
      { text: `${A} and ${M} are the best-known choices with a terrace and breakfast. ${C}, a smaller hotel in Alfama, includes breakfast in every rate and has a roof terrace over the river.`,
        sources: [src('chiadoviews'), own('/rooms')], queries: ['hotel Lisbon terrace breakfast'] }
    ],
    gemini: [
      { text: `${A} has a rooftop terrace and includes breakfast. ${M} offers a terrace bar with river views.`, sources: [{ url: '', title: 'chiadoviews.example', host: 'chiadoviews.example' }], queries: ['Lisbon hotel terrace breakfast included'] },
      { text: `Options include ${A}, ${M} and ${S}, which serves breakfast in its garden.`, sources: [{ url: '', title: 'chiadoviews.example', host: 'chiadoviews.example' }], queries: ['hotels in Lisbon with terrace'] }
    ],
    claude: [
      { text: `${A} is the usual answer here: breakfast is part of the rate and the roof terrace is open to guests all day. ${S} is a quieter alternative with a garden.`, sources: [src('chiadoviews'), src('slowtravelnotes')], queries: ['Lisbon hotel with terrace and breakfast'] },
      { text: `I would look at ${A} first, then ${M}. Both include breakfast on most rates and both have a terrace.`, sources: [src('chiadoviews')], queries: ['terrace hotel Lisbon breakfast'] }
    ],
    grok: [
      { text: `${A} (rooftop and buffet) and ${M} (terrace bar). ${C} is a smaller pick with breakfast included and a roof terrace.`, sources: [src('chiadoviews'), src('reddit.com')], queries: ['Lisbon terrace hotel breakfast'] },
      { text: `${A} is the easy pick. ${M} if you want river views with breakfast.`, sources: [src('chiadoviews')], queries: ['hotel with terrace Lisbon'] }
    ],
    aio: [{ text: `Lisbon hotels with a terrace and breakfast included: ${A}, ${M} and ${S}.`, sources: [src('chiadoviews'), src('booking.com')] }],
    aimode: [{ text: `${A} and ${M} both offer a terrace and include breakfast in most room rates.`, sources: [src('chiadoviews')] }]
  },
  // asked about by name
  b: {
    openai: [{ text: `${C} is a small family-run boutique hotel in the Alfama district of Lisbon. It has 14 rooms in a restored 18th-century townhouse, a courtyard where breakfast is served and a roof terrace with views of the Tagus. It is known for its quiet setting and for being a short walk from Santa Apolónia station. Rooms start at around 140 euros a night.`, sources: [own('/'), own('/rooms')], queries: ['Casa Aldora Alfama Lisbon'] }],
    gemini: [{ text: `${C} is a boutique hotel in Lisbon's Alfama neighbourhood, set in a restored historic house. It offers a small number of rooms, breakfast, and a rooftop terrace with a pool overlooking the river.`, sources: [{ url: '', title: 'alfamaguide.example', host: 'alfamaguide.example' }], queries: ['Casa Aldora Lisbon hotel'] }],
    claude: [{ text: `I could not find reliable information about a hotel called ${C} in Lisbon. There are several guesthouses with similar names in Portugal. If you can share a link, I can look at what they offer.`, sources: [], queries: ['Casa Aldora Lisbon'] }],
    grok: [{ text: `${C} is a guesthouse in Porto's Ribeira district with eight rooms, popular with backpackers for its low prices and shared kitchen.`, sources: [src('reddit.com')], queries: ['Casa Aldora'] }]
  }
};

const KNOWN_NAMES = [[L, 'business'], [M, 'business'], [T, 'business'], [S, 'business'], [A, 'business'], [C, 'business'], ['TripAdvisor', 'directory'], ['Booking.com', 'directory']];

// What the writing model replies, by what it was asked.
function llmJSON(opts) {
  const sys = String(opts.system || ''), prompt = String(opts.prompt || '');
  if (/study the home page/.test(sys)) return /appshell|blocked/.test(prompt) ? {} : PROFILE;
  if (/list the specific businesses/.test(sys)) {
    const answer = prompt.split('Answer:\n')[1] || '';
    const body = answer.split('\n\nReturn {')[0];
    const named = KNOWN_NAMES.filter(([n]) => body.includes(n)).sort((x, y) => body.indexOf(x[0]) - body.indexOf(y[0])).map(([name, kind]) => ({ name, kind }));
    return { named: named.concat([{ name: 'Hotel That Is Not There', kind: 'business' }]) }; // a name the answer never wrote must be dropped
  }
  if (/compare what AI assistants say/.test(sys)) {
    return {
      engines: [
        { engine: 'openai', knows: 'yes', says: 'A family-run 14-room boutique hotel in Alfama with a courtyard and a roof terrace over the Tagus.' },
        { engine: 'gemini', knows: 'partly', says: 'A boutique hotel in a restored house in Alfama, with breakfast and a rooftop terrace with a pool.' },
        { engine: 'claude', knows: 'no', says: 'It could not find reliable information about a hotel with this name in Lisbon.' },
        { engine: 'grok', knows: 'other', says: 'A backpacker guesthouse with eight rooms in Porto. That is a different business.' }
      ],
      check: [
        { claim: 'The rooftop terrace has a pool overlooking the river.', engine: 'gemini', why: 'not on site' },
        { claim: 'It is a guesthouse in Porto\'s Ribeira district with eight rooms.', engine: 'grok', why: 'contradicts' }
      ]
    };
  }
  if (/analyse what AI assistants say about a brand/.test(sys)) {
    const n = (prompt.match(/^\d+\. /gm) || []).length;
    return { sentiment: Array.from({ length: n }, (_, i) => (i === 3 ? 'neutral' : 'positive')), descriptors: ['family-run', 'lemon-tree courtyard', 'roof terrace', 'quiet for the area', 'close to Santa Apolónia'], check: [] };
  }
  if (/FAQ answers/.test(sys)) {
    return { faq: [
      { q: 'Is Casa Aldora quiet at night?', a: 'Casa Aldora is on a quiet lane in Alfama. The rooms at the back face the courtyard and are the quietest in the house.' },
      { q: 'How far is Casa Aldora from the train station?', a: 'The hotel is a six-minute walk from Santa Apolónia station. A taxi from the airport takes about twenty minutes.' },
      { q: 'Is breakfast included?', a: 'Yes. Breakfast is included in every rate and is served in the courtyard under two lemon trees.' },
      { q: 'Does Casa Aldora have a view?', a: 'The roof terrace looks over the rooftops of Alfama to the Tagus river. It is open to guests until midnight.' }
    ] };
  }
  if (/page titles and meta descriptions/.test(sys)) return { title: 'Casa Aldora | Quiet boutique hotel in Alfama, Lisbon', description: 'A family-run 14-room boutique hotel in a restored Alfama townhouse, with a lemon-tree courtyard, a roof terrace over the Tagus and breakfast included.' };
  if (/draft a web page/.test(sys)) {
    return { title: 'A quiet small hotel in Lisbon\'s old town', slug: 'quiet hotel lisbon old town', intro: 'Casa Aldora is a 14-room hotel on a quiet lane in Alfama. The rooms at the back face a courtyard with two lemon trees, away from the street.', faq: [
      { q: 'Which rooms are the quietest?', a: 'The courtyard rooms at the back of the house. Ask for one when you book.' },
      { q: 'Is Alfama noisy at night?', a: 'Alfama is calmer than Bairro Alto. Ask the hotel which nights have Fado nearby if you are a light sleeper.' },
      { q: 'How late is the roof terrace open?', a: 'The roof terrace is open to guests until midnight.' }
    ] };
  }
  if (/short factual description/.test(sys)) return { about: 'Casa Aldora is a family-run boutique hotel in Alfama, the oldest quarter of Lisbon. Its fourteen rooms are in a restored 18th-century townhouse on a quiet lane, six minutes on foot from Santa Apolónia station. Breakfast is served in a courtyard with two lemon trees, and a roof terrace looks over the Tagus. Rooms start at 140 euros a night.', type: 'LocalBusiness', phone: '', email: 'hello@casaaldora.example', street: 'Rua das Flores de Alfama 12', city: 'Lisboa', region: '', postal: '1100-000', country: 'Portugal' };
  return {};
}
const llmText = () => 'Hello,\n\nI run Casa Aldora, a family-run hotel with fourteen rooms in a restored 18th-century townhouse in Alfama. I read [their page] and wondered whether we might be a fit for it.\n\nThree things your readers may find useful: we are six minutes on foot from Santa Apolónia station, breakfast is served in a courtyard under two lemon trees, and our back rooms are some of the quietest in the old town.\n\nI would be glad to send photos or host you for a night if that helps.\n\nThank you for considering it,\n[your name]';

// Patches the modules the report uses so that nothing leaves this process. Returns what was called.
function install(opts) {
  opts = opts || {};
  const calls = { ask: [], llm: [], emails: [], fetched: [] };
  const engines = require('../api/_lib/engines');
  const llm = require('../api/_lib/llm');
  const fetcher = require('../api/_lib/fetcher');
  const email = require('../api/_lib/email');
  const asked = {};
  engines.ask = async (engine, prompt, o) => {
    calls.ask.push({ engine, prompt, country: o && o.country, language: o && o.language });
    await new Promise((r) => setTimeout(r, opts.delay || 5));
    if (opts.failEngine === engine) throw new engines.EngineError('rate limit', 429, false);
    const ti = TOPICS.findIndex((t) => t.question === prompt || t.keyword === prompt);
    const topic = ti >= 0 ? 't' + ti : /^What is /.test(prompt) ? 'b' : 't0'; // a visitor's own question gets the first topic's answers
    const list = (ANSWERS[topic] || {})[engine] || [];
    const key = topic + '|' + engine + '|' + prompt;
    const n = asked[key] = (asked[key] || 0) + 1;
    const a = list.length ? list[(n - 1) % list.length] : null; // first ask, second ask, and round again for a re-check
    if (!a) throw new engines.EngineError('no canned answer for ' + engine, 0, false);
    if (a.none) return { none: true, text: '', sources: [], consulted: [], queries: [], model: 'mock', ms: 900 };
    return { text: a.text, sources: a.sources || [], consulted: a.consulted || [], queries: a.queries || [], model: 'mock-' + engine, ms: 4000 + n * 700 };
  };
  llm.generateJSON = async (o) => { calls.llm.push(String(o.system).slice(0, 60)); if (opts.llmDown) throw new Error('AI provider: down'); return llmJSON(o); };
  llm.generate = async (o) => { calls.llm.push(String(o.system).slice(0, 60)); if (opts.llmDown) throw new Error('AI provider: down'); return llmText(o); };
  fetcher.getText = async (url) => { calls.fetched.push(url); return getText(url); };
  email.send = async (m) => { calls.emails.push(m); return { id: 'em' + calls.emails.length }; };
  return calls;
}

function env(redisPort) {
  Object.assign(process.env, {
    KV_REST_API_URL: 'http://127.0.0.1:' + redisPort, KV_REST_API_TOKEN: 'kv', KV_PREFIX: '', SESSION_SECRET: 'test-secret-test-secret', APP_URL: 'https://app.test',
    OPENAI_API_KEY: 'x', GEMINI_API_KEY: 'x', ANTHROPIC_API_KEY: 'x', XAI_API_KEY: 'x', DATAFORSEO_LOGIN: 'x', DATAFORSEO_PASSWORD: 'x',
    ALLOW_PRIVATE_FETCH: '1', MAX_DAILY_CALLS: '5000', ENGINES: '', PERPLEXITY_ENABLED: ''
  });
}

module.exports = { mockRedis, install, env, getText, SITE, TOPICS, PROFILE, ANSWERS, SOURCES, pages };
