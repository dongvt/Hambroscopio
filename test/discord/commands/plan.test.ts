import { afterEach, describe, expect, it } from "vitest";
import { FakeCalendarClient } from "../../../src/clients/calendar/FakeCalendarClient.js";
import { FakeDiscordGateway } from "../../../src/clients/discord/FakeDiscordGateway.js";
import { FakeSheetsClient } from "../../../src/clients/sheets/FakeSheetsClient.js";
import { registerPlanCommand } from "../../../src/discord/commands/plan.js";
import { FakeClock } from "../../../src/lib/clock.js";
import { createLogger } from "../../../src/lib/logger.js";
import { PlanningFailed } from "../../../src/planner/planner.js";
import { openDb } from "../../../src/state/db.js";
import { createStateStore } from "../../../src/state/repos.js";

describe("/plan diagnostics", () => {
  const db = openDb(":memory:");
  afterEach(() => db.close());

  it("shows failed validation reasons to the allowed command user", async () => {
    const discord = new FakeDiscordGateway();
    const replies: string[] = [];
    registerPlanCommand(
      discord,
      {
        sheets: new FakeSheetsClient(),
        planner: {
          async plan() {
            throw new PlanningFailed(
              "I couldn't find a valid plan. Please update the inventory and run /plan.",
              [
                {
                  attempt: 1,
                  model: "test-model",
                  latencyMs: 42,
                  inputTokens: 10,
                  outputTokens: 20,
                  issueCategories: ["inventory_feasibility"],
                  issues: [
                    'Lunch reserve for 2026-11-23 lunch cannot cover "Rice": available 1, needed 3.',
                  ],
                },
              ],
            );
          },
        },
        calendar: new FakeCalendarClient(),
        discord,
        state: createStateStore(db),
        clock: new FakeClock("2026-11-17T23:10:00-05:00"),
        logger: createLogger({ level: "fatal", pretty: false }),
        channelId: "meal-channel",
        appEnv: "dev",
      },
      ["allowed-user"],
    );

    await discord.emitSlashCommand("plan", {
      userId: "allowed-user",
      options: {},
      defer: async () => {},
      reply: async (text) => {
        replies.push(text);
      },
    });

    expect(replies[0]).toContain("Planning the week now");
    expect(replies.at(-1)).toContain("Attempt 1 (inventory_feasibility)");
    expect(replies.at(-1)).toContain('cannot cover "Rice": available 1, needed 3');
    expect(replies.at(-1)).toContain("correction attempts");
  });
});
