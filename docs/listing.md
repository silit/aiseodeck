# Marketplace submission: what goes into each field of the form

**Submitted on 25 November 2026 at 10:49 (Europe/Istanbul).** Webflow's answer: "Thank you! Your submission has been received.", Reference ID `c9a4039e-4b94-4ad1-81a1-10cc77f4c3a8`, and by email ticket #1225904 ("No action required at the moment"). The review and its outcome come on that email thread, in the info@silitlabs.com mailbox. The page names 10 to 15 business days.

The form is at developers.webflow.com/submit. That page shows `https://webflow-app-form.webflow.io/app-form/complete-form` in a frame, and the form can be opened at that address itself. "Sign in with Webflow" opens Webflow's authorize screen for its own app "Marketplace Submission Form" (it reads the authorized user and the sites); the Silit Labs Workspace was chosen there. The fields below are the ones the form had on 25 November 2026, with the values entered for this resubmission. The form keeps the text as a draft in the browser. It does not keep files: after a reload, "Resume draft" brings the text back and the five screenshots and the review ZIP are uploaded again.

Every statement here was checked against the build on `main`. Change this file only together with the app. Limits read in the form: short description 100 characters, long description 10,000, the alt text of a screenshot 256, notes 5,000, access credentials 2,000, backend runtime version 40, five features, four to five screenshots of 1280 x 846 and at most 2 MB each, an icon of 900 x 900 as a PNG of at most 50 KB.

The texts as they were entered are in `assets/marketplace/resubmission-2026-11/`: the long description, the notes and the access text (with a placeholder where the access code goes).

### What the form checks by itself

Learned while filling it on 24 and 25 November 2026:

- **Client ID.** With "New App" the check answers "Client ID taken. Please submit an update." Webflow knows the client ID of the app from the first submission, so this resubmission is an **App Update** of the kind **App functionality, permissions, or bundle**. "Load Existing App Data" then fills the form with the first listing, and every part of the form has a switch that says whether the update changes it.
- **Lists.** The lists of the first listing's long description did not come back with the existing data. The description is entered as paragraphs, with "• " at the start of a list line, and with no list markup.
- **"Agency".** The words "your agency" or "our agency" in the long description bring up a warning that the listing may read like agency or consulting services. The name of the plan, Agency, does not. The description therefore says "your business name" where the app's field is called "Agency name on client report links".
- **"Checkout".** The word "checkout" in the access credentials brings up a blocker ("Reviewers will not pay, subscribe, or enter a card"), and Submit stays off until the list of items to fix is empty. "Card", "plan" and "access code" do not bring it up. The access text does not use the word.
- **Runtime version.** The form asks for the version of the backend runtime. The server writes it to the log at each cold start (`[aiseodeck] start, Node.js v26.13.1`, read in Vercel on 25 November 2026).

## App info

