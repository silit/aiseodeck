# AI SEO Deck: review notes for the resubmission

Reply to the review of 23 November 2026 (ticket #1221544). The notes field of the submission form takes 5,000 characters, so the form carries a summary of this file and links here for the detail and the evidence. Everything in this file describes the build that is live at aiseodeck.silitlabs.com since 24 November 2026 (the branch `main`).

Status: **SUBMITTED FOR REVIEW on 25 November 2026** (Webflow ticket #1225904, reference ID `c9a4039e-4b94-4ad1-81a1-10cc77f4c3a8`). All five findings are addressed. The build is in production (the AI Visibility Report runs from its own project since 24 November). The end-to-end run on the live app with the published test site passed on 24 November. App Review Preflight ran on the final bundle and review ZIP. The demo video and the screenshots show this build. The submission is filed as an App Update of the kind "App functionality, permissions, or bundle": the form knows the client ID of the app from the first submission and takes it as an update.

## The app

- **Type:** Hybrid. A Data Client (OAuth, server side) and a Designer Extension (the panel in `extension/`: a page, a stylesheet, a script and two font files, with no build step).
- **No code on customer sites.** The app registers and injects no script, uses no Custom Code API and adds no element to a site.
- **Install URL:** `https://aiseodeck.silitlabs.com/auth`
- **Redirect URI:** `https://aiseodeck.silitlabs.com/callback`
- **Documentation:** the AI SEO Deck guide, `https://aiseodeck.silitlabs.com/docs`
- **Privacy policy:** `https://aiseodeck.silitlabs.com/privacy` **Terms:** `https://aiseodeck.silitlabs.com/terms`
- **Support:** info@silitlabs.com
- **Test site:** `https://aiseodeck-demo.webflow.io` (published; this build is installed on it)
- **Demo video:** `https://youtu.be/C_RxaD_-Rz4` (unlisted, 4 minutes 26 seconds, recorded on the live app on 24 November 2026: the install denied and approved, setup, the first check, Site health, a page fix and a keyword fix applied to Webflow, the panel in the Designer, disconnect and connect again, where to uninstall, and the prices)
- **Preflight receipt:** `wfpre_ac0fe18c274fefca44b42bbe32f422bb`
- **Bundle and review ZIP:** `bundle.zip` (137,756 bytes, SHA-256 `a2d5856f28cedb96e77c95a86ae3084f05b9b03387407a50c8c1082b7dd1fe97`), the file published as the panel's version of 24 November 2026; `review.zip` (140,346 bytes, SHA-256 `06d32b2fce8890b3612b4897143e655ff4d806c912e225c6f054287e02d715e3`), the seven files of that bundle byte for byte plus a README.

## The five findings

| # | Finding | What was done | Evidence |
| --- | --- | --- | --- |
| 1 | The site audit read the published site outside the Webflow API. | The audit is gone. **Site health** is built on the Data API alone: `GET /v2/sites/{site_id}/pages` for the page list with SEO and Open Graph settings, `GET /v2/pages/{page_id}/dom` for the text, headings and images of static pages. Suggestions are written from the same two calls. The code that requested published websites is deleted from the repository (`api/_lib/audit.js`, `api/_lib/fetcher.js`). The app requests no website of a customer anywhere. | `api/_lib/health.js`, `api/_lib/pagetext.js`, `api/_lib/webflow.js`. `node test/app.js`: a stand-in for the customer's published site runs through the whole test and must receive no request; every request of the run must go to Webflow's API, an AI or keyword data provider, mail, billing or the database; a static check lists the only modules that may send requests. |
| 2 | Dependence on beta endpoints (the three schema-markup calls). | Every schema feature is removed: reading JSON-LD, the schema findings, and writing FAQ, Organization and WebSite schema, in the web app and in the panel. No feature uses a beta endpoint. One call outside `/v2` remains, for identity only: `POST /beta/token/resolve`, the call Webflow provides for resolving the Designer's ID token (see "The panel" below). | `api/_lib/webflow.js` has no schema call. `node test/app.js` checks the code for beta paths and lists every Webflow endpoint called during the run. |
| 3 | Setup asked users to enter their domains. | Setup and Settings show the site's addresses as read from `GET /v2/sites/{site_id}` (custom domains and the webflow.io address), read-only, with the time they were read and a Refresh button. No screen asks for a website address. Rivals are asked for by name only. | `api/_lib/store.js` (`domainsOf`, `refreshMeta`), `api/_lib/html.js` (`webflowDomains`). Tests: "setup asks for no website address", "the addresses of the site are the ones Webflow gives, not the ones typed into the form". |
| 4 | The listing description did not meet the requirements. | Rewritten (see `docs/listing.md`): what the app does, each feature, what is needed before starting and what setup asks, prices in US dollars with the yearly amounts and the trial terms, and the documentation by name. The sentence on token encryption moved here. Every statement was checked against this build. | `docs/listing.md` |
| 5 | The documentation did not cover the Designer Extension or the Webflow plan. | The guide is rewritten and covers the whole app: what is needed in Webflow (no particular plan; what the CMS drafts and the panel need), install, setup, checks, fixes, Site health, the panel in the Designer, what is written to Webflow and when, languages, prices, and disconnect, uninstall and delete. | `public/docs.html`, sections "What you need before you start" and "8. Inside the Webflow Designer" |

What the API does not provide for a Webflow site, and the app therefore no longer reports: structured data, robots.txt, llms.txt, the sitemap, and the text of CMS item pages. Text inside components is not read: on such a page "No H1" and "Thin content" are shown as "not determined" and take nothing off the score.

## Scopes and the endpoints that use them

| Scope | Endpoint | Used for |
| --- | --- | --- |
| `authorized_user:read` | `GET /v2/token/authorized_by` | The account (Webflow user id, name, email). Also asked to learn whether a token still works. |
| `authorized_user:read` | `POST /beta/token/resolve` | Resolving the ID token of the Designer panel. |
| `sites:read` | `GET /v2/sites`, `GET /v2/sites/{site_id}` | Site names, addresses and locales; the sites that can be connected. |
| `pages:read` | `GET /v2/sites/{site_id}/pages`, `GET /v2/pages/{page_id}`, `GET /v2/pages/{page_id}/dom` | Site health; the text a suggestion is written from; the values a fix shows as "Now in Webflow". |
| `pages:write` | `PUT /v2/pages/{page_id}` | The SEO title and meta description of one page, when the user presses Apply. |
| `cms:read` | `GET /v2/sites/{site_id}/collections`, `GET /v2/collections/{collection_id}` | The collection picker for drafts, and its text field. |
| `cms:write` | `POST /v2/collections/{collection_id}/items` with `isDraft: true` | Draft items, when the user presses Apply or Add the draft to Webflow. |

The Install URL asks for exactly these six scopes, the ones configured for the app.

## Authorization (OAuth)

- Every authorization starts at the Install URL, `/auth`. It creates a random `state` for that one request, stores its hash on the server together with the hash of a value held by the starting browser in an HttpOnly, Secure, SameSite=Lax cookie, for ten minutes, and then redirects to `webflow.com/oauth/authorize`.
- `/callback` reads and deletes that record in one operation before the code is used. A callback with no `state`, a changed `state`, a `state` given twice, one used before, one older than ten minutes or one started in another browser is refused, and no code exchange happens.
- The Install button under Apps & Integrations in the developer Workspace sends no `state`, so it ends on that refusal. It is not a customer path; the app is installed from the Install URL.
- The code is exchanged once, with the redirect URI, and is never stored or logged. A cancelled request ends on a page that says nothing was stored.
- OAuth runs at install and when the user chooses to authorize another site or Workspace. Signing in again is by an emailed one-time link, not by OAuth.

Tests in `node test/app.js`, section "the install address and the OAuth state": two requests carry different states; no state, a changed state, a repeated state, a state from another browser, a used state, an expired state and a denied request are each refused with no code exchange.

## Tokens: the three attestations

Silit Labs attests, for the Webflow OAuth access token of AI SEO Deck:

1. **Encrypted at rest.** The token is stored encrypted with AES-256-GCM in the server-side database, and decrypted only on the server at the moment of a call to Webflow.
2. **Stored server-side only.** It never reaches the browser or the Designer panel, is never part of a response or an address, and is never logged.
3. **Deleted on uninstall or revocation.** It is deleted when Webflow no longer accepts it (the app was uninstalled or its access removed), and when the user deletes the account.

## Disconnect, uninstall and delete

- **The app never calls `/oauth/revoke_authorization`.** Access to Webflow ends when the user removes the app in Webflow.
- **Disconnect** (a site in its Settings, or all sites of one authorization on the Account page) deletes what the app keeps about those sites and leaves the authorization alone. The Sites page lists the sites the authorization covers, read from `GET /v2/sites`, and **Connect** brings one back with no new authorization.
- **Uninstall.** There is no uninstall webhook, so the app learns of it from a 401. One call to `GET /v2/token/authorized_by` settles it: refused there too, the app stops asking Webflow anything with that token, forgets the token and deletes the sites of that authorization with everything kept about them. This happens at the next thing the user does, before the next scheduled check, and at the latest within a day: an hourly job (`/cron/tokens`) asks about every stored token once every 20 hours. When Webflow does not say whether a token works (no answer, a 5xx, a 429), nothing is removed and that token is asked about again an hour later.
- **A 401 is never retried.** A 429 is: the app waits as long as `Retry-After` says, never less, at most three more times, and stops instead of retrying when the wait is longer than ten seconds. Site health stops short of the limit Webflow reports in `X-RateLimit-Remaining` and reads the rest when the user asks.
- **What stays in Webflow** after any of these: the titles and descriptions the user applied, and the CMS draft items. The app adds nothing else to a site. The guide says how to change or delete them.
- **What is left of an account** after its last authorization ended is the Webflow user id, name, email and settings. With no paid plan, that account is deleted 30 days later; the Sites page shows the date. Accounts of the review team are not deleted this way.
- **Delete account** deletes the account, its sites, answers, Site health results and tokens, and cancels a paid plan.
- **When a plan or a trial ends**, the account moves to the free plan. Nothing is deleted in the app or in Webflow; Apply is off.

## What is written to Webflow

Two things, and only when the user presses a button for that page or that draft:

1. `PUT /v2/pages/{page_id}` with `seo.title` and `seo.description`. The screen shows "Now in Webflow" (read at that moment, with the time) next to the suggestion. Just before writing, the app reads the page again; if the title or description is no longer what the user was shown, nothing is written and the new values are shown.
2. `POST /v2/collections/{collection_id}/items` with `isDraft: true`.

Nothing is written on a schedule or on page load. Nothing is published or deleted by the app. After an Apply the app tells the user to publish in Webflow. Suggestions written by AI are labelled as suggestions and stay apart from the values read from Webflow. Setup, Settings, Site health, each page's fix and each keyword's fix plan say when their Webflow data was read and have a Refresh from Webflow button; the panel says it too and has "Read this page again".

## Localization

The server reads, checks and writes the primary locale only, and the web app says so next to every Apply button on a site with more than one language. Suggestions are written from the pages of the primary locale.

| Operation | Locale |
| --- | --- |
| Read pages and their content (Data API) | No `localeId`: Webflow answers with the primary locale. |
| `PUT /v2/pages/{page_id}` | No `localeId`: Webflow writes the primary locale. Webflow refuses a primary locale id on this endpoint ("The provided locale must be a secondary locale"), so none is sent. |
| `POST /v2/collections/{collection_id}/items` | No `cmsLocaleId`: the draft is created in the primary locale. |
| Secondary locales (Data API) | Never read and never written by the server. |
| `page.setTitle`, `page.setDescription` in the Designer panel | The Designer API takes no locale and has no call that tells which locale the Designer is showing. The panel sets the two values on the page as the Designer shows it, the same as typing them into the page settings. On a site with more than one language the editor says this above the fields before anything is applied, names the language the suggestion was written from, and asks the user to check which language is open. The values the page has now stand next to the fields, so nothing is overwritten unseen. |

## The panel in the Designer

- Files: `extension/webflow.json`, and in `extension/public/` the page `index.html`, `app.css`, `app.js` and the folder `fonts/`. Plain HTML, CSS and JavaScript written by hand, shipped as they are: no framework, no code dependency, no bundler, no minifier, so there are no source maps. `fonts/` holds Inter, the typeface of Webflow's interface: two `.woff2` files for Latin text and the text of their license (SIL Open Font License 1.1), shipped with the panel as the design guidelines describe, so no font comes from another host. The review ZIP holds all of these files byte for byte and a README.
- Designer API calls: `webflow.getSiteInfo`, `webflow.getCurrentPage`, the page getters (`getName`, `isHomepage`, `getPublishPath`, `getSlug`, `getTitle`, `getDescription`, `getCollectionId`), `page.setTitle`, `page.setDescription`, `webflow.getIdToken`, `webflow.setExtensionSize`, `webflow.subscribe('currentpage')`, `webflow.notify`.
- `setTitle` and `setDescription` run only in the click handler of **Apply to this page**. Nothing changes on load or when the page changes.
- It calls one server, `https://aiseodeck.silitlabs.com/ext/` (`context`, `suggest`, `applied`), with POST. Each request carries a fresh ID token from `webflow.getIdToken()`, the site id, the page id and the page path, and no other credential. The token is asked for every request and never kept.
- The server resolves the ID token with `POST /beta/token/resolve`, using the stored token of the site named in the request, and answers only when Webflow says the token belongs to that same site. A site id sent by the panel is never trusted on its own.
- A caller that cannot be confirmed gets one and the same answer whatever the reason: the site is not connected, the token is unknown, the token belongs to another site, or Webflow gave no answer. The answers do not tell which sites use the app.
- CORS: `/ext/*` names one allowed origin, the extension's own (the Designer Extension URI of the app, `https://6af730d2ef364c450fd995ce.webflow-ext.com`), and answers 403 to any other origin or to none. CORS is not what authorizes a call; the ID token is. No other route sends CORS headers.
- The panel has no inline handlers or styles, no `eval`, no HTML built from strings, no timers, no keyboard shortcuts, no `message` handler, no browser storage, no cookies and no iframe. It leaves no global variable and does not name the window around it. Events are bound with `addEventListener`. Links to the app are ordinary links that open in a new tab when clicked; one function makes them all and lets them point only to the app's own address. The only address in its files is the app's own, over HTTPS.
- **Moving between pages.** The panel follows the page that is open. An answer that arrives for a page the user has left is dropped, and an Apply finishes on the page it was pressed for, also when another page is opened before the Designer has taken the change.
- **Design.** Colors, type and shadows are Webflow's CSS variables for apps (`--background1`, `--text1`, `--actionPrimaryBackground` and the others of the design guidelines), each read with the value of the default dark theme as its fallback, so the panel follows the user's Appearance setting wherever the Designer provides the variables. Text is Inter at 11.5px and 13px in two weights, corners are 4px, labels are in sentence case, and the main actions fill the width. The stylesheet names two files, the panel's own fonts, and loads no image.
- **Accessibility.** Every control is a native button, link or field with a visible focus ring and a name; every mark has a shape and a text label, so no state is told by color alone; messages reach screen readers through a status line and `role="alert"`. Text has a contrast of at least 4.5 to 1 and icons at least 3 to 1 in Webflow's dark and light themes: `node test/panel.js` measures every text and icon on screen in both.

## The backend

- Every `/app/*` route needs a signed-in session and checks that the site belongs to that account; a site of another account answers the same "not found" as a site that does not exist. Forms are refused from other origins.
- `/cron/*` needs a secret. The billing webhook checks its signature. `/r/{token}` is the client report link the user creates on purpose: public to whoever has the link, marked noindex, replaceable.
- The app requests only fixed addresses: Webflow's API, the AI providers, DataForSEO, Resend, Polar and its database. No address comes from user input.
- The app has no third-party code dependencies (`package.json` lists none). The one third-party part of the panel is the Inter typeface, named above.
- Log lines pass through one function that takes out email addresses and anything long enough to be a token.

## What goes to other services

- **AI engines** (OpenAI, Google, Anthropic, xAI) and **DataForSEO** get the user's keywords, the questions written for them and the market, to produce the answers that are measured.
- **When the user asks for a suggestion**, the title, description and part of the text of that page, as the Webflow API returns them (at most 6,000 characters), go to one AI provider to write it.
- **DataForSEO** gets the keywords and the site's address for search volumes and for the keywords where Google's AI Overviews cite the site.
- Nothing else leaves. The privacy policy lists what is stored and for how long.

## Prices and access for review

All prices in US dollars. Free: USD 0, 3 keywords on 1 site, monthly checks on 3 engines, no Apply. Solo: USD 19 a month or USD 190 a year. Studio: USD 49 a month or USD 490 a year. Agency: USD 149 a month or USD 1,490 a year. Paid plans start with a 7-day free trial, once per customer across the products of Silit Labs: Polar takes a card, charges nothing during the trial, emails a reminder before it ends, and charges the plan's price on day 8 unless the user cancels. No other fees.

**Reviewers:** an account with an `@webflow.com` email gets the Agency plan, the highest one, with no checkout and no card, for as long as the account exists. If the reviewing account is on another address, open **Account**, and under **Plan** enter the access code given with this submission in the field **Access code**: it opens the same Agency access on that account, and it stays. Neither kind of account expires or is deleted. After authorizing from the Install URL you land on the setup of the site.

## How to test

1. Open the Install URL and approve for the test site. Setup opens. (To see the denied path: open the Install URL again and cancel on Webflow's screen.)
2. Setup: brand name, rivals by name, then **Suggest keywords from my site** or type a keyword. Save. The first check runs for a few minutes.
3. Keywords: open a keyword to read each engine's answer.
4. Site health: **Read my pages from Webflow**. Open a page with **Fix**: "Now in Webflow" on the left, **Write a suggestion with AI**, then **Apply to Webflow**. Check the page settings in Webflow: the change is there, unpublished.
5. Keyword page, **Write the fixes**, tick the CMS box, **Apply to Webflow**: draft items appear in the collection.
6. In the Designer: Apps, AI SEO Deck. The panel shows the open page and follows when another page is opened. **Fix**, **Write with AI**, **Apply to this page**.
7. Site Settings, **Disconnect this site**; then Sites, **Add a site**, **Connect**: no Webflow screen appears.
8. Uninstall the app in Webflow (Site settings, Apps & Integrations, Connected Apps, **View details** next to AI SEO Deck, **Uninstall App**). Open the app again and press anything that reads Webflow: the Sites page says access was removed and the site is gone.

## Checks run on this build

- `node test/app.js`: 435 passed, 0 failed (the app against stand-ins for Webflow, the database, the AI engines, mail and billing).
- `node test/panel.js`: 63 passed, 0 failed (the panel in Chromium, served from the extension's address under a strict Content Security Policy, against the real server code).
- `node test/contrast.js`: 81 passed, 0 failed (every page of the web app and the public pages in Chromium, in the light and the dark theme, on the free plan and on a paid one: the contrast of every text is at least 4.5 to 1, or 3 to 1 for large text, and the focus ring the Tab key shows stands out 3 to 1).
- End-to-end on the live app with the published test site, 24 November 2026: the eight steps under "How to test" all passed. The install was denied and then approved for the test site alone; setup and the first check ran with all six engines answering; Site health read 14 pages; a title and description applied from a page fix were found in Webflow, unpublished; a keyword fix created five draft items in the collection Posts; the panel followed the open page in the Designer and applied a title and description to it; Disconnect and Connect again showed no Webflow screen; and after Uninstall App the next read of Webflow was refused, the site was deleted and the Sites page said so. In the server log of that day every call of the panel to `/ext/` was answered with 200 and each of its preflight requests with 204; the only refused requests to `/ext/` were two sent on purpose with no origin, to see the 403.
- App Review Preflight, run in the Designer of the test site on 24 November 2026 on the `bundle.zip` and `review.zip` named above: 0 security blockers, 0 required updates, 1 suggested update. The suggested update, "External API Calls", points at the one network call of the panel (`app.js`, line 209): a POST to the app's own server, `https://aiseodeck.silitlabs.com/ext/`, over HTTPS, with `Content-Type` as its only header. The run is listed as "Runtime test needed" because the test of a published runtime was not prepared: the app loads no JavaScript on published sites, so there is no runtime file to pin. The tool's advisory boot test did not start; it answered "The boot test runner could not start inside the secure sandbox" on each of three tries. Receipt: `wfpre_ac0fe18c274fefca44b42bbe32f422bb`.
