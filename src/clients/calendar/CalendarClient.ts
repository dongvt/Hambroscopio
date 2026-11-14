export interface MealEventInput {
  mealKey: string;
  summary: string;
  description: string;
  start: string;
  end: string;
  timeZone: string;
}

export interface MealEvent {
  id: string;
  mealKey: string;
  summary: string;
  description: string;
  start: string;
  end: string;
  timeZone: string;
}

export interface CalendarClient {
  createEvent(event: MealEventInput): Promise<{ eventId: string }>;
  patchEvent(
    eventId: string,
    patch: Partial<Pick<MealEventInput, "summary" | "description" | "start" | "end">>,
  ): Promise<void>;
  getEvent(eventId: string): Promise<MealEvent | null>;
  findByMealKey(mealKey: string): Promise<MealEvent | null>;
}
