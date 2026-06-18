import type { CSSVars } from '../../lib/css';

export interface AvatarProps {
  hue?: number;
  size?: number;
  label?: string;
  ring?: boolean;
}

/** Stylized capsule character. */
export function Avatar({ hue = 184, size = 64, label, ring = false }: AvatarProps) {
  return (
    <div className="v-avatar-wrap" style={{ width: size, height: size }}>
      {ring && <div className="v-avatar-ring" />}
      <div className="v-avatar" style={{ '--av-hue': hue } as CSSVars}>
        <div className="v-avatar-head" />
        <div className="v-avatar-body" />
      </div>
      {label && <div className="v-avatar-tag v-mono">{label}</div>}
    </div>
  );
}
