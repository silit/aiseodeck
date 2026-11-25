# Webflow Marketplace: the rejection of 23 November 2026 and the way to an approval

**Resubmitted on 25 November 2026 at 10:49 (Europe/Istanbul).** Reference ID `c9a4039e-4b94-4ad1-81a1-10cc77f4c3a8`; Webflow's ticket for this submission is #1225904 (email of 10:51 to info@silitlabs.com: "No action required at the moment"). The review and its outcome come on that thread. What follows is the record of how the build got there; the end of the log and "Where it stands" say what is open.

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

How access is removed in Webflow (help article "Webflow Apps overview", read 23 November): a site authorization under Site settings, Apps & integrations, Revoke; a Workspace authorization under Workspace settings, Apps & integrations, Uninstall app; in the Designer, the Apps panel, the app, Remove app. An app authorized for a whole Workspace cannot be removed from one site only. Custom code an app added is removed at the next publish; elements stay. Check these words on the real screens in the end-to-end run. CHECKED on 24 November on the real screens, and they differ from the help article: for a site it is Site settings, Apps & Integrations, Connected Apps, **View details** next to the app, then **Uninstall App** (Webflow asks to confirm: "Uninstalling an App will revoke all authorizations") or **Remove access** for one authorization; the Workspace has the same under Apps & Integrations, Manage; the Designer's Apps panel has **Remove App**. The app, the guide and the tests now use these words.

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
   - CHECKED on 24 November in the app's settings: the "Designer Extension URI" is `https://6af730d2ef364c450fd995ce.webflow-ext.com`. It is not made from the client id, as the code had assumed (the deployed version answered every origin, so the address was never tested against the real Designer). The code now expects the real one. Still to check there: the panel shows its data in the real Designer; the two cron jobs appear in Vercel after the deploy (`/cron/tick`, `/cron/tokens`; Vercel calls its cron jobs "legacy" and offers Schedules, a public beta, instead: we stay on cron jobs, which work, until Schedules are out of beta).
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
- 23 Nov: `/ext/*` answers only the panel's own origin (`https://<client id>.webflow-ext.com`, plus `EXT_ORIGINS`); any other origin, or none, gets 403 and one log line `[aiseodeck] panel: refused origin ...`. CHECK in the end-to-end run that the panel's real origin is the one assumed: if the panel shows no data, read that log line and set `EXT_ORIGINS`. (24 Nov: it was not the one assumed. See the entry of 24 Nov, noon.)
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

- 24 Nov, 00:40: the report's own repository is ready and tested (170 tests): the report, the modules it uses, an entry point that answers the report's addresses and its cron job only, a webhook that takes report orders only, and its setup notes. It waits for its GitHub repository; until then it is kept on the branch `report-standalone` of this repository (delete that branch once the code is in `silit/ai-visibility-report`).
- 24 Nov: the five screenshots of this build and a spare are in `assets/marketplace/screenshots/`, made by `scripts/marketplace-shots.js`; `docs/listing.md` follows the submission form field by field.

