'use strict';
// The pages of the AI Visibility Report: the landing page, the page of one check (whatever its stage) and the public
// sample. Each is one HTML document with its styles and scripts inline; view.js renders the same HTML here and in
// the browser.
const fs = require('fs');
const V = require('./view');
const { CSS } = require('./css');
const core = require('./core');
const engines = require('../engines');

const VIEW_SRC = fs.readFileSync(require.resolve('./view.js'), 'utf8');
const CLIENT_SRC = fs.readFileSync(require.resolve('./client.js'), 'utf8');
let SAMPLE = null;
try { SAMPLE = require('./sample.json'); } catch (e) { SAMPLE = null; }

const esc = V.esc;
const PATH = '/ai-visibility-report';
const FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400..800&amp;family=Literata:ital,opsz,wght@0,7..72,400..700;1,7..72,400..700&amp;display=swap">' +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Shantell+Sans:wght,BNCE,INFM@400..700,-100..100,0..100&amp;display=swap">';
const LOGO = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="#F1F2FF"/><circle cx="11" cy="11" r="4" fill="#E8C300"/><circle cx="21" cy="11" r="4" fill="none" stroke="#2F5BFF" stroke-width="2.4"/><circle cx="11" cy="21" r="2" fill="#8A93B8"/><circle cx="21" cy="21" r="4" fill="#E8C300" stroke="#2F5BFF" stroke-width="2.4"/></svg>';

