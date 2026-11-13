import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

const MIGRATIONS = [
  `
  CREATE TABLE IF NOT EXISTS weeks (
    week_id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    channel_id TEXT,
    intro_message_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS days (
    week_id TEXT NOT NULL,
    date TEXT NOT NULL,
    thread_id TEXT,
    PRIMARY KEY (week_id, date)
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS meals (
    id TEXT PRIMARY KEY,
    week_id TEXT NOT NULL,
    date TEXT NOT NULL,
    slot TEXT NOT NULL,
    status TEXT NOT NULL,
    rating TEXT,
    options_json TEXT NOT NULL,
    chosen_index INTEGER,
    discord_message_id TEXT,
    calendar_event_id TEXT,
    cooked_sheet_row INTEGER,
    needs_attention INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
];

export function openDb(path = "./data/mealbot.sqlite"): Database.Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  for (const migration of MIGRATIONS) db.exec(migration);
  return db;
}
