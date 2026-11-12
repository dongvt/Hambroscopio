import { describe, expect, it } from "vitest";
import { FakeSheetsClient } from "../../../src/clients/sheets/FakeSheetsClient.js";
import { AppError } from "../../../src/lib/errors.js";

function sample() {
  return new FakeSheetsClient({
    inventory: [
      ["Eggs", "units", 12],
      ["Rice", "g", 2000],
    ],
    cooked: [["2026-11-09", "2026-11-09", "breakfast", "Arepas", "", "eggs -2 units"]],
  });
}

describe("FakeSheetsClient", () => {
  it("updates quantities only where the name still matches", async () => {
    const sheets = sample();
    const result = await sheets.updateInventoryQuantities([
      { rowNumber: 2, expectedName: " eggs ", newQuantity: 9 },
      { rowNumber: 3, expectedName: "Chicken", newQuantity: 1 },
      { rowNumber: 10, expectedName: "Milk", newQuantity: 1 },
    ]);
    expect(result).toEqual({ applied: [2], mismatched: [3, 10] });
    const inventory = await sheets.readInventory();
    expect(inventory.map((r) => r.quantity)).toEqual([9, 2000]);
  });

  it("appends cooked rows and returns their row number", async () => {
    const sheets = sample();
    const { rowNumber } = await sheets.appendCooked({
      date: "2026-11-10",
      weekId: "2026-11-09",
      slot: "lunch",
      title: "Ajiaco",
      inventoryChanges: "potatoes -6 units",
    });
    expect(rowNumber).toBe(3);
    const cooked = await sheets.readCooked();
    expect(cooked[1]).toMatchObject({ rowNumber: 3, title: "Ajiaco", rating: "" });
  });

  it("rates the given row, or finds it if it moved", async () => {
    const sheets = sample();
    await sheets.updateCookedRating(
      2,
      { weekId: "2026-11-09", slot: "breakfast", title: "Arepas" },
      "liked",
    );
    expect((await sheets.readCooked())[0]?.rating).toBe("liked");

    sheets.tabs.cooked.unshift(["2026-11-01", "2026-10-26", "dinner", "Other", "", ""]);
    await sheets.updateCookedRating(
      2,
      { weekId: "2026-11-09", slot: "breakfast", title: "arepas" },
      "disliked",
    );
    const cooked = await sheets.readCooked();
    expect(cooked[0]?.rating).toBe("");
    expect(cooked[1]?.rating).toBe("disliked");
  });

  it("throws not_found when no cooked row matches", async () => {
    const sheets = sample();
    await expect(
      sheets.updateCookedRating(2, { weekId: "2026-11-09", slot: "dinner", title: "X" }, "liked"),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("appends liked and banned titles", async () => {
    const sheets = sample();
    await sheets.appendLiked("Ajiaco", "2026-11-10");
    await sheets.appendBanned("Liver", "2026-11-10");
    expect(await sheets.readLiked()).toEqual([
      { rowNumber: 2, title: "Ajiaco", dateAdded: "2026-11-10" },
    ]);
    expect((await sheets.readBanned())[0]?.title).toBe("Liver");
  });

  it("injects failures once per queued error and records calls", async () => {
    const sheets = sample();
    sheets.failNext("readInventory");
    await expect(sheets.readInventory()).rejects.toBeInstanceOf(AppError);
    await expect(sheets.readInventory()).resolves.toHaveLength(2);
    expect(sheets.calls.map((c) => c.operation)).toEqual(["readInventory", "readInventory"]);
  });

  it("does not share state with its initial data", async () => {
    const initial = { inventory: [["Eggs", "units", 12]] };
    const sheets = new FakeSheetsClient(initial);
    await sheets.updateInventoryQuantities([
      { rowNumber: 2, expectedName: "Eggs", newQuantity: 1 },
    ]);
    expect(initial.inventory[0]?.[2]).toBe(12);
  });
});
