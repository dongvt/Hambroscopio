import type { CalendarClient } from "../clients/calendar/CalendarClient.js";
import type { DiscordGateway, MessageRef } from "../clients/discord/DiscordGateway.js";
import type { SheetsClient } from "../clients/sheets/SheetsClient.js";
import { parseSettings } from "../config/sheetConfig.js";
import { EMOJIS, optionEmoji } from "../domain/emojis.js";
import { transitionMealState } from "../domain/mealState.js";
import {
  renderMealMessage,
  renderMealSummary,
  renderTrimmedDescription,
} from "../domain/render.js";
import type { Clock } from "../lib/clock.js";
import { currentCorrelationId } from "../lib/context.js";
import { AppError, funErrorMessage } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";
import { optionSchema } from "../planner/schema.js";
import type { MealRecord, StateStore } from "../state/repos.js";
import { deductIngredients } from "./deduct.js";

export interface CookDeps {
  sheets: SheetsClient;
  calendar: CalendarClient;
  discord: DiscordGateway;
  state: StateStore;
  clock: Clock;
  logger: Logger;
}

export async function cookMeal(
  deps: CookDeps,
  mealId: string,
  chosenIndex: number,
  messageRef: MessageRef,
): Promise<void> {
  const meal = deps.state.meals.get(mealId);
  if (!meal) throw new AppError("not_found", `Meal state not found: ${mealId}`);
  if (meal.status !== "planned") return;
  const actionInstant = deps.clock.now();

  try {
    const options = readOptions(meal);
    const selected = options[chosenIndex];
    if (!selected) {
      throw new AppError(
        "validation",
        `Option ${chosenIndex + 1} does not exist for meal ${mealId}.`,
      );
    }
    if (!meal.calendarEventId) {
      throw new AppError("state", `Calendar event is missing for meal ${mealId}.`);
    }
    if (!meal.discordMessageId) {
      throw new AppError("state", `Discord message is missing for meal ${mealId}.`);
    }

    await deps.discord.editMessage(
      messageRef,
      renderMealMessage({ slot: meal.slot, options, chosenIndex, status: "updating" }),
    );
    meal.status = transitionMealState(meal.status, "cook");
    meal.chosenIndex = chosenIndex;
    saveMeal(deps, meal);

    const settings = parseSettings(await deps.sheets.readConfig()).settings;
    const cookedDate = actionInstant.toZonedDateTimeISO(settings.timezone).toPlainDate().toString();
    const deduction = await deductIngredients(deps.sheets, selected, deps.logger);
    const appended = await deps.sheets.appendCooked({
      date: cookedDate,
      weekId: meal.weekId,
      slot: meal.slot,
      title: selected.title,
      inventoryChanges: deduction.inventoryChanges,
    });
    meal.cookedSheetRow = appended.rowNumber;
    saveMeal(deps, meal);

    await deps.calendar.patchEvent(meal.calendarEventId, {
      summary: renderMealSummary({
        title: selected.title,
        options: options.map((option) => option.title),
        selectedIndex: chosenIndex,
        statusLine: "Cooked",
      }),
      description: renderTrimmedDescription({
        title: selected.title,
        options: options.map((option) => option.title),
        selectedIndex: chosenIndex,
        statusLine: "Cooked",
        recipeText: [
          `Servings: ${selected.servings}`,
          `Time: ${selected.time_minutes} minutes`,
          `Ingredients:\n${selected.ingredients_used.map((ingredient) => `- ${ingredient.name}: ${ingredient.quantity} ${ingredient.unit}`).join("\n")}`,
          `Steps:\n${selected.steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}`,
          ...(selected.notes.length
            ? [`Notes:\n${selected.notes.map((note) => `- ${note}`).join("\n")}`]
            : []),
        ].join("\n"),
      }),
    });

    for (const emoji of plannedEmojis(meal, options.length)) {
      await deps.discord.removeEmoji(messageRef, emoji);
    }
    await deps.discord.addReactions(messageRef, [EMOJIS.liked, EMOJIS.disliked]);
    const suffix = deduction.warnings.length ? `\n⚠️ ${deduction.warnings.join("\n⚠️ ")}` : "";
    await deps.discord.editMessage(
      messageRef,
      `${renderMealMessage({ slot: meal.slot, options, chosenIndex, status: "cooked" })}${suffix}`,
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

function plannedEmojis(meal: MealRecord, optionCount: number): string[] {
  if (meal.slot !== "lunch") return [EMOJIS.cooked, EMOJIS.reload];
  return [
    ...Array.from({ length: optionCount }, (_, index) => optionEmoji(index)).filter(
      (emoji): emoji is string => emoji !== undefined,
    ),
    EMOJIS.reload,
  ];
}

async function markNeedsAttention(
  deps: CookDeps,
  meal: MealRecord,
  ref: MessageRef,
  error: unknown,
): Promise<void> {
  meal.status = transitionMealState(meal.status, "needs_attention");
  meal.needsAttention = true;
  saveMeal(deps, meal);
  deps.logger.error({ err: error, mealId: meal.id }, "cook flow failed");

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

function saveMeal(deps: CookDeps, meal: MealRecord): void {
  meal.updatedAt = deps.clock.now().toString();
  deps.state.meals.upsert(meal);
}
