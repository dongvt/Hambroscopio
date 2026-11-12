import type { sheets_v4 } from "@googleapis/sheets";
import { describe, expect, it, vi } from "vitest";
import { GoogleSheetsClient } from "../../../src/clients/sheets/GoogleSheetsClient.js";
import { AppError } from "../../../src/lib/errors.js";
import { captureLogger } from "../../helpers/logger.js";

type Fn = ReturnType<typeof vi.fn>;

function stubApi(
  overrides: Partial<
    Record<"get" | "batchGet" | "batchUpdate" | "append" | "update" | "meta", Fn>
  > = {},
) {
  const fns = {
    meta: overrides.meta ?? vi.fn(),
    get: overrides.get ?? vi.fn(async () => ({ data: { values: [] } })),
    batchGet: overrides.batchGet ?? vi.fn(),
    batchUpdate: overrides.batchUpdate ?? vi.fn(async () => ({ data: {} })),
    append: overrides.append ?? vi.fn(),
    update: overrides.update ?? vi.fn(async () => ({ data: {} })),
  };
  const api = {
    spreadsheets: {
      get: fns.meta,
      values: {
        get: fns.get,
        batchGet: fns.batchGet,
        batchUpdate: fns.batchUpdate,
        append: fns.append,
        update: fns.update,
      },
    },
  } as unknown as sheets_v4.Sheets;
  const { logger, lines } = captureLogger();
  return { fns, lines, client: new GoogleSheetsClient(api, "sheet-id", logger) };
}

const HEADERS = {
  Inventory: ["name", "unit", "quantity"],
  Cooked: ["date", "week_id", "slot", "title", "rating", "inventory_changes"],
  Liked: ["title", "date_added"],
  Banned: ["title", "date_added"],
  Config: ["key", "value"],
};

