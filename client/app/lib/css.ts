import type { CSSProperties } from 'react';

/** CSSProperties that also allows CSS custom properties (e.g. `--pod-hue`). */
export type CSSVars = CSSProperties & { [key: `--${string}`]: string | number };
