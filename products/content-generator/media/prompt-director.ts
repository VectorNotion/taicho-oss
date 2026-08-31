import { Agent } from "@mastra/core/agent";
import { registerObservedAgent } from "@content-automation/observability/ai";
import { routerModel } from "@content-automation/platform/agents/model";
import { traceable } from "@content-automation/observability";
import { z } from "zod";
import type { ContentIdea } from "../domain/content";
import { VISUAL_TYPE_LABELS, type VisualBrief } from "./templates";

const providerPromptSchema = z.string().trim().min(400).max(6_000);

export type MediaPromptGenerate = (args: {
  agentId: string;
  agentName: string;
  instructions: string;
  prompt: string;
  temperature: number;
}) => Promise<string>;

const defaultGenerate: MediaPromptGenerate = async ({
  agentId,
  agentName,
  instructions,
  prompt,
  temperature,
}) => {
  const agent = registerObservedAgent(new Agent({
    id: agentId,
    name: agentName,
    instructions,
    model: routerModel(),
  }), "taicho-content-agents");
  return traceable(
    async () => {
      const result = await agent.generate(prompt, {
        modelSettings: { temperature, maxOutputTokens: 4_096 },
      });
      return result.text;
    },
    {
      name: "content.media_prompt.generate",
      kind: "generation",
      processInputs: () => ({ agentId, agentName, instructions, prompt, temperature }),
    },
  )();
};

const VISUAL_DIRECTOR_INSTRUCTIONS = `You are a senior visual director and media-prompt engineer.

Turn a grounded Content Base and a compact user Visual Brief into one detailed prompt for an external image or video generation provider.

Rules:
- Use only facts, concepts, and relationships present in the supplied Content Base. Never invent statistics, product details, quotations, logos, or claims.
- Convert the source into a concrete visual story. Do not merely summarize or paste the source.
- Make the requested visual type materially affect the composition and visual language.
- Specify the primary subject, narrative emphasis, composition, spatial hierarchy, visual encodings, style, palette, lighting or material treatment, and output constraints.
- For an infographic, diagram, or data chart, choose the few source-grounded facts or steps that should be depicted and explain their layout, grouping, flow, icons, and relative emphasis.
- Avoid paragraphs of text inside generated media. Use only minimal, short labels when the visual type genuinely requires them.
- If the brief says exact copy will be added later, do not ask the provider to render that copy. Reserve a calm, high-contrast area for the application overlay.
- For video, describe a coherent five-second shot, camera behavior, subject motion, pacing, and final frame.
- Do not mention the Content Base, the user, an LLM, prompting, or these instructions in the provider prompt.
- Return only the production-ready prompt, without commentary, headings, quotation marks, or alternatives.`;

function contentBaseContext(base: ContentIdea): string {
  return [
    `Title: ${base.title}`,
    `Description: ${base.description}`,
    base.rationale ? `Rationale: ${base.rationale}` : "",
    base.outline?.length ? `Outline:\n${base.outline.map((point) => `- ${point}`).join("\n")}` : "",
    base.keyPoints?.length ? `Key points:\n${base.keyPoints.map((point) => `- ${point}`).join("\n")}` : "",
    base.sourceTopics?.length ? `Source topics:\n${base.sourceTopics.map((topic) => `- ${topic.name}`).join("\n")}` : "",
    base.sourceResearch?.length ? `Source research:\n${base.sourceResearch.map((research) => `- ${research.title}`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n").slice(0, 12_000);
}

function visualBriefContext(brief: VisualBrief): string {
  return [
    `Media kind: ${brief.kind}`,
    `Required visual type: ${VISUAL_TYPE_LABELS[brief.visualType]}`,
    brief.creativeDirection ? `User creative direction: ${brief.creativeDirection}` : "User creative direction: none supplied; derive an appropriate direction from the source.",
    brief.kind === "image" && brief.exactOnMediaText
      ? `Exact copy will be added later by the application: ${JSON.stringify(brief.exactOnMediaText)}. Reserve space for it but do not ask the provider to render it.`
      : "No application-owned text overlay was requested.",
  ].join("\n");
}

export async function generateProviderMediaPrompt(
  base: ContentIdea,
  brief: VisualBrief,
  generate: MediaPromptGenerate = defaultGenerate,
): Promise<string> {
  const result = await generate({
    agentId: "content-media-visual-director-agent",
    agentName: "Content Media Visual Director",
    instructions: VISUAL_DIRECTOR_INSTRUCTIONS,
    prompt: `Create the final provider prompt for this request.\n\n## Visual Brief\n${visualBriefContext(brief)}\n\n## Grounded source\n${contentBaseContext(base)}`,
    temperature: 0.55,
  });
  return providerPromptSchema.parse(result);
}
