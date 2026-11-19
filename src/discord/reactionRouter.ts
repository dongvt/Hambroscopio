import type { CalendarClient } from "../clients/calendar/CalendarClient.js";
import type { DiscordGateway, ReactionAddEvent } from "../clients/discord/DiscordGateway.js";
import type { SheetsClient } from "../clients/sheets/SheetsClient.js";
import { parseSettings } from "../config/sheetConfig.js";
import { EMOJIS, optionEmoji } from "../domain/emojis.js";
import { currentCorrelationId, withCorrelation } from "../lib/context.js";
import type { Clock } from "../lib/clock.js";
import type { Logger } from "../lib/logger.js";
import { nextWeekId, todayIn, weekIdOf } from "../lib/time.js";
import type { StateStore } from "../state/repos.js";
import { cookMeal } from "../flows/cook.js";
import { rateMeal } from "../flows/rate.js";
import { reloadMeal } from "../flows/reloadMeal.js";
import { reloadWeek } from "../flows/reloadWeek.js";
import { reserveReload } from "../flows/reloadLimit.js";
import type { PlannerInput } from "../planner/validate.js";
import type { PlannerResult } from "../planner/planner.js";
import { AppError, funErrorMessage } from "../lib/errors.js";
import { optionSchema } from "../planner/schema.js";
import type { MealRecord, WeekRecord } from "../state/repos.js";

export interface ReactionRouterDeps {
  discord: DiscordGateway;
  sheets: SheetsClient;
  planner: Pick<{ plan(input: PlannerInput): Promise<PlannerResult> }, "plan">;
  calendar: CalendarClient;
  state: StateStore;
  clock: Clock;
  logger: Logger;
  allowedUserIds: string[];
  delay?: (milliseconds: number) => Promise<void>;
}

const messageLocks = new Map<string, Promise<void>>();

export function registerReactionRouter(deps: ReactionRouterDeps): void {
  deps.discord.onReactionAdd(async (event) => {
    await withCorrelation(async () => {
      try {
        await handleReactionAdd(deps, event);
      } catch (error) {
        deps.logger.error({ err: error, ...event }, "reaction handler failed");
      }
    });
  });
}

export async function handleReactionAdd(
  deps: ReactionRouterDeps,
  event: ReactionAddEvent,
): Promise<void> {
  return withMessageLock(event.messageId, () => processReactionAdd(deps, event));
}

