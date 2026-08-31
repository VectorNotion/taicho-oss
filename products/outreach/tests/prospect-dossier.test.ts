import assert from "node:assert/strict";
import test from "node:test";
import {
  qualificationIsStale,
  qualificationNarrative,
  researchFreshness,
} from "../domain/prospect-dossier";
import type { DimensionDefinition, ObservationRecord } from "../domain/qualification";

const NOW = new Date("2026-08-15T12:00:00.000Z");

function dimension(key: string, freshnessWindowDays = 30): DimensionDefinition {
  return {
    id: key,
    key,
    name: key,
    dimensionType: "fit",
    appliesTo: "prospect",
    researchInstruction: key,
    idealValue: key,
    weight: 1,
    freshnessWindowDays,
    isActive: true,
    createdAt: NOW.toISOString(),
  };
}

function observation(dimensionKey: string, researchedAt: string): ObservationRecord {
  return {
    id: dimensionKey,
    dimensionKey,
    shape: "prose",
    observedValue: "evidence",
    evidence: [],
    confidence: 1,
    researchedAt,
    runId: "run-1",
  };
}

test("research freshness makes missing, partial, stale, and fresh scopes explicit", () => {
  const dimensions = [dimension("authority"), dimension("ownership")];
  assert.equal(researchFreshness(dimensions, [], NOW).status, "missing");

  const partial = researchFreshness(
    dimensions,
    [observation("authority", "2026-08-14T12:00:00.000Z")],
    NOW,
  );
  assert.equal(partial.status, "partial");
  assert.deepEqual(partial.missingDimensionKeys, ["ownership"]);

  const stale = researchFreshness(
    dimensions,
    dimensions.map(({ key }) => observation(key, "2026-06-01T12:00:00.000Z")),
    NOW,
  );
  assert.equal(stale.status, "stale");
  assert.deepEqual(stale.staleDimensionKeys, ["authority", "ownership"]);

  const fresh = researchFreshness(
    dimensions,
    dimensions.map(({ key }) => observation(key, "2026-08-14T12:00:00.000Z")),
    NOW,
  );
  assert.equal(fresh.status, "fresh");
});

test("qualification narrative exposes both gates and makes timing non-gating", () => {
  const narrative = qualificationNarrative({
    qualification: {
      status: "CONTACT_DISCOVERY_REQUIRED",
      icpScore: 90,
      personaScore: 30,
      timingScore: 99,
      icpMatches: [],
      personaMatches: [],
      timingBreakdown: [],
      computedAt: NOW.toISOString(),
    },
    icpScore: 90,
    personaScore: 30,
    timingScore: 99,
  });
  assert.match(narrative.explanation, /Company fit is 90\/100 \(minimum 70\)/);
  assert.match(narrative.explanation, /person fit is 30\/100 \(minimum 65\)/);
  assert.match(narrative.explanation, /timing.*ranks urgency without changing the qualification gate/);
  assert.match(narrative.recommendedAction, /research a better-matched person/);
});

test("a decision is stale when either independent score is newer", () => {
  assert.equal(qualificationIsStale("2026-08-10T00:00:00.000Z", ["2026-08-11T00:00:00.000Z"]), true);
  assert.equal(qualificationIsStale("2026-08-12T00:00:00.000Z", ["2026-08-11T00:00:00.000Z"]), false);
});

test("a targeting-policy edit stays stale until the affected research score is refreshed", () => {
  assert.equal(qualificationIsStale(
    "2026-08-12T00:00:00.000Z",
    ["2026-08-10T00:00:00.000Z", "2026-08-10T00:00:00.000Z"],
    ["2026-08-11T00:00:00.000Z"],
  ), true);
  assert.equal(qualificationIsStale(
    "2026-08-13T00:00:00.000Z",
    ["2026-08-12T00:00:00.000Z", "2026-08-12T00:00:00.000Z"],
    ["2026-08-11T00:00:00.000Z"],
  ), false);
});

test("timezone-less graph policy timestamps are compared as UTC", () => {
  assert.equal(qualificationIsStale(
    "2026-08-27T10:47:42.000Z",
    ["2026-08-27T10:47:42.000Z"],
    ["2026-08-27T10:47:45.000000000"],
  ), true);
});
