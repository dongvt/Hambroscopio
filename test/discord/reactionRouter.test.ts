import { afterEach, describe, expect, it } from "vitest";
import { FakeCalendarClient } from "../../src/clients/calendar/FakeCalendarClient.js";
import { FakeDiscordGateway } from "../../src/clients/discord/FakeDiscordGateway.js";
import { FakeSheetsClient } from "../../src/clients/sheets/FakeSheetsClient.js";
import { EMOJIS } from "../../src/domain/emojis.js";
import { FakeClock } from "../../src/lib/clock.js";
import { createLogger } from "../../src/lib/logger.js";
import type { MealOption } from "../../src/planner/schema.js";
import type { PlannerInput } from "../../src/planner/validate.js";
import type { PlannerResult } from "../../src/planner/planner.js";
import { openDb } from "../../src/state/db.js";
import { createStateStore, type MealRecord } from "../../src/state/repos.js";
import { registerReactionRouter } from "../../src/discord/reactionRouter.js";

const currentWeek = "2026-11-16";
const nextWeek = "2026-11-23";
const today = "2026-11-18";
const options: MealOption[] = [
  {
    title: "Lentil Bowl",
    servings: 4,
    time_minutes: 25,
    ingredients_used: [{ name: "Rice", quantity: 1, unit: "cups" }],
    steps: ["Cook the rice."],
    notes: [],
  },
  {
    title: "Bean Tacos",
    servings: 4,
    time_minutes: 30,
    ingredients_used: [{ name: "Beans", quantity: 1, unit: "cups" }],
    steps: ["Warm the beans."],
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

describe("reaction router", () => {
  const databases: ReturnType<typeof openDb>[] = [];
  afterEach(() => {
    for (const db of databases.splice(0)) db.close();
  });

  it("ignores the bot, rejects unauthorized users and rejects past-week reactions", async () => {
    const deps = makeDeps();
    databases.push(deps.db);
    const currentMeal = await addMeal(deps, currentWeek, today);
    const oldMeal = await addMeal(deps, "2026-11-09", "2026-11-11");
    registerReactionRouter(deps);

    await deps.discord.emitReactionAdd({
      channelId: currentMeal.ref.channelId,
      messageId: currentMeal.ref.messageId,
      userId: deps.discord.botUserId,
      emoji: EMOJIS.option1,
    });
    await deps.discord.emitReactionAdd({
      channelId: currentMeal.ref.channelId,
      messageId: currentMeal.ref.messageId,
      userId: "not-allowed",
      emoji: EMOJIS.option1,
    });
    await deps.discord.emitReactionAdd({
      channelId: oldMeal.ref.channelId,
      messageId: oldMeal.ref.messageId,
      userId: "allowed",
      emoji: EMOJIS.option1,
    });

    expect(deps.state.meals.get(currentMeal.meal.id)?.status).toBe("planned");
    expect(deps.state.meals.get(oldMeal.meal.id)?.status).toBe("planned");
    expect(
      deps.discord.calls.filter((call) => call.operation === "removeUserReaction"),
    ).toHaveLength(2);
  });

  it("rejects emojis that are invalid for the meal's current state", async () => {
    const deps = makeDeps();
    databases.push(deps.db);
    const { meal, ref } = await addMeal(deps, currentWeek, today);
    meal.status = "cooked";
    meal.chosenIndex = 0;
    meal.cookedSheetRow = 2;
    deps.state.meals.upsert(meal);
    registerReactionRouter(deps);

    await deps.discord.emitReactionAdd({
      channelId: ref.channelId,
      messageId: ref.messageId,
      userId: "allowed",
      emoji: EMOJIS.option1,
    });

    expect(
      deps.discord.calls.filter((call) => call.operation === "removeUserReaction"),
    ).toHaveLength(1);
    expect(deps.state.meals.get(meal.id)?.status).toBe("cooked");
  });

  it("rejects an otherwise valid emoji that the bot no longer has placed", async () => {
    const deps = makeDeps();
    databases.push(deps.db);
    const { meal, ref } = await addMeal(deps, currentWeek, today);
    await deps.discord.removeEmoji(ref, EMOJIS.option1);
    registerReactionRouter(deps);

    await deps.discord.emitReactionAdd({
      channelId: ref.channelId,
      messageId: ref.messageId,
      userId: "allowed",
      emoji: EMOJIS.option1,
    });

    expect(deps.discord.calls.some((call) => call.operation === "hasUserReaction")).toBe(true);
    expect(
      deps.discord.calls.filter((call) => call.operation === "removeUserReaction"),
    ).toHaveLength(1);
    expect(deps.state.meals.get(meal.id)?.status).toBe("planned");
  });

  it("re-fetches after debounce and ignores a reaction that was removed", async () => {
    const deps = makeDeps();
    databases.push(deps.db);
    const { meal, ref } = await addMeal(deps, currentWeek, today);
    registerReactionRouter({
      ...deps,
      delay: async () => {
        await deps.discord.removeUserReaction(ref, EMOJIS.option1, "allowed");
      },
    });

    await deps.discord.emitReactionAdd({
      channelId: ref.channelId,
      messageId: ref.messageId,
      userId: "allowed",
      emoji: EMOJIS.option1,
    });

    expect(deps.discord.calls.some((call) => call.operation === "hasUserReaction")).toBe(true);
    expect(deps.state.meals.get(meal.id)?.status).toBe("planned");
  });

  it("serializes concurrent meal reactions and accepts the planned next week", async () => {
    const deps = makeDeps();
    databases.push(deps.db);
    const { meal, ref } = await addMeal(deps, nextWeek, "2026-11-23");
    registerReactionRouter(deps);

    await Promise.all(
      [EMOJIS.option1, EMOJIS.option2].map((emoji) =>
        deps.discord.emitReactionAdd({
          channelId: ref.channelId,
          messageId: ref.messageId,
          userId: "allowed",
          emoji,
        }),
      ),
    );

    expect(deps.state.meals.get(meal.id)?.status).toBe("cooked");
    expect(deps.sheets.tabs.cooked).toHaveLength(1);
    expect(
      deps.discord.calls.filter((call) => call.operation === "editMessage").length,
    ).toBeGreaterThan(0);
  });
});

async function addMeal(
  deps: ReturnType<typeof makeDeps>,
  weekId: string,
  date: string,
): Promise<{ meal: MealRecord; ref: { channelId: string; messageId: string } }> {
  const threadId = `thread-${weekId}-${date}`;
  deps.state.weeks.upsert({
    weekId,
    status: "complete",
    channelId: "channel",
    introMessageId: "intro",
    createdAt: deps.clock.now().toString(),
    updatedAt: deps.clock.now().toString(),
  });
  deps.state.days.upsert({ weekId, date, threadId });
  const ref = await deps.discord.sendMessage(threadId, "Lunch\nStatus: Planned");
  await deps.discord.addReactions(ref, [
    EMOJIS.option1,
    EMOJIS.option2,
    EMOJIS.option3,
    EMOJIS.reload,
  ]);
  const event = await deps.calendar.createEvent({
    mealKey: `${weekId}:${date}:lunch`,
    summary: options.map((option) => option.title).join(" | "),
    description: "recipes",
    start: `${date}T12:00:00`,
    end: `${date}T12:45:00`,
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
    discordMessageId: ref.messageId,
    calendarEventId: event.eventId,
    cookedSheetRow: null,
    needsAttention: false,
    updatedAt: deps.clock.now().toString(),
  };
  deps.state.meals.upsert(meal);
  return { meal, ref };
}

function makeDeps() {
  const db = openDb(":memory:");
  return {
    db,
    discord: new FakeDiscordGateway(),
    sheets: new FakeSheetsClient({
      inventory: [
        ["Rice", "cups", 10],
        ["Beans", "cups", 10],
      ],
    }),
    planner: {
      async plan(input: PlannerInput): Promise<PlannerResult> {
        return {
          meals: input.meals.map((meal) => ({
            date: meal.date,
            slot: meal.slot,
            options: Array.from({ length: meal.options }, (_, index) => ({
              ...options[index % options.length]!,
              title: `Reloaded ${meal.date} ${meal.slot} ${index + 1}`,
            })),
          })),
        };
      },
    },
    calendar: new FakeCalendarClient(),
    state: createStateStore(db),
    clock: new FakeClock("2026-11-18T18:00:00-05:00"),
    logger: createLogger({ level: "fatal", pretty: false }),
    allowedUserIds: ["allowed"],
    delay: async () => {},
  };
}
