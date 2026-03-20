# clisupermarket

Live grocery homepage data from two Singapore retailers, **separate CLIs** (different stacks and data shapes).

| Command   | Store        | Mechanism |
|-----------|--------------|-----------|
| **`ss-live`** | [Sheng Siong](https://shengsiong.com.sg/) | Meteor **DDP** over `wss://shengsiong.com.sg/websocket` |
| **`fp-live`** | [FairPrice](https://www.fairprice.com.sg/) | Next.js **`__NEXT_DATA__`** JSON embedded in HTML |

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

## Requirements

- Node **20+** (global `fetch`).

## Cursor agents

See [`.cursor/skills/clisupermarket/SKILL.md`](.cursor/skills/clisupermarket/SKILL.md) for when and how to run `fp-live` / `ss-live`, flags, and extension points.

## Optional: FairPrice session cookies

To keep a local browser cookie export for future authenticated tooling, save it as [`secrets/fairprice-cookies.json`](secrets/README.md). That path is **gitignored**; see [`secrets/README.md`](secrets/README.md). Never commit tokens.
