import type Database from "better-sqlite3";
import type { MealStatus } from "../domain/mealState.js";
import type { Slot } from "../domain/types.js";
import type { WeekId } from "../lib/time.js";

export interface WeekRecord {
  weekId: WeekId;
  status: string;
  channelId: string | null;
  introMessageId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DayRecord {
  weekId: WeekId;
  date: string;
  threadId: string | null;
}

export interface MealRecord {
  id: string;
  weekId: WeekId;
  date: string;
  slot: Slot;
  status: MealStatus;
  rating: string | null;
  optionsJson: string;
  chosenIndex: number | null;
  discordMessageId: string | null;
  calendarEventId: string | null;
  cookedSheetRow: number | null;
  needsAttention: boolean;
  updatedAt: string;
}

function normalizeMeal(record: Record<string, unknown>): MealRecord {
  return {
    ...record,
    needsAttention: Number(record.needsAttention ?? record.needs_attention ?? 0) === 1,
  } as MealRecord;
}

export class WeekRepo {
  constructor(private readonly db: Database.Database) {}

  upsert(record: WeekRecord): void {
    this.db
      .prepare(
        `
        INSERT INTO weeks (week_id, status, channel_id, intro_message_id, created_at, updated_at)
        VALUES (@weekId, @status, @channelId, @introMessageId, @createdAt, @updatedAt)
        ON CONFLICT(week_id)
        DO UPDATE SET
          status = excluded.status,
          channel_id = excluded.channel_id,
          intro_message_id = excluded.intro_message_id,
          updated_at = excluded.updated_at
      `,
      )
      .run(record);
  }

  setStatus(weekId: WeekId, status: string, updatedAt = new Date().toISOString()): void {
    this.db
      .prepare(
        `
        INSERT INTO weeks (week_id, status, channel_id, intro_message_id, created_at, updated_at)
        VALUES (@weekId, @status, NULL, NULL, @updatedAt, @updatedAt)
        ON CONFLICT(week_id)
        DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at
      `,
      )
      .run({ weekId, status, updatedAt });
  }

  get(weekId: WeekId): WeekRecord | undefined {
    return this.db
      .prepare(
        `
        SELECT week_id AS weekId, status, channel_id AS channelId, intro_message_id AS introMessageId,
               created_at AS createdAt, updated_at AS updatedAt
        FROM weeks WHERE week_id = @weekId
      `,
      )
      .get({ weekId }) as WeekRecord | undefined;
  }

  list(): WeekRecord[] {
    return this.db
      .prepare(
        `
        SELECT week_id AS weekId, status, channel_id AS channelId, intro_message_id AS introMessageId,
               created_at AS createdAt, updated_at AS updatedAt
        FROM weeks ORDER BY week_id
      `,
      )
      .all() as WeekRecord[];
  }
}

export class DayRepo {
  constructor(private readonly db: Database.Database) {}

  upsert(record: DayRecord): void {
    this.db
      .prepare(
        `
        INSERT INTO days (week_id, date, thread_id)
        VALUES (@weekId, @date, @threadId)
        ON CONFLICT(week_id, date)
        DO UPDATE SET thread_id = excluded.thread_id
      `,
      )
      .run(record);
  }

  list(weekId: WeekId): DayRecord[] {
    return this.db
      .prepare(
        `SELECT week_id AS weekId, date, thread_id AS threadId FROM days WHERE week_id = @weekId ORDER BY date`,
      )
      .all({ weekId }) as DayRecord[];
  }
}

export class MealRepo {
  constructor(private readonly db: Database.Database) {}

  upsert(meal: MealRecord): void {
    this.db
      .prepare(
        `
        INSERT INTO meals (
          id, week_id, date, slot, status, rating, options_json, chosen_index,
          discord_message_id, calendar_event_id, cooked_sheet_row, needs_attention, updated_at
        ) VALUES (
          @id, @weekId, @date, @slot, @status, @rating, @optionsJson, @chosenIndex,
          @discordMessageId, @calendarEventId, @cookedSheetRow, @needsAttention, @updatedAt
        )
        ON CONFLICT(id)
        DO UPDATE SET
          week_id = excluded.week_id,
          date = excluded.date,
          slot = excluded.slot,
          status = excluded.status,
          rating = excluded.rating,
          options_json = excluded.options_json,
          chosen_index = excluded.chosen_index,
          discord_message_id = excluded.discord_message_id,
          calendar_event_id = excluded.calendar_event_id,
          cooked_sheet_row = excluded.cooked_sheet_row,
          needs_attention = excluded.needs_attention,
          updated_at = excluded.updated_at
      `,
      )
      .run({
        ...meal,
        needsAttention: meal.needsAttention ? 1 : 0,
      });
  }

  get(id: string): MealRecord | undefined {
    const row = this.db
      .prepare(
        `
        SELECT id, week_id AS weekId, date, slot, status, rating, options_json AS optionsJson,
               chosen_index AS chosenIndex, discord_message_id AS discordMessageId,
               calendar_event_id AS calendarEventId, cooked_sheet_row AS cookedSheetRow,
               needs_attention AS needsAttention, updated_at AS updatedAt
        FROM meals WHERE id = @id
      `,
      )
      .get({ id }) as Record<string, unknown> | undefined;
    return row ? normalizeMeal(row) : undefined;
  }

  listForWeek(weekId: WeekId): MealRecord[] {
    const rows = this.db
      .prepare(
        `
        SELECT id, week_id AS weekId, date, slot, status, rating, options_json AS optionsJson,
               chosen_index AS chosenIndex, discord_message_id AS discordMessageId,
               calendar_event_id AS calendarEventId, cooked_sheet_row AS cookedSheetRow,
               needs_attention AS needsAttention, updated_at AS updatedAt
        FROM meals WHERE week_id = @weekId ORDER BY date, slot
      `,
      )
      .all({ weekId }) as Record<string, unknown>[];
    return rows.map((row) => normalizeMeal(row));
  }
}

export class KvRepo {
  constructor(private readonly db: Database.Database) {}

  get(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM kv WHERE key = @key").get({ key }) as
      { value: string } | undefined;
    return row?.value;
  }

  set(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO kv (key, value) VALUES (@key, @value) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run({ key, value });
  }

  delete(key: string): void {
    this.db.prepare("DELETE FROM kv WHERE key = @key").run({ key });
  }
}

export interface StateStore {
  weeks: WeekRepo;
  days: DayRepo;
  meals: MealRepo;
  kv: KvRepo;
}

export function createStateStore(db: Database.Database): StateStore {
  return {
    weeks: new WeekRepo(db),
    days: new DayRepo(db),
    meals: new MealRepo(db),
    kv: new KvRepo(db),
  };
}
