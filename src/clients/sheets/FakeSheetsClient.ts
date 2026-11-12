import { normalizeName } from "../../domain/normalize.js";
import type { Rating } from "../../domain/types.js";
import { AppError } from "../../lib/errors.js";
import {
  cellText,
  cookedRowCells,
  cookedRowMatches,
  FIRST_DATA_ROW,
  parseConfig,
  parseCooked,
  parseInventory,
  parseTitles,
  TAB_KEYS,
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

type Operation = keyof SheetsClient;

/** In-memory spreadsheet. `tabs` holds data rows only (row 2 onward), as raw cells. */
export class FakeSheetsClient implements SheetsClient {
  readonly tabs: Record<TabKey, Cell[][]>;
  readonly calls: Array<{ operation: Operation; args: unknown[] }> = [];
  private failures = new Map<Operation, unknown[]>();

  constructor(initial: Partial<Record<TabKey, Cell[][]>> = {}) {
    this.tabs = Object.fromEntries(
      TAB_KEYS.map((t) => [t, (initial[t] ?? []).map((r) => [...r])]),
    ) as Record<TabKey, Cell[][]>;
  }

  /** The next call to `operation` throws `error`. Can be queued several times. */
  failNext(
    operation: Operation,
    error: unknown = new AppError("external", `fake ${operation} failed`),
  ): void {
    const queue = this.failures.get(operation) ?? [];
    queue.push(error);
    this.failures.set(operation, queue);
  }

  async checkTabs(): Promise<void> {
    this.record("checkTabs", []);
  }

  async readConfig(): Promise<ConfigRow[]> {
    this.record("readConfig", []);
    return parseConfig(this.tabs.config);
  }

  async readInventory(): Promise<InventoryRow[]> {
    this.record("readInventory", []);
    return parseInventory(this.tabs.inventory);
  }

  async readLiked(): Promise<TitleRow[]> {
    this.record("readLiked", []);
    return parseTitles(this.tabs.liked);
  }

  async readBanned(): Promise<TitleRow[]> {
    this.record("readBanned", []);
    return parseTitles(this.tabs.banned);
  }

  async readCooked(): Promise<CookedRow[]> {
    this.record("readCooked", []);
    return parseCooked(this.tabs.cooked);
  }

  async updateInventoryQuantities(updates: InventoryUpdate[]): Promise<InventoryUpdateResult> {
    this.record("updateInventoryQuantities", [updates]);
    const applied: number[] = [];
    const mismatched: number[] = [];
    for (const u of updates) {
      const row = this.tabs.inventory[u.rowNumber - FIRST_DATA_ROW];
      if (row && normalizeName(cellText(row[0])) === normalizeName(u.expectedName)) {
        row[2] = u.newQuantity;
        applied.push(u.rowNumber);
      } else {
        mismatched.push(u.rowNumber);
      }
    }
    return { applied, mismatched };
  }

  async appendCooked(row: NewCookedRow): Promise<{ rowNumber: number }> {
    this.record("appendCooked", [row]);
    return { rowNumber: this.append("cooked", cookedRowCells(row)) };
  }

  async updateCookedRating(
    rowNumber: number,
    match: CookedRowMatch,
    rating: Rating,
  ): Promise<void> {
    this.record("updateCookedRating", [rowNumber, match, rating]);
    const rows = parseCooked(this.tabs.cooked);
    const direct = rows.find((r) => r.rowNumber === rowNumber);
    const target =
      direct && cookedRowMatches(direct, match)
        ? direct
        : rows.filter((r) => cookedRowMatches(r, match)).at(-1);
    if (!target)
      throw new AppError("not_found", `Cooked row not found for ${match.weekId} ${match.slot}`);
    const cells = this.tabs.cooked[target.rowNumber - FIRST_DATA_ROW];
    if (cells) cells[4] = rating;
  }

  async appendLiked(title: string, date: string): Promise<void> {
    this.record("appendLiked", [title, date]);
    this.append("liked", [title, date]);
  }

  async appendBanned(title: string, date: string): Promise<void> {
    this.record("appendBanned", [title, date]);
    this.append("banned", [title, date]);
  }

  private append(tab: TabKey, cells: Cell[]): number {
    this.tabs[tab].push([...cells]);
    return FIRST_DATA_ROW + this.tabs[tab].length - 1;
  }

  private record(operation: Operation, args: unknown[]): void {
    this.calls.push({ operation, args });
    const queue = this.failures.get(operation);
    if (queue && queue.length > 0) throw queue.shift();
  }
}
