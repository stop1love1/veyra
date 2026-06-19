// Lightweight DOM "fly to bag" effect for add-to-cart.
// Pure DOM/CSS — no per-frame React state, no three.js. Respects reduced-motion:
// when the user prefers reduced motion we skip the flight and only pop the bag.

const BAG_TARGET_ID = 'v-bag-target';
const POP_CLASS = 'is-pop';
const FLIGHT_MS = 620;
const POP_MS = 320;

// Module-level handles so rapid (spam) taps don't orphan chips/timers: each call
// finishes the previous flight before starting its own.
let flightTimer: ReturnType<typeof setTimeout> | undefined;
let activeChip: HTMLElement | undefined;

function endFlight(target?: HTMLElement): void {
  if (flightTimer !== undefined) {
    clearTimeout(flightTimer);
    flightTimer = undefined;
  }
  if (activeChip) {
    activeChip.remove();
    activeChip = undefined;
  }
  if (target) popBag(target);
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function popBag(target: HTMLElement): void {
  target.classList.remove(POP_CLASS);
  // Force reflow so re-adding the class restarts the keyframe.
  void target.offsetWidth;
  target.classList.add(POP_CLASS);
  window.setTimeout(() => target.classList.remove(POP_CLASS), POP_MS);
}

/**
 * Animate a small chip from `source` to the HUD bag indicator, then pop the bag.
 * Safe to call from any click handler; cleans up after itself.
 */
export function flyToBag(source: HTMLElement | null | undefined): void {
  if (typeof document === 'undefined') return;
  const target = document.getElementById(BAG_TARGET_ID);
  if (!target) return;

  // Resolve any in-flight chip from a previous (spam) tap before starting a new one.
  if (flightTimer !== undefined || activeChip) endFlight();

  if (!source || prefersReducedMotion()) {
    popBag(target);
    return;
  }

  const from = source.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  const x0 = from.left + from.width / 2;
  const y0 = from.top + from.height / 2;
  const x1 = to.left + to.width / 2;
  const y1 = to.top + to.height / 2;

  const chip = document.createElement('span');
  chip.className = 'v-fly-chip';
  chip.style.left = x0 + 'px';
  chip.style.top = y0 + 'px';
  document.body.appendChild(chip);
  activeChip = chip;

  // Arc the chip toward the bag, fading as it homes in.
  const dx = x1 - x0;
  const dy = y1 - y0;
  requestAnimationFrame(() => {
    chip.style.transition = `transform ${FLIGHT_MS}ms cubic-bezier(.5,-0.3,.4,1), opacity ${FLIGHT_MS}ms ease-in`;
    chip.style.transform = `translate(${dx}px, ${dy}px) scale(.35)`;
    chip.style.opacity = '0.2';
  });

  flightTimer = setTimeout(() => {
    flightTimer = undefined;
    endFlight(target);
  }, FLIGHT_MS);
}
