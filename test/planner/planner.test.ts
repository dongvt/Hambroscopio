import { describe, expect, it } from "vitest";
import { FixtureLlmClient } from "../../src/clients/llm/FixtureLlmClient.js";
import type { LlmClient, LlmGenerateRequest } from "../../src/clients/llm/LlmClient.js";
import { defaultSettings } from "../../src/config/sheetConfig.js";
import { Planner, PlanningFailed, type PlannerResult } from "../../src/planner/planner.js";
import { buildPlannerPrompt } from "../../src/planner/prompt.js";
import { validatePlannerOutput } from "../../src/planner/validate.js";

const baseInput = {
  settings: defaultSettings(),
  inventory: [
    { name: "Rice", unit: "cups", quantity: 10 },
    { name: "Chicken", unit: "lb", quantity: 5 },
    { name: "Beans", unit: "cups", quantity: 8 },
    { name: "Oil", unit: "tbsp", quantity: 20 },
    { name: "Salt", unit: "tbsp", quantity: 5 },
  ],
  banned: ["Boiled Sand"],
  liked: ["Chicken Rice Bowl"],
  recentlyCooked: ["Old Pasta"],
  existingWeekTitles: ["Lentil Soup"],
  meals: [
    { date: "2026-11-09", slot: "lunch" as const, options: 3 },
    { date: "2026-11-10", slot: "dinner" as const, options: 1 },
  ],
  reserveLunchFirstOption: true,
};

const validOutput: PlannerResult = {
  meals: [
    {
      date: "2026-11-09",
      slot: "lunch",
      options: [
        {
          title: "Chicken Rice Bowl",
          servings: 4,
          time_minutes: 30,
          ingredients_used: [
            { name: "Rice", quantity: 2, unit: "cups" },
            { name: "Chicken", quantity: 1, unit: "lb" },
            { name: "Oil", quantity: 1, unit: "tbsp" },
          ],
          steps: ["Cook rice", "Sear chicken"],
          notes: ["Healthy and easy"],
        },
        {
          title: "Bean Bowl",
          servings: 4,
          time_minutes: 25,
          ingredients_used: [
            { name: "Beans", quantity: 2, unit: "cups" },
            { name: "Rice", quantity: 1.5, unit: "cups" },
            { name: "Salt", quantity: 0.5, unit: "tbsp" },
          ],
          steps: ["Simmer beans", "Serve with rice"],
          notes: ["Budget meal"],
        },
        {
          title: "Citrus Chicken",
          servings: 4,
          time_minutes: 35,
          ingredients_used: [
            { name: "Chicken", quantity: 1, unit: "lb" },
            { name: "Rice", quantity: 1, unit: "cups" },
            { name: "Oil", quantity: 1, unit: "tbsp" },
          ],
          steps: ["Sear chicken", "Serve with rice"],
          notes: ["Quick"],
        },
      ],
    },
    {
      date: "2026-11-10",
      slot: "dinner",
      options: [
        {
          title: "Rice and Beans",
          servings: 4,
          time_minutes: 40,
          ingredients_used: [
            { name: "Rice", quantity: 2, unit: "cups" },
            { name: "Beans", quantity: 2, unit: "cups" },
            { name: "Oil", quantity: 1, unit: "tbsp" },
          ],
          steps: ["Warm beans", "Serve over rice"],
          notes: ["Simple"],
        },
      ],
    },
  ],
};

const validModelResponse = { status: "ok", meals: validOutput.meals } as const;

describe("planner validation", () => {
  it("explains the required recipe fields and explicit error response", () => {
    const prompt = buildPlannerPrompt(baseInput);

    expect(prompt.messages[0]?.content).toContain('"status":"ok","meals"');
    expect(prompt.messages[0]?.content).toContain('"status":"error","reason"');
    expect(prompt.messages[0]?.content).toContain("ingredients_used");
    expect(prompt.system).toContain("Never use ingredient strings");
  });

  it("accepts a valid plan and rejects banned or duplicate rules", () => {
    expect(validatePlannerOutput(validOutput, baseInput)).toEqual([]);

    const invalid = JSON.parse(JSON.stringify(validOutput));
    invalid.meals[0].options[0].title = "Boiled Sand";
    const bannedErrors = validatePlannerOutput(invalid, baseInput);
    expect(bannedErrors.some((issue) => issue.toLowerCase().includes("banned"))).toBe(true);

    const duplicate = JSON.parse(JSON.stringify(validOutput));
    duplicate.meals[0].options[1].title = duplicate.meals[0].options[0].title;
    const errors = validatePlannerOutput(duplicate, baseInput);
    expect(errors.some((issue) => issue.includes("Duplicate title"))).toBe(true);
  });

  it("rejects unit and inventory mismatches", () => {
    const invalid = JSON.parse(JSON.stringify(validOutput));
    invalid.meals[0].options[0].ingredients_used[0].unit = "g";
    const errors = validatePlannerOutput(invalid, baseInput);
    expect(errors.some((issue) => issue.includes("unit mismatch"))).toBe(true);

    const missing = JSON.parse(JSON.stringify(validOutput));
    missing.meals[0].options[0].ingredients_used[0].name = "Mystery Herb";
    expect(
      validatePlannerOutput(missing, baseInput).some((issue) => issue.includes("not in inventory")),
    ).toBe(true);
  });

  it("reports missing meals and incorrect configured option counts", () => {
    const incomplete = { meals: [validOutput.meals[0]] };
    const issues = validatePlannerOutput(incomplete, baseInput);
    expect(issues).toContain("Missing meal 2026-11-10 dinner.");

    const tooFewLunchOptions = structuredClone(validOutput);
    tooFewLunchOptions.meals[0]!.options.pop();
    expect(validatePlannerOutput(tooFewLunchOptions, baseInput)).toContain(
      "Meal 2026-11-09 lunch returned 2 option(s), expected 3.",
    );
  });

  it("shows the JSON path for a missing field", () => {
    const malformed: unknown = JSON.parse(JSON.stringify(validOutput));
    const object = malformed as {
      meals: Array<{ options: Array<Record<string, unknown>> }>;
    };
    delete object.meals[0]!.options[0]!.servings;

    expect(validatePlannerOutput(malformed, baseInput)).toContain(
      "$.meals[0].options[0].servings: Invalid input: expected number, received undefined",
    );
  });
});

