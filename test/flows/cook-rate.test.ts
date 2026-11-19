import { afterEach, describe, expect, it } from "vitest";
import { FakeCalendarClient } from "../../src/clients/calendar/FakeCalendarClient.js";
import { FakeDiscordGateway } from "../../src/clients/discord/FakeDiscordGateway.js";
import { FakeSheetsClient } from "../../src/clients/sheets/FakeSheetsClient.js";
import type { MealOption } from "../../src/planner/schema.js";
import { FakeClock } from "../../src/lib/clock.js";
import { createLogger } from "../../src/lib/logger.js";
import { openDb } from "../../src/state/db.js";
import { createStateStore, type MealRecord } from "../../src/state/repos.js";
import { cookMeal } from "../../src/flows/cook.js";
import { deductIngredients } from "../../src/flows/deduct.js";
import { rateMeal } from "../../src/flows/rate.js";
import { EMOJIS } from "../../src/domain/emojis.js";

const weekId = "2026-11-16";
const date = "2026-11-18";
const options: MealOption[] = [
  {
    title: "Lentil Bowl",
    servings: 4,
    time_minutes: 25,
    ingredients_used: [
      { name: "Rice", quantity: 4, unit: "cups" },
      { name: "Cumin", quantity: 1, unit: "tsp" },
    ],
    steps: ["Cook the rice.", "Warm lentils."],
    notes: [],
  },
  {
    title: "Bean Tacos",
    servings: 4,
    time_minutes: 30,
    ingredients_used: [{ name: "Beans", quantity: 2, unit: "cups" }],
    steps: ["Warm the beans.", "Serve in tortillas."],
    notes: [],
  },
  {
    title: "Veggie Rice",
    servings: 4,
    time_minutes: 20,
    ingredients_used: [{ name: "Rice", quantity: 1, unit: "cups" }],
    steps: ["Cook rice."],
    notes: [],
  },
];

describe("cook and rate flows", () => {
  const databases: ReturnType<typeof openDb>[] = [];
  afterEach(() => {
    for (const db of databases.splice(0)) db.close();
  });

  it("cooks the selected lunch option, deducts inventory, updates the calendar and reactions", async () => {
    const deps = makeDeps();
    databases.push(deps.db);
    const { meal, messageRef } = await addMeal(deps);

    await cookMeal(deps, meal.id, 1, messageRef);

    const saved = deps.state.meals.get(meal.id);
    expect(saved).toMatchObject({
      status: "cooked",
      chosenIndex: 1,
      cookedSheetRow: 2,
    });
    expect(deps.sheets.tabs.inventory.map((row) => row[2])).toEqual([1, 2, 0, 2]);
    expect(deps.sheets.tabs.cooked[0]).toEqual([
      date,
      weekId,
      "lunch",
      "Bean Tacos",
      "",
      "Beans -2 cups",
    ]);

    const event = await deps.calendar.getEvent(meal.calendarEventId!);
    expect(event?.summary).toBe("✅ Bean Tacos");
    expect(event?.description).toContain("Status: Cooked");
    expect(event?.description).toContain("Bean Tacos");
    expect(event?.description).toContain("Beans: 2 cups");
    expect(event?.description).toContain("1. Warm the beans.");

    const message = await deps.discord.fetchMessage(messageRef);
    expect(message?.content).toContain("Bean Tacos\nStatus: Cooked");
    expect(message?.reactions.map((reaction) => reaction.emoji)).toEqual([
      EMOJIS.liked,
      EMOJIS.disliked,
    ]);
  });

  it("clamps inventory, spills duplicate names, and reports missing ingredients", async () => {
    const deps = makeDeps();
    databases.push(deps.db);
    const result = await deductIngredients(deps.sheets, options[0]!, deps.logger);

    expect(deps.sheets.tabs.inventory.map((row) => row[2])).toEqual([0, 0, 2, 2]);
    expect(result.inventoryChanges).toBe("Rice -3 cups");
    expect(result.warnings).toEqual([
      "Rice: requested 4 cups, but only 3 was available; inventory was clamped at zero.",
      "Inventory row not found for Cumin; no quantity was deducted.",
    ]);
  });

  it("retries one external inventory write failure", async () => {
    const deps = makeDeps();
    databases.push(deps.db);
    deps.sheets.failNext("updateInventoryQuantities");

    const result = await deductIngredients(deps.sheets, options[1]!, deps.logger);

    expect(result.inventoryChanges).toBe("Beans -2 cups");
    const updates = deps.sheets.calls.filter(
      (call) => call.operation === "updateInventoryQuantities",
    );
    expect(updates).toHaveLength(2);
    expect(updates[0]?.args).toEqual(updates[1]?.args);
    expect(deps.sheets.tabs.inventory[2]?.[2]).toBe(0);
    expect(deps.sheets.tabs.inventory[3]?.[2]).toBe(2);
  });

  it("rates a cooked meal once and updates the cooked sheet and status", async () => {
    const deps = makeDeps();
    databases.push(deps.db);
    const { meal, messageRef } = await addMeal(deps);
    meal.status = "cooked";
    meal.chosenIndex = 1;
    meal.cookedSheetRow = 2;
    deps.state.meals.upsert(meal);
    deps.sheets.tabs.cooked.push([date, weekId, "lunch", "Bean Tacos", "", "Beans -2 cups"]);
    for (const emoji of [EMOJIS.option1, EMOJIS.option2, EMOJIS.option3, EMOJIS.reload]) {
      await deps.discord.removeEmoji(messageRef, emoji);
    }
    await deps.discord.addReactions(messageRef, [EMOJIS.liked, EMOJIS.disliked]);

    await rateMeal(deps, meal.id, "liked", messageRef);

    expect(deps.state.meals.get(meal.id)?.status).toBe("liked");
    expect(deps.sheets.tabs.liked).toEqual([["Bean Tacos", date]]);
    expect(deps.sheets.tabs.cooked[0]?.[4]).toBe("liked");
    expect((await deps.discord.fetchMessage(messageRef))?.content).toContain(
      "Bean Tacos\nStatus: Cooked and liked",
    );
    expect((await deps.discord.fetchMessage(messageRef))?.reactions).toEqual([]);

    await rateMeal(deps, meal.id, "liked", messageRef);
    expect(deps.sheets.tabs.liked).toHaveLength(1);
  });

  it("adds a disliked meal to Banned and stores the final rating", async () => {
    const deps = makeDeps();
    databases.push(deps.db);
    const { meal, messageRef } = await addMeal(deps);
    meal.status = "cooked";
    meal.chosenIndex = 0;
    meal.cookedSheetRow = 2;
    deps.state.meals.upsert(meal);
    deps.sheets.tabs.cooked.push([date, weekId, "lunch", "Lentil Bowl", "", "Rice -3 cups"]);
    for (const emoji of [EMOJIS.option1, EMOJIS.option2, EMOJIS.option3, EMOJIS.reload]) {
      await deps.discord.removeEmoji(messageRef, emoji);
    }
    await deps.discord.addReactions(messageRef, [EMOJIS.liked, EMOJIS.disliked]);

    await rateMeal(deps, meal.id, "disliked", messageRef);

    expect(deps.state.meals.get(meal.id)).toMatchObject({ status: "disliked", rating: "disliked" });
    expect(deps.sheets.tabs.banned).toEqual([["Lentil Bowl", date]]);
    expect(deps.sheets.tabs.cooked[0]?.[4]).toBe("disliked");
  });

  it("marks the meal needs_attention when an external cook step fails", async () => {
    const deps = makeDeps();
    databases.push(deps.db);
    const { meal, messageRef } = await addMeal(deps);
    deps.sheets.failNext("appendCooked");

    await expect(cookMeal(deps, meal.id, 0, messageRef)).rejects.toThrow(
      "fake appendCooked failed",
    );

    expect(deps.state.meals.get(meal.id)).toMatchObject({
      status: "needs_attention",
      needsAttention: true,
    });
    expect((await deps.discord.fetchMessage(messageRef))?.content).toContain("Needs attention");
  });

  it("includes missing-inventory warnings in the meal thread", async () => {
    const deps = makeDeps();
    databases.push(deps.db);
    const { meal, messageRef } = await addMeal(deps);

    await cookMeal(deps, meal.id, 0, messageRef);

    expect((await deps.discord.fetchMessage(messageRef))?.content).toContain(
      "Inventory row not found for Cumin",
    );
  });
});

