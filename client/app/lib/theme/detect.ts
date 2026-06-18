// Heuristic detection for "lite" mode (skip the heavy 3D world).
export function detectLite(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return true;

    const nav = navigator as Navigator & { deviceMemory?: number };
    const cores = nav.hardwareConcurrency ?? 8;
    const mem = nav.deviceMemory ?? 8;
    if (cores <= 4 || mem <= 4) return true;

    // No WebGL → must use the 2D fallback.
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;

    return false;
  } catch {
    return true;
  }
}
