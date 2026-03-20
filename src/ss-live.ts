#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Command } from 'commander';
import {
  ShengSiongDdpClient,
  fetchAllProductsForCategorySlug,
  type SsProduct,
} from './shengSiongDdp.js';

export type SectionPayload = {
  title: string;
  type: string;
  categoryId?: string;
  /** Present when `--full` was used and the category resolved. */
  categorySlug?: string;
  campaignPageId?: string;
  productCount: number;
  products: SsProduct[];
};

export type LiveCatalog = {
  fetchedAt: string;
  source: string;
  sections: SectionPayload[];
};

async function delay(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

export async function fetchLiveHomepageCatalog(options: {
  pauseMs?: number;
  /** When true, load every product per category via paginated `Products.getByAllSlugs` (same as category pages). */
  fullCategoryCatalog?: boolean;
  pageSize?: number;
}): Promise<LiveCatalog> {
  const pauseMs = options.pauseMs ?? 120;
  const full = options.fullCategoryCatalog ?? false;
  const pageSize = Math.min(200, Math.max(10, options.pageSize ?? 80));
  const client = new ShengSiongDdpClient();
  await client.connect();

  try {
    const sections = await client.getHomePageSections();
    const out: SectionPayload[] = [];

    for (const s of sections) {
      const type = s.type ?? 'unknown';
      const title = s.title ?? '(untitled)';

      if (type === 'category' && s.categoryId) {
        let products: SsProduct[];
        let categorySlug: string | undefined;
        if (full) {
          const cat = await client.getCategoryById(s.categoryId);
          categorySlug = typeof cat.slug === 'string' ? cat.slug : undefined;
          if (!categorySlug) {
            products = [];
          } else {
            products = await fetchAllProductsForCategorySlug(client, categorySlug, pageSize);
          }
        } else {
          products = await client.getProductsByCategoryId(s.categoryId);
        }
        out.push({
          title,
          type,
          categoryId: s.categoryId,
          categorySlug,
          productCount: products.length,
          products,
        });
        await delay(pauseMs);
      } else if (type === 'campaignPage' && s.campaignPageId) {
        const products = await client.getCampaignProducts(s.campaignPageId);
        out.push({
          title,
          type,
          campaignPageId: s.campaignPageId,
          productCount: products.length,
          products,
        });
        await delay(pauseMs);
      } else {
        out.push({
          title,
          type,
          productCount: 0,
          products: [],
        });
      }
    }

    return {
      fetchedAt: new Date().toISOString(),
      source: 'https://shengsiong.com.sg/ (Meteor DDP)',
      sections: out,
    };
  } finally {
    client.disconnect();
  }
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name('ss-live')
    .description('Fetch live Sheng Siong homepage sections + per-section products via Meteor DDP')
    .option('-o, --out <file>', 'Write full JSON catalog to file')
    .option('--pause <ms>', 'Delay between category DDP calls (default 120)', '120')
    .option(
      '--full',
      'Fetch full category listings (paginated Products.getByAllSlugs), not just homepage previews (~20)',
      false,
    )
    .option('--page-size <n>', 'Products per page when using --full (default 80, max 200)', '80')
    .option('--pretty', 'Pretty-print JSON to stdout', false)
    .action(async (opts: {
      out?: string;
      pause?: string;
      pretty?: boolean;
      full?: boolean;
      pageSize?: string;
    }) => {
      const pauseMs = Math.max(0, parseInt(opts.pause ?? '120', 10) || 0);
      const pageSize = parseInt(opts.pageSize ?? '80', 10) || 80;
      const catalog = await fetchLiveHomepageCatalog({
        pauseMs,
        fullCategoryCatalog: Boolean(opts.full),
        pageSize,
      });

      if (opts.out) {
        const path = resolve(process.cwd(), opts.out);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, JSON.stringify(catalog, null, 2), 'utf8');
        console.error(`Wrote ${path}`);
      }

      if (opts.pretty) {
        console.log(JSON.stringify(catalog, null, 2));
      } else {
        for (const sec of catalog.sections) {
          console.log(`${sec.type}\t${sec.productCount} items\t${sec.title}`);
        }
        console.error(`\nFetched at ${catalog.fetchedAt}`);
      }
    });

  await program.parseAsync(process.argv);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
