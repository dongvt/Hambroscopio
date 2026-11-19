import { GoogleCalendarClient } from "./clients/calendar/GoogleCalendarClient.js";
import { FakeCalendarClient } from "./clients/calendar/FakeCalendarClient.js";
import { DiscordJsGateway } from "./clients/discord/DiscordJsGateway.js";
import { AnthropicLlmClient } from "./clients/llm/AnthropicLlmClient.js";
import { GoogleSheetsClient } from "./clients/sheets/GoogleSheetsClient.js";
import { DryRunSheetsClient } from "./clients/sheets/DryRunSheetsClient.js";
import { loadDotEnv, loadEnv } from "./config/env.js";
import { registerPlanCommand } from "./discord/commands/plan.js";
import { registerReactionRouter } from "./discord/reactionRouter.js";
import { Planner } from "./planner/planner.js";
import { openDb } from "./state/db.js";
import { createStateStore } from "./state/repos.js";
import { systemClock } from "./lib/clock.js";
import { withCorrelation } from "./lib/context.js";
import { AppError } from "./lib/errors.js";
import { createLogger } from "./lib/logger.js";

async function main(): Promise<void> {
  loadDotEnv();

  let env;
  try {
    env = loadEnv();
  } catch (error) {
    if (error instanceof AppError && error.code === "config") {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const logger = createLogger({ level: env.logLevel, pretty: env.appEnv === "dev" });
  const db = openDb(env.sqlitePath);
  const state = createStateStore(db);
  const sheetsApi = GoogleSheetsClient.create(env.google.spreadsheetId, logger);
  const sheets = env.dryRun ? new DryRunSheetsClient(sheetsApi, logger) : sheetsApi;
  const calendar = env.dryRun
    ? new FakeCalendarClient()
    : GoogleCalendarClient.create(env.google.calendarId, logger);
  const discord = new DiscordJsGateway({
    token: env.discord.token,
    appId: env.discord.appId,
    guildId: env.discord.guildId,
    logger,
  });
  const weeklyPlanDeps = {
    sheets,
    planner: new Planner(
      new AnthropicLlmClient({
        apiKey: env.anthropic.apiKey,
        model: env.anthropic.model,
        effort: env.anthropic.effort,
        logger,
      }),
      env.anthropic.effort,
      logger,
    ),
    calendar,
    discord,
    state,
    clock: systemClock,
    logger,
    channelId: env.discord.channelId,
    appEnv: env.appEnv,
  } as const;

  registerPlanCommand(discord, weeklyPlanDeps, env.discord.allowedUserIds);
  registerReactionRouter({
    discord,
    sheets,
    planner: weeklyPlanDeps.planner,
    calendar,
    state,
    clock: systemClock,
    logger,
    allowedUserIds: env.discord.allowedUserIds,
  });
  try {
    await discord.start(env.appEnv === "dev");
    withCorrelation(() => {
      logger.info(
        {
          appEnv: env.appEnv,
          dryRun: env.dryRun,
          model: env.anthropic.model,
          effort: env.anthropic.effort,
          allowedUsers: env.discord.allowedUserIds.length,
        },
        " started",
      );
    });
  } catch (error) {
    db.close();
    throw error;
  }

  const shutdown = async (): Promise<void> => {
    await discord.stop();
    db.close();
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

await main();