async function processReactionAdd(
  deps: ReactionRouterDeps,
  event: ReactionAddEvent,
): Promise<void> {
  if (event.userId === deps.discord.botUserId) {
    deps.logger.debug({ ...event }, "ignored bot's own reaction");
    return;
  }

  if (event.emoji === EMOJIS.reload) {
    const introWeek = findWeekByIntro(deps.state, event.messageId);
    if (introWeek) {
      await processIntroReload(deps, event, introWeek);
      return;
    }
  }

  const meal = findMealByMessage(deps.state, event.messageId);
  if (!meal) {
    deps.logger.debug({ ...event }, "reaction does not belong to a saved meal");
    return;
  }
  const day = deps.state.days.list(meal.weekId).find((candidate) => candidate.date === meal.date);
  if (!day?.threadId || day.threadId !== event.channelId) {
    deps.logger.warn({ mealId: meal.id, ...event }, "reaction channel does not match saved meal");
    return;
  }
  const ref = { channelId: event.channelId, messageId: event.messageId };

  if (!deps.allowedUserIds.includes(event.userId)) {
    await deps.discord.removeUserReaction(ref, event.emoji, event.userId);
    deps.logger.info(
      { ...event, accepted: false, reason: "user_not_allowed" },
      "reaction rejected",
    );
    return;
  }

  if (!(await deps.discord.hasUserReaction(ref, event.emoji, deps.discord.botUserId))) {
    await deps.discord.removeUserReaction(ref, event.emoji, event.userId);
    deps.logger.info(
      { ...event, accepted: false, reason: "emoji_not_placed_by_bot" },
      "reaction rejected",
    );
    return;
  }

  const settingsRows = await deps.sheets.readConfig();
  const currentMeal = deps.state.meals.get(meal.id);
  if (!currentMeal) return;
  const settings = parseSettings(settingsRows).settings;
  const today = todayIn(deps.clock, settings.timezone);
  const activeWeek = weekIdOf(today);
  const allowedWeekIds = new Set([activeWeek]);
  const next = nextWeekId(activeWeek);
  if (deps.state.weeks.get(next)?.status === "complete") allowedWeekIds.add(next);
  if (!allowedWeekIds.has(currentMeal.weekId)) {
    await deps.discord.removeUserReaction(ref, event.emoji, event.userId);
    deps.logger.info(
      { ...event, weekId: currentMeal.weekId, accepted: false, reason: "past_or_unplanned_week" },
      "reaction rejected",
    );
    return;
  }

  const options = readOptions(currentMeal);
  if (!isValidForState(currentMeal, options.length, event.emoji)) {
    await deps.discord.removeUserReaction(ref, event.emoji, event.userId);
    deps.logger.info(
      { ...event, status: currentMeal.status, accepted: false, reason: "invalid_emoji_for_state" },
      "reaction rejected",
    );
    return;
  }

  const latest = deps.state.meals.get(currentMeal.id);
  if (!latest || latest.status !== currentMeal.status) {
    await deps.discord.removeUserReaction(ref, event.emoji, event.userId);
    return;
  }

  const delay = deps.delay ?? wait;
  await delay(settings.reactionDebounceSeconds * 1000);
  if (!(await deps.discord.hasUserReaction(ref, event.emoji, event.userId))) {
    deps.logger.info(
      { ...event, accepted: false, reason: "reaction_removed_during_debounce" },
      "reaction ignored",
    );
    return;
  }

  const mealAfterDebounce = deps.state.meals.get(currentMeal.id);
  if (!mealAfterDebounce || mealAfterDebounce.status !== currentMeal.status) {
    await deps.discord.removeUserReaction(ref, event.emoji, event.userId);
    return;
  }

  if (event.emoji === EMOJIS.reload) {
    try {
      reserveReload(deps.state, deps.clock);
      await reloadMeal(
        {
          sheets: deps.sheets,
          planner: deps.planner,
          calendar: deps.calendar,
          discord: deps.discord,
          state: deps.state,
          clock: deps.clock,
          logger: deps.logger,
        },
        mealAfterDebounce.id,
        ref,
      );
      await deps.discord.removeUserReaction(ref, EMOJIS.reload, event.userId);
      deps.logger.info(
        { ...event, mealId: mealAfterDebounce.id, accepted: true, action: "reload_meal" },
        "reaction accepted",
      );
    } catch (error) {
      await notifyReloadError(deps, event, error);
      throw error;
    }
    return;
  }

  const index = cookOptionIndex(mealAfterDebounce, event.emoji);
  if (index !== null) {
    deps.logger.info(
      { ...event, mealId: mealAfterDebounce.id, accepted: true, action: "cook" },
      "reaction accepted",
    );
    await cookMeal(
      {
        sheets: deps.sheets,
        calendar: deps.calendar,
        discord: deps.discord,
        state: deps.state,
        clock: deps.clock,
        logger: deps.logger,
      },
      mealAfterDebounce.id,
      index,
      ref,
    );
    return;
  }
  if (event.emoji === EMOJIS.liked || event.emoji === EMOJIS.disliked) {
    deps.logger.info(
      { ...event, mealId: mealAfterDebounce.id, accepted: true, action: event.emoji },
      "reaction accepted",
    );
    await rateMeal(
      {
        sheets: deps.sheets,
        discord: deps.discord,
        state: deps.state,
        clock: deps.clock,
        logger: deps.logger,
      },
      mealAfterDebounce.id,
      event.emoji === EMOJIS.liked ? "liked" : "disliked",
      ref,
    );
    return;
  }
}

