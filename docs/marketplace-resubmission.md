# Webflow Marketplace: the rejection of 23 November 2026 and the way to an approval

Working notes for the resubmission of AI SEO Deck. Everything here was read on 23 November 2026: the review email (ticket #1221544, in the info@silitlabs.com mailbox), the Marketplace Guidelines, the submission requirements and the API reference. Read the sources again before resubmitting: Webflow says the guidelines and the form changed recently.

The owner's instruction: the next submission has to be approved. Every item below is done in full, tested, and checked against the rule it answers before the form is sent.

## 1. What the review said

Outcome: rejected. Functional review did not start: the findings come from the listing description, our review notes, the scope justification, the Designer Extension source and the public documentation. "Further findings may arise when it can proceed." "This feedback is not exhaustive."

| # | Finding | The rule, in the reviewer's words |
| --- | --- | --- |
| 1 | The site audit reads the published site outside the Webflow API. Quoted against us: the listing ("A site audit of your published pages ... plus llms.txt, your sitemap and whether robots.txt blocks AI crawlers"), the docs ("The audit reads your published pages, robots.txt, llms.txt and sitemap.xml from your live domain"), the privacy policy ("reads your public website for an audit", sends "text from your public pages" to AI providers), the review notes ("The audit fetches only the connected site's own domains") and the Designer Extension ("It reads your published pages and lists the fixes for each one"). | "Access Webflow data exclusively through official Webflow APIs". "For a Webflow-connected site, site content must come through the Data API only, under the scopes the user granted. That includes the audit. The listing, documentation and privacy policy must describe the final implementation." Sources named: Data access; Developer Terms, "No Bulk Copy or Scraping"; Acceptable Use Policy 1(a) "Unauthorized Automated Access". |
| 2 | The app depends on beta endpoints: `GET /beta/pages/:page_id/schema-markup`, `POST /beta/sites/:site_id/pages/schema-markup/query`, `PUT /beta/pages/:page_id/schema-markup`. The audit reads JSON-LD through the first two; FAQ, Organization and WebSite schema are written through the third. | "Marketplace Apps must not depend on beta API endpoints. Every submitted feature must use the stable Data API or Designer API. The listing and documentation must describe the final implementation." |
| 3 | Setup asks users to enter their domains ("Enter your brand name as people say it, other names, your domains, your market and up to five rivals."). | "A connected site's domains must come from the Webflow API after authorization. The app must not ask users to type a website address." |
| 4 | The listing description does not meet the requirements: it does not say what a user needs before starting or what setup asks for; it does not reference the documentation by name; the sentence on token encryption belongs in the review notes; prices use "$" with no currency named; "Yearly plans include two months free" names no yearly price. | "A listing description is what a site owner reads before deciding to install. It tells them, in their own words, what the app does and the main benefit, what its features do for them, what they need in place first, what it costs, and where the documentation is. Every statement in it must be true of the build submitted, because review checks the listing against the code." |
| 5 | The documentation does not cover the whole app: nothing on the Designer Extension (the listing has an "Inside the Designer" section), and no Webflow plan stated (the website says "Works on every Webflow plan."). | "Provide comprehensive and user-friendly documentation or help resources to assist users in understanding and utilizing your App effectively." |

Before resubmitting (the notification email of the same evening):

- App Review Preflight: install it into the Workspace, run it in the Designer on the exact bundle and review ZIP, paste the receipt code (`wfpre_...`) into the form. `ready` or `needs_review` is accepted, `changes_required` blocks.
- Developer toolkit: AI skills for coding agents that check an app against the review requirements. Read on 23 November (the owner sent the archive, packaged 2026-10-27, source commit 248ba55). What it adds is in section 2b.
- The form asks for: a published `.webflow.io` testing site with the app installed and every feature available; one review ZIP (source maps, package.json and lockfile of the exact build, or, for an app that ships its source unchanged, the source files plus a short README); the Preflight receipt.
- "Do not resubmit until all findings are addressed and the complete app is tested end to end."

Did our work outside the app cause any of this? No. `public/docs.html`, `public/privacy.html` and `public/terms.html` are unchanged since the submission of 16 November (`git diff d543220 origin/main -- public`), and all five findings are about the app as submitted. The report (AI Visibility Report) is still moved out of this repository and project before resubmitting: reviewers do read the submitted website, and a tool there that asks visitors to type a website address and reads published sites is the opposite of what findings 1 and 3 ask of this app.

## 2. What else reviewers check

A general checklist of what a review looks at beyond the findings above, in our own words.

1. Reviewer access through the submitted install URL: after authorizing, no checkout and no card. The review account has the highest plan and never expires.
2. The Webflow entry point uses the authorized site. The website does not send visitors to a "type your URL" flow. For each feature: which Webflow endpoint supplies its input, and what is not available for Webflow sites.
3. Publishing stays under the user's direct control: nothing is written or published on a timer; the user reviews and approves each specific change before it is written. Website, listing and guide say the same thing.
4. What happens to content the app wrote when a subscription or trial ends, on disconnect and on uninstall, and what the app keeps and for how long.
5. Localization: the locale parameter of every read, create, update and delete, and what happens to secondary locales.
6. A dedicated Webflow setup and lifecycle guide (install, connect, use, disconnect, uninstall in Webflow, removing content), named in the listing and easy to find from the website.
7. Data and authorization disclosures agree with each other: which Webflow data is read, what is stored, what goes to AI providers, how to delete it. How pending work stops when a revocation is found (token introspection, a 401) and how disconnect works when one authorization covers several sites.
8. Publisher branding: the authorization screen shows the Workspace name and icon. They must match the listing.
9. Pricing: every plan's price with its currency and billing interval, what is paid when a trial ends, when it renews, free plan and paid trial told apart, any third-party account that is required.

## 2b. The developer toolkit (read 23 November 2026)

Two skills, `webflow-app-preflight` and `webflow-app-review-remediation`, with checklists and an OAuth reference. They are developer aids, not review decisions. What they add to the email and the guidelines, and what we did about it:

1. OAuth `state` is a pass or fail gate for Data Client and Hybrid apps (ruling of 2026-09-17).
   - The Install URL is an endpoint we own that mints a fresh, single-use, random `state` for each request, keeps it on the server tied to the browser session with an expiry, and only then redirects to `webflow.com/oauth/authorize`. A fixed authorize URL must never be submitted as the Install URL.
   - The callback verifies and consumes the `state` in one operation before the code exchange and rejects a missing, mismatched, expired, used or out-of-session value. "Review also exercises the live flow from your listing's Install URL."
   - The Install button under Apps & Integrations, App Development, in our own Workspace sends no `state`. It is a developer shortcut outside the customer path. Do not accept code-only callbacks to keep it working.
   - Our callback accepted a code with no `state`, and our review notes said so. Fixed: `/auth` and `/callback` in `api/index.js`, `saveOauthState` and `takeOauthState` in `api/_lib/store.js`. The Install URL to submit is `https://aiseodeck.silitlabs.com/auth`.
2. Disconnect does not revoke. "Disconnect ends that account link only. Do not call `POST /oauth/revoke_authorization` from it: users remove Webflow access by uninstalling. After Disconnect, the user must be able to connect again without redoing Webflow OAuth."
   - We called `revoke_authorization` from Disconnect, from account deletion and when a new authorization replaced an older one. Fixed: the app calls it nowhere. Disconnect deletes what we keep about the sites and leaves the authorization; the Sites page connects a site again from `GET /v2/sites`.
3. Revocation. "A persistent 401 on a previously valid token is revocation. Stop calling; do not retry past it." 429 and passing 5xx are the opposite case. There is no uninstall webhook. Uninstall should delete or anonymize what our backend stores.
   - Ours: a 401 is settled with one call to `GET /v2/token/authorized_by`; refused there too, the token is forgotten and the sites are deleted at once (`jobs.accessRemoved`). Every stored token is asked about once every 20 hours (`jobs.checkConnections`, started by the hourly job `/cron/tokens` and by a quiet tick), so an uninstall is noticed within a day. An answer other than 401 removes nothing; that token is asked about again an hour later.
4. Backend endpoints are verified by calling them. Identity is resolved on the server from the Webflow ID token (`webflow.getIdToken()`, valid about 15 minutes, "fetch it just in time rather than persisting it"). Never authorize on a client-supplied id. Object-level authorization with a non-enumerating failure. CORS is defence in depth, not authorization.
   - Ours: `/ext/*` answered "not connected" and "token not valid" differently. Fixed: one answer for every caller that cannot be confirmed. The panel asks for an ID token for every call.
   - This settles the open question on `POST /beta/token/resolve`: it is the only way to resolve the ID token the toolkit tells us to resolve, so it stays. The review notes name it as the one beta path, used for identity and for no feature. (The toolkit itself notes that generally available scopes can have endpoints under `/beta/`.)
5. Preflight (ruleset 1.7.0) labels findings Blocker, Required update, Manual review or Suggested update, and a run `ready`, `changes_required` or `needs_review`. `needs_review` is not a pass. Blockers include inline event handlers and `javascript:` URLs, dynamic code, remote script tags, top-frame navigation, secrets and tokens in URLs. Required updates include keyboard shortcut bindings, `message` handlers without an origin check, `http://` request destinations, localhost with a port or a path, and source maps inside the bundle. A bare `http://` literal goes to Manual review.
   - Ours: the bundle has no `http://` text at all now (the SVG namespace is read from an element of `index.html`), no handlers in markup, no `message` handler, no shortcuts, no timers. `extension/webflow.json` carries no telemetry block: check again after bundling, and bundle with a CLI newer than 2.3.0.
6. Review ZIP for an extension that ships its source unchanged: the source files exactly as they ship (byte for byte) plus a short README on how the bundle is packaged. Keep it to those files.
7. Other gates: two-factor authentication on an admin account of the submitting Workspace (ask the owner); backend live through the whole review; Terms and Privacy on separate addresses; production logs without personal data (the "email skipped" log line named the recipient: fixed); Webflow-side data the platform does not remove (titles, descriptions, CMS drafts) needs removal instructions; the user is told to publish after an apply.
8. Listing assets: logomark at 900x900 (the guidelines page says 512x512 for the avatar: make it at 900 so it scales down), publisher logo 20x20 from the Workspace, 3 to 5 screenshots at 1280x846, demo video of 2 to 5 minutes from install to use with OAuth approved and denied. No pricing field: prices go in the description, the review notes and the video.
9. The resubmission packet, per finding: the finding and its disposition in one sentence, the files changed, the test commands and results, the artifact checksum, the runtime evidence, what is still open. Keep source verified, artifact verified, installed, runtime observed, submitted and accepted apart. End with READY TO RESUBMIT or NOT READY TO RESUBMIT.

How access is removed in Webflow (help article "Webflow Apps overview", read 23 November): a site authorization under Site settings, Apps & integrations, Revoke; a Workspace authorization under Workspace settings, Apps & integrations, Uninstall app; in the Designer, the Apps panel, the app, Remove app. An app authorized for a whole Workspace cannot be removed from one site only. Custom code an app added is removed at the next publish; elements stay. Check these words on the real screens in the end-to-end run.

## 3. The rules that bind this app (Marketplace Guidelines, read 23 November 2026)

Only the ones that ask something of us. Check the page again before submitting.

Authentication and permissions
- Least privilege: every scope is needed by a declared feature and used by a documented endpoint the app calls; scopes match the listing; read-only display asks `:read` only. Scopes in the install URL equal the app's configured scopes.
- `state` on every authorization request, verified before the code is exchanged. Redirect URI matches exactly. Codes are exchanged at once, never retried, stored or logged.
- Tokens: server side only, encrypted at rest, never in browser storage, logs or responses. After revocation: no more calls with that token, and it is deleted.
- OAuth runs once at install or on explicit re-authorization, not on login, session expiry or refresh. Signing out of the app does not revoke Webflow.

Technical
- Only official Webflow APIs: the Data API and the Designer API.
- Code on customer sites only through the Custom Code API. Never ask users to paste scripts. (We deliver no code to sites.)
- Designer Extension: no `eval`, `new Function`, string timers; no script tags added at runtime (`innerHTML`, `document.write`, `insertAdjacentHTML`); no untrusted data as raw HTML; read and change the site only through the Designer APIs; no inline event handlers or `javascript:` URLs; no obfuscation; no overriding of native functions; no keyboard shortcuts.

Network
- HTTPS everywhere; no staging, localhost or private addresses in the app.
- No secrets as string literals. Never forward `Authorization` or `Cookie` to non-Webflow domains.
- Every `message` handler checks `event.origin` against an allowlist.
- User-supplied URLs are validated against an allowlist before a server-side request. (After the rework the app requests no user-supplied URL at all.)
- CORS allows only origins we control. A wildcard is not permitted. (`/ext/*` sends `Access-Control-Allow-Origin: *` today: must change.)
- Endpoints that hold the token or act on a site verify identity with a session or signed token and never trust a client-supplied `siteId`. Reviewers probe live endpoints with hostile origins and forged identifiers.

Data access and integrity
- Webflow data only through official APIs. No bulk copy, scraping or bulk export of Webflow content to non-Webflow services.
- Rate limits: exponential backoff with a maximum number of retries.
- Sanitize API data before rendering, storing or forwarding.
- Every write and delete behind an authenticated, verified trigger; validate every input.
- Webflow stays the source of truth: no editable copies that drift. Show when Webflow data was last fetched and give a refresh. Keep AI suggestions and drafts visibly apart from live data. Tell external data apart from Webflow data.
- Localization: the intended `localeId` on every write to a locale-aware endpoint; never overwrite localized content with primary values unnoticed.

User interaction and design
- Every state-changing action traces to a direct user interaction, never on load or on a timer. Popups only after a user action.
- Documentation that covers the whole app. No placeholder content. Accessible UI. No ads.

Business
- All fees disclosed. Accurate contact details. One developer account.

Data Client apps
- Redirect URI: one fully qualified HTTPS URL on a production domain. Valid TLS on every domain. Dependencies scanned for known CVEs. Backend up during review.
- Three attestations: token encrypted at rest, stored server side only, deleted on uninstall or revocation.

Submission prep
- Complete, works end to end, the same app users get. Install URL works; approving works; a denied request is handled. Disconnect and reconnect work. Uninstalling removes everything the app added.
- Demo video for every submission: private link, 2 to 5 minutes, install, setup and core features, the OAuth approve and deny flow, and the Webflow integration described in detail. A new video is needed after the rework.
- Logo 900x900 PNG logomark. 3 to 5 screenshots at 1280x846 with alt text.
- Production bundle without source maps, uploaded through Apps and Integrations. Review ZIP in the form.
- Review can take 10 business days. Repeated submissions with unfixed or untested issues can pause new submissions.

Listing (Listing your App)
- App name up to 30 characters, publisher name up to 20, short description up to 100, long description up to 10,000 (Markdown, no links), up to 5 features, up to 5 categories.
- The long description holds: a 2 to 3 sentence overview, key features and their benefit, setup requirements (prerequisites, dependencies), usage examples, and a reference to the documentation. There is no documentation field: name the docs in the description and make them easy to find from the website.

## 4. What the stable API gives us (checked 23 November 2026)

| Need | Stable endpoint | Notes |
| --- | --- | --- |
| Site name, domains, locales, last publish | `GET /v2/sites/:site_id` (`sites:read`) | `customDomains[].url`, `shortName` (the webflow.io address), `locales.primary` and `.secondary` with `id`, `cmsLocaleId`, `tag`, `lastPublished`. |
| Page list, SEO title and description, Open Graph title and description | `GET /v2/sites/:site_id/pages`, `GET /v2/pages/:page_id` (`pages:read`) | To confirm on the reference page: exact field names and whether an Open Graph image is returned. |
| Page text, headings, images and their alt text | `GET /v2/pages/:page_id/dom` (`pages:read`) | Static pages. Nodes: `text` (`html`, `text`), `image` (`alt`, `assetId`), `component-instance`, form nodes. 100 nodes a call, paged. Text inside components needs the component endpoints. |
| Write SEO title and description | `PUT /v2/pages/:page_id` (`pages:write`) with `localeId` | Already used. |
| CMS collections and draft items | CMS endpoints (`cms:read`, `cms:write`) with `cmsLocaleId` | Already used. |
| Who authorized, is the token alive | `GET /v2/token/authorized_by`, `GET /v2/token/introspect` | A 401 means revoked. |
| JSON-LD schema of a page | none | Only `/beta/.../schema-markup` (changelog 18 May 2026, still beta). |
| robots.txt | none on normal plans | `.../enterprise/site-configuration/robots-txt`: Enterprise only. |
| llms.txt | none | Beta and Enterprise only. |
| Sitemap | none | |
| Designer Extension user identity | `POST /beta/token/resolve` | The only documented way to resolve `webflow.getIdToken()`; it exists only on the beta path. OPEN QUESTION, see section 6. |

## 5. What changes in the app

Stays
- Asking the AI engines, keyword by keyword, and everything built on the answers (who is named, citations, rivals, related keywords, search volumes, alerts, weekly reports). None of it reads Webflow sites.
- Title and description fixes: read through the Pages API, written with AI on request, applied only when the user presses Apply, with `localeId`, as an unpublished change.
- CMS drafts (answers, a new page for a keyword) as draft items.
- The Designer panel, for the page that is open: its keyword, the engines, title and description through the Designer API.

Changes
- Site health: rebuilt on the Pages API alone. Per static page: SEO title and description (missing, length), Open Graph title and description, H1 (missing, more than one), word count, images without alt text, and the site language from the locales. Shows when the data was read from Webflow and a Refresh button.
- Setup: the domains come from `GET /v2/sites/:site_id` and are shown, not typed. Rivals are names only. Brand and keyword suggestions are written from the page titles, descriptions and text the Pages API returns.
- Every other place that fetched the live site (language detection, source text for writing fixes, the panel's page read) uses the Pages API or, in the panel, the Designer API.
- `/ext/*` CORS: the extension's own origin only.

Goes (until Webflow offers a stable way)
- Everything on JSON-LD: the "no structured data", "invalid JSON-LD", "FAQ without schema" and "no Organization schema" findings, and writing FAQ, Organization and WebSite schema.
- The robots.txt, llms.txt, sitemap, HTTPS and "home page unreachable" findings.
- Audit of pages found only through the sitemap (CMS item pages).
- The live-site reader itself: `fetcher.js` leaves this repository with the report. A test fails if any app module requests a customer's website.

## 6. Open questions

1. DECIDED (23 Nov): `/beta/token/resolve` stays. The toolkit tells apps to resolve the Designer ID token on the server, and this endpoint is the only way to do it. The reviewer read our notes, which name it with its `/beta` path, and listed only the three schema endpoints. The review notes say plainly that it is the one beta path the app calls and that no feature reads or writes data through a beta endpoint. If a reviewer objects, the fallback is a session of our own handed to the panel after a click.
2. DECIDED: text and headings inside components are not resolved (no extra scope). A page whose text is partly inside components, or that is too long to read in full, shows "No H1" and "Thin content" as "not determined", and they take nothing off its score.
3. DECIDED: an image whose alt text is inherited from its asset counts as having one (`assets:read` is not requested). Only an image with an empty alt on the page is a finding; one marked decorative is not.
4. DECIDED: the Open Graph finding is about the title and description only.
5a. TO CHECK in the end-to-end run, on the real API: that `POST /beta/token/resolve` answers with `siteId` (the panel is confirmed only when it does and it is the same site); what `GET /v2/pages/:id/dom` returns for an image with no alt text and for a page it cannot serve; the real `publishedPath` of a Collection template; that Webflow sends `error=access_denied` to the callback when the user cancels; the panel's real origin.
   - Also to check there: the "Designer Extension URI" shown in the app's settings is `https://<client id>.webflow-ext.com` (the deployed version answered every origin, so the exact address was never tested against the real Designer); the two cron jobs appear in Vercel after the deploy (`/cron/tick`, `/cron/tokens`; Vercel calls its cron jobs "legacy" and offers Schedules, a public beta, instead: we stay on cron jobs, which work, until Schedules are out of beta).
5. CHECKED at Polar on 23 November: a monthly and a yearly product for Solo, Studio and Agency at the prices in `docs/listing.md` (USD 19 and 190, 49 and 490, 149 and 1,490); "Prevent trial abuse" is on, and it counts a trial of any product of the organization, so the texts now say one trial per customer across the products of Silit Labs; "Trial conversion reminder" is on. Vercel was checked the same evening: the project is on Pro, production is called by Vercel Cron with the `Authorization` header only (so the `?key=` option of the cron routes was removed), and the preview of this branch answers as the tests say (`/cron/*` 401, `/ext/*` 403 to a foreign origin, `/_vr/*` 404).

## 7. Order of work

1. This document.
2. Rework (sections 5 and 6), test by test.
3. Listing description, documentation (with the Designer panel and the Webflow plan), privacy policy, terms, review notes: rewritten against the finished build.
4. The report moves to its own repository and Vercel project.
5. End-to-end run on the published webflow.io test site: install, approve, deny, setup, first check, site health, write and apply a fix, the panel in the Designer, disconnect, reconnect, uninstall.
6. Developer toolkit checks, Preflight receipt, review ZIP, new demo video, screenshots, form. The owner presses submit.

## 8. Rework log and the next steps in the code

Branch `marketplace-rework`. Nothing of it is deployed yet. Run `npm test` after every step.

Done
- 23 Nov (commits 2369a37, 6ec825f): steps 1 to 5 below are done, and so are the toolkit items of section 2b. `npm test` runs `test/app.js` (320) and `test/panel.js` (45, the panel in Chromium under a strict Content Security Policy; needs Playwright, skips without it).
- 23 Nov: `/ext/*` answers only the panel's own origin (`https://<client id>.webflow-ext.com`, plus `EXT_ORIGINS`); any other origin, or none, gets 403 and one log line `[aiseodeck] panel: refused origin ...`. CHECK in the end-to-end run that the panel's real origin is the one assumed: if the panel shows no data, read that log line and set `EXT_ORIGINS`.
- 23 Nov: Webflow 429s back off 2, 4, 8 seconds and stop after three more tries (`MAX_RETRIES` in `api/_lib/webflow.js`).

- 23 Nov, evening: step 6 is done. The guide, the privacy policy, the terms, the home page, `llms.txt`, `REVIEW.md`, `README.md`, `.env.example`, `extension/README.md` and the listing text (`docs/listing.md`) describe this build. Prices name the currency everywhere (US$ in the app, USD in the texts). Tests check that the review notes and the README of the review ZIP name exactly the Designer API calls and routes the panel uses.
- 23 Nov, evening: what the texts promise was made strictly true in the code.
  - "An uninstall is noticed within a day": each token is asked about every 20 hours, by an hourly job of its own (`/cron/tokens`) as well as by a quiet tick; a pass that runs out of time is continued from the account it stopped at; an answer other than 401 (no answer, 5xx, 429) removes nothing and is asked again an hour later. The question to Webflow is one attempt of at most eight seconds, so a Webflow that is not answering cannot hold up a tick or the scheduled checks.
  - Client report links exist on every plan; the agency name on them is Studio and Agency. The guide said otherwise and was corrected, not the app.
  - The panel binds events with `addEventListener` under plain names (`click`, `submit`): no handler attribute name appears in the bundle. Every link is made by one function that lets it point only to the app's own address.
- 23 Nov, evening: `scripts/package-extension.js` checks `bundle.zip` (exactly the four files, the same bytes as the source, no source map, the manifest of the repository) and writes `extension/review.zip` from the files inside the bundle plus the README. A trial with Webflow CLI 2.16.0 gave a four-file bundle identical to the source; the CLI did not touch `webflow.json`.
- 23 Nov, night: what happens to the accounts that exist today when this version goes live. `test/fixtures/db-before-rework.json` is the database as the live version leaves it, made by running that version's own test; the test "an account made by the version before this one" loads it and walks through the app.
  - A Site health result that did not come from the Webflow API is treated as if the site had never been read (`store.getAudit`), and the score kept with the site goes with it (`normalizeSite`). No finding on llms.txt, robots.txt, the sitemap or schema is shown to anyone.
  - Suggestions the live version wrote from published pages are not shown (`store.getDraft`: drafts carry `v: 2` from now on). The user asks for new ones, written from what Webflow returns.
  - A site whose addresses were typed gets them from Webflow the first time one of its pages is opened (`handleSitePage`). Until Webflow has answered, the Settings page shows no address at all instead of the typed ones under "read from Webflow".
  - To remember at the deploy: the Designer Extension published in the app's settings is the old panel. It stops working with the new server until the new bundle is uploaded, so the bundle goes up in the same sitting as the deploy.
- `npm test`: `test/app.js` 377, `test/panel.js` 46.

Still to do, in this order: step 7 (the report leaves), the deploy, then the end-to-end run of section 7, the final bundle and review ZIP, Preflight, the video and screenshots.

The steps as they were planned (1 to 5 are done)
1. Domains and rivals (finding 3).
   - `store.js`: `domainsOf(meta)` = custom domains plus `<shortName>.webflow.io`; `newSite` and `refreshMeta` set `project.domains` from it and stamp `site.metaAt`.
   - `index.js`: `applyProjectFields` no longer reads `b.domains`; `parseRivals` keeps names only (text before a comma); new `POST /app/site/refresh` re-reads `GET /v2/sites/:id` and goes back to setup or settings; `handleSetupPage` refreshes from Webflow instead of fetching the home page, and takes the default keyword language from `site.locale.tag`.
   - `html.js`: in `setupPage` and `settingsTab` the domains are shown read-only with "Read from Webflow <time>" and a Refresh button; the rivals box asks for names only.
   - Tests: the setup posts in `test/app.js` send `domains` and `rivals: 'Name, domain'` (lines near 396 and 883); the mock Webflow site has to carry the custom domain instead.
2. Schema features out (finding 2): `getSchema`, `putSchema`, `querySchemas` and `beta()` in `webflow.js`; `proposedSchema`, `handleFixSchema`, the FAQ schema part of `handleFixFaq`, `extFaq`, the schema parts of `handleKeywordPlan` and `handleKeywordApply`, "Business details for structured data" in settings, `orgSchema`, `faqSchema`, `mergeSchema` in `fixes.js`, the panel's FAQ block in `extension/public/app.js`, and every schema finding in `audit.js`.
3. Site health on the Pages API (finding 1): a new module that takes the page list (`listPages`) and each static page's nodes (`GET /v2/pages/:id/dom`, paged by 100) and reports title, description, Open Graph title and description, H1 count, words, images without alt, language. Text inside components: resolve with the component endpoints (scope `components:read`) or report "not determined"; never a false "No H1" or "thin". Then replace the other live reads: `discoverFor` (ideas from the home page), `handleKeywordPlan` (source text), `extSuggest` (the panel), `handleFixSuggest`; `jobs.js` `runAudit`. Delete `fetcher.js` use from the app and add the test that fails if an app module requests a customer's site.
4. "Read from Webflow <time>" and Refresh on every view that shows Webflow data (site health, fix page, keyword plan, panel).
5. `/beta/token/resolve`: decide (section 6).
6. Texts: `public/docs.html`, `public/privacy.html`, `public/terms.html`, `public/index.html`, listing copy, `REVIEW.md` (it still says page writes name the primary locale: they do not, Webflow refuses a primary locale id and writes the primary locale when none is named, see commit b71d7d5), `README.md`.
7. The report leaves for its own repository and project.

