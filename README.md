# AI SEO Deck

Webflow app by Silit Labs. "Every AI. One deck." Keyword by keyword, every week, it checks whether seven AI engines (ChatGPT, Google AI Overviews, Google AI Mode, Gemini, Perplexity, Claude, Grok) name and cite a brand. Each keyword is asked as two customer questions on the chat engines and as the search itself on Google AI Overviews and AI Mode (12 answers a check). For each keyword it shows yes, sometimes or no, the answers, the rivals named instead and a fix plan (best page, title and description, FAQ schema, CMS drafts, a new page draft when no page fits) applied to Webflow in one click. Related keywords come from the AI's own searches and DataForSEO Labs (keywords where Google's AI Overviews already cite the site, related searches, monthly volumes).

Live address (planned): https://aiseodeck.silitlabs.com

## How it works

- `api/index.js`: one serverless entry point (pages, OAuth, fixes, cron). `vercel.json` rewrites every app path to it.
- `api/_lib/engines.js`: ChatGPT (OpenAI Responses API + web_search), Google AI Overviews and AI Mode (DataForSEO SERP API), Gemini (Google Search grounding), Perplexity (Sonar, switching by itself to the Agent API that replaces it), Claude (Messages API + web search tool), Grok (xAI Responses API + web_search). An engine is on when its key is set. Free plan: ChatGPT, AI Overviews, Perplexity; the others show as locked columns.
- `api/_lib/analyze.js`: brand and rival detection in answers (case, accents, dashes and Turkish letters ignored), citations, share of voice, score (50% named, 30% cited, 20% place).
- `api/_lib/insights.js`: "Where rivals win" gaps and "How AI describes you" (sentiment, words, claims worth checking; one small LLM call per run).
- `api/_lib/keywords.js`: keyword cleaning, matching a keyword to the best page, DataForSEO Labs (volumes, related searches, keywords cited in AI Overviews).
- `api/_lib/jobs.js`: runs are queues of `keyword question x engine` tasks in Redis; a run covers all keywords (weekly) or some (a keyword checked on demand, keywords just added). The cron tick and the open site page both work through them; each engine has its own parallel limit; failed calls are retried up to 3 times.
- `api/_lib/audit.js` + `fetcher.js`: reads live pages, robots.txt, llms.txt, sitemap.xml (only the site's own hosts, private addresses refused).
- `api/_lib/fixes.js` + `llm.js`: suggestions (questions, meta, FAQ answers), schema building and merging, llms.txt.
- `api/_lib/billing.js` + `polar.js`: Polar subscriptions. Only Polar products named "AI SEO Deck ..." (or with metadata `app=aiseodeck`) are used.
- `test/app.js`: end-to-end test with mock Webflow, Redis, AI engines, Resend and Polar. Run `npm test`.

## Plans

| Plan | Price | Sites | Keywords | Checks |
|---|---|---|---|---|
| Free | $0 | 1 | 3 | monthly, 3 engines (ChatGPT, AI Overviews, Perplexity), no Apply to Webflow |
| Solo | $19/mo, $190/yr | 1 | 10 | weekly, all 7 engines, Apply, 10 keyword checks on demand a month |
| Studio | $49/mo, $490/yr | 5 | 30 | as Solo with 30 checks on demand, client report links with agency name |
| Agency | $149/mo, $1490/yr | 20 | 100 | as Studio with 100 checks on demand |

New keywords get a first check right away, up to the plan's number of keywords in new keywords a month.

Rough AI cost per answer (Nov 2026 list prices): ChatGPT about 1.1 to 2 cents (web search $10 per 1,000 calls), AI Overviews 0.4 and AI Mode 0.4 (DataForSEO live), Gemini about 0.2 within the 5,000 free grounded prompts a month and about 3 after ($14 per 1,000 search queries), Perplexity about 0.5 to 0.8, Claude about 1.2 to 3 (web search $10 per 1,000), Grok about 2.5 to 4 (web search $5 per 1,000 calls plus tokens). One keyword check (12 answers) is about 19 cents (12 to 26), so about $0.82 a keyword a month with weekly checks. Worst case per month (every keyword, every check on demand and every new keyword check used): Solo about $12, Studio about $36, Agency about $120. DataForSEO Labs lookups cost 1.2 cents plus 0.012 cents per keyword. `MAX_DAILY_CALLS` (default 1500, at most about $22 a day) stops all checks for the day once reached; work continues the next day.

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
   - "AI SEO Deck Solo" aylık $19, "AI SEO Deck Solo Yearly" yıllık $190
   - "AI SEO Deck Studio" aylık $49, "AI SEO Deck Studio Yearly" yıllık $490
   - "AI SEO Deck Agency" aylık $149, "AI SEO Deck Agency Yearly" yıllık $1490
   - Yeni bir Organization Access Token (products:read, checkouts:write, subscriptions:read, subscriptions:write, customer_sessions:write)
   - Webhook: `https://aiseodeck.silitlabs.com/billing/webhook`, API version 2026-10, olaylar: subscription.*
7. **Zamanlayıcı**: Vercel Pro'da `vercel.json` içindeki cron her 5 dakikada `/cron/tick` çağırır ve `CRON_SECRET` değerini kendisi `Authorization: Bearer` olarak gönderir. Hobby planda bunun yerine cron-job.org kullanın: her 5 dakikada `https://aiseodeck.silitlabs.com/cron/tick`, header `x-cron-secret: <CRON_SECRET>`.
8. Vercel ortam değişkenlerini girip yeniden deploy et (listesi `.env.example` dosyasında).

Not: Vercel Hobby ticari kullanıma kapalı; ücretli plan satmaya başlamadan önce Pro'ya geçmek gerekir.

## Environment variables

See `.env.example`.