async function addMeal(deps: ReturnType<typeof makeDeps>): Promise<{
  meal: MealRecord;
  messageRef: { channelId: string; messageId: string };
}> {
  const threadId = "thread-wed";
  deps.state.days.upsert({ weekId, date, threadId });
  deps.state.weeks.upsert({
    weekId,
    status: "complete",
    channelId: "channel",
    introMessageId: "intro",
    createdAt: deps.clock.now().toString(),
    updatedAt: deps.clock.now().toString(),
  });
  const messageRef = await deps.discord.sendMessage(threadId, "Lunch options\nStatus: Planned");
  await deps.discord.addReactions(messageRef, [
    EMOJIS.option1,
    EMOJIS.option2,
    EMOJIS.option3,
    EMOJIS.reload,
  ]);
  const event = await deps.calendar.createEvent({
    mealKey: `${weekId}:${date}:lunch`,
    summary: "Lentil Bowl | Bean Tacos | Veggie Rice",
    description: "recipes",
    start: "2026-11-18T12:00:00",
    end: "2026-11-18T12:45:00",
    timeZone: "America/New_York",
  });
  const meal: MealRecord = {
    id: `${weekId}:${date}:lunch`,
    weekId,
    date,
    slot: "lunch",
    status: "planned",
    rating: null,
    optionsJson: JSON.stringify(options),
    chosenIndex: null,
    discordMessageId: messageRef.messageId,
    calendarEventId: event.eventId,
    cookedSheetRow: null,
    needsAttention: false,
    updatedAt: deps.clock.now().toString(),
  };
  deps.state.meals.upsert(meal);
  return { meal, messageRef };
}

function makeDeps() {
  const db = openDb(":memory:");
  return {
    db,
    sheets: new FakeSheetsClient({
      inventory: [
        ["Rice", "cups", 1],
        [" rice ", "cups", 2],
        ["Beans", "cups", 2],
        ["Beans", "cups", 2],
      ],
    }),
    calendar: new FakeCalendarClient(),
    discord: new FakeDiscordGateway(),
    state: createStateStore(db),
    clock: new FakeClock("2026-11-18T18:00:00-05:00"),
    logger: createLogger({ level: "fatal", pretty: false }),
  };
}
