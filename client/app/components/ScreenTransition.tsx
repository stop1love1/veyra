'use client';
// Spatial screen transition primitive.
//
// Wraps the active screen and, on every navigation (driven by the `nav` signal
// the hook returns alongside `g` from go()/back()), plays a directional spatial
// move — push/slide + subtle scale +
// a brand-glass veil sweep — so moving between screens feels like moving through
// Veyra rather than a hard router cut.
//
// Design notes:
// - Only ONE screen is mounted at a time (the heavy World3D/Store3D screens each
//   spin up a three.js context — double-mounting would be wasteful/janky). The
//   incoming screen runs an enter keyframe; a separate veil layer covers the cut.
// - No per-frame state: a single keyframe + one timer per navigation.
// - Reduced-motion / lite users get a ~120ms plain fade, no large motion or veil.
import React from 'react';
import type { NavSignal, ScreenName } from '../lib/game/types';

type Variant = 'fade' | 'push' | 'pull' | 'door';

const VEIL_MS = 420;

/** Pick a transition variant from the from→to pair + direction. */
function pickVariant(nav: NavSignal): Variant {
  const { from, to, dir } = nav;
  if (from == null) return 'fade'; // first paint / restored session
  // Gate's own walk-through already fades via .v-gate-fade — keep it soft.
  if (from === 'gate' || to === 'gate') return 'fade';
  // Entering a shop or finishing an order = a "doorway" push into depth.
  const doorway = (a: ScreenName | null, b: ScreenName) =>
    (a === 'world' && b === 'store') || b === 'success';
  if (dir === 'forward' && doorway(from, to)) return 'door';
  // Pulling back out (store→world, or any back nav) recedes.
  if (dir === 'back') return 'pull';
  return 'push';
}

export interface ScreenTransitionProps {
  nav: NavSignal;
  /** When true (lite mode or reduced-motion), use the minimal fade. */
  reduced?: boolean;
  children: React.ReactNode;
}

export function ScreenTransition({ nav, reduced, children }: ScreenTransitionProps) {
  const [veil, setVeil] = React.useState<{ key: number; variant: Variant } | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const variant: Variant = reduced ? 'fade' : pickVariant(nav);

  // Drive the veil sweep off the nav key. The screen layer animates purely from
  // its `key`/class (CSS), so this effect only manages the cover layer + cleanup.
  React.useEffect(() => {
    if (nav.key === 0 || variant === 'fade') return; // no veil for first paint / minimal fade
    setVeil({ key: nav.key, variant });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setVeil(null), VEIL_MS);
  }, [nav.key, variant]);

  React.useEffect(() => () => clearTimeout(timer.current), []);

  const dirClass = nav.dir === 'back' ? 'is-back' : 'is-fwd';
  const screenClass = `v-xs v-xs-${variant} ${dirClass}`;

  return (
    <div className="v-xs-host">
      {/* Re-key on every navigation so the enter keyframe restarts. */}
      <div key={nav.key} className={screenClass}>
        {children}
      </div>
      {veil && <div key={'veil-' + veil.key} className={`v-xs-veil v-xs-veil-${veil.variant} ${dirClass}`} aria-hidden="true" />}
    </div>
  );
}
