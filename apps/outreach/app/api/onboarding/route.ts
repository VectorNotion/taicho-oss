import { onboardCurrentUser } from "@content-automation/auth/server";

export async function POST(request: Request) {
  const result = await onboardCurrentUser(request.headers, ["outreach"]);
  return Response.json(result.status === 200 ? { organization: result.organization } : { error: result.error }, { status: result.status });
}
