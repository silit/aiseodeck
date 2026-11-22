# AI SEO Deck

Webflow app by Silit Labs. "Every AI. One deck." Keyword by keyword, every week, it checks whether six AI engines (ChatGPT, Google AI Overviews, Google AI Mode, Gemini, Claude, Grok) name and cite a brand. Each keyword is asked as two customer questions on the chat engines and as the search itself on Google AI Overviews and AI Mode (10 answers a check). Perplexity is kept in the code for a later release and stays off until `PERPLEXITY_ENABLED=1`. For each keyword it shows yes, sometimes or no, the answers, the rivals named instead and a fix plan (best page, title and description, FAQ schema, CMS drafts, a new page draft when no page fits) applied to Webflow in one click. Related keywords come from the AI's own searches and DataForSEO Labs (keywords where Google's AI Overviews already cite the site, related searches, monthly volumes).

Live address (planned): https://aiseodeck.silitlabs.com

## How it works

- `api/index.js`: one serverless entry point (pages, OAuth, fixes, cron). `vercel.json` rewrites every app path to it.
- `api/_lib/engines.js`: ChatGPT (OpenAI Responses API + web_search), Google AI Overviews and AI Mode (DataForSEO SERP API), Gemini (Google Search grounding), Claude (Messages API + web search tool), Grok (xAI Responses API + web_search), and Perplexity for later (Sonar, switching by itself to the Agent API, which needs paid credits; off until `PERPLEXITY_ENABLED=1`). An engine is on when its key is set. Free plan: the first three of ChatGPT, AI Overviews, Perplexity and Gemini that are on, so ChatGPT, AI Overviews and Gemini today; the others show as locked columns.
- `api/_lib/analyze.js`: brand and rival detection in answers (case, accents, dashes and Turkish letters ignored), citations, share of voice, score (50% named, 30% cited, 20% place).
- `api/_lib/insights.js`: "Where rivals win" gaps and "How AI describes you" (sentiment, words, claims worth checking; one small LLM call per run).
- `api/_lib/keywords.js`: keyword cleaning, matching a keyword to the best page, DataForSEO Labs (volumes, related searches, keywords cited in AI Overviews).
- `api/_lib/jobs.js`: runs are queues of `keyword question x engine` tasks in Redis; a run covers all keywords (weekly) or some (a keyword checked on demand, keywords just added). The cron tick and the open site page both work through them; each engine has its own parallel limit; failed calls are retried up to 3 times.
- `api/_lib/audit.js` + `fetcher.js`: reads live pages, robots.txt, llms.txt, sitemap.xml (only the site's own hosts, private addresses refused).
- `api/_lib/fixes.js` + `llm.js`: suggestions (questions, meta, FAQ answers), schema building and merging, llms.txt.
- `api/_lib/billing.js` + `polar.js`: Polar subscriptions. Only Polar products named "AI SEO Deck ..." (or with metadata `app=aiseodeck`) are used. Free trial: every checkout of an account that never had a trial or a subscription gets `trial_interval: day`, `trial_interval_count: TRIAL_DAYS` (default 7, 0 turns it off); the others get `allow_trial: false`. Back from checkout, `/app/billing/return` reads the checkout and its subscription so the plan is on before the webhook arrives.
- Trial flow: home page "Start free trial" -> `/auth?plan=solo&interval=monthly` -> Webflow -> `/app/start` (today $0, first charge date) -> Polar checkout -> `/app/billing/return` -> site setup.
- `test/app.js`: end-to-end test with mock Webflow, Redis, AI engines, Resend and Polar. Run `npm test`.

## Plans

| Plan | Price | Sites | Keywords | Checks |
|---|---|---|---|---|
| Free | $0 | 1 | 3 | monthly, 3 engines (ChatGPT, AI Overviews, Gemini), no Apply to Webflow |
| Solo | $19/mo, $190/yr | 1 | 10 | weekly, all 6 engines, Apply, 10 keyword checks on demand a month |
| Studio | $49/mo, $490/yr | 5 | 30 | as Solo with 30 checks on demand, client report links with agency name |
| Agency | $149/mo, $1490/yr | 20 | 100 | as Studio with 100 checks on demand |

New keywords get a first check right away, up to the plan's number of keywords in new keywords a month.

Every paid plan starts with a 7-day free trial (card taken by Polar, charged on day 8 unless cancelled; one trial per account, and Polar's "Prevent trial abuse" also blocks a second trial with the same email or card). A Solo trial costs at most about $4 in AI calls.

Rough AI cost per answer (Nov 2026 list prices): ChatGPT about 1.1 to 2 cents (web search $10 per 1,000 calls), AI Overviews 0.4 and AI Mode 0.4 (DataForSEO live), Gemini about 0.2 within the 5,000 free grounded prompts a month and about 3 after ($14 per 1,000 search queries), Claude about 1.2 to 3 (web search $10 per 1,000), Grok about 2.5 to 4 (web search $5 per 1,000 calls plus tokens). One keyword check (10 answers) is about 18 cents (11 to 25), so about $0.78 a keyword a month with weekly checks. Worst case per month (every keyword, every check on demand and every new keyword check used): Solo about $11, Studio about $34, Agency about $114. DataForSEO Labs lookups cost 1.2 cents plus 0.012 cents per keyword. `MAX_DAILY_CALLS` (default 1500, at most about $22 a day) stops all checks for the day once reached; work continues the next day.

## AI Visibility Report (one-time report, no Webflow)

A second way in, for any website: `/ai-visibility-report`. The visitor types a website, gets a free check (the searches their customers make with how often each is made, and one of them on ChatGPT, Google AI Overviews and Gemini, the answers shown word for word with marks and margin notes), and can buy the full report once ($29 by default): the five searches made most often on all six engines, each chat engine asked twice (about 50 answers), where the most searches end in an answer without the business, who gets named instead, the pages the engines read, what AI says about the business by name, what a crawler sees, a fix kit with text and code to paste, and a re-check after 30 days. No account: the long random id in `/check/{id}` is the key to a check, and check pages are kept out of search.

- `api/_lib/vr/core.js`: the pipeline. Read the site, work out the business and ten searches its customers make (each with the question a customer would put to a chat engine), look up how often each is made on Google in the customers' country (`keywords.js`, about 1.3 cents a lookup) and keep the most searched ones. Google gets the search, chat engines get the question. Without keyword data the report still works and shows no numbers. Then ask the engines (same queue idea as `jobs.js`) and take five closing steps: open the pages the engines read, audit the site, judge the by-name answers, write the drafts, compose the report. Every write to a check goes through `update(id, fn)`.
- `api/_lib/vr/state.js`: what the browser may see at each stage. Nothing of the paid report leaves the server before payment.
- `api/_lib/vr/pay.js`: one-time Polar checkout, `order.paid` and `order.refunded` webhooks (they arrive at `api/billing-webhook.mjs`, which passes `order.*` events on), and the unlock key.
- `api/_lib/vr/view.js`, `css.js`, `client.js`, `pages.js`: one renderer used on the server and in the browser, the styles, the browser code and the pages. `sample.json` is the public sample (a made-up hotel), made by `node scripts/vr-sample.js`.
- `api/_lib/vr/http.js`: the addresses. `GET /ai-visibility-report`, `/ai-visibility-report/sample`, `/check/{id}`, `/check/{id}/state`; `POST /check/start`, `/check/{id}/run|pump|unlock|confirm|email|recheck`.
- Cron: `/cron/vr` every 5 minutes works open checks and starts re-checks that are due. `/cron/vrstats?days=30` (cron secret) returns the funnel per day: `start`, `again`, `asked`, `preview`, `checkout`, `paid`, `opened_by_key`, `report_built`, `recheck_built`. Numbers only, nothing about a visitor.
- Cost: about 1.8 cents an answer, so about $1 a report and $1 a re-check. The free check costs about 5 cents and is limited per visitor and per day (`VR_FREE_PER_IP`, `VR_FREE_PER_DAY`); everything also counts toward `MAX_DAILY_CALLS`. Starting a check looks up its search numbers once (about 1.3 cents), capped by `VR_LOOKUPS_PER_DAY`.
- `test/vr.js` + `test/vr-fixture.js`: the whole flow against mock engines, Polar and Redis. `node scripts/vr-preview.js <file>` builds a click-through preview from the sample.

Rapor ürününü satışa açmak için (sırayla): 1) Polar'da tek seferlik bir ürün aç, adı "AI Visibility Report", fiyat $29. 2) Polar webhook'unda `order.paid` ve `order.refunded` olaylarını da işaretle (adres aynı). 3) Vercel'e `POLAR_REPORT_PRODUCT_ID` ekle (ürün adı aynen böyleyse gerekmez), kendi denemelerin için `VR_UNLOCK_KEY` ekle. Ürün yokken sayfa çalışır, ücretsiz kontrol yapılır, satın alma yerine "yakında" der ve e-posta toplar.

