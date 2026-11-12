import { describe, expect, it } from "vitest";
import type { ConfigRow } from "../../src/clients/sheets/SheetsClient.js";
import { CONFIG_KEYS, defaultSettings, parseSettings } from "../../src/config/sheetConfig.js";

const rows = (entries: Array<[string, unknown]>): ConfigRow[] =>
  entries.map(([key, value], i) => ({ rowNumber: i + 2, key, value: value as ConfigRow["value"] }));

describe("parseSettings", () => {
  it("uses defaults for an empty tab", () => {
    const { settings, warnings, defaulted } = parseSettings([]);
    expect(settings).toEqual(defaultSettings());
    expect(warnings).toEqual([]);
    expect(defaulted).toEqual(CONFIG_KEYS);
  });

  it("matches the spec defaults", () => {
    const s = defaultSettings();
    expect(s.servings).toBe(4);
    expect(s.options).toEqual({ breakfast: 1, lunch: 3, dinner: 1 });
    expect(s.times.breakfast.toString()).toBe("07:30:00");
    expect(s.minutes).toEqual({ breakfast: 30, lunch: 45, dinner: 60 });
    expect(s.timezone).toBe("America/New_York");
    expect(s.planDay).toBe(7);
    expect(s.planTime.toString()).toBe("18:00:00");
  });

  it("parses a full tab as the setup guide writes it", () => {
    const { settings, warnings, defaulted } = parseSettings(
      rows([
        ["servings", 4],
        ["breakfast_options", 1],
        ["lunch_options", 2],
        ["dinner_options", "1"],
        ["breakfast_time", "7:00:00"],
        ["lunch_time", "12:30 PM"],
        ["dinner_time", 0.78125],
        ["breakfast_minutes", 20],
        ["lunch_minutes", 45],
        ["dinner_minutes", 90],
        ["timezone", "America/Bogota"],
        ["language", "Spanish"],
        ["no_repeat_weeks", 3],
        ["assumed_staples", "Salt, pepper , water,,oil"],
        ["reaction_debounce_seconds", 5],
        ["plan_day", "Saturday"],
        ["plan_time", "17:00"],
        ["catch_up", false],
      ]),
    );
    expect(warnings).toEqual([]);
    expect(defaulted).toEqual([]);
    expect(settings.options.lunch).toBe(2);
    expect(settings.options.dinner).toBe(1);
    expect(settings.times.breakfast.toString()).toBe("07:00:00");
    expect(settings.times.lunch.toString()).toBe("12:30:00");
    expect(settings.times.dinner.toString()).toBe("18:45:00");
    expect(settings.minutes.dinner).toBe(90);
    expect(settings.timezone).toBe("America/Bogota");
    expect(settings.language).toBe("Spanish");
    expect(settings.assumedStaples).toEqual(["salt", "pepper", "water", "oil"]);
    expect(settings.planDay).toBe(6);
    expect(settings.planTime.toString()).toBe("17:00:00");
    expect(settings.catchUp).toBe(false);
  });

  it("falls back to defaults for invalid values with a warning", () => {
    const { settings, warnings } = parseSettings(
      rows([
        ["servings", "four"],
        ["lunch_options", 0],
        ["plan_time", "18:00s"],
        ["timezone", "Mars/Olympus"],
        ["plan_day", "someday"],
        ["catch_up", "maybe"],
        ["dinner_time", "12:00 PMX"],
      ]),
    );
    expect(settings).toEqual(defaultSettings());
    expect(warnings).toHaveLength(7);
    expect(warnings[0]).toBe(
      'Config row 2: invalid value "four" for "servings", using the default',
    );
  });

  it("warns about unknown and duplicate keys", () => {
    const { settings, warnings } = parseSettings(
      rows([
        ["servings", 5],
        ["servings", 6],
        ["favorite_color", "blue"],
      ]),
    );
    expect(settings.servings).toBe(5);
    expect(warnings).toEqual([
      'Config row 3: duplicate key "servings" ignored',
      'Config row 4: unknown key "favorite_color" ignored',
    ]);
  });

  it("accepts short day names and AM times", () => {
    const { settings } = parseSettings(
      rows([
        ["plan_day", "SUN"],
        ["breakfast_time", "12:15 am"],
      ]),
    );
    expect(settings.planDay).toBe(7);
    expect(settings.times.breakfast.toString()).toBe("00:15:00");
  });

  it("returns independent default objects", () => {
    const a = parseSettings(rows([["lunch_options", 2]])).settings;
    const b = parseSettings([]).settings;
    expect(a.options.lunch).toBe(2);
    expect(b.options.lunch).toBe(3);
  });
});
