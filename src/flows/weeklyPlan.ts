import type { CalendarClient, MealEventInput } from "../clients/calendar/CalendarClient.js";
import type { DiscordGateway, MessageRef } from "../clients/discord/DiscordGateway.js";
import type { SheetsClient } from "../clients/sheets/SheetsClient.js";
import type { AppSettings } from "../config/sheetConfig.js";
import { parseSettings } from "../config/sheetConfig.js";
import { optionSchema, type MealOption } from "../planner/schema.js";
import type { PlannerResult } from "../planner/planner.js";
import type { PlannerInput } from "../planner/validate.js";
import type { Logger } from "../lib/logger.js";
import type { Clock } from "../lib/clock.js";
import { currentCorrelationId } from "../lib/context.js";
import { AppError, funErrorMessage } from "../lib/errors.js";
import { atLocalTime, nextWeekId, threadName, weekDates, weekIdOf } from "../lib/time.js";
import type { WeekId } from "../lib/time.js";
import type { Slot } from "../domain/types.js";
import { EMOJIS, optionEmoji } from "../domain/emojis.js";
import { renderMealDescription, renderMealMessage, renderMealSummary } from "../domain/render.js";
import type { MealRecord, StateStore, WeekRecord } from "../state/repos.js";

export interface WeeklyPlanDeps {
  sheets: SheetsClient;
  planner: Pick<{ plan(input: PlannerInput): Promise<PlannerResult> }, "plan">;
  calendar: CalendarClient;
  discord: DiscordGateway;
  state: StateStore;
  clock: Clock;
  logger: Logger;
  channelId: string;
  appEnv: "dev" | "prod";
}

export interface WeeklyPlanOptions {
  weekId?: string;
}

export interface WeeklyPlanResult {
  weekId: WeekId;
  status: "complete" | "skipped";
}

const SLOT_ORDER: Slot[] = ["breakfast", "lunch", "dinner"];

