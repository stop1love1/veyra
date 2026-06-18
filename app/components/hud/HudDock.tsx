import { Glass, Ic } from '../ui';
import type { Game } from '../../lib/game/types';

export interface HudDockProps {
  g: Game;
  active: string;
  onMap?: () => void;
  onQuest?: () => void;
  onCart?: () => void;
}

interface DockTab {
  id: string;
  icon: string;
  on: () => void;
  badge?: number;
}

export function HudDock({ g, active, onMap, onQuest, onCart }: HudDockProps) {
  const tabs: DockTab[] = [
    { id: 'map', icon: 'map', on: () => (onMap ? onMap() : g.go('world')) },
    { id: 'quest', icon: 'quest', on: () => (onQuest ? onQuest() : g.go('quests')) },
    { id: 'cart', icon: 'cart', on: () => (onCart ? onCart() : g.go('cart')), badge: g.cartCount },
  ];
  const labels: Record<string, string> = { map: g.t('map'), quest: g.t('quests'), cart: g.t('cart') };
  return (
    <div className="v-dock">
      <Glass dark className="v-dock-glass">
        {tabs.map((tb) => (
          <button key={tb.id} className={'v-dock-btn' + (active === tb.id ? ' is-on' : '')} onClick={tb.on}>
            <span className="v-dock-ic">
              <Ic name={tb.icon} size={22} />
              {tb.badge != null && tb.badge > 0 && <span className="v-dot">{tb.badge}</span>}
            </span>
            <span className="v-dock-lbl">{labels[tb.id]}</span>
          </button>
        ))}
      </Glass>
    </div>
  );
}
