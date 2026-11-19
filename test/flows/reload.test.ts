import { afterEach, describe, expect, it } from "vitest";
import { FakeCalendarClient } from "../../src/clients/calendar/FakeCalendarClient.js";
import { FakeDiscordGateway } from "../../src/clients/discord/FakeDiscordGateway.js";
import type { MessageRef } from "../../src/clients/discord/DiscordGateway.js";
import { FakeSheetsClient } from "../../src/clients/sheets/FakeSheetsClient.js";
import { defaultSettings } from "../../src/config/sheetConfig.js";
import { EMOJIS } from "../../src/domain/emojis.js";
import { FakeClock } from "../../src/lib/clock.js";
import { createLogger } from "../../src/lib/logger.js";
import type { MealOption } from "../../src/planner/schema.js";
import type { PlannerInput } from "../../src/planner/validate.js";
import type { PlannerResult } from "../../src/planner/planner.js";
import { openDb } from "../../src/state/db.js";
import { createStateStore, type MealRecord } from "../../src/state/repos.js";
import { reloadMeal } from "../../src/flows/reloadMeal.js";
import { reloadWeek, selectReloadableMeals } from "../../src/flows/reloadWeek.js";
import { reserveReload } from "../../src/flows/reloadLimit.js";
import { registerReactionRouter } from "../../src/discord/reactionRouter.js";

