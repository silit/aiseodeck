# Marketplace submission: what goes into each field of the form

The form is at developers.webflow.com/submit (sign in to Webflow first). The fields below are in the order the form had on 16 November 2026; Webflow changed the form since, so read every field of the live form and tell Claude about any that is not here. Text fields are saved by the form as you type; files are not.

Every statement here was checked against the build on `marketplace-rework`. Change this file only together with the app. Limits: app name 30 characters, short description 100, long description 10,000 (Markdown, no links), 5 features.

Fields marked `[to fill]` wait for the last steps: the end-to-end run, the final bundle, Preflight, the video and the screenshots.

## App info

| Field | Value |
| --- | --- |
| App Review Preflight receipt | `[to fill: wfpre_... from the run on the final bundle.zip and review.zip]` |
| Submission type | New App. The app was never approved, so this is not an App Update. If the form offers a choice for a resubmission after a review, take that one. |
| App name | AI SEO Deck |
| App Client ID | Copy it in Webflow: Silit Labs Workspace, Apps & Integrations, Develop, the menu on the AI SEO Deck row, Edit App, Building blocks, Data Client, Client ID, Copy. Close the window with Cancel. |
| App capabilities | Hybrid |
| Install URL | `https://aiseodeck.silitlabs.com/auth` |
| Scopes | Authorized user: read. Sites: read. Pages: read and write. CMS: read and write. Nothing else. |
| App icon image | `assets/marketplace/ai-seo-deck-logo.png` (900 x 900) |
| App icon image alt text | AI SEO Deck logo |
| Payment type | Free and Paid (tick both) |
| Marketplace visibility | Public |

The Install URL is the address above and never a `webflow.com/oauth/authorize...` address. The same address has to be in the app's settings in Webflow (App installation URL) before the form is sent. The first submission had the authorize address here; that is one of the things a review now refuses.

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
| Creator name | Silit Labs |
| Webflow account email | The email you sign in to Webflow with |
| Contact email | info@silitlabs.com |

## App details

| Field | Value |
| --- | --- |
| App category | AI and SEO (the form took two). If it takes more: Marketing, Analytics. |
| App preview description (short) | See if ChatGPT, Gemini, Claude, Grok and Google AI name your brand, keyword by keyword. |
| App detail description | The text under "Long description" below, between the two rules. |
| App promo video URL | Leave empty (optional). |
| App screenshots | The five pictures under "Screenshots" below, in that order, each with its alt text. |
| Source map artifact | `extension/review.zip`, made by `node scripts/package-extension.js` from the final `bundle.zip`. `[to fill: SHA-256 of both files]` |
| Website URL | https://aiseodeck.silitlabs.com |
| Additional notes | The text of `REVIEW.md`, from "The app" to the end, with its `[to fill]` fields filled. |
| App access credentials | No credentials are needed. Reviewers install with their own Webflow account through the Install URL. An account with an @webflow.com email gets the Agency plan automatically, with no checkout and no card, for as long as the account exists, so every feature is open. For another email, write to info@silitlabs.com and we turn it on the same day. |
| Published testing site | https://aiseodeck-demo.webflow.io `[to confirm after the end-to-end run: this build is installed on it]` |

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
| Review team demo video URL | `[to fill: the new recording, 2 to 5 minutes, with the install approved and denied]` |
| Documentation URL | https://aiseodeck.silitlabs.com/docs |
| Privacy policy URL | https://aiseodeck.silitlabs.com/privacy |
| How can users reach support? | By email at info@silitlabs.com, answered within one business day. The address is on the website and in the AI SEO Deck guide. |
| Support email | info@silitlabs.com |
| Terms and conditions URL | https://aiseodeck.silitlabs.com/terms |

## Acknowledgements

Tick the box yourself, check "Review your submission", then submit. Claude does not submit.

## Long description

Copy everything between the two rules below into "App detail description". Section titles are bold lines and there are no links, because the field takes Markdown without links.

---

AI SEO Deck shows whether AI assistants name and cite your brand when people ask about what you sell. You choose the keywords. It asks ChatGPT, Google AI Overviews, Google AI Mode, Gemini, Claude and Grok, and tells you keyword by keyword where you are named, where a rival is named instead, and what to improve on your Webflow pages.

**What it does**

