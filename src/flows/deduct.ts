import { normalizeName } from "../domain/normalize.js";
import type { MealOption } from "../planner/schema.js";
import type { InventoryUpdate, SheetsClient } from "../clients/sheets/SheetsClient.js";
import { AppError } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";

export interface DeductionResult {
  inventoryChanges: string;
  warnings: string[];
}

export async function deductIngredients(
  sheets: SheetsClient,
  option: MealOption,
  logger: Logger,
): Promise<DeductionResult> {
  const { updates, result } = await calculateDeduction(sheets, option, logger);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const applied = await sheets.updateInventoryQuantities(updates);
      if (applied.mismatched.length > 0) {
        throw new AppError("state", "Inventory rows moved during deduction.", {
          details: { mismatchedRows: applied.mismatched },
        });
      }
      if (applied.applied.length !== updates.length) {
        throw new AppError(
          "state",
          "Inventory deduction did not apply all requested row updates.",
          {
            details: { expected: updates.length, applied: applied.applied.length },
          },
        );
      }
      return result;
    } catch (error) {
      if (attempt === 1 || !(error instanceof AppError) || error.code !== "external") throw error;
      logger.warn({ err: error }, "inventory deduction failed; retrying once");
    }
  }
  throw new AppError("state", "Inventory deduction retry loop ended unexpectedly.");
}

async function calculateDeduction(
  sheets: SheetsClient,
  option: MealOption,
  logger: Logger,
): Promise<{ updates: InventoryUpdate[]; result: DeductionResult }> {
  const inventory = await sheets.readInventory();
  const updates = new Map<number, InventoryUpdate>();
  const changes: string[] = [];
  const warnings: string[] = [];
  const virtual = new Map<number, number>();

  for (const ingredient of option.ingredients_used) {
    const matches = inventory.filter(
      (row) => normalizeName(row.name) === normalizeName(ingredient.name),
    );
    if (matches.length === 0) {
      warnings.push(`Inventory row not found for ${ingredient.name}; no quantity was deducted.`);
      logger.warn({ ingredient: ingredient.name }, "inventory deduction row not found");
      continue;
    }
    if (matches.length > 1) {
      logger.warn(
        { ingredient: ingredient.name, rowNumbers: matches.map((row) => row.rowNumber) },
        "duplicate inventory names found; deduction will spill across matching rows",
      );
    }

    let remaining = ingredient.quantity;
    let totalDeducted = 0;
    for (const row of matches) {
      if (remaining <= 0) break;
      if (row.quantity === null) {
        warnings.push(`Inventory quantity for ${row.name} (row ${row.rowNumber}) is invalid.`);
        logger.warn(
          { rowNumber: row.rowNumber, ingredient: row.name },
          "invalid inventory quantity skipped during deduction",
        );
        continue;
      }

      const current = virtual.get(row.rowNumber) ?? row.quantity;
      const deducted = Math.min(current, remaining);
      if (deducted <= 0) continue;
      const next = current - deducted;
      virtual.set(row.rowNumber, next);
      updates.set(row.rowNumber, {
        rowNumber: row.rowNumber,
        expectedName: row.name,
        newQuantity: next,
      });
      remaining -= deducted;
      totalDeducted += deducted;
    }

    if (remaining > 0) {
      warnings.push(
        `${ingredient.name}: requested ${ingredient.quantity} ${ingredient.unit}, but only ${totalDeducted} was available; inventory was clamped at zero.`,
      );
      logger.warn(
        { ingredient: ingredient.name, requested: ingredient.quantity, deducted: totalDeducted },
        "inventory deduction clamped at zero",
      );
    }
    changes.push(`${ingredient.name} -${totalDeducted} ${ingredient.unit}`);
  }

  return {
    updates: [...updates.values()],
    result: { inventoryChanges: changes.join("; "), warnings },
  };
}
