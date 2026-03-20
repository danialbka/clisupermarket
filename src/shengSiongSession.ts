import { readFileSync } from 'node:fs';

export type CookieExport = {
  cookies: Array<{ name: string; value: string }>;
};

const DEFAULT_PATH = 'secrets/sheng-siong-cookies.json';

export function resolveShengSiongCookiePath(explicit?: string): string {
  if (explicit) {
    return explicit;
  }
  const fromEnv = process.env.SHENG_SIONG_COOKIES;
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv;
  }
  return DEFAULT_PATH;
}

export function loadShengSiongCookieExport(path: string): CookieExport {
  const raw = readFileSync(path, 'utf8');
  const j = JSON.parse(raw) as unknown;
  if (j === null || typeof j !== 'object' || !Array.isArray((j as CookieExport).cookies)) {
    throw new Error(`Invalid cookie file (expected { cookies: [...] }): ${path}`);
  }
  return j as CookieExport;
}

export function cookieHeaderFromExport(exp: CookieExport): string {
  return exp.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

export function sessKeyFromExport(exp: CookieExport): string | undefined {
  return exp.cookies.find((c) => c.name === 'sess-key')?.value;
}
