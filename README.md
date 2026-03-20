# clisupermarket

Live grocery homepage data from two Singapore retailers, **separate CLIs** (different stacks and data shapes).

| Command   | Store        | Mechanism |
|-----------|--------------|-----------|
| **`ss-live`** | [Sheng Siong](https://shengsiong.com.sg/) | Meteor **DDP** over `wss://shengsiong.com.sg/websocket` |
| **`fp-live`** | [FairPrice](https://www.fairprice.com.sg/) | Next.js **`__NEXT_DATA__`** JSON embedded in HTML |
| **`cart`** | FairPrice (and SS stub) | Authenticated **`website-api.omni.fairprice.com.sg`** cart HTTP (see below) |

**Caveat:** Respect each site’s terms, robots policy, and rate limits. Use for personal tooling, not aggressive scraping.

---

## Sheng Siong (`ss-live`)

[shengsiong.com.sg](https://shengsiong.com.sg/) is a **Meteor** app. The browser loads homepage blocks with `HomePageSections.getAllActive`, then loads products per block over **DDP**.

| Step | DDP method | Notes |
|------|------------|--------|
| Homepage layout | `HomePageSections.getAllActive` | Banner vs category sections |
| Teaser rows (~20 SKUs) | `Products.getByCategoryId` | Default CLI mode |
| Full category (all SKUs) | `Categories.getOneById` → `Products.getByAllSlugs` | `--full`; API returns **cumulative** pages (we slice new rows only) |
| Promo blocks | `CampaignPages.getProductsById` | When a section is type `campaignPage` |

```bash
npm install && npm run build
node dist/ss-live.js
node dist/ss-live.js --pretty
node dist/ss-live.js --full --page-size 80 -o ./out/sheng-siong.json
```

Product images: `https://ssecomm.s3-ap-southeast-1.amazonaws.com/products/…`.

---

## FairPrice (`fp-live`)

[www.fairprice.com.sg](https://www.fairprice.com.sg/) is **Next.js**. The server embeds the first screen of each homepage “swimlane” (product rails, category scroller, promos, banners) inside `<script id="__NEXT_DATA__">`. There is **no shared code** with Sheng Siong.

- **Product rails** (`ProductCollection`): includes `pagination` (`total_pages`, `page_size`). The HTML snapshot is usually **page 1** only; additional pages are loaded in the browser via their internal APIs (not implemented here).
- **Categories** (`CategoryCollection`): category tiles + slugs.
- **Promos** (`PromoCollection`): links to `promotions.fairprice.com.sg`.
- **Banners** (`ImageSlideShow`): hero / sub banners.

```bash
npm install && npm run build
node dist/fp-live.js
node dist/fp-live.js --pretty
node dist/fp-live.js --omit-products
node dist/fp-live.js -u 'https://www.fairprice.com.sg/' -o ./out/fairprice-home.json
```

Runtime API base (for reference only) appears in that JSON as `runtimeConfig.API_URL` → `https://website-api.omni.fairprice.com.sg/api` when you parse the full `__NEXT_DATA__` yourself.

---

## Cart (`cart`) — FairPrice session required

Uses a **logged-in** cookie export (same JSON as `secrets/fairprice-cookies.json`). **Mutates your real cart** on FairPrice; treat like production.

| Subcommand | API | Notes |
|------------|-----|--------|
| `cart fp list` | `GET /api/cart` | Table of lines; `--json` prints raw `items` |
| `cart fp remove <itemId>` | `DELETE /api/cart?storeId=&itemId=` | Line id from `list` |
| `cart fp clear` | Loops `DELETE` | Empties the cart |
| `cart fp add <productId> [qty]` | `POST /api/cart` | Merges into current cart using the **web app** shape: `{ storeId, cart: { items: [{ id, q, t }, ...] } }` (see `buildMergeCartPostBody` in source) |
| `cart fp set <itemId> <qty>` | `POST /api/cart` or `DELETE` if qty `0` | Same merge POST with updated `q`; **exits 2** if unchanged |

```bash
npm run build
node dist/cart.js fp list
node dist/cart.js fp list --json
node dist/cart.js fp add 1544421 2
node dist/cart.js fp set <itemId> 3
node dist/cart.js fp remove <itemId>
```

Override cookie path: `-c path/to/fairprice-cookies.json` or env **`FAIRPRICE_COOKIES`**.

### Sheng Siong (`cart ss`)

The site stores the cart in **Meteor session** data, not a separate REST cart API. The web app syncs Redux → **`Sessions.updateData`** with `{ sessionKey, dataSets: { cart: { items } } }` (see `sessionSaga.js` in their bundle). The DDP client sends the **`Cookie`** header (including **`sess-key`**) on the WebSocket handshake.

| Subcommand | DDP | Notes |
|------------|-----|--------|
| `cart ss list` | `Sessions.getSessionDataByKey` | Needs a **valid** `sess-key` (or **`SS_SESSION_KEY`** env). Stale browser exports often return no data until you add again. |
| `cart ss add <slug> [qty]` | `Products.getOneByIdOrSlug` + `Sessions.updateData` | Slug is the product URL segment. If `sess-key` is rejected (`Invalid checkout session`), the CLI creates a **new** session and prints the new key — set **`SS_SESSION_KEY`** or update your cookie file. |
| `cart ss remove <id>` | `Sessions.updateData` | `id` is the hex string from `ss list` (same as Mongo product `_id`). |
| `cart ss clear` | `Sessions.updateData` | Clears `cart.items`. |
| `cart ss create-session` | `Sessions.create` | Prints a fresh `sess-key` value. |

```bash
node dist/cart.js ss list
SS_SESSION_KEY='<paste from ss add>' node dist/cart.js ss list
node dist/cart.js ss add zenxin-organic-malaysia-baby-spinach-mix-80-g 2
```

Cookie path: `-c` or **`SHENG_SIONG_COOKIES`**. Session override: **`SS_SESSION_KEY`** (wins over `sess-key` in the JSON).

### FairPrice cart over `curl`

The same cookie export works with plain **`curl`** if you build the `Cookie` and `Authorization` headers. Below uses **`jq`** (install on Debian/Ubuntu: `apt install jq`). If you prefer not to use `jq`, run **`node dist/cart.js fp list`** instead.

```bash
COOKIE_FILE="${FAIRPRICE_COOKIES:-secrets/fairprice-cookies.json}"
COOKIE_HDR=$(jq -r '.cookies | map(.name + "=" + .value) | join("; ")' "$COOKIE_FILE")
TOKEN=$(jq -r '.cookies[] | select(.name == "auth_token") | .value' "$COOKIE_FILE")
curl -fsS \
  -H "Accept: application/json" \
  -H "Cookie: $COOKIE_HDR" \
  -H "Authorization: Bearer $TOKEN" \
  "https://website-api.omni.fairprice.com.sg/api/cart" | jq .
```

---

## Requirements

- Node **20+** (global `fetch`).

---

## Health (`health`) — local calorie + weight log

A **calendar-style** calorie log with an adjustable **daily kcal budget** (default + optional per-day overrides), plus a **weight** log with a configurable **weigh-in interval** (used to suggest when the next entry is due).

Data is stored as JSON (default: `~/.config/clisupermarket/health.json`, or `XDG_CONFIG_HOME/clisupermarket/health.json`). Override with `--file <path>`.

### Calories

| Command | Purpose |
|--------|---------|
| `health cal set-limit <kcal>` | Default daily limit (applies to all days unless overridden) |
| `health cal set-limit <kcal> -d YYYY-MM-DD` | Limit for **one day** only |
| `health cal clear-limit YYYY-MM-DD` | Remove a day override (falls back to default) |
| `health cal add <kcal> [-d YYYY-MM-DD] [-n note]` | Log a meal/snack |
| `health cal day [-d YYYY-MM-DD]` | One-day summary vs limit |
| `health cal month [YYYY-MM]` | Month grid: `day=total` (at/under limit) vs `day>total` (over) |

### Weight

| Command | Purpose |
|--------|---------|
| `health weight add <kg> [-d YYYY-MM-DD] [-n note]` | Log a weigh-in |
| `health weight list [--json]` | All entries |
| `health weight interval <days>` | How often you want to weigh in (e.g. `7` for weekly) |
| `health weight status` | Last weight, days since, and “next due” hint |

```bash
npm run build
node dist/health.js cal set-limit 2000
node dist/health.js cal add 450 -n lunch
node dist/health.js cal month
node dist/health.js weight add 72.4
node dist/health.js weight interval 7
node dist/health.js weight status
```

## Cursor agents

See [`.cursor/skills/clisupermarket/SKILL.md`](.cursor/skills/clisupermarket/SKILL.md) for when and how to run `fp-live` / `ss-live`, flags, and extension points.

## Optional: session cookies (gitignored)

Store browser cookie exports under [`secrets/`](secrets/README.md) (same JSON shape as your exporter):

| File | Store |
|------|--------|
| `secrets/fairprice-cookies.json` | FairPrice |
| `secrets/sheng-siong-cookies.json` | Sheng Siong |

The whole `secrets/` tree is ignored by git except `secrets/README.md`. Never commit tokens.
