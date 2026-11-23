# AI Visibility Report

A product of Silit Labs, for any website, read at `https://silitlabs.com/ai-visibility-report`. The visitor types a website and gets a free check: the searches their customers make with how often each is made, and one of them on ChatGPT, Google AI Overviews and Gemini, the answers shown word for word with marks and margin notes. The full report is bought once ($29 by default): the five searches made most often on all six engines, each chat engine asked twice (about 50 answers), where the most searches end in an answer without the business, who gets named instead, the pages the engines read, what AI says about the business by name, what a crawler sees, a fix kit with text and code to paste, and a re-check after 30 days. No account: the long random id in `/check/{id}` is the key to a check, and check pages are kept out of search.

This repository is the report and nothing else. It was taken out of the repository of AI SEO Deck (the Webflow app of Silit Labs, `silit/aiseodeck`) on 23 November 2026, from that repository's commit `07d4f8a`, so that the two products run from two projects. The Webflow app is not part of this project: no Webflow client, no sign-in, no app pages.

## How it works

- `api/index.js`: the one serverless entry point. It answers the report's addresses, the cron job and nothing else.
- `api/_lib/vr/core.js`: the pipeline. Read the site, work out the business and ten searches its customers make (each with the question a customer would put to a chat engine), look up how often each is made on Google in the customers' country (`keywords.js`, about 1.3 cents a lookup) and keep the most searched ones. Google gets the search, chat engines get the question. Without keyword data the report still works and shows no numbers. Then ask the engines and take five closing steps: open the pages the engines read, audit the site, judge the by-name answers, write the drafts, compose the report. Every write to a check goes through `update(id, fn)`.
- Names in an answer are sorted by a model into three kinds (`extractNamed`): a rival (someone the customer could choose instead), a directory (a listing or review site), or other (a maker, supplier, association or regulator such providers only use or belong to). Other is left out, or an implant brand tops the rival list of every clinic. The pages the engines read get a kind too (`hostKind`, `sortPages`): another business's own website is set apart (`theirs`) and is not counted as a page the business is missing from.
- `api/_lib/vr/state.js`: what the browser may see at each stage. Nothing of the paid report leaves the server before payment.
- `api/_lib/vr/pay.js`: the one-time Polar checkout, the `order.paid` and `order.refunded` webhooks (they arrive at `api/billing-webhook.mjs`) and the unlock key.
- `api/_lib/vr/view.js`, `css.js`, `client.js`, `pages.js`: one renderer used on the server and in the browser, the styles, the browser code and the pages. `sample.json` is the public sample (a made-up hotel), made by `node scripts/vr-sample.js`.
- `api/_lib/vr/http.js`: the addresses. `GET /ai-visibility-report`, `/ai-visibility-report/sample`, `/check/{id}`, `/check/{id}/state`; `POST /check/start`, `/check/{id}/run|pump|unlock|confirm|email|recheck`.
- `api/_lib/vr/where.js`: the report's own address (`VR_URL`, default `https://silitlabs.com`) and the address of AI SEO Deck, which the pages link to (`AISEODECK_URL`). Every link the report prints, emails or gives to the checkout uses the first.
- `api/_lib/*.js`: what the pipeline uses. `fetcher.js` and `audit.js` read a website (only its own hosts, private addresses refused), `engines.js` asks the AI engines, `analyze.js` and `insights.js` read the answers, `llm.js` and `fixes.js` write, `keywords.js` gets search numbers, `kv.js` and `store.js` keep the records, `email.js` and `alerts.js` send mail, `polar.js` checks the signature of a webhook. They came over as they were, apart from the names in log lines and in mail; parts of `store.js`, `plans.js`, `billing.js` and `polar.js` serve only AI SEO Deck's plans and are not used here.

## Where it is served

