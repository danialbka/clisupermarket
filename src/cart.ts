#!/usr/bin/env node
import { resolve } from 'node:path';
import { Command } from 'commander';
import {
  cartItemCount,
  cartLineFingerprint,
  fpClearCart,
  fpGetCart,
  fpRemoveLineItem,
  fpTryAddProduct,
  fpTrySetLineQuantity,
  lineItemId,
  lineProductId,
  lineQuantity,
  lineTitle,
  type FpCartLine,
} from './fairpriceCartApi.js';
import { loadFairpriceCookieExport, resolveFairpriceCookiePath } from './fairpriceSession.js';
import { ShengSiongDdpClient } from './shengSiongDdp.js';
import type { SsCartLine } from './shengSiongDdp.js';
import {
  mergeCartLines,
  productToCartLine,
  resolveSsSessionKey,
  ssCommitCartWithSessionFallback,
  ssFetchProductBySlug,
} from './shengSiongCartApi.js';
import {
  cookieHeaderFromExport,
  loadShengSiongCookieExport,
  resolveShengSiongCookiePath,
  sessKeyFromExport,
} from './shengSiongSession.js';

function printLines(lines: FpCartLine[], json: boolean): void {
  if (json) {
    console.log(JSON.stringify(lines, null, 2));
    return;
  }
  if (lines.length === 0) {
    console.log('(empty cart)');
    return;
  }
  const rows = lines.map((line) => {
    const id = lineItemId(line) ?? '';
    const pid = lineProductId(line) ?? '';
    const q = lineQuantity(line) ?? '';
    const name = (lineTitle(line) ?? '').replace(/\s+/g, ' ').slice(0, 56);
    return { itemId: id, productId: pid, q, name };
  });
  const w = {
    itemId: Math.max(6, ...rows.map((r) => r.itemId.length)),
    productId: Math.max(9, ...rows.map((r) => r.productId.length)),
    q: Math.max(1, ...rows.map((r) => r.q.length)),
  };
  console.log(`${'itemId'.padEnd(w.itemId)}  ${'productId'.padEnd(w.productId)}  q  name`);
  for (const r of rows) {
    console.log(`${r.itemId.padEnd(w.itemId)}  ${r.productId.padEnd(w.productId)}  ${r.q.padEnd(w.q)}  ${r.name}`);
  }
}

function printSsLines(items: SsCartLine[] | undefined, json: boolean): void {
  const lines = items ?? [];
  if (json) {
    console.log(JSON.stringify(lines, null, 2));
    return;
  }
  if (lines.length === 0) {
    console.log('(empty cart)');
    return;
  }
  for (const line of lines) {
    const id = String(line.id ?? '');
    const q = String(line.qty ?? '');
    const name = typeof line.name === 'string' ? line.name.replace(/\s+/g, ' ').slice(0, 56) : '';
    console.log(`${id}\t${q}\t${name}`);
  }
}