describe("GoogleSheetsClient", () => {
  it("reads data rows from row 2 with unformatted values", async () => {
    const get = vi.fn(async () => ({ data: { values: [["Eggs", "units", 12]] } }));
    const { client, lines } = stubApi({ get });
    const rows = await client.readInventory();
    expect(rows).toEqual([
      { rowNumber: 2, name: "Eggs", unit: "units", quantity: 12, quantityRaw: "12" },
    ]);
    expect(get).toHaveBeenCalledWith({
      spreadsheetId: "sheet-id",
      range: "Inventory!A2:C",
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    });
    expect(lines.at(-1)).toMatchObject({
      service: "sheets",
      operation: "read",
      range: "Inventory!A2:C",
      msg: "sheets call ok",
    });
    expect(typeof lines.at(-1)?.durationMs).toBe("number");
  });

  it("passes checkTabs when all tabs and headers are present", async () => {
    const meta = vi.fn(async () => ({
      data: { sheets: Object.keys(HEADERS).map((title) => ({ properties: { title } })) },
    }));
    const batchGet = vi.fn(async () => ({
      data: { valueRanges: Object.values(HEADERS).map((h) => ({ values: [h] })) },
    }));
    const { client } = stubApi({ meta, batchGet });
    await expect(client.checkTabs()).resolves.toBeUndefined();
  });

  it("reports missing tabs and wrong headers together", async () => {
    const meta = vi.fn(async () => ({
      data: {
        sheets: ["Inventory", "Cooked", "Liked", "Config"].map((title) => ({
          properties: { title },
        })),
      },
    }));
    const batchGet = vi.fn(async () => ({
      data: {
        valueRanges: [
          { values: [["name", "units", "quantity"]] },
          { values: [HEADERS.Cooked] },
          { values: [HEADERS.Liked] },
          { values: [HEADERS.Config] },
        ],
      },
    }));
    const { client } = stubApi({ meta, batchGet });
    const error = (await client.checkTabs().catch((e) => e)) as AppError;
    expect(error.code).toBe("config");
    expect(error.message).toContain('missing tab "Banned"');
    expect(error.message).toContain("Inventory: expected headers [name, unit, quantity]");
    expect(batchGet).toHaveBeenCalledWith({
      spreadsheetId: "sheet-id",
      ranges: ["Inventory!A1:C1", "Cooked!A1:F1", "Liked!A1:B1", "Config!A1:B1"],
    });
  });

  it("writes only inventory rows whose name still matches", async () => {
    const get = vi.fn(async () => ({
      data: { values: [["name"], ["Eggs"], ["Rice"], ["Milk"]] },
    }));
    const batchUpdate = vi.fn(async () => ({ data: {} }));
    const { client } = stubApi({ get, batchUpdate });
    const result = await client.updateInventoryQuantities([
      { rowNumber: 2, expectedName: "eggs", newQuantity: 10 },
      { rowNumber: 3, expectedName: "Chicken", newQuantity: 0 },
      { rowNumber: 4, expectedName: "Milk", newQuantity: 1.5 },
    ]);
    expect(result).toEqual({ applied: [2, 4], mismatched: [3] });
    expect(batchUpdate).toHaveBeenCalledWith({
      spreadsheetId: "sheet-id",
      requestBody: {
        valueInputOption: "RAW",
        data: [
          { range: "Inventory!C2", values: [[10]] },
          { range: "Inventory!C4", values: [[1.5]] },
        ],
      },
    });
  });

  it("skips the write call when nothing matches or nothing to do", async () => {
    const get = vi.fn(async () => ({ data: { values: [["name"], ["Eggs"]] } }));
    const batchUpdate = vi.fn();
    const { client } = stubApi({ get, batchUpdate });
    await client.updateInventoryQuantities([]);
    await client.updateInventoryQuantities([
      { rowNumber: 2, expectedName: "Rice", newQuantity: 1 },
    ]);
    expect(get).toHaveBeenCalledTimes(1);
    expect(batchUpdate).not.toHaveBeenCalled();
  });

  it("appends cooked rows as RAW and returns the row number", async () => {
    const append = vi.fn(async () => ({
      data: { updates: { updatedRange: "Cooked!A7:F7" } },
    }));
    const { client } = stubApi({ append });
    const result = await client.appendCooked({
      date: "2026-11-12",
      weekId: "2026-11-09",
      slot: "lunch",
      title: "Ajiaco",
      inventoryChanges: "potatoes -6 units",
    });
    expect(result).toEqual({ rowNumber: 7 });
    expect(append).toHaveBeenCalledWith({
      spreadsheetId: "sheet-id",
      range: "Cooked!A:F",
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [["2026-11-12", "2026-11-09", "lunch", "Ajiaco", "", "potatoes -6 units"]],
      },
    });
  });

  it("finds a moved cooked row before rating it", async () => {
    const get = vi.fn(async ({ range }: { range: string }) => {
      if (range === "Cooked!A5:F5")
        return { data: { values: [["x", "2026-11-02", "dinner", "Other"]] } };
      return {
        data: {
          values: [
            ["2026-11-10", "2026-11-09", "lunch", "Ajiaco", "", ""],
            ["2026-11-10", "2026-11-09", "dinner", "Other", "", ""],
          ],
        },
      };
    });
    const update = vi.fn(async () => ({ data: {} }));
    const { client } = stubApi({ get, update });
    await client.updateCookedRating(
      5,
      { weekId: "2026-11-09", slot: "lunch", title: "Ajiaco" },
      "liked",
    );
    expect(update).toHaveBeenCalledWith({
      spreadsheetId: "sheet-id",
      range: "Cooked!E2",
      valueInputOption: "RAW",
      requestBody: { values: [["liked"]] },
    });
  });

  it("turns API errors into AppErrors without leaking request headers", async () => {
    const apiError = Object.assign(new Error("The caller does not have permission"), {
      status: 403,
      config: { headers: { Authorization: "Bearer ya29.secret-token" } },
    });
    const get = vi.fn(async () => {
      throw apiError;
    });
    const { client, lines } = stubApi({ get });
    const error = (await client.readConfig().catch((e) => e)) as AppError;
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe("external");
    expect(error.message).toContain("Sheets read failed: The caller does not have permission");
    expect(error.message).toContain("shared with the service account");
    expect(error.details).toMatchObject({ status: 403 });
    expect(error.cause).toBeUndefined();
    expect(JSON.stringify(lines)).not.toContain("ya29");
    expect(lines.at(-1)).toMatchObject({ msg: "sheets call failed", status: 403 });
  });

  it("hints at gcloud ADC login when credentials are missing", async () => {
    const get = vi.fn(async () => {
      throw new Error("Could not load the default credentials.");
    });
    const { client } = stubApi({ get });
    const error = (await client.readConfig().catch((e) => e)) as AppError;
    expect(error.message).toContain("gcloud auth application-default login");
  });
});
