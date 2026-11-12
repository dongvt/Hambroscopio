// Manual check: reads every tab of the configured spreadsheet and prints what the bot sees.
// Read-only. Usage: npm run check:sheets
import { GoogleSheetsClient } from "../src/clients/sheets/GoogleSheetsClient.js";
import { loadDotEnv, loadEnv } from "../src/config/env.js";
import { parseSettings } from "../src/config/sheetConfig.js";
import { withCorrelation } from "../src/lib/context.js";
import { createLogger } from "../src/lib/logger.js";

loadDotEnv();
const env = loadEnv();
const logger = createLogger({ level: env.logLevel, pretty: true });
const client = GoogleSheetsClient.create(env.google.spreadsheetId, logger);

await withCorrelation(async () => {
  try {
    await client.checkTabs();
    const [config, inventory, liked, banned, cooked] = await Promise.all([
      client.readConfig(),
      client.readInventory(),
      client.readLiked(),
      client.readBanned(),
      client.readCooked(),
    ]);
    const { settings, warnings, defaulted } = parseSettings(config);

    console.log("\n=== Settings ===");
    console.log(
      JSON.stringify(settings, (_k, v) => (v instanceof Temporal.PlainTime ? v.toString() : v), 2),
    );
    if (defaulted.length) console.log(`Defaults used for: ${defaulted.join(", ")}`);
    for (const w of warnings) console.log(`WARNING: ${w}`);

    console.log(`\n=== Inventory (${inventory.length} rows) ===`);
    for (const r of inventory) {
      const flag = r.quantity === null ? `  <-- invalid quantity "${r.quantityRaw}"` : "";
      console.log(`  row ${r.rowNumber}: ${r.name} = ${r.quantity ?? 0} ${r.unit}${flag}`);
    }

    console.log(`\nLiked: ${liked.length}, Banned: ${banned.length}, Cooked: ${cooked.length}`);
    console.log("\nOK: spreadsheet is readable and has the expected tabs.");
  } catch (error) {
    console.error(`\nFAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
});
