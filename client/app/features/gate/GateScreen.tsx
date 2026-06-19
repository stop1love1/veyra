import React from 'react';
import { LangChip } from '../../components/hud';
import { createVeyraGate } from '../../lib/three/gate';
import { GuardDialogue } from './GuardDialogue';
import type { Game } from '../../lib/game/types';

type Phase = 'roam' | 'name' | 'look' | 'opened';

interface GateApi {
  dispose: () => void;
  setLook: (look: { hue: number; skin: number; style: string }) => void;
  openGate: () => void;
}

interface GateOpts {
  look: { hue: number; skin: number; style: string; name: string };
  onProximity: (atGuard: boolean) => void;
  onEnter: () => void;
  onReady?: () => void;
}

export function GateScreen({ g }: { g: Game }) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const api = React.useRef<GateApi | null>(null);
  const gRef = React.useRef(g); gRef.current = g;

  const [name, setName] = React.useState(g.player.name || 'Veyra');
  const [hue, setHue] = React.useState(g.player.hue != null ? g.player.hue : 184);
  const [skin, setSkin] = React.useState(g.player.skin != null ? g.player.skin : 1);
  const [style, setStyle] = React.useState(g.player.style || 'minimal');
  const [phase, setPhase] = React.useState<Phase>('roam');
  const [fade, setFade] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  const phaseRef = React.useRef<Phase>(phase); phaseRef.current = phase;

  // Mount the 3D gate once.
  React.useEffect(() => {
    if (!ref.current || api.current) return;
    api.current = createVeyraGate(ref.current, {
      look: { hue, skin, style, name },
      // Guard proximity opens / closes the diegetic conversation.
      onProximity: (atGuard: boolean) => {
        const cur = phaseRef.current;
        if (atGuard && cur === 'roam') setPhase('name');
        else if (!atGuard && (cur === 'name' || cur === 'look')) setPhase('roam');
      },
      // Fired once the player walks through the open gate on their own.
      onEnter: () => {
        setFade(true);
        setTimeout(() => gRef.current.go('world'), 900);
      },
      // Async GLB load: keep the loading indicator until the scene is built.
      onReady: () => setReady(true),
    } as GateOpts);
    return () => { if (api.current) { api.current.dispose(); api.current = null; } };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Live look updates while talking to the guard.
  React.useEffect(() => { api.current?.setLook({ hue, skin, style }); }, [hue, skin, style]);

  const onConfirm = () => {
    g.setPlayer({ name: name.trim() || 'Veyra', hue, skin, style });
    api.current?.openGate();
    setPhase('opened');
  };

  return (
    <div className="v-screen v-gate">
      <div className="v-3d-canvas" ref={ref} />
      {!ready && <div className="v-3d-loading v-mono">{g.t('loading')}</div>}

      <div className="v-gate-top">
        <span />
        <LangChip g={g} dark inline />
      </div>

      {phase === 'roam' && (
        <div className="v-gate-hint v-mono">
          {g.t('gateHintRoam')}
        </div>
      )}

      {phase === 'opened' && (
        <div className="v-gate-hint v-mono">
          {g.t('gateHintOpen')}
        </div>
      )}

      {(phase === 'name' || phase === 'look') && (
        <GuardDialogue
          g={g}
          step={phase}
          name={name} setName={setName}
          skin={skin} setSkin={setSkin}
          hue={hue} setHue={setHue}
          style={style} setStyle={setStyle}
          onNext={() => setPhase('look')}
          onConfirm={onConfirm}
        />
      )}

      <div className={'v-gate-fade' + (fade ? ' is-on' : '')} />
    </div>
  );
}
