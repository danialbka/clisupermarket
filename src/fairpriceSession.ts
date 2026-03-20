/**
 * Load a browser cookie export (extension JSON: `{ cookies: [{ name, value }, ...] }`).
 */

import { readFileSync } from 'node:fs';

export type CookieExport = {
  cookies: Array<{ name: string; value: string }>;
};

const DEFAULT_PATH = 'secrets/fairprice-cookies.json';

export function resolveFairpriceCookiePath(explicit?: string): string {
  if (explicit) {
    return explicit;
  }
  const fromEnv = process.env.FAIRPRICE_COOKIES;
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv;
  }
  return DEFAULT_PATH;
}

export function loadFairpriceCookieExport(path: string): CookieExport {
  const raw = readFileSync(path, 'utf8');
  const j = JSON.parse(raw) as unknown;
  if (j === null || typeof j !== 'object' || !Array.isArray((j as CookieExport).cookies)) {
    throw new Error(`Invalid cookie file (expected { cookies: [...] }): ${path}`);
  }
  return j as CookieExport;
}

export function cookieHeader(exp: CookieExport): string {
  return exp.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

export function authTokenFromCookies(exp: CookieExport): string | undefined {
  return exp.cookies.find((c) => c.name === 'auth_token')?.value;
}

const FP_API = 'https://website-api.omni.fairprice.com.sg/api';

export function fairpriceRequestHeaders(exp: CookieExport): Record<string, string> {
  const cookie = cookieHeader(exp);
  const token = authTokenFromCookies(exp);
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (compatible; clisupermarket-cart/0.1)',
    Accept: 'application/json',
    Cookie: cookie,
    Origin: 'https://www.fairprice.com.sg',
    Referer: 'https://www.fairprice.com.sg/',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export function fairpriceJsonHeaders(exp: CookieExport): Record<string, string> {
  return { ...fairpriceRequestHeaders(exp), 'Content-Type': 'application/json' };
}

export { FP_API };
