import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { closeJobPools, getJobAdminPool } from "../jobs/pool";
import {
  getIngestToken,
  getOrCreateIngestToken,
  rotateIngestToken,
} from "../metrics/ingest-tokens";
import { verifyMetricsIngest } from "../metrics/ingest-verification";
import { signWebhookPayload } from "../network/signed-webhook";

const suffix = randomUUID().replaceAll("-", "");
const TEST_ORG = `ingest_test_${suffix}`;
const body = JSON.stringify({ publishedUrl: "https://example.com/p/1", metrics: { clicks: 3 } });

after(async () => {
  await getJobAdminPool()
    .query(`DELETE FROM metric_ingest_tokens WHERE organization_id = $1`, [TEST_ORG])
    .catch(() => undefined);
  await closeJobPools();
});

test("ingest token is stable per organization until rotated", async () => {
  const first = await getOrCreateIngestToken(TEST_ORG);
  const second = await getOrCreateIngestToken(TEST_ORG);
  assert.equal(first.token, second.token);
  const rotated = await rotateIngestToken(TEST_ORG);
  assert.notEqual(rotated.token, first.token);
  assert.equal(await getIngestToken(TEST_ORG), rotated.token);
  assert.equal(await getIngestToken(`absent_${suffix}`), null);
});

test("verifyMetricsIngest: valid signature accepted; tamper, replay, unknown org, rotation rejected", async () => {
  const { token } = await getOrCreateIngestToken(TEST_ORG);
  const signed = signWebhookPayload({ token, body, deliveryId: "d-1", timestamp: "1000" });
  const headers = {
    organizationId: TEST_ORG,
    timestamp: signed.timestamp,
    signature: signed.signature,
    deliveryId: signed.deliveryId,
  };

  // valid signature
  assert.deepEqual(await verifyMetricsIngest({ headers, body, now: 1000 }), {
    organizationId: TEST_ORG,
  });
  // bad signature: tampered body
  assert.equal(
    await verifyMetricsIngest({ headers, body: body.replace('"clicks":3', '"clicks":9999'), now: 1000 }),
    null,
  );
  // replay outside the 300 s window
  assert.equal(await verifyMetricsIngest({ headers, body, now: 1301 }), null);
  // unknown organization
  assert.equal(
    await verifyMetricsIngest({
      headers: { ...headers, organizationId: `absent_${suffix}` },
      body,
      now: 1000,
    }),
    null,
  );
  // malformed organization id never reaches the database
  assert.equal(
    await verifyMetricsIngest({
      headers: { ...headers, organizationId: "not valid!" },
      body,
      now: 1000,
    }),
    null,
  );
  // rotation invalidates previously signed requests
  await rotateIngestToken(TEST_ORG);
  assert.equal(await verifyMetricsIngest({ headers, body, now: 1000 }), null);
});