The report lives at silitlabs.com, not at this project's own address. The Vercel project of the site (`silit/site`, `vercel.json`) rewrites `/ai-visibility-report`, `/ai-visibility-report/...` and `/check/...` to `/_vr/...` on this project, and this project's `vercel.json` answers `/_vr/...` with the function. This project's own addresses (`/`, `/ai-visibility-report`, `/check/...`) redirect to the site. The visitor's IP address arrives in `x-forwarded-for` through the rewrite, so the limits per visitor work. Vercel waits up to 120 seconds for a proxied answer; the function's limit is 60. The Terms and Privacy text of the report are on silitlabs.com (`/terms/`, `/privacy/`), and so is the picture a shared link shows (`public/images/og/ai-visibility-report.jpg` in the site's repository).

- Cron: `/cron/vr` every 5 minutes works open checks and starts re-checks that are due. `/cron/vrstats?days=30` returns the funnel per day: `start`, `again`, `asked`, `preview`, `checkout`, `paid`, `opened_by_key`, `report_built`, `recheck_built`. Numbers only, nothing about a visitor. Both need the cron secret in a header (`Authorization: Bearer <CRON_SECRET>`, as Vercel Cron sends it, or `x-cron-secret`); it is never taken from the address.
- The database is the Upstash Redis that AI SEO Deck uses, with the same `KV_PREFIX`: the checks made before the move are there (keys `vr:*`), and so is the count for `MAX_DAILY_CALLS`, which the two products share.
- Cost: about 1.8 cents an answer, so about $1 a report and $1 a re-check. The free check costs about 5 cents and is limited per visitor and per day (`VR_FREE_PER_IP`, `VR_FREE_PER_DAY`); everything also counts toward `MAX_DAILY_CALLS`. Starting a check looks up its search numbers once (about 1.3 cents), capped by `VR_LOOKUPS_PER_DAY`. The searches that lookup missed are asked of Google Ads in one more request when a check starts (`keywords.adsVolumes`): 9 cents whatever the number of keywords, up to about 7 seconds. It has its own cap, `VR_ADS_LOOKUPS_PER_DAY` (default 40 a day, at most $3.60; 0 turns it off), and never stops a check.

## Tests

`npm test` (`node test/vr.js`, with `test/vr-fixture.js`): the whole flow against stand-ins for the AI engines, Polar and Redis. Nothing leaves the process. `node scripts/vr-preview.js <file>` builds a click-through preview from the sample.

## Kurulum (Batuhan için, sırayla)

Bu proje çalışmaya başlamadan AI SEO Deck'in yeni sürümü canlıya alınmaz: o sürümde rapor yok.

1. **Vercel projesi**: Add New > Project > `silit/ai-visibility-report` reposunu içe aktar. Framework: Other. Proje adı `ai-visibility-report`. Değişkenler olmadan da ilk deploy tamamlanır.
2. **Veritabanı**: AI SEO Deck'in kullandığı Upstash Redis'i bu projeye de bağla: Vercel > Storage > o veritabanı > Projects > Connect Project > `ai-visibility-report`. `KV_REST_API_URL` ve `KV_REST_API_TOKEN` kendiliğinden eklenir. AI SEO Deck projesinde `KV_PREFIX` varsa aynı değeri buraya da gir; yoksa girme. Değer farklı olursa eski kontrol bağlantıları açılmaz.
3. **Ortam değişkenleri** (Settings > Environment Variables; listesi `.env.example` dosyasında). AI SEO Deck projesindeki değerlerin aynısı: `OPENAI_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `XAI_API_KEY`, `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`, `RESEND_API_KEY`, `POLAR_ACCESS_TOKEN`, varsa `MAX_DAILY_CALLS`, `ALERT_EMAIL`, `VR_UNLOCK_KEY` ve model adları. Bu projeye özel, yeni, uzun ve rastgele iki değer: `REPORT_SECRET` ve `CRON_SECRET`. AI SEO Deck'in `SESSION_SECRET` ve `WEBFLOW_*` değerleri buraya girilmez: bu proje onları kullanmaz ve görmemeli. Değerleri bana gönderme; ben görmem ve girmem.
4. **Polar webhook'u** (Polar > Settings > Webhooks > Add Endpoint): adres `https://<bu projenin adresi>/billing/webhook`, format Raw, olaylar `order.paid` ve `order.refunded`. Polar'ın verdiği secret'ı bu projede `POLAR_WEBHOOK_SECRET` olarak gir. AI SEO Deck'in webhook'u olduğu gibi kalır (abonelik olayları).
5. Değişkenlerden sonra yeniden deploy et. Kontrol: `https://<bu projenin adresi>/health` "ok" yazar; `https://<bu projenin adresi>/_vr/ai-visibility-report` sayfayı gösterir.
6. **Site**: `silit/site` reposundaki `vercel.json` içinde üç rewrite'ın hedefi `https://aiseodeck.silitlabs.com/_vr/...` yerine `https://<bu projenin adresi>/_vr/...` olur. Bundan sonra silitlabs.com/ai-visibility-report bu projeden gelir.
7. Ancak bundan sonra AI SEO Deck'in yeni sürümü canlıya alınır.

