import { AppError } from "../lib/errors.js";
import type { Clock } from "../lib/clock.js";
import type { StateStore } from "../state/repos.js";

const KV_KEY = "reload_timestamps";
const WINDOW_HOURS = 1;
const MAX_RELOADS = 10;

export function reserveReload(state: StateStore, clock: Clock): void {
  const now = clock.now();
  const cutoff = now.subtract({ hours: WINDOW_HOURS });
  let timestamps: Temporal.Instant[];
  try {
    const stored: unknown = JSON.parse(state.kv.get(KV_KEY) ?? "[]");
    if (!Array.isArray(stored) || stored.some((value) => typeof value !== "string")) {
      throw new Error("stored reload timestamps must be an array of strings");
    }
    timestamps = stored.map((value) => Temporal.Instant.from(value as string));
  } catch (error) {
    throw new AppError("state", "Reload rate-limit state is invalid.", { cause: error });
  }

  const recent = timestamps.filter((timestamp) => Temporal.Instant.compare(timestamp, cutoff) > 0);
  if (recent.length >= MAX_RELOADS) {
    throw new AppError("validation", "Reload limit reached: at most 10 reloads per hour.");
  }
  recent.push(now);
  state.kv.set(KV_KEY, JSON.stringify(recent.map((timestamp) => timestamp.toString())));
}
