import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "../../src/state/db.js";
import { createStateStore } from "../../src/state/repos.js";

describe("state repos", () => {
  it("round-trips weeks, days, meals and kv values", () => {
    const dir = mkdtempSync(join(tmpdir(), "mealbot-state-"));
    const path = join(dir, "state.sqlite");
    const db = openDb(path);
    const store = createStateStore(db);

    const now = new Date().toISOString();
    store.weeks.upsert({
      weekId: "2026-11-09",
      status: "planning",
      channelId: "channel-1",
      introMessageId: "intro-1",
      createdAt: now,
      updatedAt: now,
    });
    store.days.upsert({ weekId: "2026-11-09", date: "2026-11-09", threadId: "thread-1" });
    store.meals.upsert({
      id: "2026-11-09-breakfast",
      weekId: "2026-11-09",
      date: "2026-11-09",
      slot: "breakfast",
      status: "planned",
      rating: null,
      optionsJson: JSON.stringify([{ title: "Oatmeal" }]),
      chosenIndex: null,
      discordMessageId: "msg-1",
      calendarEventId: "event-1",
      cookedSheetRow: null,
      needsAttention: false,
      updatedAt: now,
    });
    store.kv.set("latest-week", "2026-11-09");

    expect(store.weeks.get("2026-11-09")?.status).toBe("planning");
    expect(store.days.list("2026-11-09")).toHaveLength(1);
    expect(store.meals.listForWeek("2026-11-09")[0]?.status).toBe("planned");
    expect(store.kv.get("latest-week")).toBe("2026-11-09");

    store.weeks.setStatus("2026-11-09", "complete");
    expect(store.weeks.get("2026-11-09")?.status).toBe("complete");

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
