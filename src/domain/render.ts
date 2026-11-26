import type { MealStatus } from "./mealState.js";
import type { Slot } from "./types.js";
import { optionEmoji } from "./emojis.js";
import type { MealOption } from "../planner/schema.js";

export interface RenderMealEventInput {
  title: string;
  options: string[];
  selectedIndex?: number;
  statusLine: string;
  recipeText?: string;
  aiFooter?: string;
}

export interface RenderMealMessageInput {
  slot: Slot;
  options: Array<{ title: string }>;
  status: MealStatus | "updating";
  chosenIndex?: number;
}

const STATUS_TEXT: Record<MealStatus | "updating", string> = {
  planned: "Planned",
  cooked: "Cooked",
  liked: "Cooked and liked",
  disliked: "Cooked and disliked",
  updating: "Updating...",
  needs_attention: "Needs attention",
};

export function renderMealMessage(input: RenderMealMessageInput): string {
  const isPlanned = input.status === "planned";
  const titles =
    isPlanned && input.slot === "lunch" && input.options.length > 1
      ? input.options
          .map((option, index) => `${optionEmoji(index) ?? `${index + 1}.`} ${option.title}`)
          .join("\n")
      : (input.options[input.chosenIndex ?? 0]?.title ?? input.options[0]?.title ?? "Meal");
  const mealType = `${input.slot[0]?.toUpperCase()}${input.slot.slice(1)}`;
  return `${mealType}:\n${titles}\nStatus: ${STATUS_TEXT[input.status]}`;
}

export function renderMealSummary(input: RenderMealEventInput): string {
  const summary = input.options.length > 1 ? input.options.join(" | ") : input.title;
  return input.selectedIndex !== undefined && input.selectedIndex >= 0
    ? `✅ ${input.options[input.selectedIndex] ?? input.title}`
    : summary;
}

export function renderMealDescription(input: RenderMealEventInput): string {
  const title = input.title;
  const recipe = input.recipeText ? `\n\n${input.recipeText}` : "";
  const footer = input.aiFooter ?? "AI-generated recipe";
  return `${title}${recipe}\n\n---\nStatus: ${input.statusLine}\nAI: ${footer}`;
}

export function renderTrimmedDescription(input: RenderMealEventInput): string {
  const selected = input.options[input.selectedIndex ?? 0] ?? input.title;
  const recipe = input.recipeText ? `\n\n${input.recipeText}` : "";
  return `${selected}${recipe}\n\n---\nStatus: ${input.statusLine}\nAI: ${input.aiFooter ?? "AI-generated recipe"}`;
}

export function renderMealRecipeText(options: MealOption[]): string {
  return options
    .map((option, index) => {
      const ingredients = option.ingredients_used
        .map((ingredient) => `- ${ingredient.name}: ${ingredient.quantity} ${ingredient.unit}`)
        .join("\n");
      const steps = option.steps.map((step, stepIndex) => `${stepIndex + 1}. ${step}`).join("\n");
      const notes = option.notes.length
        ? `\nNotes:\n${option.notes.map((note) => `- ${note}`).join("\n")}`
        : "";
      return [
        `Option ${index + 1}: ${option.title}`,
        `Servings: ${option.servings}`,
        `Time: ${option.time_minutes} minutes`,
        `Ingredients:\n${ingredients}`,
        `Steps:\n${steps}${notes}`,
      ].join("\n");
    })
    .join("\n\n");
}
