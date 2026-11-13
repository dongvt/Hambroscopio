import type { AppSettings } from "../config/sheetConfig.js";
import { normalizeName } from "../domain/normalize.js";
import type { Slot } from "../domain/types.js";
import { plannerOutputSchema } from "./schema.js";

export interface InventoryItem {
  name: string;
  unit: string;
  quantity: number;
}

export interface PlannerInput {
  settings: AppSettings;
  inventory: InventoryItem[];
  banned: string[];
  liked: string[];
  recentlyCooked: string[];
  existingWeekTitles: string[];
  meals: Array<{ date: string; slot: Slot; options: number }>;
  reserveLunchFirstOption: boolean;
}

function normalizeUnit(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

function normalizeTitle(value: string): string {
  return normalizeName(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compareName(a: string, b: string): boolean {
  return normalizeTitle(a) === normalizeTitle(b);
}

const SLOT_ORDER: Record<Slot, number> = { breakfast: 0, lunch: 1, dinner: 2 };

export function validatePlannerOutput(output: unknown, input: PlannerInput): string[] {
  const issues: string[] = [];
  const parsed = plannerOutputSchema.safeParse(output);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => `JSON schema issue: ${issue.message}`);
  }

  const inventoryIndex = new Map<string, InventoryItem>();
  for (const item of input.inventory) {
    const key = normalizeTitle(item.name);
    const existing = inventoryIndex.get(key);
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      inventoryIndex.set(key, { ...item, name: item.name.trim() });
    }
  }

  const ledger = new Map<string, number>();
  for (const item of input.inventory) {
    const key = normalizeTitle(item.name);
    const current = ledger.get(key) ?? 0;
    ledger.set(key, current + item.quantity);
  }

  const seenTitles = new Set<string>(input.existingWeekTitles.map(normalizeTitle));
  const meals = [...parsed.data.meals].sort((a, b) => {
    const ad = new Date(`${a.date}T00:00:00Z`);
    const bd = new Date(`${b.date}T00:00:00Z`);
    const dateDelta = ad.getTime() - bd.getTime();
    return dateDelta !== 0 ? dateDelta : SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot];
  });

  for (const meal of meals) {
    const expectedOptions =
      input.meals.find((target) => target.date === meal.date && target.slot === meal.slot)
        ?.options ?? meal.options.length;
    if (meal.options.length > expectedOptions) {
      issues.push(`Meal ${meal.date} ${meal.slot} exceeds the configured option count.`);
    }

    const optionTitles = new Set<string>();
    for (const [index, option] of meal.options.entries()) {
      const titleKey = normalizeTitle(option.title);
      if (!optionTitles.has(titleKey)) {
        optionTitles.add(titleKey);
      } else {
        issues.push(`Duplicate title "${option.title}" in ${meal.date} ${meal.slot}.`);
      }

      if (input.banned.some((title) => compareName(title, option.title))) {
        issues.push(
          `Meal ${meal.date} ${meal.slot} option "${option.title}" is on the banned list.`,
        );
      }

      if (input.recentlyCooked.some((title) => compareName(title, option.title))) {
        issues.push(
          `Meal ${meal.date} ${meal.slot} option "${option.title}" repeats a recent cooked title.`,
        );
      }

      if (seenTitles.has(titleKey)) {
        issues.push(
          `Meal ${meal.date} ${meal.slot} repeats a title already planned in the week: "${option.title}".`,
        );
      }
      seenTitles.add(titleKey);

      if (option.servings !== input.settings.servings) {
        issues.push(
          `Meal ${meal.date} ${meal.slot} option "${option.title}" has ${option.servings} servings, expected ${input.settings.servings}.`,
        );
      }

      for (const ingredient of option.ingredients_used) {
        const inventoryItem = inventoryIndex.get(normalizeTitle(ingredient.name));
        if (!inventoryItem) {
          issues.push(`Ingredient "${ingredient.name}" is not in inventory.`);
          continue;
        }

        if (normalizeUnit(ingredient.unit) !== normalizeUnit(inventoryItem.unit)) {
          issues.push(
            `Ingredient "${ingredient.name}" unit mismatch: got ${ingredient.unit}, expected ${inventoryItem.unit}.`,
          );
        }

        if (ingredient.quantity <= 0) {
          issues.push(`Ingredient "${ingredient.name}" quantity must be positive.`);
        }

        const key = normalizeTitle(ingredient.name);
        const available = ledger.get(key) ?? 0;
        if (meal.slot === "lunch" && input.reserveLunchFirstOption && index === 0) {
          if (available < ingredient.quantity) {
            issues.push(
              `Lunch reserve for ${meal.date} ${meal.slot} cannot cover "${ingredient.name}": available ${available}, needed ${ingredient.quantity}.`,
            );
          } else {
            ledger.set(key, available - ingredient.quantity);
          }
          continue;
        }

        if (available < ingredient.quantity) {
          issues.push(
            `Ingredient "${ingredient.name}" is insufficient for ${meal.date} ${meal.slot}, available ${available}, needed ${ingredient.quantity}.`,
          );
        }
      }
    }
  }

  return [...new Set(issues)];
}

export function validateMealPlan(output: unknown, input: PlannerInput): string[] {
  return validatePlannerOutput(output, input);
}
