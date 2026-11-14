// Manual check: create one event, patch it, and print the IDs/fields.
// Usage: npm run check:calendar
import { GoogleCalendarClient } from "../src/clients/calendar/GoogleCalendarClient.js";
import { loadDotEnv, loadEnv } from "../src/config/env.js";
import { withCorrelation } from "../src/lib/context.js";
import { createLogger } from "../src/lib/logger.js";

loadDotEnv();
const env = loadEnv();
const logger = createLogger({ level: env.logLevel, pretty: true });
const client = GoogleCalendarClient.create(env.google.calendarId, logger);

await withCorrelation(async () => {
  try {
    const now = Temporal.Now.instant();
    const start = now.add({ minutes: 5 }).toString();
    const end = now.add({ minutes: 85 }).toString();
    const mealKey = `manual-check-${now.epochMilliseconds}`;

    const created = await client.createEvent({
      mealKey,
      summary: "Bot check: create and patch",
      description: "This event verifies the dev calendar create+patch flow.",
      start,
      end,
      timeZone: "UTC",
    });

    console.log(`Created event ${created.eventId} for ${mealKey}`);

    await client.patchEvent(created.eventId, {
      summary: "Bot check: patched",
      description: "This event was patched successfully.",
    });

    const patched = await client.getEvent(created.eventId);
    console.log(JSON.stringify(patched, null, 2));

    const byMeal = await client.findByMealKey(mealKey);
    console.log(`findByMealKey(${mealKey}) => ${byMeal?.id ?? "null"}`);
  } catch (error) {
    console.error(`
FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
});
