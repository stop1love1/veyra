import React from 'react';
import { VEYRA } from '../../data';
import { Ic, Avatar, ScenePlaceholder } from '../ui';
import type { Game } from '../../lib/game/types';
import type { NpcChip } from '../../data/types';

interface ChatMsg {
  from: 'npc' | 'me';
  text: string;
  picks?: string[];
}

export function NpcDialogue({ g }: { g: Game }) {
  const npc = VEYRA.NPCS[g.npcOpen!];
  const [msgs, setMsgs] = React.useState<ChatMsg[]>([{ from: 'npc', text: VEYRA.tx(npc.hello, g.lang) }]);
  const [done, setDone] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [msgs]);

  const pick = (chip: NpcChip) => {
    setMsgs((m) => [...m, { from: 'me', text: VEYRA.tx(chip, g.lang) }]);
    setTimeout(() => {
      setMsgs((m) => [...m, { from: 'npc', text: VEYRA.tx(chip.reply, g.lang), picks: chip.picks }]);
      setDone(true);
    }, 450);
  };

  // Real (local, canned) send: echo the user's message, then the advisor replies.
  const sendDraft = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    setMsgs((m) => [...m, { from: 'me', text }]);
    setTimeout(() => {
      setMsgs((m) => [...m, { from: 'npc', text: g.t('npcEcho'), picks: npc.picks?.length ? npc.picks : undefined }]);
      setDone(true);
    }, 450);
  };

  return (
    <div className="v-overlay" onClick={g.closeNPC}>
      <div className="v-sheet v-chat" onClick={(e) => e.stopPropagation()}>
        <div className="v-sheet-grab" />
        <div className="v-chat-head">
          <Avatar hue={npc.hue} size={44} />
          <div style={{ flex: 1 }}>
            <div className="v-npc-name">{npc.name}</div>
            <div className="v-mono v-npc-role">{VEYRA.tx(npc.role, g.lang)} · <span className="v-online">online</span></div>
          </div>
          <button className="v-iconbtn" onClick={g.closeNPC} aria-label={g.t('aClose')}><Ic name="close" size={18} /></button>
        </div>

        <div className="v-chat-body" ref={scrollRef}>
          {msgs.map((m, i) => (
            <div key={i} className={'v-msg v-msg-' + m.from}>
              <div className="v-bubble">{m.text}</div>
              {m.picks && (
                <div className="v-chat-picks">
                  {m.picks.map((id) => {
                    const pp = VEYRA.productById(id); if (!pp) return null;
                    return (
                      <button key={id} className="v-pickcard" onClick={() => { g.closeNPC(); g.openProduct(id); }}>
                        <ScenePlaceholder label={g.t('dropProduct')} hue={npc.hue} h={92} icon="hanger" style={{ borderRadius: 12 }} />
                        <div className="v-pickcard-name">{VEYRA.tx(pp.name, g.lang)}</div>
                        <b className="v-price v-sm">{VEYRA.money(pp.price)}</b>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="v-chat-foot">
          {!done && npc.chips.length > 0 && (
            <div className="v-chips">
              {npc.chips.map((c, i) => (
                <button key={i} className="v-chip" onClick={() => pick(c)}>{VEYRA.tx(c, g.lang)}</button>
              ))}
            </div>
          )}
          <form
            className="v-chat-input"
            onSubmit={(e) => { e.preventDefault(); sendDraft(); }}
          >
            <input
              className="v-input v-input-flat"
              placeholder={g.t('typeMessage')}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label={g.t('typeMessage')}
            />
            <button type="submit" className="v-send" aria-label={g.t('aSend')}><Ic name="send" size={20} /></button>
          </form>
        </div>
      </div>
    </div>
  );
}