İade yok (sayfalarda ve şartlarda yazıyor). Bir rapor kurulamadıysa: aynı site için yeni kontrol başlat, `/check/{id}?key=...` ile aç, bağlantıyı müşteriye gönder. Polar satıştan sonraki 60 gün içinde itirazı önlemek için kendi kararıyla iade edebilir; o zaman `order.refunded` gelir ve rapor kendiliğinden kapanır.

## Kurulum (Batuhan için, sırayla)

1. **Vercel**: Add New > Project > `silit/aiseodeck` reposunu içe aktar. Framework: Other. Deploy et.
2. **Veritabanı**: Vercel projesinde Storage > Upstash Redis (Create). Değişkenler projeye otomatik eklenir. Veritabanı başka bir uygulamayla paylaşılıyorsa `KV_PREFIX=asd:` ekleyin; anahtarlar hiç karışmaz.
3. **Alan adı**: Vercel > Settings > Domains > `aiseodeck.silitlabs.com` ekle. GoDaddy DNS'e Vercel'in gösterdiği CNAME kaydını gir (`cname.vercel-dns.com`).
4. **Webflow uygulaması**: Webflow > Silit Labs workspace > Apps & Integrations > Develop > Create an App.
   - Name: AI SEO Deck, homepage: https://aiseodeck.silitlabs.com
   - Data Client (REST API) aç. Redirect URI: `https://aiseodeck.silitlabs.com/callback`
   - Scopes: Authorized user read; Sites read; Pages read and write; CMS read and write
   - Client ID ve Client Secret'ı Vercel'e gir (bana gönderme).
