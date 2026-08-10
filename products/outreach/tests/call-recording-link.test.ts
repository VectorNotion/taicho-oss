import assert from "node:assert/strict";
import test from "node:test";

import { callRecordingLeadUrl } from "../ui/call-recording-link";

test("builds only the supported lead-selection deep link", () => {
  assert.equal(
    callRecordingLeadUrl("38C32F4D-6715-43B1-8F65-94A0209BCF9C"),
    "taicho-call-recording://lead/38c32f4d-6715-43b1-8f65-94a0209bcf9c",
  );
  assert.equal(callRecordingLeadUrl("not-a-lead"), undefined);
  assert.equal(
    callRecordingLeadUrl("0198a10c-7d4d-7a39-a4db-d547d7eac529"),
    "taicho-call-recording://lead/0198a10c-7d4d-7a39-a4db-d547d7eac529",
  );
  assert.equal(
    callRecordingLeadUrl("38c32f4d-6715-43b1-8f65-94a0209bcf9c/../../other"),
    undefined,
  );
});
