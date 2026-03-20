import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const HEALTH_STORE_VERSION = 1 as const;

export type CalorieEntry = {
  kcal: number;
  note?: string;
};

export type DayCalories = {
  entries: CalorieEntry[];
};

export type HealthStore = {
  version: typeof HEALTH_STORE_VERSION;
  /** Default daily calorie budget (kcal). */
  defaultCalorieLimit: number;
  /** Per-day limit overrides (YYYY-MM-DD → kcal). */
  calorieLimitByDay: Record<string, number>;
  /** Calorie log by calendar day (YYYY-MM-DD). */
  caloriesByDay: Record<string, DayCalories>;
  /** Weight samples, newest last (append order). */
  weights: WeightEntry[];
  /** Preferred days between weigh-ins (for “due” hints). */
  weightIntervalDays: number;
};

export type WeightEntry = {
  date: string;
  kg: number;
  note?: string;
};

const EMPTY: HealthStore = {
  version: HEALTH_STORE_VERSION,
  defaultCalorieLimit: 2000,
  calorieLimitByDay: {},
  caloriesByDay: {},
  weights: [],
  weightIntervalDays: 7,
};

export function defaultHealthStorePath(): string {
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  return join(base, 'clisupermarket', 'health.json');
}

export function loadHealthStore(path: string): HealthStore {
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<HealthStore>;
    if (parsed.version !== HEALTH_STORE_VERSION) {
      throw new Error(`Unsupported health store version: ${String(parsed.version)}`);
    }
    return normalizeStore(parsed);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err?.code === 'ENOENT') {
      return { ...EMPTY };
    }
    throw e;
  }
}

function normalizeStore(p: Partial<HealthStore>): HealthStore {
  return {
    ...EMPTY,
    ...p,
    version: HEALTH_STORE_VERSION,
    defaultCalorieLimit: num(p.defaultCalorieLimit, EMPTY.defaultCalorieLimit),
    calorieLimitByDay: { ...EMPTY.calorieLimitByDay, ...(p.calorieLimitByDay ?? {}) },
    caloriesByDay: { ...EMPTY.caloriesByDay, ...(p.caloriesByDay ?? {}) },
    weights: Array.isArray(p.weights) ? p.weights.map(normalizeWeight) : [],
    weightIntervalDays: Math.max(1, Math.floor(num(p.weightIntervalDays, EMPTY.weightIntervalDays))),
  };
}

function normalizeWeight(w: WeightEntry): WeightEntry {
  return { date: String(w.date), kg: num(w.kg, NaN), note: w.note };
}

function num(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function saveHealthStore(path: string, store: HealthStore): void {
  mkdirSync(dirname(path), { recursive: true });
  const data = JSON.stringify(store, null, 2) + '\n';
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, data, 'utf8');
  renameSync(tmp, path);
}

export function dayTotal(day: DayCalories | undefined): number {
  if (!day?.entries?.length) return 0;
  let t = 0;
  for (const e of day.entries) {
    t += Math.max(0, e.kcal);
  }
  return t;
}

export function limitForDay(store: HealthStore, ymd: string): number {
  const o = store.calorieLimitByDay[ymd];
  if (typeof o === 'number' && Number.isFinite(o) && o > 0) return o;
  return store.defaultCalorieLimit;
}

export function formatLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseLocalYmd(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) throw new Error(`Invalid date (use YYYY-MM-DD): ${s}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) {
    throw new Error(`Invalid calendar date: ${s}`);
  }
  return dt;
}

export function parseMonthYm(s: string): { y: number; m: number } {
  const m = /^(\d{4})-(\d{2})$/.exec(s.trim());
  if (!m) throw new Error(`Invalid month (use YYYY-MM): ${s}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) throw new Error(`Invalid month: ${s}`);
  return { y, m: mo };
}

export function monthBounds(y: number, m: number): { start: Date; daysInMonth: number } {
  const start = new Date(y, m - 1, 1);
  const daysInMonth = new Date(y, m, 0).getDate();
  return { start, daysInMonth };
}