export async function runWeeklyPlan(
  deps: WeeklyPlanDeps,
  options: WeeklyPlanOptions = {},
): Promise<WeeklyPlanResult> {
  let weekId: WeekId | undefined;
  try {
    const configRows = await deps.sheets.readConfig();
    const { settings, warnings } = parseSettings(configRows);
    for (const warning of warnings) deps.logger.warn({ warning }, "invalid sheet configuration");

    const defaultWeek = nextWeekId(
      weekIdOf(deps.clock.now().toZonedDateTimeISO(settings.timezone).toPlainDate()),
    );
    if (options.weekId && deps.appEnv !== "dev") {
      throw new AppError("validation", "A week override is only available in dev.");
    }
    const targetWeekId = options.weekId ?? defaultWeek;
    assertMondayWeekId(targetWeekId);
    weekId = targetWeekId;

    const existing = deps.state.weeks.get(targetWeekId);
    if (existing?.status === "complete") return { weekId: targetWeekId, status: "skipped" };
    if (existing && existing.status !== "planning" && existing.status !== "posting") {
      throw new AppError(
        "state",
        `Week ${targetWeekId} has unsupported status "${existing.status}".`,
      );
    }

    const days = weekDates(targetWeekId);
    const expectedMeals = days.flatMap((date) =>
      SLOT_ORDER.map((slot) => ({
        date: date.toString(),
        slot,
        options: settings.options[slot],
      })),
    );
    if (
      settings.options.breakfast !== 1 ||
      settings.options.dinner !== 1 ||
      settings.options.lunch > 3
    ) {
      throw new AppError(
        "config",
        "Breakfast and dinner must each have one option, and lunch cannot exceed three options.",
      );
    }

    let meals = deps.state.meals.listForWeek(targetWeekId);
    const plannedKeys = new Set(meals.map(mealKey));
    const expectedKeys = new Set(
      expectedMeals.map((meal) => `${targetWeekId}:${meal.date}:${meal.slot}`),
    );
    if ([...plannedKeys].some((key) => !expectedKeys.has(key))) {
      throw new AppError(
        "state",
        `Saved meal state contains unexpected meals for week ${targetWeekId}.`,
      );
    }
    const hasCompleteSavedPlan =
      meals.length === expectedMeals.length &&
      [...expectedKeys].every((key) => plannedKeys.has(key));

    if (existing?.status === "posting" && !hasCompleteSavedPlan) {
      throw new AppError("state", `Posting week ${targetWeekId} has incomplete saved meal state.`);
    }

    if (!hasCompleteSavedPlan) {
      saveWeek(deps, existing, targetWeekId, "planning");
      const planned = await createPlan(deps, settings, targetWeekId, expectedMeals);
      assertPlanComplete(planned, expectedMeals);
      const now = deps.clock.now().toString();
      meals = planned.meals.map((meal) => ({
        id: `${targetWeekId}:${meal.date}:${meal.slot}`,
        weekId: targetWeekId,
        date: meal.date,
        slot: meal.slot,
        status: "planned",
        rating: null,
        optionsJson: JSON.stringify(meal.options),
        chosenIndex: null,
        discordMessageId: null,
        calendarEventId: null,
        cookedSheetRow: null,
        needsAttention: false,
        updatedAt: now,
      }));
      for (const meal of meals) deps.state.meals.upsert(meal);
    }

    saveWeek(deps, deps.state.weeks.get(targetWeekId), targetWeekId, "posting");
    const intro = await ensureIntro(deps, targetWeekId);
    await deps.discord.addReactions(intro.ref, [EMOJIS.reload]);

    for (const date of days) {
      const dateString = date.toString();
      const name = threadName(date);
      const day = deps.state.days
        .list(targetWeekId)
        .find((candidate) => candidate.date === dateString);
      let threadId = day?.threadId;
      if (!threadId) {
        const found = await deps.discord.findThreadByName(deps.channelId, name);
        threadId = found ?? (await deps.discord.createThread(deps.channelId, name)).threadId;
        deps.state.days.upsert({ weekId: targetWeekId, date: dateString, threadId });
      }

      for (const meal of meals.filter((candidate) => candidate.date === dateString)) {
        const current = deps.state.meals.get(meal.id) ?? meal;
        const optionsForMeal = readOptions(current);
        const content = renderMealMessage({
          slot: current.slot,
          options: optionsForMeal,
          status: "planned",
        });
        const ref =
          (current.discordMessageId
            ? { channelId: threadId, messageId: current.discordMessageId }
            : await deps.discord.findMessageByContent(threadId, content)) ??
          (await deps.discord.sendMessage(threadId, content));
        if (!current.discordMessageId) {
          current.discordMessageId = ref.messageId;
          current.updatedAt = deps.clock.now().toString();
          deps.state.meals.upsert(current);
        }
        await deps.discord.addReactions(ref, mealReactions(current.slot, optionsForMeal.length));

        if (!current.calendarEventId) {
          const key = mealKey(current);
          const existingEvent = await deps.calendar.findByMealKey(key);
          const eventId =
            existingEvent?.id ??
            (await deps.calendar.createEvent(calendarEvent(current, optionsForMeal, settings)))
              .eventId;
          current.calendarEventId = eventId;
          current.updatedAt = deps.clock.now().toString();
          deps.state.meals.upsert(current);
        }
      }
    }

    saveWeek(deps, deps.state.weeks.get(targetWeekId), targetWeekId, "complete");
    deps.logger.info({ weekId: targetWeekId, mealCount: meals.length }, "weekly plan completed");
    return { weekId: targetWeekId, status: "complete" };
  } catch (error) {
    deps.logger.error({ err: error, weekId }, "weekly plan failed");
    try {
      await deps.discord.sendMessage(
        deps.channelId,
        funErrorMessage(currentCorrelationId() ?? "unknown"),
      );
    } catch (notificationError) {
      deps.logger.error({ err: notificationError, weekId }, "failed to post weekly plan warning");
    }
    throw error;
  }
}

async function createPlan(
  deps: WeeklyPlanDeps,
  settings: AppSettings,
  weekId: WeekId,
  meals: PlannerInput["meals"],
): Promise<PlannerResult> {
  const [inventoryRows, bannedRows, likedRows, cookedRows] = await Promise.all([
    deps.sheets.readInventory(),
    deps.sheets.readBanned(),
    deps.sheets.readLiked(),
    deps.sheets.readCooked(),
  ]);
  const inventory = inventoryRows.flatMap((row) => {
    if (row.quantity === null) {
      deps.logger.warn(
        { rowNumber: row.rowNumber, name: row.name },
        "invalid inventory quantity ignored",
      );
      return [];
    }
    return [{ name: row.name, unit: row.unit, quantity: row.quantity }];
  });
  const weekStart = Temporal.PlainDate.from(weekId);
  const recentlyCookedStart = weekStart.subtract({ weeks: settings.noRepeatWeeks }).toString();
  const recentlyCooked = cookedRows
    .filter((row) => row.date >= recentlyCookedStart && row.date < weekId)
    .map((row) => row.title);

  return deps.planner.plan({
    settings,
    inventory,
    banned: bannedRows.map((row) => row.title),
    liked: likedRows.map((row) => row.title),
    recentlyCooked,
    existingWeekTitles: [],
    meals,
    reserveLunchFirstOption: true,
  });
}

