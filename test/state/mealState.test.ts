import { describe, expect, it } from "vitest";
import { isFinalMealStatus, transitionMealState } from "../../src/domain/mealState.js";

describe("mealState", () => {
  it("transitions through the normal lifecycle", () => {
    expect(transitionMealState("planned", "cook")).toBe("cooked");
    expect(transitionMealState("cooked", "like")).toBe("liked");
    expect(transitionMealState("cooked", "dislike")).toBe("disliked");
  });

  it("supports attention and reset flows", () => {
    expect(transitionMealState("planned", "needs_attention")).toBe("needs_attention");
    expect(transitionMealState("cooked", "needs_attention")).toBe("needs_attention");
    expect(transitionMealState("needs_attention", "reset")).toBe("planned");
  });

  it("marks the terminal states", () => {
    expect(isFinalMealStatus("liked")).toBe(true);
    expect(isFinalMealStatus("disliked")).toBe(true);
    expect(isFinalMealStatus("needs_attention")).toBe(true);
    expect(isFinalMealStatus("planned")).toBe(false);
  });
});
