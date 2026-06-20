'use client';
// Veyra app shell: theme tokens, global state, screen routing and overlays.
import React from 'react';
import type { ComponentType } from 'react';
import { useGameState } from './lib/game';
import { useThemeTokens } from './lib/theme/tokens';
import { Ic } from './components/ui';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ScreenTransition } from './components/ScreenTransition';
import { NpcDialogue, ProductPanel, DiegeticPanel, RankUp, StreakReward, AuthModal } from './components/overlays';
import {
  GateScreen, SplashScreen, CreateScreen, WorldScreen, StoreScreen,
  CartScreen, CheckoutScreen, SuccessScreen, QuestsScreen, PassportScreen, SellerScreen,
  MapEditorScreen,
} from './features';
import type { Game, ScreenName } from './lib/game/types';

const SCREENS: Record<ScreenName, ComponentType<{ g: Game }>> = {
  gate: GateScreen,
  splash: SplashScreen,
  create: CreateScreen,
  world: WorldScreen,
  store: StoreScreen,
  cart: CartScreen,
  checkout: CheckoutScreen,
  success: SuccessScreen,
  quests: QuestsScreen,
  passport: PassportScreen,
  seller: SellerScreen,
  'admin-map': MapEditorScreen,
};

export default function App() {
  useThemeTokens();
  const { g, flash, nav } = useGameState();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  // The whole app is client-only (localStorage, WebGL, window); render after mount
  // to avoid SSR/hydration mismatches.
  if (!mounted) return null;

  const Screen = SCREENS[g.screen] || SplashScreen;

  return (
    <div className="v-root">
      <div className="v-stage">
        <div className="v-stage-scroll">
          <ErrorBoundary>
            <ScreenTransition nav={nav} reduced={g.lite}>
              <Screen g={g} />
            </ScreenTransition>
          </ErrorBoundary>
        </div>
        {g.npcOpen && <NpcDialogue g={g} />}
        {g.productOpen && <ProductPanel key={g.productOpen} g={g} />}
        {g.worldPanel && <DiegeticPanel g={g} type={g.worldPanel} />}
        {g.authOpen && <AuthModal g={g} />}
        {g.rankUp != null && <RankUp g={g} />}
        {g.streakReward != null && <StreakReward g={g} />}
        {flash && <div className="v-flash"><Ic name="check" size={16} /> {flash}</div>}
      </div>
    </div>
  );
}
