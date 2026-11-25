# Marketplace material

- The text for every field of the submission form: `docs/listing.md`.
- The notes for the reviewers: `REVIEW.md`.
- The logo for the form: `AI SEO Deck logo.png` here (900 x 900, a mark without text on a solid background; the form takes no transparent areas and uses the name of the file as the alt text). Webflow has this file on file from the first submission. `ai-seo-deck-logo.png` is the same mark with transparent corners, for our own pages and the title card of the demo video, and `ai-seo-deck-avatar-512.png` is the mark at 512 x 512 for a field that asks for an avatar of that size.
- The review ZIP: `extension/review.zip`, made by `node scripts/package-extension.js` from the final `extension/bundle.zip`.
- The screenshots of this build are in `screenshots/` (five for the listing and one spare), made by `node scripts/marketplace-shots.js <folder> [fonts folder]` from the app itself with a made-up business. Their alt texts are in `docs/listing.md`.

- The demo video of the resubmission: `scripts/demo-video/build_stills.py` builds it from captures of the live app and the scene list `resubmission-2026-11/demo-video-scenes.json` (a caption under each picture, 1920 x 1080). `scripts/demo-video/make_video.py` is the tool of the first submission: it cuts a screen recording and burns captions into it.
- What was entered in the form on 25 November 2026, as it was entered, and Webflow's answer: `resubmission-2026-11/`.

`previous/` and `screenshots/first-submission/` hold what was sent on 16 November 2026 and refused on 23 November 2026: the listing text, the review notes, the scripts and captions of the demo video and the five screenshots. They describe features the app no longer has (the audit of the published site, schema markup) and the Install URL that a review now refuses. Keep them for the record and take nothing from them. `screenshots/previous/` is older still.
