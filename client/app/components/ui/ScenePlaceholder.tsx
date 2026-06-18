import { Icon } from './Icon';
import type { CSSVars } from '../../lib/css';

export interface ScenePlaceholderProps {
  label: string;
  hue?: number;
  h?: number;
  icon?: string;
  style?: CSSVars;
}

/** Striped scene placeholder with a mono caption. */
export function ScenePlaceholder({ label, hue = 184, h = 200, icon = 'spark', style = {} }: ScenePlaceholderProps) {
  return (
    <div className="v-scene-ph" style={{ height: h, '--ph-hue': hue, ...style } as CSSVars}>
      <div className="v-scene-ph-inner">
        <Icon name={icon} size={26} />
        <span className="v-mono">{label}</span>
      </div>
    </div>
  );
}
