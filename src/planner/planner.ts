import { AppError } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";
import { buildPlannerPrompt } from "./prompt.js";
import { formatZodIssues, validatePlannerOutput, type PlannerInput } from "./validate.js";
import type { LlmClient, LlmResponse } from "../clients/llm/LlmClient.js";
import type { LlmEffort } from "../clients/llm/LlmClient.js";
import { plannerResponseSchema } from "./schema.js";

export { type PlannerInput } from "./validate.js";

const MAX_OUTPUT_TOKENS = 30_000;

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

export interface PlannerAttemptDiagnostic {
  attempt: number;
  model: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  stopReason?: string;
  parseError?: string;
  issueCategories: string[];
  issues: string[];
}

export class PlanningFailed extends AppError {
  readonly attempts: PlannerAttemptDiagnostic[];

  constructor(message: string, attempts: PlannerAttemptDiagnostic[], cause?: unknown) {
    super("planning_failed", message, {
      cause,
      details: { attempts },
    });
    this.attempts = attempts;
  }
}

export class Planner {
  constructor(
    private readonly llmClient: LlmClient,
    private readonly effort: LlmEffort = "medium",
    private readonly logger?: Logger,
  ) {}

  async plan(input: PlannerInput): Promise<PlannerResult> {
    let prompt = buildPlannerPrompt(input);
    const previous: string[] = [];
    const diagnostics: PlannerAttemptDiagnostic[] = [];

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const request = {
        system: prompt.system,
        messages: prompt.messages,
        jsonSchema: {},
        maxTokens: MAX_OUTPUT_TOKENS,
        effort: this.effort,
        purpose: input.reserveLunchFirstOption ? ("plan_week" as const) : ("reload_meal" as const),
      };
      this.logger?.debug(
        {
          attempt: attempt + 1,
          purpose: request.purpose,
          system: request.system,
          messages: request.messages,
        },
        "planner prompt",
      );

      let response: LlmResponse;
      try {
        response = await this.llmClient.generateJson(request);
      } catch (error) {
        this.logger?.error(
          {
            attempt: attempt + 1,
            purpose: request.purpose,
            error: error instanceof Error ? error.message : String(error),
          },
          "planner model request failed",
        );
        throw error;
      }

      let parsedResult: PlannerResult | undefined;
      let issues: string[];
      if (response.parseError) {
        const truncation =
          response.stopReason === "max_tokens"
            ? " The response reached the output token limit."
            : "";
        issues = [`Response was not valid JSON: ${response.parseError}.${truncation}`];
      } else {
        const parsedResponse = plannerResponseSchema.safeParse(response.json);
        if (!parsedResponse.success) {
          issues = formatZodIssues(parsedResponse.error.issues);
        } else if (parsedResponse.data.status === "error") {
          issues = [`Model reported it could not build the plan: ${parsedResponse.data.reason}`];
        } else {
          issues = validatePlannerOutput({ meals: parsedResponse.data.meals }, input);
          if (issues.length === 0) parsedResult = { meals: parsedResponse.data.meals };
        }
      }
      const issueCategories = [...new Set(issues.map(classifyIssue))];
      diagnostics.push({
        attempt: attempt + 1,
        model: response.model,
        latencyMs: response.latencyMs,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        ...(response.stopReason ? { stopReason: response.stopReason } : {}),
        ...(response.parseError ? { parseError: response.parseError } : {}),
        issueCategories,
        issues,
      });

      if (issues.length === 0) {
        this.logger?.info(
          {
            attempt: attempt + 1,
            model: response.model,
            latencyMs: response.latencyMs,
            usage: response.usage,
            mealCount: input.meals.length,
          },
          "planner accepted response",
        );
        if (!parsedResult) {
          throw new AppError("state", "Planner accepted a response without a parsed meal plan.");
        }
        return parsedResult;
      }

      this.logger?.warn(
        {
          attempt: attempt + 1,
          maxAttempts: 3,
          model: response.model,
          latencyMs: response.latencyMs,
          usage: response.usage,
          issueCategories,
          issues,
        },
        "planner response rejected by validation",
      );
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
      "I couldn't find a valid plan. Please update the inventory and run /plan.",
      diagnostics,
    );
  }
}

function classifyIssue(issue: string): string {
  const normalized = issue.toLowerCase();
  if (normalized.includes("valid json")) return "invalid_json";
  if (normalized.startsWith("$")) return "schema";
  if (normalized.includes("model reported it could not build")) return "model_reported_error";
  if (normalized.includes("insufficient") || normalized.includes("cannot cover")) {
    return "inventory_feasibility";
  }
  if (normalized.includes("not in inventory")) return "unknown_ingredient";
  if (normalized.includes("unit mismatch")) return "unit_mismatch";
  if (normalized.includes("banned")) return "banned_title";
  if (normalized.includes("duplicate title") || normalized.includes("repeats a title")) {
    return "duplicate_title";
  }
  if (normalized.includes("recent cooked")) return "recently_cooked";
  if (normalized.includes("servings")) return "servings";
  if (normalized.includes("missing meal") || normalized.includes("unexpected meal")) {
    return "meal_coverage";
  }
  if (normalized.includes("option")) return "option_count";
  return "other_validation";
}

export async function plan(input: PlannerInput, llmClient: LlmClient): Promise<PlannerResult> {
  return new Planner(llmClient).plan(input);
}
