import assert from "node:assert/strict";
import test from "node:test";
import { signToken, verifyToken } from "../engine/tokens";

test("token roundtrip preserves the payload", () => {
  const token = signToken({ t: "unsub", c: "abc-123" });
  assert.deepEqual(verifyToken(token), { t: "unsub", c: "abc-123" });
});

test("tampered tokens are rejected", () => {
  const token = signToken({ t: "open", s: "send-1" });
  const [body, sig] = token.split(".");
  const forgedBody = Buffer.from(JSON.stringify({ t: "open", s: "send-2" })).toString("base64url");
  assert.equal(verifyToken(`${forgedBody}.${sig}`), null);
  assert.equal(verifyToken(`${body}.AAAA`), null);
  assert.equal(verifyToken("garbage"), null);
});
