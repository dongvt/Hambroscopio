import { afterEach, describe, expect, it } from "vitest";
import { FakeDiscordGateway } from "../../src/clients/discord/FakeDiscordGateway.js";
import { FakeSheetsClient } from "../../src/clients/sheets/FakeSheetsClient.js";
import { FakeClock } from "../../src/lib/clock.js";
import { createLogger } from "../../src/lib/logger.js";
import { openDb } from "../../src/state/db.js";
import { createStateStore } from "../../src/state/repos.js";
import {
  createScheduler,
  isSchedulerDue,
  tickScheduler,
  type SchedulerDeps,
} from "../../src/scheduler/scheduler.js";
import { defaultSettings } from "../../src/config/sheetConfig.js";

describe("scheduler", () => {
  const databases: ReturnType<typeof openDb>[] = [];

  afterEach(() => {
    for (const db of databases.splice(0)) db.close();
  });

  it("is due after plan_day plan_time and not due before it", () => {
    const settings = defaultSettings();
    settings.planDay = 7;
    settings.planTime = Temporal.PlainTime.from("18:00");

    expect(isSchedulerDue(new FakeClock("2026-11-22T17:59:00-05:00"), settings)).toBe(false);
    expect(isSchedulerDue(new FakeClock("2026-11-22T18:00:00-05:00"), settings)).toBe(true);
  });

  it("runs the upcoming week on startup catch-up when due", async () => {
    const deps = makeDeps("2026-11-22T18:00:00-05:00");
    databases.push(deps.db);
    const scheduler = createScheduler(deps);

    await scheduler.start();

    expect(deps.runCount).toBe(1);
    scheduler.stop();
  });

  it("does not run catch-up when catch_up is false", async () => {
    const deps = makeDeps("2026-11-22T18:00:00-05:00");
    databases.push(deps.db);
    deps.sheets.tabs.config[4] = ["catch_up", false];
    const scheduler = createScheduler(deps);

    await scheduler.start();

    expect(deps.runCount).toBe(0);
    scheduler.stop();
  });

  it("does not run before the configured due time", async () => {
    const deps = makeDeps("2026-11-18T12:00:00-05:00");
    databases.push(deps.db);

    await expect(tickScheduler(deps)).resolves.toBe("not_due");
    expect(deps.runCount).toBe(0);
  });

  it("skips an upcoming week that is already complete", async () => {
    const deps = makeDeps("2026-11-22T18:00:00-05:00");
    databases.push(deps.db);
    deps.state.weeks.upsert({
      weekId: "2026-11-23",
      status: "complete",
      channelId: "channel",
      introMessageId: "intro",
      createdAt: deps.clock.now().toString(),
      updatedAt: deps.clock.now().toString(),
    });

    await expect(tickScheduler(deps)).resolves.toBe("skipped");
    expect(deps.runCount).toBe(0);
  });

  it("warns once about an interrupted upcoming week and waits for /plan", async () => {
    const deps = makeDeps("2026-11-22T18:00:00-05:00");
    databases.push(deps.db);
    deps.state.weeks.upsert({
      weekId: "2026-11-23",
      status: "posting",
      channelId: "channel",
      introMessageId: null,
      createdAt: deps.clock.now().toString(),
      updatedAt: deps.clock.now().toString(),
    });

    await expect(tickScheduler(deps)).resolves.toBe("interrupted");
    await expect(tickScheduler(deps)).resolves.toBe("interrupted");

    expect(deps.runCount).toBe(0);
    expect(deps.discord.calls.filter((call) => call.operation === "sendMessage")).toHaveLength(1);
  });

  it("guards concurrent scheduled runs for the same upcoming week", async () => {
    const deps = makeDeps("2026-11-22T18:00:00-05:00");
    databases.push(deps.db);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    deps.setRunPlan(async () => {
      await gate;
      return { weekId: "2026-11-23", status: "complete" };
    });

    const first = tickScheduler(deps);
    while (deps.runCount === 0) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 1));
    await expect(tickScheduler(deps)).resolves.toBe("interrupted");
    release();
    await expect(first).resolves.toEqual({
      weekId: "2026-11-23",
      status: "complete",
    });
  });
});

function makeDeps(start: string) {
  const db = openDb(":memory:");
  const sheets = new FakeSheetsClient({
    config: [
      ["key", "value"],
      ["timezone", "America/New_York"],
      ["plan_day", "Sunday"],
      ["plan_time", "18:00"],
      ["catch_up", true],
    ],
  });
  const state = createStateStore(db);
  const discord = new FakeDiscordGateway();
  const clock = new FakeClock(start);
  let runCount = 0;
  let runPlanImpl = async () => {
    runCount += 1;
    return { weekId: "2026-11-23" as const, status: "complete" as const };
  };
  const mutable = {
    db,
    sheets,
    discord,
    state,
    clock,
    logger: createLogger({ level: "fatal", pretty: false }),
    channelId: "channel",
    get runCount() {
      return runCount;
    },
    runPlan: () => runPlanImpl(),
    setRunPlan: (implementation: () => Promise<{ weekId: "2026-11-23"; status: "complete" }>) => {
      runPlanImpl = async () => {
        runCount += 1;
        return implementation();
      };
    },
  };
  const typed: SchedulerDeps & typeof mutable = {
    ...mutable,
    runWeeklyPlan: () => mutable.runPlan(),
    get runCount() {
      return runCount;
    },
  };
  return typed;
}
