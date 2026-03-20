#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Command } from 'commander';
import { FAIRPRICE_DEFAULT_URL, fetchFairpriceLiveCatalog, type FpLiveCatalog } from './fairpriceNextData.js';

function summarize(catalog: FpLiveCatalog): void {
  for (const s of catalog.sections) {
    const n = s.productCount ?? s.products?.length ?? s.categories?.length ?? s.promos?.length ?? s.banners?.length ?? 0;
    const extra =
      s.pagination && s.pagination.total_pages > 1
        ? ` (page ${s.pagination.page}/${s.pagination.total_pages}, ${s.pagination.page_size}/page)`
        : '';
    const slug = s.collectionSlug ? ` [${s.collectionSlug}]` : '';
    console.log(`${s.component}\t${n} items${extra}${slug}\t${s.title ?? ''}`);
  }
  console.error(`\n${catalog.sourceUrl}\nFetched at ${catalog.fetchedAt}`);
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name('fp-live')
    .description('Fetch live FairPrice homepage sections from Next.js __NEXT_DATA__ (www.fairprice.com.sg)')
    .option('-u, --url <url>', 'Page URL', FAIRPRICE_DEFAULT_URL)
    .option('-o, --out <file>', 'Write JSON to file')
    .option('--omit-products', 'Omit per-SKU product arrays (keep counts & pagination only)')
    .option('--pretty', 'Print full JSON to stdout', false)
    .action(
      async (opts: {
        url: string;
        out?: string;
        omitProducts?: boolean;
        pretty?: boolean;
      }) => {
        const includeProducts = !opts.omitProducts;
        const catalog = await fetchFairpriceLiveCatalog(opts.url, { includeProducts });

        if (opts.out) {
          const path = resolve(process.cwd(), opts.out);
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, JSON.stringify(catalog, null, 2), 'utf8');
          console.error(`Wrote ${path}`);
        }

        if (opts.pretty) {
          console.log(JSON.stringify(catalog, null, 2));
        } else {
          summarize(catalog);
        }
      },
    );

  await program.parseAsync(process.argv);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
