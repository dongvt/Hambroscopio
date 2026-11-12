import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { z } from "zod";
import { AppError } from "../lib/errors.js";

const snowflake = z.string().regex(/^\d{17,20}$/, "must be a Discord ID (17-20 digits)");

const bool = z
  .enum(["true", "false", "1", "0"])
  .default("false")
  .transform((v) => v === "true" || v === "1");

const required = z.string().trim().min(1, "is required");

const envSchema = z.object({
  APP_ENV: z.enum(["dev", "prod"]),
  DRY_RUN: bool,
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  SQLITE_PATH: required.default("./data/mealbot.sqlite"),

  DISCORD_TOKEN: required,
  DISCORD_APP_ID: snowflake,
  DISCORD_GUILD_ID: snowflake,
  DISCORD_CHANNEL_ID: snowflake,
  ALLOWED_USER_IDS: z
    .string()
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .pipe(z.array(snowflake).min(1, "needs at least one user ID")),

  ANTHROPIC_API_KEY: required,
  ANTHROPIC_MODEL: required.default("claude-haiku-5-5"),
  ANTHROPIC_EFFORT: z.enum(["none", "low", "medium", "high"]).default("medium"),

  SHEETS_SPREADSHEET_ID: required,
  CALENDAR_ID: required,
});

export interface Env {
  appEnv: "dev" | "prod";
  dryRun: boolean;
  logLevel: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
  sqlitePath: string;
  discord: {
    token: string;
    appId: string;
    guildId: string;
    channelId: string;
    allowedUserIds: string[];
  };
  anthropic: {
    apiKey: string;
    model: string;
    effort: "none" | "low" | "medium" | "high";
  };
  google: {
    spreadsheetId: string;
    calendarId: string;
  };
}

/** Loads a .env file into process.env without overriding variables that are already set. */
export function loadDotEnv(path = ".env"): void {
  if (!existsSync(path)) return;
  const parsed = parseEnv(readFileSync(path, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined && value !== undefined) process.env[key] = value;
  }
}

/** Validates the environment. Errors list variable names only, never values. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map(
      (i) => `${i.path.join(".") || "(root)"}: ${i.message}`,
    );
    throw new AppError("config", `Invalid environment:\n  - ${problems.join("\n  - ")}`);
  }
  const e = result.data;
  return {
    appEnv: e.APP_ENV,
    dryRun: e.DRY_RUN,
    logLevel: e.LOG_LEVEL,
    sqlitePath: e.SQLITE_PATH,
    discord: {
      token: e.DISCORD_TOKEN,
      appId: e.DISCORD_APP_ID,
      guildId: e.DISCORD_GUILD_ID,
      channelId: e.DISCORD_CHANNEL_ID,
      allowedUserIds: e.ALLOWED_USER_IDS,
    },
    anthropic: {
      apiKey: e.ANTHROPIC_API_KEY,
      model: e.ANTHROPIC_MODEL,
      effort: e.ANTHROPIC_EFFORT,
    },
    google: {
      spreadsheetId: e.SHEETS_SPREADSHEET_ID,
      calendarId: e.CALENDAR_ID,
    },
  };
}
