#!/usr/bin/env node
import { resolve } from 'node:path';
import { Command } from 'commander';
import {
  dayTotal,
  defaultHealthStorePath,
  formatLocalYmd,
  limitForDay,
  loadHealthStore,
  parseLocalYmd,
  parseMonthYm,
  monthBounds,
  saveHealthStore,
  type HealthStore,
} from './healthStore.js';

function todayYmd(): string {
  return formatLocalYmd(new Date());
}

function pad(n: string, w: number): string {
  return n.length >= w ? n : n + ' '.repeat(w - n.length);
}

function printMonthCalendar(store: HealthStore, ym: string): void {
  const { y, m } = parseMonthYm(ym);
  const { daysInMonth, start } = monthBounds(y, m);
  const label = start.toLocaleString(undefined, { month: 'long', year: 'numeric' });
  const wk = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  console.log(`\n${label}`);
  console.log(wk.join('  '));

  const padDay = 8;
  let line = '';
  const leading = start.getDay();
  for (let i = 0; i < leading; i += 1) {
    line += pad('', padDay);
  }
  for (let d = 1; d <= daysInMonth; d += 1) {
    const ymd = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const day = store.caloriesByDay[ymd];
    const total = dayTotal(day);
    const lim = limitForDay(store, ymd);
    let cell: string;
    if (total <= 0) {
      cell = String(d);
    } else if (lim > 0 && total > lim) {
      cell = `${d}>${Math.round(total)}`;
    } else {
      cell = `${d}=${Math.round(total)}`;
    }
    line += pad(cell.slice(0, padDay - 1), padDay);
    if ((leading + d) % 7 === 0) {
      console.log(line);
      line = '';
    }
  }
  if (line.trim().length > 0) console.log(line);
  console.log('');
  console.log('Legend:  day=kcals eaten (at/under limit)   day>kcals (over limit)   bare day = no log');
}

function printDaySummary(store: HealthStore, ymd: string): void {
  const day = store.caloriesByDay[ymd];
  const total = dayTotal(day);
  const lim = limitForDay(store, ymd);
  const hasOverride = Object.prototype.hasOwnProperty.call(store.calorieLimitByDay, ymd);
  console.log(`Date:     ${ymd}`);
  console.log(`Limit:    ${lim} kcal${hasOverride ? ' (day override)' : ''}  [default ${store.defaultCalorieLimit}]`);
  console.log(`Logged:   ${total} kcal`);
  if (lim > 0) {
    const left = lim - total;
    if (left >= 0) {
      console.log(`Balance:  ${left} kcal under limit`);
    } else {
      console.log(`Balance:  ${-left} kcal over limit`);
    }
  }
  const entries = day?.entries ?? [];
  if (entries.length === 0) {
    console.log('Entries:  (none)');
    return;
  }
  console.log('Entries:');
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i]!;
    const note = e.note ? `  — ${e.note}` : '';
    console.log(`  ${i + 1}. ${e.kcal} kcal${note}`);
  }
}

