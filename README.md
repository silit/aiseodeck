# AI SEO Deck

Webflow app by Silit Labs. "Every AI. One deck." Keyword by keyword, it checks whether six AI engines (ChatGPT, Google AI Overviews, Google AI Mode, Gemini, Claude, Grok) name and cite a brand. Each keyword is asked as two customer questions on the chat engines and as the search itself on Google AI Overviews and AI Mode (10 answers a check). For each keyword it shows yes, sometimes or no, the answers, the rivals named instead and a fix plan (the best page, a title and description, CMS drafts, a new page draft when no page fits). Site health reads the pages of the site through the Webflow Data API and lists what to fix. Fixes reach Webflow only when the user presses Apply, as unpublished changes. Related keywords come from the AI's own searches and DataForSEO Labs. Perplexity is kept in the code for a later release and stays off until `PERPLEXITY_ENABLED=1`.

Address: https://aiseodeck.silitlabs.com

The app is a Hybrid App on Webflow: a Data Client (OAuth, this server) and a Designer Extension (the panel in `extension/`).

## Rules this build keeps (Webflow Marketplace)

These came out of the review of 23 November 2026. `REVIEW.md` holds the notes for the reviewers, `docs/marketplace-resubmission.md` the findings, the rules and the plan, `docs/listing.md` the listing text. The tests check each rule.

- Site data comes from the Webflow Data API only, with the scopes the user granted. The app never requests a customer's published website.
- No feature uses a beta endpoint. The one call outside `/v2` is `POST /beta/token/resolve`, which resolves the ID token of the Designer panel.
- No screen asks for a website address. The addresses of a site come from `GET /v2/sites/{site_id}`.
- The Install URL is `/auth`. It mints a one-time `state` for each request, kept on the server as a hash, tied to the browser and valid for ten minutes. `/callback` checks and uses up the state before the code is exchanged.
- The app never calls `/oauth/revoke_authorization`. Disconnect deletes what the app keeps and leaves the authorization alone. Access ends when the user uninstalls in Webflow.
- A 401 from Webflow is never retried. It is settled with one call to `GET /v2/token/authorized_by`; refused there too, the token is forgotten and the sites of that authorization are deleted. Every stored token is asked about once every 20 hours (`/cron/tokens`), so an uninstall is noticed within a day.
- Nothing is written to Webflow on a schedule. The user sees the current value next to the new one and presses Apply. The app never publishes a site.
- The panel answers only its own origin, confirms every call with a fresh Webflow ID token, and gives every caller it cannot confirm the same answer.
- The panel is styled with Webflow's CSS variables for apps (default dark theme as the fallback), drops an answer that arrives for a page the user has left, and finishes an Apply on the page it was pressed for.
- The server writes to the primary locale only. The panel sets the title and description on the page as the Designer shows it, and says so on a site with more than one language.
- An account with no Webflow authorization left and no paid plan is deleted 30 days after its last authorization ended.
- Logs pass through `api/_lib/log.js`, which takes out email addresses and anything long enough to be a token.

## How it works

