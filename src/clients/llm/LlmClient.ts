export type LlmEffort = "none" | "low" | "medium" | "high";
export type LlmPurpose = "plan_week" | "reload_meal" | "reload_week";

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LlmGenerateRequest {
  system: string;
  messages: LlmMessage[];
  jsonSchema: object;
  maxTokens: number;
  effort: LlmEffort;
  purpose: LlmPurpose;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens?: number;
}

export interface LlmResponse {
  text: string;
  json: unknown;
  model: string;
  usage: LlmUsage;
  latencyMs: number;
}

export interface LlmClient {
  generateJson(req: LlmGenerateRequest): Promise<LlmResponse>;
}