async function processIntroReload(
  deps: ReactionRouterDeps,
  event: ReactionAddEvent,
  week: WeekRecord,
): Promise<void> {
  const ref = { channelId: event.channelId, messageId: event.messageId };
  if (week.channelId !== event.channelId || !week.introMessageId) {
    deps.logger.warn({ ...event, weekId: week.weekId }, "intro reaction channel does not match");
    return;
  }
  if (!deps.allowedUserIds.includes(event.userId)) {
    await deps.discord.removeUserReaction(ref, event.emoji, event.userId);
    deps.logger.info(
      { ...event, accepted: false, reason: "user_not_allowed" },
      "reaction rejected",
    );
    return;
  }
  if (!(await deps.discord.hasUserReaction(ref, EMOJIS.reload, deps.discord.botUserId))) {
    await deps.discord.removeUserReaction(ref, event.emoji, event.userId);
    deps.logger.info(
      { ...event, accepted: false, reason: "emoji_not_placed_by_bot" },
      "reaction rejected",
    );
    return;
  }
  const settings = parseSettings(await deps.sheets.readConfig()).settings;
  if (
    week.weekId !== weekIdOf(todayIn(deps.clock, settings.timezone)) ||
    week.status !== "complete"
  ) {
    await deps.discord.removeUserReaction(ref, event.emoji, event.userId);
    deps.logger.info(
      { ...event, weekId: week.weekId, accepted: false, reason: "not_current_complete_week" },
      "reaction rejected",
    );
    return;
  }
  const delay = deps.delay ?? wait;
  await delay(settings.reactionDebounceSeconds * 1000);
  if (!(await deps.discord.hasUserReaction(ref, EMOJIS.reload, event.userId))) {
    deps.logger.info(
      { ...event, accepted: false, reason: "reaction_removed_during_debounce" },
      "reaction ignored",
    );
    return;
  }

  try {
    const plannedMealIds = deps.state.meals
      .listForWeek(week.weekId)
      .filter((meal) => meal.status === "planned")
      .flatMap((meal) => (meal.discordMessageId ? [meal.discordMessageId] : []));
    const affectedMeals = await withExclusiveMessageLocks(plannedMealIds, async () => {
      reserveReload(deps.state, deps.clock);
      return reloadWeek(
        {
          sheets: deps.sheets,
          planner: deps.planner,
          calendar: deps.calendar,
          discord: deps.discord,
          state: deps.state,
          clock: deps.clock,
          logger: deps.logger,
        },
        week.weekId,
        ref,
      );
    });
    await deps.discord.removeUserReaction(ref, EMOJIS.reload, event.userId);
    deps.logger.info(
      { ...event, weekId: week.weekId, affectedMeals, accepted: true, action: "reload_week" },
      "reaction accepted",
    );
  } catch (error) {
    await notifyReloadError(deps, event, error);
    throw error;
  }
}

async function notifyReloadError(
  deps: ReactionRouterDeps,
  event: ReactionAddEvent,
  error: unknown,
): Promise<void> {
  const content =
    error instanceof AppError && error.message.startsWith("Reload limit reached")
      ? `⚠️ ${error.message}`
      : error instanceof AppError && error.message.startsWith("Week reload is busy")
        ? `⚠️ ${error.message}`
        : funErrorMessage(currentCorrelationId() ?? "unknown");
  try {
    await deps.discord.sendMessage(event.channelId, content);
  } catch (notificationError) {
    deps.logger.error({ err: notificationError, ...event }, "failed to post reload warning");
  }
}

function findMealByMessage(state: StateStore, messageId: string): MealRecord | undefined {
  for (const week of state.weeks.list()) {
    const meal = state.meals
      .listForWeek(week.weekId)
      .find((record) => record.discordMessageId === messageId);
    if (meal) return meal;
  }
  return undefined;
}

function findWeekByIntro(state: StateStore, messageId: string) {
  return state.weeks.list().find((week) => week.introMessageId === messageId);
}

function readOptions(meal: MealRecord) {
  let value: unknown;
  try {
    value = JSON.parse(meal.optionsJson);
  } catch {
    return [];
  }
  const parsed = optionSchema.array().safeParse(value);
  return parsed.success ? parsed.data : [];
}

function isValidForState(meal: MealRecord, optionCount: number, emoji: string): boolean {
  if (meal.status === "planned") {
    if (emoji === EMOJIS.reload) return true;
    return meal.slot === "lunch"
      ? Array.from({ length: optionCount }, (_, index) => optionEmoji(index)).includes(emoji)
      : emoji === EMOJIS.cooked;
  }
  if (meal.status === "cooked") return emoji === EMOJIS.liked || emoji === EMOJIS.disliked;
  return false;
}

function cookOptionIndex(meal: MealRecord, emoji: string): number | null {
  if (meal.status !== "planned") return null;
  if (meal.slot !== "lunch") return emoji === EMOJIS.cooked ? 0 : null;
  const options = readOptions(meal);
  const index = options.findIndex((_, optionIndex) => optionEmoji(optionIndex) === emoji);
  return index >= 0 ? index : null;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function withMessageLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = messageLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  messageLocks.set(key, tail);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (messageLocks.get(key) === tail) messageLocks.delete(key);
  }
}

async function withExclusiveMessageLocks<T>(
  keys: string[],
  operation: () => Promise<T>,
): Promise<T> {
  const uniqueKeys = [...new Set(keys)].sort();
  if (uniqueKeys.some((key) => messageLocks.has(key))) {
    throw new AppError("state", "Week reload is busy; try again.");
  }

  let release!: () => void;
  const lock = new Promise<void>((resolve) => {
    release = resolve;
  });
  for (const key of uniqueKeys) messageLocks.set(key, lock);
  try {
    return await operation();
  } finally {
    release();
    for (const key of uniqueKeys) {
      if (messageLocks.get(key) === lock) messageLocks.delete(key);
    }
  }
}
