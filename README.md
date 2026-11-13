# AI SEO Deck

Webflow app by Silit Labs. "Every AI. One deck." Every week it asks seven AI engines (ChatGPT, Google AI Overviews, Google AI Mode, Gemini, Perplexity, Claude, Grok) the questions a site's customers ask, records whether the brand is named, where it ranks among its rivals and whether the site is cited, shows how the AI describes the brand and where rivals win, then audits the site for AI search and applies fixes (titles, descriptions, JSON-LD schema, FAQ drafts) to Webflow.

Live address (planned): https://aiseodeck.silitlabs.com

## How it works

- `api/index.js`: one serverless entry point (pages, OAuth, fixes, cron). `vercel.json` rewrites every app path to it.
- `api/_lib/engines.js`: ChatGPT (OpenAI Responses API + web_search), Google AI Overviews and AI Mode (DataForSEO SERP API), Gemini (Google Search grounding), Perplexity (Sonar, switching by itself to the Agent API that replaces it), Claude (Messages API + web search tool), Grok (xAI Responses API + web_search). An engine is on when its key is set. Free plan: ChatGPT, AI Overviews, Perplexity; the others show as locked columns.
- `api/_lib/analyze.js`: brand and rival detection in answers (case, accents, dashes and Turkish letters ignored), citations, share of voice, score (50% named, 30% cited, 20% place).
- `api/_lib/insights.js`: "Where rivals win" gaps and "How AI describes you" (sentiment, words, claims worth checking; one small LLM call per run).
- `api/_lib/jobs.js`: runs are queues of `question x engine` tasks in Redis. The cron tick and the open site page both work through them; each engine has its own parallel limit; failed calls are retried up to 3 times.
- `api/_lib/audit.js` + `fetcher.js`: reads live pages, robots.txt, llms.txt, sitemap.xml (only the site's own hosts, private addresses refused).
- `api/_lib/fixes.js` + `llm.js`: suggestions (questions, meta, FAQ answers), schema building and merging, llms.txt.
- `api/_lib/billing.js` + `polar.js`: Polar subscriptions. Only Polar products named "AI SEO Deck ..." (or with metadata `app=aiseodeck`) are used.
- `test/app.js`: end-to-end test with mock Webflow, Redis, AI engines, Resend and Polar. Run `npm test`.

## Plans

| Plan | Price | Sites | Questions | Checks |
|---|---|---|---|---|
| Free | $0 | 1 | 5 | monthly, 3 engines (ChatGPT, AI Overviews, Perplexity), no Apply to Webflow |
| Solo | $29/mo, $290/yr | 1 | 25 | weekly, all 7 engines, Apply, 2 checks on demand a month |
| Studio | $79/mo, $790/yr | 5 | 75 | as Solo + client report links with agency name |
| Agency | $199/mo, $1990/yr | 20 | 200 | as Studio |

Rough AI cost per answer (Nov 2026 list prices), averaged over the 7 engines, is 1.1 to 1.5 cents: ChatGPT about 1.1 to 2 (web search $10 per 1,000 calls), AI Overviews 0.4 and AI Mode 0.4 (DataForSEO live), Gemini about 0.2 within the 5,000 free grounded prompts a month and about 3 after ($14 per 1,000 search queries), Perplexity about 0.5 to 0.8, Claude about 1.2 to 3 (web search $10 per 1,000), Grok about 2.5 to 4 (web search $5 per 1,000 calls plus tokens). Worst case per month (4.33 weekly checks + 2 on demand, every question, 1.5 cents): Solo about $17, Studio about $50, Agency about $133. `MAX_DAILY_CALLS` (default 1500, at most about $22 a day) stops all checks for the day once reached; work continues the next day.

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
   - OpenAI (platform.openai.com), Perplexity (perplexity.ai > API), Google AI Studio (Gemini), Anthropic (console.anthropic.com), xAI (console.x.ai)
   - DataForSEO (app.dataforseo.com, en az $50 yükleme): API login ve API password (Google AI Overviews ve AI Mode için)
6. **Polar**: Silit Labs organizasyonunda ürünler:
   - "AI SEO Deck Solo" aylık $29, "AI SEO Deck Solo Yearly" yıllık $290
   - "AI SEO Deck Studio" aylık $79, "AI SEO Deck Studio Yearly" yıllık $790
   - "AI SEO Deck Agency" aylık $199, "AI SEO Deck Agency Yearly" yıllık $1990
   - Yeni bir Organization Access Token (products:read, checkouts:write, subscriptions:read, subscriptions:write, customer_sessions:write)
   - Webhook: `https://aiseodeck.silitlabs.com/billing/webhook`, API version 2026-10, olaylar: subscription.*
7. **Zamanlayıcı**: Vercel Pro'da `vercel.json` içindeki cron her 5 dakikada `/cron/tick` çağırır ve `CRON_SECRET` değerini kendisi `Authorization: Bearer` olarak gönderir. Hobby planda bunun yerine cron-job.org kullanın: her 5 dakikada `https://aiseodeck.silitlabs.com/cron/tick`, header `x-cron-secret: <CRON_SECRET>`.
8. Vercel ortam değişkenlerini girip yeniden deploy et (listesi `.env.example` dosyasında).

Not: Vercel Hobby ticari kullanıma kapalı; ücretli plan satmaya başlamadan önce Pro'ya geçmek gerekir.

## Environment variables

See `.env.example`.