const weekId = "2026-11-16";
const wednesday = "2026-11-18";
const recipes: MealOption[] = [
  {
    title: "Lentil Bowl",
    servings: 4,
    time_minutes: 25,
    ingredients_used: [{ name: "Rice", quantity: 1, unit: "cups" }],
    steps: ["Cook rice."],
    notes: [],
  },
  {
    title: "Bean Tacos",
    servings: 4,
    time_minutes: 30,
    ingredients_used: [{ name: "Beans", quantity: 1, unit: "cups" }],
    steps: ["Warm beans."],
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

describe("reload flows", () => {
  const databases: ReturnType<typeof openDb>[] = [];
  afterEach(() => {
    for (const db of databases.splice(0)) db.close();
  });

  it("plans a single meal with other week titles and edits existing artifacts", async () => {
    const deps = makeDeps("2026-11-18T10:00:00-05:00");
    databases.push(deps.db);
    await addWeek(deps);
    const original = await addMeal(deps, wednesday, "lunch");
    const other = await addMeal(deps, "2026-11-17", "dinner");

    await reloadMeal(deps, original.meal.id, original.ref);

    expect(deps.planner.inputs[0]).toMatchObject({
      reserveLunchFirstOption: false,
      existingWeekTitles: ["Lentil Bowl"],
    });
    expect(deps.state.meals.get(original.meal.id)?.optionsJson).toContain(
      "Reloaded 2026-11-18 lunch 1",
    );
    expect(deps.state.meals.get(other.meal.id)?.optionsJson).toBe(other.meal.optionsJson);
    expect((await deps.discord.fetchMessage(original.ref))?.content).toContain(
      "Reloaded 2026-11-18 lunch 1",
    );
    expect((await deps.calendar.getEvent(original.meal.calendarEventId!))?.summary).toContain(
      "Reloaded 2026-11-18 lunch 1",
    );
    expect(await deps.calendar.getEvent(other.meal.calendarEventId!)).not.toBeNull();
  });

  it("fails before planning when a saved Calendar event is missing", async () => {
    const deps = makeDeps("2026-11-18T10:00:00-05:00");
    databases.push(deps.db);
    await addWeek(deps);
    const item = await addMeal(deps, wednesday, "lunch");
    item.meal.calendarEventId = "missing-event";
    deps.state.meals.upsert(item.meal);
    const messageCount = deps.discord.messages.size;

    await expect(reloadMeal(deps, item.meal.id, item.ref)).rejects.toThrow(
      "Calendar event is missing",
    );
    expect(deps.planner.inputs).toHaveLength(0);
    expect(deps.discord.messages.size).toBe(messageCount);
  });

  it("selects dinner onward at Wednesday 15:00, leaves cooked meals untouched", async () => {
    const deps = makeDeps("2026-11-18T15:00:00-05:00");
    databases.push(deps.db);
    await addWeek(deps);
    const pastBreakfast = await addMeal(deps, wednesday, "breakfast");
    const pastLunch = await addMeal(deps, wednesday, "lunch");
    const dinner = await addMeal(deps, wednesday, "dinner");
    await addMeal(deps, "2026-11-19", "breakfast");
    const thursdayLunch = await addMeal(deps, "2026-11-19", "lunch");
    await addMeal(deps, "2026-11-22", "dinner");
    thursdayLunch.meal.status = "cooked";
    deps.state.meals.upsert(thursdayLunch.meal);

    const selected = selectReloadableMeals(
      deps.state.meals.listForWeek(weekId),
      weekId,
      deps.clock.now(),
      "America/New_York",
      defaultSettings().times,
    );
    expect(selected.map((meal) => `${meal.date}:${meal.slot}`)).toEqual([
      `${wednesday}:dinner`,
      "2026-11-19:breakfast",
      "2026-11-22:dinner",
    ]);

    const affectedCount = await reloadWeek(deps, weekId, deps.introRef);

    expect(affectedCount).toBe(3);
    expect(deps.planner.inputs[0]?.meals.map((meal) => `${meal.date}:${meal.slot}`)).toEqual([
      `${wednesday}:dinner`,
      "2026-11-19:breakfast",
      "2026-11-22:dinner",
    ]);
    expect(deps.state.meals.get(pastBreakfast.meal.id)?.optionsJson).toBe(
      pastBreakfast.meal.optionsJson,
    );
    expect(deps.state.meals.get(pastLunch.meal.id)?.optionsJson).toBe(pastLunch.meal.optionsJson);
    expect(deps.state.meals.get(thursdayLunch.meal.id)?.optionsJson).toBe(
      thursdayLunch.meal.optionsJson,
    );
    expect(deps.state.meals.get(dinner.meal.id)?.optionsJson).toContain(
      "Reloaded 2026-11-18 dinner 1",
    );
  });

  it("enforces a persisted limit of ten reloads per rolling hour", () => {
    const deps = makeDeps("2026-11-18T10:00:00-05:00");
    databases.push(deps.db);

    for (let count = 0; count < 10; count += 1) reserveReload(deps.state, deps.clock);
    expect(() => reserveReload(deps.state, deps.clock)).toThrow("at most 10 reloads per hour");
    expect(deps.state.kv.get("reload_timestamps")).toBeDefined();

    deps.clock.advance({ hours: 1, nanoseconds: 1 });
    expect(() => reserveReload(deps.state, deps.clock)).not.toThrow();
  });

  it("clears the reacting user's reload reaction only after success", async () => {
    const deps = makeDeps("2026-11-18T10:00:00-05:00");
    databases.push(deps.db);
    await addWeek(deps);
    const item = await addMeal(deps, wednesday, "lunch");
    await deps.discord.addReactions(item.ref, [EMOJIS.reload]);

    registerReactionRouter({ ...deps, allowedUserIds: ["allowed"], delay: async () => {} });
    await deps.discord.emitReactionAdd({
      channelId: item.ref.channelId,
      messageId: item.ref.messageId,
      userId: "allowed",
      emoji: EMOJIS.reload,
    });

    expect(
      deps.discord.calls.some(
        (call) =>
          call.operation === "removeUserReaction" &&
          call.args[1] === EMOJIS.reload &&
          call.args[2] === "allowed",
      ),
    ).toBe(true);
    expect(deps.state.meals.get(item.meal.id)?.optionsJson).toContain(
      "Reloaded 2026-11-18 lunch 1",
    );
  });

  it("reloads from the current week's intro and clears its reload reaction", async () => {
    const deps = makeDeps("2026-11-18T10:00:00-05:00");
    databases.push(deps.db);
    await addWeek(deps);
    await addMeal(deps, wednesday, "lunch");
    registerReactionRouter({ ...deps, allowedUserIds: ["allowed"], delay: async () => {} });

    await deps.discord.emitReactionAdd({
      channelId: deps.introRef.channelId,
      messageId: deps.introRef.messageId,
      userId: "allowed",
      emoji: EMOJIS.reload,
    });

    expect(deps.planner.inputs[0]?.meals).toEqual([{ date: wednesday, slot: "lunch", options: 3 }]);
    expect(
      deps.discord.calls.some(
        (call) =>
          call.operation === "removeUserReaction" &&
          call.args[0] &&
          typeof call.args[0] === "object" &&
          "messageId" in call.args[0] &&
          call.args[0].messageId === deps.introRef.messageId &&
          call.args[1] === EMOJIS.reload &&
          call.args[2] === "allowed",
      ),
    ).toBe(true);
  });

  it("fails a week reload fast while a selected meal is locked", async () => {
    const deps = makeDeps("2026-11-18T10:00:00-05:00");
    databases.push(deps.db);
    await addWeek(deps);
    const item = await addMeal(deps, wednesday, "lunch");
    let releaseMeal!: () => void;
    let signalStarted!: () => void;
    const mealStarted = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const mealGate = new Promise<void>((resolve) => {
      releaseMeal = resolve;
    });
    let delayCount = 0;
    registerReactionRouter({
      ...deps,
      allowedUserIds: ["allowed"],
      delay: async () => {
        delayCount += 1;
        if (delayCount === 1) {
          signalStarted();
          await mealGate;
        }
      },
    });

    const mealAction = deps.discord.emitReactionAdd({
      channelId: item.ref.channelId,
      messageId: item.ref.messageId,
      userId: "allowed",
      emoji: EMOJIS.reload,
    });
    await mealStarted;
    await deps.discord.emitReactionAdd({
      channelId: deps.introRef.channelId,
      messageId: deps.introRef.messageId,
      userId: "allowed",
      emoji: EMOJIS.reload,
    });

    expect(
      [...deps.discord.messages.values()].some((message) => message.content.includes("busy")),
    ).toBe(true);
    expect(deps.planner.inputs).toHaveLength(0);
    releaseMeal();
    await mealAction;
    expect(deps.planner.inputs).toHaveLength(1);
  });
});

async function addMeal(
  deps: ReturnType<typeof makeDeps>,
  date: string,
  slot: MealRecord["slot"],
): Promise<{ meal: MealRecord; ref: MessageRef }> {
  const threadId = `thread-${date}`;
  deps.state.days.upsert({ weekId, date, threadId });
  const ref = await deps.discord.sendMessage(threadId, `${slot}\nStatus: Planned`);
  const count = defaultSettings().options[slot];
  const options = recipes.slice(0, count);
  await deps.discord.addReactions(ref, [
    ...(slot === "lunch"
      ? Array.from(
          { length: count },
          (_, index) => [EMOJIS.option1, EMOJIS.option2, EMOJIS.option3][index]!,
        )
      : [EMOJIS.cooked]),
    EMOJIS.reload,
  ]);
  const event = await deps.calendar.createEvent({
    mealKey: `${weekId}:${date}:${slot}`,
    summary: options.map((option) => option.title).join(" | "),
    description: "recipes",
    start: `${date}T12:00:00`,
    end: `${date}T12:45:00`,
    timeZone: "America/New_York",
  });
  const meal: MealRecord = {
    id: `${weekId}:${date}:${slot}`,
    weekId,
    date,
    slot,
    status: "planned",
    rating: null,
    optionsJson: JSON.stringify(options),
    chosenIndex: null,
    discordMessageId: ref.messageId,
    calendarEventId: event.eventId,
    cookedSheetRow: null,
    needsAttention: false,
    updatedAt: deps.clock.now().toString(),
  };
  deps.state.meals.upsert(meal);
  return { meal, ref };
}

async function addWeek(deps: ReturnType<typeof makeDeps>): Promise<void> {
  const introRef = await deps.discord.sendMessage("channel", "Weekly plan intro");
  deps.state.weeks.upsert({
    weekId,
    status: "complete",
    channelId: "channel",
    introMessageId: introRef.messageId,
    createdAt: deps.clock.now().toString(),
    updatedAt: deps.clock.now().toString(),
  });
  deps.introRef = introRef;
  await deps.discord.addReactions(introRef, [EMOJIS.reload]);
}

function makeDeps(start: string) {
  const db = openDb(":memory:");
  const planner = {
    inputs: [] as PlannerInput[],
    async plan(input: PlannerInput): Promise<PlannerResult> {
      this.inputs.push(input);
      return {
        meals: input.meals.map((meal) => ({
          date: meal.date,
          slot: meal.slot,
          options: Array.from({ length: meal.options }, (_, index) => ({
            ...recipes[index % recipes.length]!,
            title: `Reloaded ${meal.date} ${meal.slot} ${index + 1}`,
          })),
        })),
      };
    },
  };
  const deps = {
    db,
    discord: new FakeDiscordGateway(),
    sheets: new FakeSheetsClient({
      inventory: [
        ["Rice", "cups", 10],
        ["Beans", "cups", 10],
      ],
    }),
    planner,
    calendar: new FakeCalendarClient(),
    state: createStateStore(db),
    clock: new FakeClock(start),
    logger: createLogger({ level: "fatal", pretty: false }),
    introRef: { channelId: "channel", messageId: "intro" } as MessageRef,
  };
  return deps;
}
