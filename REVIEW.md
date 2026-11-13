# Webflow Marketplace review notes

App type: Data Client (OAuth, server side). No Designer Extension, no custom code on sites.

Scopes and why:
- authorized_user:read: create the account, send reports.
- sites:read: site names and domains (the brand's website for citation checks).
- pages:read: page titles, descriptions and existing JSON-LD, to match each keyword to its best page and for the audit.
- pages:write: only when the user presses Apply: PUT /v2/pages/{id} (seo title and description) and PUT /beta/pages/{id}/schema-markup.
- cms:read: list collections for the drafts picker (FAQ answers, a new page for a keyword).
- cms:write: only when the user presses Apply or "Add the draft to Webflow": items are created with isDraft true.

Webflow stays the source of truth: every fix is shown with the current value read live from Webflow, written only on Apply, as an unpublished change. Existing JSON-LD nodes are kept; only the same types are replaced. Nothing is published by the app.

Reviewers: any @webflow.com account gets the Agency plan for free.

Test flow: Connect Webflow > set up a site (brand, rivals, keywords; ideas are suggested) > the first check runs on the Keywords tab > open a keyword (yes, sometimes or no per AI engine, every answer) > What to do: Run the site audit, then Write the fixes > Apply to Webflow (title and description, FAQ schema, optional CMS drafts) > publish in Webflow > Check again.
