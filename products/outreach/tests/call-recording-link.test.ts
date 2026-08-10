import assert from "node:assert/strict";
import test from "node:test";

import { callRecordingProspectUrl } from "../ui/call-recording-link";

test("builds only the supported prospect-selection deep link", () => {
  assert.equal(
    callRecordingProspectUrl("38C32F4D-6715-43B1-8F65-94A0209BCF9C"),
    "taicho-call-recording://prospect/38c32f4d-6715-43b1-8f65-94a0209bcf9c",
  );
  assert.equal(callRecordingProspectUrl("not-a-prospect"), undefined);
  assert.equal(
    callRecordingProspectUrl("0198a10c-7d4d-7a39-a4db-d547d7eac529"),
    "taicho-call-recording://prospect/0198a10c-7d4d-7a39-a4db-d547d7eac529",
  );
  assert.equal(
    callRecordingProspectUrl("38c32f4d-6715-43b1-8f65-94a0209bcf9c/../../other"),
    undefined,
  );
});
