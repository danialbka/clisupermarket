# Local secrets (not committed)

Place sensitive exports here. Files in this directory are **gitignored** except this `README.md`.

## FairPrice cookies

Save a browser cookie export (same JSON shape as your extension) as:

`fairprice-cookies.json`

That file can include `auth_token`, `connect.sid`, and other session cookies. **Do not** paste it into chat, issues, or commits. Refresh the file when tokens expire.

Future CLI features may read this path for authenticated requests.

## Sheng Siong cookies

Save the same style of export as:

`sheng-siong-cookies.json`

Includes WAF/Incapsula cookies (`visid_incap_*`, `incap_ses_*`, `nlbi_*`) and the Meteor session cookie **`sess-key`**. Treat as sensitive; refresh when the site logs you out or DDP starts failing.
