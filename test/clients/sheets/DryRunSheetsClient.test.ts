import { describe, expect, it } from "vitest";
import { DryRunSheetsClient } from "../../../src/clients/sheets/DryRunSheetsClient.js";
import { FakeSheetsClient } from "../../../src/clients/sheets/FakeSheetsClient.js";
import { captureLogger } from "../../helpers/logger.js";

describe("DryRunSheetsClient", () => {
  it("reads through and skips every write", async () => {
    const inner = new FakeSheetsClient({ inventory: [["Eggs", "units", 12]] });
    const { logger, lines } = captureLogger();
    const sheets = new DryRunSheetsClient(inner, logger);

    expect(await sheets.readInventory()).toHaveLength(1);

    const result = await sheets.updateInventoryQuantities([
      { rowNumber: 2, expectedName: "Eggs", newQuantity: 0 },
    ]);
    expect(result).toEqual({ applied: [2], mismatched: [] });
    await sheets.appendCooked({
      date: "2026-11-10",
      weekId: "2026-11-09",
      slot: "dinner",
      title: "Arroz con pollo",
      inventoryChanges: "",
    });
    await sheets.updateCookedRating(
      0,
      { weekId: "2026-11-09", slot: "dinner", title: "x" },
      "liked",
    );
    await sheets.appendLiked("A", "2026-11-10");
    await sheets.appendBanned("B", "2026-11-10");

    expect(inner.calls.map((c) => c.operation)).toEqual(["readInventory"]);
    expect(inner.tabs.inventory[0]?.[2]).toBe(12);
    const skipped = lines.filter((l) => l.dryRun === true).map((l) => l.operation);
    expect(skipped).toEqual([
      "updateInventoryQuantities",
      "appendCooked",
      "updateCookedRating",
      "appendLiked",
      "appendBanned",
    ]);
  });
});
