# AI SEO Deck

Webflow app by Silit Labs. Every week it asks ChatGPT, Perplexity and Gemini the questions a site's customers ask, records whether the brand is named, where it ranks among its rivals and whether the site is cited, then audits the site for AI search and applies fixes (titles, descriptions, JSON-LD schema, FAQ drafts) to Webflow.

Live address (planned): https://aiseodeck.silitlabs.com

## How it works

- `api/index.js`: one serverless entry point (pages, OAuth, fixes, cron). `vercel.json` rewrites every app path to it.
- `api/_lib/engines.js`: ChatGPT (OpenAI Responses API + web_search), Perplexity (Sonar), Gemini (Google Search grounding), optional Claude. An engine is on when its API key is set.
- `api/_lib/analyze.js`: brand and rival detection in answers (case, accents, dashes and Turkish letters ignored), citations, share of voice, score.
- `api/_lib/jobs.js`: runs are queues of `question x engine` tasks in Redis. The cron tick and the open site page both work through them; each engine has its own parallel limit; failed calls are retried up to 3 times.
- `api/_lib/audit.js` + `fetcher.js`: reads live pages, robots.txt, llms.txt, sitemap.xml (only the site's own hosts, private addresses refused).
- `api/_lib/fixes.js` + `llm.js`: suggestions (questions, meta, FAQ answers), schema building and merging, llms.txt.
- `api/_lib/billing.js` + `polar.js`: Polar subscriptions. Only Polar products named "AI SEO Deck ..." (or with metadata `app=aiseodeck`) are used.
- `test/app.js`: end-to-end test with mock Webflow, Redis, AI engines, Resend and Polar. Run `npm test`.

## Plans

| Plan | Price | Sites | Questions | Checks |
|---|---|---|---|---|
| Free | $0 | 1 | 5 | monthly, ChatGPT only, no Apply to Webflow |
| Solo | $29/mo, $290/yr | 1 | 40 | weekly, all engines, Apply, 2 extra checks a month |
| Studio | $79/mo, $790/yr | 5 | 120 | as Solo + client report links with agency name |
| Agency | $199/mo, $1990/yr | 20 | 400 | as Studio |

Rough AI cost per answer is 1 to 2 cents (OpenAI web search $10 per 1,000 calls, Gemini grounding $14 per 1,000 searches after 5,000 free a month, Perplexity Sonar a few dollars per 1,000). `MAX_DAILY_CALLS` (default 4000) stops all checks for the day once reached; work continues the next day.

## Kurulum (Batuhan için, sırayla)

1. **Vercel**: Add New > Project > `silit/aiseodeck` reposunu içe aktar. Framework: Other. Deploy et.
2. **Veritabanı**: Vercel projesinde Storage > Upstash Redis (Create). Değişkenler projeye otomatik eklenir.
3. **Alan adı**: Vercel > Settings > Domains > `aiseodeck.silitlabs.com` ekle. GoDaddy DNS'e Vercel'in gösterdiği CNAME kaydını gir (`cname.vercel-dns.com`).
4. **Webflow uygulaması**: Webflow > Silit Labs workspace > Apps & Integrations > Develop > Create an App.
   - Name: AI SEO Deck, homepage: https://aiseodeck.silitlabs.com
   - Data Client (REST API) aç. Redirect URI: `https://aiseodeck.silitlabs.com/callback`
   - Scopes: Authorized user read; Sites read; Pages read and write; CMS read and write
   - Client ID ve Client Secret'ı Vercel'e gir (bana gönderme).
5. **AI anahtarları** (ödeme ve şartları sen onaylarsın): OpenAI (platform.openai.com), Perplexity (perplexity.ai > API), Google AI Studio (Gemini). Her birinde bütçe limiti koy.
6. **Polar**: Silit Labs organizasyonunda ürünler:
   - "AI SEO Deck Solo" aylık $29, "AI SEO Deck Solo Yearly" yıllık $290
   - "AI SEO Deck Studio" aylık $79, "AI SEO Deck Studio Yearly" yıllık $790
   - "AI SEO Deck Agency" aylık $199, "AI SEO Deck Agency Yearly" yıllık $1990
   - Yeni bir Organization Access Token (products:read, checkouts:write, subscriptions:read, subscriptions:write, customer_sessions:write)
   - Webhook: `https://aiseodeck.silitlabs.com/billing/webhook`, API version 2026-10, olaylar: subscription.*
7. **cron-job.org**: her 5 dakikada `https://aiseodeck.silitlabs.com/cron/tick`, header `x-cron-secret: <CRON_SECRET>`.
8. Vercel ortam değişkenlerini girip yeniden deploy et (listesi `.env.example` dosyasında).

Not: Vercel Hobby ticari kullanıma kapalı; ücretli plan satmaya başlamadan önce Pro'ya geçmek gerekir.

## Environment variables

See `.env.example`.