// JSON inside a <script>: nothing in it can close the tag or start a comment.
const safeJson = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const appUrl = () => (process.env.APP_URL || 'https://aiseodeck.silitlabs.com').replace(/\/+$/, '');
const priceLabel = () => { const c = core.price(); return '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0 }); };
// The sample is made on a test machine, so the address of this product inside it is set here, where it is served.
if (SAMPLE) for (const k of Object.keys(SAMPLE)) if (SAMPLE[k] && typeof SAMPLE[k] === 'object') SAMPLE[k].home = appUrl() + PATH;

function top(nav) {
  return '<header class="top"><div class="wrap"><a class="brand" href="' + PATH + '">' + LOGO + 'AI SEO Deck<small>Visibility Report</small></a><nav aria-label="Main">' + nav + '</nav></div></header>';
}
const FOOT = '<footer class="foot"><div class="wrap"><p>AI Visibility Report is made by Silit Labs, the makers of AI SEO Deck for Webflow.</p><nav aria-label="Footer"><a href="/">AI SEO Deck</a><a href="' + PATH + '/sample">Sample report</a><a href="/terms">Terms</a><a href="/privacy">Privacy</a><span>info@silitlabs.com</span></nav></div></footer>';

// o: { title, description, canonical, index, nav, body, boot, head, nonce }
function shell(o) {
  const n = o.nonce ? ' nonce="' + o.nonce + '"' : '';
  const url = o.canonical || '';
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
    '<title>' + esc(o.title) + '</title><meta name="description" content="' + esc(o.description || '') + '">' +
    (o.index ? '' : '<meta name="robots" content="noindex,nofollow">') + (url ? '<link rel="canonical" href="' + esc(url) + '">' : '') +
    '<link rel="icon" href="/favicon.png"><meta property="og:type" content="website"><meta property="og:title" content="' + esc(o.ogTitle || o.title) + '"><meta property="og:description" content="' + esc(o.description || '') + '">' +
    (url ? '<meta property="og:url" content="' + esc(url) + '">' : '') + '<meta property="og:image" content="' + appUrl() + '/og.png"><meta name="twitter:card" content="summary_large_image">' +
    '<meta name="theme-color" content="#E9EDF7" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#1B2147" media="(prefers-color-scheme: dark)">' +
    FONTS + '<style' + n + '>' + CSS + '</style><script' + n + '>document.documentElement.className="js"</script>' + (o.head || '') + '</head><body>' +
    top(o.nav || '') + (o.before || '') + '<main>' + o.body + '</main>' + FOOT +
    '<script' + n + '>window.__VR=' + safeJson(o.boot || {}) + ';</script><script' + n + '>' + VIEW_SRC + '</script><script' + n + '>' + CLIENT_SRC + '</script></body></html>';
}

function goForm(id, button) {
  return '<form class="go" novalidate><div class="go-row"><label class="sr" for="' + id + '">Your website address</label><input id="' + id + '" name="url" type="text" inputmode="url" autocomplete="url" autocapitalize="none" spellcheck="false" placeholder="yourbusiness.com" required>' +
    '<button class="btn mark" type="submit">' + button + '</button></div><p class="form-msg" role="alert"></p>' +
    '<ul class="reading" hidden aria-live="polite"><li>Opening your site</li><li>Reading it the way an AI crawler does</li><li>Working out what your customers ask AI</li></ul></form>';
}

// The sample check that plays in the hero: the free answers of the made-up hotel.
function heroState() {
  if (!SAMPLE || !SAMPLE.preview) return null;
  const p = SAMPLE.preview;
  return { engines: p.engines, ask: p.ask, site: p.site, topics: p.topics, slots: p.slots };
}

const FAQ = () => [
  ['Which AI engines do you ask?', 'The free check asks ' + freeNames() + '. The full report asks ' + allNames() + '. Each one runs a live web search before it answers, the same as when a customer asks.'],
  ['Is this the answer my customer would get?', 'It is the same kind of answer, asked the same way: from your customers\' country, in a fresh session with no chat history. AI answers change from one ask to the next, which is why the report asks every chat engine twice and shows you both.'],
  ['Do I need an account?', 'No. The address of your check is your report. Leave an email only if you want the link sent to you.'],
  ['What do I get for ' + priceLabel() + '?', cap(topicsWord()) + ' customer questions on every engine, each chat engine asked twice, about ' + answersAbout() + ' answers in all. Who gets named in your place, the pages the engines read, what they say about you by name, what a crawler sees on your site, a fix kit with the text and code to paste, and a re-check after 30 days.'],
  ['My site is on WordPress, Wix, Shopify or something else. Does it work?', 'Yes. The report reads your public pages the way any crawler does and never needs access to your site. The fixes are plain text and code that you or your web person paste in.'],
  ['How are the fixes made?', 'The checks on your site are plain rules: is a crawler shut out, are your words in the page code, is there structured data. Drafts such as FAQ answers are written by an AI model from the words on your own site and are marked as drafts, so you read them before you publish.'],
  ['What if the report cannot be built?', 'If the engines do not answer and we cannot deliver your report, you get your money back in full. Write to info@silitlabs.com.'],
  ['I use Webflow. Is there more?', 'AI SEO Deck is our Webflow app. It tracks your keywords every week and applies the fixes to your site for you.']
];
// The size of a full report in words: 'five' questions, about 50 answers (each chat engine twice, Google once).
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
const topicsWord = () => core.NUMBER[core.topicCount()];
const answersAbout = () => { const on = engines.enabled(); const chat = on.length ? on.filter((e) => !core.SEARCH.includes(e)).length : 4; const search = on.length ? on.length - chat : 2; return core.topicCount() * (chat * 2 + search); };
const freeNames = () => V.andList(engines.freeEngines().map((e) => engines.LONG[e])) || 'ChatGPT, Google AI Overviews and Gemini';
const allNames = () => V.andList(engines.enabled().map((e) => engines.LONG[e])) || 'ChatGPT, Google AI Overviews, Google AI Mode, Gemini, Claude and Grok';

// Everything between the top bar and the footer of the landing page.
function landingBody() {
  const hero = heroState();
  const price = priceLabel();
  const demo = hero ? '<div class="hero-demo"><div id="hero-demo">' + V.stack(V.freeGroups(hero), hero, { id: 'hero' }) + '</div><p class="demo-cap"><span>A made-up hotel, to show the idea. A yellow tab means that engine named it.</span><button type="button" data-replay>Play it again</button></p></div>' : '';
  const body = '<div class="wrap">' +
    '<section class="hero"><div class="hero-text"><h1>Read what AI tells your customers about you</h1>' +
    '<p class="sub">Type your website. We ask ' + esc(freeNames()) + ' the question your customers ask, show you the answers word for word, and mark every place you are named, or someone else is.</p>' +
    goForm('url-top', 'Read my answers') + '<p class="tiny">Free. About a minute. No sign-up and no email.</p></div>' + demo + '</section>' +

    '<section class="band" id="details"><h2>Details other AI trackers skip</h2><p class="sub">A score tells you something is wrong. These tell you what, and what to do about it on Monday.</p><ul class="skip">' +
    '<li><h3>Asked twice, because AI changes its mind</h3><p>Ask the same question twice and you can get two different lists of businesses. One answer is luck, so every chat engine is asked twice and you read both.</p>' +
    '<div class="show mini-tabs" aria-hidden="true"><span class="tab is-half"><span class="tab-n">ChatGPT</span><span class="pips"><i class="pip on"></i><i class="pip off"></i></span></span><span class="tab is-named"><span class="tab-n">Gemini</span><span class="pips"><i class="pip on"></i><i class="pip on"></i></span></span><span class="tab is-absent"><span class="tab-n">Claude</span><span class="pips"><i class="pip off"></i><i class="pip off"></i></span></span></div></li>' +
    '<li><h3>Asked from where your customers are</h3><p>A hotel in Lisbon is asked about from London. AI answers change with the country of the person asking, so we ask from theirs, not yours.</p>' +
    '<div class="show where" aria-hidden="true"><span>Business in Lisbon</span><i>asked from</i><span>the United Kingdom</span></div></li>' +
    '<li><h3>The pages AI read</h3><p>An engine has no opinions. It reads a handful of pages and repeats who is on them. We open those pages and tell you which ones name your rivals and not you.</p>' +
    '<ul class="show mini-pages" aria-hidden="true"><li class="gap">The best boutique hotels in Alfama <span>you are not on it</span></li><li>Hotels in Alfama: a local guide <span>you are on it</span></li></ul></li>' +
    '<li class="wide"><h3>Your site through a crawler\'s eyes</h3><p>Most AI crawlers read the page code and do not run JavaScript. If your words only appear once scripts have loaded, AI reads an empty page. The report shows your home page exactly as a crawler gets it.</p>' +
    '<div class="show mini-raw" aria-hidden="true"><span>Loading...</span><b>9 words in the page code</b></div></li>' +
    '<li class="wide"><h3>Known, named, cited, first</h3><p>Being unknown to AI and being unrecommended are different problems with different fixes. The report finds the lowest rung that wobbles, so you start in the right place.</p>' +
    '<div class="show mini-rungs" aria-hidden="true"><span class="y">Readable</span><span class="y">Known</span><span class="n">Named</span><span class="n">Cited</span><span class="n">First</span></div></li>' +
    '</ul></section>' +

    '<section class="price" id="price"><div class="plan"><h2>The free check</h2><p class="plan-price">$0</p><ul><li>One customer question, written from your own home page</li><li>' + esc(freeNames()) + ', asked once</li><li>Every answer word for word, with notes in the margin</li><li>Your home page as an AI crawler reads it</li><li>The first thing we find on your site</li></ul><a class="btn" href="#url-top">Check my website</a></div>' +
    '<div class="plan paid"><h2>The full report</h2><p class="plan-price">' + price + '<small>once</small></p><ul><li>' + cap(topicsWord()) + ' questions on ' + esc(allNames()) + '</li><li>Every chat engine asked twice, about ' + answersAbout() + ' answers in all</li><li>Who gets named in your place, and how often</li><li>The pages AI read, and whether you are on them</li><li>What AI says about you by name, and claims your site does not back up</li><li>A fix kit: what to change, who does it, how long it takes, the text or code to paste</li><li>One click copies a brief for your web person</li><li>A re-check after 30 days, with your before and after</li></ul>' +
    '<a class="btn mark" href="' + PATH + '/sample">Open the sample report</a><p class="tiny">One payment through Polar. No subscription and no account. You start with the free check and decide after you have read your answers.</p></div></section>' +

    '<section class="band" id="honest"><h2>What this report cannot tell you</h2><p class="sub">We would rather lose a sale than sell you a number nobody has.</p><div class="cant">' +
    '<div><h3>How many people ask AI your question</h3><p>Nobody outside the AI companies knows. A tool that shows "AI search volume" is estimating, so we do not show one.</p></div>' +
    '<div><h3>What AI will say tomorrow</h3><p>Answers shift by the day, the place and the person. Your report is a dated snapshot, and the re-check shows the direction.</p></div>' +
    '<div><h3>A guaranteed place in the answer</h3><p>Nobody can promise that. The fix kit covers what is in your hands: being readable, being described clearly, and being on the pages AI reads.</p></div></div></section>' +

    '<section class="band" id="questions"><h2>Questions</h2><div class="faq">' + FAQ().map((f) => '<details><summary>' + esc(f[0]) + '</summary><p>' + esc(f[1]) + (f[0].startsWith('I use Webflow') ? ' <a href="/">See AI SEO Deck</a>.' : '') + '</p></details>').join('') + '</div></section>' +

    '<section class="last"><h2>See your answers</h2><p class="sub">It takes about a minute, and the first thing you read is what AI told your customer today.</p>' + goForm('url-last', 'Read my answers') + '</section>' +
    '</div>';
  return body;
}
const LANDING_NAV = '<a class="hide-s" href="' + PATH + '/sample">Sample report</a><a class="hide-s" href="#price">Price</a><a class="hide-s" href="#questions">Questions</a><a class="btn sm mark" href="#url-top">Check my website</a>';

function landing() {
  const hero = heroState();
  const price = priceLabel();
  const body = landingBody();
  const ld = [
    { '@context': 'https://schema.org', '@type': 'Organization', '@id': 'https://silitlabs.com/#organization', name: 'Silit Labs', url: 'https://silitlabs.com', email: 'info@silitlabs.com' },
    { '@context': 'https://schema.org', '@type': 'WebApplication', name: 'AI Visibility Report', url: appUrl() + PATH, applicationCategory: 'BusinessApplication', operatingSystem: 'Any', description: 'Shows what ChatGPT, Google AI and Gemini answer when customers ask about what a business sells, and what to fix.', publisher: { '@id': 'https://silitlabs.com/#organization' },
      offers: [{ '@type': 'Offer', name: 'Free check', price: '0', priceCurrency: 'USD' }, { '@type': 'Offer', name: 'Full report', price: (core.price() / 100).toFixed(2), priceCurrency: 'USD' }] },
    { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: FAQ().map((f) => ({ '@type': 'Question', name: f[0], acceptedAnswer: { '@type': 'Answer', text: f[1] } })) }
  ];
  return shell({
    title: 'AI Visibility Report: see what ChatGPT tells your customers about you',
    ogTitle: 'Read what AI tells your customers about you',
    description: 'Type your website. We ask ChatGPT, Google AI and Gemini the question your customers ask, show the answers word for word and mark where you are named. Free check, full report ' + price + ' once.',
    canonical: appUrl() + PATH, index: true,
    nav: LANDING_NAV,
    head: ld.map((x) => '<script type="application/ld+json">' + safeJson(x) + '</script>').join(''),
    body, boot: { page: 'landing', hero }
  });
}

function checkPage(state, o) {
  o = o || {};
  const s = state.site || {};
  const titles = { draft: 'Is this you? ' + s.host, asking: 'Asking the AI engines about ' + s.brand, preview: 'What AI told your customers about ' + s.brand, building: 'Building the report for ' + s.brand, report: 'AI visibility report for ' + s.brand, closed: 'Report closed' };
  return shell({
    title: (titles[state.stage] || 'AI Visibility Report') + ' | AI Visibility Report', description: 'An AI visibility check for ' + (s.host || 'a website') + '.', index: false, nonce: o.nonce,
    nav: '<a class="hide-s" href="' + PATH + '/sample">Sample report</a><a href="' + PATH + '">New check</a>',
    body: '<div class="wrap" id="app" data-stage="' + esc(state.stage) + '">' + V.app(state) + '</div>', boot: { page: 'check', state }
  });
}

function samplePage() {
  if (!SAMPLE || !SAMPLE.report) return errorPage('The sample is not ready', 'Run a free check instead. It takes about a minute.');
  return shell({
    title: 'Sample AI visibility report: a made-up hotel in Lisbon', description: 'A complete AI visibility report for a made-up hotel: every answer from six AI engines, the pages they read, and the fix kit.', canonical: appUrl() + PATH + '/sample', index: true,
    nav: '<a class="btn sm mark" href="' + PATH + '">Check my website</a>',
    before: '<div class="sample-bar"><div class="wrap">This is a sample. Casa Aldora, the other hotels and the publications in it are made up. <a href="' + PATH + '">Run the free check on your own site</a></div></div>',
    body: '<div class="wrap" id="app" data-stage="report">' + V.app(SAMPLE.report) + '</div>', boot: { page: 'sample', state: SAMPLE.report, still: true }
  });
}

function errorPage(title, text, status) {
  return shell({
    title: title + ' | AI Visibility Report', description: '', index: false, nav: '<a href="' + PATH + '">New check</a>',
    body: '<div class="wrap"><section class="err"><h1>' + esc(title) + '</h1><p class="sub">' + esc(text) + '</p><a class="btn mark" href="' + PATH + '">Check a website</a></section></div>', boot: { page: 'error' }
  });
}

module.exports = { landing, landingBody, checkPage, samplePage, errorPage, shell, safeJson, top, FOOT, LANDING_NAV, PATH, CSS, VIEW_SRC, CLIENT_SRC, FONTS, LOGO, heroState, sample: () => SAMPLE };
