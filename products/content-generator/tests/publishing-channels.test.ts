import assert from "node:assert/strict";
import test from "node:test";
import {
  isValidPublishingHttpUrl,
  publishingChannelInputSchema,
} from "../publishing/channel-config";
import {
  decodePublishingOAuthState,
  encodePublishingOAuthState,
} from "../publishing/oauth/state";

test("publishing channel configuration accepts only destination-specific HTTP credentials", () => {
  assert.equal(isValidPublishingHttpUrl("https://cms.example.test"), true);
  assert.equal(isValidPublishingHttpUrl("http://localhost:4318/hooks/content"), true);
  assert.equal(isValidPublishingHttpUrl("not a url"), false);
  assert.equal(isValidPublishingHttpUrl("file:///tmp/content"), false);

  assert.equal(publishingChannelInputSchema.safeParse({
    destination: "cms",
    name: "Company blog",
    credentials: { base_url: "https://cms.example.test", api_key: "secret" },
  }).success, true);
  assert.equal(publishingChannelInputSchema.safeParse({
    destination: "webhook",
    name: "Internal pipeline",
    credentials: { url: "javascript:alert(1)", secret: "secret" },
  }).success, false);
  assert.equal(publishingChannelInputSchema.safeParse({
    destination: "cms",
    name: "Wrong credential shape",
    credentials: { url: "https://cms.example.test", secret: "secret" },
  }).success, false);
});

test("publishing OAuth state round-trips workspace and destination binding", () => {
  const state = {
    nonce: "browser-qa-nonce",
    organizationId: "organization-a",
    destination: "youtube",
  };
  assert.deepEqual(decodePublishingOAuthState(encodePublishingOAuthState(state)), state);
  assert.equal(decodePublishingOAuthState("not-base64-json"), null);
  assert.equal(decodePublishingOAuthState(encodePublishingOAuthState({ ...state, nonce: "" })), null);
});
