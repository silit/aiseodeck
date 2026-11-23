# The build against Webflow's quality gate and Marketplace Guidelines

Checked on 24 November 2026, on the branch `marketplace-rework`, against three sources:

- the pre-submission quality gate of Webflow's developer toolkit (received 23 November 2026), item by item;
- the published Marketplace Guidelines and the design guidelines for apps, read again on 24 November 2026;
- Webflow's stylesheets for apps (`github.com/webflow/webflow-apps-css`, as of 18 September 2026).

Each line says **Pass** with where it is shown, **N/A** with the reason, or **Sitting**: it can only be shown on Webflow itself, in the sitting where this build goes live and is run end to end on the test site. Nothing here is a promise of approval; it is the list of what was looked at and what the evidence is.

`npm test` on this build: `test/app.js` 409 passed, `test/panel.js` 63 passed, `test/contrast.js` 80 passed. Every safeguard added in this pass was broken on purpose once to see a test fail.

## What this pass changed

Found by reading the guidelines again, and fixed:

1. **Design of the panel.** The guidelines ask that a Designer Extension aligns its style, type and colors with Webflow's design guidelines. The panel had a palette of its own. It now uses Webflow's CSS variables for apps (default dark theme as the fallback, so it follows the user's Appearance where the Designer provides them), Inter at 11.5px and 13px in two weights, 4px corners, sentence case, and main actions that fill the width. Inter ships inside the panel (two font files for Latin text, SIL Open Font License), which is one of the two ways the design guidelines name; nothing is loaded from another host.
2. **Accessibility of the panel.** Contrast is now measured by a test for every text and icon on screen, in Webflow's dark and light themes (text at least 4.5 to 1, icons at least 3 to 1). Every mark has a shape as well as a color. Messages reach screen readers through one status line and `role="alert"`.
   **And of the web app.** The same measurement on the web app found text under 4.5 to 1: table heads and other faint text, counts dimmed with opacity, green, red and blue text on their own tints, muted text on tinted boxes in the dark theme, and the faded links of an illustration on the home page. The colors were moved the little that was needed, and `test/contrast.js` now measures every text of 24 pages in the light and the dark theme, on the free plan and on a paid one.
3. **Moving between pages in the Designer.** An answer for a page the user had left could be shown under the next page, and an Apply could set the description on the page opened meanwhile. Both are closed and tested: late answers are dropped, and an Apply finishes on the page it was pressed for. When the Designer takes the title and refuses the description, the panel says exactly that.
4. **A name a scanner could misread.** A function of the panel was called `top`. Preflight blocks access to the top document, so the name is gone and a test keeps such names out of the script.
5. **Languages.** The texts said the app writes the primary language only. That is true for the server. The panel sets the values through the Designer, which has no locale parameter and does not tell an app which locale is shown. The panel now says so on a site with more than one language, before anything is applied, and the guide, the review notes and the listing say the same.
6. **Access for reviewers.** The guidelines ask for a review account on the highest plan that does not expire. Accounts on an `@webflow.com` address get Agency automatically. For a reviewing account on another address there is now an access code (`COMPLIMENTARY_CODE`), entered on the Account page.
7. **What is left after an uninstall.** Sites and tokens were deleted within a day; the account itself (Webflow user id, name, email, settings) stayed until the user deleted it. An account with no authorization left and no paid plan is now deleted 30 days after its last authorization ended. The Sites page shows the date; the privacy policy and the guide say so.
8. **The authorize address** joins the scopes with `%20`, as Webflow's OAuth documentation writes them (it used `+`, which worked).
9. **The three attestations** on the OAuth token are written out as such in the review notes.
10. **The bundle** is refused by the packaging script when it is over the 5 MB Webflow takes.

## Is it real?

| Item | Verdict | Where it is shown |
| --- | --- | --- |
| Runs end to end with no crashes on basic use | Sitting | `npm test` walks every flow against stand-ins for Webflow, the database, the AI engines, mail and billing. The run on the published test site is the last word. |
| No placeholder content or test data visible to users | Pass | The texts were read page by page (home, guide, privacy, terms, every app screen, the panel). The screenshots use a made-up business and the listing says so. |
| Backend live through the review window | Pass, with one thing to look at | Vercel Pro; cron jobs call with the `Authorization` header. The database is on Upstash's free tier: a quiet tick costs 7 commands (about 2,000 a day), the hourly token pass about 2 per account. Look at the usage graph in Upstash before submitting. |
| Demo access is ready | Pass | No credentials: the reviewer installs with a Webflow account. `@webflow.com` gets Agency automatically; the access code covers any other address. Neither expires, and such accounts are not deleted by the 30-day rule. Tests: "the access code that opens the Agency plan for a reviewing account". |
| User-facing documentation and error handling | Pass | The guide (`/docs`) covers install, setup, checks, fixes, Site health, the panel, what is written, languages, prices, disconnect, uninstall and delete. Errors are plain sentences with a next step; provider errors never reach the user. |

## Is it safe and inspectable?

| Item | Verdict | Where it is shown |
| --- | --- | --- |
| Production build, no `eval()`, no dev bundle | Pass | The panel has no build step: the files in `extension/public/` are what ships. `test/app.js`: "adds no HTML from strings, runs no generated code and has no timers". |
| No direct DOM manipulation of the Designer | Pass | The panel touches only its own document and never names the window around it. `test/app.js`: "never names the window around it". |
| Sections identified with `getTag()` | N/A | The panel reads and sets page settings only. It reads no element. |
| No externally hosted iframe as the app's interface | Pass | No iframe at all. `test/app.js`: "load nothing from elsewhere". |
| No excessive global variables | Pass | None: one function scope. `test/panel.js`: "leaves nothing on the window". |
| Third-party dependencies known; no unused external addresses | Pass | No code dependency. One third-party part, the Inter typeface, named in the README of the review ZIP. One address in the files: the app's own. |
| No credential fields read from a published DOM | N/A | No published page is read. |
| Data from official APIs | Pass | Data API and Designer API only. `test/app.js`: a stand-in for the customer's published site must receive no request during the whole run. |
| Client Secret server-side only | Pass | Environment variable; not in the bundle, the script or the repository (tracked files were scanned for anything that looks like a key). |
| Source readable, uploaded through the version manager | Pass / Sitting | Hand-written, formatted, commented. The upload is done in the sitting. |
| No source maps in `bundle.zip` | Pass | `scripts/package-extension.js` refuses a `.map` file or a `sourceMappingURL`. |
| One `webflow.json`, real product name, no telemetry block | Pass | The script compares the bundled manifest with `{ name, apiVersion: "2", size, publicDir }` exactly. Webflow CLI 2.16.0 left the manifest untouched. |
| The artifact verified is the artifact uploaded | Pass | The script checks the files inside `bundle.zip`, byte for byte against `extension/`, and builds the review ZIP from the bundle itself. |
| Bundle under 5 MB | Pass | About 138 KB with the fonts; the script refuses more than 5 MB. |
| Manifest fields | Pass | As above. |

## Backend and API surface

| Item | Verdict | Where it is shown |
| --- | --- | --- |
| Every endpoint requires verified caller authentication | Pass | `/app/*`: session. `/ext/*`: Webflow ID token. `/cron/*`: secret in a header. Billing webhook: signature. Public by design: the pages, `/health`, sign-in, and `/r/{token}` report links the user creates. |
| No authorization on a client-supplied identifier alone | Pass | The ID token is resolved by Webflow with the stored token of the named site and has to name that same site. Tests: "an unknown ID token, a token of another site, a site that is not connected and a failing Webflow all get the same answer". |
| Object-level authorization, non-enumerating failure | Pass | Same tests; "other sites are not reachable"; "a page of another site is refused whatever id the panel sends". |
| No reusable secret returned | Pass | The token never leaves the server. The panel gets no credential. |
| Outbound destinations from a server-side list, HTTPS, no user-supplied hosts | Pass | Fixed addresses only. `test/app.js`: "where the requests of the whole run went". |
| CORS names production origins, never `*` | Pass / Sitting | `/ext/*` answers one origin, the extension's own. Sitting: that the real origin is `https://<client id>.webflow-ext.com` (else set `EXT_ORIGINS`; a refused origin is logged). |
| Credentials encrypted at rest, per tenant | Pass | AES-256-GCM (`api/_lib/crypto.js`), one token per authorization. |
| No privileged decision trusts browser storage | Pass | The panel stores nothing. |
| Values put into scripts or markup are serialized and escaped | Pass | `esc()` for markup, `jsValue()` for the two values in inline scripts. |
| Uploads validated | N/A | No upload. |
| Actions attributed to the authenticated user | Pass | Server writes use the token of the user who authorized. In the panel the write is made by the Designer session of the person pressing Apply. |
| Dependency audit | Pass | `package.json` lists no dependency, so there is nothing to audit and no lockfile. |
| No staging, localhost or tunnel host; Install URL on production | Pass | One host in the bundle. The Install URL is `https://aiseodeck.silitlabs.com/auth`. |
| Install URL mints a single-use `state` bound to the browser | Pass | Tests: section "the install address and the OAuth state". |
| Client bundle holds client code only | Pass | Three text files and two fonts. |
| Logs hold no personal data or credentials | Pass | One logging function takes out email addresses and anything long enough to be a token; a test checks that no other module writes to the log. |

## Consent and lifecycle

| Item | Verdict | Where it is shown |
| --- | --- | --- |
| Scopes are the minimum, each direction used | Pass | Six scopes; the endpoint behind each is in the review notes and tested ("the scopes are the six the features use"). |
| Install URL scopes equal the configured ones | Sitting | Compare the app's settings with the six scopes. |
| Stops calling on revoke; 401 never retried | Pass | Tests: sections "uninstalled in Webflow" and "signed in keyword from the home page, uninstall detection". |
| Code on customer sites through the Custom Code API | N/A | The app puts no code on a site. |
| Injected scripts pinned; new version for every change | N/A | No script. |
| No dependence on the API after uninstall | Pass | Nothing is asked of Webflow once a token is refused. |
| Disconnect without revoking; connect again without OAuth | Pass | Tests: section "disconnect, and connect again without a new authorization". |
| Removal instructions for Webflow-side data the platform keeps | Pass | Guide, "What stays in Webflow, and how to remove it": applied titles and descriptions, and CMS drafts. |
| User is told to publish after an apply | Pass | Every Apply ends with "Publish your site in Webflow"; the panel says it too and sends the Designer's own notification. |

## Privacy and data handling

| Item | Verdict | Where it is shown |
| --- | --- | --- |
| Users are told what is collected, where it is kept and how it is used | Pass | `/privacy`: what is read, what is stored and for how long, what goes to which provider. |
| Reachable privacy policy | Pass | `https://aiseodeck.silitlabs.com/privacy` |
| Terms and privacy policy are separate pages | Pass | `/terms` and `/privacy`. |
| Stored data protected | Pass | Encrypted tokens, signed sessions, per-account checks on every site route. |
| On uninstall, data in our backend is deleted | Pass | Sites, answers, Site health and the token within a day; the account itself 30 days later when it has no paid plan. Tests: section "what is left of an account after the app was uninstalled everywhere". |
| Privacy laws | Pass, as far as code can show | No tracking, no analytics, deletion on request, a copy on request. Not legal advice. |

## Is it honest?

| Item | Verdict | Where it is shown |
| --- | --- | --- |
| Listing, screenshots and video match the behavior | Pass / Sitting | Listing and screenshots were made from this build. The video is recorded after the end-to-end run. |
| Fees are disclosed | Pass | Prices in USD with the yearly amounts and the trial terms, in the listing, the guide, the terms, the home page and the app. |
| No impersonation; affiliations stated | Pass | "Not affiliated with or endorsed by Webflow, OpenAI, Google, Anthropic or xAI" in the listing and the terms. |
| Contact information | Pass | info@silitlabs.com |
| One developer account | Owner | Silit Labs submits from one Webflow account. |
| No ads | Pass | None. |

## Listing assets

| Item | Verdict | Where it is shown |
| --- | --- | --- |
| Logo 900 x 900, a mark without text | Pass | `assets/marketplace/ai-seo-deck-logo.png` |
| Avatar 512 x 512 | Pass | `assets/marketplace/ai-seo-deck-avatar-512.png`, the same mark, for a field that asks for it. |
| 3 to 5 screenshots at 1280 x 846, under 2 MB | Pass | Five and a spare in `assets/marketplace/screenshots/`, each under 350 KB. All were made again after the panel's new design and the color fixes. |
| Demo video, 2 to 5 minutes, approve and deny | Sitting | Recorded by the owner after the end-to-end run; captions in English. |
| Homepage over HTTPS | Pass | `https://aiseodeck.silitlabs.com` |

## Account

| Item | Verdict | Where it is shown |
| --- | --- | --- |
| Two-factor authentication on a Workspace admin | Owner | To confirm before submitting. |

## Design and usability of the panel

| Item | Verdict | Where it is shown |
| --- | --- | --- |
| Style, type and color follow Webflow's design guidelines | Pass / Sitting | Webflow's tokens, Inter, 11.5px and 13px, 4px corners. `test/panel.js`: section "the look". Sitting: that the Designer provides its variables to the panel (then it follows Appearance; if not, it shows the default dark theme). |
| Clear navigation and labels, little input | Pass | One page view and one editor; two fields. |
| No keyboard shortcuts | Pass | No key handler. `test/app.js`: "has no keyboard shortcuts". |
| Alt text, keyboard, contrast | Pass | Every control and mark has a name; native controls with a focus ring; contrast measured in both themes. The web app and the public pages are measured the same way by `test/contrast.js`. |
| No long-running background work | Pass | No timer and no polling. The panel reads the page when it opens and when the page changes. |

## More from the published guidelines

| Rule | Verdict | Where it is shown |
| --- | --- | --- |
| OAuth is not started again at sign-in, session expiry or refresh | Pass | Signing in again is by an emailed one-time link. A signed-out visit to `/app` goes to `/login`, never to Webflow. |
| Signing out does not end the Webflow authorization | Pass | `/logout` clears the session cookie and asks Webflow nothing. |
| The authorization code is used once, at once, never logged or retried | Pass | `exchangeCode` in `api/_lib/webflow.js`: one request. |
| Rate limits: backoff with a maximum number of tries | Pass | `Retry-After` is honoured, else 2, 4, 8 seconds; three more tries at most. |
| Webflow stays the source of truth; fetched data shows when it was read and can be refreshed | Pass | Setup, Settings, Site health, each fix and the panel say when their Webflow data was read and have a refresh. |
| Derived data is kept apart from Webflow data; nothing is overwritten silently | Pass | "Now in Webflow" next to "Suggested"; "Suggested by AI" labels; the page is read again just before a write, and a changed page stops the write. |
| Localization: no localized content overwritten without the user knowing; locale on writes | Pass / Sitting | The server writes the primary locale (Webflow refuses a primary locale id on these calls, so none is named, and it is tested). The panel says what Apply does on a site with more than one language. Sitting, if the test site gets a second language: what the Designer does with `setTitle` in a secondary locale. |
| Three attestations on the OAuth token | Pass | Review notes, "Tokens: the three attestations". |
| Review account on the highest plan, not expiring, kept after approval | Pass | See "Demo access". |
| Cross-origin pages cannot read or change authenticated answers | Pass | Session cookie is `SameSite=Lax`, `HttpOnly`, `Secure`; every POST under `/app` and the sign-in link check the origin; no CORS headers outside `/ext/*`. Tests: "cross-site posts are blocked", "another origin gets no permission to call the panel routes". |

## For the sitting

In the order they come up:

1. The Designer Extension URI in the app's settings is `https://<client id>.webflow-ext.com`; the Install URL there is `https://aiseodeck.silitlabs.com/auth`; the redirect URI is `https://aiseodeck.silitlabs.com/callback`; the six scopes.
2. `COMPLIMENTARY_CODE` is set in Vercel (16 characters or more), and the same value is ready for the form's access field.
3. In the Designer: the panel opens, its text is Inter, and its colors follow the Appearance setting (try the light theme). No error in the browser console of the panel.
4. `POST /beta/token/resolve` answers with `siteId`; a cancelled authorization comes back with `error=access_denied`.
5. App Review Preflight on the final `bundle.zip` and `review.zip`. The bundle now holds two font files and their license text: if Preflight asks about them, they are the Inter typeface the design guidelines name, and the README in the review ZIP says so.
6. The usage graph of the database in Upstash.
7. Two-factor authentication, the demo video, the form.
