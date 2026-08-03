import assert from "node:assert/strict";
import test from "node:test";
import { thompsonPick } from "../engine/bandit";

test("concentrates on the arm with the higher interest rate", () => {
  const arms = [
    { id: "weak", sends: 1000, interests: 10 },
    { id: "strong", sends: 1000, interests: 100 },
  ];
  let strongPicks = 0;
  for (let i = 0; i < 500; i++) {
    if (thompsonPick(arms).id === "strong") strongPicks++;
  }
  assert.ok(strongPicks > 400, `strong arm picked ${strongPicks}/500, expected > 400`);
});

test("explores evenly with no data", () => {
  const arms = [
    { id: "a", sends: 0, interests: 0 },
    { id: "b", sends: 0, interests: 0 },
  ];
  const picks: Record<string, number> = { a: 0, b: 0 };
  for (let i = 0; i < 400; i++) picks[thompsonPick(arms).id]++;
  assert.ok(picks.a > 80 && picks.b > 80, `cold start split ${picks.a}/${picks.b}, expected both > 80`);
});

test("single arm and empty arms edge cases", () => {
  const only = { id: "solo", sends: 5, interests: 1 };
  assert.equal(thompsonPick([only]).id, "solo");
  assert.throws(() => thompsonPick([]), /at least one arm/);
});
