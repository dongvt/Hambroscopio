import { describe, expect, it } from "vitest";
import { currentCorrelationId, newCorrelationId, withCorrelation } from "../../src/lib/context.js";

describe("correlation IDs", () => {
  it("generates short lowercase IDs", () => {
    const id = newCorrelationId();
    expect(id).toMatch(/^[a-z2-9]{6}$/);
  });

  it("is undefined outside a correlation scope", () => {
    expect(currentCorrelationId()).toBeUndefined();
  });

  it("nests scopes", () => {
    withCorrelation(() => {
      expect(currentCorrelationId()).toBe("outer1");
      withCorrelation(() => expect(currentCorrelationId()).toBe("inner1"), "inner1");
      expect(currentCorrelationId()).toBe("outer1");
    }, "outer1");
  });
});