function assertPlanComplete(result: PlannerResult, expected: PlannerInput["meals"]): void {
  const actual = new Set(result.meals.map((meal) => `${meal.date}:${meal.slot}`));
  const expectedKeys = new Set(expected.map((meal) => `${meal.date}:${meal.slot}`));
  if (
    actual.size !== result.meals.length ||
    actual.size !== expectedKeys.size ||
    [...expectedKeys].some((key) => !actual.has(key))
  ) {
    throw new AppError(
      "validation",
      "Planner returned an incomplete or duplicate weekly meal plan.",
    );
  }

  for (const meal of result.meals) {
    const expectedMeal = expected.find(
      (item) => item.date === meal.date && item.slot === meal.slot,
    );
    if (!expectedMeal || meal.options.length !== expectedMeal.options) {
      throw new AppError(
        "validation",
        `Planner returned ${meal.options.length} options for ${meal.date} ${meal.slot}; expected ${expectedMeal?.options ?? 0}.`,
      );
    }
  }
}

async function ensureIntro(deps: WeeklyPlanDeps, weekId: WeekId): Promise<{ ref: MessageRef }> {
  const week = deps.state.weeks.get(weekId);
  if (week?.introMessageId) {
    return {
      ref: { channelId: week.channelId ?? deps.channelId, messageId: week.introMessageId },
    };
  }
  const content = `Hey, these are the suggested meals for the week of ${weekId}.`;
  const ref =
    (await deps.discord.findMessageByContent(deps.channelId, content)) ??
    (await deps.discord.sendMessage(deps.channelId, content));
  saveWeek(deps, week, weekId, "posting", ref.messageId);
  return { ref };
}

function saveWeek(
  deps: WeeklyPlanDeps,
  week: WeekRecord | undefined,
  weekId: WeekId,
  status: string,
  introMessageId = week?.introMessageId ?? null,
): void {
  const now = deps.clock.now().toString();
  deps.state.weeks.upsert({
    weekId,
    status,
    channelId: week?.channelId ?? deps.channelId,
    introMessageId,
    createdAt: week?.createdAt ?? now,
    updatedAt: now,
  });
}

function mealKey(meal: Pick<MealRecord, "weekId" | "date" | "slot">): string {
  return `${meal.weekId}:${meal.date}:${meal.slot}`;
}

function readOptions(meal: MealRecord): MealOption[] {
  let options: unknown;
  try {
    options = JSON.parse(meal.optionsJson);
  } catch (error) {
    throw new AppError("state", `Saved options are invalid for meal ${meal.id}.`, { cause: error });
  }
  const parsed = optionSchema.array().safeParse(options);
  if (!parsed.success) {
    throw new AppError("state", `Saved options are invalid for meal ${meal.id}.`);
  }
  return parsed.data;
}

function mealReactions(slot: Slot, optionCount: number): string[] {
  if (slot !== "lunch") return [EMOJIS.cooked, EMOJIS.reload];
  return [
    ...Array.from({ length: optionCount }, (_, index) => optionEmoji(index)).filter(
      (emoji): emoji is string => emoji !== undefined,
    ),
    EMOJIS.reload,
  ];
}

function calendarEvent(
  meal: MealRecord,
  options: MealOption[],
  settings: AppSettings,
): MealEventInput {
  const date = Temporal.PlainDate.from(meal.date);
  const start = atLocalTime(date, settings.times[meal.slot], settings.timezone).toPlainDateTime();
  const end = start.add({ minutes: settings.minutes[meal.slot] });
  const names = options.map((option) => option.title);
  const title = meal.slot === "lunch" ? "Lunch" : (names[0] ?? meal.slot);
  const recipeText = options
    .map((option, index) => {
      const ingredients = option.ingredients_used
        .map((ingredient) => `- ${ingredient.name}: ${ingredient.quantity} ${ingredient.unit}`)
        .join("\n");
      const steps = option.steps.map((step, stepIndex) => `${stepIndex + 1}. ${step}`).join("\n");
      const notes = option.notes.length
        ? `\nNotes:\n${option.notes.map((note) => `- ${note}`).join("\n")}`
        : "";
      return [
        `Option ${index + 1}: ${option.title}`,
        `Servings: ${option.servings}`,
        `Time: ${option.time_minutes} minutes`,
        `Ingredients:\n${ingredients}`,
        `Steps:\n${steps}${notes}`,
      ].join("\n");
    })
    .join("\n\n");
  return {
    mealKey: mealKey(meal),
    summary: renderMealSummary({ title, options: names, statusLine: "Planned" }),
    description: renderMealDescription({
      title,
      options: names,
      statusLine: "Planned",
      recipeText,
    }),
    start: start.toString({ smallestUnit: "second" }),
    end: end.toString({ smallestUnit: "second" }),
    timeZone: settings.timezone,
  };
}

function assertMondayWeekId(value: string): asserts value is WeekId {
  let date: Temporal.PlainDate;
  try {
    date = Temporal.PlainDate.from(value);
  } catch (error) {
    throw new AppError(
      "validation",
      `Invalid week date "${value}"; expected a Monday YYYY-MM-DD.`,
      {
        cause: error,
      },
    );
  }
  if (date.toString() !== value || date.dayOfWeek !== 1) {
    throw new AppError("validation", `Invalid week date "${value}"; expected a Monday YYYY-MM-DD.`);
  }
}
