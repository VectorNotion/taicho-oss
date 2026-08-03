export interface Arm {
  id: string;
  sends: number;
  interests: number;
}

/** Marsaglia–Tsang gamma sampler (shape < 1 boosted via the power trick). */
function sampleGamma(shape: number, rng: () => number): number {
  if (shape < 1) {
    const u = rng() || 1e-12;
    return sampleGamma(shape + 1, rng) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      // Box–Muller standard normal from two uniforms
      const u1 = rng() || 1e-12;
      const u2 = rng();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng() || 1e-12;
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

function sampleBeta(alpha: number, beta: number, rng: () => number): number {
  const x = sampleGamma(alpha, rng);
  const y = sampleGamma(beta, rng);
  return x / (x + y);
}

/**
 * Thompson sampling over interest-per-send: sample Beta(1 + interests,
 * 1 + sends - interests) per arm and pick the max. Explores evenly while
 * data is thin, concentrates traffic on winners as evidence accumulates.
 * Deterministic and cheap — safe for the hot path (ADR 0001).
 */
export function thompsonPick(arms: Arm[], rng: () => number = Math.random): Arm {
  if (arms.length === 0) throw new Error("thompsonPick needs at least one arm");
  let best = arms[0];
  let bestSample = -1;
  for (const arm of arms) {
    const sample = sampleBeta(1 + arm.interests, 1 + Math.max(0, arm.sends - arm.interests), rng);
    if (sample > bestSample) {
      bestSample = sample;
      best = arm;
    }
  }
  return best;
}
