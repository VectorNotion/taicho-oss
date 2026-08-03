/** All force/LOD/animation tuning in one place (spec §Physics, §Semantic zoom). */
export const PHYS = {
  charge: -160,
  linkDistance: 86,
  linkStrength: 0.25,
  collidePad: 6,
  clusterStrength: 0.03,
  alphaDecay: 0.02,
  reheatAlpha: 0.5,
  /** Damping: higher = drags feel local, distant nodes settle fast. */
  velocityDecay: 0.6,
  /** Gentle simmer while a node is held; 0 on release. */
  dragAlphaTarget: 0.12,
} as const;

export const LOD = {
  zoomMin: 0.3,
  zoomMax: 3,
  farK: 0.55,       // below: constellation mode
  detailK: 0.9,     // default zoom and above: all labels
  majorLabelR: 11,   // mid mode: label nodes with r >= this
  farNodeR: 12,     // far mode: draw only nodes with r >= this
} as const;

/** Label lengths: full text is reserved for the clicked/hovered node. */
export const LABEL = {
  stub: 14,
  /** Trail chips truncate harder and show at most this many hops. */
  trailStub: 18,
  trailMax: 3,
} as const;

export const ANIM = {
  entranceMs: 450,
  flyMs: 600,
  dimAlpha: 0.12,
  edgeAlpha: 0.22,
  focusEdgeAlpha: 0.65,
} as const;
