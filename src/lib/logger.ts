import pino, { type DestinationStream, type Logger } from "pino";
import { currentCorrelationId } from "./context.js";

export type { Logger };

const SECRET_KEYS = ["token", "apiKey", "authorization", "Authorization", "password", "privateKey"];

export const REDACT_PATHS = [
  ...SECRET_KEYS,
  ...SECRET_KEYS.map((k) => `*.${k}`),
  ...SECRET_KEYS.map((k) => `*.*.${k}`),
  "headers.authorization",
  "*.headers.authorization",
  "*.headers.Authorization",
  "*.*.headers.authorization",
];

export interface LoggerOptions {
  level: string;
  pretty: boolean;
}

export function createLogger(options: LoggerOptions, destination?: DestinationStream): Logger {
  const config: pino.LoggerOptions = {
    level: options.level,
    base: { app: "mealbot" },
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    mixin() {
      const correlationId = currentCorrelationId();
      return correlationId ? { cid: correlationId } : {};
    },
  };

  if (destination) return pino(config, destination);
  if (options.pretty) {
    return pino({
      ...config,
      transport: { target: "pino-pretty", options: { translateTime: "SYS:HH:MM:ss.l" } },
    });
  }
  return pino(config);
}
