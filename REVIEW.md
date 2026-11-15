# Webflow Marketplace review notes

App type: hybrid. A Data Client (OAuth, server side) plus a Designer Extension (the panel in `extension/`, a static bundle with no framework). No custom code on sites.

Scopes and why:
- authorized_user:read: create the account, send reports.
- sites:read: site names and domains (the brand's website for citation checks).
- pages:read: page titles, descriptions and existing JSON-LD, to match each keyword to its best page and for the audit.
- pages:write: only when the user presses Apply: PUT /v2/pages/{id} (seo title and description) and PUT /beta/pages/{id}/schema-markup.
- cms:read: list collections for the drafts picker (FAQ answers, a new page for a keyword).
- cms:write: only when the user presses Apply or "Add the draft to Webflow": items are created with isDraft true.

Webflow stays the source of truth: every fix is shown with the current value read live from Webflow, written only on Apply, as an unpublished change. Existing JSON-LD nodes are kept; only the same types are replaced. Nothing is published by the app.

Reviewers: any @webflow.com account gets the Agency plan for free.

Test flow: Connect Webflow > set up a site (brand, rivals, keywords; ideas are suggested) > the first check runs and the site opens on its Overview (Do these next) > Keywords > open a keyword (which engines name you, then the Fix plan, What AI said and Related keywords tabs) > Site health: run the audit > Write the fixes > Apply to Webflow (title and description, FAQ schema, optional CMS drafts) > publish in Webflow > Check again.

Designer Extension: open a page of the connected site in the Designer > Apps > AI SEO Deck. The panel shows the page, the keyword that belongs to it with each engine, and what to fix. Title and description: Write with AI, change anything, Apply to this page (set with the Designer API: page.setTitle, page.setDescription). FAQ schema: Write answers with AI, Add FAQ schema (written by the server through the schema markup API, since the Designer API has none). A site that is not connected yet gets a Connect button.

How the panel authenticates: it calls webflow.getIdToken() and sends the ID token with the site id to /ext/*. The server resolves it with POST /beta/token/resolve using the stored Data Client token of that site, and answers only when the token names the same site. No cookies cross over; the panel's requests carry no session of the app. CORS on /ext/* only (Access-Control-Allow-Origin *, POST), since the ID token is what proves the user.

Localization: before every write the app reads the site's locales (GET /v2/sites/{id}) and names the primary locale. Titles and descriptions: PUT /v2/pages/{id}?localeId=<primary locale id>. CMS drafts: cmsLocaleId=<primary cmsLocaleId>. Schema markup is written without localeId, which the schema markup API documents as the primary locale (its localeId names a secondary locale). Secondary locales are never written. On sites with more than one language, the keyword and fix pages say next to Apply that fixes go to the primary language only.

Security:
- OAuth tokens are encrypted at rest (AES-256-GCM) in the app's server-side database and never reach the browser.
- Tokens are deleted on Disconnect and on account deletion (both also call /oauth/revoke_authorization), and when Webflow answers 401 (uninstall or revocation), which is checked before every scheduled check and on every write.
- The state parameter is created and verified for every sign in the app starts. Installs started from the Marketplace arrive without state and are exchanged without redirect_uri.
- Authorization codes are used once and never stored or logged.
- CORS headers are sent only on /ext/* (the Designer panel), which answers only to a valid Webflow ID token for the site; every other route sends none.
- Every site route checks that the site belongs to the signed in user.
- The site audit only fetches the connected site's own domains (an allowlist), refuses private and special IP addresses inside the DNS lookup, and caps response size.
