import { calendar, type calendar_v3 } from "@googleapis/calendar";
import { AppError } from "../../lib/errors.js";
import type { Logger } from "../../lib/logger.js";
import { createGoogleAuth, toGoogleAppError } from "../google/auth.js";
import type { CalendarClient, MealEvent, MealEventInput } from "./CalendarClient.js";

export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

export class GoogleCalendarClient implements CalendarClient {
  constructor(
    private readonly api: calendar_v3.Calendar,
    private readonly calendarId: string,
    private readonly logger: Logger,
  ) {}

  static create(calendarId: string, logger: Logger): GoogleCalendarClient {
    const api = calendar({ version: "v3", auth: createGoogleAuth([CALENDAR_SCOPE]) });
    return new GoogleCalendarClient(api, calendarId, logger);
  }

  async createEvent(event: MealEventInput): Promise<{ eventId: string }> {
    const created = await this.call("createEvent", event.mealKey, () =>
      this.api.events.insert({
        calendarId: this.calendarId,
        requestBody: {
          summary: event.summary,
          description: event.description,
          start: { dateTime: event.start, timeZone: event.timeZone },
          end: { dateTime: event.end, timeZone: event.timeZone },
          extendedProperties: { private: { mealKey: event.mealKey } },
        },
        sendUpdates: "externalOnly",
      }),
    );

    const eventId = created.data.id;
    if (!eventId) {
      throw new AppError("external", "Calendar create returned no event id", {
        details: { mealKey: event.mealKey },
      });
    }

    return { eventId };
  }

  async patchEvent(
    eventId: string,
    patch: Partial<Pick<MealEventInput, "summary" | "description" | "start" | "end">>,
  ): Promise<void> {
    const current = await this.getEvent(eventId);
    if (!current) {
      throw new AppError("not_found", `Calendar event not found: ${eventId}`, {
        details: { eventId },
      });
    }

    const requestBody: calendar_v3.Schema$Event = {
      summary: patch.summary ?? current.summary,
      description: patch.description ?? current.description,
      start: patch.start ? { dateTime: patch.start, timeZone: current.timeZone } : undefined,
      end: patch.end ? { dateTime: patch.end, timeZone: current.timeZone } : undefined,
    };

    await this.call("patchEvent", eventId, () =>
      this.api.events.patch({
        calendarId: this.calendarId,
        eventId,
        requestBody,
        sendUpdates: "externalOnly",
      }),
    );
  }

  async getEvent(eventId: string): Promise<MealEvent | null> {
    try {
      const response = await this.call("getEvent", eventId, () =>
        this.api.events.get({ calendarId: this.calendarId, eventId }),
      );
      return this.fromGoogleEvent(response.data);
    } catch (error) {
      if (isGoogleNotFound(error)) return null;
      throw error;
    }
  }

  async findByMealKey(mealKey: string): Promise<MealEvent | null> {
    const response = await this.call("findByMealKey", mealKey, () =>
      this.api.events.list({
        calendarId: this.calendarId,
        privateExtendedProperty: [`mealKey=${mealKey}`],
        singleEvents: true,
        maxResults: 10,
      }),
    );

    const event = response.data.items?.[0];
    return event ? this.fromGoogleEvent(event) : null;
  }

  private fromGoogleEvent(event: calendar_v3.Schema$Event): MealEvent | null {
    if (!event.id) return null;
    const mealKey = event.extendedProperties?.private?.mealKey ?? "";
    return {
      id: event.id,
      mealKey,
      summary: event.summary ?? "",
      description: event.description ?? "",
      start: event.start?.dateTime ?? event.start?.date ?? "",
      end: event.end?.dateTime ?? event.end?.date ?? "",
      timeZone: event.start?.timeZone ?? event.end?.timeZone ?? "UTC",
    };
  }

  private async call<T>(operation: string, subject: string, fn: () => Promise<T>): Promise<T> {
    const started = performance.now();
    try {
      const result = await fn();
      this.logger.info(
        {
          service: "calendar",
          operation,
          subject,
          durationMs: Math.round(performance.now() - started),
        },
        "calendar call ok",
      );
      return result;
    } catch (error) {
      const appError = toGoogleAppError("Calendar", operation, error);
      this.logger.error(
        {
          service: "calendar",
          operation,
          subject,
          durationMs: Math.round(performance.now() - started),
          status: appError.details?.status,
          error: appError.message,
        },
        "calendar call failed",
      );
      throw appError;
    }
  }
}

function isGoogleNotFound(error: unknown): boolean {
  if (error instanceof AppError) {
    return [404, 410].includes(Number(error.details?.status));
  }
  const maybe = error as { status?: number; code?: number };
  return [404, 410].includes(maybe.status ?? maybe.code ?? -1);
}
