import { sheets, type sheets_v4 } from "@googleapis/sheets";
import { normalizeName } from "../../domain/normalize.js";
import type { Rating } from "../../domain/types.js";
import { AppError } from "../../lib/errors.js";
import type { Logger } from "../../lib/logger.js";
import { createGoogleAuth, toGoogleAppError } from "../google/auth.js";
import {
  cellText,
  cookedRowCells,
  cookedRowMatches,
  FIRST_DATA_ROW,
  headerProblem,
  lastColumn,
  parseConfig,
  parseCooked,
  parseInventory,
  parseTitles,
  rowFromRange,
  TAB_KEYS,
  TABS,
  type TabKey,
} from "./rows.js";
import type {
  Cell,
  ConfigRow,
  CookedRow,
  CookedRowMatch,
  InventoryRow,
  InventoryUpdate,
  InventoryUpdateResult,
  NewCookedRow,
  SheetsClient,
  TitleRow,
} from "./SheetsClient.js";

export const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

export class GoogleSheetsClient implements SheetsClient {
  constructor(
    private readonly api: sheets_v4.Sheets,
    private readonly spreadsheetId: string,
    private readonly logger: Logger,
  ) {}

  static create(spreadsheetId: string, logger: Logger): GoogleSheetsClient {
    const api = sheets({ version: "v4", auth: createGoogleAuth([SHEETS_SCOPE]) });
    return new GoogleSheetsClient(api, spreadsheetId, logger);
  }

