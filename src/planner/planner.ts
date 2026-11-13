import { AppError } from "../lib/errors.js";
import { buildPlannerPrompt } from "./prompt.js";
import { validatePlannerOutput, type PlannerInput } from "./validate.js";
import type { LlmClient } from "../clients/llm/LlmClient.js";

export { type PlannerInput } from "./validate.js";

export interface PlannerResult {
  meals: Array<{
    date: string;
    slot: "breakfast" | "lunch" | "dinner";
    options: Array<{
      title: string;
      servings: number;
      time_minutes: number;
      ingredients_used: Array<{ name: string; quantity: number; unit: string }>;
      steps: string[];
      notes: string[];
    }>;
  }>;
}

export class PlanningFailed extends AppError {
  constructor(message: string, cause?: unknown) {
    super("planning_failed", message, { cause });
  }
}

export class Planner {
  constructor(private readonly llmClient: LlmClient) {}

  async plan(input: PlannerInput): Promise<PlannerResult> {
    let prompt = buildPlannerPrompt(input);
    const previous: string[] = [];

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await this.llmClient.generateJson({
        system: prompt.system,
        messages: prompt.messages,
        jsonSchema: {},
        maxTokens: 15000,
        effort: "medium",
        purpose: input.reserveLunchFirstOption ? "plan_week" : "reload_meal",
      });

      const issues = validatePlannerOutput(response.json, input);
      if (issues.length === 0) {
        return response.json as PlannerResult;
      }

      previous.push(...issues);
      const nextPrompt = buildPlannerPrompt({
        ...input,
        previousErrors: [...new Set(previous)],
      });
      prompt = {
        system: nextPrompt.system,
        messages: [
          ...prompt.messages,
          { role: "assistant", content: response.text },
          {
            role: "user",
            content: `Previous response failed validation. Fix these issues:\n${issues.map((issue) => `- ${issue}`).join("\n")}`,
          },
        ],
      };
    }

    throw new PlanningFailed(
      "I couldn’t find a valid plan. Please update the inventory and run /plan.",
    );
  }
}

export async function plan(input: PlannerInput, llmClient: LlmClient): Promise<PlannerResult> {
  return new Planner(llmClient).plan(input);
}
