import { Ic } from '../ui';
import type { Game } from '../../lib/game/types';

export interface LangChipProps {
  g: Game;
  dark?: boolean;
  inline?: boolean;
}

export function LangChip({ g, dark, inline }: LangChipProps) {
  return (
    <button
      className={'v-lang' + (dark ? ' v-lang-d' : '') + (inline ? ' v-lang-inline' : '')}
      onClick={() => g.setLang(g.lang === 'vi' ? 'en' : 'vi')}
      aria-label={g.t('aLang')}
    >
      <Ic name="globe" size={16} />
      <b>{g.lang === 'vi' ? 'VI' : 'EN'}</b>
    </button>
  );
}
