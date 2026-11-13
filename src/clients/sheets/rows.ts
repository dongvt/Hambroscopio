import { normalizeName } from "../../domain/normalize.js";
import type {
  Cell,
  ConfigRow,
  CookedRow,
  CookedRowMatch,
  InventoryRow,
  NewCookedRow,
  TitleRow,
} from "./SheetsClient.js";

export const TABS = {
  inventory: { title: "Inventory", headers: ["name", "unit", "quantity"] },
  cooked: {
    title: "Cooked",
    headers: ["date", "week_id", "slot", "title", "rating", "inventory_changes"],
  },
  liked: { title: "Liked", headers: ["title", "date_added"] },
  banned: { title: "Banned", headers: ["title", "date_added"] },
  config: { title: "Config", headers: ["key", "value"] },
} as const;

export type TabKey = keyof typeof TABS;

export const TAB_KEYS = Object.keys(TABS) as TabKey[];

/** Column letter of a 1-based column index (1 → A). Tabs here never exceed 26 columns. */
export function columnLetter(index: number): string {
  return String.fromCharCode(64 + index);
}

export function lastColumn(tab: TabKey): string {
  return columnLetter(TABS[tab].headers.length);
}

/** Data rows start at row 2; row 1 holds the headers. */
export const FIRST_DATA_ROW = 2;

export function cellText(cell: Cell): string {
  return cell === null || cell === undefined ? "" : String(cell).trim();
}

export function parseQuantity(cell: Cell): number | null {
  if (typeof cell === "number") return Number.isFinite(cell) && cell >= 0 ? cell : null;
  const text = cellText(cell);
  if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
  if (/^\d+,\d+$/.test(text)) return Number(text.replace(",", "."));
  return null;
}

/** Returns a problem description, or null if the header row matches. */
export function headerProblem(tab: TabKey, row: Cell[] | undefined): string | null {
  const expected = TABS[tab].headers;
  const actual = expected.map((_, i) => cellText(row?.[i]).toLowerCase());
  const ok = expected.every((h, i) => actual[i] === h);
  if (ok) return null;
  return `${TABS[tab].title}: expected headers [${expected.join(", ")}], found [${actual.join(", ")}]`;
}

function dataRows(rows: Cell[][]): Array<{ rowNumber: number; cells: Cell[] }> {
  return rows.map((cells, i) => ({ rowNumber: FIRST_DATA_ROW + i, cells }));
}

export function parseInventory(rows: Cell[][]): InventoryRow[] {
  return dataRows(rows)
    .filter(({ cells }) => cellText(cells[0]) !== "")
    .map(({ rowNumber, cells }) => ({
      rowNumber,
      name: cellText(cells[0]),
      unit: cellText(cells[1]),
      quantity: parseQuantity(cells[2]),
      quantityRaw: cellText(cells[2]),
    }));
}

export function parseTitles(rows: Cell[][]): TitleRow[] {
  return dataRows(rows)
    .filter(({ cells }) => cellText(cells[0]) !== "")
    .map(({ rowNumber, cells }) => ({
      rowNumber,
      title: cellText(cells[0]),
      dateAdded: cellText(cells[1]),
    }));
}

export function parseCooked(rows: Cell[][]): CookedRow[] {
  return dataRows(rows)
    .filter(({ cells }) => cells.some((c) => cellText(c) !== ""))
    .map(({ rowNumber, cells }) => ({
      rowNumber,
      date: cellText(cells[0]),
      weekId: cellText(cells[1]),
      slot: cellText(cells[2]).toLowerCase(),
      title: cellText(cells[3]),
      rating: cellText(cells[4]).toLowerCase(),
      inventoryChanges: cellText(cells[5]),
    }));
}

export function parseConfig(rows: Cell[][]): ConfigRow[] {
  return dataRows(rows)
    .filter(({ cells }) => cellText(cells[0]) !== "")
    .map(({ rowNumber, cells }) => ({
      rowNumber,
      key: cellText(cells[0]).toLowerCase(),
      value: cells[1],
    }));
}

export function cookedRowCells(row: NewCookedRow): Cell[] {
  return [row.date, row.weekId, row.slot, row.title, "", row.inventoryChanges];
}

export function cookedRowMatches(row: CookedRow, match: CookedRowMatch): boolean {
  return (
    row.weekId === match.weekId &&
    row.slot === match.slot &&
    normalizeName(row.title) === normalizeName(match.title)
  );
}

/** Row number from an A1 range such as "Cooked!A12:F12". */
export function rowFromRange(range: string | null | undefined): number | null {
  const match = /![A-Z]+(\d+)/.exec(range ?? "");
  return match ? Number(match[1]) : null;
}
