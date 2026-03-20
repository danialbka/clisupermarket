import { FP_API, type CookieExport, fairpriceJsonHeaders, fairpriceRequestHeaders } from './fairpriceSession.js';

export type FpCartEnvelope = {
  code?: number;
  status?: string;
  message?: string;
  data?: { cart?: FpCart };
};

export type FpCartLine = Record<string, unknown>;

export type FpCart = {
  cartId?: string;
  storeId?: string;
  addressId?: string;
  youPay?: number;
  items?: FpCartLine[];
};

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

export function lineItemId(line: FpCartLine): string | undefined {
  const id = line.id ?? line.itemId ?? line.lineItemId;
  if (typeof id === 'string' || typeof id === 'number') {
    return String(id);
  }
  return undefined;
}

export function lineProductId(line: FpCartLine): string | undefined {
  const p = line.productId ?? line.pid ?? line.product_id;
  if (typeof p === 'string' || typeof p === 'number') {
    return String(p);
  }
  return undefined;
}

export function lineQuantity(line: FpCartLine): string | undefined {
  const q = line.q ?? line.quantity ?? line.wantQuantity;
  if (typeof q === 'string' || typeof q === 'number') {
    return String(q);
  }
  return undefined;
}

export function lineTitle(line: FpCartLine): string | undefined {
  const prod = line.product;
  const fromProduct =
    prod !== null && typeof prod === 'object' && !Array.isArray(prod)
      ? (prod as Record<string, unknown>).name
      : undefined;
  const t = line.name ?? line.title ?? line.productName ?? fromProduct;
  return typeof t === 'string' ? t : undefined;
}

export async function fpGetCart(exp: CookieExport): Promise<FpCartEnvelope> {
  const res = await fetch(`${FP_API}/cart`, {
    headers: fairpriceRequestHeaders(exp),
  });
  const j = (await res.json()) as FpCartEnvelope;
  if (!res.ok) {
    throw new Error(`GET /api/cart HTTP ${res.status}: ${j.message ?? res.statusText}`);
  }
  return j;
}

export async function fpRemoveLineItem(exp: CookieExport, storeId: string, itemId: string): Promise<FpCartEnvelope> {
  const url = new URL(`${FP_API}/cart`);
  url.searchParams.set('storeId', storeId);
  url.searchParams.set('itemId', itemId);
  const res = await fetch(url.toString(), {
    method: 'DELETE',
    headers: fairpriceRequestHeaders(exp),
  });
  const j = (await res.json()) as FpCartEnvelope;
  if (!res.ok) {
    throw new Error(`DELETE /api/cart HTTP ${res.status}: ${j.message ?? res.statusText}`);
  }
  return j;
}

/** Best-effort POST shapes; FairPrice may ignore the body until the exact schema is known (capture from browser Network). */
export async function fpPostCartJson(exp: CookieExport, body: unknown): Promise<FpCartEnvelope> {
  const res = await fetch(`${FP_API}/cart`, {
    method: 'POST',
    headers: fairpriceJsonHeaders(exp),
    body: JSON.stringify(body),
  });
  const j = (await res.json()) as FpCartEnvelope;
  if (!res.ok) {
    throw new Error(`POST /api/cart HTTP ${res.status}: ${j.message ?? res.statusText}`);
  }
  return j;
}

export function cartItemCount(env: FpCartEnvelope): number {
  const items = env.data?.cart?.items;
  return Array.isArray(items) ? items.length : 0;
}

export function cartLineFingerprint(cart: FpCart | undefined): string {
  const items = cart?.items;
  if (!Array.isArray(items)) {
    return '';
  }
  return items
    .map((line) => {
      const id = lineItemId(line) ?? '?';
      const q = lineQuantity(line) ?? '?';
      const pid = lineProductId(line) ?? '?';
      return `${id}:${pid}:${q}`;
    })
    .sort()
    .join('|');
}

