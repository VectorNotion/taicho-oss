import { appendFile } from "node:fs/promises";

export const LOCAL_RESEARCH_USAGE_FILE = "/tmp/taicho-research-provider-usage.jsonl";

export interface ResearchProviderUsageEvent {
  provider: "openrouter" | "tavily";
  operation: "synthesis" | "search";
  runId: string;
  entityKind: "account" | "prospect";
  entityId?: string;
  dimensionKey?: string;
  requestId?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  upstreamInferenceCostUsd?: number;
  providerCredits?: number;
}

/**
 * Opt-in/local measurement sink for provider accounting returned by research APIs.
 * Production remains stdout/telemetry-only unless an explicit capture path is set.
 */
export async function captureResearchProviderUsage(
  event: ResearchProviderUsageEvent,
): Promise<void> {
  const configuredPath = process.env.OUTREACH_PROVIDER_USAGE_CAPTURE_FILE?.trim();
  if (!configuredPath && process.env.NODE_ENV !== "development") return;
  const path = configuredPath || LOCAL_RESEARCH_USAGE_FILE;
  try {
    await appendFile(path, `${JSON.stringify({ capturedAt: new Date().toISOString(), ...event })}\n`, "utf8");
  } catch {
    // Usage capture must never turn an already-billed provider response into a
    // failed research operation. The account-level provider delta remains the
    // fallback measurement when this optional local sink is unavailable.
  }
}
