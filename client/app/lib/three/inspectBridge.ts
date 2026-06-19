// Tiny module-level bridge between the 3D store engine (created inside
// StoreScreen) and the globally-rendered ProductPanel overlay. It lets the
// panel tell whether the active product was opened on the real 3D inspect path
// (so it can hide the 2D placeholder hero) and lets colour swatches retint the
// live inspected garment without threading refs through the React tree.
//
// Only the 3D store registers handlers; the lite / reduced-motion path leaves
// the bridge empty, so `isInspectActive()` is false and ProductPanel keeps its
// original 2D behaviour.

export interface InspectHandlers {
  setInspectColor: (hex: string) => void;
  endInspect: () => void;
}

let handlers: InspectHandlers | null = null;

/** Called by the 3D store while a product is being inspected. Pass null to clear. */
export function registerInspect(h: InspectHandlers | null): void {
  handlers = h;
}

/** True when the real 3D inspect path is driving the open product. */
export function isInspectActive(): boolean {
  return handlers != null;
}

/** Retint the live inspected garment, if the 3D inspect path is active. No-op otherwise. */
export function setInspectColor(hex: string): void {
  if (handlers) handlers.setInspectColor(hex);
}

/** Tween the inspected garment back out, if the 3D inspect path is active. No-op otherwise. */
export function endInspect(): void {
  if (handlers) handlers.endInspect();
}
