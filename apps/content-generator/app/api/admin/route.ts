import { handleAdminRequest } from "@content-automation/auth/admin";

export async function GET(request: Request) {
  return handleAdminRequest(request);
}

export async function POST(request: Request) {
  return handleAdminRequest(request);
}