5. **AI anahtarları** (ödeme ve şartları sen onaylarsın, her birinde bütçe limiti koy):
   - OpenAI (platform.openai.com), Google AI Studio (Gemini, ödeme hesabı bağlı olmalı), Anthropic (console.anthropic.com), xAI (console.x.ai)
   - Perplexity şimdilik kapalı. Açmak için ücretli API kredisi gerekiyor (kayıt kredisi Agent API'de geçmiyor), sonra `PERPLEXITY_API_KEY` ve `PERPLEXITY_ENABLED=1`.
   - DataForSEO (app.dataforseo.com, en az $50 yükleme): API login ve API password (Google AI Overviews ve AI Mode için)
6. **Polar**: Silit Labs organizasyonunda ürünler:
   - "AI SEO Deck Solo" aylık $19, "AI SEO Deck Solo Yearly" yıllık $190
   - "AI SEO Deck Studio" aylık $49, "AI SEO Deck Studio Yearly" yıllık $490
   - "AI SEO Deck Agency" aylık $149, "AI SEO Deck Agency Yearly" yıllık $1490
   - Yeni bir Organization Access Token (products:read, checkouts:read, checkouts:write, subscriptions:read, subscriptions:write, customer_sessions:write)
   - Webhook: `https://aiseodeck.silitlabs.com/billing/webhook`, API version 2026-10, olaylar: subscription.*
   - Settings > Subscriptions > "Prevent trial abuse" açık (14 Kasım 2026'da açıldı). Ürünlere deneme süresi girmeye gerek yok, deneme her checkout'ta koddan veriliyor.
7. **Zamanlayıcı**: Vercel Pro'da `vercel.json` içindeki cron her 5 dakikada `/cron/tick` çağırır ve `CRON_SECRET` değerini kendisi `Authorization: Bearer` olarak gönderir. Hobby planda bunun yerine cron-job.org kullanın: her 5 dakikada `https://aiseodeck.silitlabs.com/cron/tick`, header `x-cron-secret: <CRON_SECRET>`.
8. Vercel ortam değişkenlerini girip yeniden deploy et (listesi `.env.example` dosyasında).

Not: Vercel Hobby ticari kullanıma kapalı; ücretli plan satmaya başlamadan önce Pro'ya geçmek gerekir.

## Designer'daki panel (Designer Extension)

`extension/` klasöründe: `webflow.json` ve `public/` (index.html, app.js, app.css; framework yok). Panel açık sayfayı, o sayfanın kelimesini, her AI motorunu ve düzeltilecekleri gösterir; başlık ve açıklamayı Designer API ile sayfaya yazar, FAQ şemasını sunucu yazar (`/ext/*`). Kimlik: `webflow.getIdToken()` ile gelen ID token, sunucuda sitenin kayıtlı tokenı ile `POST /beta/token/resolve` ile çözülür.

Paketlemek: `cd extension && npx @webflow/webflow-cli extension bundle` (bundle.zip, git'e girmez). Yüklemek: Workspace settings > Apps & Integrations > Develop > AI SEO Deck > Publish extension version (workspace admin ve iki adımlı doğrulama açık olmalı; uygulamada Designer Extension yapı taşı açık olmalı). Denemek: Designer > Apps > AI SEO Deck > Launch App.

## Environment variables

See `.env.example`.

## When a paid service fails

Customers never see a provider's own error message. A failed answer reads "This engine could not answer right now" (or busy, or too slow), keyword data reads "not available right now", and writing falls back from OpenAI to Gemini to Anthropic. When a service refuses our account (the credit ran out or a key stopped working), `ALERT_EMAIL` (default info@silitlabs.com) gets an email naming the service and where to top it up, at most once every 6 hours per service.
