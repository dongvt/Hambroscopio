import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { withCorrelation } from "../../src/lib/context.js";
import { createLogger } from "../../src/lib/logger.js";

function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(JSON.parse(chunk.toString()));
      cb();
    },
  });
  const logger = createLogger({ level: "debug", pretty: false }, stream);
  return { logger, lines };
}

describe("logger", () => {
  it("redacts tokens, keys and auth headers", () => {
    const { logger, lines } = capture();
    logger.info(
      {
        token: "t0",
        discord: { token: "t1" },
        env: { anthropic: { apiKey: "k1" } },
        req: { headers: { authorization: "Bearer abc" } },
        keep: "visible",
      },
      "msg",
    );
    const out = JSON.stringify(lines[0]);
    expect(out).not.toContain("t0");
    expect(out).not.toContain("t1");
    expect(out).not.toContain("k1");
    expect(out).not.toContain("Bearer abc");
    expect(out).toContain("visible");
    expect(out).toContain("[REDACTED]");
  });

  it("adds the correlation ID inside withCorrelation", () => {
    const { logger, lines } = capture();
    logger.info("outside");
    withCorrelation(() => logger.info("inside"), "abc123");
    expect(lines[0]).not.toHaveProperty("cid");
    expect(lines[1]).toMatchObject({ cid: "abc123", msg: "inside" });
  });

  it("keeps the correlation ID across async boundaries", async () => {
    const { logger, lines } = capture();
    await withCorrelation(async () => {
      await new Promise((r) => setTimeout(r, 1));
      logger.info("later");
    }, "zzz999");
    expect(lines[0]).toMatchObject({ cid: "zzz999" });
  });
});
