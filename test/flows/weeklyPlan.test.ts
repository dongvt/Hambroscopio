import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeCalendarClient } from "../../src/clients/calendar/FakeCalendarClient.js";
import { FakeDiscordGateway } from "../../src/clients/discord/FakeDiscordGateway.js";
import type { PlannerInput } from "../../src/planner/validate.js";
import type { PlannerResult } from "../../src/planner/planner.js";
import { FakeClock } from "../../src/lib/clock.js";
import { createLogger } from "../../src/lib/logger.js";
import { openDb } from "../../src/state/db.js";
import { createStateStore } from "../../src/state/repos.js";
import { FakeSheetsClient } from "../../src/clients/sheets/FakeSheetsClient.js";
import { registerPlanCommand } from "../../src/discord/commands/plan.js";
import { renderMealMessage } from "../../src/domain/render.js";
import { defaultSettings } from "../../src/config/sheetConfig.js";
import { runWeeklyPlan, type WeeklyPlanDeps } from "../../src/flows/weeklyPlan.js";
import { weekDates } from "../../src/lib/time.js";

describe("weekly plan flow", () => {
  const databases: ReturnType<typeof openDb>[] = [];

  afterEach(() => {
    for (const db of databases.splice(0)) db.close();
  });

  it("plans, persists and posts a week using fakes", async () => {
    const { deps, db, planner } = makeDeps();
    databases.push(db);

    const result = await runWeeklyPlan(deps);

    expect(result).toEqual({ weekId: "2026-11-16", status: "complete" });
    expect(planner.plan).toHaveBeenCalledTimes(1);
    expect(deps.state.weeks.get("2026-11-16")?.status).toBe("complete");
    expect(deps.state.days.list("2026-11-16")).toHaveLength(7);
    expect(deps.state.meals.listForWeek("2026-11-16")).toHaveLength(21);
    expect(deps.discord.threads.size).toBe(7);
    expect(deps.discord.messages.size).toBe(22);
    await expect(
      deps.calendar.findByMealKey("2026-11-16:2026-11-16:breakfast"),
    ).resolves.toMatchObject({ summary: "breakfast 2026-11-16 Option 1" });

    const secondRun = await runWeeklyPlan(deps);
    expect(secondRun).toEqual({ weekId: "2026-11-16", status: "skipped" });
    expect(planner.plan).toHaveBeenCalledTimes(1);
    expect(deps.discord.calls.filter((call) => call.operation === "createThread")).toHaveLength(7);
  });

  it("rejects /plan from users outside the allowlist", async () => {
    const { deps, db, planner } = makeDeps();
    databases.push(db);
    registerPlanCommand(deps.discord, deps, ["allowed-user"]);
    const replies: string[] = [];

    await deps.discord.emitSlashCommand("plan", {
      userId: "unknown-user",
      options: {},
      defer: async () => {},
      reply: async (text) => {
        replies.push(text);
      },
    });

    expect(replies).toEqual(["You are not allowed to run /plan."]);
    expect(planner.plan).not.toHaveBeenCalled();
  });

  it("resumes a posting week without duplicating already-created messages or threads", async () => {
    const { deps, db, planner } = makeDeps();
    databases.push(db);
    const weekId = "2026-11-16";
    const settings = defaultSettings();
    deps.state.weeks.upsert({
      weekId,
      status: "posting",
      channelId: deps.channelId,
      introMessageId: null,
      createdAt: deps.clock.now().toString(),
      updatedAt: deps.clock.now().toString(),
    });

    await deps.discord.sendMessage(
      deps.channelId,
      `Hey, these are the suggested meals for the week of ${weekId}.`,
    );
    const mondayThread = await deps.discord.createThread(deps.channelId, "Mon 11/16");

    for (const date of weekDates(weekId)) {
      for (const slot of ["breakfast", "lunch", "dinner"] as const) {
        const options = makeOptions(
          date.toString(),
          slot,
          settings.options[slot],
          settings.servings,
        );
        const meal = {
          id: `${weekId}:${date}:${slot}`,
          weekId,
          date: date.toString(),
          slot,
          status: "planned" as const,
          rating: null,
          optionsJson: JSON.stringify(options),
          chosenIndex: null,
          discordMessageId: null,
          calendarEventId: null,
          cookedSheetRow: null,
          needsAttention: false,
          updatedAt: deps.clock.now().toString(),
        };
        deps.state.meals.upsert(meal);
        if (date.dayOfWeek === 1 && slot === "breakfast") {
          await deps.discord.sendMessage(
            mondayThread.threadId,
            renderMealMessage({ slot, options, status: "planned" }),
          );
        }
      }
    }

    const result = await runWeeklyPlan(deps, { weekId });

    expect(result).toEqual({ weekId, status: "complete" });
    expect(planner.plan).not.toHaveBeenCalled();
    expect(deps.discord.messages.size).toBe(22);
    expect(deps.discord.threads.size).toBe(7);
    expect(deps.state.meals.listForWeek(weekId).every((meal) => meal.discordMessageId)).toBe(true);
    expect(deps.state.meals.listForWeek(weekId).every((meal) => meal.calendarEventId)).toBe(true);
  });

  it("retries planning an interrupted week with no saved plan", async () => {
    const { deps, db, planner } = makeDeps();
    databases.push(db);
    deps.state.weeks.setStatus("2026-11-16", "planning", deps.clock.now().toString());

    const result = await runWeeklyPlan(deps);

    expect(result).toEqual({ weekId: "2026-11-16", status: "complete" });
    expect(planner.plan).toHaveBeenCalledTimes(1);
    expect(deps.state.weeks.get("2026-11-16")?.status).toBe("complete");
    expect(deps.state.meals.listForWeek("2026-11-16")).toHaveLength(21);
  });

  it("recreates deleted Discord threads and messages for a completed week without replanning", async () => {
    const { deps, db, planner } = makeDeps();
    databases.push(db);
    await runWeeklyPlan(deps);

    const originalEventIds = deps.state.meals
      .listForWeek("2026-11-16")
      .map((meal) => meal.calendarEventId);
    for (const [threadId] of deps.discord.threads) {
      deps.discord.threads.delete(threadId);
    }
    deps.discord.messages.clear();

    const result = await runWeeklyPlan(deps);

    expect(result).toEqual({ weekId: "2026-11-16", status: "repaired" });
    expect(planner.plan).toHaveBeenCalledTimes(1);
    expect(deps.discord.threads.size).toBe(7);
    expect(deps.discord.messages.size).toBe(22);
    expect(deps.state.meals.listForWeek("2026-11-16").map((meal) => meal.calendarEventId)).toEqual(
      originalEventIds,
    );
    expect(deps.state.meals.listForWeek("2026-11-16").every((meal) => meal.discordMessageId)).toBe(
      true,
    );
    expect(deps.state.weeks.get("2026-11-16")?.status).toBe("complete");
  });

  it("recreates only a missing meal message and saves its new ID", async () => {
    const { deps, db, planner } = makeDeps();
    databases.push(db);
    const weekId = "2026-11-16";
    await runWeeklyPlan(deps);

    const meals = deps.state.meals.listForWeek(weekId);
    const missingMeal = meals.find((meal) => meal.slot === "breakfast");
    if (!missingMeal) throw new Error("Expected breakfast meal");
    const threadId = deps.state.days
      .list(weekId)
      .find((day) => day.date === missingMeal.date)?.threadId;
    if (!threadId || !missingMeal.discordMessageId) {
      throw new Error("Expected saved thread and breakfast message IDs");
    }

    const originalMessageIds = new Map(
      meals.map((meal) => [meal.id, meal.discordMessageId] as const),
    );
    const unchangedMeal = meals.find(
      (meal) => meal.date === missingMeal.date && meal.slot === "dinner",
    );
    if (!unchangedMeal?.discordMessageId) throw new Error("Expected saved dinner message ID");
    const unchangedKey = `${threadId}:${unchangedMeal.discordMessageId}`;
    const unchangedMessage = deps.discord.messages.get(unchangedKey);
    if (!unchangedMessage) throw new Error("Expected existing dinner message");
    unchangedMessage.content = unchangedMessage.content.replace(/^Dinner:\n/, "");
    const originalMessageKey = `${threadId}:${missingMeal.discordMessageId}`;
    deps.discord.messages.delete(originalMessageKey);

    const result = await runWeeklyPlan(deps);

    const repairedMeal = deps.state.meals.get(missingMeal.id);
    expect(result).toEqual({ weekId, status: "repaired" });
    expect(planner.plan).toHaveBeenCalledTimes(1);
    expect(repairedMeal?.discordMessageId).not.toBe(missingMeal.discordMessageId);
    expect(
      deps.discord.messages.get(`${threadId}:${repairedMeal?.discordMessageId}`)?.content,
    ).toBe(`Breakfast:\nbreakfast ${missingMeal.date} Option 1\nStatus: Planned`);
    expect(deps.discord.messages.get(unchangedKey)?.content).toBe(
      `dinner ${missingMeal.date} Option 1\nStatus: Planned`,
    );
    for (const meal of meals.filter((candidate) => candidate.id !== missingMeal.id)) {
      expect(deps.state.meals.get(meal.id)?.discordMessageId).toBe(originalMessageIds.get(meal.id));
    }
    expect(deps.discord.calls.filter((call) => call.operation === "editMessage")).toHaveLength(0);
    expect(deps.discord.calls.filter((call) => call.operation === "sendMessage")).toHaveLength(23);
  });
});

