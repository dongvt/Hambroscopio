import { describe, expect, it } from "vitest";
import { loadEnv } from "../../src/config/env.js";
import { AppError } from "../../src/lib/errors.js";

const valid = {
  APP_ENV: "dev",
  DISCORD_TOKEN: "discord-secret",
  DISCORD_APP_ID: "123456789012345678",
  DISCORD_GUILD_ID: "223456789012345678",
  DISCORD_CHANNEL_ID: "323456789012345678",
  ALLOWED_USER_IDS: "423456789012345678, 523456789012345678",
  ANTHROPIC_API_KEY: "sk-ant-secret",
  GOOGLE_APPLICATION_CREDENTIALS: "./secrets/google-dev.json",
  SHEETS_SPREADSHEET_ID: "sheet123",
  CALENDAR_ID: "cal@group.calendar.google.com",
};

function errorOf(fn: () => unknown): AppError {
  try {
    fn();
  } catch (e) {
    return e as AppError;
  }
  throw new Error("expected an error");
}

describe("loadEnv", () => {
  it("parses a valid environment with defaults", () => {
    const env = loadEnv(valid);
    expect(env.appEnv).toBe("dev");
    expect(env.dryRun).toBe(false);
    expect(env.logLevel).toBe("info");
    expect(env.sqlitePath).toBe("./data/mealbot.sqlite");
    expect(env.discord.allowedUserIds).toEqual(["423456789012345678", "523456789012345678"]);
    expect(env.anthropic.model).toBe("claude-haiku-5-5");
    expect(env.anthropic.effort).toBe("medium");
  });

  it("parses DRY_RUN", () => {
    expect(loadEnv({ ...valid, DRY_RUN: "true" }).dryRun).toBe(true);
    expect(loadEnv({ ...valid, DRY_RUN: "1" }).dryRun).toBe(true);
    expect(loadEnv({ ...valid, DRY_RUN: "false" }).dryRun).toBe(false);
  });

  it("accepts a single allowed user", () => {
    expect(
      loadEnv({ ...valid, ALLOWED_USER_IDS: "423456789012345678" }).discord.allowedUserIds,
    ).toHaveLength(1);
  });

  it("lists every problem by variable name", () => {
    const err = errorOf(() =>
      loadEnv({ ...valid, APP_ENV: "staging", DISCORD_TOKEN: "", ALLOWED_USER_IDS: "abc" }),
    );
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe("config");
    expect(err.message).toContain("APP_ENV");
    expect(err.message).toContain("DISCORD_TOKEN");
    expect(err.message).toContain("ALLOWED_USER_IDS");
  });

  it("rejects an empty allowed user list", () => {
    expect(errorOf(() => loadEnv({ ...valid, ALLOWED_USER_IDS: " , " })).message).toContain(
      "ALLOWED_USER_IDS",
    );
  });

  it("reports missing variables", () => {
    const { CALENDAR_ID: _omit, ...rest } = valid;
    expect(errorOf(() => loadEnv(rest)).message).toContain("CALENDAR_ID");
  });

  it("never includes secret values in errors", () => {
    const err = errorOf(() => loadEnv({ ...valid, APP_ENV: "bad" }));
    expect(err.message).not.toContain("discord-secret");
    expect(err.message).not.toContain("sk-ant-secret");
  });
});
