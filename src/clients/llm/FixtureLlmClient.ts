import type { Logger } from "pino";
import { createLogger } from "../../lib/logger.js";
import type { LlmClient, LlmGenerateRequest, LlmResponse } from "./LlmClient.js";

export interface FixtureMap {
  [key: string]: unknown;
}

function fixtureKey(req: LlmGenerateRequest): string {
  const normalized = JSON.stringify({
    purpose: req.purpose,
    effort: req.effort,
    maxTokens: req.maxTokens,
    system: req.system,
    messages: req.messages,
  });
  return `${req.purpose}:${Buffer.from(normalized).toString("base64url")}`;
}

export class FixtureLlmClient implements LlmClient {
  private readonly fixtures: FixtureMap;
  private readonly logger: Logger;

  constructor(fixtures: FixtureMap = {}, logger?: Logger) {
    this.fixtures = fixtures;
    this.logger = logger ?? createLogger({ level: "debug", pretty: false });
  }

  async generateJson(req: LlmGenerateRequest): Promise<LlmResponse> {
    const exactKey = fixtureKey(req);
    const fallbackKey = `${req.purpose}:default`;
    const payload =
      this.fixtures[exactKey] ?? this.fixtures[fallbackKey] ?? this.fixtures[req.purpose];

    if (payload === undefined) {
      throw new Error(`No fixture recorded for planner purpose "${req.purpose}"`);
    }

    const text = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
    const response: LlmResponse = {
      text,
      json: typeof payload === "string" ? JSON.parse(payload) : payload,
      model: "fixture-model",
      usage: { inputTokens: 0, outputTokens: 0 },
      latencyMs: 0,
    };

    this.logger.debug(
      { purpose: req.purpose, key: exactKey, model: response.model },
      "Using fixture response",
    );
    return response;
  }
}
