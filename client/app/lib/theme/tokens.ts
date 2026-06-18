// Theme tokens applied to CSS custom properties at runtime.
import React from 'react';

export const THEME_DEFAULTS = {
  brand: '#15D6B4',
  font: 'Space Grotesk',
  radius: 26,
  game: 0.7,
  lite: false,
};

export type ThemeTokens = typeof THEME_DEFAULTS;

/** Push theme tokens onto the document root as CSS variables. */
export function useThemeTokens(tokens: ThemeTokens = THEME_DEFAULTS): void {
  React.useEffect(() => {
    const r = document.documentElement.style;
    r.setProperty('--brand', tokens.brand);
    r.setProperty('--font-ui', `'${tokens.font}', system-ui, sans-serif`);
    r.setProperty('--radius', tokens.radius + 'px');
    r.setProperty('--radius-sm', Math.round(tokens.radius * 0.62) + 'px');
    r.setProperty('--glow', String(tokens.game));
  }, [tokens]);
}
