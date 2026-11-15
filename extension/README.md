# AI SEO Deck: Designer Extension review source

This ZIP holds the Designer Extension exactly as it ships in bundle.zip: the same four files, at the same paths, byte for byte. The extension has no build step, so these files are the shipped source, not a build output.

## Files

- `index.html`, `app.css`, `app.js`: the extension. Plain HTML, CSS and JavaScript (ES5), written by hand and formatted with Prettier. No framework, no dependencies, no bundler, no minification and no transpiling, so there are no source maps to provide.
- `webflow.json`: the Webflow CLI manifest (name "AI SEO Deck", apiVersion 2, size comfortable, publicDir public).

`app.js` builds the interface with a small helper, `h(tag, attributes, ...children)`, defined at the top of the file. It is handwritten, not compiled JSX: it calls `document.createElement`, sets text with `textContent` and never uses `innerHTML`.

There is no package.json or lockfile for the extension, because it has no dependencies. The Webflow CLI is run with npx.

## How bundle.zip is made

1. In our repository the files sit in `extension/`: `webflow.json` and the `public/` folder with `index.html`, `app.css` and `app.js`.
2. From `extension/`, run `npx @webflow/webflow-cli extension bundle`.
3. The CLI puts `webflow.json` and the files of `public/` at the root of `bundle.zip` (4 files, about 10 KB). That file is uploaded with "Publish extension version" in the app settings.

## What the extension talks to

- Designer API: `webflow.getSiteInfo`, `webflow.getCurrentPage`, the page getters (`getName`, `isHomepage`, `getPublishPath`, `getSlug`, `getTitle`, `getDescription`, `getCollectionId`), `page.setTitle`, `page.setDescription`, `webflow.getIdToken`, `webflow.setExtensionSize`, `webflow.subscribe('currentpage')` and `webflow.notify`.
- One server, our own backend for this Hybrid App: `https://aiseodeck.silitlabs.com/ext/` (`context`, `suggest`, `faq`, `applied`), called with `fetch` and POST. Each request carries the Webflow ID token and the site id, and no other credentials. The server resolves the token with `POST /token/resolve` using the stored Data Client token of that site and answers only when the token names the same site.
- Links such as "Open the full report", "Add a keyword" or "Connect" are ordinary `<a target="_blank" rel="noopener noreferrer">` links to aiseodeck.silitlabs.com. They open only when the user clicks them. Nothing opens on load or on a timer.
- No other network requests, no third-party scripts, no cookies, no local storage.
