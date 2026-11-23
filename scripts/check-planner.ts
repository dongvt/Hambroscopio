// Live check: plans a week from the configured sheet using the selected .env model.
// Read-only for Sheets; no Discord or Calendar writes. Planner retries at most three times.
import { GoogleSheetsClient } from "../src/clients/sheets/GoogleSheetsClient.js";
import { loadDotEnv, loadEnv } from "../src/config/env.js";
import { parseSettings } from "../src/config/sheetConfig.js";
import { buildWeeklyPlannerInput } from "../src/flows/weeklyPlan.js";
import { systemClock } from "../src/lib/clock.js";
import { withCorrelation } from "../src/lib/context.js";
import { createLogger } from "../src/lib/logger.js";
import { nextWeekId, weekDates, weekIdOf } from "../src/lib/time.js";
import { AnthropicLlmClient } from "../src/clients/llm/AnthropicLlmClient.js";
import { Planner, PlanningFailed } from "../src/planner/planner.js";

const args = process.argv.slice(2);
const allowProd = args.includes("--allow-prod");
const weekArgument = args.find((argument) => argument.startsWith("--week="));
const requestedWeek = weekArgument?.slice("--week=".length);
const mealArgument = args.find((argument) => argument.startsWith("--meal="));
const requestedMeal = mealArgument?.slice("--meal=".length);

loadDotEnv();
const env = loadEnv();

if (env.appEnv === "prod" && !allowProd) {
  console.error("Refusing production planner check without --allow-prod.");
  process.exitCode = 1;
} else if (env.appEnv === "dev" && allowProd) {
  console.error("Refusing --allow-prod because the selected environment is not prod.");
  process.exitCode = 1;
} else {
  const logger = createLogger({ level: env.logLevel, pretty: true });

  await withCorrelation(async () => {
    try {
      const sheets = GoogleSheetsClient.create(env.google.spreadsheetId, logger);
      await sheets.checkTabs();
      const { settings, warnings } = parseSettings(await sheets.readConfig());
      for (const warning of warnings) logger.warn({ warning }, "invalid sheet configuration");
      if (
        settings.options.breakfast !== 1 ||
        settings.options.dinner !== 1 ||
        settings.options.lunch > 3
      ) {
        throw new Error(
          "Unsupported Config option counts: breakfast and dinner must be one, lunch must be at most three.",
        );
      }

      const now = systemClock.now().toZonedDateTimeISO(settings.timezone).toPlainDate();
      const mealMatch = requestedMeal
        ? /^(\d{4}-\d{2}-\d{2}):(breakfast|lunch|dinner)$/.exec(requestedMeal)
        : null;
      if (requestedMeal && !mealMatch) {
        throw new Error("Invalid --meal value; expected YYYY-MM-DD:breakfast|lunch|dinner.");
      }
      const mealDate = mealMatch?.[1];
      const mealSlot = mealMatch?.[2] as "breakfast" | "lunch" | "dinner" | undefined;
      const weekId =
        requestedWeek ??
        (mealDate ? weekIdOf(Temporal.PlainDate.from(mealDate)) : nextWeekId(weekIdOf(now)));
      const weekStart = Temporal.PlainDate.from(weekId);
      if (weekStart.toString() !== weekId || weekStart.dayOfWeek !== 1) {
        throw new Error(`Invalid --week value "${weekId}"; expected a Monday YYYY-MM-DD.`);
      }
      const meals = requestedMeal
        ? (() => {
            const date = Temporal.PlainDate.from(mealDate!);
            if (weekIdOf(date) !== weekId) {
              throw new Error(`Meal date ${date} is outside week ${weekId}.`);
            }
            return [
              { date: date.toString(), slot: mealSlot!, options: settings.options[mealSlot!] },
            ];
          })()
        : weekDates(weekId).flatMap((date) =>
            (["breakfast", "lunch", "dinner"] as const).map((slot) => ({
              date: date.toString(),
              slot,
              options: settings.options[slot],
            })),
          );
      const input = await buildWeeklyPlannerInput(sheets, settings, weekId, meals, logger);
      const planner = new Planner(
        new AnthropicLlmClient({
          apiKey: env.anthropic.apiKey,
          model: env.anthropic.model,
          effort: env.anthropic.effort,
          logger,
        }),
        env.anthropic.effort,
        logger,
      );

      console.log(
        `Testing configured ${env.appEnv} model "${env.anthropic.model}" at effort "${env.anthropic.effort}" for ${meals.length} meal(s) in week ${weekId}. This check does not write to Sheets, Calendar, or Discord.`,
      );
      const result = await planner.plan(input);
      console.log(
        `PASS: received and validated ${result.meals.length} meals (${result.meals.reduce((total, meal) => total + meal.options.length, 0)} options) for ${weekId}.`,
      );
    } catch (error) {
      if (error instanceof PlanningFailed) {
        console.error("FAIL: model responses were received but no response passed validation.");
        console.error(
          JSON.stringify(
            error.attempts.map(({ issues, ...attempt }) => ({
              ...attempt,
              issues: issues.slice(0, 10),
              omittedIssueCount: Math.max(0, issues.length - 10),
            })),
            null,
            2,
          ),
        );
      } else {
        console.error(
          `FAIL: live planner check could not complete: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      process.exitCode = 1;
    }
  });
}
