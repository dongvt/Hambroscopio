import { AsyncLocalStorage } from "node:async_hooks";
import { randomInt } from "node:crypto";

const storage = new AsyncLocalStorage<{ correlationId: string }>();
const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

export function newCorrelationId(length = 6): string {
  let id = "";
  for (let i = 0; i < length; i++) id += ALPHABET[randomInt(ALPHABET.length)];
  return id;
}

/** Runs fn with a correlation ID visible to everything it calls, including async work. */
export function withCorrelation<T>(fn: () => T, correlationId: string = newCorrelationId()): T {
  return storage.run({ correlationId }, fn);
}

export function currentCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}
