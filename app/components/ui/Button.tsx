import type { CSSProperties, ReactNode } from 'react';
import { Icon } from './Icon';

export type ButtonVariant = 'primary' | 'soft' | 'ghost-d';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  children?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: string;
  full?: boolean;
  onClick?: () => void;
  style?: CSSProperties;
}

export function Button({ children, variant = 'primary', size = 'md', icon, full, onClick, style = {} }: ButtonProps) {
  return (
    <button className={`v-btn v-btn-${variant} v-btn-${size}${full ? ' v-btn-full' : ''}`} onClick={onClick} style={style}>
      {icon && <Icon name={icon} size={size === 'sm' ? 16 : 19} />}
      {children && <span>{children}</span>}
    </button>
  );
}
