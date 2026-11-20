import { Cron } from "croner";
import type { DiscordGateway } from "../clients/discord/DiscordGateway.js";
import type { SheetsClient } from "../clients/sheets/SheetsClient.js";
import { parseSettings, type AppSettings } from "../config/sheetConfig.js";
import type { Clock } from "../lib/clock.js";
import { withCorrelation } from "../lib/context.js";
import type { Logger } from "../lib/logger.js";
import { atLocalTime, nextWeekId, weekDates, weekIdOf, type WeekId } from "../lib/time.js";
import type { StateStore } from "../state/repos.js";
import type { WeeklyPlanResult } from "../flows/weeklyPlan.js";

export interface SchedulerDeps {
  sheets: SheetsClient;
  discord: DiscordGateway;
  state: StateStore;
  clock: Clock;
  logger: Logger;
  channelId: string;
  runWeeklyPlan: () => Promise<WeeklyPlanResult>;
}

export interface Scheduler {
  start(): Promise<void>;
  stop(): void;
  tick(): Promise<WeeklyPlanResult | "not_due" | "interrupted" | "skipped">;
}

const runningWeeks = new Set<WeekId>();

export function createScheduler(deps: SchedulerDeps): Scheduler {
  let cron: Cron | undefined;

  return {
    async start(): Promise<void> {
      const configRows = await deps.sheets.readConfig();
      const { settings, warnings } = parseSettings(configRows);
      for (const warning of warnings) deps.logger.warn({ warning }, "invalid sheet configuration");

      if (settings.catchUp) await tickScheduler(deps);

      cron = new Cron(
        "*/15 * * * *",
        {
          timezone: settings.timezone,
          protect: true,
        },
        async () => {
          await withCorrelation(async () => {
            await tickScheduler(deps);
          });
        },
      );
    },

    stop(): void {
      cron?.stop();
      cron = undefined;
    },

    tick(): Promise<WeeklyPlanResult | "not_due" | "interrupted" | "skipped"> {
      return tickScheduler(deps);
    },
  };
}

export async function tickScheduler(
  deps: SchedulerDeps,
): Promise<WeeklyPlanResult | "not_due" | "interrupted" | "skipped"> {
  const configRows = await deps.sheets.readConfig();
  const { settings, warnings } = parseSettings(configRows);
  for (const warning of warnings) deps.logger.warn({ warning }, "invalid sheet configuration");

  const localToday = deps.clock.now().toZonedDateTimeISO(settings.timezone).toPlainDate();
  const upcomingWeek = nextWeekId(weekIdOf(localToday));

  const interrupted = deps.state.weeks
    .list()
    .filter((week) => week.status === "planning" || week.status === "posting");
  for (const week of interrupted) {
    await warnInterrupted(deps, week.weekId, week.status);
  }
  const upcoming = deps.state.weeks.get(upcomingWeek);
  if (upcoming?.status === "planning" || upcoming?.status === "posting") {
    deps.logger.warn(
      { weekId: upcomingWeek, status: upcoming.status },
      "scheduled week is interrupted",
    );
    return "interrupted";
  }
  if (upcoming?.status === "complete") return "skipped";

  if (!isSchedulerDue(deps.clock, settings)) {
    deps.logger.debug(
      { upcomingWeek, planDay: settings.planDay, planTime: settings.planTime.toString() },
      "scheduled weekly plan is not due",
    );
    return "not_due";
  }
  if (runningWeeks.has(upcomingWeek)) {
    deps.logger.warn({ weekId: upcomingWeek }, "scheduled weekly plan is already running");
    return "interrupted";
  }

  runningWeeks.add(upcomingWeek);
  try {
    deps.logger.info({ weekId: upcomingWeek }, "scheduled weekly plan started");
    return await deps.runWeeklyPlan();
  } catch (error) {
    deps.logger.error({ err: error, weekId: upcomingWeek }, "scheduled weekly plan failed");
    throw error;
  } finally {
    runningWeeks.delete(upcomingWeek);
  }
}

export function isSchedulerDue(clock: Clock, settings: AppSettings): boolean {
  const localToday = clock.now().toZonedDateTimeISO(settings.timezone).toPlainDate();
  const currentWeek = weekIdOf(localToday);
  const planDate = weekDates(currentWeek)[settings.planDay - 1];
  if (!planDate) return false;
  const scheduled = atLocalTime(planDate, settings.planTime, settings.timezone).toInstant();
  return Temporal.Instant.compare(clock.now(), scheduled) >= 0;
}

async function warnInterrupted(deps: SchedulerDeps, weekId: WeekId, status: string): Promise<void> {
  const key = `scheduler:interrupted:${weekId}:${status}`;
  if (deps.state.kv.get(key)) return;

  deps.logger.warn({ weekId, status }, "interrupted weekly plan detected; waiting for /plan");
  try {
    await deps.discord.sendMessage(
      deps.channelId,
      `⚠️ The scheduled plan for ${weekId} is interrupted (${status}). Waiting for /plan.`,
    );
    deps.state.kv.set(key, deps.clock.now().toString());
  } catch (error) {
    deps.logger.error({ err: error, weekId, status }, "failed to post interrupted-week warning");
  }
}