**Checks every keyword on six AI engines.** Each keyword is asked as two questions a customer would ask on ChatGPT, Gemini, Claude and Grok, and as the search itself on Google AI Overviews and AI Mode. For each engine you see whether it names you, you can read every answer, and you follow your score from one check to the next.

**Shows who is named instead of you.** For each keyword you see the rivals the AI recommends, the websites it cites and the searches it ran before answering, so you know where to be listed or reviewed.

**Reads your pages through Webflow.** Site health lists, for each page, what keeps it from being quoted: a title or description that is missing, too short or too long, missing Open Graph values, no H1 or more than one, thin text, images without alt text. It also matches each keyword to the page that should win it. It reads your pages through the Webflow API, when you ask, and shows when they were read.

**Writes better titles, descriptions and answers from your own pages.** For a keyword or a page, an AI writes a new SEO title and meta description, and answers to the questions people ask, from what your page already says. You see the current value next to the suggestion and can edit it. Nothing reaches Webflow until you press Apply. A title and description arrive as an unpublished change to the page. Answers and new page drafts arrive as draft items in a CMS collection you choose. AI SEO Deck never publishes your site. Applying to Webflow is part of the paid plans; on the free plan you can copy every suggestion.

**Works inside the Designer.** Open AI SEO Deck from the Apps panel to see the keyword of the page you are on, which engines name you and what to fix. Write a title and description with AI and, on a paid plan, set them on the page with one click.

**Sends a report after every scheduled check.** You get an email with your visibility and your keywords, and you can turn it off. You can also create a read-only report link for a client; on the Studio and Agency plans it shows your agency name.

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

On a site with Webflow Localization, AI SEO Deck reads and writes the primary language only. The other languages keep their own text.

**Prices**

All prices are in US dollars (USD). Taxes may be added at checkout.

- **Free, USD 0:** 3 keywords on 1 site, checked once a month on ChatGPT, Google AI Overviews and Gemini. Site health for 20 pages. Suggestions to copy, no Apply.
- **Solo, USD 19 a month or USD 190 a year:** 10 keywords on 1 site, checked every week on all six engines. Apply to Webflow. 10 keyword checks on demand a month. Site health for 100 pages.
- **Studio, USD 49 a month or USD 490 a year:** 30 keywords across 5 sites. Everything in Solo, 30 keyword checks on demand a month, your agency name on client report links. Site health for 150 pages.
- **Agency, USD 149 a month or USD 1,490 a year:** 100 keywords across 20 sites. Everything in Studio, 100 keyword checks on demand a month. Site health for 250 pages.

Every paid plan starts with a 7-day free trial, once per customer across the products of Silit Labs. Polar, our payment provider, takes a card at the start and charges nothing during the trial. Cancel within the 7 days and you pay nothing. Otherwise the price of the plan is charged on day 8, and then every month or every year until you cancel. The free plan needs no card and has no time limit. There are no other fees, and no other account or subscription is needed.

When a paid plan or a trial ends, your account moves to the free plan. Nothing is deleted in AI SEO Deck or in Webflow; Apply is off, and the keywords and sites over the free plan's limits are kept but not checked.

**Removing the app**

Disconnecting a site in AI SEO Deck deletes what it keeps about that site and changes nothing in Webflow. To remove the app's access, uninstall it in Webflow: AI SEO Deck then deletes the sites of that authorization and everything kept about them. Titles, descriptions and CMS drafts you applied stay in Webflow, because they are your content.

**Documentation and support**

The AI SEO Deck guide covers setup, every screen, the panel in the Designer, what is written to Webflow and when, prices, and how to disconnect or uninstall. It is under Guide on aiseodeck.silitlabs.com, at aiseodeck.silitlabs.com/docs. Support: info@silitlabs.com, answered within one business day. The business shown in the screenshots is made up.

---

## Before this text is entered

- Checked at Polar on 23 November 2026: a monthly and a yearly product exist for Solo, Studio and Agency at these prices; "Trial conversion reminder" is on under Customer Notifications (Polar sends it 3 days before a 7-day trial ends); "Prevent trial abuse" is on under Subscriptions, and it counts a trial of any Silit Labs product, which is why the texts say one trial per customer across our products. Look again on the day of the submission.
- The demo video has to show this build: the install approved and denied, Site health reading from Webflow, a fix with "Now in Webflow" next to the suggestion, the panel in the Designer, Disconnect and connecting again.
- The logo: a logomark at 900x900, no text.
