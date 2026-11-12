import { describe, expect, it } from "vitest";
import { FakeClock } from "../../src/lib/clock.js";
import {
  atLocalTime,
  isValidTimeZone,
  nextWeekId,
  nowIn,
  parseTimeOfDay,
  threadName,
  todayIn,
  weekDates,
  weekIdOf,
} from "../../src/lib/time.js";

const NY = "America/New_York";
const d = (s: string) => Temporal.PlainDate.from(s);

describe("weeks", () => {
  it("identifies a week by its Monday", () => {
    expect(weekIdOf(d("2026-11-09"))).toBe("2026-11-09"); // Monday
    expect(weekIdOf(d("2026-11-11"))).toBe("2026-11-09"); // Wednesday
    expect(weekIdOf(d("2026-11-15"))).toBe("2026-11-09"); // Sunday
    expect(weekIdOf(d("2026-11-16"))).toBe("2026-11-16");
  });

  it("crosses month and year boundaries", () => {
    expect(weekIdOf(d("2027-01-01"))).toBe("2026-12-28");
    expect(nextWeekId("2026-12-28")).toBe("2027-01-04");
  });

  it("lists the seven dates of a week", () => {
    const dates = weekDates("2026-11-09").map(String);
    expect(dates).toEqual([
      "2026-11-09",
      "2026-11-10",
      "2026-11-11",
      "2026-11-12",
      "2026-11-13",
      "2026-11-14",
      "2026-11-15",
    ]);
    expect(() => weekDates("2026-11-10")).toThrow("Not a Monday");
  });

  it("names threads", () => {
    expect(threadName(d("2026-11-09"))).toBe("Mon 11/09");
    expect(threadName(d("2026-11-15"))).toBe("Sun 11/15");
  });
});

describe("time zone math", () => {
  it("uses the local date, not UTC", () => {
    // Sunday 23:30 in New York is already Monday in UTC.
    const clock = new FakeClock("2026-11-16T04:30:00Z");
    expect(todayIn(clock, NY).toString()).toBe("2026-11-15");
    expect(weekIdOf(todayIn(clock, NY))).toBe("2026-11-09");
  });

  it("handles the fall-back DST week (Nov 1, 2026)", () => {
    const clock = new FakeClock("2026-11-01T05:30:00Z"); // 01:30 EDT
    expect(nowIn(clock, NY).toPlainTime().toString()).toBe("01:30:00");
    clock.advance({ hours: 1 }); // 01:30 EST, repeated hour
    expect(nowIn(clock, NY).toPlainTime().toString()).toBe("01:30:00");
    expect(todayIn(clock, NY).toString()).toBe("2026-11-01");

    // Meal times keep their wall-clock hour on both sides of the change.
    const before = atLocalTime(d("2026-10-31"), parseTimeOfDay("18:00"), NY);
    const after = atLocalTime(d("2026-11-02"), parseTimeOfDay("18:00"), NY);
    expect(before.toInstant().toString()).toBe("2026-10-31T22:00:00Z");
    expect(after.toInstant().toString()).toBe("2026-11-02T23:00:00Z");
  });

  it("handles the spring-forward gap (Mar 8, 2026)", () => {
    const zdt = atLocalTime(d("2026-03-08"), parseTimeOfDay("02:30"), NY);
    expect(zdt.toPlainTime().toString()).toBe("03:30:00");
  });

  it("parses times of day", () => {
    expect(parseTimeOfDay("07:30").toString()).toBe("07:30:00");
    expect(parseTimeOfDay(" 7:05 ").toString()).toBe("07:05:00");
    expect(() => parseTimeOfDay("18:00s")).toThrow();
    expect(() => parseTimeOfDay("25:00")).toThrow();
  });

  it("validates time zones", () => {
    expect(isValidTimeZone(NY)).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });
});
