/** Key used to match inventory names: trimmed, single-spaced, case-insensitive. */
export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}
