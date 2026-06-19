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
  disabled?: boolean;
  onClick?: () => void;
  style?: CSSProperties;
}

export function Button({ children, variant = 'primary', size = 'md', icon, full, disabled, onClick, style = {} }: ButtonProps) {
  return (
    <button
      type="button"
      className={`v-btn v-btn-${variant} v-btn-${size}${full ? ' v-btn-full' : ''}`}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      style={disabled ? { opacity: 0.5, ...style } : style}
    >
      {icon && <Icon name={icon} size={size === 'sm' ? 16 : 19} />}
      {children && <span>{children}</span>}
    </button>
  );
}
