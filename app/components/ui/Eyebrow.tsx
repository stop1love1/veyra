import type { ReactNode } from 'react';

export interface EyebrowProps {
  children: ReactNode;
}

export function Eyebrow({ children }: EyebrowProps) {
  return <div className="v-eyebrow v-mono">{children}</div>;
}
