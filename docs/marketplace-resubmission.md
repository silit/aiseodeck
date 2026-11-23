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
- Developer toolkit: AI skills for coding agents that check an app against the review requirements. Download link in the email (`webflow-app-form.webflow.io/app-form/api/skills/download`). NOT read yet: ask the owner for the file.
- The form asks for: a published `.webflow.io` testing site with the app installed and every feature available; one review ZIP (source maps, package.json and lockfile of the exact build, or, for an app that ships its source unchanged, the source files plus a short README); the Preflight receipt.
- "Do not resubmit until all findings are addressed and the complete app is tested end to end."

Did our work outside the app cause any of this? No. `public/docs.html`, `public/privacy.html` and `public/terms.html` are unchanged since the submission of 16 November (`git diff d543220 origin/main -- public`), and all five findings are about the app as submitted. The report (AI Visibility Report) is still moved out of this repository and project before resubmitting: reviewers do read the submitted website, and another developer's review that reached us by mistake faulted a website that "directs visitors to enter a URL".

## 2. What else reviewers check (learned from a review of another app that reached us by mistake)

Kept general on purpose. None of the other developer's details belong in this repository.

1. Reviewer access through the submitted install URL: after authorizing, no checkout and no card. The review account has the highest plan and never expires.
2. The Webflow entry point uses the authorized site. The website does not send visitors to a "type your URL" flow. For each feature: which Webflow endpoint supplies its input, and what is not available for Webflow sites.
3. Publishing stays under the user's direct control: nothing is written or published on a timer; the user reviews and approves each specific change before it is written. Website, listing and guide say the same thing.
4. What happens to content the app wrote when a subscription or trial ends, on disconnect and on uninstall, and what the app keeps and for how long.
5. Localization: the locale parameter of every read, create, update and delete, and what happens to secondary locales.
6. A dedicated Webflow setup and lifecycle guide (install, connect, use, disconnect, uninstall in Webflow, removing content), named in the listing and easy to find from the website.
7. Data and authorization disclosures agree with each other: which Webflow data is read, what is stored, what goes to AI providers, how to delete it. How pending work stops when a revocation is found (token introspection, a 401) and how disconnect works when one authorization covers several sites.
8. Publisher branding: the authorization screen shows the Workspace name and icon. They must match the listing.
9. Pricing: every plan's price with its currency and billing interval, what is paid when a trial ends, when it renews, free plan and paid trial told apart, any third-party account that is required.

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

1. `/beta/token/resolve`. The reviewer read our notes, which name it, and listed only the three schema endpoints. Webflow's own hybrid guide resolves ID tokens through it. But the stated rule is categorical. Decide after reading the developer toolkit and the hybrid authentication guide in a browser (the guide's text does not come through a plain fetch). The fallback that needs no beta endpoint: the panel opens our site in a popup after a click, the signed-in user confirms, and the popup hands the panel a short-lived session of our own with `postMessage` to the panel's exact origin; the server checks that the user owns the site on every call.
2. Text and headings inside components: resolve them through the component endpoints (one more scope, `components:read`), or report "not determined" when a page's text lives in components. Never report "No H1" for a page whose H1 may be inside a component.
3. Images whose alt text is inherited from the asset: resolving it needs `assets:read`. Without it, count only images whose alt is set or empty on the page.
4. Does `openGraph` on a page include an image? If not, drop the image part of the Open Graph finding.
5. The yearly prices and trial terms as sold at Polar, for the listing: exact amounts in USD.

## 7. Order of work

1. This document.
2. Rework (sections 5 and 6), test by test.
3. Listing description, documentation (with the Designer panel and the Webflow plan), privacy policy, terms, review notes: rewritten against the finished build.
4. The report moves to its own repository and Vercel project.
5. End-to-end run on the published webflow.io test site: install, approve, deny, setup, first check, site health, write and apply a fix, the panel in the Designer, disconnect, reconnect, uninstall.
6. Developer toolkit checks, Preflight receipt, review ZIP, new demo video, screenshots, form. The owner presses submit.
