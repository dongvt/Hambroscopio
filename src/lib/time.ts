import type { Clock } from "./clock.js";

/** A week is identified by its Monday date, for example "2026-11-09". */
export type WeekId = string;

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export function isValidTimeZone(timeZone: string): boolean {
  try {
    Temporal.Now.zonedDateTimeISO(timeZone);
    return true;
  } catch {
    return false;
  }
}

export function nowIn(clock: Clock, timeZone: string): Temporal.ZonedDateTime {
  return clock.now().toZonedDateTimeISO(timeZone);
}

export function todayIn(clock: Clock, timeZone: string): Temporal.PlainDate {
  return nowIn(clock, timeZone).toPlainDate();
}

export function weekIdOf(date: Temporal.PlainDate): WeekId {
  return date.subtract({ days: date.dayOfWeek - 1 }).toString();
}

export function nextWeekId(weekId: WeekId): WeekId {
  return Temporal.PlainDate.from(weekId).add({ days: 7 }).toString();
}

/** The seven dates (Monday to Sunday) of a week. */
export function weekDates(weekId: WeekId): Temporal.PlainDate[] {
  const monday = Temporal.PlainDate.from(weekId);
  if (monday.dayOfWeek !== 1) throw new Error(`Not a Monday: ${weekId}`);
  return Array.from({ length: 7 }, (_, i) => monday.add({ days: i }));
}

/** Parses "HH:MM" (24h). */
export function parseTimeOfDay(value: string): Temporal.PlainTime {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) throw new Error(`Invalid time "${value}", expected HH:MM`);
  return Temporal.PlainTime.from(
    { hour: Number(match[1]), minute: Number(match[2]) },
    { overflow: "reject" },
  );
}

/** A wall-clock date and time in a zone. Handles DST gaps by moving forward. */
export function atLocalTime(
  date: Temporal.PlainDate,
  time: Temporal.PlainTime,
  timeZone: string,
): Temporal.ZonedDateTime {
  return date.toZonedDateTime({ timeZone, plainTime: time });
}

/** Discord thread name, for example "Mon 11/09". */
export function threadName(date: Temporal.PlainDate): string {
  const mm = String(date.month).padStart(2, "0");
  const dd = String(date.day).padStart(2, "0");
  return `${WEEKDAYS[date.dayOfWeek - 1]} ${mm}/${dd}`;
}
