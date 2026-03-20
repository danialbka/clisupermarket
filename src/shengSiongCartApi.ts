import type { ShengSiongDdpClient, SsCartLine, SsProduct, SsSessionData } from './shengSiongDdp.js';
import { defaultSearchFilter } from './shengSiongDdp.js';

function idHexFromProduct(p: SsProduct): string {
  const oid = p._id;
  if (oid !== null && typeof oid === 'object' && '$value' in oid) {
    return String((oid as { $value: string }).$value);
  }
  return String(oid ?? '');
}

/** Build a cart line the Redux store would persist (full product + `id` + `qty`). */
export function productToCartLine(product: SsProduct, qty: number): SsCartLine {
  const id = idHexFromProduct(product);
  return {
    ...product,
    id,
    qty,
    timestamp: new Date(),
  };
}

export function mergeCartLines(existing: SsCartLine[] | undefined, line: SsCartLine): SsCartLine[] {
  const list = [...(existing ?? [])];
  const i = list.findIndex((x) => String(x.id) === String(line.id));
  if (i >= 0) {
    const q = Number(list[i].qty ?? 0) + Number(line.qty ?? 0);
    list[i] = { ...list[i], ...line, qty: q };
  } else {
    list.push(line);
  }
  return list;
}

export async function ssFetchProductBySlug(client: ShengSiongDdpClient, slug: string): Promise<SsProduct> {
  const p = await client.getProductOneByIdOrSlug(slug, null, defaultSearchFilter());
  if (!p || (p as { isArchived?: boolean }).isArchived || !(p as { listingOnEcomm?: boolean }).listingOnEcomm) {
    throw new Error(`Product not available for cart: ${slug}`);
  }
  return p;
}

export async function ssGetSessionCart(client: ShengSiongDdpClient, sessionKey: string): Promise<SsSessionData | null> {
  return await client.getSessionDataByKey(sessionKey);
}

/**
 * Writes `dataSets` to the server session. If the cookie `sess-key` is stale, the server returns
 * "Invalid checkout session" — call `Sessions.create()` and retry with the new key.
 */
export async function ssUpdateSessionCart(
  client: ShengSiongDdpClient,
  sessionKey: string,
  items: SsCartLine[],
): Promise<void> {
  await client.updateSessionData(sessionKey, { cart: { items } });
}

export function resolveSsSessionKey(cookieSessKey: string | undefined): string | undefined {
  const fromEnv = process.env.SS_SESSION_KEY?.trim();
  return fromEnv || cookieSessKey;
}

/**
 * Tries `Sessions.updateData` with the given key; on `Invalid checkout session`, creates a new session
 * and writes there (same behaviour as a stale browser `sess-key`).
 */
export async function ssCommitCartWithSessionFallback(
  client: ShengSiongDdpClient,
  preferredSessionKey: string | undefined,
  items: SsCartLine[],
): Promise<{ sessionKey: string; sessionRotated: boolean }> {
  if (preferredSessionKey) {
    try {
      await client.updateSessionData(preferredSessionKey, { cart: { items } });
      return { sessionKey: preferredSessionKey, sessionRotated: false };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('Invalid checkout session')) {
        throw e;
      }
    }
  }
  const k = await client.createSession();
  await client.updateSessionData(k, { cart: { items } });
  return { sessionKey: k, sessionRotated: true };
}
