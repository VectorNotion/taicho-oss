/**
 * The agent layer's model boundary. Implementations are only ever invoked
 * offline (scripts, cron) — never by the engine (ADR 0001).
 */
export interface LlmClient {
  complete(system: string, prompt: string): Promise<string>;
}

export function cascadeModel(): string {
  return process.env.CASCADE_MODEL ?? process.env.MODEL_NAME ?? "qwen/qwen3.7-plus";
}

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * OpenRouter chat-completions client over plain fetch — the agent layer takes
 * no model-SDK dependency. Reads OPENROUTER_API_KEY; model comes from
 * CASCADE_MODEL / MODEL_NAME (an OpenRouter slug like "qwen/qwen3.7-plus").
 */
export class OpenRouterLlm implements LlmClient {
  constructor(private readonly apiKey = process.env.OPENROUTER_API_KEY) {}

  async complete(system: string, prompt: string): Promise<string> {
    if (!this.apiKey) throw new Error("OPENROUTER_API_KEY is not set");
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: cascadeModel(),
        max_tokens: 16000,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`OpenRouter request failed (${response.status}): ${body.slice(0, 300)}`);
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
      error?: { message?: string };
    };
    if (data.error?.message) throw new Error(`OpenRouter error: ${data.error.message}`);
    const choice = data.choices?.[0];
    const text = choice?.message?.content ?? "";
    if (!text) {
      throw new Error(`model returned no text (finish_reason: ${choice?.finish_reason ?? "unknown"})`);
    }
    return text;
  }
}

/** Deterministic test double: returns canned responses in order, records prompts. */
export class StubLlm implements LlmClient {
  readonly calls: Array<{ system: string; prompt: string }> = [];
  private index = 0;

  constructor(private readonly responses: string[]) {}

  async complete(system: string, prompt: string): Promise<string> {
    this.calls.push({ system, prompt });
    if (this.index >= this.responses.length) {
      throw new Error("StubLlm exhausted its canned responses");
    }
    return this.responses[this.index++];
  }
}
