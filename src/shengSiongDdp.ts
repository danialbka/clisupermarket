import EJSON from 'ejson';
import WebSocket from 'ws';

EJSON.addType('oid', (json: unknown) => json);

const DEFAULT_WS = 'wss://shengsiong.com.sg/websocket';
const DEFAULT_ORIGIN = 'https://shengsiong.com.sg';

export type DdpMessage = Record<string, unknown> & { msg?: string };

function asArray<T>(x: unknown): T[] {
  if (Array.isArray(x)) return x;
  if (x !== null && typeof x === 'object') return Object.values(x as Record<string, T>);
  return [];
}

export function meteorOid(hex: string): { $type: string; $value: string } {
  return { $type: 'oid', $value: hex };
}

export class ShengSiongDdpClient {
  private ws: WebSocket | null = null;
  private inbox: DdpMessage[] = [];
  private waiters: Array<(m: DdpMessage) => void> = [];
  private methodSeq = 0;

  constructor(
    private readonly endpoint = DEFAULT_WS,
    private readonly origin = DEFAULT_ORIGIN,
    /** Optional `Cookie` header (e.g. `sess-key=...; visid_incap_...=...`) so `Sessions.*` methods match the browser session. */
    private readonly cookieHeader?: string,
  ) {}

  async connect(): Promise<void> {
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (compatible; clisupermarket/0.1)',
      Origin: this.origin,
    };
    if (this.cookieHeader) {
      headers.Cookie = this.cookieHeader;
    }
    this.ws = new WebSocket(this.endpoint, {
      headers,
    });

    await new Promise<void>((resolve, reject) => {
      this.ws!.on('error', reject);
      this.ws!.on('open', () => {
        this.ws!.off('error', reject);
        resolve();
      });
    });

    this.ws.on('message', (data) => {
      try {
        const msg = EJSON.parse(data.toString()) as DdpMessage;
        const w = this.waiters.shift();
        if (w) w(msg);
        else this.inbox.push(msg);
      } catch {
        /* ignore malformed */
      }
    });

    this.sendJson({ msg: 'connect', version: '1', support: ['1', 'pre2', 'pre1'] });
    const first = await this.nextMsg();
    if (first.msg !== 'connected') {
      throw new Error(`Expected DDP connected, got ${String(first.msg)}`);
    }
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }

  private sendJson(obj: unknown): void {
    this.ws!.send(JSON.stringify(obj));
  }

  private async nextMsg(): Promise<DdpMessage> {
    if (this.inbox.length) return this.inbox.shift()!;
    return await new Promise((res) => this.waiters.push(res));
  }

  async call<T = unknown>(method: string, params: unknown[]): Promise<T> {
    const id = String(++this.methodSeq);
    this.sendJson({ msg: 'method', method, params, id });

    for (;;) {
      const msg = await this.nextMsg();
      if (msg.msg === 'updated' && Array.isArray(msg.methods) && msg.methods.includes(id)) {
        continue;
      }
      if (msg.msg === 'result' && msg.id === id) {
        if (msg.error) {
          const err = msg.error as { reason?: string; message?: string };
          throw new Error(err.reason ?? err.message ?? 'DDP method error');
        }
        return msg.result as T;
      }
      if (msg.msg === 'error' && msg.id === id) {
        throw new Error(String((msg as { reason?: string }).reason ?? 'DDP error'));
      }
    }
  }

  async getHomePageSections(): Promise<HomePageSection[]> {
    const raw = await this.call<unknown>('HomePageSections.getAllActive', []);
    return asArray<HomePageSection>(raw);
  }

  async getProductsByCategoryId(categoryIdHex: string): Promise<SsProduct[]> {
    const raw = await this.call<unknown>('Products.getByCategoryId', [meteorOid(categoryIdHex)]);
    return asArray<SsProduct>(raw);
  }

  async getCampaignProducts(campaignPageIdHex: string): Promise<SsProduct[]> {
    const raw = await this.call<unknown>('CampaignPages.getProductsById', [meteorOid(campaignPageIdHex)]);
    return asArray<SsProduct>(raw);
  }

  async getCategoryById(categoryIdHex: string): Promise<SsCategoryDoc> {
    return await this.call<SsCategoryDoc>('Categories.getOneById', [meteorOid(categoryIdHex)]);
  }

  /**
   * Category listing as used on /category/... pages (paginated).
   * Args match `Meteor.callAsync("Products.getByAllSlugs", bundle, misc, page, limit)`.
   */
  async getProductsByAllSlugsPage(
    categorySlugs: string[],
    page: number,
    pageSize: number,
  ): Promise<SsProduct[]> {
    const raw = await this.call<unknown>('Products.getByAllSlugs', [
      filterBundleForCategorySlugs(categorySlugs),
      defaultMiscFilters(),
      page,
      pageSize,
    ]);
    return asArray<SsProduct>(raw);
  }

  /**
   * Product detail / PDP — args match the web app: `(slugOrId, filterBundle | null, searchFilter)`.
   */
  async getProductOneByIdOrSlug(
    slugOrId: string | { $type: string; $value: string },
    filterBundle: unknown,
    searchFilter: unknown,
  ): Promise<SsProduct | null> {
    return await this.call<SsProduct | null>('Products.getOneByIdOrSlug', [slugOrId, filterBundle, searchFilter]);
  }

  /** Server-side session blob (cart, checkout, search history) keyed by `sess-key` cookie. */
  async getSessionDataByKey(sessionKey: string): Promise<SsSessionData | null> {
    return await this.call<SsSessionData | null>('Sessions.getSessionDataByKey', [{ sessionKey }]);
  }

  /** Persists cart/checkout/search — same as the Redux `CART/UPDATE_SESSION` saga (`dataSets` shape). */
  async updateSessionData(sessionKey: string, dataSets: SsSessionDataPatch): Promise<unknown> {
    return await this.call('Sessions.updateData', [{ sessionKey, dataSets }]);
  }

  /** Creates a new anonymous session; returns the new `sess-key` value. */
  async createSession(): Promise<string> {
    return await this.call<string>('Sessions.create', []);
  }

  async getLoggedInUserCartItemsTotal(): Promise<unknown> {
    return await this.call('Sessions.getLoggedInUserCartItemsTotal', []);
  }
}