export async function fpClearCart(exp: CookieExport): Promise<void> {
  const env = await fpGetCart(exp);
  const cart = env.data?.cart;
  const storeId = cart?.storeId !== undefined ? String(cart.storeId) : undefined;
  const items = cart?.items;
  if (!storeId || !Array.isArray(items)) {
    return;
  }
  for (const line of items) {
    const itemId = lineItemId(line);
    if (itemId) {
      await fpRemoveLineItem(exp, storeId, itemId);
    }
  }
}

/**
 * Omni cart sync POST shape used by the FairPrice web app (`syncCartCallback` → `post("cart", { body })`).
 * Sending the full `items` array (GET cart lines mapped to `{ id, q, }` plus `t`) is required; the naive
 * `{ storeId, productId, quantity }` body is ignored by the server (HTTP 200, no change).
 */
export type FpCartItemPost = { id: string; q: string; t: number };

export function fpCartLinesToPostItems(cart: FpCart | undefined): FpCartItemPost[] {
  const items = cart?.items;
  if (!Array.isArray(items)) {
    return [];
  }
  const ts = Date.now();
  return items.map((line) => {
    const id = lineItemId(line) ?? lineProductId(line);
    if (!id) {
      throw new Error('Cart line missing id');
    }
    const q = lineQuantity(line) ?? '1';
    const tRaw = line.t;
    const t =
      typeof tRaw === 'number'
        ? tRaw
        : typeof tRaw === 'string'
          ? Number(tRaw)
          : Number.NaN;
    return { id: String(id), q: String(q), t: Number.isFinite(t) ? t : ts };
  });
}

export function buildMergeCartPostBody(
  cart: FpCart | undefined,
  mode:
    | { kind: 'add'; productId: number; quantity: number }
    | { kind: 'setQty'; lineId: string; quantity: number },
): { storeId: string; cart: { items: FpCartItemPost[] } } {
  const storeId = cart?.storeId !== undefined ? String(cart.storeId) : '';
  if (!storeId) {
    throw new Error('Missing storeId on cart (need a delivery address / store context)');
  }
  let items = fpCartLinesToPostItems(cart);
  const ts = Date.now();

  if (mode.kind === 'add') {
    const pid = String(mode.productId);
    const addQ = mode.quantity;
    const i = items.findIndex((x) => x.id === pid);
    if (i >= 0) {
      const nq = Number(items[i].q) + addQ;
      items = items.map((x, j) => (j === i ? { ...x, q: String(nq), t: ts } : x));
    } else {
      items = [...items, { id: pid, q: String(addQ), t: ts }];
    }
  } else {
    const lid = mode.lineId;
    const q = mode.quantity;
    if (q === 0) {
      items = items.filter((x) => x.id !== lid);
    } else {
      items = items.map((x) => (x.id === lid ? { ...x, q: String(q), t: ts } : x));
    }
  }

  return { storeId, cart: { items } };
}

/** POST merged cart (web app shape); returns whether fingerprint changed vs `before`. */
export async function fpTryAddProduct(
  exp: CookieExport,
  productId: number,
  quantity: number,
  before: string,
): Promise<{ env: FpCartEnvelope; changed: boolean; bodyUsed: unknown }> {
  const get = await fpGetCart(exp);
  const cart = get.data?.cart;
  const body = buildMergeCartPostBody(cart, { kind: 'add', productId, quantity });
  const last = await fpPostCartJson(exp, body);
  const after = cartLineFingerprint(last.data?.cart);
  if (after !== before) {
    return { env: last, changed: true, bodyUsed: body };
  }
  return { env: last, changed: false, bodyUsed: body };
}

export async function fpTrySetLineQuantity(
  exp: CookieExport,
  itemId: string,
  quantity: number,
  before: string,
): Promise<{ env: FpCartEnvelope; changed: boolean; bodyUsed: unknown }> {
  const get = await fpGetCart(exp);
  const cart = get.data?.cart;
  const body = buildMergeCartPostBody(cart, { kind: 'setQty', lineId: itemId, quantity });
  const last = await fpPostCartJson(exp, body);
  const after = cartLineFingerprint(last.data?.cart);
  if (after !== before) {
    return { env: last, changed: true, bodyUsed: body };
  }
  return { env: last, changed: false, bodyUsed: body };
}
