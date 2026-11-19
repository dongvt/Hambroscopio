import type { CalendarClient } from "../clients/calendar/CalendarClient.js";
import type { DiscordGateway, MessageRef } from "../clients/discord/DiscordGateway.js";
import type { SheetsClient } from "../clients/sheets/SheetsClient.js";
import { parseSettings } from "../config/sheetConfig.js";
import { optionSchema } from "../planner/schema.js";
import type { PlannerResult } from "../planner/planner.js";
import type { PlannerInput } from "../planner/validate.js";
import { AppError } from "../lib/errors.js";
import type { Clock } from "../lib/clock.js";
import type { Logger } from "../lib/logger.js";
import { atLocalTime, weekDates, weekIdOf, type WeekId } from "../lib/time.js";
import type { MealRecord, StateStore } from "../state/repos.js";
import { applyReplacement } from "./reloadMeal.js";
import { buildWeeklyPlannerInput } from "./weeklyPlan.js";

export interface ReloadWeekDeps {
  sheets: SheetsClient;
  planner: Pick<{ plan(input: PlannerInput): Promise<PlannerResult> }, "plan">;
  calendar: CalendarClient;
  discord: DiscordGateway;
  state: StateStore;
  clock: Clock;
  logger: Logger;
}

export async function reloadWeek(
  deps: ReloadWeekDeps,
  weekId: WeekId,
  introRef: MessageRef,
): Promise<number> {
  const week = deps.state.weeks.get(weekId);
  if (
    !week ||
    week.status !== "complete" ||
    week.introMessageId !== introRef.messageId ||
    week.channelId !== introRef.channelId
  ) {
    throw new AppError("not_found", `Saved intro message is missing for week ${weekId}.`);
  }
  if (!(await deps.discord.fetchMessage(introRef))) {
    throw new AppError("not_found", `Discord intro message is missing for week ${weekId}.`);
  }

  const parsedSettings = parseSettings(await deps.sheets.readConfig());
  for (const warning of parsedSettings.warnings) {
    deps.logger.warn({ warning }, "invalid sheet configuration");
  }
  const { settings } = parsedSettings;
  const localToday = deps.clock.now().toZonedDateTimeISO(settings.timezone).toPlainDate();
  if (weekIdOf(localToday) !== weekId) {
    throw new AppError("validation", `Only the current week can be reloaded from its intro.`);
  }

  const allMeals = deps.state.meals.listForWeek(weekId);
  const selected = selectReloadableMeals(
    allMeals,
    weekId,
    deps.clock.now(),
    settings.timezone,
    settings.times,
  );
  if (selected.length === 0) return 0;

  const selectedIds = new Set(selected.map((meal) => meal.id));
  const otherTitles = allMeals
    .filter((meal) => !selectedIds.has(meal.id))
    .flatMap((meal) => parseOptions(meal).map((option) => option.title));

  const artifacts = await Promise.all(
    selected.map(async (meal) => {
      const threadId = deps.state.days.list(weekId).find((day) => day.date === meal.date)?.threadId;
      if (!threadId || !meal.discordMessageId || !meal.calendarEventId) {
        throw new AppError(
          "not_found",
          `Saved Discord thread, meal message, or Calendar event is missing for ${meal.id}.`,
        );
      }
      const ref = { channelId: threadId, messageId: meal.discordMessageId };
      const [message, event] = await Promise.all([
        deps.discord.fetchMessage(ref),
        deps.calendar.getEvent(meal.calendarEventId),
      ]);
      if (!message)
        throw new AppError("not_found", `Discord meal message is missing for ${meal.id}.`);
      if (!event) throw new AppError("not_found", `Calendar event is missing for ${meal.id}.`);
      return { meal, ref };
    }),
  );

  const input = await buildWeeklyPlannerInput(
    deps.sheets,
    settings,
    weekId,
    selected.map((meal) => ({
      date: meal.date,
      slot: meal.slot,
      options: settings.options[meal.slot],
    })),
    deps.logger,
    { existingWeekTitles: otherTitles },
  );
  const result = await deps.planner.plan(input);
  assertComplete(result, selected, settings.options);

  const outputByKey = new Map(
    result.meals.map((meal) => [`${meal.date}:${meal.slot}`, meal.options]),
  );
  for (const { meal, ref } of artifacts) {
    const options = outputByKey.get(`${meal.date}:${meal.slot}`);
    if (!options) throw new AppError("state", `Planner omitted ${meal.date} ${meal.slot}.`);
    await applyReplacement(deps, meal, ref, options, settings, parseOptions(meal).length);
  }
  return selected.length;
}

function assertComplete(
  result: PlannerResult,
  meals: MealRecord[],
  optionCounts: ReturnType<typeof parseSettings>["settings"]["options"],
): void {
  const expected = new Set(meals.map((meal) => `${meal.date}:${meal.slot}`));
  const actual = new Set(result.meals.map((meal) => `${meal.date}:${meal.slot}`));
  if (
    actual.size !== result.meals.length ||
    actual.size !== expected.size ||
    [...expected].some((key) => !actual.has(key))
  ) {
    throw new AppError("validation", "Planner returned an incomplete week reload.");
  }
  for (const meal of result.meals) {
    if (meal.options.length !== optionCounts[meal.slot]) {
      throw new AppError(
        "validation",
        `Planner returned ${meal.options.length} options for ${meal.date} ${meal.slot}.`,
      );
    }
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

export function selectReloadableMeals(
  meals: MealRecord[],
  weekId: WeekId,
  now: Temporal.Instant,
  timeZone: string,
  times: ReturnType<typeof parseSettings>["settings"]["times"],
): MealRecord[] {
  const dates = new Set(weekDates(weekId).map((date) => date.toString()));
  return meals.filter((meal) => {
    if (meal.status !== "planned" || !dates.has(meal.date)) return false;
    const start = atLocalTime(
      Temporal.PlainDate.from(meal.date),
      times[meal.slot],
      timeZone,
    ).toInstant();
    return Temporal.Instant.compare(start, now) > 0;
  });
}
