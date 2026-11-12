import { describe, expect, it } from "vitest";
import {
  headerProblem,
  parseConfig,
  parseCooked,
  parseInventory,
  parseQuantity,
  parseTitles,
  rowFromRange,
} from "../../../src/clients/sheets/rows.js";

describe("parseQuantity", () => {
  it("accepts non-negative numbers", () => {
    expect(parseQuantity(12)).toBe(12);
    expect(parseQuantity(0)).toBe(0);
    expect(parseQuantity(1.5)).toBe(1.5);
    expect(parseQuantity(" 3 ")).toBe(3);
    expect(parseQuantity("2.25")).toBe(2.25);
    expect(parseQuantity("1,5")).toBe(1.5);
  });

  it("rejects blank, negative and non-numeric values", () => {
    for (const v of [undefined, null, "", "abc", "1/2", -1, "-2", "1 1/2", Number.NaN, true]) {
      expect(parseQuantity(v)).toBeNull();
    }
  });
});

describe("parseInventory", () => {
  it("keeps sheet row numbers and skips blank names", () => {
    const rows = parseInventory([
      ["Eggs", "units", 12],
      [],
      ["", "g", 5],
      ["  Rice ", " g ", "abc"],
    ]);
    expect(rows).toEqual([
      { rowNumber: 2, name: "Eggs", unit: "units", quantity: 12, quantityRaw: "12" },
      { rowNumber: 5, name: "Rice", unit: "g", quantity: null, quantityRaw: "abc" },
    ]);
  });
});

describe("parseTitles / parseCooked / parseConfig", () => {
  it("parses titles", () => {
    expect(parseTitles([["Ajiaco", "2026-11-01"], [""], ["Tacos"]])).toEqual([
      { rowNumber: 2, title: "Ajiaco", dateAdded: "2026-11-01" },
      { rowNumber: 4, title: "Tacos", dateAdded: "" },
    ]);
  });

  it("parses cooked rows and lowercases slot and rating", () => {
    const [row] = parseCooked([
      ["2026-11-10", "2026-11-09", "Lunch", "Ajiaco", "Liked", "potatoes -6 units"],
    ]);
    expect(row).toEqual({
      rowNumber: 2,
      date: "2026-11-10",
      weekId: "2026-11-09",
      slot: "lunch",
      title: "Ajiaco",
      rating: "liked",
      inventoryChanges: "potatoes -6 units",
    });
  });

  it("parses config keys case-insensitively and keeps raw values", () => {
    expect(
      parseConfig([
        [" Servings ", 4],
        ["", 1],
        ["lunch_time", "12:00"],
      ]),
    ).toEqual([
      { rowNumber: 2, key: "servings", value: 4 },
      { rowNumber: 4, key: "lunch_time", value: "12:00" },
    ]);
  });
});

describe("headerProblem", () => {
  it("accepts matching headers, ignoring case and spaces", () => {
    expect(headerProblem("inventory", ["Name", " unit ", "QUANTITY"])).toBeNull();
  });

  it("describes mismatches", () => {
    expect(headerProblem("liked", ["title"])).toBe(
      "Liked: expected headers [title, date_added], found [title, ]",
    );
    expect(headerProblem("config", undefined)).toContain("Config");
  });
});

describe("rowFromRange", () => {
  it("extracts the row number", () => {
    expect(rowFromRange("Cooked!A12:F12")).toBe(12);
    expect(rowFromRange("'Cooked'!A7:F7")).toBe(7);
    expect(rowFromRange(undefined)).toBeNull();
  });
});
