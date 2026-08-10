import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import {
  API_RESOURCE_URL,
  auth,
  getApiAuthorizationContext,
  getMcpAuthorizationContext,
  MCP_RESOURCE_URL,
} from "../server";
import { authPool } from "../database";

const enabled = process.env.RUN_MCP_OAUTH_INTEGRATION_TESTS === "1";
const baseUrl = process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3111";
const password = process.env.AUTH_SEED_PASSWORD ?? "ContentAutomation123!";

type JsonObject = Record<string, unknown>;
type Membership = { id: string; organizationId: string; userId: string; role: string };

function cookieValue(response: Response) {
  return response.headers.getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
}

async function json(response: Response) {
  const value = await response.json() as JsonObject;
  if (!response.ok) throw new Error(`Request failed (${response.status}): ${JSON.stringify(value)}`);
  return value;
}

function handlerServer() {
  return createServer(async (incoming, outgoing) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value)) value.forEach((entry) => headers.append(name, entry));
        else if (value !== undefined) headers.set(name, value);
      }
      const request = new Request(new URL(incoming.url ?? "/", baseUrl), {
        method: incoming.method,
        headers,
        body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
      });
      const response = await auth.handler(request);
      outgoing.statusCode = response.status;
      response.headers.forEach((value, name) => {
        if (name !== "set-cookie") outgoing.setHeader(name, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) outgoing.setHeader("set-cookie", cookies);
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (cause) {
      outgoing.statusCode = 500;
      outgoing.end(JSON.stringify({ error: cause instanceof Error ? cause.message : "Unknown error" }));
    }
  });
}

async function listen(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number(new URL(baseUrl).port), new URL(baseUrl).hostname, resolve);
  });
}

async function close(server: Server) {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function request(path: string, init: RequestInit = {}) {
  return fetch(new URL(path, baseUrl), { ...init, redirect: "manual" });
}

async function verifyCallRecordingClient(activeCookie: string, membership: Membership) {
  const clientId = "taicho-call-recording-native-v1";
  const redirectUri = "http://127.0.0.1:38123/oauth/callback";
  const scope = "openid profile email offline_access vn:outreach:read vn:outreach:write";
  const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(48))).toString("base64url");
  const challenge = Buffer.from(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  ).toString("base64url");
  const authorize = new URL("/api/auth/oauth2/authorize", baseUrl);
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", scope);
  authorize.searchParams.set("state", "call-recording-pkce-state");
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");
  authorize.searchParams.set("resource", API_RESOURCE_URL);

  const authorization = await fetch(authorize, {
    headers: { Cookie: activeCookie },
    redirect: "manual",
  });
  assert.ok(authorization.status === 200 || authorization.status === 302);
  const consentLocation = authorization.status === 302
    ? authorization.headers.get("location")
    : String((await authorization.json() as JsonObject).url ?? "");
  assert.ok(consentLocation?.startsWith("/oauth/consent?") || consentLocation?.startsWith(`${baseUrl}/oauth/consent?`));
  const consentQuery = new URL(consentLocation!, baseUrl).search.slice(1);

  const consent = await json(await request("/api/auth/oauth2/consent", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: activeCookie, Origin: baseUrl },
    body: JSON.stringify({ accept: true, scope, oauth_query: consentQuery }),
  }));
  const callback = new URL(String(consent.url));
  assert.equal(`${callback.protocol}//${callback.host}${callback.pathname}`, redirectUri);
  assert.equal(callback.searchParams.get("state"), "call-recording-pkce-state");
  const code = callback.searchParams.get("code");
  assert.ok(code);

  const token = await json(await request("/api/auth/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      resource: API_RESOURCE_URL,
    }),
  }));
  assert.equal(token.token_type, "Bearer");
  assert.ok(typeof token.access_token === "string");
  assert.ok(typeof token.refresh_token === "string");

  const context = await getApiAuthorizationContext(
    new Headers({ Authorization: `Bearer ${token.access_token}` }),
  );
  assert.equal(context.organizationId, membership.organizationId);
  assert.equal(context.actor.type, "user");
  assert.equal(context.actor.userId, membership.userId);
  assert.deepEqual(
    [...context.scopes].sort(),
    ["vn:outreach:read", "vn:outreach:write"],
  );
}

