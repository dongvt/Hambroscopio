export const MEAL_STATUSES = ["planned", "cooked", "liked", "disliked", "needs_attention"] as const;

export type MealStatus = (typeof MEAL_STATUSES)[number];

export type MealStateEvent = "cook" | "like" | "dislike" | "needs_attention" | "reset";

export function transitionMealState(current: MealStatus, event: MealStateEvent): MealStatus {
  switch (current) {
    case "planned":
      if (event === "cook") return "cooked";
      if (event === "needs_attention") return "needs_attention";
      return current;
    case "cooked":
      if (event === "like") return "liked";
      if (event === "dislike") return "disliked";
      if (event === "needs_attention") return "needs_attention";
      return current;
    case "liked":
    case "disliked":
      if (event === "needs_attention") return "needs_attention";
      if (event === "reset") return "planned";
      return current;
    case "needs_attention":
      if (event === "reset") return "planned";
      return current;
    default:
      return current;
  }
}

export function isFinalMealStatus(status: MealStatus): boolean {
  return status === "liked" || status === "disliked" || status === "needs_attention";
}
