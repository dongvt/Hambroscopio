import { describe, expect, it } from "vitest";
import { AppError, funErrorMessage } from "../../src/lib/errors.js";

describe("errors", () => {
  it("keeps code, details and cause", () => {
    const cause = new Error("root");
    const err = new AppError("external", "Sheets failed", { cause, details: { range: "A1" } });
    expect(err.code).toBe("external");
    expect(err.details).toEqual({ range: "A1" });
    expect(err.cause).toBe(cause);
    expect(err).toBeInstanceOf(Error);
  });

  it("builds a fun message with the correlation ID", () => {
    expect(funErrorMessage("abc123", () => 0)).toBe(
      "⚠️ Dude, encontré un error, dile a Govert que lo arregle (id: abc123)",
    );
    expect(funErrorMessage("abc123", () => 0.9999)).toContain("(id: abc123)");
  });
});
