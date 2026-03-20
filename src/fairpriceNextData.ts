/** FairPrice Online (Next.js) — homepage payload is embedded in `__NEXT_DATA__`. */

export const FAIRPRICE_DEFAULT_URL = 'https://www.fairprice.com.sg/';

type UnknownRecord = Record<string, unknown>;

export type FpBrowseMeta = {
  indexName?: string;
  queryId?: string;
  isBrowseApi?: boolean;
};

export type FpPagination = {
  page: number;
  page_size: number;
  total_pages: number;
};

export type FpLiveSection = {
  website: 'fairprice';
  component: string;
  status?: string;
  title?: string;
  subtitle?: string;
  /** `layout.data` with very long fields optionally trimmed */
  layoutData?: UnknownRecord;
  collectionType?: string;
  collectionSlug?: string;
  sorting?: string;
  productCount?: number;
  pagination?: FpPagination;
  browseMeta?: FpBrowseMeta;
  products?: unknown[];
  categories?: unknown[];
  promos?: unknown[];
  banners?: unknown[];
  vouchers?: unknown;
};

export type FpLiveCatalog = {
  fetchedAt: string;
  sourceUrl: string;
  website: 'fairprice';
  nextBuildId?: string;
  pageTitle?: string;
  pagePath?: string;
  sections: FpLiveSection[];
};

function asRecord(v: unknown): UnknownRecord | undefined {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as UnknownRecord) : undefined;
}

function getLayouts(nextData: unknown): unknown[] {
  const root = asRecord(nextData);
  const props = asRecord(root?.props);
  const pageProps = asRecord(props?.pageProps);
  const envelope = asRecord(pageProps?.data);
  const inner = asRecord(envelope?.data);
  const page = asRecord(inner?.page);
  const layouts = page?.layouts;
  return Array.isArray(layouts) ? layouts : [];
}

function trimLayoutData(data: UnknownRecord): UnknownRecord {
  const copy = { ...data };
  if (typeof copy.storeIds === 'string' && copy.storeIds.length > 200) {
    copy.storeIds = `[trimmed ${copy.storeIds.split(',').length} store ids]`;
  }
  return copy;
}

function extractSection(layout: UnknownRecord, opts: { includeProducts: boolean }): FpLiveSection {
  const name = String(layout.name ?? 'Unknown');
  const status = layout.status !== undefined ? String(layout.status) : undefined;
  const data = asRecord(layout.data);
  const value = asRecord(layout.value);

  const base: FpLiveSection = {
    website: 'fairprice',
    component: name,
    status,
    title: data?.title !== undefined ? String(data.title) : value?.title !== undefined ? String(value.title) : undefined,
    subtitle:
      data?.subtitle !== undefined ? String(data.subtitle) : data?.subTitle !== undefined ? String(data.subTitle) : undefined,
    layoutData: data ? trimLayoutData(data) : undefined,
  };

  if (name === 'ImageSlideShow') {
    const images = value?.images;
    base.banners = Array.isArray(images) ? images : undefined;
    return base;
  }

  if (name === 'VoucherSwimlane') {
    const coll = asRecord(value?.collection);
    base.vouchers = coll;
    if (typeof coll?.count === 'number') {
      base.productCount = coll.count;
    } else if (Array.isArray(coll?.list)) {
      base.productCount = coll.list.length;
    }
    return base;
  }

  if (name === 'ProductCollection') {
    base.collectionType = data?.collectionType !== undefined ? String(data.collectionType) : undefined;
    base.collectionSlug = data?.collectionSlug !== undefined ? String(data.collectionSlug) : undefined;
    base.sorting = data?.sorting !== undefined ? String(data.sorting) : undefined;

    const coll = asRecord(value?.collection);
    if (coll) {
      base.productCount = typeof coll.count === 'number' ? coll.count : undefined;
      const pag = asRecord(coll.pagination);
      if (pag && typeof pag.page === 'number' && typeof pag.page_size === 'number' && typeof pag.total_pages === 'number') {
        base.pagination = {
          page: pag.page,
          page_size: pag.page_size,
          total_pages: pag.total_pages,
        };
      }
      const meta = asRecord(coll.metaData);
      if (meta) {
        base.browseMeta = {
          indexName: meta.indexName !== undefined ? String(meta.indexName) : undefined,
          queryId: meta.queryId !== undefined ? String(meta.queryId) : undefined,
          isBrowseApi: typeof meta.isBrowseApi === 'boolean' ? meta.isBrowseApi : undefined,
        };
      }
      if (opts.includeProducts && Array.isArray(coll.product)) {
        base.products = coll.product;
      }
    }
    return base;
  }

  if (name === 'CategoryCollection') {
    const coll = value?.collection;
    base.categories = Array.isArray(coll) ? coll : undefined;
    base.productCount = Array.isArray(coll) ? coll.length : undefined;
    return base;
  }

  if (name === 'PromoCollection') {
    const coll = value?.collection;
    base.promos = Array.isArray(coll) ? coll : undefined;
    base.productCount = Array.isArray(coll) ? coll.length : undefined;
    return base;
  }

  /** Fallback: keep raw value keys for unknown future components */
  if (value && Object.keys(value).length > 0) {
    base.layoutData = { ...base.layoutData, _valuePreview: Object.keys(value) };
  }
  return base;
}

export function parseNextDataScript(html: string): unknown {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([^<]*)<\/script>/);
  if (!m) {
    throw new Error('No __NEXT_DATA__ script tag found (not a Next.js page or markup changed)');
  }
  return JSON.parse(m[1]) as unknown;
}

export function buildFairpriceCatalogFromNextData(
  nextData: unknown,
  sourceUrl: string,
  opts: { includeProducts: boolean },
): FpLiveCatalog {
  const root = asRecord(nextData);
  const buildId = root?.buildId !== undefined ? String(root.buildId) : undefined;
  const pagePath = root?.page !== undefined ? String(root.page) : undefined;

  const props = asRecord(root?.props);
  const pageProps = asRecord(props?.pageProps);
  const envelope = asRecord(pageProps?.data);
  if (envelope?.code !== undefined && Number(envelope.code) !== 200) {
    throw new Error(`FairPrice API envelope code ${String(envelope.code)} (${String(envelope.status ?? '')})`);
  }

  const layouts = getLayouts(nextData);
  const sections = layouts.map((l) => extractSection(asRecord(l) ?? {}, opts));

  return {
    fetchedAt: new Date().toISOString(),
    sourceUrl,
    website: 'fairprice',
    nextBuildId: buildId,
    pagePath,
    sections,
  };
}

export async function fetchFairpriceHomepageHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; clisupermarket/0.1; +https://github.com/danialbka/clisupermarket)',
      Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-SG,en;q=0.9',
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }
  return await res.text();
}

export async function fetchFairpriceLiveCatalog(
  url: string,
  opts: { includeProducts?: boolean } = {},
): Promise<FpLiveCatalog> {
  const includeProducts = opts.includeProducts !== false;
  const html = await fetchFairpriceHomepageHtml(url);
  const nextData = parseNextDataScript(html);
  return buildFairpriceCatalogFromNextData(nextData, url, { includeProducts });
}
