import type { Cell, ConfigRow } from "../clients/sheets/SheetsClient.js";
import type { Slot } from "../domain/types.js";
import { isValidTimeZone } from "../lib/time.js";

export interface AppSettings {
  servings: number;
  options: Record<Slot, number>;
  times: Record<Slot, Temporal.PlainTime>;
  minutes: Record<Slot, number>;
  timezone: string;
  language: string;
  noRepeatWeeks: number;
  assumedStaples: string[];
  reactionDebounceSeconds: number;
  /** Temporal day of week: 1 = Monday … 7 = Sunday. */
  planDay: number;
  planTime: Temporal.PlainTime;
  catchUp: boolean;
}

export function defaultSettings(): AppSettings {
  const t = (s: string) => Temporal.PlainTime.from(s);
  return {
    servings: 4,
    options: { breakfast: 1, lunch: 3, dinner: 1 },
    times: { breakfast: t("07:30"), lunch: t("12:00"), dinner: t("18:00") },
    minutes: { breakfast: 30, lunch: 45, dinner: 60 },
    timezone: "America/New_York",
    language: "English",
    noRepeatWeeks: 2,
    assumedStaples: ["salt", "pepper", "water", "oil"],
    reactionDebounceSeconds: 3,
    planDay: 7,
    planTime: t("18:00"),
    catchUp: true,
  };
}

export interface ParsedSettings {
  settings: AppSettings;
  /** Invalid values, unknown or duplicate keys. Safe to show to the family. */
  warnings: string[];
  /** Keys missing from the tab that fell back to defaults. */
  defaulted: string[];
}

type Parser<T> = (value: Cell) => T | undefined;

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

const text = (v: Cell) => (v === null || v === undefined ? "" : String(v).trim());

function int(min: number, max: number): Parser<number> {
  return (v) => {
    const n = typeof v === "number" ? v : /^-?\d+$/.test(text(v)) ? Number(text(v)) : NaN;
    return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
  };
}

/** Accepts "7:30", "07:30", "07:30:00", "7:30 PM", or a day-fraction number from Sheets. */
const timeOfDay: Parser<Temporal.PlainTime> = (v) => {
  if (typeof v === "number") {
    if (v < 0 || v >= 1) return undefined;
    const minutes = Math.round(v * 24 * 60);
    return Temporal.PlainTime.from({ hour: Math.floor(minutes / 60), minute: minutes % 60 });
  }
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?$/i.exec(text(v));
  if (!m) return undefined;
  let hour = Number(m[1]);
  const minute = Number(m[2]);
  const meridiem = m[3]?.toLowerCase().replace(/\./g, "");
  if (meridiem) {
    if (hour < 1 || hour > 12) return undefined;
    hour = (hour % 12) + (meridiem === "pm" ? 12 : 0);
  }
  if (hour > 23 || minute > 59) return undefined;
  return Temporal.PlainTime.from({ hour, minute });
};

const nonEmpty: Parser<string> = (v) => text(v) || undefined;

const timeZone: Parser<string> = (v) => (isValidTimeZone(text(v)) ? text(v) : undefined);

const list: Parser<string[]> = (v) => {
  const items = text(v)
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
};

const dayOfWeek: Parser<number> = (v) => {
  const s = text(v).toLowerCase();
  const index = DAYS.findIndex((d) => d === s || d.slice(0, 3) === s);
  return index >= 0 ? index + 1 : undefined;
};

const bool: Parser<boolean> = (v) => {
  if (typeof v === "boolean") return v;
  const s = text(v).toLowerCase();
  if (["true", "yes", "1", "on"].includes(s)) return true;
  if (["false", "no", "0", "off"].includes(s)) return false;
  return undefined;
};

type Field = { parse: Parser<unknown>; apply: (s: AppSettings, value: never) => void };

function field<T>(parse: Parser<T>, apply: (s: AppSettings, value: T) => void): Field {
  return { parse, apply: apply as Field["apply"] };
}

const FIELDS: Record<string, Field> = {
  servings: field(int(1, 20), (s, v) => (s.servings = v)),
  breakfast_options: field(int(1, 5), (s, v) => (s.options.breakfast = v)),
  lunch_options: field(int(1, 5), (s, v) => (s.options.lunch = v)),
  dinner_options: field(int(1, 5), (s, v) => (s.options.dinner = v)),
  breakfast_time: field(timeOfDay, (s, v) => (s.times.breakfast = v)),
  lunch_time: field(timeOfDay, (s, v) => (s.times.lunch = v)),
  dinner_time: field(timeOfDay, (s, v) => (s.times.dinner = v)),
  breakfast_minutes: field(int(5, 480), (s, v) => (s.minutes.breakfast = v)),
  lunch_minutes: field(int(5, 480), (s, v) => (s.minutes.lunch = v)),
  dinner_minutes: field(int(5, 480), (s, v) => (s.minutes.dinner = v)),
  timezone: field(timeZone, (s, v) => (s.timezone = v)),
  language: field(nonEmpty, (s, v) => (s.language = v)),
  no_repeat_weeks: field(int(0, 12), (s, v) => (s.noRepeatWeeks = v)),
  assumed_staples: field(list, (s, v) => (s.assumedStaples = v)),
  reaction_debounce_seconds: field(int(0, 60), (s, v) => (s.reactionDebounceSeconds = v)),
  plan_day: field(dayOfWeek, (s, v) => (s.planDay = v)),
  plan_time: field(timeOfDay, (s, v) => (s.planTime = v)),
  catch_up: field(bool, (s, v) => (s.catchUp = v)),
};

export const CONFIG_KEYS = Object.keys(FIELDS);

/** Config tab → settings. Invalid values fall back to defaults with a warning; never throws. */
export function parseSettings(rows: ConfigRow[]): ParsedSettings {
  const settings = defaultSettings();
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const f = FIELDS[row.key];
    if (!f) {
      warnings.push(`Config row ${row.rowNumber}: unknown key "${row.key}" ignored`);
      continue;
    }
    if (seen.has(row.key)) {
      warnings.push(`Config row ${row.rowNumber}: duplicate key "${row.key}" ignored`);
      continue;
    }
    seen.add(row.key);
    const value = f.parse(row.value);
    if (value === undefined) {
      warnings.push(
        `Config row ${row.rowNumber}: invalid value "${text(row.value)}" for "${row.key}", using the default`,
      );
      continue;
    }
    f.apply(settings, value as never);
  }

  return { settings, warnings, defaulted: CONFIG_KEYS.filter((k) => !seen.has(k)) };
}
