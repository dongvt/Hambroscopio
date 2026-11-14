import type { CalendarClient, MealEvent, MealEventInput } from "./CalendarClient.js";

export class FakeCalendarClient implements CalendarClient {
  private nextId = 1;
  private readonly events = new Map<string, MealEvent>();
  private readonly mealIndex = new Map<string, string>();

  async createEvent(event: MealEventInput): Promise<{ eventId: string }> {
    const id = `fake-event-${this.nextId++}`;
    const record: MealEvent = {
      id,
      mealKey: event.mealKey,
      summary: event.summary,
      description: event.description,
      start: event.start,
      end: event.end,
      timeZone: event.timeZone,
    };
    this.events.set(id, record);
    this.mealIndex.set(event.mealKey, id);
    return { eventId: id };
  }

  async patchEvent(
    eventId: string,
    patch: Partial<Pick<MealEventInput, "summary" | "description" | "start" | "end">>,
  ): Promise<void> {
    const existing = this.events.get(eventId);
    if (!existing) throw new Error(`Missing fake calendar event ${eventId}`);
    Object.assign(existing, patch);
  }

  async getEvent(eventId: string): Promise<MealEvent | null> {
    return this.events.get(eventId) ?? null;
  }

  async findByMealKey(mealKey: string): Promise<MealEvent | null> {
    const id = this.mealIndex.get(mealKey);
    return id ? (this.events.get(id) ?? null) : null;
  }
}