function makeDeps(): {
  deps: WeeklyPlanDeps & {
    discord: FakeDiscordGateway;
    calendar: FakeCalendarClient;
    sheets: FakeSheetsClient;
  };
  db: ReturnType<typeof openDb>;
  planner: { plan: ReturnType<typeof vi.fn> };
} {
  const db = openDb(":memory:");
  const planner = {
    plan: vi.fn(async (input: PlannerInput): Promise<PlannerResult> => ({
      meals: input.meals.map((meal) => ({
        date: meal.date,
        slot: meal.slot,
        options: makeOptions(meal.date, meal.slot, meal.options, input.settings.servings),
      })),
    })),
  };
  const deps = {
    sheets: new FakeSheetsClient({ inventory: [["Rice", "cup", 100]] }),
    planner,
    calendar: new FakeCalendarClient(),
    discord: new FakeDiscordGateway(),
    state: createStateStore(db),
    clock: new FakeClock("2026-11-13T23:21:15-05:00"),
    logger: createLogger({ level: "fatal", pretty: false }),
    channelId: "meal-channel",
    appEnv: "dev" as const,
  };
  return { deps, db, planner };
}

function makeOptions(
  date: string,
  slot: "breakfast" | "lunch" | "dinner",
  count: number,
  servings: number,
) {
  return Array.from({ length: count }, (_, index) => ({
    title: `${slot} ${date} Option ${index + 1}`,
    servings,
    time_minutes: 30,
    ingredients_used: [{ name: "Rice", quantity: 1, unit: "cup" }],
    steps: ["Cook the rice."],
    notes: [],
  }));
}
