import type { AppSettings } from "../config/sheetConfig.js";
import type { Slot } from "../domain/types.js";

export interface PlannerPromptInput {
  settings: AppSettings;
  inventory: Array<{ name: string; unit: string; quantity: number }>;
  banned: string[];
  liked: string[];
  recentlyCooked: string[];
  existingWeekTitles: string[];
  meals: Array<{ date: string; slot: Slot; options: number }>;
  reserveLunchFirstOption: boolean;
  previousErrors?: string[];
}

function list(values: string[]): string {
  return values.length === 0 ? "(none)" : values.map((value) => `- ${value}`).join("\n");
}

export function buildPlannerPrompt(input: PlannerPromptInput): {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
} {
  const settings = input.settings;
  const language = settings.language && settings.language.trim() ? settings.language : "English";
  const meals = input.meals
    .map((meal) => `- ${meal.date} ${meal.slot}: ${meal.options} option(s)`)
    .join("\n");
  const system = `You are a meal planner for a family. Follow the rules exactly.

Rules:
- Use only inventory ingredients plus the assumed staples: ${settings.assumedStaples.join(", ") || "(none)"}.
- Use the inventory row names exactly and express every quantity in the row's unit.
- Do not invent ingredients or units; every ingredient must match an inventory row exactly.
- The final meal plan must be feasible from the current inventory. Shared ingredients are cumulative across the whole week.
- Never suggest a banned title. No duplicate title may appear within the same planned week. Favor variety.
- Keep titles and recipe text in ${language}. Traditional dish names stay in their original name when appropriate.
- Family-friendly meals for ${settings.servings} servings.
- Each response must be valid JSON that matches the requested schema.
- Return only JSON in the final answer; no markdown fences, no commentary.

If there are previous validation errors, fix them and keep the rest of the plan valid.`;

  const user = `Planner request

Config:
- servings: ${settings.servings}
- timezone: ${settings.timezone}
- language: ${language}
- no_repeat_weeks: ${settings.noRepeatWeeks}
- meal slots: ${JSON.stringify(settings.options)}
- breakfast time: ${settings.times.breakfast.toString()}
- lunch time: ${settings.times.lunch.toString()}
- dinner time: ${settings.times.dinner.toString()}
- plan_day: ${settings.planDay}
- plan_time: ${settings.planTime.toString()}

Inventory:
${input.inventory.map((item) => `- ${item.name}: ${item.quantity} ${item.unit}`).join("\n")}

Banned titles:
${list(input.banned)}

Liked titles:
${list(input.liked)}

Recently cooked titles:
${list(input.recentlyCooked)}

Titles already planned in this week:
${list(input.existingWeekTitles)}

Meals to plan:
${meals}

Rules to apply in the output:
- Use only names and units from the Inventory rows above.
- Each meal must include ${input.reserveLunchFirstOption ? "three lunch options when lunch is planned; reserve only the first lunch option in the ledger" : "the required options"}.
- Keep JSON strictly valid and return a top-level object with a single "meals" array.

${input.previousErrors && input.previousErrors.length > 0 ? `Previous validation errors:\n${input.previousErrors.map((error) => `- ${error}`).join("\n")}` : ""}`;

  return {
    system,
    messages: [{ role: "user", content: user }],
  };
}
