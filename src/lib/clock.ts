export interface Clock {
  now(): Temporal.Instant;
}

export const systemClock: Clock = {
  now: () => Temporal.Now.instant(),
};

/** Manually controlled clock for tests. */
export class FakeClock implements Clock {
  private current: Temporal.Instant;

  constructor(start: Temporal.Instant | string) {
    this.current = typeof start === "string" ? Temporal.Instant.from(start) : start;
  }

  now(): Temporal.Instant {
    return this.current;
  }

  set(instant: Temporal.Instant | string): void {
    this.current = typeof instant === "string" ? Temporal.Instant.from(instant) : instant;
  }

  advance(duration: Temporal.DurationLike): void {
    this.current = this.current.add(duration);
  }
}