- 24 Nov, night: the build was read against the toolkit's pre-submission quality gate, item by item, and against the Marketplace Guidelines and the design guidelines as published that day. The record, with the evidence for each item, is `docs/quality-gate.md`. What it changed:
  - The panel's look follows Webflow's design guidelines: Webflow's CSS variables for apps (default dark theme as the fallback, so the panel follows Appearance where the Designer provides the variables), Inter at 11.5px and 13px in two weights, 4px corners. Inter ships inside the panel: two font files for Latin text and their license in `extension/public/fonts/` (from `@fontsource-variable/inter` 5.2.5, unchanged). The bundle is seven files now; Webflow CLI 2.16.0 packs the folder as `fonts/...`.
  - `test/panel.js` measures the contrast of every text and icon on screen in Webflow's dark and light themes.
  - Moving between pages in the Designer: a late answer for the page before is dropped, an Apply finishes on the page it was pressed for, and a half-taken change (title yes, description no) is said as it is.
  - The function `top` of the panel was renamed; a test keeps the names of the window around the panel out of the script (Preflight blocks access to the top document).
  - Languages: the server writes the primary locale; the panel sets values through the Designer, which names no locale, and says so on a site with more than one language (`/ext/context` now tells it the site's languages).
  - Reviewers: besides `@webflow.com`, an access code (`COMPLIMENTARY_CODE`, entered on the Account page) opens the Agency plan.
  - An account with no authorization left and no paid plan is deleted 30 days after its last authorization ended (`jobs.leftBehind`, in the hourly token pass).
  - The authorize address joins scopes with `%20`. The packaging script refuses a bundle over 5 MB. The first submission's video captions moved to `assets/marketplace/previous/`. A 512 x 512 copy of the logo is in `assets/marketplace/`.
  - Measured: a quiet tick costs 7 database commands (about 2,000 a day); the hourly token pass about 2 per account.
  - The web app's contrast: a new test, `test/contrast.js`, measures every text of 24 pages in a browser, in the light and the dark theme, on the free plan and on a paid one. What it found was fixed in the colors of `api/_lib/html.js` and the public pages (faint text, green, red and blue on their tints, dimmed counts, muted text on tinted boxes in the dark, the faded links of a home page illustration). The screenshots were made again.
- `npm test`: `test/app.js` 409, `test/panel.js` 63, `test/contrast.js` 81 (it also measures the focus ring the Tab key shows on each page, which is blue on light pages now).

- 24 Nov, noon: the owner signed in to GitHub and Webflow, and the things that needed those sessions were done and read.
  - The report has its own home: the private repository `silit/ai-visibility-report` and the Vercel project `ai-visibility-report` (team Silit), at `https://ai-visibility-report-wheat.vercel.app`. The database of this app is connected to it with the same `KV_PREFIX`; an old check link opens there. Its `/health` lists the settings it still lacks, by name: eleven values the owner enters (they cannot be copied from this project, Vercel does not show a secret again). The Claude and Vercel GitHub Apps were given that one repository more, with the owner's yes.
  - Vercel blocks a deployment from a private repository when the commit email matches no GitHub account. Commits in the report's repository carry the noreply address GitHub gives the `silit` account. The same will hold here if this repository is made private.
  - The app's settings in Webflow were read, nothing was changed: redirect URI and scopes as the code has them; the Designer Extension URI is `https://6af730d2ef364c450fd995ce.webflow-ext.com`, not an address made from the client id. The server would have refused its own panel. Fixed: the address is written out (`PANEL_ORIGIN` in `api/_lib/webflow.js`), `EXT_ORIGINS` only adds, tests cover both.
  - The settings have no field for an Install URL: it is given in the submission form only. The notes that said otherwise were corrected.
  - The app is installed on no site now (0 installs), and the panel published in its settings is the one of 15 November (three versions, all of that day).
  - **Publish extension version** takes a `.zip`, a distribution (only "internal testing" can be chosen before the app is in the Marketplace) and notes under four headings: New Features, Changes/Fixes, Improvements, Resolution notes. The text for them is in `docs/listing.md`.
  - App Review Preflight is installed in the Workspace (authorized on 15 November). The submission form shows nothing until "Sign in with Webflow" is pressed on its page; that is the owner's step. Two-factor authentication is enabled on the owner's Webflow account.
  - In this project's Vercel settings `POLAR_ACCESS_TOKEN` and `POLAR_WEBHOOK_SECRET` are kept as readable values (Vercel marks them "Needs Attention"). They should be saved again as secrets when the owner next has the values at hand.
- `npm test`: `test/app.js` 413, `test/panel.js` 63, `test/contrast.js` 81.

- 24 Nov, afternoon: the report runs from its own project, and silitlabs.com passes its three addresses on to it (`silit/site` #22).
  - The owner entered the eleven values. A first real check on the new project showed that two were not accepted by their services: the DataForSEO login (the e-mail address had been entered, the API login is another value) and a Gemini key made in a Google project without billing. The report's project got `/health/keys` for this: it asks each of the seven services with one free request and prints the names of the settings that were refused. All seven take their keys now; a free check answered on ChatGPT, Google AI Overviews and Gemini.
  - While two services refused, the cron job of the new project was switched off in Vercel so that it would not work customers' checks; it is on again.
  - The Polar endpoint of the report (named "aiseodeck-v2" at Polar) has the right address, the Raw format and the two events. Its secret showed in clear on that page while it was read, so the owner reset it and entered the new one.
  - Left for the report: one test purchase by the owner with a 100% discount code, which is the only thing that shows the webhook, the mail and the six engines of the full report on the new project.
  - Until this branch is deployed, the old deployment of this app still holds the report's code and its cron job. Both projects work the same queue under one lock, with the same keys.

- 24 Nov, afternoon, after the owner's test purchase of the report (order of 14:41, 100% discount code, no money moved):
  - The whole chain works on the new project: Polar delivered `order.paid` to the report's endpoint with the new secret (HTTP 200), the check was marked paid, six engines were asked 54 times, the report was built in four minutes and the buyer's mail arrived. The owner's notice of the sale came from Polar.
  - One of the 54 answers stayed empty, and the reason was in code that this app shares with the report: DataForSEO's code 40101 ("Internal SE Server Error", Google did not answer it) was read as a refusal of our account, like every code from 40100 to 40399. Such an answer was never asked again, and the owner got a mail that the account "needs attention" (the mail of 23 November, 01:06, was the same thing). Fixed in both repositories: `kindOf` in `api/_lib/alerts.js` goes by DataForSEO's own list of codes, and `api/_lib/engines.js` asks again after the codes that pass and reads 40102 ("No Search Results") as "no AI answer". The stand-in for DataForSEO in `test/mocks.js` answers with these codes when a search carries a marker word, and the tests run whole checks through it.
  - This matters for the review: a reviewer's check that met one such moment would have shown "This engine could not answer right now" for Google AI Overviews with nothing wrong on our side.
- `npm test`: `test/app.js` 425, `test/panel.js` 63, `test/contrast.js` 81.

- 24 Nov, 15:15: the owner said "yayınla" and asked Claude to do the submission as well. The branch was merged (#14) and is in production.
  - Checked live right after: the public pages, `/health`, `/cron/*` (401 without the secret), `/ext/*` (403 to another origin), the report's addresses (redirects to silitlabs.com), and the owner's own account, which the version before made: its site opened, the site's address came from Webflow, and Site health, never read by this version, read 14 pages through the API.
  - The stored authorization of the test site still works. "Installs 0" on the app's row in Webflow counts Marketplace installs, not this one.
  - The panel's fourth version went up with Publish extension version (internal testing), from the `bundle.zip` whose checksum is in `docs/listing.md`.
  - `COMPLIMENTARY_CODE` had been entered in the report's project by mistake. The owner entered it in this project at 15:38; the deploy that followed this commit is the first that has it.
  - Vercel asks for a six-digit code before a Redeploy from its dashboard. A push to main deploys without it.
  - To show Site health and a fix on real findings, three pages of the test site were given gaps on purpose through the API: `/resources` has no meta description, `/contact` has the title "Contact", `/pricing` a title of 104 characters. Site health then read 97/100 with exactly these findings.

- 24 Nov, afternoon and evening: the end-to-end run on the live app with the published test site, the eight steps of "How to test" in `REVIEW.md`, not in their order. All eight passed. What the run showed, and what was changed because of it (each change tested and deployed before the run went on):
  - The install was denied once (the app says it has no access and that nothing was stored) and then approved for the test site alone. Setup showed the site's address read-only, suggested keywords from the home page through the API, and the first check ran with all six engines answering.
  - Site health read 14 pages. A title and description applied from a page fix were found in Webflow, unpublished. A keyword fix created five draft items in the collection Posts.
  - In the Designer the panel opened, followed the open page, wrote a suggestion and applied a title and description. The Designer was in its light appearance and the panel was light as well: the Designer provides its variables. The server log has the panel's calls at 16:44 to 16:47, each answered with 200 and each preflight request with 204.
  - Disconnect deleted what was kept about the site; Connect brought it back with no Webflow screen. After Uninstall App in Webflow the next read was refused, the site was deleted and the Sites page said so. The test site was left with the app installed and connected, and five keywords checked.
  - #16: the notice after an uninstall said "about them" for one site.
  - #17: "What AI said" showed the Markdown marks of an answer. An answer is shown as plain text now.
  - #18: the texts on uninstalling name the place in the words of Webflow's own screens (Site settings, Apps & Integrations, Connected Apps, View details, Uninstall App). A table in an answer is shown as rows.
  - #19: an answer is kept up to 1,500 characters, and a longer one was shown under "Full answer". It is labelled "First 1,500 characters of the answer" now, cut at its last whole word; the number is one constant and the privacy policy names the same one.
  - #20: the excerpt of an answer keeps the answer's line breaks.
- 24 Nov, 17:16: the owner ran App Review Preflight in the Designer of the test site on the final `bundle.zip` and `review.zip`. 0 security blockers, 0 required updates, 1 suggested update: "External API Calls", one place, the panel's `fetch` to `https://aiseodeck.silitlabs.com/ext/` (`app.js`, line 209). The run is listed as "Runtime test needed", as the run of 15 November was: the test of a published runtime was not prepared, because the app loads no JavaScript on published sites. The advisory boot test answered "The boot test runner could not start inside the secure sandbox" on three tries. Receipt: `wfpre_ac0fe18c274fefca44b42bbe32f422bb`. The changes #19 to #21 came after this run and touch the server only; the bundle is the one Preflight read.
- 24 Nov, evening: the demo video. 49 scenes with English captions, 4 minutes 26 seconds, 1920 x 1080, built by `scripts/demo-video/build_stills.py` from captures of the live app (captures that showed a text changed later by #17 to #20 were left out, and newer ones used). The owner said yes to an unlisted upload to his YouTube channel: https://youtu.be/C_RxaD_-Rz4
- 24 Nov, night: the form. Its page shows nothing until "Sign in with Webflow"; the owner said yes to authorizing Webflow's own "Marketplace Submission Form" for the Silit Labs Workspace. What the form turned out to be, and what it checks by itself, is written down in `docs/listing.md`: the client ID is known, so this is an App Update; lists do not survive in the description; "your agency" and "checkout" set off its detectors; the notes take 5,000 characters, so they are a summary that links to `REVIEW.md`; it asks for the backend's runtime version.
  - #21 (25 Nov, 00:26): the server writes one line at each cold start with its Node.js version, because the form asks for it. Read in Vercel: `[aiseodeck] start, Node.js v26.13.1`.
  - #22 (25 Nov, 02:40): `REVIEW.md` with the results of the sitting.
- `npm test`: `test/app.js` 435, `test/panel.js` 63, `test/contrast.js` 81.

- 25 Nov, morning: the last checks and the submission.
  - Every value of the form was compared with `docs/listing.md` and the saved texts (the description, the notes, the five alt texts and the features, character for character).
  - The access code is live: the code form of the Account page answered "That access code is not valid." to a wrong code, which it does only when `COMPLIMENTARY_CODE` holds 16 characters or more.
  - The link in the notes opens `REVIEW.md` on `main` with nothing left to fill. The demo video plays for a viewer who is not signed in.
  - 10:46: the owner typed the access code into the form and ticked the two boxes himself (the information stays valid permanently; Webflow's Privacy Policy, Terms of Service and Developer Terms of Service).
  - The first Submit was answered with 401: the form's sign-in of the night before had run out, and the form asked to sign in again. With the owner's yes the Workspace was authorized again in another tab; "I have signed in" brought the form back with every value and all six files.
  - 10:49: Submit. "Thank you! Your submission has been received." Reference ID `c9a4039e-4b94-4ad1-81a1-10cc77f4c3a8`. The page names 10 to 15 business days, and says that feedback and the decision come by email on this submission's thread.
  - 10:51: Webflow's email to info@silitlabs.com, ticket #1225904: "No action required at the moment, but please keep an eye on this email thread". Nothing was written to the old thread (#1221544): its review ends with "Submit through the App submission form", which is what was done, and the notes of the form name that ticket in their first sentence.
  - In the app's settings, after the submission: Publish extension version still offers internal testing only. If the review asks for changes, the page of the form says how they go in: a new bundle with "Publish > Upload Bundle for Review" in the app's settings, and the review continues on the same thread.

Where it stands, and who does what next
1. Done on 24 November: the report's repository, its Vercel project and the database connection exist.
2. Done on 24 November: the owner entered the eleven values and added the report's webhook at Polar; `/health` says "ok" and `/health/keys` says "keys ok" there.
3. Done on 24 November: the three rewrites of silitlabs.com lead to the new project; landing page, sample, an older check link and a free check were checked live, and the owner's test purchase went through (see the log).
4. Done on 24 November: the branch was merged (#14) and is in production, the panel's fourth version was published, and the owner set `COMPLIMENTARY_CODE` in Vercel.
5. Done on 24 November: the end-to-end run on the live app with the published test site, and the list "For the sitting" of `docs/quality-gate.md` (one item is open there: the usage graph of the database).
6. Done on 24 November: the final `bundle.zip` and `review.zip` with their checksums, the demo video, every field that waited for the sitting.
7. Done: App Review Preflight (the owner, 24 November), the form (filled by Claude; the owner typed the access code and ticked the two boxes), and the submission on 25 November 2026 at 10:49.
8. Now: Webflow reviews. Its answer comes by email on ticket #1225904, to info@silitlabs.com; the page of the form names 10 to 15 business days. Until then:
   - `COMPLIMENTARY_CODE` in Vercel stays as it is. The form made the owner confirm that the access stays valid permanently; a changed or removed value closes the reviewers' way in.
   - The repository stays public and `REVIEW.md` stays where it is: the notes of the form link to it.
   - The test site stays published, with the app installed and connected, and with the pages and draft items the demo video shows.
   - The panel is not published again, and the app's screens and texts are not changed: the review checks the listing, the notes and the video against what it finds. A fix that cannot wait is tested, deployed and written down here.
   - If the review asks for changes: answer on the same thread, and send the new bundle the way the page of the form names ("Publish > Upload Bundle for Review" in the app's settings; on 25 November that choice was still greyed out there, so read the settings again then).
9. Open, none of it in the way of the review: the usage graph of the database in Upstash; `POLAR_ACCESS_TOKEN`, a readable value in this project's Vercel settings when last read, saved again as a secret; the `COMPLIMENTARY_CODE` that was entered in the report's project by mistake (it does nothing there and can be removed); the branch `report-standalone` (to delete with the owner's yes); two-factor authentication on the GitHub account before 13 December 2026.

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

