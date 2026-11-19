import type { DiscordGateway, MessageRef } from "../clients/discord/DiscordGateway.js";
import type { SheetsClient } from "../clients/sheets/SheetsClient.js";
import { parseSettings } from "../config/sheetConfig.js";
import { EMOJIS } from "../domain/emojis.js";
import { transitionMealState } from "../domain/mealState.js";
import { renderMealMessage } from "../domain/render.js";
import { normalizeName } from "../domain/normalize.js";
import type { Clock } from "../lib/clock.js";
import { currentCorrelationId } from "../lib/context.js";
import { AppError, funErrorMessage } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";
import { optionSchema } from "../planner/schema.js";
import type { MealRecord, StateStore } from "../state/repos.js";

export interface RateDeps {
  sheets: SheetsClient;
  discord: DiscordGateway;
  state: StateStore;
  clock: Clock;
  logger: Logger;
}

export async function rateMeal(
  deps: RateDeps,
  mealId: string,
  rating: "liked" | "disliked",
  messageRef: MessageRef,
): Promise<void> {
  const meal = deps.state.meals.get(mealId);
  if (!meal) throw new AppError("not_found", `Meal state not found: ${mealId}`);
  if (meal.status !== "cooked") return;
  const actionInstant = deps.clock.now();

  try {
    const options = readOptions(meal);
    const selected = options[meal.chosenIndex ?? -1];
    if (!selected) throw new AppError("state", `Chosen recipe is missing for meal ${mealId}.`);
    if (meal.cookedSheetRow === null) {
      throw new AppError("state", `Cooked sheet row is missing for meal ${mealId}.`);
    }

    meal.status = transitionMealState(meal.status, rating === "liked" ? "like" : "dislike");
    meal.rating = rating;
    saveMeal(deps, meal);

    const settings = parseSettings(await deps.sheets.readConfig()).settings;
    const date = actionInstant.toZonedDateTimeISO(settings.timezone).toPlainDate().toString();
    const existing =
      rating === "liked" ? await deps.sheets.readLiked() : await deps.sheets.readBanned();
    if (!existing.some((row) => normalizeName(row.title) === normalizeName(selected.title))) {
      if (rating === "liked") await deps.sheets.appendLiked(selected.title, date);
      else await deps.sheets.appendBanned(selected.title, date);
    }
    await deps.sheets.updateCookedRating(
      meal.cookedSheetRow,
      { weekId: meal.weekId, slot: meal.slot, title: selected.title },
      rating,
    );

    await deps.discord.removeEmoji(messageRef, EMOJIS.liked);
    await deps.discord.removeEmoji(messageRef, EMOJIS.disliked);
    await deps.discord.editMessage(
      messageRef,
      renderMealMessage({
        slot: meal.slot,
        options,
        chosenIndex: meal.chosenIndex ?? 0,
        status: meal.status,
      }),
    );
  } catch (error) {
    await markNeedsAttention(deps, meal, messageRef, error);
    throw error;
  }
}

function readOptions(meal: MealRecord) {
  let raw: unknown;
  try {
    raw = JSON.parse(meal.optionsJson);
  } catch (error) {
    throw new AppError("state", `Saved options are invalid for meal ${meal.id}.`, { cause: error });
  }
  const parsed = optionSchema.array().safeParse(raw);
  if (!parsed.success)
    throw new AppError("state", `Saved options are invalid for meal ${meal.id}.`);
  return parsed.data;
}

async function markNeedsAttention(
  deps: RateDeps,
  meal: MealRecord,
  ref: MessageRef,
  error: unknown,
): Promise<void> {
  meal.status = transitionMealState(meal.status, "needs_attention");
  meal.needsAttention = true;
  saveMeal(deps, meal);
  deps.logger.error({ err: error, mealId: meal.id }, "rating flow failed");

  try {
    const options = readOptions(meal);
    await deps.discord.editMessage(
      ref,
      `${renderMealMessage({
        slot: meal.slot,
        options,
        chosenIndex: meal.chosenIndex ?? 0,
        status: "needs_attention",
      })}\n${funErrorMessage(currentCorrelationId() ?? "unknown")}`,
    );
  } catch (notificationError) {
    deps.logger.error(
      { err: notificationError, mealId: meal.id },
      "failed to render needs-attention meal status",
    );
  }
}

function saveMeal(deps: RateDeps, meal: MealRecord): void {
  meal.updatedAt = deps.clock.now().toString();
  deps.state.meals.upsert(meal);
}
