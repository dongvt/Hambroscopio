import { loadDotEnv, loadEnv } from "./config/env.js";
import { withCorrelation } from "./lib/context.js";
import { AppError } from "./lib/errors.js";
import { createLogger } from "./lib/logger.js";

function main(): void {
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

  withCorrelation(() => {
    logger.info(
      {
        appEnv: env.appEnv,
        dryRun: env.dryRun,
        model: env.anthropic.model,
        effort: env.anthropic.effort,
        allowedUsers: env.discord.allowedUserIds.length,
      },
      "mealbot started",
    );
  });
}

main();