async function main(): Promise<void> {
  const program = new Command();
  program.name('cart').description('FairPrice / Sheng Siong cart helpers (mutates real accounts — use with care)');

  const fp = program.command('fp').description('FairPrice (website-api.omni.fairprice.com.sg)');
  const cookieFlags = '-c, --cookies <path>';

  fp.command('list')
    .description('GET /api/cart — list line items')
    .option(cookieFlags, 'FairPrice cookie JSON (default: secrets/fairprice-cookies.json or FAIRPRICE_COOKIES)')
    .option('--json', 'Print raw items JSON', false)
    .action(async (opts: { cookies?: string; json?: boolean }) => {
      const p = resolve(process.cwd(), resolveFairpriceCookiePath(opts.cookies));
      const exp = loadFairpriceCookieExport(p);
      const env = await fpGetCart(exp);
      const cart = env.data?.cart;
      const storeId = cart?.storeId;
      const lines = cart?.items ?? [];
      if (!opts.json) {
        console.error(`storeId=${storeId ?? '?'}  lines=${lines.length}  youPay=${cart?.youPay ?? '?'}`);
      }
      printLines(lines, Boolean(opts.json));
    });

  fp.command('remove')
    .description('DELETE /api/cart?storeId=&itemId= — remove one line')
    .argument('<itemId>', 'Line item id from list')
    .option(cookieFlags, 'FairPrice cookie JSON (default: secrets/fairprice-cookies.json or FAIRPRICE_COOKIES)')
    .action(async (itemId: string, opts: { cookies?: string }) => {
      const p = resolve(process.cwd(), resolveFairpriceCookiePath(opts.cookies));
      const exp = loadFairpriceCookieExport(p);
      const before = await fpGetCart(exp);
      const storeId = before.data?.cart?.storeId;
      if (!storeId) {
        throw new Error('Could not read storeId from cart');
      }
      await fpRemoveLineItem(exp, String(storeId), itemId);
      const after = await fpGetCart(exp);
      console.error(`Removed ${itemId}. Lines: ${cartItemCount(before)} → ${cartItemCount(after)}`);
    });

  fp.command('clear')
    .description('Remove every line (loops DELETE)')
    .option(cookieFlags, 'FairPrice cookie JSON (default: secrets/fairprice-cookies.json or FAIRPRICE_COOKIES)')
    .action(async (opts: { cookies?: string }) => {
      const p = resolve(process.cwd(), resolveFairpriceCookiePath(opts.cookies));
      const exp = loadFairpriceCookieExport(p);
      const n = cartItemCount(await fpGetCart(exp));
      await fpClearCart(exp);
      const n2 = cartItemCount(await fpGetCart(exp));
      console.error(`Cleared cart. Lines: ${n} → ${n2}`);
    });

  fp.command('add')
    .description('POST /api/cart — merge-add SKU (same body shape as the FairPrice web app)')
    .argument('<productId>', 'Numeric FairPrice product id')
    .argument('[quantity]', 'Quantity', '1')
    .option(cookieFlags, 'FairPrice cookie JSON (default: secrets/fairprice-cookies.json or FAIRPRICE_COOKIES)')
    .action(async (productId: string, quantity: string, opts: { cookies?: string }) => {
      const p = resolve(process.cwd(), resolveFairpriceCookiePath(opts.cookies));
      const exp = loadFairpriceCookieExport(p);
      const pid = Number(productId);
      if (!Number.isFinite(pid) || pid <= 0) {
        throw new Error(`Invalid productId: ${productId}`);
      }
      const q = Number(quantity);
      if (!Number.isFinite(q) || q <= 0) {
        throw new Error(`Invalid quantity: ${quantity}`);
      }
      const beforeEnv = await fpGetCart(exp);
      const storeId = beforeEnv.data?.cart?.storeId;
      if (!storeId) {
        throw new Error('Could not read storeId from cart');
      }
      const before = cartLineFingerprint(beforeEnv.data?.cart);
      const { env, changed, bodyUsed } = await fpTryAddProduct(exp, pid, q, before);
      const afterCount = cartItemCount(env);
      if (!changed) {
        console.error(
          'FairPrice returned 200 but the cart fingerprint did not change. ' +
            'Check storeId/address context (logged-in session, delivery address) or retry.',
        );
        console.error('Last attempted body:', JSON.stringify(bodyUsed));
        process.exitCode = 2;
        return;
      }
      console.error(`OK — cart updated (${afterCount} line(s)).`);
    });

  fp.command('set')
    .description('POST /api/cart — set quantity for a line (merged cart body; use 0 to remove via DELETE)')
    .argument('<itemId>', 'Line item id from list')
    .argument('<quantity>', 'New quantity')
    .option(cookieFlags, 'FairPrice cookie JSON (default: secrets/fairprice-cookies.json or FAIRPRICE_COOKIES)')
    .action(async (itemId: string, quantity: string, opts: { cookies?: string }) => {
      const p = resolve(process.cwd(), resolveFairpriceCookiePath(opts.cookies));
      const exp = loadFairpriceCookieExport(p);
      const q = Number(quantity);
      if (!Number.isFinite(q) || q < 0) {
        throw new Error(`Invalid quantity: ${quantity}`);
      }
      const beforeEnv = await fpGetCart(exp);
      const cart = beforeEnv.data?.cart;
      const storeId = cart?.storeId;
      if (!storeId) {
        throw new Error('Could not read storeId from cart');
      }
      if (q === 0) {
        await fpRemoveLineItem(exp, String(storeId), itemId);
        const after = await fpGetCart(exp);
        console.error(`Removed line ${itemId} (quantity set to 0). Lines: ${cartItemCount(beforeEnv)} → ${cartItemCount(after)}`);
        return;
      }
      const before = cartLineFingerprint(cart);
      const { env, changed, bodyUsed } = await fpTrySetLineQuantity(exp, itemId, q, before);
      if (!changed) {
        console.error(
          'FairPrice returned 200 but the cart fingerprint did not change. ' +
            'Try removing and re-adding, or capture the quantity-change request from DevTools.',
        );
        console.error('Last attempted body:', JSON.stringify(bodyUsed));
        process.exitCode = 2;
        return;
      }
      console.error(`OK — cart updated (${cartItemCount(env)} line(s)).`);
    });

  const ss = program.command('ss').description('Sheng Siong — Meteor DDP (Sessions.getSessionDataByKey / Sessions.updateData)');
  const ssCookie = '-c, --cookies <path>';

  ss.command('list')
    .description('Read cart lines from `Sessions.getSessionDataByKey` (needs valid sess-key)')
    .option(ssCookie, 'Cookie JSON (default: secrets/sheng-siong-cookies.json or SHENG_SIONG_COOKIES)')
    .option('--json', 'Print raw cart items JSON', false)
    .action(async (opts: { cookies?: string; json?: boolean }) => {
      const p = resolve(process.cwd(), resolveShengSiongCookiePath(opts.cookies));
      const exp = loadShengSiongCookieExport(p);
      const cookie = cookieHeaderFromExport(exp);
      const sk = resolveSsSessionKey(sessKeyFromExport(exp));
      if (!sk) {
        throw new Error('No sess-key in cookie file and no SS_SESSION_KEY env');
      }
      const client = new ShengSiongDdpClient(undefined, undefined, cookie);
      await client.connect();
      try {
        const data = await client.getSessionDataByKey(sk);
        const items = data?.cart?.items;
        if (!opts.json) {
          console.error(`sessionKey=${sk.slice(0, 12)}…  lines=${items?.length ?? 0}`);
          if (data === null) {
            console.error(
              'Hint: server returned no session for this key. If you just ran `ss add`, set SS_SESSION_KEY to the new key printed there, or refresh `sess-key` in your cookie export.',
            );
          }
        }
        printSsLines(items, Boolean(opts.json));
      } finally {
        client.disconnect();
      }
    });

  ss.command('add')
    .description('Add product by slug via `Sessions.updateData` (same as Redux cart sync)')
    .argument('<slug>', 'Product slug from the site URL')
    .argument('[quantity]', 'Quantity to add', '1')
    .option(ssCookie, 'Cookie JSON (default: secrets/sheng-siong-cookies.json or SHENG_SIONG_COOKIES)')
    .action(async (slug: string, quantity: string, opts: { cookies?: string }) => {
      const p = resolve(process.cwd(), resolveShengSiongCookiePath(opts.cookies));
      const exp = loadShengSiongCookieExport(p);
      const cookie = cookieHeaderFromExport(exp);
      const q = Number(quantity);
      if (!Number.isFinite(q) || q <= 0) {
        throw new Error(`Invalid quantity: ${quantity}`);
      }
      const client = new ShengSiongDdpClient(undefined, undefined, cookie);
      await client.connect();
      try {
        const product = await ssFetchProductBySlug(client, slug);
        const line = productToCartLine(product, q);
        const pref = resolveSsSessionKey(sessKeyFromExport(exp));
        let existing: SsCartLine[] = [];
        if (pref) {
          const before = await client.getSessionDataByKey(pref);
          existing = before?.cart?.items ?? [];
        }
        const merged = mergeCartLines(existing, line);
        const { sessionKey, sessionRotated } = await ssCommitCartWithSessionFallback(client, pref, merged);
        console.error(`OK — cart updated (${merged.length} line(s)).`);
        if (sessionRotated) {
          console.error(
            `New sess-key (cookie was stale): ${sessionKey}\n` +
              `Set SS_SESSION_KEY=${sessionKey} or paste this into your cookie export as sess-key.`,
          );
        }
      } finally {
        client.disconnect();
      }
    });

  ss.command('remove')
    .description('Remove a line by product id (hex string from list)')
    .argument('<productIdHex>', 'Line id from cart ss list')
    .option(ssCookie, 'Cookie JSON')
    .action(async (productIdHex: string, opts: { cookies?: string }) => {
      const p = resolve(process.cwd(), resolveShengSiongCookiePath(opts.cookies));
      const exp = loadShengSiongCookieExport(p);
      const cookie = cookieHeaderFromExport(exp);
      const pref = resolveSsSessionKey(sessKeyFromExport(exp));
      const client = new ShengSiongDdpClient(undefined, undefined, cookie);
      await client.connect();
      try {
        if (!pref) {
          throw new Error('No sess-key in cookie file and no SS_SESSION_KEY env');
        }
        const before = await client.getSessionDataByKey(pref);
        const existing = before?.cart?.items ?? [];
        const merged = existing.filter((x) => String(x.id) !== String(productIdHex));
        if (merged.length === existing.length) {
          throw new Error(`No line with id ${productIdHex}`);
        }
        const { sessionKey, sessionRotated } = await ssCommitCartWithSessionFallback(client, pref, merged);
        console.error(`OK — removed. Lines: ${existing.length} → ${merged.length}.`);
        if (sessionRotated) {
          console.error(`New sess-key: ${sessionKey}\nSet SS_SESSION_KEY or update cookie export.`);
        }
      } finally {
        client.disconnect();
      }
    });

  ss.command('clear')
    .description('Remove all cart lines')
    .option(ssCookie, 'Cookie JSON')
    .action(async (opts: { cookies?: string }) => {
      const p = resolve(process.cwd(), resolveShengSiongCookiePath(opts.cookies));
      const exp = loadShengSiongCookieExport(p);
      const cookie = cookieHeaderFromExport(exp);
      const pref = resolveSsSessionKey(sessKeyFromExport(exp));
      const client = new ShengSiongDdpClient(undefined, undefined, cookie);
      await client.connect();
      try {
        const { sessionKey, sessionRotated } = await ssCommitCartWithSessionFallback(client, pref, []);
        console.error(`OK — cart cleared.`);
        if (sessionRotated) {
          console.error(`New sess-key: ${sessionKey}\nSet SS_SESSION_KEY or update cookie export.`);
        }
      } finally {
        client.disconnect();
      }
    });

  ss.command('create-session')
    .description('Call Sessions.create (prints new sess-key for SS_SESSION_KEY / cookie export)')
    .option(ssCookie, 'Cookie JSON')
    .action(async (opts: { cookies?: string }) => {
      const p = resolve(process.cwd(), resolveShengSiongCookiePath(opts.cookies));
      const exp = loadShengSiongCookieExport(p);
      const cookie = cookieHeaderFromExport(exp);
      const client = new ShengSiongDdpClient(undefined, undefined, cookie);
      await client.connect();
      try {
        const k = await client.createSession();
        console.log(k);
      } finally {
        client.disconnect();
      }
    });

  await program.parseAsync(process.argv);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