- `api/index.js`: one serverless entry point (pages, OAuth, fixes, the panel's routes, cron). `vercel.json` rewrites every app path to it.
- `api/_lib/webflow.js`: the Webflow Data API client. Every call to Webflow goes through it. It waits as long as `Retry-After` says on a 429 and keeps the `X-RateLimit-Remaining` Webflow reports.
- `api/_lib/health.js` and `pagetext.js`: Site health. The page list with SEO and Open Graph settings (`GET /v2/sites/{id}/pages`) and the text, headings and images of static pages (`GET /v2/pages/{id}/dom`). It runs when the user asks, stops short of Webflow's rate limit and continues on request.
- `api/_lib/engines.js`: ChatGPT (OpenAI Responses API with web search), Google AI Overviews and AI Mode (DataForSEO SERP API), Gemini (Google Search grounding), Claude (Messages API with the web search tool), Grok (xAI Responses API with web search). An engine is on when its key is set. Free plan: ChatGPT, AI Overviews and Gemini; the others show as locked columns.
- `api/_lib/analyze.js`: brand and rival detection in answers (case, accents, dashes and Turkish letters ignored), citations, share of voice, score (50% named, 30% cited, 20% place).
- `api/_lib/insights.js`: "Where rivals win" and "How AI describes you" (one small LLM call per run).
- `api/_lib/keywords.js`: keyword cleaning, matching a keyword to the best page, DataForSEO Labs (volumes, related searches, keywords cited in AI Overviews).
- `api/_lib/jobs.js`: a check is a queue of `keyword question x engine` tasks in Redis. The cron tick and the open site page both work through it; each engine has its own parallel limit; failed calls are retried up to 3 times. It also holds what happens when Webflow no longer accepts a token.
- `api/_lib/fixes.js` and `llm.js`: the suggestions (questions, title and description, answers, page drafts), written by an LLM from what the Webflow API returned for the page.
- `api/_lib/store.js`, `kv.js` and `crypto.js`: the records in Upstash Redis. Access tokens are encrypted with AES-256-GCM.
- `api/_lib/billing.js`, `polar.js` and `api/billing-webhook.mjs`: Polar subscriptions. Only Polar products named "AI SEO Deck ..." (or with metadata `app=aiseodeck`) are used. Free trial: every checkout of an account that never had a trial or a subscription gets `trial_interval: day`, `trial_interval_count: TRIAL_DAYS` (default 7, 0 turns it off); the others get `allow_trial: false`.
- `api/_lib/html.js`: every page of the app. `public/`: the home page, the guide (`docs.html`), the privacy policy and the terms.
- `extension/`: the Designer panel (`webflow.json` and `public/` with `index.html`, `app.css`, `app.js` and `fonts/`, which holds Inter for Latin text under the Open Font License; no framework, no build step).

## Tests

`npm test` runs all three:

- `node test/app.js`: the whole app against stand-ins for Webflow, the database, the AI engines, mail and billing (`test/mocks.js`). A stand-in for the customer's published website must receive no request, and the Webflow endpoints called during the run must be exactly the ones `REVIEW.md` lists.
- `node test/panel.js`: the panel in Chromium (Playwright), served from the extension's address under a strict Content Security Policy, against the real server code. It is skipped with a message when Playwright is not installed.
- `node test/contrast.js`: every page of the web app and the public pages in Chromium, in the light and the dark theme, on the free plan and on a paid one. It measures the contrast of every text against what is behind it (4.5 to 1, or 3 to 1 for large text) and of the focus ring the Tab key shows (3 to 1). Also skipped without Playwright.

## Plans

| Plan | Price (US dollars) | Sites | Keywords | Checks |
|---|---|---|---|---|
| Free | USD 0 | 1 | 3 | monthly on 3 engines (ChatGPT, AI Overviews, Gemini), no Apply to Webflow, Site health for 20 pages |
| Solo | USD 19 a month, USD 190 a year | 1 | 10 | weekly on all 6 engines, Apply, 10 keyword checks on demand a month, Site health for 100 pages |
| Studio | USD 49 a month, USD 490 a year | 5 | 30 | as Solo with 30 checks on demand, agency name on client report links, Site health for 150 pages |
| Agency | USD 149 a month, USD 1,490 a year | 20 | 100 | as Studio with 100 checks on demand, Site health for 250 pages |

Keywords are a pool shared by all sites of an account. New keywords get a first check right away, up to the plan's number of keywords in new keywords a month. An account with an `@webflow.com` email gets the Agency plan with no checkout (the review team). So does an account that enters the access code (`COMPLIMENTARY_CODE`) on its Account page, for a reviewing account on another address.

Every paid plan starts with a 7-day free trial (card taken by Polar, charged on day 8 unless cancelled; one trial per account, and Polar's "Prevent trial abuse" also blocks a second trial with the same email or card). A Solo trial costs at most about $4 in AI calls.

Rough AI cost per answer (Nov 2026 list prices): ChatGPT about 1.1 to 2 cents (web search $10 per 1,000 calls), AI Overviews 0.4 and AI Mode 0.4 (DataForSEO live), Gemini about 0.2 within the 5,000 free grounded prompts a month and about 3 after ($14 per 1,000 search queries), Claude about 1.2 to 3 (web search $10 per 1,000), Grok about 2.5 to 4 (web search $5 per 1,000 calls plus tokens). One keyword check (10 answers) is about 18 cents (11 to 25), so about $0.78 a keyword a month with weekly checks. Worst case per month (every keyword, every check on demand and every new keyword check used): Solo about $11, Studio about $34, Agency about $114. DataForSEO Labs lookups cost 1.2 cents plus 0.012 cents per keyword. `MAX_DAILY_CALLS` (default 1500, at most about $22 a day) stops all checks for the day once reached; work continues the next day.

## Kurulum (Batuhan için, sırayla)

1. **Vercel**: Add New > Project > `silit/aiseodeck` reposunu içe aktar. Framework: Other. Deploy et.
2. **Veritabanı**: Vercel projesinde Storage > Upstash Redis (Create). Değişkenler projeye otomatik eklenir. Veritabanı başka bir uygulamayla paylaşılıyorsa `KV_PREFIX=asd:` ekle; anahtarlar hiç karışmaz.
3. **Alan adı**: Vercel > Settings > Domains > `aiseodeck.silitlabs.com` ekle. GoDaddy DNS'e Vercel'in gösterdiği CNAME kaydını gir (`cname.vercel-dns.com`).
4. **Webflow uygulaması**: Webflow > Silit Labs workspace > Apps & Integrations > Develop > Create an App.
   - Name: AI SEO Deck, homepage: https://aiseodeck.silitlabs.com
   - Data Client (REST API) aç. Redirect URI: `https://aiseodeck.silitlabs.com/callback`
   - Install URL: `https://aiseodeck.silitlabs.com/auth`. Uygulama ayarlarında bu adres için bir alan yok (24 Kasım 2026'da bakıldı); adres Marketplace başvuru formuna yazılır. Oraya asla `webflow.com/oauth/authorize...` adresi yazılmaz: her kurulum `/auth` üzerinden başlar, çünkü tek kullanımlık `state` değerini orası üretir.
   - Scopes: Authorized user read; Sites read; Pages read and write; CMS read and write
   - Designer Extension yapı taşını aç. Ayarlarda görünen "Designer Extension URI" bu uygulama için `https://6af730d2ef364c450fd995ce.webflow-ext.com` (içindeki kimlik uygulamanın kendi kimliği, Client ID değil). Panel sunucuyu yalnızca bu adresten çağırabilir; adres kodda yazılı (`PANEL_ORIGIN`, `api/_lib/webflow.js`). Uygulama Webflow'da yeniden oluşturulursa adres değişir: o zaman koddaki değer güncellenir.
   - Client ID ve Client Secret'ı Vercel'e gir (bana gönderme).
5. **AI anahtarları** (ödeme ve şartları sen onaylarsın, her birinde bütçe limiti koy):
   - OpenAI (platform.openai.com), Google AI Studio (Gemini, ödeme hesabı bağlı olmalı), Anthropic (console.anthropic.com), xAI (console.x.ai)
   - Perplexity şimdilik kapalı. Açmak için ücretli API kredisi gerekiyor (kayıt kredisi Agent API'de geçmiyor), sonra `PERPLEXITY_API_KEY` ve `PERPLEXITY_ENABLED=1`.
   - DataForSEO (app.dataforseo.com, en az $50 yükleme): API login ve API password (Google AI Overviews ve AI Mode için)
6. **Polar**: Silit Labs organizasyonunda ürünler (hepsi USD):
   - "AI SEO Deck Solo" aylık $19, "AI SEO Deck Solo Yearly" yıllık $190
   - "AI SEO Deck Studio" aylık $49, "AI SEO Deck Studio Yearly" yıllık $490
   - "AI SEO Deck Agency" aylık $149, "AI SEO Deck Agency Yearly" yıllık $1490
   - Yeni bir Organization Access Token (products:read, checkouts:read, checkouts:write, subscriptions:read, subscriptions:write, customer_sessions:write)
   - Webhook: `https://aiseodeck.silitlabs.com/billing/webhook`, API version 2026-10, olaylar: subscription.*
   - Settings > Subscriptions > "Prevent trial abuse" açık (14 Kasım 2026'da açıldı). Ürünlere deneme süresi girmeye gerek yok, deneme her checkout'ta koddan veriliyor.
7. **Zamanlayıcı**: Vercel Pro'da `vercel.json` içindeki iki cron işi kendiliğinden çalışır ve `CRON_SECRET` değerini `Authorization: Bearer` olarak gönderir: `/cron/tick` her 5 dakikada (kontroller), `/cron/tokens` saatte bir (Webflow'da kaldırılan uygulamayı fark etmek için). Hobby planda bunların yerine cron-job.org kullan: aynı iki adres, header `x-cron-secret: <CRON_SECRET>`.
8. Vercel ortam değişkenlerini girip yeniden deploy et (listesi `.env.example` dosyasında).
9. **İnceleme ekibi için erişim kodu** (isteğe bağlı ama önerilir): Vercel'de `COMPLIMENTARY_CODE` adıyla uzun ve rastgele bir değer gir (en az 16 karakter, bir şifre üreticisinden). `@webflow.com` adresli hesaplar Agency planını zaten kendiliğinden alır; bu kod, inceleyen hesabın adresi farklıysa aynı erişimi açar (Account > Plan > Access code). Aynı değeri başvuru formundaki "App access credentials" alanına yaz. Değeri bana gönderme.

Not: Vercel Hobby ticari kullanıma kapalı; ücretli plan satmaya başlamadan önce Pro'ya geçmek gerekir.

## Designer'daki panel (Designer Extension)

`extension/` klasöründe: `webflow.json` ve `public/` (index.html, app.js, app.css ve Inter yazı tipinin durduğu `fonts/` klasörü; framework yok, derleme adımı yok). Panel Webflow'un uygulamalar için yayımladığı renk ve yazı değişkenlerini kullanır, yani Designer'ın kendi görünümüne uyar. Panel açık sayfayı, o sayfanın kelimesini, her AI motorunu ve düzeltilecekleri gösterir. Başlık ve açıklamayı, kullanıcı "Apply to this page" düğmesine basınca, Designer API ile sayfaya yazar; başka hiçbir şey yazmaz. Sunucuda üç adresi çağırır: `/ext/context`, `/ext/suggest`, `/ext/applied`. Kimlik: her çağrı için `webflow.getIdToken()` ile alınan ID token, sunucuda sitenin kayıtlı tokenı ile `POST /beta/token/resolve` üzerinden çözülür.

Paketlemek: `cd extension && npx @webflow/webflow-cli extension bundle` (bundle.zip, git'e girmez). Review ZIP'i: `node scripts/package-extension.js` (bundle.zip içindeki yedi dosyanın kaynakla bayt bayt aynı olduğunu doğrular, README ile birlikte `extension/review.zip` dosyasını yazar ve SHA-256 değerlerini basar). Yüklemek: Workspace settings > Apps & Integrations > Develop > AI SEO Deck > Publish extension version (workspace admin ve iki adımlı doğrulama açık olmalı; uygulamada Designer Extension yapı taşı açık olmalı). Denemek: Designer > Apps > AI SEO Deck > Launch App.

## Environment variables

See `.env.example`.

## When a paid service fails

Customers never see a provider's own error message. A failed answer reads "This engine could not answer right now" (or busy, or too slow), keyword data reads "not available right now", and writing falls back from OpenAI to Gemini to Anthropic. When a service refuses our account (the credit ran out or a key stopped working), `ALERT_EMAIL` (default info@silitlabs.com) gets an email naming the service and where to top it up, at most once every 6 hours per service.

What counts as a refusal is decided in `api/_lib/alerts.js` (`kindOf`). For the services that answer with plain HTTP numbers it is 401, 402, 403 or words about credit, billing or the key. DataForSEO answers with five-digit codes of its own, and there the code decides: only 40100, 40104, 40200, 40201, 40203, 40204, 40207 and 40210 are about our account. The others pass and raise no alarm. An answer from Google AI Overviews or AI Mode that failed with one of the passing codes is asked again, up to three times in all: 40101 ("Internal SE Server Error": Google did not answer DataForSEO), 40103, 40107, 40202, 40209 and everything from 50000 up (`DFS_AGAIN` in `api/_lib/engines.js`). 40102 ("No Search Results") is not an error: the search is saved as "no AI answer". Until 24 November 2026 every code from 40100 to 40399 was read as a refusal, so one 40101 cost a check its answer and sent the owner an alarm about an account that was fine.
