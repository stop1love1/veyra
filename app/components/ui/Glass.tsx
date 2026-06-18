import type { HTMLAttributes } from 'react';

export interface GlassProps extends HTMLAttributes<HTMLDivElement> {
  dark?: boolean;
}

/** Frosted glass panel. */
export function Glass({ children, dark = false, className = '', ...rest }: GlassProps) {
  return (
    <div className={'v-glass ' + (dark ? 'v-glass-d ' : '') + className} {...rest}>
      {children}
    </div>
  );
}
