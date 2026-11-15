# AI SEO Deck: Designer Extension review source

This ZIP holds the Designer Extension exactly as it ships in bundle.zip. The extension has no build step, so these files are the shipped source, not a build output.

## Files

- `webflow.json`: the Webflow CLI manifest (name "AI SEO Deck", apiVersion 2, size comfortable, publicDir public).
- `public/index.html`, `public/app.css`, `public/app.js`: the extension. Plain HTML, CSS and JavaScript with no framework, no dependencies, no bundler, no minification and no transpiling, so there are no source maps to provide.

There is no package.json or lockfile for the extension, because it has no dependencies. The Webflow CLI is run with npx.

## How bundle.zip is made

1. In our repository the files sit in `extension/`: `webflow.json` and the `public/` folder.
2. From `extension/`, run `npx @webflow/webflow-cli extension bundle`.
3. The CLI packs `webflow.json` and the files of `public/` into `bundle.zip` (4 files, about 9 KB). That file is uploaded with "Publish extension version" in the app settings.

## What the extension talks to

- Designer API: `webflow.getSiteInfo`, `webflow.getCurrentPage`, the page getters (`getName`, `isHomepage`, `getPublishPath`, `getSlug`, `getTitle`, `getDescription`, `getCollectionId`), `page.setTitle`, `page.setDescription`, `webflow.getIdToken`, `webflow.setExtensionSize`, `webflow.subscribe('currentpage')` and `webflow.notify`.
- One server, `https://aiseodeck.silitlabs.com/ext/` (`context`, `suggest`, `faq`, `applied`), called with `fetch` and POST. Each request carries the Webflow ID token and the site id. The server resolves the token with `POST /token/resolve` using the stored Data Client token of that site and answers only when the token names the same site.
- Buttons such as "Open the full report" or "Connect" open aiseodeck.silitlabs.com pages in a new browser tab with `window.open`.
- No other network requests, no third-party scripts, no cookies, no local storage.