  async checkTabs(): Promise<void> {
    const meta = await this.call("getTabs", "(spreadsheet)", () =>
      this.api.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
        fields: "sheets.properties.title",
      }),
    );
    const existing = new Set((meta.data.sheets ?? []).map((s) => s.properties?.title ?? ""));
    const problems: string[] = TAB_KEYS.filter((t) => !existing.has(TABS[t].title)).map(
      (t) => `missing tab "${TABS[t].title}"`,
    );

    const present = TAB_KEYS.filter((t) => existing.has(TABS[t].title));
    const ranges = present.map((t) => `${TABS[t].title}!A1:${lastColumn(t)}1`);
    if (ranges.length > 0) {
      const res = await this.call("getHeaders", ranges.join(","), () =>
        this.api.spreadsheets.values.batchGet({ spreadsheetId: this.spreadsheetId, ranges }),
      );
      present.forEach((tab, i) => {
        const row = res.data.valueRanges?.[i]?.values?.[0] as Cell[] | undefined;
        const problem = headerProblem(tab, row);
        if (problem) problems.push(problem);
      });
    }

    if (problems.length > 0) {
      throw new AppError("config", `Spreadsheet problems:\n  - ${problems.join("\n  - ")}`);
    }
  }

  async readConfig(): Promise<ConfigRow[]> {
    return parseConfig(await this.readDataRows("config"));
  }

  async readInventory(): Promise<InventoryRow[]> {
    return parseInventory(await this.readDataRows("inventory"));
  }

  async readLiked(): Promise<TitleRow[]> {
    return parseTitles(await this.readDataRows("liked"));
  }

  async readBanned(): Promise<TitleRow[]> {
    return parseTitles(await this.readDataRows("banned"));
  }

  async readCooked(): Promise<CookedRow[]> {
    return parseCooked(await this.readDataRows("cooked"));
  }

  async updateInventoryQuantities(updates: InventoryUpdate[]): Promise<InventoryUpdateResult> {
    if (updates.length === 0) return { applied: [], mismatched: [] };
    const tab = TABS.inventory.title;

    const names = await this.call("getInventoryNames", `${tab}!A:A`, () =>
      this.api.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: `${tab}!A:A`,
        valueRenderOption: "UNFORMATTED_VALUE",
      }),
    );
    const column = (names.data.values ?? []) as Cell[][];

    const applied: InventoryUpdate[] = [];
    const mismatched: number[] = [];
    for (const u of updates) {
      const current = cellText(column[u.rowNumber - 1]?.[0]);
      if (normalizeName(current) === normalizeName(u.expectedName)) applied.push(u);
      else mismatched.push(u.rowNumber);
    }
    if (mismatched.length > 0) {
      this.logger.warn({ mismatched }, "inventory rows moved; skipped mismatched rows");
    }

    if (applied.length > 0) {
      const data = applied.map((u) => ({
        range: `${tab}!C${u.rowNumber}`,
        values: [[u.newQuantity]],
      }));
      await this.call("updateInventory", data.map((d) => d.range).join(","), () =>
        this.api.spreadsheets.values.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          requestBody: { valueInputOption: "RAW", data },
        }),
      );
    }
    return { applied: applied.map((u) => u.rowNumber), mismatched };
  }

  async appendCooked(row: NewCookedRow): Promise<{ rowNumber: number }> {
    const rowNumber = await this.appendRow("cooked", cookedRowCells(row));
    return { rowNumber };
  }

  async updateCookedRating(
    rowNumber: number,
    match: CookedRowMatch,
    rating: Rating,
  ): Promise<void> {
    const tab = TABS.cooked.title;
    const range = `${tab}!A${rowNumber}:${lastColumn("cooked")}${rowNumber}`;
    const res = await this.call("getCookedRow", range, () =>
      this.api.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range,
        valueRenderOption: "UNFORMATTED_VALUE",
        dateTimeRenderOption: "FORMATTED_STRING",
      }),
    );
    const [current] = parseCooked((res.data.values ?? []) as Cell[][]);

    let target = rowNumber;
    if (!current || !cookedRowMatches(current, match)) {
      const all = await this.readCooked();
      const found = all.filter((r) => cookedRowMatches(r, match)).at(-1);
      if (!found) {
        throw new AppError("not_found", `Cooked row not found for ${match.weekId} ${match.slot}`, {
          details: { ...match, rowNumber },
        });
      }
      this.logger.warn({ from: rowNumber, to: found.rowNumber }, "cooked row moved");
      target = found.rowNumber;
    }

    const ratingRange = `${tab}!E${target}`;
    await this.call("updateCookedRating", ratingRange, () =>
      this.api.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: ratingRange,
        valueInputOption: "RAW",
        requestBody: { values: [[rating]] },
      }),
    );
  }

  async appendLiked(title: string, date: string): Promise<void> {
    await this.appendRow("liked", [title, date]);
  }

  async appendBanned(title: string, date: string): Promise<void> {
    await this.appendRow("banned", [title, date]);
  }

  private async readDataRows(tab: TabKey): Promise<Cell[][]> {
    const range = `${TABS[tab].title}!A${FIRST_DATA_ROW}:${lastColumn(tab)}`;
    const res = await this.call("read", range, () =>
      this.api.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range,
        valueRenderOption: "UNFORMATTED_VALUE",
        dateTimeRenderOption: "FORMATTED_STRING",
      }),
    );
    return (res.data.values ?? []) as Cell[][];
  }

  /** Appends with RAW input so dates and IDs stay plain text. Returns the written row number. */
  private async appendRow(tab: TabKey, cells: Cell[]): Promise<number> {
    const range = `${TABS[tab].title}!A:${lastColumn(tab)}`;
    const res = await this.call("append", range, () =>
      this.api.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range,
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: [cells] },
      }),
    );
    const row = rowFromRange(res.data.updates?.updatedRange);
    if (row === null) {
      throw new AppError("external", `Sheets append to ${range} returned no row`, {
        details: { updatedRange: res.data.updates?.updatedRange },
      });
    }
    return row;
  }

  private async call<T>(operation: string, range: string, fn: () => Promise<T>): Promise<T> {
    const started = performance.now();
    try {
      const result = await fn();
      this.logger.info(
        {
          service: "sheets",
          operation,
          range,
          durationMs: Math.round(performance.now() - started),
        },
        "sheets call ok",
      );
      return result;
    } catch (error) {
      const appError = toGoogleAppError("Sheets", operation, error);
      this.logger.error(
        {
          service: "sheets",
          operation,
          range,
          durationMs: Math.round(performance.now() - started),
          status: appError.details?.status,
          error: appError.message,
        },
        "sheets call failed",
      );
      throw appError;
    }
  }
}
