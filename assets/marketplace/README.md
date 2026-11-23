# Marketplace material

- The text for every field of the submission form: `docs/listing.md`.
- The notes for the reviewers: `REVIEW.md`.
- The logo: `ai-seo-deck-logo.png` here (900 x 900, a mark without text), and `ai-seo-deck-avatar-512.png`, the same mark at 512 x 512 for a field that asks for an avatar of that size.
- The review ZIP: `extension/review.zip`, made by `node scripts/package-extension.js` from the final `extension/bundle.zip`.
- The screenshots of this build are in `screenshots/` (five for the listing and one spare), made by `node scripts/marketplace-shots.js <folder> [fonts folder]` from the app itself with a made-up business. Their alt texts are in `docs/listing.md`.

- The demo video: `scripts/demo-video/make_video.py` cuts a screen recording and burns English captions into it (`--captions` names the caption file of that recording). The captions of the new video are written after the end-to-end run, from what that run showed.

`previous/` and `screenshots/first-submission/` hold what was sent on 16 November 2026 and refused on 23 November 2026: the listing text, the review notes, the scripts and captions of the demo video and the five screenshots. They describe features the app no longer has (the audit of the published site, schema markup) and the Install URL that a review now refuses. Keep them for the record and take nothing from them. `screenshots/previous/` is older still.