function weightStatus(store: HealthStore): void {
  const n = store.weights.length;
  console.log(`Weigh-in interval: every ${store.weightIntervalDays} day(s)`);
  if (n === 0) {
    console.log('Last weight: (none logged yet)');
    console.log('Next weigh-in: log one anytime; then use this interval as a guide.');
    return;
  }
  const last = store.weights[n - 1]!;
  console.log(`Last weight: ${last.kg} kg on ${last.date}${last.note ? ` (${last.note})` : ''}`);
  const lastDt = parseLocalYmd(last.date);
  const due = new Date(lastDt);
  due.setDate(due.getDate() + store.weightIntervalDays);
  const dueStr = formatLocalYmd(due);
  const today = parseLocalYmd(todayYmd());
  const daysSince = Math.floor((today.getTime() - lastDt.getTime()) / 86400000);
  console.log(`Days since last: ${daysSince}`);
  if (today.getTime() >= due.getTime()) {
    console.log(`Next weigh-in: due (suggested by ${dueStr})`);
  } else {
    console.log(`Next weigh-in: around ${dueStr} (${store.weightIntervalDays - daysSince} day(s) left)`);
  }
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .name('health')
    .description('Local calorie + weight log (calendar-style views, JSON on disk)')
    .option('-f, --file <path>', 'Health data file', defaultHealthStorePath());

  const cal = program.command('cal').description('Calorie log & daily limits');

  cal
    .command('add')
    .description('Log calories for a day')
    .argument('<kcal>', 'Kilocalories (number)')
    .option('-d, --date <YYYY-MM-DD>', 'Day (default: today)', todayYmd())
    .option('-n, --note <text>', 'Optional label')
    .action((kcalStr: string, opts: { date?: string; note?: string }) => {
      const file = program.opts().file as string;
      const kcal = Number(kcalStr);
      if (!Number.isFinite(kcal) || kcal <= 0) {
        throw new Error('kcal must be a positive number');
      }
      const ymd = opts.date ?? todayYmd();
      parseLocalYmd(ymd);
      const store = loadHealthStore(resolve(process.cwd(), file));
      if (!store.caloriesByDay[ymd]) store.caloriesByDay[ymd] = { entries: [] };
      store.caloriesByDay[ymd]!.entries.push({ kcal, note: opts.note });
      saveHealthStore(resolve(process.cwd(), file), store);
      printDaySummary(store, ymd);
    });

  cal
    .command('set-limit')
    .description('Set default daily limit, or override one day')
    .argument('<kcal>', 'Limit in kcal')
    .option('-d, --date <YYYY-MM-DD>', 'If set, only this day uses this limit')
    .action((kcalStr: string, opts: { date?: string }) => {
      const file = program.opts().file as string;
      const kcal = Number(kcalStr);
      if (!Number.isFinite(kcal) || kcal <= 0) {
        throw new Error('Limit must be a positive number');
      }
      const store = loadHealthStore(resolve(process.cwd(), file));
      if (opts.date) {
        parseLocalYmd(opts.date);
        store.calorieLimitByDay[opts.date] = kcal;
      } else {
        store.defaultCalorieLimit = kcal;
      }
      saveHealthStore(resolve(process.cwd(), file), store);
      const ymd = opts.date ?? todayYmd();
      console.log(opts.date ? `Day limit for ${opts.date} set to ${kcal} kcal.` : `Default daily limit set to ${kcal} kcal.`);
      printDaySummary(store, ymd);
    });

  cal
    .command('clear-limit')
    .description('Remove a per-day limit override (revert to default)')
    .argument('<YYYY-MM-DD>', 'Day')
    .action((ymd: string) => {
      const file = program.opts().file as string;
      parseLocalYmd(ymd);
      const store = loadHealthStore(resolve(process.cwd(), file));
      delete store.calorieLimitByDay[ymd];
      saveHealthStore(resolve(process.cwd(), file), store);
      console.log(`Removed limit override for ${ymd}.`);
      printDaySummary(store, ymd);
    });

  cal
    .command('day')
    .description('Show one day')
    .option('-d, --date <YYYY-MM-DD>', 'Day (default: today)', todayYmd())
    .action((opts: { date?: string }) => {
      const file = program.opts().file as string;
      const ymd = opts.date ?? todayYmd();
      parseLocalYmd(ymd);
      const store = loadHealthStore(resolve(process.cwd(), file));
      printDaySummary(store, ymd);
    });

  cal
    .command('month')
    .description('Print a month grid (calories vs limit)')
    .argument('[YYYY-MM]', 'Month (default: this month)')
    .action((ym: string | undefined) => {
      const file = program.opts().file as string;
      const store = loadHealthStore(resolve(process.cwd(), file));
      const t = new Date();
      const ymResolved =
        ym && ym.trim().length > 0
          ? ym.trim()
          : `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`;
      printMonthCalendar(store, ymResolved);
    });

  const weight = program.command('weight').description('Weight log & interval');

  weight
    .command('add')
    .description('Log weight (kg)')
    .argument('<kg>', 'Weight in kilograms')
    .option('-d, --date <YYYY-MM-DD>', 'Day (default: today)', todayYmd())
    .option('-n, --note <text>', 'Optional note')
    .action((kgStr: string, opts: { date?: string; note?: string }) => {
      const file = program.opts().file as string;
      const kg = Number(kgStr);
      if (!Number.isFinite(kg) || kg <= 0) {
        throw new Error('kg must be a positive number');
      }
      const ymd = opts.date ?? todayYmd();
      parseLocalYmd(ymd);
      const store = loadHealthStore(resolve(process.cwd(), file));
      store.weights.push({ date: ymd, kg, note: opts.note });
      saveHealthStore(resolve(process.cwd(), file), store);
      console.log(`Logged ${kg} kg on ${ymd}.`);
      weightStatus(store);
    });

  weight
    .command('list')
    .description('List weight entries')
    .option('--json', 'Print JSON', false)
    .action((opts: { json?: boolean }) => {
      const file = program.opts().file as string;
      const store = loadHealthStore(resolve(process.cwd(), file));
      if (opts.json) {
        console.log(JSON.stringify(store.weights, null, 2));
        return;
      }
      if (store.weights.length === 0) {
        console.log('(no weight entries)');
        return;
      }
      for (const w of store.weights) {
        const note = w.note ? `  ${w.note}` : '';
        console.log(`${w.date}\t${w.kg} kg${note}`);
      }
    });

  weight
    .command('interval')
    .description('Set preferred days between weigh-ins (for “due” hints)')
    .argument('<days>', 'Positive integer')
    .action((daysStr: string) => {
      const file = program.opts().file as string;
      const days = Math.floor(Number(daysStr));
      if (!Number.isFinite(days) || days < 1) {
        throw new Error('days must be a positive integer');
      }
      const store = loadHealthStore(resolve(process.cwd(), file));
      store.weightIntervalDays = days;
      saveHealthStore(resolve(process.cwd(), file), store);
      weightStatus(store);
    });

  weight
    .command('status')
    .description('Show last weight and whether a weigh-in is “due” by interval')
    .action(() => {
      const file = program.opts().file as string;
      const store = loadHealthStore(resolve(process.cwd(), file));
      weightStatus(store);
    });

  await program.parseAsync(process.argv);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