/** `Sessions.getSessionDataByKey` / `Sessions.updateData` payload shape (partial). */
export type SsSessionData = {
  cart?: { items?: SsCartLine[] };
  search?: { history?: unknown[] };
  checkout?: Record<string, unknown>;
};

export type SsSessionDataPatch = {
  cart?: { items: SsCartLine[] };
  search?: { history: unknown[] };
  checkout?: Record<string, unknown>;
};

/** Cart line as stored in session (full product doc + `qty` + limits). */
export type SsCartLine = Record<string, unknown> & {
  id?: string;
  _id?: unknown;
  qty?: number;
  dailyPurchaseLimit?: number;
};

/**
 * Fetch every product for a top-level category slug (e.g. `vegetables`).
 * The server returns a cumulative list: page 2 includes all of page 1, so we slice off new rows only.
 */
export async function fetchAllProductsForCategorySlug(
  client: ShengSiongDdpClient,
  categorySlug: string,
  pageSize: number,
): Promise<SsProduct[]> {
  const all: SsProduct[] = [];
  for (let page = 1; ; page++) {
    const cumulative = await client.getProductsByAllSlugsPage([categorySlug], page, pageSize);
    const newOnes = cumulative.slice(all.length);
    if (newOnes.length === 0) break;
    all.push(...newOnes);
    if (newOnes.length < pageSize) break;
  }
  return all;
}

export type HomePageSection = {
  _id?: string;
  title?: string;
  type?: string;
  order?: number;
  categoryId?: string;
  campaignPageId?: string;
  banners?: unknown[];
  imgKey?: string;
};

export type SsProduct = {
  _id?: string;
  name?: string;
  slug?: string;
  price?: number;
  prevPrice?: number;
  packSize?: string;
  imgKey?: string;
  isSoldOut?: boolean;
  listingOnEcomm?: boolean;
  [key: string]: unknown;
};

/** Mirrors the Redux `filterState.misc` default from the Sheng Siong web app. */
export const defaultMiscFilters = () => ({
  brands: { slugs: [] as string[] },
  prices: { slugs: [] as string[] },
  countryOfOrigins: { slugs: [] as string[] },
  dietaryHabits: { slugs: [] as string[] },
  tags: { slugs: [] as string[] },
  sortBy: { slug: '' },
});

export function filterBundleForCategorySlugs(categorySlugs: string[]) {
  return {
    categoryFilter: { slugs: categorySlugs },
    campaignPageFilter: { slug: '', category: { slug: '' } },
    shoppingListFilter: {
      slug: '',
      category: { slug: '' },
      search: { slug: '' },
      showKeptForLater: false,
    },
    searchFilter: { slug: '', category: { slug: '' } },
  };
}

/** Matches `filterState.search` defaults used with `Products.getOneByIdOrSlug` on the PDP. */
export const defaultSearchFilter = () => ({ slug: '', category: { slug: '' } });

export type SsCategoryDoc = {
  _id?: string;
  name?: string;
  slug?: string;
  [key: string]: unknown;
};
