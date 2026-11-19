import type { CalendarClient } from "../clients/calendar/CalendarClient.js";
import type { DiscordGateway, MessageRef } from "../clients/discord/DiscordGateway.js";
import type { SheetsClient } from "../clients/sheets/SheetsClient.js";
import { parseSettings } from "../config/sheetConfig.js";
import { EMOJIS, optionEmoji } from "../domain/emojis.js";
import {
  renderMealDescription,
  renderMealMessage,
  renderMealRecipeText,
  renderMealSummary,
} from "../domain/render.js";
import { transitionMealState } from "../domain/mealState.js";
import { AppError } from "../lib/errors.js";
import type { Clock } from "../lib/clock.js";
import type { Logger } from "../lib/logger.js";
import { atLocalTime } from "../lib/time.js";
import { optionSchema } from "../planner/schema.js";
import type { PlannerResult } from "../planner/planner.js";
import type { PlannerInput } from "../planner/validate.js";
import type { MealRecord, StateStore } from "../state/repos.js";
import { buildWeeklyPlannerInput } from "./weeklyPlan.js";

export interface ReloadMealDeps {
  sheets: SheetsClient;
  planner: Pick<{ plan(input: PlannerInput): Promise<PlannerResult> }, "plan">;
  calendar: CalendarClient;
  discord: DiscordGateway;
  state: StateStore;
  clock: Clock;
  logger: Logger;
}

export async function reloadMeal(
  deps: ReloadMealDeps,
  mealId: string,
  messageRef: MessageRef,
): Promise<void> {
  const meal = deps.state.meals.get(mealId);
  if (!meal) throw new AppError("not_found", `Meal state not found: ${mealId}`);
  if (meal.status !== "planned") throw new AppError("state", `Meal ${mealId} is not planned.`);

  const day = deps.state.days.list(meal.weekId).find((candidate) => candidate.date === meal.date);
  if (
    !day?.threadId ||
    day.threadId !== messageRef.channelId ||
    meal.discordMessageId !== messageRef.messageId
  ) {
    throw new AppError(
      "not_found",
      `Saved Discord thread or meal message is missing for ${mealId}.`,
    );
  }
  if (!meal.calendarEventId) {
    throw new AppError("not_found", `Saved Calendar event is missing for ${mealId}.`);
  }
  const message = await deps.discord.fetchMessage(messageRef);
  if (!message) throw new AppError("not_found", `Discord meal message is missing for ${mealId}.`);
  const calendarEvent = await deps.calendar.getEvent(meal.calendarEventId);
  if (!calendarEvent) throw new AppError("not_found", `Calendar event is missing for ${mealId}.`);

  const parsedSettings = parseSettings(await deps.sheets.readConfig());
  for (const warning of parsedSettings.warnings) {
    deps.logger.warn({ warning }, "invalid sheet configuration");
  }
  const { settings } = parsedSettings;
  ensureReloadableDate(deps.clock, settings.timezone, settings.times[meal.slot], meal);

  const oldOptions = parseOptions(meal);
  const existingWeekTitles = deps.state.meals
    .listForWeek(meal.weekId)
    .filter((other) => other.id !== meal.id)
    .flatMap((other) => parseOptions(other).map((option) => option.title));
  const input = await buildWeeklyPlannerInput(
    deps.sheets,
    settings,
    meal.weekId,
    [{ date: meal.date, slot: meal.slot, options: settings.options[meal.slot] }],
    deps.logger,
    { reserveLunchFirstOption: false, existingWeekTitles },
  );
  const result = await deps.planner.plan(input);
  const planned = result.meals.find(
    (candidate) => candidate.date === meal.date && candidate.slot === meal.slot,
  );
  if (!planned || planned.options.length !== settings.options[meal.slot]) {
    throw new AppError("validation", `Planner returned no complete replacement for ${mealId}.`);
  }

  await applyReplacement(deps, meal, messageRef, planned.options, settings, oldOptions.length);
}

export function ensureReloadableDate(
  clock: Clock,
  timeZone: string,
  time: Temporal.PlainTime,
  meal: Pick<MealRecord, "date" | "slot">,
): void {
  const start = atLocalTime(Temporal.PlainDate.from(meal.date), time, timeZone).toInstant();
  if (Temporal.Instant.compare(start, clock.now()) <= 0) {
    throw new AppError(
      "validation",
      `Cannot reload ${meal.date} ${meal.slot}: its scheduled time has passed.`,
    );
  }
}

export async function applyReplacement(
  deps: ReloadMealDeps,
  meal: MealRecord,
  ref: MessageRef,
  options: PlannerResult["meals"][number]["options"],
  settings: ReturnType<typeof parseSettings>["settings"],
  previousOptionCount: number,
): Promise<void> {
  const names = options.map((option) => option.title);
  const title = meal.slot === "lunch" ? "Lunch" : (names[0] ?? meal.slot);
  if (!meal.calendarEventId) {
    throw new AppError(
      "not_found",
      `Saved Discord or Calendar artifact is missing for ${meal.id}.`,
    );
  }

  try {
    await deps.calendar.patchEvent(meal.calendarEventId, {
      summary: renderMealSummary({ title, options: names, statusLine: "Planned" }),
      description: renderMealDescription({
        title,
        options: names,
        statusLine: "Planned",
        recipeText: renderMealRecipeText(options),
      }),
    });
    await deps.discord.editMessage(
      ref,
      renderMealMessage({ slot: meal.slot, options, status: "planned" }),
    );

    for (let index = 0; index < previousOptionCount; index += 1) {
      const emoji = optionEmoji(index);
      if (emoji) await deps.discord.removeEmoji(ref, emoji);
    }
    if (meal.slot !== "lunch") await deps.discord.removeEmoji(ref, EMOJIS.cooked);
    await deps.discord.addReactions(ref, [
      ...(meal.slot === "lunch"
        ? Array.from({ length: options.length }, (_, index) => optionEmoji(index)).filter(
            (emoji): emoji is string => emoji !== undefined,
          )
        : [EMOJIS.cooked]),
      EMOJIS.reload,
    ]);

    meal.optionsJson = JSON.stringify(options);
    meal.chosenIndex = null;
    meal.rating = null;
    meal.needsAttention = false;
    meal.updatedAt = deps.clock.now().toString();
    deps.state.meals.upsert(meal);
  } catch (error) {
    meal.status = transitionMealState(meal.status, "needs_attention");
    meal.needsAttention = true;
    meal.updatedAt = deps.clock.now().toString();
    try {
      deps.state.meals.upsert(meal);
    } catch (stateError) {
      deps.logger.error(
        { err: stateError, mealId: meal.id },
        "failed to save reload failure state",
      );
    }
    deps.logger.error({ err: error, mealId: meal.id }, "meal reload update failed");
    try {
      await deps.discord.editMessage(
        ref,
        renderMealMessage({
          slot: meal.slot,
          options,
          chosenIndex: meal.chosenIndex ?? 0,
          status: "needs_attention",
        }),
      );
    } catch (notificationError) {
      deps.logger.error(
        { err: notificationError, mealId: meal.id },
        "failed to render needs-attention meal status",
      );
    }
    throw error;
  }
}

function parseOptions(meal: MealRecord) {
  let value: unknown;
  try {
    value = JSON.parse(meal.optionsJson);
  } catch (error) {
    throw new AppError("state", `Saved options are invalid for meal ${meal.id}.`, { cause: error });
  }
  const parsed = optionSchema.array().safeParse(value);
  if (!parsed.success)
    throw new AppError("state", `Saved options are invalid for meal ${meal.id}.`);
  return parsed.data;
}
