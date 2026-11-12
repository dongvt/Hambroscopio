import type { Rating } from "../../domain/types.js";
import type { Logger } from "../../lib/logger.js";
import type {
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

/** DRY_RUN: reads go to the real sheet, writes are only logged. */
export class DryRunSheetsClient implements SheetsClient {
  constructor(
    private readonly inner: SheetsClient,
    private readonly logger: Logger,
  ) {}

  checkTabs(): Promise<void> {
    return this.inner.checkTabs();
  }
  readConfig(): Promise<ConfigRow[]> {
    return this.inner.readConfig();
  }
  readInventory(): Promise<InventoryRow[]> {
    return this.inner.readInventory();
  }
  readLiked(): Promise<TitleRow[]> {
    return this.inner.readLiked();
  }
  readBanned(): Promise<TitleRow[]> {
    return this.inner.readBanned();
  }
  readCooked(): Promise<CookedRow[]> {
    return this.inner.readCooked();
  }

  async updateInventoryQuantities(updates: InventoryUpdate[]): Promise<InventoryUpdateResult> {
    this.skip("updateInventoryQuantities", { updates });
    return { applied: updates.map((u) => u.rowNumber), mismatched: [] };
  }

  async appendCooked(row: NewCookedRow): Promise<{ rowNumber: number }> {
    this.skip("appendCooked", { row });
    return { rowNumber: 0 };
  }

  async updateCookedRating(
    rowNumber: number,
    match: CookedRowMatch,
    rating: Rating,
  ): Promise<void> {
    this.skip("updateCookedRating", { rowNumber, match, rating });
  }

  async appendLiked(title: string, date: string): Promise<void> {
    this.skip("appendLiked", { title, date });
  }

  async appendBanned(title: string, date: string): Promise<void> {
    this.skip("appendBanned", { title, date });
  }

  private skip(operation: string, args: Record<string, unknown>): void {
    this.logger.info(
      { service: "sheets", operation, dryRun: true, ...args },
      "dry run: write skipped",
    );
  }
}
