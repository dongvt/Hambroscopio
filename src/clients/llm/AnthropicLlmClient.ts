import Anthropic from "@anthropic-ai/sdk";
import type { Logger } from "pino";
import { createLogger } from "../../lib/logger.js";
import type { LlmClient, LlmEffort, LlmGenerateRequest, LlmResponse } from "./LlmClient.js";

export interface AnthropicLlmClientOptions {
  apiKey?: string;
  model?: string;
  effort?: LlmEffort;
  logger?: Logger;
}

function extractJsonText(text: string): string {
  const match = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (match && match[1] !== undefined) return match[1].trim();
  return text.trim();
}

function parseJsonBlock(text: string): unknown {
  const raw = extractJsonText(text);
  if (!raw) return {};
  return JSON.parse(raw);
}

export class AnthropicLlmClient implements LlmClient {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly defaultEffort: LlmEffort;
  private readonly logger: Logger;

  constructor(options: AnthropicLlmClientOptions = {}) {
    const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
    this.client = new Anthropic({ apiKey });
    this.model = options.model ?? process.env.ANTHROPIC_MODEL ?? "claude-haiku-5-5";
    this.defaultEffort = options.effort ?? "medium";
    this.logger = options.logger ?? createLogger({ level: "debug", pretty: false });
  }

  async generateJson(req: LlmGenerateRequest): Promise<LlmResponse> {
    const effort = req.effort ?? this.defaultEffort;
    const started = Date.now();

    this.logger.debug(
      { purpose: req.purpose, model: this.model, effort, maxTokens: req.maxTokens },
      "Sending planner prompt to Anthropic",
    );

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      thinking:
        effort === "none"
          ? undefined
          : {
              type: "enabled",
              budget_tokens: effort === "low" ? 1024 : effort === "medium" ? 4096 : 8192,
            },
    });

    const textBlock = Array.isArray(response.content)
      ? response.content.find((part) => part.type === "text")
      : null;
    const text = textBlock && "text" in textBlock ? String(textBlock.text) : "";
    const parsed = parseJsonBlock(text);

    const latencyMs = Date.now() - started;
    const usage = {
      inputTokens: Number(response.usage?.input_tokens ?? 0),
      outputTokens: Number(response.usage?.output_tokens ?? 0),
      thinkingTokens:
        typeof (
          response.usage as { output_tokens_details?: { reasoning_tokens?: number } } | undefined
        )?.output_tokens_details?.reasoning_tokens === "number"
          ? Number(
              (response.usage as { output_tokens_details?: { reasoning_tokens?: number } })
                .output_tokens_details?.reasoning_tokens ?? 0,
            )
          : undefined,
    };

    this.logger.debug(
      { purpose: req.purpose, model: this.model, effort, latencyMs, usage, text, json: parsed },
      "Anthropic planner response",
    );

    return {
      text,
      json: parsed,
      model: this.model,
      usage,
      latencyMs,
    };
  }
}
