import { roleHasPermission } from "@content-automation/auth/permissions";
import { z } from "zod";
import { withOrgScope } from "@/lib/prospect-scope";
import {
  getOutreachPromptWorkspace,
  publishOutreachPromptDraft,
  saveOutreachPromptDraft,
} from "@/products/outreach/data/outreach-prompt-repository";

const contentSchema = z.object({
  systemInstructions: z.string().min(1).max(20_000),
  mediumTemplates: z.object({
    inmail: z.string().min(1).max(20_000),
    inmail_traditional: z.string().min(1).max(20_000),
    email: z.string().min(1).max(20_000),
    content_comment: z.string().min(1).max(20_000),
  }),
});

function canConfigure(role: string): boolean {
  return roleHasPermission(role, "outreach", "delete");
}

export async function GET(request: Request) {
  return withOrgScope(request, async (context) => Response.json({
    workspace: await getOutreachPromptWorkspace(),
    canEdit: canConfigure(context.role),
  }));
}

export async function PUT(request: Request) {
  return withOrgScope(request, async (context) => {
    if (!canConfigure(context.role)) {
      return Response.json({ error: "Only Outreach managers and workspace administrators can change prompts." }, { status: 403 });
    }
    const parsed = contentSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ error: "The prompt configuration is invalid.", details: parsed.error.flatten() }, { status: 400 });
    }
    try {
      return Response.json({
        workspace: await saveOutreachPromptDraft(parsed.data, context.session.user.id),
        canEdit: true,
      });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Could not save the prompt draft." }, { status: 400 });
    }
  });
}

export async function POST(request: Request) {
  return withOrgScope(request, async (context) => {
    if (!canConfigure(context.role)) {
      return Response.json({ error: "Only Outreach managers and workspace administrators can publish prompts." }, { status: 403 });
    }
    try {
      return Response.json({
        workspace: await publishOutreachPromptDraft(context.session.user.id),
        canEdit: true,
      });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Could not publish the prompt draft." }, { status: 400 });
    }
  });
}