describe("planner retries", () => {
  it("keeps retrying until the model produces a valid result", async () => {
    const invalidModelResponse = {
      status: "ok",
      meals: [
        {
          date: "2026-11-09",
          slot: "lunch",
          options: [
            {
              title: "Boiled Sand",
              servings: 4,
              time_minutes: 20,
              ingredients_used: [{ name: "Rice", quantity: 1, unit: "cups" }],
              steps: ["Cook"],
              notes: [],
            },
          ],
        },
      ],
    };
    const responses = [
      {
        text: JSON.stringify(invalidModelResponse),
        json: invalidModelResponse,
      },
      { text: JSON.stringify(validModelResponse), json: validModelResponse },
    ];

    const llm: LlmClient = {
      async generateJson(_req: LlmGenerateRequest) {
        const payload = responses.shift();
        if (!payload) {
          return {
            text: JSON.stringify(validModelResponse),
            json: validModelResponse,
            model: "test-model",
            usage: { inputTokens: 1, outputTokens: 1 },
            latencyMs: 1,
          };
        }
        return {
          text: payload.text,
          json: payload.json,
          model: "test-model",
          usage: { inputTokens: 1, outputTokens: 1 },
          latencyMs: 1,
        };
      },
    };

    const plan = await new Planner(llm).plan(baseInput);
    expect(plan.meals).toHaveLength(2);
  });

  it("exposes each rejected attempt and its inventory-feasibility reason", async () => {
    const invalid = structuredClone(validModelResponse);
    invalid.meals[0]!.options[0]!.ingredients_used[0]!.quantity = 100;
    const llm: LlmClient = {
      async generateJson() {
        return {
          text: JSON.stringify(invalid),
          json: invalid,
          model: "test-model",
          usage: { inputTokens: 10, outputTokens: 20 },
          latencyMs: 30,
        };
      },
    };

    const error = await new Planner(llm).plan(baseInput).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(PlanningFailed);
    if (!(error instanceof PlanningFailed)) throw error;
    expect(error.attempts).toHaveLength(3);
    expect(error.attempts[0]).toMatchObject({
      attempt: 1,
      model: "test-model",
      issueCategories: ["inventory_feasibility"],
      issues: [expect.stringContaining('cannot cover "Rice"')],
    });
  });

  it("retries malformed JSON with an explicit parse diagnostic", async () => {
    const responses = [
      {
        text: "{ definitely not JSON",
        json: undefined,
        parseError: "Unexpected token",
      },
      { text: JSON.stringify(validModelResponse), json: validModelResponse },
    ];
    const llm: LlmClient = {
      async generateJson() {
        const response = responses.shift();
        return {
          text: response?.text ?? JSON.stringify(validModelResponse),
          json: response?.json ?? validModelResponse,
          parseError: response?.parseError,
          model: "test-model",
          usage: { inputTokens: 1, outputTokens: 1 },
          latencyMs: 1,
        };
      },
    };

    const plan = await new Planner(llm).plan(baseInput);

    expect(plan.meals).toHaveLength(2);
  });

  it("retains the model's explicit error and reason across retries", async () => {
    const llm: LlmClient = {
      async generateJson() {
        return {
          text: JSON.stringify({ status: "error", reason: "Not enough rice remains." }),
          json: { status: "error", reason: "Not enough rice remains." },
          model: "test-model",
          usage: { inputTokens: 1, outputTokens: 1 },
          latencyMs: 1,
        };
      },
    };

    const error = await new Planner(llm).plan(baseInput).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(PlanningFailed);
    if (!(error instanceof PlanningFailed)) throw error;
    expect(error.attempts).toHaveLength(3);
    expect(error.attempts[0]?.issueCategories).toContain("model_reported_error");
    expect(error.attempts[0]?.issues[0]).toContain("Not enough rice remains");
  });
});

describe("fixture replay", () => {
  it("replays a fixed JSON fixture", async () => {
    const client = new FixtureLlmClient({
      plan_week: JSON.stringify(validModelResponse),
    });
    const response = await client.generateJson({
      system: "plan",
      messages: [{ role: "user", content: "plan" }],
      jsonSchema: {},
      maxTokens: 1000,
      effort: "medium",
      purpose: "plan_week",
    });
    expect(response.json).toEqual(validModelResponse);
  });
});
