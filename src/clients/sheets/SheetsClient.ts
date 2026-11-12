import type { Rating, Slot } from "../../domain/types.js";

/** A raw cell value as returned by the Sheets API (unformatted numbers, formatted dates). */
export type Cell = string | number | boolean | null | undefined;

export interface ConfigRow {
  rowNumber: number;
  key: string;
  value: Cell;
}

export interface InventoryRow {
  rowNumber: number;
  name: string;
  unit: string;
  /** null when the cell is blank or not a non-negative number. */
  quantity: number | null;
  quantityRaw: string;
}

export interface TitleRow {
  rowNumber: number;
  title: string;
  dateAdded: string;
}

export interface CookedRow {
  rowNumber: number;
  date: string;
  weekId: string;
  slot: string;
  title: string;
  rating: string;
  inventoryChanges: string;
}

export interface NewCookedRow {
  date: string;
  weekId: string;
  slot: Slot;
  title: string;
  inventoryChanges: string;
}

export interface InventoryUpdate {
  rowNumber: number;
  /** The row is only written if its current name still matches (rows may have moved). */
  expectedName: string;
  newQuantity: number;
}

export interface InventoryUpdateResult {
  applied: number[];
  mismatched: number[];
}

export interface CookedRowMatch {
  weekId: string;
  slot: Slot;
  title: string;
}

export interface SheetsClient {
  /** Verifies all tabs exist with the expected headers. Throws a config AppError listing problems. */
  checkTabs(): Promise<void>;

  readConfig(): Promise<ConfigRow[]>;
  readInventory(): Promise<InventoryRow[]>;
  readLiked(): Promise<TitleRow[]>;
  readBanned(): Promise<TitleRow[]>;
  readCooked(): Promise<CookedRow[]>;

  updateInventoryQuantities(updates: InventoryUpdate[]): Promise<InventoryUpdateResult>;
  appendCooked(row: NewCookedRow): Promise<{ rowNumber: number }>;
  /** Writes the rating on the given row, or on the last row matching `match` if the row moved. */
  updateCookedRating(rowNumber: number, match: CookedRowMatch, rating: Rating): Promise<void>;
  appendLiked(title: string, date: string): Promise<void>;
  appendBanned(title: string, date: string): Promise<void>;
}
