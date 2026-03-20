---
name: clisupermarket
description: >-
  Fetches live Singapore supermarket homepage/catalog snapshots via two separate
  CLIs: FairPrice (Next.js __NEXT_DATA__) and Sheng Siong (Meteor DDP). Use when
  the user works in clisupermarket, wants FairPrice or Sheng Siong product or
  homepage data, grocery CLI, ss-live, fp-live, or live supermarket scraping.
---

# clisupermarket (agent usage)

## When this applies

Use this skill when the task involves the **clisupermarket** repo, or when the user asks for **live** product/homepage data from **NTUC FairPrice** (`fairprice.com.sg`) or **Sheng Siong** (`shengsiong.com.sg`). These are **two different systems**—do not mix their CLIs or assumptions.

## Setup (always run before CLIs)

From the repo root:

```bash
npm install
npm run build
```

Requires **Node 20+** (`fetch` for FairPrice; `ws` + `ejson` for Sheng Siong). Built entrypoints live under **`dist/`** (not committed).

## Command map

| Goal | Command | Mechanism |
|------|---------|-----------|
| FairPrice homepage rails (banners, product swimlanes, categories, promos) | `node dist/fp-live.js` | HTTP GET → parse `<script id="__NEXT_DATA__">` |
| Sheng Siong homepage sections + products | `node dist/ss-live.js` | WebSocket DDP → `wss://shengsiong.com.sg/websocket` |

## FairPrice — `fp-live`

- **Input:** HTML page (default `https://www.fairprice.com.sg/`). Override with `-u <url>`.
- **Output:** JSON sections: `ProductCollection`, `CategoryCollection`, `PromoCollection`, `ImageSlideShow`, `VoucherSwimlane`, etc.
- **Product rails:** First SSR page only for SKUs (`page_size` × page 1). `pagination.total_pages` shows how many pages exist on-site; **this repo does not** fetch page 2+ (would need their internal browse API).
- **Useful flags:** `--pretty` (stdout JSON), `-o <file>`, `--omit-products` (counts/metadata only, smaller output).

```bash
node dist/fp-live.js
node dist/fp-live.js --omit-products -o /tmp/fp.json
```

## Sheng Siong — `ss-live`

- **Default:** `HomePageSections.getAllActive` + `Products.getByCategoryId` (~20 SKUs per category strip).
- **Full category:** `--full` uses `Categories.getOneById` + paginated `Products.getByAllSlugs`. The server returns **cumulative** product lists per page; the code **slices** `cumulative.slice(alreadyLoaded.length)`—do not “append full array” per page.
- **Mongo ids on DDP:** Pass ObjectIds as JSON `{"$type":"oid","$value":"<24 hex>"}` in method params—not BSON `ObjectId` binary in EJSON.
- **Useful flags:** `--full`, `--page-size` (with `--full`), `--pause <ms>` between calls, `-o`, `--pretty`.

```bash
node dist/ss-live.js
node dist/ss-live.js --full --page-size 80 -o /tmp/ss.json
```

## Programmatic reuse (agents extending the repo)

- **FairPrice:** import from `./dist/fairpriceNextData.js` after build—`fetchFairpriceLiveCatalog(url, { includeProducts })`, `parseNextDataScript(html)`.
- **Sheng Siong:** import `./dist/shengSiongDdp.js`—`ShengSiongDdpClient`, `fetchAllProductsForCategorySlug`, `meteorOid`.

## Ethics and stability

- Respect each retailer’s **terms of use**, **robots.txt**, and **rate limits**. Prefer small delays (`--pause`) for Sheng Siong; avoid hammering FairPrice HTML.
- Site markup or DDP method names **can change**; failures may need bundle or HTML inspection again.

## Session cookies (local only)

Optional browser export JSON may live at:

- **`secrets/fairprice-cookies.json`** — FairPrice (`auth_token`, `connect.sid`, …)
- **`secrets/sheng-siong-cookies.json`** — Sheng Siong (`sess-key`, Incapsula/WAF cookies, …)

The `secrets/` tree is **gitignored** (except `secrets/README.md`). Do not commit or paste cookie files into issues or PRs.

## Related files

- `README.md` — human-oriented overview and examples
- `secrets/README.md` — where to put `fairprice-cookies.json`
- `src/fairpriceNextData.ts`, `src/fp-live.ts`
- `src/shengSiongDdp.ts`, `src/ss-live.ts`
