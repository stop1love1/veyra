import { Eyebrow, Btn, Avatar } from '../../components/ui';
import { LangChip } from '../../components/hud';
import type { Game } from '../../lib/game/types';
import type { CSSVars } from '../../lib/css';

export function SplashScreen({ g }: { g: Game }) {
  return (
    <div className="v-screen v-splash">
      <div className="v-splash-sky" />
      <div className="v-splash-glow" />
      <div className="v-topsafe" />
      <div className="v-splash-body">
        <Eyebrow>IMMERSIVE COMMERCE</Eyebrow>
        <h1 className="v-splash-logo">{g.t('appName')}</h1>
        <p className="v-splash-tag">{g.t('tagline')}</p>

        <div className="v-splash-art">
          <div className="v-pod v-pod-float" style={{ '--pod-hue': 184 } as CSSVars}>
            <div className="v-pod-roof" /><div className="v-pod-body" /><div className="v-pod-door" />
          </div>
          <Avatar hue={g.player.hue} size={86} ring />
          <div className="v-pod v-pod-float v-pod-sm" style={{ '--pod-hue': 150, animationDelay: '.6s' } as CSSVars}>
            <div className="v-pod-roof" /><div className="v-pod-body" /><div className="v-pod-door" />
          </div>
        </div>
      </div>

      <div className="v-splash-actions">
        <Btn variant="primary" size="lg" full icon="spark" onClick={() => g.go('create')}>{g.t('createChar')}</Btn>
        <Btn variant="ghost-d" size="lg" full onClick={() => g.go('world')}>{g.t('guest')}</Btn>
      </div>
      <LangChip g={g} dark />
    </div>
  );
}
