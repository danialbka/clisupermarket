# Local secrets (not committed)

Place sensitive exports here. Files in this directory are **gitignored** except this `README.md`.

## FairPrice cookies

Save a browser cookie export (same JSON shape as your extension) as:

`fairprice-cookies.json`

That file can include `auth_token`, `connect.sid`, and other session cookies. **Do not** paste it into chat, issues, or commits. Refresh the file when tokens expire.

The **`cart`** CLI reads this file by default for FairPrice (`cart fp list|remove|clear|add|set`). Override with `-c` or **`FAIRPRICE_COOKIES`**.

## Sheng Siong cookies

Save the same style of export as:

`sheng-siong-cookies.json`

Includes WAF/Incapsula cookies (`visid_incap_*`, `incap_ses_*`, `nlbi_*`) and the Meteor session cookie **`sess-key`**. Treat as sensitive; refresh when the site logs you out or DDP starts failing.

For **`cart ss`**, if the CLI prints a **new** `sess-key` after `add` (stale cookie), paste that value into the export or set env **`SS_SESSION_KEY`** for `list` / `remove` until you refresh cookies from the browser.