## Bakım notları

- Polar'da tek seferlik "AI Visibility Report" ürünü var, fiyat $29. Ürün adı aynen böyle kaldıkça `POLAR_REPORT_PRODUCT_ID` gerekmez. Ürün arşivlenirse sayfa çalışmaya devam eder, satın alma yerine "yakında" der ve e-posta toplar.
- Kendi denemelerin için `VR_UNLOCK_KEY` (12+ karakter): `https://silitlabs.com/check/{id}?key=...` raporu ödemesiz açar.
- Ücretsiz kontrol aynı ağdan günde 4 kez yapılabilir (`VR_FREE_PER_IP`; koddaki varsayılan `FREE_PER_IP`, `api/_lib/vr/core.js`).
- Raporun sayfaları Search Console'da `https://silitlabs.com/` mülkünde izlenir (silitlabs.com site haritasında).
- Ödeme webhook'suz da çalışır: alıcı ödeme sonrası sayfaya dönünce rapor Polar'dan okunup açılır. Webhook, sayfaya dönmeyen alıcı ve iade için vardır.
- Taşıma sırasında açık kalmış bir ödeme sayfası olursa (imza eski projenin değeriyle atılmıştır), alıcı sayfaya dönünce rapor hemen açılmaz; Polar'ın `order.paid` webhook'u gelince açılır. Webhook kurulmamışsa `VR_UNLOCK_KEY` ile aç.

Geri ödeme yok (sayfalarda ve şartlarda yazıyor). Bir rapor kurulamadıysa: aynı site için yeni kontrol başlat, `https://silitlabs.com/check/{id}?key=...` ile aç, bağlantıyı müşteriye gönder. Polar satıştan sonraki 60 gün içinde itirazı önlemek için kendi kararıyla ödemeyi geri verebilir; o zaman `order.refunded` gelir ve rapor kendiliğinden kapanır.

23 Kasım 2026'da ilk gerçek ücretli rapor (bir diş kliniği sitesi) dört hata gösterdi, aynı gün düzeltildi: tedarikçi markaları rakip sayılıyordu; başka işletmelerin kendi siteleri "eklenmeniz gereken sayfa" sayılıyordu; "sitende bu aramaya sayfa yok" cümlesi kontrol edilmeden yazılıyordu (artık okunan sayfalara bakıyor); arama sayısı bulunamayan adaylar eleniyordu (artık Google Ads'e bir kez soruluyor). Bu tarihten önce kurulan raporlarda rakip listesi marka içerebilir.

Canlıda bir sorun ararken: Vercel > Logs'ta `[vr]` ara. Her başlatılan kontrol tek satır yazar: `[vr] start <site>: read ... ms, understand ... ms (N searches), volumes ... ms (known, Google Ads gave X of Y more)`.

## When a paid service fails

Visitors never see a provider's own error message. When a service refuses our account (the credit ran out or a key stopped working), `ALERT_EMAIL` (default info@silitlabs.com) gets an email naming the service and where to top it up, at most once every 6 hours per service.
