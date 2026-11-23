# AI SEO Deck: Designer Extension, source for review

This ZIP holds the Designer Extension exactly as it ships in `bundle.zip`: the same seven files, at the same paths, byte for byte, and this README. The extension has no build step. The files are written by hand and shipped as they are, so they are the source and the shipped code at once. Nothing is minified, transpiled or generated, which is why there are no source maps to provide.

## Files

- `webflow.json`: the manifest the Webflow CLI reads (name "AI SEO Deck", apiVersion 2, size comfortable, publicDir public).
- `index.html`: the page of the panel. It loads `app.css` and `app.js` and has no inline script, style or event handler.
- `app.css`: the styles. Every color, text size and shadow is one of Webflow's CSS variables for apps (`--background1`, `--text1`, `--actionPrimaryBackground` and the others of Webflow's design guidelines), read with the value of the default dark theme as its fallback. The search preview alone has colors of its own, because it shows dark text on white in every theme. The stylesheet loads no image.
- `app.js`: the panel. Plain JavaScript in one file, with no framework and no dependencies, formatted with Prettier.
- `fonts/inter-latin-wght-normal.woff2` and `fonts/inter-latin-ext-wght-normal.woff2`: Inter, the typeface of Webflow's interface, for Latin text. `app.css` names these two files and nothing else.
- `fonts/OFL.txt`: the license of the typeface.

There is no `package.json` and no lockfile, because the extension has no code dependencies. The Webflow CLI is run with npx. The one third-party part is the typeface: Inter, copyright The Inter Project Authors, under the SIL Open Font License 1.1. The two font files are the Latin files of the npm package `@fontsource-variable/inter` 5.2.5, unchanged. They ship inside the panel, as Webflow's design guidelines describe, so no font is requested from another host.

`app.js` builds the interface with one small helper, `h(tag, attributes, ...children)`, defined at the top of the file. It creates elements with `document.createElement`, sets text with `textContent` and adds listeners with `addEventListener`. It never uses `innerHTML`, never writes a handler or a style attribute, and never creates a script element.

## How bundle.zip is made

1. In our repository the files are in `extension/`: `webflow.json`, and the folder `public/` with `index.html`, `app.css` and `app.js`.
2. From `extension/` we run `npx @webflow/webflow-cli extension bundle`.
3. The CLI writes `bundle.zip` with `webflow.json`, the three files of `public/` at its root, and the folder `fonts/`. That file is uploaded with "Publish extension version" in the settings of the app.
4. This review ZIP is made from the files inside that `bundle.zip`, plus this README (`node scripts/package-extension.js` in our repository, which also checks that the seven files are the same bytes as the source and that the bundle is under 5 MB).

## What the panel does

It shows, for the page open in the Designer, the keyword AI SEO Deck tracks for it, which AI engines name the site for that keyword, and what to fix on the page. The user can have a title and a description written by AI, edit them, and set them on the page.

## What the panel talks to

- The Designer API: `webflow.getSiteInfo`, `webflow.getCurrentPage`, `webflow.getIdToken`, `webflow.setExtensionSize`, `webflow.subscribe` (the `currentpage` event) and `webflow.notify`; and on the current page `getName`, `isHomepage`, `getPublishPath`, `getSlug`, `getTitle`, `getDescription`, `getCollectionId`, `setTitle` and `setDescription`. The two setters are the only writes, and they run only when the user presses "Apply to this page".
- One server, the backend of this Hybrid App: `https://aiseodeck.silitlabs.com/ext/context`, `/ext/suggest` and `/ext/applied`, called with `fetch` and POST. Every request carries a Webflow ID token asked for at that moment with `webflow.getIdToken()`, the site id, the page id and the page path. The token is not kept. The server resolves it with Webflow and answers only when Webflow names the same site; every caller it cannot confirm gets the same "connect" answer.
- Links ("Connect", "Open the setup", "Add a keyword", "Open Site health", "Refresh in Site health", "Open the full report", "see the plans") are ordinary `<a target="_blank" rel="noopener noreferrer">` links, all made by one function, `link()`. They open only when the user clicks them, and that function lets them point only to `https://aiseodeck.silitlabs.com/`.

## What it does not do

No other network request (the two font files are the panel's own), no third-party script, no cookie, no local or session storage, no timer, no keyboard shortcut, no `postMessage` and no `message` listener, no access to the document around the panel, no global variable, and no navigation of any frame. When it opens, the panel sets its size, listens for the page being changed in the Designer, reads the open page and asks the backend what is known about it. It writes nothing until the user presses Apply. When the user opens another page, an answer that arrives for the page before is dropped, and an Apply that was pressed finishes on the page it was pressed for.

## Design and accessibility

The panel follows Webflow's design guidelines for apps: Webflow's own tokens for color, type and shadow (so it follows the user's Appearance setting wherever the Designer provides them), 11.5px and 13px text in two weights, 4px corners, sentence case, and main actions that fill the width. Every control is a native button, link or field with a visible focus ring and a name. Every mark has a shape and a text label, so no state is told by color alone. Messages reach screen readers through a status line and `role="alert"`. On a site with more than one language, the editor says that Apply sets the values on the page as the Designer shows it.
