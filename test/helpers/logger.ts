import { Writable } from "node:stream";
import { createLogger, type Logger } from "../../src/lib/logger.js";

export function captureLogger(level = "debug"): {
  logger: Logger;
  lines: Record<string, unknown>[];
} {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(JSON.parse(chunk.toString()));
      cb();
    },
  });
  return { logger: createLogger({ level, pretty: false }, stream), lines };
}