| Field | Value |
| --- | --- |
| App Review Preflight receipt | `wfpre_ac0fe18c274fefca44b42bbe32f422bb`, from the run of 24 November 2026 on the `bundle.zip` and `review.zip` named under App details |
| Submission type | App Update (see "What the form checks by itself") |
| What kind of app update | App functionality, permissions, or bundle |
| App name | AI SEO Deck. The field is locked in an update. |
| App Client ID | Copy it in Webflow: Silit Labs Workspace, Apps & Integrations, Develop, the menu on the AI SEO Deck row, Edit App, Building blocks, Data Client, Client ID, Copy. Close the window with Cancel. "Check Client ID" answers "Client ID successfully verified". |
| Update App Capabilities & Install URL | On |
| App capabilities | Hybrid |
| Install URL | `https://aiseodeck.silitlabs.com/auth` |
| Scopes | Authorized user: read-only. Sites: read-only. Pages: read and write. CMS: read and write. Nothing else. |
| Does the app run server-side code | Yes |
| Backend hosting model | Serverless / PaaS |
| Backend runtime | Node.js |
| Backend runtime version | 26.13 (the project's Node.js Version setting in Vercel is 26.x; the log line of a cold start gave v26.13.1) |
| Backend hosting provider | Vercel |
| Backend frameworks | No framework |
| Backend web servers and proxies | Managed by hosting platform |
| Does this update include a new or changed app bundle | Yes |
| Update App Icon | Off. The icon Webflow has on file is `assets/marketplace/AI SEO Deck logo.png` (900 x 900, a solid background, alt text "AI SEO Deck logo"). If the icon is ever uploaded again, take that file: the form asks for a PNG with no transparent areas and takes the name of the file as the alt text. `ai-seo-deck-logo.png` has transparent corners and is not for the form. |
| Update Payment Type & Visibility | Off. On file: Free and Paid; Public. |

The Install URL is the address above and never a `webflow.com/oauth/authorize...` address. It is given in this form and nowhere else: the app's settings in Webflow have no field for it (read on 24 November 2026: App info holds the name, the description, the icon, the homepage and the site restriction; Building blocks holds the Designer Extension URI, the client id and secret, the redirect URI and the scopes). The first submission had the authorize address here; that is one of the things a review now refuses.

Read in the app's settings on 24 November 2026, and as this build expects: redirect URI `https://aiseodeck.silitlabs.com/callback`; Authorized user read-only, CMS read and write, Pages read and write, Sites read-only, every other permission "No access"; Designer Extension URI `https://6af730d2ef364c450fd995ce.webflow-ext.com`. The app description there ("Every AI, one deck. See if ChatGPT, Google AI, Gemini, Claude and Grok recommend you, then fix your Webflow site.") still describes this build and stays.

### Why each scope is asked for (for the scope fields of the form)

- **Authorized user, read:** to make the account from the Webflow user (id, name, email) with `GET /v2/token/authorized_by`, to learn whether a stored token still works, and to resolve the ID token of the Designer panel with `POST /beta/token/resolve`.
- **Sites, read:** the names, addresses (custom domains and the webflow.io address) and languages of the authorized sites, with `GET /v2/sites` and `GET /v2/sites/{site_id}`. Setup asks for no website address because of this.
- **Pages, read:** Site health and the suggestions. `GET /v2/sites/{site_id}/pages` and `GET /v2/pages/{page_id}` give each page's SEO and Open Graph settings; `GET /v2/pages/{page_id}/dom` gives the text, headings and images of a static page. The app requests no published website.
- **Pages, write:** only when the user presses Apply for one page: `PUT /v2/pages/{page_id}` with the SEO title and meta description. The change arrives unpublished.
- **CMS, read:** `GET /v2/sites/{site_id}/collections` and `GET /v2/collections/{collection_id}`, so the user can choose the collection and the app can find its text field.
- **CMS, write:** only when the user presses Apply or Add the draft to Webflow: `POST /v2/collections/{collection_id}/items` with `isDraft: true`. Draft items only, never published.

## Creator info

| Field | Value |
| --- | --- |
| Update Creator Information | Off. On file from the first submission: Silit Labs, the email of the Webflow account, and info@silitlabs.com as the contact email. The form does not show the two email addresses of an existing listing. |

## App details

| Field | Value |
| --- | --- |
| Update App Category | Off. On file: AI and SEO. |
| Update App Descriptions | On |
| App preview description (short) | See if ChatGPT, Gemini, Claude, Grok and Google AI name your brand, keyword by keyword. |
| App detail description | The text under "Long description" below, between the two rules, entered as paragraphs (7,309 characters with its markup). |
| App promo video URL | Empty (optional). |
| Update App Screenshots | On |
| App screenshots | The five pictures under "Screenshots" below, in that order, each with its alt text. |
| Update Features Overview | On, with the five lines under "Features overview" below. |
| Source map artifact | `extension/review.zip`, made by `node scripts/package-extension.js` from the final `bundle.zip`. Built on 24 November 2026: `bundle.zip` 137,756 bytes, SHA-256 `a2d5856f28cedb96e77c95a86ae3084f05b9b03387407a50c8c1082b7dd1fe97`; `review.zip` 140,346 bytes, SHA-256 `06d32b2fce8890b3612b4897143e655ff4d806c912e225c6f054287e02d715e3`. The two files are kept on the owner's computer in `Downloads\aiseodeck-submission`; a new run of the bundler gives a file with another checksum, so these are the ones to upload. |
| Update URLs & Developer Notes | On |
| Website URL | https://aiseodeck.silitlabs.com |
| Developer notes | A summary of `REVIEW.md` in 4,829 characters (the field takes 5,000), which starts by linking to `REVIEW.md` in the public repository for the detail and the evidence. The text is in `assets/marketplace/resubmission-2026-11/notes.txt`. |
| Published testing site | https://aiseodeck-demo.webflow.io (this build is installed on it and the site is connected; the form checks the address) |
| Update App Access Credentials | On |
| App access credentials | The text in `assets/marketplace/resubmission-2026-11/credentials.txt` (935 characters before the code): no login is needed, because reviewers install with their own Webflow account from the Install URL; an account on an @webflow.com address is on the Agency plan, the highest, automatically and for as long as it exists; a reviewing account on another address opens Account and, under Plan, enters the access code in the field "Access code"; coming back later is by "Sign in" and a one-time link; and the test site. The access code is the value of `COMPLIMENTARY_CODE` in Vercel. The owner types it into the form himself; it is written nowhere else. |
| I confirm that the provided information above is accurate ... and will remain valid permanently | Ticked by the owner. This is a promise: the value of `COMPLIMENTARY_CODE` in Vercel stays as it is for as long as the app is listed. A changed or removed value closes the reviewers' access and pauses a review. |

### Screenshots (1280 x 846, in `assets/marketplace/screenshots/`)

They are made from this build by `node scripts/marketplace-shots.js`, with a made-up business (Tallyhawk). Make them again if a screen changes before the submission.

1. `1-ai-visibility.png`. Alt text: AI SEO Deck overview of a site: 32 percent of AI answers name the brand, how many keywords each of six AI engines names it for, and the keywords to fix next
2. `2-every-engine.png`. Alt text: Keyword table with one column per AI engine: a yellow mark when the engine names the brand and a blue ring when it also links to the site, with monthly searches, visibility and a four-week trend
3. `3-what-ai-said.png`. Alt text: One keyword in detail: four of six AI engines name the brand, with the answers ChatGPT gave, the rivals it named, the searches it ran and the sites it cited
4. `4-fix-in-webflow.png`. Alt text: The fix for one page: the title and description Webflow has now next to the ones suggested by AI, and the Apply to Webflow button that saves them as unpublished edits
5. `5-designer-panel.png`. Alt text: The AI SEO Deck panel in the Webflow Designer: the keyword of the open page on each AI engine, a title and description suggested from the page, and the message after Apply to this page

A sixth picture is ready in case one is swapped: `extra-site-health.png`. Alt text: Site health: every page with its score and what to fix, read from Webflow through its API, with a Refresh from Webflow button

### Features overview (five lines)

1. Six AI engines checked for every keyword, with live web search
2. Who AI names instead of you: rivals, cited sites and its searches
3. Site health for your pages, read through the Webflow API
4. Titles, descriptions and CMS drafts you approve, applied unpublished
5. A panel in the Designer for the page you are editing

## Support info

| Field | Value |
| --- | --- |
| Update Support Information | On |
| Review team demo video URL | https://youtu.be/C_RxaD_-Rz4 (unlisted, 4 minutes 26 seconds, 1920 x 1080, recorded on the live app on 24 November 2026, with the install denied and approved). It plays for a viewer who is not signed in; checked on 25 November 2026. |
| Documentation URL | https://aiseodeck.silitlabs.com/docs |
| Privacy policy URL | https://aiseodeck.silitlabs.com/privacy |
| How can users reach support? | By email at info@silitlabs.com, answered within one business day. The address is on the website and in the AI SEO Deck guide. |
| Support email | info@silitlabs.com |
| Terms and conditions URL | https://aiseodeck.silitlabs.com/terms |

## Acknowledgements

The last box of the form: "By checking this box, you agree to Webflow's Privacy Policy, Terms of Service, and Developer Terms of Service." Claude filled the form and read "Review your submission" until it listed nothing to fix. On 25 November 2026 the owner typed the access code and ticked the two boxes himself, and Claude pressed Submit.

The session of "Sign in with Webflow" does not last a night: a Submit on the morning after the sign-in was answered with 401 and the form asked to sign in again. Signing in again in another tab and pressing "I have signed in" brought the form back with every value and file, and the second Submit went through. Sign in on the day of the submission.

## Long description

The text between the two rules below is the "App detail description". The field is a rich text editor: section titles are bold lines, a list line starts with "• " and is a paragraph of its own (see "What the form checks by itself"), and there are no links. The text exactly as it was entered, with its markup, is `assets/marketplace/resubmission-2026-11/long-description.html`.

---

AI SEO Deck shows whether AI assistants name and cite your brand when people ask about what you sell. You choose the keywords. It asks ChatGPT, Google AI Overviews, Google AI Mode, Gemini, Claude and Grok, and tells you keyword by keyword where you are named, where a rival is named instead, and what to improve on your Webflow pages.

**What it does**

**Checks every keyword on six AI engines.** Each keyword is asked as two questions a customer would ask on ChatGPT, Gemini, Claude and Grok, and as the search itself on Google AI Overviews and AI Mode. For each engine you see whether it names you, you can read every answer, and you follow your score from one check to the next.

**Shows who is named instead of you.** For each keyword you see the rivals the AI recommends, the websites it cites and the searches it ran before answering, so you know where to be listed or reviewed.

**Reads your pages through Webflow.** Site health lists, for each page, what keeps it from being quoted: a title or description that is missing, too short or too long, missing Open Graph values, no H1 or more than one, thin text, images without alt text. It also matches each keyword to the page that should win it. It reads your pages through the Webflow API, when you ask, and shows when they were read.

**Writes better titles, descriptions and answers from your own pages.** For a keyword or a page, an AI writes a new SEO title and meta description, and answers to the questions people ask, from what your page already says. You see the current value next to the suggestion and can edit it. Nothing reaches Webflow until you press Apply. A title and description arrive as an unpublished change to the page. Answers and new page drafts arrive as draft items in a CMS collection you choose. AI SEO Deck never publishes your site. Applying to Webflow is part of the paid plans; on the free plan you can copy every suggestion.

**Works inside the Designer.** Open AI SEO Deck from the Apps panel to see the keyword of the page you are on, which engines name you and what to fix. Write a title and description with AI and, on a paid plan, set them on the page with one click.

**Sends a report after every scheduled check.** You get an email with your visibility and your keywords, and you can turn it off. You can also create a read-only report link for a client; on the Studio and Agency plans it shows your business name.

**What you need before you start**

- A Webflow site and the right to authorize apps for it. No particular Webflow Workspace plan or site plan is needed.
- For CMS drafts: a site with the Webflow CMS and a collection that has a Rich text or Plain text field. Everything else works without the CMS.
- For the panel: access to the Designer of the site.
- Nothing is installed on your site. AI SEO Deck adds no script, code or element to your pages.
- No other account. Your AI SEO Deck account is made when you authorize the app, with the email of your Webflow account.

**What setup asks for**

Your brand name as people say it, other names it goes by (optional), the country your customers are in, the language of your keywords, up to five rivals by name (optional), and the keywords to track. You can type keywords or ask for suggestions written from your home page. Setup does not ask for a website address: the addresses of your site come from Webflow. The first check starts when you save.

**How people use it**

- A company that sells a bookkeeping app tracks "bookkeeping app for freelancers" and sees that two engines name a rival. Site health matches the keyword to its Freelancers page. The owner applies a clearer title and description, publishes in Webflow, and checks the keyword again the next week.
- An agency tracks 30 keywords across five client sites and shares a report link with each client after the weekly check.
- A designer opens the panel in the Designer on a service page, sees that the page has no meta description, writes one with AI and sets it on the page before publishing.

**Languages**

On a site with Webflow Localization, AI SEO Deck reads and checks the primary language, and the web app writes titles, descriptions and CMS drafts to that language only. In the Designer panel, Apply sets the values on the page as the Designer shows it, and the panel says so on a site with more than one language.

**Prices**

All prices are in US dollars (USD). Taxes may be added at checkout.

- **Free, USD 0:** 3 keywords on 1 site, checked once a month on ChatGPT, Google AI Overviews and Gemini. Site health for 20 pages. Suggestions to copy, no Apply.
- **Solo, USD 19 a month or USD 190 a year:** 10 keywords on 1 site, checked every week on all six engines. Apply to Webflow. 10 keyword checks on demand a month. Site health for 100 pages.
- **Studio, USD 49 a month or USD 490 a year:** 30 keywords across 5 sites. Everything in Solo, 30 keyword checks on demand a month, your business name on client report links. Site health for 150 pages.
- **Agency, USD 149 a month or USD 1,490 a year:** 100 keywords across 20 sites. Everything in Studio, 100 keyword checks on demand a month. Site health for 250 pages.

Every paid plan starts with a 7-day free trial, once per customer across the products of Silit Labs. Polar, our payment provider, takes a card at the start and charges nothing during the trial. Cancel within the 7 days and you pay nothing. Otherwise the price of the plan is charged on day 8, and then every month or every year until you cancel. The free plan needs no card and has no time limit. There are no other fees, and no other account or subscription is needed.

When a paid plan or a trial ends, your account moves to the free plan. Nothing is deleted in AI SEO Deck or in Webflow; Apply is off, and the keywords and sites over the free plan's limits are kept but not checked.

**Removing the app**

Disconnecting a site in AI SEO Deck deletes what it keeps about that site and changes nothing in Webflow. To remove the app's access, uninstall it in Webflow: AI SEO Deck then deletes the sites of that authorization and everything kept about them. Titles, descriptions and CMS drafts you applied stay in Webflow, because they are your content.

**Documentation and support**

The AI SEO Deck guide covers setup, every screen, the panel in the Designer, what is written to Webflow and when, prices, and how to disconnect or uninstall. It is under Guide on aiseodeck.silitlabs.com, at aiseodeck.silitlabs.com/docs. Support: info@silitlabs.com, answered within one business day. The business shown in the screenshots is made up.

AI SEO Deck is made by Silit Labs. It is not affiliated with or endorsed by Webflow, OpenAI, Google, Anthropic or xAI.

---

## What was checked before this text was entered

- Checked at Polar on 23 November 2026: a monthly and a yearly product exist for Solo, Studio and Agency at these prices; "Trial conversion reminder" is on under Customer Notifications (Polar sends it 3 days before a 7-day trial ends); "Prevent trial abuse" is on under Subscriptions, and it counts a trial of any Silit Labs product, which is why the texts say one trial per customer across our products.
- The demo video shows this build: the install denied and approved, setup, the first check, Site health reading from Webflow, a page fix and a keyword fix with "Now in Webflow" next to the suggestion, the panel in the Designer, Disconnect and connecting again, where to uninstall, and the prices. Its scenes and captions are in `assets/marketplace/resubmission-2026-11/demo-video-scenes.json`.
- The logo: a logomark at 900 x 900, no text, on a solid background.

## The new version of the panel (Publish extension version)

Where: Silit Labs Workspace, Apps & Integrations, Develop, the AI SEO Deck row, **Publish extension version**. Read on 24 November 2026; nothing was uploaded then.

| Field | Value |
| --- | --- |
| Upload zip file | `extension/bundle.zip`, the file `node scripts/package-extension.js` has checked (seven files). Only `.zip` is taken. |
| Select distribution | **Publish for internal testing (Workspace only)**. The other choice is greyed out until the app is in the Marketplace ("Submit an App before publishing a Designer Extension for review"). |
| Submission version notes | Required. The field comes filled with four headings; keep them and put the text below under them. |

The published versions were three, all of 15 November 2026, each with a one-line note. The fourth was published on 24 November 2026 from the `bundle.zip` named above, for internal testing, with the notes below.

---

# New Features
- The panel follows the page that is open in the Designer. When another page is opened it shows that page's keyword, how each AI engine answered, and the page's title and description, with no reload.
- On a site with more than one language the editor says, before anything is applied, that Apply sets the values on the page as the Designer shows it now, and names the language the suggestion was written from.
- "Read this page again" reads the page's data from Webflow again.

# Changes/Fixes
- Everything the panel shows about a page comes from the Webflow Data API through our server, and from the Designer API for the open page. No published page is read, by the panel or by the server.
- The schema features are gone (FAQ, Organization and WebSite schema), so no feature uses a beta endpoint.
- An answer that arrives for a page the user has left is dropped. An Apply finishes on the page it was pressed for. If the Designer takes the title and not the description, the panel says so.
- The script does not name the window around the panel, has no inline handlers, builds no HTML from strings and keeps nothing in the browser.

# Improvements
- Design: Webflow's CSS variables for apps, so the panel follows the Appearance setting. Inter at 11.5px and 13px, 4px corners, sentence case, main actions that fill the width. Inter ships in the bundle (two .woff2 files and their license, SIL Open Font License 1.1), so no font is loaded from another host.
- Accessibility: every control has a name and a visible focus ring, no state is told by color alone, messages reach screen readers, and contrast is at least 4.5 to 1 for text and 3 to 1 for icons in the dark and the light theme.
- The bundle is seven files written by hand: no build step, no dependency, no source map.

# Resolution notes
Review of 23 November 2026, ticket #1221544. The full reply is in the review notes of the submission.
1. Site audit outside the API: the audit is removed. Site health and every suggestion are built on GET /v2/sites/{site_id}/pages and GET /v2/pages/{page_id}/dom. The app requests no customer website.
2. Beta endpoints: every schema-markup call is removed, in the web app and in the panel. One call outside /v2 remains, for identity only: POST /beta/token/resolve, which resolves the Designer's ID token.
3. Domains typed by the user: setup asks for no website address. The site's addresses are read from GET /v2/sites/{site_id}.
4. Listing description: rewritten. It says what the app does, what is needed first, what setup asks, the prices in US dollars with the yearly amounts and the trial terms, and names the documentation.
5. Documentation: the guide covers the whole app, with a section on the panel in the Designer and on what is needed in Webflow (no particular plan).

---