test("OAuth PKCE binds Taicho identity for first-party and dynamically registered clients", { skip: !enabled }, async () => {
  const server = handlerServer();
  await listen(server);
  let membership: Membership | undefined;
  try {
    const suffix = crypto.randomUUID().slice(0, 12);
    const email = `mcp-pkce-${suffix}@local.test`;
    const signUp = await request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({ name: "MCP PKCE Verification", email, password }),
    });
    assert.equal(signUp.status, 200);
    const signUpCookie = cookieValue(signUp);
    assert.ok(signUpCookie.includes("better-auth.session_token="));

    const organization = await json(await request("/api/auth/organization/create", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: signUpCookie, Origin: baseUrl },
      body: JSON.stringify({
        name: "MCP PKCE Verification",
        slug: `mcp-pkce-${suffix}`,
      }),
    }));
    const organizationId = String(organization.id);
    assert.ok(organizationId);

    const signIn = await request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(signIn.status, 200);
    const cookie = cookieValue(signIn);
    assert.ok(cookie.includes("better-auth.session_token="));

    membership = (await authPool.query(
      `SELECT id, "organizationId" AS "organizationId", "userId" AS "userId", role
         FROM member
        WHERE "userId"=(SELECT id FROM "user" WHERE email=$1)
          AND "organizationId"=$2
        LIMIT 1`,
      [email, organizationId],
    )).rows[0] as Membership | undefined;
    assert.ok(membership);

    const active = await request("/api/auth/organization/set-active", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie, Origin: baseUrl },
      body: JSON.stringify({ organizationId: membership.organizationId }),
    });
    assert.equal(active.status, 200);
    const activeCookie = [cookie, cookieValue(active)].filter(Boolean).join("; ");

    await verifyCallRecordingClient(activeCookie, membership);

    const scope = "openid profile email offline_access vn:read";
    const redirectUri = "http://127.0.0.1:3112/oauth/callback";
    const registered = await json(await request("/api/auth/oauth2/register", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: activeCookie, Origin: baseUrl },
      body: JSON.stringify({
        redirect_uris: [redirectUri],
        scope,
        client_name: "PKCE integration verification",
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        type: "native",
      }),
    }));
    const clientId = String(registered.client_id);
    assert.ok(clientId);

    const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(48))).toString("base64url");
    const challenge = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))).toString("base64url");
    const authorize = new URL("/api/auth/oauth2/authorize", baseUrl);
    authorize.searchParams.set("client_id", clientId);
    authorize.searchParams.set("redirect_uri", redirectUri);
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("scope", scope);
    authorize.searchParams.set("state", "pkce-state");
    authorize.searchParams.set("code_challenge", challenge);
    authorize.searchParams.set("code_challenge_method", "S256");
    authorize.searchParams.set("resource", MCP_RESOURCE_URL);

    const authorization = await fetch(authorize, { headers: { Cookie: activeCookie }, redirect: "manual" });
    assert.ok(authorization.status === 200 || authorization.status === 302);
    const consentLocation = authorization.status === 302
      ? authorization.headers.get("location")
      : String((await authorization.json() as JsonObject).url ?? "");
    assert.ok(consentLocation?.startsWith("/oauth/consent?") || consentLocation?.startsWith(`${baseUrl}/oauth/consent?`));
    const consentQuery = new URL(consentLocation!, baseUrl).search.slice(1);

    const consent = await json(await request("/api/auth/oauth2/consent", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: activeCookie, Origin: baseUrl },
      body: JSON.stringify({ accept: true, scope, oauth_query: consentQuery }),
    }));
    const callback = new URL(String(consent.url));
    assert.equal(callback.origin + callback.pathname, redirectUri);
    assert.equal(callback.searchParams.get("state"), "pkce-state");
    const code = callback.searchParams.get("code");
    assert.ok(code);

    const token = await json(await request("/api/auth/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
        resource: MCP_RESOURCE_URL,
      }),
    }));
    assert.equal(token.token_type, "Bearer");
    assert.ok(typeof token.access_token === "string");
    assert.ok(typeof token.refresh_token === "string");

    const context = await getMcpAuthorizationContext(new Headers({ Authorization: `Bearer ${token.access_token}` }));
    assert.equal(context.organizationId, membership.organizationId);
    assert.equal(context.actor.type, "user");
    assert.equal(context.actor.userId, membership.userId);
    assert.deepEqual(context.scopes, ["vn:read"]);
    await assert.rejects(
      getApiAuthorizationContext(new Headers({ Authorization: `Bearer ${token.access_token}` })),
      /valid API access token/i,
    );

    const refreshed = await json(await request("/api/auth/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: String(token.refresh_token),
        resource: MCP_RESOURCE_URL,
      }),
    }));
    assert.ok(typeof refreshed.access_token === "string");
    assert.ok(typeof refreshed.refresh_token === "string");
    assert.notEqual(refreshed.refresh_token, token.refresh_token);

    const replay = await request("/api/auth/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: String(token.refresh_token),
        resource: MCP_RESOURCE_URL,
      }),
    });
    assert.equal(replay.status, 400);

    await authPool.query(`DELETE FROM member WHERE id=$1`, [membership.id]);
    await assert.rejects(
      getMcpAuthorizationContext(new Headers({ Authorization: `Bearer ${refreshed.access_token}` })),
      /membership is no longer active/i,
    );
  } finally {
    await close(server);
    await authPool.end();
  }
});
