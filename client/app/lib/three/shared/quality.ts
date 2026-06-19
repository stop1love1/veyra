// @ts-nocheck -- device tier detection + adaptive quality config

/**
 * Detect a coarse device performance tier and derive an adaptive quality
 * config from it. Pure / deterministic: only reads `navigator`, `window`
 * and (optionally) the passed `renderer`. All browser globals are guarded
 * so this never throws if ever evaluated outside a DOM.
 *
 * @param {THREE.WebGLRenderer} [renderer] optional, lets us read GPU caps.
 * @returns quality config consumed by the engines.
 */
export function detectQuality(renderer) {
  const hasNav = typeof navigator !== 'undefined';
  const hasWin = typeof window !== 'undefined';

  // --- gather raw signals (with safe fallbacks) -------------------------
  const cores = hasNav && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
  // deviceMemory is non-standard / often undefined (Safari, Firefox).
  const memory = hasNav && navigator.deviceMemory ? navigator.deviceMemory : undefined;
  const dpr = hasWin && window.devicePixelRatio ? window.devicePixelRatio : 1;

  const mm = (q) => (hasWin && typeof window.matchMedia === 'function' ? window.matchMedia(q).matches : false);

  // Mobile / touch signal: coarse pointer or any touch points.
  const coarse = mm('(pointer: coarse)') || (hasNav && navigator.maxTouchPoints > 0);

  // Accessibility: respect reduced-motion by forcing the cheapest tier.
  const reducedMotion = mm('(prefers-reduced-motion: reduce)');

  // GPU caps (only when a renderer is supplied).
  const maxTextureSize = renderer?.capabilities?.maxTextureSize ?? 0;
  const isWebGL2 = renderer?.capabilities?.isWebGL2 ?? true; // assume WebGL2 when unknown

  // --- decide tier ------------------------------------------------------
  // Thresholds are explicit & intentionally conservative; default to 'mid'
  // whenever the signals are ambiguous/unknown.
  let tier;

  if (reducedMotion) {
    // Hard override regardless of hardware.
    tier = 'low';
  } else if (
    // HIGH: a capable desktop. >=8 logical cores, >=8GB RAM (when known),
    // not a coarse/touch primary input, WebGL2, and a roomy texture budget
    // (only checked when a renderer was passed).
    cores >= 8 &&
    (memory === undefined || memory >= 8) &&
    !coarse &&
    isWebGL2 &&
    (maxTextureSize === 0 || maxTextureSize >= 8192)
  ) {
    tier = 'high';
  } else if (
    // LOW: clearly weak hardware. Few cores, tiny memory, or an old mobile
    // GPU exposing a small max texture size, or no WebGL2 at all.
    cores <= 4 ||
    (memory !== undefined && memory <= 2) ||
    !isWebGL2 ||
    (coarse && maxTextureSize > 0 && maxTextureSize < 4096)
  ) {
    tier = 'low';
  } else {
    // MID: everything in between, and the safe default for unknown signals
    // (typical mid mobile / modest laptop).
    tier = 'mid';
  }

  // --- map tier -> quality config --------------------------------------
  const maxPixelRatio = tier === 'high' ? 2 : tier === 'mid' ? 1.5 : 1;

  return {
    tier,
    maxPixelRatio,
    pixelRatio: Math.min(dpr || 1, maxPixelRatio),
    shadowMapSize: tier === 'high' ? 2048 : tier === 'mid' ? 1024 : 0, // 0 = shadows off
    enablePost: tier !== 'low', // no EffectComposer on low
    enableSSAO: tier === 'high', // SSAO is expensive: high only
    enableBloom: tier !== 'low', // bloom on high + mid
    anisotropy: tier === 'high' ? 8 : tier === 'mid' ? 4 : 1,
    propDensity: tier === 'high' ? 1 : tier === 'mid' ? 0.6 : 0.35,
  };
}

/**
 * Apply the parts of a quality config that belong to the renderer itself.
 * Kept separate so `detectQuality` stays pure.
 */
export function applyQualityToRenderer(renderer, q) {
  if (!renderer) return;
  renderer.setPixelRatio(q.pixelRatio);
  renderer.shadowMap.enabled = q.shadowMapSize > 0;
}
