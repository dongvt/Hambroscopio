import type { calendar_v3 } from "@googleapis/calendar";
import { describe, expect, it, vi } from "vitest";
import { GoogleCalendarClient } from "../../../src/clients/calendar/GoogleCalendarClient.js";
import { FakeCalendarClient } from "../../../src/clients/calendar/FakeCalendarClient.js";
import type { Logger } from "../../../src/lib/logger.js";
import {
  renderMealDescription,
  renderMealSummary,
  renderTrimmedDescription,
} from "../../../src/domain/render.js";

describe("calendar render", () => {
  it("formats lunch summaries and descriptions", () => {
    const summary = renderMealSummary({
      title: "Lunch",
      options: ["Chicken Bowl", "Bean Bowl", "Taco Salad"],
      statusLine: "Planned",
    });
    expect(summary).toBe("Chicken Bowl | Bean Bowl | Taco Salad");

    const description = renderMealDescription({
      title: "Dinner",
      options: ["Rice and Beans"],
      statusLine: "Planned",
      recipeText: "1. Cook rice\n2. Warm beans",
      aiFooter: "AI recipe",
    });
    expect(description).toContain("Status: Planned");
    expect(description).toContain("AI: AI recipe");
  });

  it("contains the chosen recipe after cooking", () => {
    const description = renderTrimmedDescription({
      title: "Lunch",
      options: ["Chicken Bowl", "Bean Bowl", "Taco Salad"],
      selectedIndex: 1,
      statusLine: "Cooked",
    });
    expect(description).toContain("Bean Bowl");
    expect(description).toContain("Status: Cooked");
  });
});

describe("fake calendar client", () => {
  it("creates, fetches and patches events", async () => {
    const client = new FakeCalendarClient();
    const created = await client.createEvent({
      mealKey: "week-1-breakfast",
      summary: "Oatmeal",
      description: "recipe",
      start: "2026-11-09T07:30:00",
      end: "2026-11-09T08:00:00",
      timeZone: "America/New_York",
    });
    expect(created.eventId).toMatch(/^fake-event-/);
    expect(await client.findByMealKey("week-1-breakfast")).not.toBeNull();
    await client.patchEvent(created.eventId, { summary: "Updated Oatmeal" });
    expect((await client.getEvent(created.eventId))?.summary).toBe("Updated Oatmeal");
  });
});

describe("GoogleCalendarClient", () => {
  it("maps and patches the calendar API payloads", async () => {
    const insert = vi.fn().mockResolvedValue({
      data: {
        id: "evt-123",
      },
    });
    const get = vi.fn().mockResolvedValue({
      data: {
        id: "evt-123",
        summary: "Oatmeal",
        description: "old description",
        start: { dateTime: "2026-11-09T07:30:00-05:00", timeZone: "America/New_York" },
        end: { dateTime: "2026-11-09T08:00:00-05:00", timeZone: "America/New_York" },
        extendedProperties: { private: { mealKey: "week-1-breakfast" } },
      },
    });
    const list = vi.fn().mockResolvedValue({
      data: {
        items: [
          {
            id: "evt-123",
            summary: "Oatmeal",
            description: "old description",
            start: { dateTime: "2026-11-09T07:30:00-05:00", timeZone: "America/New_York" },
            end: { dateTime: "2026-11-09T08:00:00-05:00", timeZone: "America/New_York" },
            extendedProperties: { private: { mealKey: "week-1-breakfast" } },
          },
        ],
      },
    });
    const patch = vi.fn().mockResolvedValue({ data: {} });
    type StubCalendar = {
      events: {
        insert: typeof insert;
        get: typeof get;
        list: typeof list;
        patch: typeof patch;
      };
    };
    const api: StubCalendar = {
      events: { insert, get, list, patch },
    };
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;
    const client = new GoogleCalendarClient(
      api as unknown as calendar_v3.Calendar,
      "dev-calendar",
      logger,
    );

    const created = await client.createEvent({
      mealKey: "week-1-breakfast",
      summary: "Oatmeal",
      description: "old description",
      start: "2026-11-09T07:30:00-05:00",
      end: "2026-11-09T08:00:00-05:00",
      timeZone: "America/New_York",
    });
    expect(created.eventId).toBe("evt-123");

    await client.patchEvent("evt-123", {
      summary: "Updated Oatmeal",
      description: "new description",
    });
    expect(patch).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarId: "dev-calendar",
        eventId: "evt-123",
        requestBody: expect.objectContaining({
          summary: "Updated Oatmeal",
          description: "new description",
        }),
      }),
    );

    expect((await client.findByMealKey("week-1-breakfast"))?.summary).toBe("Oatmeal");
    expect((await client.getEvent("evt-123"))?.description).toBe("old description");
  });
});
